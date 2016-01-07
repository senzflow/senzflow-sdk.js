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
        initialLoad: true
    });

    simulator.on("connect", () => console.log(`device connected`));
    simulator.on("error", (error) => console.error(error));
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

    for (let alias of ['publish', 'p']) {
        replServer.defineCommand(alias, {
            help: 'Publish a message',
            action: supportPublishCommand
        });
    }

    for (let alias of ['subscribe', 's']) {
        replServer.defineCommand(alias, {
            help: 'Subscribe a topic',
            action: supportSubscribeCommand
        });
    }

    replServer.on('exit', () => {
        console.log("Bye!");
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
                });
            } else {
                console.error(`ERROR incomplete command "${string}"`);
            }
        }
        this.displayPrompt();
    }

    function supportSubscribeCommand(topic) {
        if (topic) {
            simulator.subscribe(topic, {qos: 2}, (err, r) => {
                if (err) {
                    console.error(`Error subscribe "${topic}":`, err)
                } else {
                    console.log(`OK subscribed to "${topic}"`);
                }
            });
        }
        this.displayPrompt();
    }
}


try {
    main();
} catch (e) {
    console.error(e.stack, e);
    process.exit();
}
