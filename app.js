var express = require('express');
var requests = require('request');
var url = require('url');

/************
 * Settings *
 ***********/

// DEBUG: show the altered request headers send to the app
const D_REQ_HDRS = (process.env.DEBUG_REQUEST_HEADERS == '1');
// DEBUG: show the altered response headers send to the browser
const D_RES_HDRS = (process.env.DEBUG_RESPONSE_HEADERS == '1');
// DEBUG: show the incoming request (METHOD + PATH)
const D_INC_REQ = (process.env.DEBUG_INCOMING_REQUEST == '1');
// The domain string to add to the frame-ancestors part of the CSP header
const CSP_WHITELIST_FRAME_ANCESTORS = (
  process.env.CSP_WHITELIST_FRAME_ANCESTORS || "localhost");
// List of domains that can be routed
const ROUTING_DOMAIN_WHITELIST = {
    "code.org": 1,
    "scratch.mit.edu": 1,
    "google-analytics.com": 1,
    "google.com": 1};


/**
 * Utility function to rewrite url to go through router
 * @param {string} url The url to rewrite
 * @param {Object} conf Configuration object for this interaction.
 **/
function get_routed_url(url, conf){
  return conf.router_base_url+url.parse(url).path;
}

/**
 * Utility function to rewrite url to go to app
 * @param {string} url The url to rewrite
 * @param {Object} conf Configuration object for this interaction.
 **/
function get_unrouted_url(url, conf){
  return conf.app_base_url+url.parse(url).path;
}

/**
 * Return the (altered) HTTP headers to send to the app
 * @param req The original request sent by the browser
 * @param {Object} conf Configuration object for this interaction.
 **/
function alter_request_headers(req, conf){
  altered_headers = {}
  for(var key in req.headers){
    if(key == "host" || key == "connection"){
      continue;
    } else if(key == "cookie") { //TODO load server cookiejar
      continue;
    } else if(key == "referer"){
      try {
        altered_headers[key] = get_unrouted_url(req.headers[key], conf);
      } catch(err) {
        continue;
      }
    } else {
      altered_headers[key] = req.headers[key];
    }
  }
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
    if(key == "location"){
      altered_headers[key] = get_routed_url(res.headers[key], conf);
    } else if(key == "set-cookie"){ // TODO: update server cookiejar
      continue;
    } else if(key == "x-frame-options"){
      continue;
    } else if(key == "content-security-policy"){
      altered_headers[key] = res.headers[key].replace(
        "frame-ancestors", "frame-ancestors " + conf.whitelist_frame_ancestors);
    } else {
      altered_headers[key] = res.headers[key];
    }
  }
  D_RES_HDRS && console.log("Setting response headers to:");
  D_RES_HDRS && console.log(altered_headers);
  return altered_headers;
}

function check_domain_suffix(url){
  var hex = new Buffer(url.split(".")[0], "hex");
  var domain = hex.toString().split(".");
  for (var i = -1; i > -4; i--) {
    if (ROUTING_DOMAIN_WHITELIST[domain.slice(i).join(".")]){
      return true;
    }
  }
  return false;
}


/**********************************
 * Setting up express application *
 *********************************/

var app = express();
app.set('port', (process.env.PORT || 5000));

app.all('*', function(request, response){
  D_INC_REQ && console.log(
    'incoming request: '+request.method+' '+request.originalUrl);

  // Check if the routed domain is in the whitelist
  if (!check_domain_suffix(request.headers.host)){
    response.status(404).end();
  } else {
    conf = {
      'router_base_url': request.protocol + "://" + request.headers.host,
      //TODO: Retrieve app domain from AES encrypted subdomain
      'app_base_url': "https://studio.code.org",
      'whitelist_frame_ancestors': CSP_WHITELIST_FRAME_ANCESTORS
    };

    // Proxying the request, while altering the headers
    requests({
      method: request.method,
      uri: conf.app_base_url+request.originalUrl,
      headers: alter_request_headers(request, conf)
    }).on('response', function(remote_response){
      response.set(alter_response_headers(remote_response, conf));
    }).pipe(response);
  }
});

app.listen(app.get('port'), function() {
    console.log(process.env);
});
