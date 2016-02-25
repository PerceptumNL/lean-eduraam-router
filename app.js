var express = require('express');
var compress = require('compression');

var router = require('./lib/router.js');

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
  router.route_request(request, response);
});

app.all('*', router.route_request);

app.listen(app.get('port'), function() {
	console.log('Router is running on port', app.get('port'));
});

if(require.main !== module){
  module.exports = app;
}
