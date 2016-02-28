"use strict";

var fs = require("fs");
var repl = require('repl');
var Device = require("../index").Device;

function main(argv) {

    var nopt = require("nopt");

    var opts = nopt({
        workdir: [String, null],
        clientId: [String, null],
        url: [String],
        rejectUnauthorized: Boolean
    }, {
        w: ["--workdir"],
        u: ["--url"],
        i: ["--clientId"],
        r: ["--rejectUnauthorized"]
    }, argv);

    var directory = opts.workdir || process.cwd();

    console.log("will run simulator from " + directory);

    var simulator = new Device(opts.url, {
        clientId: opts.clientId || "simulator_" + Date.now(),
        caPath: directory + "/ca.pem",
        keyPath: directory + "/key.pem",
        certPath: directory + "/cert.pem",
        protocol: 'mqtts',
        initialLoad: true,
        deviceType: "simtype",
        rejectUnauthorized: !!opts.rejectUnauthorized,
        about: {
            name: "Simulator IOT Device",
            label: "Simulated IOT device using the senzflow(©) sdk"
        },
        onConfig: function() {
            console.log("Apply config:", arguments);
            return "Granted by 'simulator'";
        },
        onControl: function() {
            console.log("Apply control:", arguments);
            return "Granted by 'simulator'";
        }
    });

    simulator.on("connect", function() { console.log("device connected") });
    simulator.on("error", function(error) { console.error("something goes error", error) });
    simulator.on("event", function(event, message, options) { console.log(event + " <== " + message, options) });

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

    replServer.on('exit', function() {
        console.log("Bye!");
        simulator.close();
        process.exit();
    });

    function supportPublishCommand(string) {
        if (string) {
            var temp = /\s*(\S+)\s+(.*)/.exec(string) || [], event = temp[1], payload=temp[2];
            if (event) {
                simulator.publishEvent(event, payload, function(error) {
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
            simulator.subscribeEvent(event, { qos: 2 }, function(err, r) {
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
            simulator.unsubscribeEvent(event, function(err, r) {
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
                simulator.reportStatus(name, value);
            } else {
                console.error("ERROR incomplete command " + string);
            }
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
