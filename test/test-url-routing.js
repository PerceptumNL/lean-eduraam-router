var assert = require('assert');
var router = require('../lib/router.js');

describe('Routing urls', function(){
  it('should route a valid hostname through the router', function(done){
    conf = {
      router_protocol: 'https',
      app_protocol: 'https',
      routed_app_host: '73747564696f2e636f64652e6f7267.router.local',
      app_host: 'studio.code.org',
      router_base_domain: 'router.local',
      token: 'special-token',
      whitelist_frame_ancestors: '*.codecult.local:*'
    };

    assert.equal(
      router.get_routed_url('https://studio.code.org', conf),
      "https://73747564696f2e636f64652e6f7267.router.local/?token=special-token"
    );
    done();
  });

  it('should route a valid url through the router', function(done){
    conf = {
      router_protocol: 'https',
      app_protocol: 'https',
      routed_app_host: '73747564696f2e636f64652e6f7267.router.local',
      app_host: 'studio.code.org',
      router_base_domain: 'router.local',
      token: 'special-token',
      whitelist_frame_ancestors: '*.codecult.local:*'
    };

    assert.equal(
      router.get_routed_url('https://studio.code.org/users/edit', conf),
      "https://73747564696f2e636f64652e6f7267.router.local/users/edit?token=special-token"
    );
    done();
  });
});
