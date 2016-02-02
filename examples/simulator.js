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
        rejectUnauthorized: !!opts.rejectUnauthorized,
        about: {
            name: "Simulator IOT Device",
            desc: "Simulated IOT device using the senzflow(©) sdk"
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
    simulator.on("message", function(topic, message) { console.log(topic + " <== " + message) });

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
            help: 'Subscribe a topic',
            action: supportSubscribeCommand
        });
    });

    ['unsubscribe', 'unsub', 'u'].map(function(alias) {
        replServer.defineCommand(alias, {
            help: 'Unsubscribe a topic',
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
            var temp = /\s*(\S+)\s+(.*)/.exec(string) || [], topic = temp[1], payload=temp[2];
            if (topic) {
                simulator.publish(topic, payload, function(error) {
                    if (error) {
                        console.error("ERROR " + topic + " ==> " + payload + ":", error);
                    } else {
                        console.log(topic +" ==> " + payload);
                    }
                    this.displayPrompt();
                }.bind(this));
            } else {
                console.error("ERROR incomplete command " + string);
                this.displayPrompt();
            }
        }
    }

    function supportSubscribeCommand(topic) {
        if (topic) {
            simulator.subscribe(topic, { qos: 2 }, function(err, r) {
                if (err) {
                    console.error("Error subscribe " + topic  + ":", err);
                } else {
                    console.log("OK subscribed to " + topic);
                }
                this.displayPrompt();
            }.bind(this));
        }
    }

    function supportUnsubscribeCommand(topic) {
        if (topic) {
            simulator.unsubscribe(topic, function(err, r) {
                if (err) {
                    console.error("Error unsubscribe " + topic + ":", err);
                } else {
                    console.log("OK unsubscribed to " + topic);
                }
                this.displayPrompt();
            }.bind(this));
        }
    }

    function supportReportStatusCommand(string) {
        if (string) {
            var temp = /\s*(\S+)\s+(.*)/.exec(string) || [], name = temp[1], valule = temp[2];
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
