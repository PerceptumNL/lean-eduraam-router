var express = require('express');
var compress = require('compression');
var requests = require('request');
var tough = require('tough-cookie');
var urllib = require('url');
var MongoClient = require('mongodb').MongoClient;
const util = require('util');
const Transform = require('stream').Transform;

/************
 * Settings *
 ***********/

// DEBUG: show the altered request headers send to the app
const D_REQ_HDRS = (process.env.DEBUG_REQUEST_HEADERS == '1');
// DEBUG: show the altered response headers send to the browser
const D_RES_HDRS = (process.env.DEBUG_RESPONSE_HEADERS == '1');
// DEBUG: show the incoming request (METHOD + PATH)
const D_INC_REQ = (process.env.DEBUG_INCOMING_REQUEST == '1');
// DEBUG: show token and cookiejar operations
const D_TOKEN_CJ = (process.env.DEBUG_TOKEN_COOKIEJAR == '1');
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

/*********************************
 * Initialize MongoDB connection *
 *********************************/
var mongodb_db;

var mongodb_uri = process.env.MONGOLAB_URI || process.env.MONGOHQ_URL || 'mongodb://localhost/Router';
MongoClient.connect(mongodb_uri, function(err, db) {
  mongodb_db = db;
  if(err){
      console.log("Could not connect to MongoDB");
      return;
  }
  console.log("MongoDB connection loaded");
});

/***************************
 * Router MongoDB wrappers *
 ***************************/

/**
 * MongoDB utility function to get the cookiejar linked to the token.
 * @param {string} token The token that the cookiejar is linked to.
 * @param {function} callback The callback function to retrieve the cookiejar
 * or {null} when non-existant, will be called with JSON serialized cookiejar.
 * @param {function} [error_callback] Optional callback function that is called
 * when an error occurs.
 **/
function mdb_get_cookiejar_by_token(token, callback, error_callback){
  if( !error_callback ) error_callback = function(){};
  try{
    if(!token || typeof(token) != "string") throw "Token is not a string";
    mongodb_db.collection('cookiejars').find({token: token}).limit(1).next(
      function(err, doc){
        if(err) throw err;
        callback( (doc ? doc.cookiejar: null ) );
      }
    );
  } catch (e) {
    console.log("MongDB Error while retrieving cookiejar: "+e);
    error_callback(e);
  }
}

/**
 * MongDB utility function to insert or update the cookiejar of a token.
 * @param {string} token The token that the cookiejar is linked to.
 * @param {string} cookiejar JSON serialized cookiejar.
 * @param {function} [callback] Optional callback function to retrieve the
 * result of the update.
 * @param {function} [error_callback] Optional callback function that is called
 * when an error occurs.
 **/
function mdb_set_cookiejar_by_token(token, cookiejar, callback, error_callback){
  if( !callback ) callback = function(){};
  if( !error_callback ) error_callback = function(){};
  try{
    if(!token || typeof(token) != "string") throw "Token is not a string";
    mongodb_db.collection('cookiejars').updateOne(
      { token:token },
      { $set: { 'cookiejar': cookiejar }, $setOnInsert: {'token': token } },
      { upsert: true },
      function(err, result){
        if(err) throw err;
        callback(result);
      }
    );
  } catch (e) {
    console.log("MongDB Error while retrieving cookiejar: "+e);
    error_callback(e);
  }
}

/*****************************
 * Setting up Router helpers *
 *****************************/

/**
 * Utility function to get the cookiejar linked to the token.
 * @param {string} token The token that the cookiejar is linked to.
 * @param {function} callback The callback function to retrieve the cookiejar
 * or {null} when non-existant, will be called with the {RequestJar} instance.
 * @param {function} [error_callback] Optional callback function that is called
 * when an error occurs.
 **/
function get_cookiejar_by_token(token, callback, error_callback){
  var cookiejar = requests.jar(new tough.MemoryCookieStore);
  mdb_get_cookiejar_by_token(token, function(cookiejar_json){
    if(cookiejar_json){
      D_TOKEN_CJ && console.log("Loading cookiejar") &&
        console.log(cookiejar_json);
      cookiejar._jar = tough.CookieJar.fromJSON(cookiejar_json);
    }
    callback(cookiejar);
  }, error_callback);
}

/**
 * Utility function to insert or update the cookiejar of a token.
 * @param {string} token The token that the cookiejar is linked to.
 * @param {RequestJar} cookiejar Cookiejar to insert or update.
 * @param {function} [callback] Optional callback function to retrieve the
 * result of the update.
 * @param {function} [error_callback] Optional callback function that is called
 * when an error occurs.
 **/
function set_cookiejar_by_token(token, cookiejar, callback, error_callback){
  var cookiejar_json = cookiejar._jar.toJSON();
  D_TOKEN_CJ && console.log("Storing cookiejar") && console.log(cookiejar_json);
  mdb_set_cookiejar_by_token(token, cookiejar_json,
      callback, error_callback);
}

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
    get_cookiejar_by_token(token, function(cookiejar){
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
        set_cookiejar_by_token(token, cookiejar);
      }, token, cookiejar);
    }
    remote_response.pipe(body_transform).pipe(response);
  });
}

/**********************************
 * Setting up express application *
 *********************************/

var app = express();
app.set('port', (process.env.PORT || 5000));

app.use(compress());

app.get('/test1', function(request, response){
  console.log("Testing shortcut");
  request.headers.host = "73747564696f2e636f64652e6f7267.codecult.nl";
  request.originalUrl = "/";
  route_request(request, response);
});

app.all('*', route_request);

app.listen(app.get('port'), function() {
	console.log('Router is running on port', app.get('port'));
});

if(require.main !== module){
  exports.route_request = route_request;
  exports.express = app;
  exports.check_domain_suffix = check_domain_suffix;
  exports.alter_request_headers = alter_request_headers;
  exports.alter_response_headers = alter_response_headers;
  exports.PlaceDomainBodyTransform = PlaceDomainBodyTransform;
}
