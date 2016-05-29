"use strict";

var fs = require("fs");
var repl = require('repl');
var Device = require("../index").Device;

function main(argv) {

    var nopt = require("nopt");

    var opts = nopt({
        workdir: [String, null],
        clientId: [String, null],
    }, {
        w: ["--workdir"],
        i: ["--clientId"]
    }, argv);

    var directory = opts.workdir || process.cwd();

    console.log("will run simulator from " + directory);

    var simulator = new Device({
        clientId: opts.clientId || "simulator",
        caPath: directory + "/ca.pem",
        keyPath: directory + "/key.pem",
        certPath: directory + "/cert.pem",
        meta: {
            model: "simulator",
            desc: "Simulated IOT device using the senzflow(©) sdk"
        }
    });

    function onConfig(config) {
        console.log("Apply config:", config.config);
        config.done(null, "Granted by 'simulator'");
    }

    function onControl(control) {
        console.log("Apply control:", control.control);
        control.done(null, "Granted by 'simulator'");
    }

    simulator
        .on("connect", function() { console.log("device connected") })
        .on("error",   function(error) { console.error("something goes error", error) })
        .on("event",   function(event) { console.log(event.name, "<==", String(event.payload)) })
        .on("close",   function() {console.log( 'close' ) })
        .on('reconnect', function() { console.log( 'reconnect' ) })
        .on('offline', function() { console.log( 'offline' ) })
        .on('config', onConfig)
        .on('control', onControl)
        ;
    enable_repl(simulator);
}

function enable_repl(simulator) {
    var replServer = repl.start({
        prompt: 'simulator> ',
        input: process.stdin,
        output: process.stdout,
        useColors: true,
        ignoreUndefined: true
    });

    ['publish', 'pub', 'p'].map(function(alias) {
        replServer.defineCommand(alias, {
            help: 'Publish a message',
            action: supportPublishCommand
        });
    });

    ['subscribe', 'sub', 's'].map(function(alias) {
        replServer.defineCommand(alias, {
            help: 'Subscribe a event',
            action: supportSubscribeCommand
        });
    });

    ['unsubscribe', 'unsub', 'u'].map(function(alias) {
        replServer.defineCommand(alias, {
            help: 'Unsubscribe a event',
            action: supportUnsubscribeCommand
        });
    });

    ['report', 'r'].map(function(alias) {
        replServer.defineCommand(alias, {
            help: 'Report device status',
            action: supportReportStatusCommand
        });
    });

    ['load', 'l'].map(function(alias) {
        replServer.defineCommand(alias, {
            help: 'Load device config',
            action: supportLoadConfCommand
        });
    });

    ['senzon'].map(function(alias) {
        replServer.defineCommand(alias, {
            help: 'Make node online',
            action: supportNodeOnline
        });
    });

    ['senzoff'].map(function(alias) {
        replServer.defineCommand(alias, {
            help: 'Make node offline',
            action: supportNodeOffline
        });
    });

    replServer.on('exit', function() {
        console.log("Bye!");
        simulator.close();
        process.exit();
    });

    function supportPublishCommand(string) {
        if (string) {
            var temp = /\s*(\S+)\s+(.*)/.exec(string) || [], event = temp[1], payload=temp[2];
            if (event) {
                simulator.publishEvent({name: event, payload: payload}, function(error) {
                    if (error) {
                        console.error("ERROR " + event + " ==> " + payload + ":", error);
                    } else {
                        console.log(event +" ==> " + payload);
                    }
                    this.displayPrompt();
                }.bind(this));
            } else {
                console.error("ERROR incomplete command " + string);
                this.displayPrompt();
            }
        }
    }

    function supportSubscribeCommand(event) {
        if (event) {
            simulator.subscribeEvent({name: event, qos: 2 }, function(err, r) {
                if (err) {
                    console.error("Error subscribe " + event  + ":", err);
                } else {
                    console.log("OK subscribed to " + event);
                }
                this.displayPrompt();
            }.bind(this));
        }
    }

    function supportUnsubscribeCommand(event) {
        if (event) {
            simulator.unsubscribeEvent({name: event}, function(err, r) {
                if (err) {
                    console.error("Error unsubscribe " + event + ":", err);
                } else {
                    console.log("OK unsubscribed to " + event);
                }
                this.displayPrompt();
            }.bind(this));
        }
    }

    function supportReportStatusCommand(string) {
        if (string) {
            var temp = /\s*(\S+)\s+(.*)/.exec(string) || [], name = temp[1], value = temp[2];
            if (name) {
                simulator.publishStatus(name, value);
            } else {
                console.error("ERROR incomplete command " + string);
            }
        }
        this.displayPrompt();
    }

    function supportNodeOnline(string) {
        if (string) {
            simulator.nodeOnline(string);
        }
        this.displayPrompt();
    }

    function supportNodeOffline(string) {
        if (string) {
            simulator.nodeOffline(string);
        }
        this.displayPrompt();
    }

    function supportLoadConfCommand(string) {
        simulator.loadConf(function (err, res) {
            if (err) {
                console.error("Error load config:", err);
            } else {
                console.log("Loaded config:", res);
            }
        });
        this.displayPrompt();
    }
}

try {
    main(process.argv);
} catch (e) {
    console.error(e.stack, e);
    process.exit();
}
