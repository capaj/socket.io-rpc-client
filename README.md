# socket.io-rpc-client
client library for a socket.io-rpc 

#Usage
```npm install socket.io-rpc-client```
then in Node.js:
```javascript
var backend = rpcClient('http://localhost:8031');

backend.loadChannel('./rpc_channel_test').then(function(chnl){
    //chnl contains your remote methods
})
```

For complete examples refer to [socket.io-rpc project](https://github.com/capaj/socket.io-rpc)

#Tests
so far only few e2e tests are implemented and they are a part of [socket.io-rpc project](https://github.com/capaj/socket.io-rpc)
