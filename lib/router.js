var requester = require('request');
var URI = require('urijs');
var cookiestore = require('./cookiestore');
var transformers = require('./transformers');

/************
 * Settings *
 ***********/

// DEBUG: show the altered request headers send to the app
const D_REQ_HDRS = (process.env.DEBUG_REQUEST_HEADERS == '1');
// DEBUG: show the altered response headers send to the browser
const D_RES_HDRS = (process.env.DEBUG_RESPONSE_HEADERS == '1');
// DEBUG: show the incoming request (METHOD + PATH)
const D_INC_REQ = true || (process.env.DEBUG_INCOMING_REQUEST == '1');
// DEBUG: show the configuration object created for this request
const D_CONF = (process.env.DEBUG_CONFIGURATION == '1');
// DEBUG: load request debugger
const D_REQUEST_ALL = (process.env.DEBUG_REQUEST_ALL == '1');
// The default HTTP protocol for communication with the app
const DEFAULT_APP_PROTOCOL = (process.env.DEFAULT_APP_PROTOCOL || 'https');
// The default HTTP protocol for communication with the router
const ROUTER_PROTOCOL = (process.env.ROUTER_PROTOCOL || 'http');
// The default domain (excluding subdomain) of the router (for routing urls)
const ROUTER_BASE_DOMAIN = (process.env.ROUTER_BASE_DOMAIN || 'codecult.local');
// The default external port of the router (set to 80 for default environments)
const ROUTER_BASE_PORT = (process.env.ROUTER_BASE_PORT || '5000');
// The domain string to add to the frame-ancestors part of the CSP header
const CSP_WHITELIST_FRAME_ANCESTORS = (
  process.env.CSP_WHITELIST_FRAME_ANCESTORS || "*.codecult.local:*");
// String to insert before the head closing tag
const INSERT_IN_HEAD = process.env.INSERT_STRING_IN_HEAD || (
    "<script>"+
    "document.domain=\"codecult.local\";"+
    "if(window.parent && window.parent.window.activateAppAdaptor){"+
    "window.parent.window.activateAppAdaptor(window); }"+
    "</script>");
// List of domains that can be routed
const ROUTING_DOMAIN_WHITELIST = {
  "mock": 1,
  "code.org": 1,
  "scratch.mit.edu": 1,
  "google-analytics.com": 1,
  "google.com": 1};

if(D_REQUEST_ALL){
  require('request-debug')(requester);
}

/*****************************
 * Setting up Router helpers *
 *****************************/

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


/**
 * Utility function to rewrite url to go through router
 * @param {string} url The url to rewrite
 * @param {Object} conf Configuration object for this interaction.
 **/
function get_routed_url(url, conf, ignoreToken){
  var parsed_url = new URI(url);
  var parsed_host = parsed_url.host();
  if( !parsed_host ){
    parsed_url.host(conf.routed_app_host);
  }

  if( check_domain_suffix(parsed_host) ){
    parsed_url
      .scheme(conf.router_protocol)
      .domain(conf.router_base_domain)
      .subdomain(Buffer(parsed_host).toString('hex'));

    if( ROUTER_BASE_PORT && ROUTER_BASE_PORT != 80 ){
      parsed_url.port(ROUTER_BASE_PORT)
    }
  }

  if( conf.token && !ignoreToken ){
    parsed_url.addQuery('token', conf.token);
  }

  return parsed_url.toString();
}

/**
 * Utility function to rewrite url to go to app
 * @param {string} url The url to rewrite
 * @param {Object} conf Configuration object for this interaction.
 **/
function get_unrouted_url(url, conf){
  var parsed_url = new URI(url);
  if( !parsed_url.host() ){ return url; }

  if( parsed_url.host() === conf.routed_app_host ){
    return parsed_url
      .scheme(conf.app_protocol)
      .host(conf.app_host)
      .removeQuery('token')
      .toString();
  }

  var unhashed_host = Buffer(parsed_url.host(), 'hex').toString();
  if( check_domain_suffix(unhashed_host) ){
    return parsed_url
      .scheme(conf.app_protocol)
      .host(unhashed_host)
      .removeQuery('token')
      .toString();
  }

  return url;
}

/**
 * Return the (altered) HTTP headers to send to the app
 * @param req The original request sent by the browser
 * @param {Object} conf Configuration object for this interaction.
 **/
function alter_request_headers(req, conf){
  var altered_headers = {}
  var ignore_list = ["host", "connection", "cookie", "accept-encoding", "x-request-start", "x-request-id"];
  for(var key in req.headers){
    if(ignore_list.indexOf(key.toLowerCase()) != -1){
      continue;
    } else if(["referer","referrer","origin"].indexOf(key.toLowerCase()) != -1){
      try {
        altered_headers[key] = get_unrouted_url(req.headers[key], conf);
      } catch(err) {
        continue;
      }
    } else if(key.toLowerCase() === "upgrade-insecure-requests"){
      if( conf.router_protocol === "https" ){
        altered_headers[key] = req.headers[key];
      }else{
        continue
      }
    } else if(key.toLowerCase() === "x-forwarded-proto"){
      altered_headers[key] = DEFAULT_APP_PROTOCOL;
    } else if(key.toLowerCase() === "x-forwarded-port"){
      altered_headers[key] = (DEFAULT_APP_PROTOCOL === 'https'? '443' : '80' );
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
  var altered_headers = {}
  for(var key in res.headers){
    if(key.toLowerCase() == "location"){
      altered_headers[key] = get_routed_url(res.headers[key], conf);
    } else if(key.toLowerCase() == "set-cookie"){
      if(conf.cpeek){
        var match = RegExp('([^=]+)=([^;]+)').exec(res.headers[key])
        if(conf.cpeek.indexOf(match[1]) > -1){
          altered_headers['X-Cookie-Peek'] = match[2];
        }
      }
    } else if(key.toLowerCase() == "x-frame-options"){
      continue;
    } else if(key.toLowerCase() == "x-xss-protection"){
      continue;
    } else if(key.toLowerCase() === "content-security-policy"){
      if( conf.router_protocol === "https" ){
        // If the router uses a secure protocol, then we only need to cover
        // the frame-ancestors directive.
        altered_headers[key] = res.headers[key].replace(
          "frame-ancestors", "frame-ancestors " + conf.whitelist_frame_ancestors);
      } else {
        altered_headers[key] = res.headers[key].replace(
          "frame-ancestors", "frame-ancestors " + conf.whitelist_frame_ancestors)
          .replace(/https:;/gm, "http: https:;").replace(/https: /gm, "http: https: ");
      }
    } else {
      altered_headers[key] = res.headers[key];
    }
  }
  D_RES_HDRS && console.log("Setting response headers to:");
  D_RES_HDRS && console.log(altered_headers);
  return altered_headers;
}

/**
 * Return if the response contains a html content type header.
 * @param response Response object as returned by {requester}
 **/
function is_html_response(response){
  var ct_header = response.caseless.has('content-type');
  return (!ct_header ? -1 : response.headers[ct_header].indexOf('html')) != -1;
}

function route_request(request, response){
  try {
    var hostname_parts = request.headers.host.split(".");
    var hex_subdomain = new Buffer(hostname_parts[0], "hex");
    var app_host = hex_subdomain.toString()
  } catch(err) {
    D_INC_REQ &&
      console.log("Error on "+request.headers.host+" ("+app_host+")");
    response.status(400).end();
    return;
  }

  // Check if the routed domain is in the whitelist
  if (!check_domain_suffix(app_host)){
    D_INC_REQ &&
      console.log("Bouncing "+request.headers.host+" ("+app_host+")");
    response.status(403).end();
    return;
  }

  D_INC_REQ && console.log(
    'incoming request: '+request.method+' '+app_host+request.originalUrl);

  var conf = {
    'router_protocol': ROUTER_PROTOCOL,
    'app_protocol': DEFAULT_APP_PROTOCOL,
    'routed_app_host': request.headers.host,
    'app_host': app_host,
    'router_base_domain': ROUTER_BASE_DOMAIN,
    'whitelist_frame_ancestors': CSP_WHITELIST_FRAME_ANCESTORS,
    'token': null,
    'cpeek': null
  };

  if( 'cpeek' in request.query ){
    if ( request.query.cpeek instanceof Array ){
      conf.cpeek = request.query.cpeek;
    } else {
      conf.cpeek = [request.query.cpeek];
    }
    delete request.query.cpeek;
  }

  if( 'token' in request.query ){
    // TODO: Also accept token from HTTP Referer?
    conf.token = request.query.token;
    if ( conf.token instanceof Array ){
      // This should not happen, but it could if multiple token params are given
      conf.token = conf.token[0];
    }
    // TODO: Only delete token if app doesn't require it in the parameters.
    delete request.query.token;
    cookiestore.get_by_token(conf.token, function(cookiejar){
      execute_route_request(request, response, conf, cookiejar);
    });
  } else {
    execute_route_request(request, response, conf);
  }

  D_CONF && console.log("CONF", conf);
}

function execute_route_request(request, response, conf, cookiejar){
  // Proxying the request, while altering the headers
  var remote_request = requester({
    method: request.method,
    uri: conf.app_protocol+"://"+conf.app_host+request.path,
    qs: request.query,
    headers: alter_request_headers(request, conf),
    jar: cookiejar,
    followRedirect: false
  });
  request.pipe(remote_request);
  remote_request.on('response', function(remote_response){
    response.status(remote_response.statusCode);
    if(conf.token){
      // TODO: Only update cookiejar when changes happened.
      setImmediate(function(token, cookiejar){
        cookiestore.set_by_token(token, cookiejar);
      }, conf.token, cookiejar);
    }
    var headers = alter_response_headers(remote_response, conf)
    if( is_html_response(remote_response) && INSERT_IN_HEAD.length > 0){
      var body_transform = transformers.Insert(
        INSERT_IN_HEAD, 'before', '</head>');
      var replaceStream = require('replacestream');
      var url_transform = replaceStream(
        /(https?:)?\/\/([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?/gm,
        function(url){ return get_routed_url(url, conf, true); }
      );
      delete headers['content-length'] && delete headers['Content-Length'];
      remote_response.pipe(body_transform).pipe(url_transform).pipe(response);
    }else if( request.path === "/crossdomain.xml"){
      var crossdomain_inject = (
          '\t\n<allow-http-request-headers-from domain="*' +
      //    conf.router_base_domain +
          '" headers="*"/>\t\n<allow-access-from domain="*' +
//          conf.router_base_domain+
          '" to-ports="*" secure="false"/>');
      var crossdomain_transform = transformers.Insert(
        crossdomain_inject, 'after', '<cross-domain-policy>');
      delete headers['content-length'] && delete headers['Content-Length'];
      remote_response.pipe(crossdomain_transform).pipe(response);
    }else{
      remote_response.pipe(response);
    }
    response.set(headers);
  });
}

exports.route_request = route_request;
exports.get_routed_url = get_routed_url;
exports.get_unrouted_url = get_unrouted_url;
exports.is_html_response = is_html_response;
exports.check_domain_suffix = check_domain_suffix;
exports.alter_request_headers = alter_request_headers;
exports.alter_response_headers = alter_response_headers;
