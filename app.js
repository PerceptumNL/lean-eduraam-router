var express = require('express');
var request = require('request');
var app = express();

app.set('port', (process.env.PORT || 5000));

app.get('^/:asset(http*)\.:ext$', function (req, res) {
  var asset = decodeURIComponent(req.params.asset)+'.'+req.params.ext;
  console.log(asset)
  resource = request.get(asset).pipe(res);
  resource.on('response', function(response) {
    response.headers['Cache-Control'] = 'max-age=3600, public';
  });
});

app.listen(app.get('port'), function() {
	  console.log('Node app is running on port', app.get('port'));
});
