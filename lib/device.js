"use strict";

var __ = require("lodash");
var assert = require("assert");
var mqtt = require('mqtt');
var $ = require('private-parts').createKey({});
var events = require('events');
var inherits = require('util').inherits;
var utils = require("./utils");
var TIMEOUT = 60000;

function Device(options) {
    utils.mandateOptions(options, "clientId");

    if (!(this instanceof Device)) {
        return new Device(options);
    }

    events.EventEmitter.call(this);

    var deviceOptions = __.pick(options, "onControl", "onConfig", "initialLoad");
    var connectOptions = __.defaults({rejectUnauthorized: true}, __.omit(options, __.keys(deviceOptions)));

    if (deviceOptions.initialLoad && typeof deviceOptions.onConfig !== 'function') {
        console.warn('[WARN] "initialLoad" should be used with "onConfig"');
    }

    var _private = $(this);
    var that = this;

    _private.transactions = {};
    _private.deviceID = connectOptions.clientId;
    _private.onControl = deviceOptions.onControl;
    _private.onConfig = deviceOptions.onConfig;
    _private.client = connect(_private.deviceID, connectOptions);

    var deviceTopic = "$/device/" + _private.deviceID;

    _private.client
        .on("connect", function() {
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
                if (topic === deviceTopic) {
                    that._handleManagement(topic, payload);
                } else {
                    debug("unexpected topic", topic);
                }
            }
            else {
                that.emit('message', topic, payload);
            }
        });

    if (_private.onControl || _private.onConfig) {
        assert(_private.onControl === undefined || typeof _private.onControl === 'function');
        assert(_private.onConfig === undefined || typeof _private.onConfig === 'function');
        that.on("connect", function() {
            _private.client.subscribe(deviceTopic, {qos: 2}, function(error) {
                if (error) {
                    _private.managed = false;
                    debug("Error subscribe", error);
                    that.emit("error", error);
                } else {
                    _private.managed = true;
                    that.emit("management");
                    if (deviceOptions.initialLoad === true) {
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
        });
    }
}

inherits(Device, events.EventEmitter);

Device.prototype.reportStatus = function(name, value) {
    var _private = $(this);
    _private.client.publish('$/devmgmt', JSON.stringify({
        type: "request",
        name: "UpdateStatus",
        from: _private.deviceID,
        data: {name: name, value: value}}));
};

Device.prototype.loadConf = function(callback) {
    var _private = $(this);
    if (!_private.managed) {
        throw new Error("device is not managed");
    }
    var request = {
        type: "request",
        name: "LoadConf",
        from: _private.deviceID
    };
    if (typeof callback === 'function') {
        request.sequence = Date.now();
        var timer = setTimeout(function() {
            (_private.transactions[request.sequence]||__.noop)(new Error("Timeout LoadConf"));
            debug("Timeout LoadConf");
        }, TIMEOUT);
        _private.transactions[request.sequence] = function(error, data) {
            delete _private.transactions[request.sequence];
            clearTimeout(timer);
            callback.apply(null, [error, data]);
        };
    }
    _private.client.publish('$/devmgmt', request);
};

Device.prototype.publish = function(topic, message, options, callback) {
    this._validateTopic(topic);
    var _private = $(this);
    _private.client.publish(topic,
        __.isPlainObject(message) ? JSON.stringify(message) : message,
        options, callback);
};

Device.prototype.subscribe = function( topic, options, callback ) {
    this._validateTopic(topic);
    var _private = $(this);
    _private.client.subscribe( topic, options, callback );
};

Device.prototype.unsubscribe = function( topic, options, callback ) {
    this._validateTopic(topic);
    var _private = $(this);
    _private.client.unsubscribe( topic, options, callback );
};

Device.prototype.close = function( force, callback ) {
    var _private = $(this);
    _private.client.end( force, callback );
};

Device.prototype._validateTopic = function(topic) {
    if (isReserved(topic)) {
        throw new Error('publish/subscribe to reserved topic \''+topic+'\'');
    }
};

Device.prototype._handleManagement = function(topic, payload) {
    var _private = $(this);
    var that = this;
    var message = JSON.parse(String(payload));

    debug("[devmgmt]", topic, message);

    function makeResponse(result) {
        var ack = message.sequence;
        if (ack !== undefined) {
            var responseTopic = "$/devmgmt/"+message.from;
            Promise.resolve(result).then(function(data) {
                that.publish(responseTopic, {type: "response", ack: ack, status: "OK", data: data});
            }, function(error) {
                that.publish(responseTopic, {type: "response", ack: ack, status: "Error", message: error.message});
            });
        }
    }
    if (message.type === 'request') {
        switch (message.name) {
            case 'Control':
                var control = message.control;
                makeResponse(_private.onControl ? _private.onControl.apply(null, [control.name].concat(control.args)) :
                    Promise.reject({message: "Unsupported operation"}));
                break;
            case 'Config':
                var config = message.config;
                makeResponse(_private.onConfig ? _private.onConfig(config.name, config.value) :
                    Promise.reject({message: "Unsupported operation"}));
                break;
            default:
                debug("unexpected request", message);
        }
    } else if (message.type === 'response') {
        var trans = _private.transactions[message.ack];
        if (trans) {
            if (message.status === "OK") {
                trans(null, message.data)
            } else {
                trans(new Error(message.message||"Oops..."));
            }
        }
    } else {
        debug("unknown message", message);
    }
};

function debug() {
    console.log.apply(console, [].slice.call(arguments));
}

function isReserved(topic) {
    return /^\$(\/.*)?$/m.test(topic);
}

function connect(deviceID, connectOptions) {
    utils.tlsOptions(connectOptions);
    return mqtt.connect(__.extend(connectOptions, {will: {
        topic: "$/devmgmt",
        payload: JSON.stringify({
            from: deviceID,
            type: "request",
            name: "Will"
        }),
        qos: 1,
        retain: false
    }}));
}

module.exports = Device;