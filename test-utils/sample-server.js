var RPC = require('socket.io-rpc');
var express = require('express');
var port = 8031;

var server = RPC(port);
server.expose({
	test: require('./remote_methods'),
	plain: function(){
		return 41;
	}
});

server.expose({
	test: {
		testFunc: function() {
			return 'second expose';
		}
	}
});

var app = server.expressApp;
app.use(require('morgan')('dev'));
app.use(express.static(__dirname));

process.send('initialized');