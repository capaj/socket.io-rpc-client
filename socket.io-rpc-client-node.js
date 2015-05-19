var Storage = require('dom-storage');
var Promise = require('bluebird');
var clientInjectableFn = require('./client');

// in-memory localStorage for caching templates
global.localStorage = new Storage(null, { strict: true });

//we are faking angular's injection process and from the function, our client is returned asme way s when Angular instantiates it
module.exports = clientInjectableFn(console, Promise);