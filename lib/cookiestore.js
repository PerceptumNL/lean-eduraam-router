var MongoClient = require('mongodb').MongoClient;
var requester = require('request');
var tough = require('tough-cookie');

/************
 * Settings *
 ***********/
// DEBUG: show token and cookiejar operations
const D_TOKEN_CJ = (process.env.DEBUG_TOKEN_COOKIEJAR == '1');

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

/**
 * Utility function to get the cookiejar linked to the token.
 * @param {string} token The token that the cookiejar is linked to.
 * @param {function} callback The callback function to retrieve the cookiejar
 * or {null} when non-existant, will be called with the {RequestJar} instance.
 * @param {function} [error_callback] Optional callback function that is called
 * when an error occurs.
 **/
function get_cookiejar_by_token(token, callback, error_callback){
  var cookiejar = requester.jar(new tough.MemoryCookieStore);
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

exports.set_by_token = set_cookiejar_by_token;
exports.get_by_token = get_cookiejar_by_token;
