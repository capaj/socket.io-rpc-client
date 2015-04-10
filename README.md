# socket.io-rpc-client
client library for a socket.io-rpc 

All libraries are written in commonJS module style, so you need to use SystemJS loader to be able to use them in the browser. Browserify might work(except loading the files themselves) if you set it up correctly, but might be a pain to set up.
Angular.js lib contains special rpc-controller directive, which when compiled asynchronously loads server channel and instantiates classic angular controller when this channel is ready.
#Usage
```npm install socket.io-rpc-client```  for serverside usage
```jspm install socket.io-rpc-client``` for clientside usage
then in Node.js:
```javascript
var backend = rpcClient('http://localhost:8031');

backend.loadChannel('./rpc_channel_test').then(function(chnl){
    //chnl contains your remote methods
})
```

in the browser:
```javascript
var myChannel = require('rpc/myChannel');   //CJS style require
import {default as myChannel} from 'rpc/myChannel'; //ES6 style require

myChannel.getTime().then(t => { //calls getTime function on the server
    console.log("t", t);    //t is the serverside return value or serverside promise resolve value
});    
```
For the browser, don't forget to map your socket.io-client in your jspm config.js file:
"socket.io-client": "/socket.io/socket.io",

For complete examples refer to [socket.io-rpc project](https://github.com/capaj/socket.io-rpc)

#Tests
so far only few e2e tests are implemented and they are a part of [socket.io-rpc project](https://github.com/capaj/socket.io-rpc)
