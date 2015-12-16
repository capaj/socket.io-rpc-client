# socket.io-rpc-client [![Build Status](https://travis-ci.org/capaj/socket.io-rpc-client.svg?tag=1.0.3)](https://travis-ci.org/capaj/socket.io-rpc-client) [![js-standard-style](https://cdn.rawgit.com/feross/standard/master/badge.svg)](https://github.com/feross/standard)
client library for a [socket.io-rpc](https://github.com/capaj/socket.io-rpc)

All libraries are written in commonJS module style, so you need to use SystemJS loader to be able to use them in the browser. Browserify/webpack might work, if you set it up correctly, but might be a pain and you're probably will have to delve deep into the code.
Angular.js lib contains special rpc-controller directive, which when compiled asynchronously loads server channel and instantiates classic angular controller when this channel is ready.
#Usage
```npm install socket.io-rpc-client```  for serverside usage

```jspm install socket.io-rpc-client``` for clientside usage

then in Node.js:
```javascript
var rpcClient = require('socket.io-rpc-client');

var rpc = rpcClient('http://localhost:8032');
//call to the server
rpc('plain')().then(function(ret) {
	console.log('plain returned ', ret);	//for test-utils/sample-server.js server prints out: plain returned 41
});
//expose some for the server to call
rpc.expose({
	fnOnClient: function() {
		console.log('called client method');
		return 42;
	},
	asyncOnClient: function() {
		return new Promise(function(resolve, reject) {
			setTimeout(function(){
				resolve('resolved after 40ms');
			}, 40);
		});
	},
	erroringMethod: function() {
		notdefined.error.will.propagate;
	}
});

```

in the browser:
```javascript
var myChannel = require('rpc/test');   //CJS style require
//or
import {default as myChannel} from 'rpc/myChannel'; //ES6 style require

myChannel.getTime().then(t => { //calls getTime function on the server
    console.log("t", t);    //t is the serverside return value or serverside promise resolve value
});    
```

For complete examples including server side refer to [socket.io-rpc project](https://github.com/capaj/socket.io-rpc)

