var express = require('express');
var request = require('request');
var app = express();

app.get('/http*', function (req, res) {
  var asset = decodeURIComponent(req.path.substring(1));
  request.get(asset).pipe(res);
});

app.listen(3000, function () {
	  console.log('Example app listening on port 3000!');
});
