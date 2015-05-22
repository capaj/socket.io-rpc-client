require('error-tojson');

module.exports = function($log, $q) {
	var nop = function() {};
	var io = require('socket.io-client');
	var traverse = require('traverse');

	var backends = {};

	/**
	 * pseudo constructor, connects to remote server which exposes RPC calls, if trying to connect to a backend, which
	 * already exists, then existing instance is returned
	 * @param {String} [url] to connect to, for example http://localhost:8080
	 * @param {Object} [handshake] for global authorization, is passed to socket.io connect method
	 * returns {Socket} master socket namespace which you can use for looking under the hood
	 */
	function RPCBackend(url, handshake) {
		var assign = require('lodash.assign');
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
		var invocationCounter = 0;
		var endCounter = 0;
		var deferreds = [];
		var connected = true;	//so we assume that we are connected from the beginning, so that we can start to call remote immediatelly
		var socket;
		var remoteNodes = {};

		var remoteCallEnded = function(Id) {
			if (deferreds[Id]) {
				delete deferreds[Id];
				endCounter++;
				rpc.onEnd(endCounter);
				if (endCounter == invocationCounter) {
					rpc.onBatchEnd(endCounter);
					invocationCounter = 0;
					endCounter = 0;
				}
			} else {
				$log.warn("Deferred Id " + Id + " was resolved/rejected more than once, this should not occur.");
			}
		};

		/**
		 * @param {String} path
		 * @param {Object} def
		 * @private
		 */
		var _fetchNode = function(path, def) {
			$log.info('path being fetched', path);
			remoteNodes[path] = def;
			socket.emit('fetchNode', path);
		};

		function prepareRemoteCall(fnPath) {
			return function remoteCall() {
				var dfd = $q.defer();
				if (!connected) {
					dfd.reject(new Error('server disconnected, call rejected'));
					return dfd.promise;
				}
				invocationCounter++;
				socket.emit('call',
					{Id: invocationCounter, fnPath: fnPath, args: Array.prototype.slice.call(arguments, 0)}
				);
				if (invocationCounter == 1) {
					rpc.onBatchStarts(invocationCounter);
				}
				rpc.onCall(invocationCounter);
				deferreds[invocationCounter] = dfd;
				return dfd.promise;
			};
		}

		var rpc = prepareRemoteCall;

		/**
		 * this will connect and return a copy of a remote rpc function tree, if called more than once for one
		 * path, it will not call again and rather return cached promise
		 * @param {string} path
		 * @returns {Promise}
		 */
		rpc.fetchNode =	function(path) {
			if (remoteNodes.hasOwnProperty(path)) {
				return remoteNodes[path].promise;
			} else {
				var def = $q.defer();
				_fetchNode(path, def);
				return def.promise;
			}
		};

		/**
		 * @param {Object} toExtendWith
		 */
		rpc.expose = function(toExtendWith) {
			assign(rpc.tree, toExtendWith);
		};

		/**
		 * @type {Object} fnTree object, a tree with functions as leaves
		 */
		rpc.tree = {};
		//These are internal callbacks of socket.io-rpc, use them if you want to implement something like a global loader indicator
		rpc.onBatchStarts = nop; //called when invocation counter equals 1
		rpc.onBatchEnd = nop;    //called when invocation counter equals endCounter
		rpc.onCall = nop;        //called when invocation counter equals endCounter
		rpc.onEnd = nop;         //called when one call is returned
		var socketId;

		socket = io.connect(url + '/rpc', handshake)
			.on('connect', function() {
				socketId = socket.io.engine.id;
				connected = true;
			})
			.on('fetchNode', function(path) {
				var methods = rpc.tree;
				if (path) {
					methods = traverse(rpc.tree).get(path.split('.'));
				} else {
					methods = rpc.tree;
				}

				if (!methods) {
					socket.emit('noSuchNode', path);
					$log.error('client requested node "' + path + '" which was not found');
					return;
				}
				var localFnTree = traverse(methods).map(function(el) {
					if (this.isLeaf) {
						return null;
					} else {
						return el;
					}
				});

				$log.log('client requested node "' + path + '" which was sent as: ', localFnTree);
				socket.emit('node', {path: path, tree: localFnTree});
			})
			.on('node', function(data) {
				if (remoteNodes[data.path]) {
					var remoteMethods = traverse(data.tree).map(function(el) {
						if (this.isLeaf) {
							var path = this.path.join('.');
							if (data.path) {
								path = data.path + '.' + path;
							}

							this.update(prepareRemoteCall(path));
						}
					});
					var promise = remoteNodes[data.path];
					remoteNodes[data.path] = remoteMethods;
					promise.resolve(remoteMethods);
				} else {
					throw new Error("server sent a node which was not requested");
				}
			})
			.on('noSuchNode', function(path) {
				var promise = remoteNodes[path];
				var err = new Error('Node is not defined on the backend');
				err.path = path;
				promise.reject(err);
			})
			.on('resolve', function(data) {
				deferreds[data.Id].resolve(data.value);
				remoteCallEnded(data.Id);
			})
			.on('reject', function(data) {
				if (data && typeof data.Id === 'number') {
					var err = new Error();
					assign(err, data.reason);
					deferreds[data.Id].reject(err);
					remoteCallEnded(data.Id);
				} else {
					throw new Error("Reject response doesn't have a deferred with a matching id: ", data);
				}
			})
			.on('connect_error', function(err) {
				$log.error('unable to connect to server');
				for (var nodePath in remoteNodes) {
					remoteNodes[nodePath].reject(err)
				}
			})
			.on('disconnect', function() {
				connected = false;
				deferreds.forEach(function (dfd, id){
					dfd.reject(new Error('server ' + url + ' disconnected before returning, call rejected'));
					remoteCallEnded(id);
				});
				$log.warn("RPC server " + url + " disconnected.");
			})
			.on('reconnect', function() {
				$log.info('reconnected rpc');
				//todo fetch all nodes
			})
			.on('call', function(data) {
				if (!data && typeof data.Id === 'number') {
					return socket.emit('rpcError', {
						reason: new TypeError('id is a required property for a call, instead: ', data.id)
							.toJSON()
					});
				}
				var emitRes = function(type, resData) {
					resData.Id = data.Id;
					socket.emit(type, resData)
				};
				try {
					var method = traverse(rpc.tree).get(data.fnPath.split('.'));
				} catch (err) {
					$log.error('error when resolving an invocation', err);
					return emitRes('reject', {reason: err.toJSON()});
				}
				if (method && typeof method.apply) {
					var retVal;
					try{
						retVal = method.apply(this, data.args);
					}catch(err){
						emitRes('reject', {reason: err.toJSON()});
						return;
					}
					if (retVal instanceof Promise) {
						//async
						retVal.then(function(asyncRetVal) {
							emitRes('resolve', {value: asyncRetVal});
						}, function(error) {
							if (error instanceof Error) {
								error = error.toJSON();
							}
							emitRes('reject', {reason: error});
						});
					} else {
						//synchronous
						if (retVal instanceof Error) {
							emitRes('reject', {reason: retVal.toString()});
						} else {
							emitRes('resolve', {value: retVal});
						}
					}

				} else {
					var msg = 'function is not exposed: ' + data.fnPath;
					$log.error(msg);
					socket.emit('reject', {
						Id: data.Id,
						reason: new Error(msg).toJSON()
					});
				}
			});
		rpc.masterChannel = socket;

		if (!RPCBackend.defaultBackend) {
			RPCBackend.defaultBackend = rpc;   //the first rpc connection is the default, if you want, you can set some other
		}

		backends[url] = rpc;
		return rpc;	//an instance of backend

	}

	return RPCBackend;	//backend constructor
};