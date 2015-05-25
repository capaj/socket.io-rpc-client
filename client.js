require('error-tojson');
var socketHandlers = require('./socket.io-rpc-event-handlers/socket-event-handlers');
var io = require('socket.io-client');
var assign = require('lodash.assign');
var backends = {};

/**
 * pseudo constructor, connects to remote server which exposes RPC calls, if trying to connect to a backend, which
 * already exists, then existing instance is returned
 * @param {String} [url] to connect to, for example http://localhost:8080
 * @param {Object} [handshake] for global authorization, is passed to socket.io connect method
 * returns {Socket} master socket namespace which you can use for looking under the hood
 */
module.exports = function RPCBackend(url, handshake) {
	if (!url) {
		if (typeof location === 'object') {
			url = '//' + location.host;	//we run in the browser
		} else {
			throw new Error('For node.js, you always have to provide an url as first parameter');
		}
	}
	if (backends[url]) {
		return backends[url];
	}

	var socket = io.connect(url + '/rpc', handshake);
	var tree = {};
	socketHandlers(socket, tree, 'client');
	var rpc = socket.rpc;
	/**
	 * @param toExtendWith {Object}
	 */
	rpc.expose = function(toExtendWith) {
		assign(tree, toExtendWith);
	};
	rpc.socket = socket;

	if (!RPCBackend.defaultBackend) {
		RPCBackend.defaultBackend = rpc;   //the first rpc connection is the default, if you want, you can set some other
	}

	backends[url] = rpc;
	return rpc;	//an instance of backend

};