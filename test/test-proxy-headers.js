var assert = require('assert');
var client = require('supertest')
var Mitm = require("mitm")

var router = require('../app.js');
var routerlib = require('../lib/router.js');

const CSP = [
    "default-src 'self' https:; script-src 'self'",
    "https: 'unsafe-inline' 'unsafe-eval'; style-src",
    "'self' https: 'unsafe-inline'; img-src 'self'",
    "https: data: blob:; font-src 'self' https: data:;",
    "connect-src 'self' https: https://app.domain.org",
    "wss://ws.app.domain.org; report-uri app.domain.org/mixed;",
    "frame-ancestors 'self' app.domain.org"].join(" ");
const CSP_routed = [
    "default-src 'self' https:; script-src 'self'",
    "https: 'unsafe-inline' 'unsafe-eval'; style-src",
    "'self' https: 'unsafe-inline'; img-src 'self'",
    "https: data: blob:; font-src 'self' https: data:;",
    "connect-src 'self' https: https://app.domain.org",
    "wss://ws.app.domain.org; report-uri app.domain.org/mixed;",
    "frame-ancestors *.codecult.local:* 'self' app.domain.org"].join(" ");

const CSP_http_routed = [
    "default-src 'self' http: https:; script-src 'self'",
    "http: https: 'unsafe-inline' 'unsafe-eval'; style-src",
    "'self' http: https: 'unsafe-inline'; img-src 'self'",
    "http: https: data: blob:; font-src 'self' http: https: data:;",
    "connect-src 'self' http: https: https://app.domain.org",
    "wss://ws.app.domain.org; report-uri app.domain.org/mixed;",
    "frame-ancestors *.codecult.local:* 'self' app.domain.org"].join(" ");

describe('Routing and changing headers', function(){
  var old_whitelist_frame_ancestors;
  var server;

  before(function(done){
    server = Mitm();
    server.on("connect", function(socket, opts) {
      if (opts.host == "127.0.0.1") socket.bypass();
    })

    server.on("request", function(req, res) {
      if(req.url == "/csp-lc"){
        res.statusCode = 200;
        res.setHeader('content-security-policy', CSP);
        req.pipe(res);
      }else if(req.url == "/csp-uc"){
        res.statusCode = 200;
        res.setHeader('Content-Security-Policy', CSP);
        req.pipe(res);
      }else{
        res.statusCode = 404;
        res.end();
      }
    });
    done();
  });

  it('should honor response status codes', function(done){
    client(router)
      .get('/not-found')
      .set('Host', "6d6f636b.router.local")
      .expect(404)
      .end(function(err, res){
        if(err) done(err);
        else done();
      });
  });

  it('should rewrite lower-case csp header', function(done){
    // Mock conf
    var conf = {
      router_protocol: 'https',
      app_protocol: 'https',
      routed_app_host: "6d6f636b.router.local",
      app_host: "mock",
      router_base_domain: 'router.local',
      whitelist_frame_ancestors: '*.codecult.local:*',
      token: 'special-token',
    };

    // Mock req;
    var res = {};
    res.headers = {
      'content-security-policy': CSP
    };

    altered_headers = routerlib.alter_response_headers(res, conf);
    csp_header = altered_headers['content-security-policy'] ||
      altered_headers['Content-Security-Policy'];
    assert.equal(csp_header, CSP_routed);
    done();
  });

  it('should rewrite upper-case csp header', function(done){
    // Mock conf
    var conf = {
      router_protocol: 'https',
      app_protocol: 'https',
      routed_app_host: "6d6f636b.router.local",
      app_host: "mock",
      router_base_domain: 'router.local',
      whitelist_frame_ancestors: '*.codecult.local:*',
      token: 'special-token',
    };

    // Mock req;
    var res = {};
    res.headers = {
      'Content-Security-Policy': CSP
    };

    altered_headers = routerlib.alter_response_headers(res, conf);
    csp_header = altered_headers['content-security-policy'] ||
      altered_headers['Content-Security-Policy'];
    assert.equal(csp_header, CSP_routed);
    done();
  });

  it('should rewrite lower-case csp header while routing', function(done){
    client(router)
      .get('/csp-lc')
      .set('Host', "6d6f636b.router.local")
      .expect(200)
      .expect('content-security-policy', CSP_http_routed)
      .end(function(err, res){
        if(err) done(err);
        else done();
      });
  });

  it('should rewrite upper-case csp header while routing', function(done){
    client(router)
      .get('/csp-uc')
      .set('Host', "6d6f636b.router.local")
      .expect(200)
      .expect('Content-Security-Policy', CSP_http_routed)
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
