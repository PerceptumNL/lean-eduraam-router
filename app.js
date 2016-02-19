var express = require('express');
var request = require('request');
var app = express();

app.set('port', (process.env.PORT || 5000));

app.get('/http*', function (req, res) {
  var asset = decodeURIComponent(req.path.substring(1));
  request.get(asset).pipe(res);
});

app.listen(app.get('port'), function() {
	  console.log('Node app is running on port', app.get('port'));
});
