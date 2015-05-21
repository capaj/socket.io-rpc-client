var RPC = require('socket.io-rpc');
var express = require('express');
var port = 8031;

var server = new RPC(port);
server.expose({
	test: require('./remote_methods'),
	plain: function(){
		return 41;
	}
});

var app = server.expressApp;
app.use(require('morgan')('dev'));
app.use(express.static(__dirname));

