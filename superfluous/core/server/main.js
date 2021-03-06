"use strict";

var globals = require("./globals");
globals.install();

// vendor
var connect = require('connect');
var http = require('http');

// setup the main server app
var app, router;

// setup() fills these in
var http_server,
    https_server;

var app_name;

require("longjohn");
function setup() {
  // setup helpers
  var config = require_core("server/config");
  var hooks = require_core("server/hooks");

  var socket = require_core("server/socket");
  var package_json = require_core("../package.json");
  app_name = package_json.name;

  app = connect();
  router = app;


  // this is here for the reversable router which uses .locals
  app.locals = {};

  // Opportunity for Authorization and other stuff
  var main = require_app("main");
  hooks.set_main(main);

  hooks.setup("query", app, function(app) {
    app.use(connect.query());
  });

  http_server = http.createServer(app);

  // Setup an HTTPS server
  var auth = require_core("server/auth");
  https_server = auth.setup_ssl_server(router);

  http.globalAgent.maxSockets = config.max_http_sockets;

  // Add timestamps
  require("./console").install();

  hooks.setup("error_handling", app, function(app) {
    // setup error handling
    //var errorHandlers = require_core("server/error_handlers");
    //app.use(errorHandlers.default);
    app.use(connect.errorHandler({ dumpExceptions: true, showStack: true }));
  });

  // Setting up some cookie parsing goodness
  hooks.setup("cookies", app, function() {
    app.use(connect.cookieParser());
  });

  // This is where the persistance store is created
  hooks.setup("store", app, function(app) {
    var store = require("./store");
    store.install(app);
  });

  hooks.setup("db", app, function() { });

  // This is where the session is created
  hooks.setup("session", app, function(app) {
    var session = require("./session");
    session.install(app);
  });

  hooks.setup("redirect", app, function(app) {
    var redirect = require('response-redirect');
    app.use(function(req, res, next) {
      res.redirect = redirect;
      next();
    });
  });

  hooks.setup("app", app, function() { });

  hooks.setup("compression", app, function(app) {
    app.use(connect.compress());
  });

  hooks.setup("packager", app, function() { });

  hooks.setup("realtime", app, http_server, function(app, http_server) {
    socket.setup_io(app, http_server);
  });

  hooks.setup("marshalls", app, function() {
    require_core("server/component").install_marshalls();
    require_core("server/backbone").install_marshalls();
  });

  hooks.setup("trust_proxy", app, function(app) {
    app.use(function(req, res, next) {
      req.url = req.uri.path;

      function extract(value) {
        if (value) {
          return last(value.split(',')).trim().toLowerCase();
        }
      }
      function last(arr) { return arr[arr.length - 1]; }

      try {
        req.connection.remoteAddress = extract(req['X-Forwarded-For']) || req.connection.remoteAddress;
        req.proto = extract(req['X-Forwarded-Proto']) || 'http';
        req.secure = req.proto === 'https';
      } catch(e) {};

      next();
    });

  });

  hooks.setup("routes", app, function() {
    var router = require('./router');
    router.install(app);
  });

  hooks.setup("cache", app, function(app) {
    // setup static helpers
    var oneDay = 1000 * 60 * 60 * 24;
    var oneYear = oneDay * 365;
    var st = require('st');
    var options = {
      index: false, // return 404's for directories
      dot: false, // default: return 403 for any url with a dot-file part
      passthrough: true, // calls next/returns instead of returning a 404 error
    };

    app.use(st( _.extend({ path: 'app/static',  maxAge: oneYear, url: '/' }, options)));
    app.use(st(_.extend({ path: 'core/static',  maxAge: oneYear, url: '/' }, options)));

    // For all the self-contained controllers, setup their static asset endpoints, too
    var controllers = require_core("server/route_collector").get_packaged_controllers();
    _.each(controllers, function(controller) {
      var controller_path = 'app/controllers/' + controller + '/static';
      app.use(st(_.extend({
        path: controller_path,
        maxAge: oneYear, url: '/' }, options)));
    });
  });


  var when_ready = function() {
    hooks.setup("http_server", http_server, function() {
      var http_port = config.http_port;
      http_server.listen(http_port);
      http_server.on('error', try_restart(http_server, http_port));

      console.log("Listening for HTTP connections on port", http_port);
    });

    hooks.setup("https_server", https_server, function() {
      var https_port = config.https_port;
      // Setting up SSL server
      if (https_server && https_port) {
        console.log("Listening for HTTPS connections on port", https_port);
        hooks.setup("realtime", app, https_server, function(app, https_server) {
          socket.setup_io(app, https_server);
        });

        https_server.listen(https_port);
        https_server.on('error', try_restart(https_server, https_port));
      }
    });
    // End SSL Server
  };

  when_ready = _.once(when_ready);
  hooks.setup("ready", when_ready, function(when_ready) {
    when_ready();
  });
}

function try_restart(server, port) {
  var retries = 0;

  return function(e) {
    if (e.code === 'EADDRINUSE') {
      console.log('Port', port, 'in use, retrying...');
      setTimeout(function () {
        try { server.close(); } catch(e) {}

        if (retries > 5) {
          console.log("Couldn't listen on port", port, ", exiting.");
          process.exit();
        }

        retries += 1;
        server.listen(port);
      }, 2000);
    }
  };
}

// Expose the test helper?
module.exports = {
  name: app_name,
  app: app,
  run: function() {
    setup();


  },
  test_helper: require_core("server/test_helper")
};
