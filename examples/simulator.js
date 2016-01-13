"use strict";

const fs = require("fs");
const repl = require('repl');
const Device = require("../index").Device;

function main() {

    let directory = process.cwd();

    if (process.argv.length > 2) {
        directory = process.argv[process.argv.length - 1];
        if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) {
            throw new Error(`"${directory}" doesnt seems to be a valid directory`);
        }
    }

    console.log(`will run simulator from ${directory}`);

    const simulator = new Device({
        clientId: "simulator",
        caPath: `${directory}/ca.pem`,
        keyPath: `${directory}/key.pem`,
        certPath: `${directory}/cert.pem`,
        protocol: 'mqtts',
        initialLoad: true,
        about: {
            name: "Simulator IOT Device",
            desc: "Simulated IOT device using the senzflow(©) sdk"
        },
        onConfig: (...args) => {
            console.log("Apply config:", ...args);
            return "Granted by 'simulator'";
        },
        onControl: (...args) => {
            console.log("Apply control:", ...args);
            return "Granted by 'simulator'";
        }
    });

    simulator.on("connect", () => console.log(`device connected`));
    simulator.on("error", (error) => console.error("something goes error", error));
    simulator.on("message", (topic, message) => console.log(`${topic} <== ${message}`));

    enable_repl(simulator);
}

function enable_repl(simulator) {
    const replServer = repl.start({
        prompt: 'simulator> ',
        input: process.stdin,
        output: process.stdout,
        useColors: true,
        ignoreUndefined: true
    });

    for (let alias of ['publish', 'pub', 'p']) {
        replServer.defineCommand(alias, {
            help: 'Publish a message',
            action: supportPublishCommand
        });
    }

    for (let alias of ['subscribe', 'sub', 's']) {
        replServer.defineCommand(alias, {
            help: 'Subscribe a topic',
            action: supportSubscribeCommand
        });
    }

    for (let alias of ['unsubscribe', 'unsub', 'u']) {
        replServer.defineCommand(alias, {
            help: 'Unsubscribe a topic',
            action: supportUnsubscribeCommand
        });
    }

    for (let alias of ['report', 'r']) {
        replServer.defineCommand(alias, {
            help: 'Report device status',
            action: supportReportStatusCommand
        });
    }

    for (let alias of ['load', 'l']) {
        replServer.defineCommand(alias, {
            help: 'Load device config',
            action: supportLoadConfCommand
        });
    }

    replServer.on('exit', () => {
        console.log("Bye!");
        simulator.close();
        process.exit();
    });

    function supportPublishCommand(string) {
        if (string) {
            let [, topic, payload] = /\s*(\S+)\s+(.*)/.exec(string) || [];
            if (topic) {
                simulator.publish(topic, payload, (error) => {
                    if (error) {
                        console.error(`ERROR ${topic} ==> ${payload}:`, error);
                    } else {
                        console.log(`${topic} ==> ${payload}`);
                    }
                    this.displayPrompt();
                });
            } else {
                console.error(`ERROR incomplete command "${string}"`);
                this.displayPrompt();
            }
        }
    }

    function supportSubscribeCommand(topic) {
        if (topic) {
            simulator.subscribe(topic, {qos: 2}, (err, r) => {
                if (err) {
                    console.error(`Error subscribe "${topic}":`, err)
                } else {
                    console.log(`OK subscribed to "${topic}"`);
                }
                this.displayPrompt();
            });
        }
    }

    function supportUnsubscribeCommand(topic) {
        if (topic) {
            simulator.unsubscribe(topic, (err, r) => {
                if (err) {
                    console.error(`Error unsubscribe "${topic}":`, err)
                } else {
                    console.log(`OK unsubscribed to "${topic}"`);
                }
                this.displayPrompt();
            });
        }
    }

    function supportReportStatusCommand(string) {
        if (string) {
            let [, name, value] = /\s*(\S+)\s+(.*)/.exec(string) || [];
            if (name) {
                simulator.reportStatus(name, value);
            } else {
                console.error(`ERROR incomplete command "${string}"`);
            }
        }
        this.displayPrompt();
    }

    function supportLoadConfCommand(string) {
        simulator.loadConf(function(err, res) {
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
    main();
} catch (e) {
    console.error(e.stack, e);
    process.exit();
}
