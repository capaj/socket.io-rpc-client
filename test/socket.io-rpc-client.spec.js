require('chai').should();
var rpcClient = require('../client');
var cp = require('child_process');
var Promise = require('bluebird');
var server = cp.fork('./test-utils/sample-server.js');
var rpc = rpcClient('http://localhost:8031');

describe('initialization', function() {
	it('trying to fetch node on a wrong port should reject the promise', function() {
		this.timeout(8000);

		var failingRPC = rpcClient('http://localhost:8666');
		return failingRPC.fetchNode('test')
			.then(function() {
				throw new Error('this should not happen');	//do you have some RPC server running on 8666?
			}, function(err) {
				err.message.should.equal('xhr poll error');
			});
	});
});

describe("simple tree of remote methods", function(){

	this.timeout(10000);
	var remoteMethods;
	before(function() {
		return rpc.fetchNode('test')
			.then(function(chnl) {
				remoteMethods = chnl;
			}, function(err) {
				throw err;
			});
	});

	it('should have 3 methods on that node', function(){
		(typeof remoteMethods.failingMethod).should.equal('function');
		(typeof remoteMethods.myAsyncTest).should.equal('function');
		(typeof remoteMethods.getTime).should.equal('function');
	});

	it('should reject when trying to fetch a node which does not exist', function() {
		return rpc.fetchNode('weDidNotDefineIt').then(function() {
			throw new Error('This should not have resolved');
		}, function(err) {
			err.message.should.equal('Node is not defined on the backend');
			err.path.should.equal('weDidNotDefineIt');
		})
	});

	it('should reject a promise returned by calling a failingMethod', function(done){
		remoteMethods.failingMethod().catch(function(err) {
			err.message.should.eql('Sample error');
			done();
		});
	});

	it('should properly call and return when called as a string path', function(){
	    return Promise.all([
			rpc('plain')().then(function(num) {
				num.should.equal(41);
			}),
			rpc('test.myAsyncTest')('myParam').then(function (ret){
				ret.should.equal('String generated asynchronously serverside with myParam');
			})
		]);

	});

	it('should properly call and return when fetches a root node and calls a function there', function(){
		return rpc.fetchNode('')
			.then(function(remoteMethods) {
				return remoteMethods.plain().then(function (ret){
					ret.should.equal(41);
				});
			}, function(err) {
				throw err;
			});
	});

	it('should reject when remote function doesn\'t exist', function() {
		return rpc('weDidNotDefineIt')().then(function() {
			throw new Error('This should not have resolved');
		}, function(err) {
			err.message.should.equal('function is not exposed: weDidNotDefineIt');
		});
	});

	it('server methods should no longer be callable after client disconnects', function(done) {
		server.kill();

		rpc('plain')().then(function() {
			throw new Error('This should not have resolved');
		}, function(err) {
			err.message.should.match(/server (.*) disconnected before returning, call rejected/);
			done();
		});
		setTimeout(function(){
			rpc('fnOnClient')().then(function() {
				throw new Error('This should not have resolved');
			}, function(err) {
				err.message.should.match(/server (.*) disconnected, call rejected/);
				done();
			});
		}, 100);
	});
});