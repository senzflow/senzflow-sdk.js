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

    var deviceType = deviceOptions.deviceType || "_";
    if (!/^[\w\d_]+$/.test(deviceType)) {
        throw new Error("deviceType '"+deviceType +"' is illegal")
    }
    if (deviceOptions.initialLoad && typeof deviceOptions.onConfig !== 'function') {
        console.warn('[WARN] "initialLoad" should be used with "onConfig"');
    }

    var _private = $(this);
    var that = this;

    _private.transactions = {};
    _private.deviceType = deviceType;
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
                debug("______ receiving", topic);
                var topicInfo = topic.split("/", 4);
                var deviceType = topicInfo[0];
                var options;
                if (deviceType[0] === '.') {
                    options = {
                        deviceType: deviceType.substr(1)
                    }
                } else {
                    options = {
                        deviceType: deviceType
                    }
                }
                var eventType = topicInfo[1];
                that.emit('event', eventType, payload, options);
            }
        });
}

inherits(Device, events.EventEmitter);

Device.prototype.reportStatus = function(name, value) {
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

Device.prototype.publishEvent = function(eventType, message, options, callback) {
    var validated = this._validatePublishEvent(eventType, options);
    var _private = $(this);
    _private.client.publish(validated.type,
        __.isPlainObject(message) ? JSON.stringify(message) : message,
        validated.options, callback);
};

Device.prototype.subscribeEvent = function( event, options, callback ) {
    var validated = this._validateSubscribeEvent(event, options);
    var _private = $(this);
    _private.client.subscribe( validated.type, validated.options, callback );
};

Device.prototype.unsubscribeEvent = function( event, options, callback ) {
    if (typeof options === 'function') {
        callback = options;
        options = {}
    } else if (!options) {
        options = {}
    }
    var validated = this._validateSubscribeEvent(event, options);
    var _private = $(this);
    _private.client.unsubscribe( validated.type, callback );
};

Device.prototype.close = function( force, callback ) {
    var _private = $(this);
    var client = _private.client;
    client.publish("$DM", JSON.stringify({type: "DEREGIST"}), {qos: 1});
    client.end( force, callback );
};

Device.prototype._regist = function() {
    var _private = $(this);
    var that = this;
    var client = _private.client;
    client.publish("$DM",
        JSON.stringify({type: "REGIST", data: __.pick(_private.about, "name", "label")}),
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

Device.prototype._validatePublishEvent = function(eventType, options) {
    if (!/^\.?[\w\d_]+$/.test(eventType)) {
        throw new Error('Only alpha-num-low-dash are allowed for event type \''+eventType+'\'.');
    }
    var _private = $(this);
    if (eventType[0] === '.') {
        eventType = '.' + _private.deviceType + "/" + eventType.substr(1);
    } else {
        eventType = _private.deviceType + "/" + eventType;
    }
    var sensor = options && options.sensor;
    if (sensor) {
        eventType = eventType + "/" + sensor;
        options = __.omit(options, "sensor");
    }
    return {type: eventType, options: options}
};

Device.prototype._validateSubscribeEvent = function(eventType, options) {
    if (!/^\.?[\w\d_]+$/.test(eventType)) {
        throw new Error("Only alpha-num-low-dash are allowed for event type \'"+eventType+"\'.");
    }
    var deviceType = options.deviceType;
    if (deviceType !== undefined) {
        options = __.omit(options, "deviceType");
    } else {
        deviceType = $(this).deviceType;
    }
    if (eventType[0] === '.') {
        eventType = '.' + deviceType + "/" + eventType.substr(1);
    } else {
        eventType = deviceType + "/" + eventType;
    }
    return {type: eventType, options: options}
};

Device.prototype._handleManagement = function(topic, payload) {
    var _private = $(this);
    var that = this;
    var message = JSON.parse(String(payload));

    debug("[devmgmt]", topic, message);

    function makeResponse(result) {
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
            if (result && typeof result.then === 'function') {
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
                makeResponse(_private.onControl ? _private.onControl.apply(null, [control.name].concat(control.args)) :
                    Promise.reject({message: "Unsupported operation"}));
                break;
            case 'CONFIG':
                var config = message.data;
                makeResponse(_private.onConfig ? _private.onConfig(config.name, config.value) :
                    Promise.reject({message: "Unsupported operation"}));
                break;
            default:
                debug("unexpected request", message);
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