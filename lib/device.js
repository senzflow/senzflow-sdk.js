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

function Device(brokerUrl, options) {
    if (('object' === typeof brokerUrl) && !options) {
        options = brokerUrl;
        brokerUrl = "mqtts://senzflow.io:8883";
    }
    options = __.extend(url.parse(brokerUrl || "mqtts://senzflow.io:8883", true), options);
    utils.mandateOptions(options, "clientId");

    if (!(this instanceof Device)) {
        return new Device(options);
    }

    events.EventEmitter.call(this);

    var deviceOptions = __.pick(options, "onControl", "onConfig", "initialLoad", "about", "deviceType");
    var connectOptions = __.extend({rejectUnauthorized: false}, __.omit(options, __.keys(deviceOptions)));

    if (deviceOptions.initialLoad && typeof deviceOptions.onConfig !== 'function') {
        console.warn('[WARN] "initialLoad" should be used with "onConfig"');
    }

    var _private = $(this);
    var that = this;

    _private.transactions = {};
    _private.deviceType = deviceOptions.deviceType || "_";
    _private.deviceID = connectOptions.clientId;
    _private.onControl = deviceOptions.onControl;
    _private.onConfig = deviceOptions.onConfig;
    _private.initialLoad = deviceOptions.initialLoad;
    _private.about = deviceOptions.about || {};
    _private.client = connect(_private.deviceID, connectOptions);

    _private.client
        .on("connect", function() {
            that._regist();
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
                if (topic.substr(0,3) === "$DM") {
                    that._handleManagement(topic, payload);
                } else {
                    debug("unexpected topic", topic);
                }
            }
            else {
                var event = {
                    eventType: topic,
                    payload: payload
                };
                that.emit('event', event);
            }
        });
}

inherits(Device, events.EventEmitter);

Device.prototype.sensorOnline = function(sensors) {
    var _private = $(this);
    _private.client.publish('$DM', JSON.stringify({
        type: "SENZON",
        data: sensors}));
};

Device.prototype.sensorOffline = function(sensors) {
    var _private = $(this);
    _private.client.publish('$DM', JSON.stringify({
        type: "SENZOFF",
        data: sensors}));
};

Device.prototype.publishStatus = function(name, value) {
    var _private = $(this);
    _private.client.publish('$DM', JSON.stringify({
        type: "STATUS",
        data: {name: name, value: value}}));
};

Device.prototype.loadConf = function(callback) {
    var _private = $(this);
    if (!_private.managed) {
        throw new Error("device is not managed");
    }
    var request = {type: "LOADCONFIG"};
    if (typeof callback === 'function') {
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
    _private.client.publish('$DM', JSON.stringify(request));
};

Device.prototype.publishEvent = function(options, callback) {
    var eventType = this._validatePublishEvent(options);
    var payload = options.payload;
    var stringOrBuffer = Buffer.isBuffer(payload) || typeof payload == 'string' ?
        payload : JSON.stringify(payload);
    var opts = __.defaults({}, __.pick(options, "qos", "retain"), {qos: 0});
    $(this).client.publish(eventType, stringOrBuffer, opts, callback);
};

Device.prototype.subscribeEvent = function( options, callback ) {
    var eventType = this._validateSubscribeEvent(options);
    $(this).client.subscribe( eventType, __.pick(options, "qos"), callback );
};

Device.prototype.unsubscribeEvent = function( options, callback ) {
    var eventType = this._validateSubscribeEvent(options);
    $(this).client.unsubscribe( eventType, callback );
};

Device.prototype.close = function( graceful, callback ) {
    var _private = $(this);
    var client = _private.client;
    if (graceful) {
        client.publish("$DM", JSON.stringify({type: "DEREGIST"}), {qos: 1}, function() {});
    }
    client.end( !graceful, callback );
};

Device.prototype._regist = function() {
    var _private = $(this);
    var that = this;
    var client = _private.client;
    client.publish("$DM",
        JSON.stringify({type: "REGIST", data: __.extend(__.pick(_private.about, "name", "label"),
            {deviceType: _private.deviceType})}),
        {qos: 1}, function(error, ok) {
        if (error) {
            that.emit("error", new Error("Cannot regist device (" + error.message + ")"));
        } else {
            if (_private.onControl || _private.onConfig) {
                assert(_private.onControl === undefined || typeof _private.onControl === 'function');
                assert(_private.onConfig === undefined || typeof _private.onConfig === 'function');
                client.subscribe("$DM", {qos: 2}, function(error) {
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
        }
    });
};

Device.prototype._validatePublishEvent = function(options) {
    var eventType = options.eventType;
    if (!eventType) {
        throw new Error("Missing eventType");
    }
    if (!/^\.?[\w\d_]+$/.test(eventType)) {
        throw new Error('Only alpha-num-low-dash are allowed for event type \''+eventType+'\'.');
    }
    var _private = $(this);
    var sensor = options.sensor;
    if (sensor) {
        eventType = eventType + "/" + sensor;
        options = __.omit(options, "sensor");
    }
    return eventType
};

Device.prototype._validateSubscribeEvent = function(options) {
    var eventType = options.eventType;
    if (!eventType) {
        throw new Error("Missing eventType");
    }
    if (!/^\.?[\w\d_]+$/.test(eventType)) {
        throw new Error("Only alpha-num-low-dash are allowed for event type \'"+eventType+"\'.");
    }
    return eventType
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
    if (!message.ack) {
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
    } else {
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

function debug() {
    console.log.apply(console, [].slice.call(arguments));
}

function isReserved(topic) {
    return /^\$.*$/m.test(topic);
}

function connect(deviceID, connectOptions) {
    utils.tlsOptions(connectOptions);
    return mqtt.connect(__.extend(connectOptions, {will: {
        topic: "$DM",
        payload: JSON.stringify({
            type: "WILL"
        }),
        qos: 1,
        retain: false
    }}));
}

module.exports = Device;