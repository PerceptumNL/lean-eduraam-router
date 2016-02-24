var assert = require('assert');
var client = require('supertest')
var server = require("mitm")();

var app = require('../app.js');
var router = app.route_request;

describe('Router', function(){
  before(function(done){
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

  it('should sent proxy form submits correctly', function(done){
    client(router)
      .post('/form')
      .set('Host', "6d6f636b.router.local")
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send("utf8=%E2%9C%93&authenticity_token=9%2F17oRKmo3SDyZY9k%2BTqaw%2FZkHKT9ZRn5%2FwvGNQ2pNM767zwFQ0%2Bu2lvmcEpgcG3If2qhls7emS9QT3jar9XIQ%3D%3D&user%5Bhashed_email%5D=02d4a1de011f974a4ef8d453380e9dd9&user%5Blogin%5D=&user%5Bpassword%5D=b%24%23a6QxGykXqfMRB9l9I&user%5Bremember_me%5D=0&commit=Sign+in")
      .expect(200, 'utf8=%E2%9C%93&authenticity_token=9%2F17oRKmo3SDyZY9k%2BTqaw%2FZkHKT9ZRn5%2FwvGNQ2pNM767zwFQ0%2Bu2lvmcEpgcG3If2qhls7emS9QT3jar9XIQ%3D%3D&user%5Bhashed_email%5D=02d4a1de011f974a4ef8d453380e9dd9&user%5Blogin%5D=&user%5Bpassword%5D=b%24%23a6QxGykXqfMRB9l9I&user%5Bremember_me%5D=0&commit=Sign+in')
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
