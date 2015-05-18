var RPC = require('../main.js');
var express = require('express');
var port = 8031;

var rpcApp = new RPC(port, {
	test: require('./rpc_channel_test'),
	plain: function(){
		return 41;
	}
}, {
	test: function(handshake, CB) {	//second function/parameter is optional for authenticated channels
		if (handshake.passw == '123') {
			CB(true);
		} else {
			CB(false);
		}
	}
});

var app = rpcApp.expressApp;
app.use(require('morgan')('dev'));
app.use(express.static(__dirname));

