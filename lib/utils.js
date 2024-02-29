var fs = require('fs');
var assert = require('assert');

function isUndefined(value) {
    return value === undefined || value === null;
}

function tlsOptions(options) {

    function chooseBufferOrFile(name) {
        var opt1 = options[name], opt2 = options[name + 'Path'];
        var opt = opt1 || opt2;
        if (isUndefined(opt)) {
            throw new Error('Missing option "' + name + '"');
        }
        if (opt !== (opt2 || opt1)) {
            throw new Error('Conflict option "' + name + '". Specify just one of "' + name + '" or "' + name + 'Path"');
        }
        if (Buffer.isBuffer(opt)) {
            options[name] = opt;
        } else {
            assert(typeof opt === "string");
            if (fs.existsSync(opt)) {
                options[name] = fs.readFileSync(opt);
            } else {
                options[name] = opt;
            }
        }
        delete options[name + 'Path'];
    }

    //add the below codes by YanKui 2016-06-22
    if (options.auth && !options.caPath){

        options.certPath = null;
        options.keyPath = null;
        options.caPath =null;
        options.protocol = 'mqtt';
        options.rejectUnauthorized = false;
        options.requestCert = false;
        options.port = 1883;

    } else
    if (options.auth && options.caPath)
    {
        options.certPath = null;
        options.keyPath = null;
        chooseBufferOrFile("ca");
        options.rejectUnauthorized = true;
        options.requestCert =true ;

    } else {
        chooseBufferOrFile("key");
        chooseBufferOrFile("ca");
        chooseBufferOrFile("cert");
        options.requestCert = true;
        options.rejectUnauthorized = true;

    }
}

function sequencer(initial) {
    var sequence = initial === 0 ? 0 : initial || 1;
    return function () {
        return sequence++;
    }
}

function mandateOptions(options, prop /*...*/) {
    for (var i=1; i<arguments.length; i++) {
        if (!options.hasOwnProperty(arguments[i])) {
            throw new Error('Missing mandate option "' + arguments[i] + '"');
        }
    }
}

module.exports = {
    isUndefined: isUndefined,
    tlsOptions: tlsOptions,
    sequencer: sequencer,
    mandateOptions: mandateOptions
};
