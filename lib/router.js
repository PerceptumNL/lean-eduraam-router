var requests = require('request');
var tough = require('tough-cookie');
var urllib = require('url');
const util = require('util');
const Transform = require('stream').Transform;

var cookiestore = require('./cookiestore');

/************
 * Settings *
 ***********/

// DEBUG: show the altered request headers send to the app
const D_REQ_HDRS = (process.env.DEBUG_REQUEST_HEADERS == '1');
// DEBUG: show the altered response headers send to the browser
const D_RES_HDRS = (process.env.DEBUG_RESPONSE_HEADERS == '1');
// DEBUG: show the incoming request (METHOD + PATH)
const D_INC_REQ = (process.env.DEBUG_INCOMING_REQUEST == '1');
// DEBUG: show the configuration object created for this request
const D_CONF = (process.env.DEBUG_CONFIGURATION == '1');
// DEBUG: load request debugger
const D_REQUEST_ALL = (process.env.DEBUG_REQUEST_ALL == '1');
// The domain string to add to the frame-ancestors part of the CSP header
const ROUTER_PROTOCOL = (process.env.ROUTER_PROTOCOL || 'https');
// The domain string to add to the frame-ancestors part of the CSP header
const CSP_WHITELIST_FRAME_ANCESTORS = (
  process.env.CSP_WHITELIST_FRAME_ANCESTORS || "localhost");
// List of domains that can be routed
const ROUTING_DOMAIN_WHITELIST = {
  "mock": 1,
  "code.org": 1,
  "scratch.mit.edu": 1,
  "google-analytics.com": 1,
  "google.com": 1};

if(D_REQUEST_ALL){
  require('request-debug')(requests);
}

/*****************************
 * Setting up Router helpers *
 *****************************/

/**
 * Utility function to rewrite url to go through router
 * @param {string} url The url to rewrite
 * @param {Object} conf Configuration object for this interaction.
 **/
function get_routed_url(url, conf){
  return conf.router_base_url+urllib.parse(url).path;
}

/**
 * Utility function to rewrite url to go to app
 * @param {string} url The url to rewrite
 * @param {Object} conf Configuration object for this interaction.
 **/
function get_unrouted_url(url, conf){
  return conf.app_base_url+urllib.parse(url).path;
}

/**
 * Return the (altered) HTTP headers to send to the app
 * @param req The original request sent by the browser
 * @param {Object} conf Configuration object for this interaction.
 **/
function alter_request_headers(req, conf){
  var altered_headers = {}
  var ignore_list = ["host", "connection", "cookie", "accept-encoding"];
  for(var key in req.headers){
    if(ignore_list.indexOf(key.toLowerCase()) != -1){
      continue;
    } else if(["referer","referrer","origin"].indexOf(key.toLowerCase()) != -1){
      try {
        altered_headers[key] = get_unrouted_url(req.headers[key], conf);
      } catch(err) {
        continue;
      }
    } else {
      altered_headers[key] = req.headers[key];
    }
  }
  altered_headers['accept-encoding'] = "identity";
  D_REQ_HDRS && console.log("Setting request headers to:");
  D_REQ_HDRS && console.log(altered_headers);
  return altered_headers;
}

/**
 * Return the (altered) HTTP headers to send to the browser
 * @param req The original response sent by the app
 * @param {Object} conf Configuration object for this interaction.
 **/
function alter_response_headers(res, conf){
  altered_headers = {}
  for(var key in res.headers){
    if(key.toLowerCase() == "location"){
      altered_headers[key] = get_routed_url(res.headers[key], conf);
    } else if(key.toLowerCase() == "set-cookie"){
      continue;
    } else if(key.toLowerCase() == "x-frame-options"){
      continue;
    } else if(key.toLowerCase() == "content-security-policy"){
      altered_headers[key] = res.headers[key].replace(
        "frame-ancestors", "frame-ancestors " + conf.whitelist_frame_ancestors);
      continue
    } else {
      altered_headers[key] = res.headers[key];
    }
  }
  D_RES_HDRS && console.log("Setting response headers to:");
  D_RES_HDRS && console.log(altered_headers);
  return altered_headers;
}

util.inherits(PlaceDomainBodyTransform, Transform);
function PlaceDomainBodyTransform(domain_string, options) {
  if (!(this instanceof PlaceDomainBodyTransform))
    return new PlaceDomainBodyTransform(domain_string, options);

  options = options || {};
  options.decodeString = false;
  Transform.call(this, options);
  this._finished = false;
  this._lookout = Buffer('<head>');
  this._lookout_length = this._lookout.length;
  this._match_index = 0;
  this._domain_string = domain_string;
}

PlaceDomainBodyTransform.prototype._transform = function(chunk, encoding, done) {
  if (this._finished){
	  done(null, chunk);
  } else {
    for(var i = 0; i < chunk.length; i++){
      if(chunk[i] == this._lookout[this._match_index]){
        this._match_index++;
        if(this._match_index == this._lookout_length){
          this.push(chunk.slice(0,i+1));
          this.push(Buffer(
            "<script>document.domain=\""+this._domain_string+"\";</script>"));
          this.push(chunk.slice(i+1));
          done();
          return;
        }
      } else {
        this._match_index = 0;
      }
    }
    done(null, chunk);
  }
};

/**
 * Utility function to check if routed domain is whitelisted.
 * @param url The domain that the request needs to be routed to
 **/
function check_domain_suffix(domain){
  var spl = domain.split(".");
  for (var i = -2; i > -4; i--) {
    if (ROUTING_DOMAIN_WHITELIST[spl.slice(i).join(".")]){
      return true;
    }
  }
  return false;
}

function route_request(request, response){
  D_INC_REQ && console.log(
    'incoming request: '+request.method+' '+request.originalUrl);

  try {
    var hostname_parts = request.headers.host.split(".");
    var hex_subdomain = new Buffer(hostname_parts[0], "hex");
    var app_domain = hex_subdomain.toString()
  } catch(err) {
    response.status(400).end();
    return;
  }

  // Check if the routed domain is in the whitelist
  if (!check_domain_suffix(app_domain)){
    D_INC_REQ &&
      console.log("Bouncing "+request.headers.host+" ("+app_domain+")");
    response.status(403).end();
    return;
  }

  conf = {
    'router_base_url': ROUTER_PROTOCOL + "://" + request.headers.host,
    'root_domain': hostname_parts.slice(1).join("."),
    'app_base_url': "https" + "://" + app_domain,
    'whitelist_frame_ancestors': CSP_WHITELIST_FRAME_ANCESTORS
  };

  D_CONF && console.log("CONF", conf);

  if( 'token' in request.query ){
	D_TOKEN_CJ && console.log("Using cookiejar belonging to "+token);
    // TODO: Also accept token from HTTP Referer?
    var token = request.query.token;
    // TODO: Only delete token if app doesn't require it in the parameters.
    delete request.query.token;
    cookiestore.get_by_token(token, function(cookiejar){
      execute_route_request(request, response, conf, token, cookiejar);
    });
  } else {
    execute_route_request(request, response, conf);
  }
}

function execute_route_request(request, response, conf, token, cookiejar){
  // Proxying the request, while altering the headers
  var remote_request = requests({
    method: request.method,
    uri: conf.app_base_url+request.originalUrl,
    qs: request.query,
    headers: alter_request_headers(request, conf),
    jar: cookiejar,
  });
  var body_transform = PlaceDomainBodyTransform(conf.root_domain);
  request.pipe(remote_request);
  remote_request.on('response', function(remote_response){
    response.status(remote_response.statusCode);
    response.set(alter_response_headers(remote_response, conf));
    if(token){
      // TODO: Only update cookiejar when changes happened.
      setImmediate(function(token, cookiejar){
        cookiestore.set_by_token(token, cookiejar);
      }, token, cookiejar);
    }
    remote_response.pipe(body_transform).pipe(response);
  });
}

exports.route_request = route_request;
exports.check_domain_suffix = check_domain_suffix;
exports.alter_request_headers = alter_request_headers;
exports.alter_response_headers = alter_response_headers;
exports.PlaceDomainBodyTransform = PlaceDomainBodyTransform;
