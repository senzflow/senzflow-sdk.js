"use strict";

var __ = require("lodash");
var assert = require("assert");
var url = require("url");
var mqtt = require('mqtt');
var $ = require('private-parts').createKey({});
var events = require('events');
var inherits = require('util').inherits;
var utils = require("./utils");
var TIMEOUT = 60000;
var mqttconnect = require('mqtt/lib/connect');


function Device(options) {
    utils.mandateOptions(options, "clientId");

    if (!(this instanceof Device)) {
        return new Device(options);
    }

    events.EventEmitter.call(this);

    var deviceOptions = __.pick(options, "onControl", "onConfig", "initialLoad", "meta");

    var connectOptions = __.extend({
        rejectUnauthorized: false,
        host: 'itbroker.senzflow.io', // formal is senzflow.io itbroker.senzflow.io
        port: 8883,
        protocol:'mqtts',
      }, __.omit(options, __.keys(deviceOptions)));


    if (deviceOptions.initialLoad && typeof deviceOptions.onConfig !== 'function') {
        console.warn('[WARN] "initialLoad" should be used with "onConfig"');
    }

    var _private = $(this);
    var that = this;

    _private.transactions = {};
    _private.deviceID = connectOptions.clientId;
    _private.onControl = deviceOptions.onControl;
    _private.onConfig = deviceOptions.onConfig;
    _private.initialLoad = deviceOptions.initialLoad;
    _private.meta = deviceOptions.meta || {};

    _private.client = connect(connectOptions);

    _private.client
        .on("connect", function() {
            //that._regist();
            that.emit( 'connect' );
        })
        .on("close", function() {
            that.emit( 'close' );
        })
        .on('reconnect', function() {
            that.emit( 'reconnect' );
        })
        .on('offline', function() {
            that.emit( 'offline' );
        })
        .on('error', function(error) {
            that.emit( 'error', error );
        })
        .on("message", function(topic, payload) {
            if (isReserved(topic)) {
                if (topic.substr(0,3) === "$") {
                    that._handleManagement(topic, payload);
                } else {
                    debug("unexpected topic", topic);
                }
            }
            else {
                var event = {
                    name: topic,
                    content: payload
                };
                that.emit('event', event);
            }
        });
}

inherits(Device, events.EventEmitter);

Device.prototype.nodeOnline = function(identity, opts) {
    identityValidate(identity);
    var _private = $(this);
    var request = JSON.stringify({
        type: "On",
        data: __.extend({}, opts, {identity: identity})
    });
    var that = this;
    _private.client.publish('$', request, {qos: 1}, function(error, ok) {
        if (error) {
            that.emit("error", new Error("Cannot regist device (" + error.message + ")"));
        }
    });
};

Device.prototype.nodeOffline = function(identity) {
    var _private = $(this);
    _private.client.publish('$', JSON.stringify({
        type: "Off",
        data: {identity: identity}}));
};

Device.prototype.publishStatus = function(identity, name, value) {
    var _private = $(this);
    if (arguments.length < 2 || arguments.length > 3) {
        throw new Error("Bad arguments")
    }
    if (arguments.length == 2) {
        value = name;
        name = identity;
        identity = _private.deviceID;
    }
    _private.client.publish('$', JSON.stringify({
        type: "Status",
        data: {identity: identity, name: name, value: value}}));
};

Device.prototype.loadConf = function(callback) {
    var _private = $(this);
    if (!_private.managed) {
        throw new Error("device is not managed");
    }
    var request = {type: "LoadConf"};
    if (typeof callback === 'function')
    {
        request.id = Date.now();
        var timer = setTimeout(function() {
            (_private.transactions[request.id]||__.noop)(new Error("Timeout LoadConf"));
            debug("Timeout LoadConf");
        }, TIMEOUT);
        _private.transactions[request.id] = function(error, data) {
            delete _private.transactions[request.id];
            clearTimeout(timer);
            callback.apply(null, [error, data]);
        };
    }
    _private.client.publish('$', JSON.stringify(request));
};

Device.prototype.publishEvent = function(options, callback) {
    var etype = this._validatePublishEvent(options);
    var payload = options.payload;
    var stringOrBuffer = Buffer.isBuffer(payload) || typeof payload == 'string' ?
        payload : JSON.stringify(payload);
    var opts = __.defaults({}, __.pick(options, "qos", "retain"), {qos: 1});
    $(this).client.publish(etype, stringOrBuffer, opts, callback);
};

Device.prototype.subscribeEvent = function( options, callback ) {
    var etype = this._validateSubscribeEvent(options);
    $(this).client.subscribe( etype, __.pick(options, "qos"), callback );
};

Device.prototype.unsubscribeEvent = function( options, callback ) {
    var etype = this._validateSubscribeEvent(options);
    $(this).client.unsubscribe( etype, callback );
};

Device.prototype.close = function( graceful, callback ) {
    var _private = $(this);
    var client = _private.client;
    if (graceful) {
        client.publish("$", JSON.stringify({type: "Off"}), {qos: 1}, function() {});
    }
    client.end( !graceful, callback );
};

Device.prototype._regist = function() {
    var _private = $(this);
    var that = this;
    var client = _private.client;
    this.nodeOnline(_private.deviceID, __.extend({}, _private.meta));
    if (_private.onControl || _private.onConfig) {
        assert(_private.onControl === undefined || typeof _private.onControl === 'function');
        assert(_private.onConfig === undefined || typeof _private.onConfig === 'function');
        client.subscribe("$", {qos: 2}, function(error) {
            if (error) {
                _private.managed = false;
                debug("Error subscribe", error);
                that.emit("error", new Error("Cannot activate devmgmt (" + error.message + ")"));
            } else {
                _private.managed = true;
                that.emit("management");
                if (_private.initialLoad === true) {
                    assert(typeof _private.onConfig === 'function');
                    that.loadConf(function(error, conf) {
                        if (error) {
                            that.emit("error", error);
                        } else {
                            _private.onConfig(conf);
                        }
                    });
                }
            }
        });
    }
};

Device.prototype._validatePublishEvent = function(options) {
    var etype = options.name;
    if (!etype) {
        throw new Error("Missing event name");
    }
    identityValidate(etype);
    var _private = $(this);
    var node = options.node;
    if (node) {
        identityValidate(node);
        etype = etype + "/" + node;
        options = __.omit(options, "node");
    }
    return etype
};

Device.prototype._validateSubscribeEvent = function(options) {
    var etype = options.name;
    if (!etype) {
        throw new Error("Missing event name");
    }
    identityValidate(etype);
    return etype
};

Device.prototype._handleManagement = function(topic, payload) {
    var _private = $(this);
    var that = this;
    var message;
    try {
        message = JSON.parse(String(payload));
    } catch (e) {
        debug("malformed message", String(payload));
        return
    }

    debug("[devmgmt]", topic, message);

    function makeResponse(err, result) {
        var ack = message.id;
        if (!utils.isUndefined(ack)) {
            var responseTopic = message.replyto;
            var client = _private.client;
            var _ok = function(data) {
                debug("[ok]", message, data);
                client.publish(responseTopic,
                    JSON.stringify({ack: ack, status: "OK", data: data}));
            };
            var _err = function(error) {
                debug("[error]", message, error);
                client.publish(responseTopic,
                    JSON.stringify({ack: ack, status: "Error", message: error.message}));
            };
            if (err) {
                _err(err);
            } else if (result && typeof result.then === 'function') {
                result.then(_ok, _err);
            } else {
                _ok(result);
            }
        }
    }
    if (!message.ack)
    {
        switch (message.type) {
            case 'CONTROL':
                var control = message.data;
                if (_private.onControl) {
                    makeResponse(null, _private.onControl.apply(null, [control.name].concat(control.args)))
                } else {
                    that.emit("control", {control:control, done:makeResponse});
                }
                break;
            case 'CONFIG':
                var config = message.data;
                if (_private.onConfig) {
                    makeResponse(_private.onConfig(config.name, config.value));
                } else {
                    that.emit("config", {config:config, done:makeResponse});
                }
                break;
            default:
                debug("unexpected request", message);
                makeResponse("Bad dm type");
        }
    } else { //ack
        var trans = _private.transactions[message.ack];
        if (trans) {
            if (message.status === "OK") {
                trans(null, message.data)
            } else {
                trans(new Error(message.message||"Oops..."));
            }
        }
    }
};

function identityValidate(identity) {
    if (!/^\.?[\w\d_]+$/.test(identity)) {
        throw new Error('Only alpha-num-low-dash are allowed for identity \''+identity+'\'.');
    }
}

function debug() {
    console.log.apply(console, [].slice.call(arguments));
}

function isReserved(topic) {
    return /^\$.*$/m.test(topic);
}

function connect(connectOptions) {

    utils.tlsOptions(connectOptions);
    //by YK return mqtt.connect(connectOptions);
    return mqttconnect(connectOptions);
}

module.exports = Device;