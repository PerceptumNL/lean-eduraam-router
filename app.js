var express = require('express');
var compress = require('compression');

var router = require('./lib/router.js');

/**********************************
 * Setting up express application *
 *********************************/

var app = express();
var port = (process.env.PORT || 5000)

app.use(compress());

app.get('/code.org/*', function(request, response){
  if(request.headers.host == ("localhost:"+port)){
    console.log("Testing shortcut");
    request.headers.host = "73747564696f2e636f64652e6f7267.codecult.nl";
    request.originalUrl = request.originalUrl.substring(9);
    router.route_request(request, response);
  }else{
    console.log('Testing shortcut found in wild: ', request.headers.host);
    router.route_request(request, response);
  }
});

app.all('*', router.route_request);

app.listen(port, function() {
	console.log('Router is running on port', port);
});

if(require.main !== module){
  module.exports = app;
}
