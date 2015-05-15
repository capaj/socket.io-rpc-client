module.exports = function ($rootScope, $log, $q) {
	var nop = function(){};
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
		var clientChannels = {};
		var deferreds = [];
		var baseURL;
		var rpcMaster;
		var serverNodes = {};
		var serverRunDate;  // used for invalidating the cache
		var serverRunDateDeferred = $q.defer();
		serverRunDateDeferred.promise.then(function (date) {
			serverRunDate = new Date(date);
		});

		var callEnded = function (Id) {
			if (deferreds[Id]) {
				delete deferreds[Id];
				endCounter++;
				rpc.onEnd(endCounter);
				if (endCounter == invocationCounter) {
					rpc.onBatchEnd(endCounter);
					invocationCounter = 0;
					endCounter = 0;
				}
			}else {
				$log.warn("Deferred Id " + Id + " was resolved/rejected more than once, this should not occur.");
			}
		};

		/**
		 * Generates a 'safe' key for storing cache in client's local storage
		 * @param name
		 * @returns {string}
		 */
		function getCacheKey(name) {
			return 'SIORPC:' + baseURL + '/' + name;
		}

		function cacheIt(key, data) {
			try{
				localStorage[key] = JSON.stringify(data);
			}catch(e){
				$log.warn("Error raised when writing to local storage: " + e); // probably quota exceeded
			}
		}

		/**
		 * @param {String} path
		 * @param {Object} def
		 * @private
		 */
		var _fetchNode = function(path, def) {
			$log.info('path being fetched', path);
			serverNodes[path] = def;
			rpcMaster.emit('node', path);
		};

		function prepareRemoteCall(fnPath) {
			return function remoteCall() {
				var dfd = $q.defer();
				invocationCounter++;
				rpcMaster.emit('call',
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
		 * for a particular channel this will connect and prepare the channel for use, if called more than once for one
		 * channel, it will return it's promise
		 * @param {string} name
		 * @returns {Promise}
		 */
		rpc.fetchNode =
			function(path) {
				if (serverNodes.hasOwnProperty(path)) {
					return serverNodes[path].promise;
				} else {
					var def = $q.defer();
					_fetchNode(path, def);
					return def.promise;
				}
			},

		/**
		 * @param {string} name of the channel
		 * @param {Object} toExpose object, a tree with functions as leaves
		 * @returns {Promise} a promise confirming that server is connected and can call the client, throws an error if already exposed
		 */
			rpc.expose = function(name, toExpose) { //
				if (clientChannels.hasOwnProperty(name)) {
					throw new Error('Failed to expose channel, this client channel is already exposed');
				}

				var channel = {fns: toExpose, deferred: $q.defer(), rpcProps: {}};
				clientChannels[name] = channel;

				var fnNames = [];
				for (var fn in toExpose) {
					if (fn === '_socket') {
						throw new Error('Failed to expose channel, _socket property is reserved for socket namespace');
					}
					fnNames.push(fn);
				}
				var expose = function() {
					rpcMaster.emit('exposeChannel', {name: name, fns: fnNames});
				};

				if (rpcMaster.connected) {
					// when no on connect event will be fired, we just expose the channel immediately
					expose();
				}

				rpcMaster
					.on('disconnect', function() {
						channel.deferred = $q.defer();
					})
					.on('connect', expose)
					.on('reexposeChannels', expose);	//not sure if this will be needed, since simulating socket.io
				// reconnects is hard, leaving it here for now

				return channel.deferred.promise;
			},
			//These are internal callbacks of socket.io-rpc, use them if you want to implement something like a global loader indicator
			rpc.onBatchStarts = nop, //called when invocation counter equals 1
			rpc.onBatchEnd = nop,    //called when invocation counter equals endCounter
			rpc.onCall = nop,        //called when invocation counter equals endCounter
			rpc.onEnd = nop         //called when one call is returned


		baseURL = url;
		rpcMaster = io.connect(url + '/rpc', handshake)
			.on('serverRunDate', function (runDate) {
				serverRunDateDeferred.resolve(runDate);
				$rootScope.$apply();
			})
			.on('node', function (data){
				if (serverNodes[data.path]) {
					var remoteMethods = traverse(data.tree).map(function (el){
						if (this.isLeaf) {
							var path = this.path;
							if (data.path) {
								path = data.path + '.' + path;
							}

							this.update(prepareRemoteCall(path));
						}
					});
					var promise = serverNodes[data.path];
					serverNodes[data.path] = remoteMethods;
					promise.resolve(remoteMethods);
				} else {
					throw new Error("server sent a node which was not requested");
				}
			})
			.on('noSuchNode', function (path) {
				var promise = serverNodes[path];
				var err = new Error('Node is not defined on the backend');
				err.path = path;
				promise.reject(err);
			})
			.on('resolve', function (data) {
				deferreds[data.Id].resolve(data.value);
				callEnded(data.Id);
			})
			.on('reject', function (data) {
				if (data && data.Id) {
					deferreds[data.Id].reject(data.reason);
					//$log.error("Call " + name + ':' + data.Id + " is rejected, reason ", data.reason);

					callEnded(data.Id);
				} else {
					throw new Error("Reject response doesn't have a deferred with a matching id: ", data);
				}
			})
			.on('connect_error', function (err) {
				$log.error('unable to connect to server');
				for (var nodePath in serverNodes) {
					serverNodes[nodePath].reject(err)
				}
			})
			.on('disconnect', function (data) {
				reconDfd = $q.defer();
				rpcProps._connected = false;
				rpcProps._loadDef = reconDfd;
				$log.warn("Server channel " + name + " disconnected.");
			})
			.on('reconnect', function () {
				$log.info('reconnected rpc');
				//todo fetch all nodes
			})
			.on('clientChannelCreated', function (name) {

				var channel = clientChannels[name];
				var socket = io.connect(baseURL + '/rpcC-' + name + '/' + rpcMaster.io.engine.id);  //rpcC stands for rpc Client
				channel.rpcProps._socket = socket;
				socket.on('call', function (data) {
					var exposed = channel.fns;
					if (exposed.hasOwnProperty(data.fnName) && typeof exposed[data.fnName] === 'function') {

						var retVal = exposed[data.fnName].apply(this, data.args);
						if (typeof retVal === 'object' && typeof retVal.then === 'function') {
							//async - promise must be returned in order to be treated as async
							retVal.then(function (asyncRetVal) {
								socket.emit('resolve', { Id: data.Id, value: asyncRetVal });
							}, function (error) {
								if (error instanceof Error) {
									error = error.toString();
								}
								socket.emit('reject', { Id: data.Id, reason: error });
							});
						} else {
							//synchronous
							if (retVal instanceof Error) {
								socket.emit('reject', { Id: data.Id, reason: retVal.toString() });
							} else {
								socket.emit('resolve', { Id: data.Id, value: retVal });
							}
						}

					} else {
						socket.emit('reject', {Id: data.Id, reason: 'no such function has been exposed: ' + data.fnName });
					}
				});
				channel.deferred.resolve(channel);

			});
		rpc.masterChannel = rpcMaster;

		if (!RPCBackend.defaultBackend) {
			RPCBackend.defaultBackend = rpc;   //the first rpc connection is the default, if you want, you can set some other
		}

		backends[url] = rpc;
		return rpc;	//an instance of backend

	}

	return RPCBackend;	//backend constructor
};