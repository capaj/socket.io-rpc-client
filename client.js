require('error-tojson');

module.exports = function($rootScope, $log, $q) {
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
		var connected = false;
		var socket;
		var remoteNodes = {};
		var serverRunDate;  // used for invalidating the cache
		var serverRunDateDeferred = $q.defer();
		serverRunDateDeferred.promise.then(function(date) {
			serverRunDate = new Date(date);
		});

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
		 * @type {Object} fnTree object, a tree with functions as leaves
		 */
		rpc.tree = {};
		//These are internal callbacks of socket.io-rpc, use them if you want to implement something like a global loader indicator
		rpc.onBatchStarts = nop; //called when invocation counter equals 1
		rpc.onBatchEnd = nop;    //called when invocation counter equals endCounter
		rpc.onCall = nop;        //called when invocation counter equals endCounter
		rpc.onEnd = nop;         //called when one call is returned


		socket = io.connect(url + '/rpc', handshake)
			.on('serverRunDate', function(runDate) {
				serverRunDateDeferred.resolve(runDate);
				$rootScope.$apply();
			})
			.on('connect', function() {
				connected = true;
			})
			.on('fetchNode', function(path) {
				var methods = rpc.tree;
				if (path) {
					methods = traverse(rpc.tree).get(path.split('.'));
				}

				if (!methods) {
					socket.emit('noSuchNode', path);
					$log.error('client requested node ' + path + ' which was not found');
					return;
				}
				var localFnTree = traverse(methods).map(function(el) {
					if (this.isLeaf) {
						return null;
					} else {
						return el;
					}
				});

				socket.emit('node', {path: path, tree: localFnTree});
				$log.log('client requested node ' + path + 'which was sent as: ', localFnTree);
			})
			.on('node', function(data) {
				if (remoteNodes[data.path]) {
					var remoteMethods = traverse(data.tree).map(function(el) {
						if (this.isLeaf) {
							var path = this.path;
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
				if (data && data.Id) {
					deferreds[data.Id].reject(data.reason);
					//$log.error("Call " + name + ':' + data.Id + " is rejected, reason ", data.reason);

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
					dfd.reject(new Error('client ' + socket.id + ' disconnected before returning, call rejected'));
					remoteCallEnded(id);
				});
				$log.warn("RPC server " + url + " disconnected.");
			})
			.on('reconnect', function() {
				$log.info('reconnected rpc');
				//todo fetch all nodes
			})
			.on('call', function(data) {
				try {
					var method = traverse(rpc.tree).get(data.fnPath.split('.'));
				} catch (err) {
					$log.error('error when resolving an invocation', err);
				}
				if (!Number.isInteger(data.id)) {
					socket.emit('rpcError', {
						reason: new TypeError('id is a required property for a call, instead: ', data.id)
							.toJSON()
					});
				}
				if (method && typeof method.apply) {

					var retVal = method.apply(this, data.args);
					if (typeof retVal === 'object' && typeof retVal.then === 'function') {
						//async - promise must be returned in order to be treated as async
						retVal.then(function(asyncRetVal) {
							socket.emit('resolve', {Id: data.Id, value: asyncRetVal});
						}, function(error) {
							if (error instanceof Error) {
								error = error.toJSON();
							}
							socket.emit('reject', {Id: data.Id, reason: error});
						});
					} else {
						//synchronous
						if (retVal instanceof Error) {
							socket.emit('reject', {Id: data.Id, reason: retVal.toString()});
						} else {
							socket.emit('resolve', {Id: data.Id, value: retVal});
						}
					}

				} else {
					socket.emit('reject', {
						Id: data.Id,
						reason: 'no such function has been exposed: ' + data.fnName
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