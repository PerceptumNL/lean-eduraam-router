var assert = require('assert');
var client = require('supertest')
var Mitm = require("mitm")

var app = require('../app.js');
var router = app.express;

describe('Routing post request', function(){
  var server;

  before(function(done){
	server = Mitm();
    server.on("connect", function(socket, opts) {
      if (opts.host == "127.0.0.1"){
        console.log('Bypassing '+ opts.host);
        socket.bypass();
      }
    })

    server.on("request", function(req, res) {
      console.log('incoming request: '+req.url);
      if(req.url == "/echo"){
        res.statusCode = 200;
        req.pipe(res);
      }else{
        res.statusCode = 404;
        res.end();
      }
    });
    done();
  });

  it('should sent data through on post', function(done){
    client(router)
      .post('/echo')
      .set('Host', "6d6f636b.router.local")
      .send("foo=bar")
      .expect(200, 'foo=bar')
      .end(function(err, res){
        if(err) done(err);
        else done();
      });
  });

  after(function(done){
    server.disable();
    done();
  });
});
