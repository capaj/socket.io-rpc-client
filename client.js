require('o.extend')

var socketHandlers = require('socket.io-rpc-event-handlers')
var io = require('socket.io-client')
var backends = {}

/**
 * pseudo constructor, connects to remote server which exposes RPC calls, if trying to connect to a backend, which
 * already exists, then existing instance is returned
 * @param {String} [url] to connect to, for example http://localhost:8080
 * @param {Object} [handshake] for global authorization, is passed to socket.io connect method
 * returns {Socket} master socket namespace which you can use for looking under the hood
 */
module.exports = function RPCBackend (url, handshake) {
  if (!url) {
    if (typeof location === 'object') {
      url = '//' + document.location.host // we run in the browser
    } else {
      throw new Error('For node.js, you always have to provide an url as first parameter')
    }
  }
  if (backends[url]) {
    return backends[url]
  }

  var socket = io.connect(url + '/rpc', handshake)
  var tree = {}
  socketHandlers(socket, tree, 'client')
  var rpc = socket.rpc
  /**
   * @param toExtendWith {Object}
   */
  rpc.expose = function (toExtendWith) {
    if (typeof toExtendWith !== 'object') {
      throw new TypeError('object expected as first argument')
    }
    Object.extend(tree, toExtendWith)
  }
  rpc.socket = socket

  backends[url] = rpc
  return rpc // an instance of backend
}
