var RPC = require('socket.io-rpc')
var express = require('express')
var port = 8031
var app = express()
var httpServer = require('http').Server(app)
var server = RPC(httpServer)
server.expose({
  test: require('./remote_methods'),
  plain: function () {
    return 41
  }
})

server.expose({
  test: {
    testFunc: function () {
      return 'second expose'
    }
  }
})

app.use(require('morgan')('dev'))
app.use(express.static(__dirname))

httpServer.listen(port, () => {
  console.log('list')
  process.send('initialized')
})
