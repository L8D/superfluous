/**
 * The routes module is responsible for calling a route in a controller. It is
 * the entry point for all route handling on the server and is where the
 * context is created.
 *
 * @class routes (server)
 * @module Superfluous
 * @submodule Server
 */

"use strict";

var context = require("./context");
var page = require("./page");
var route_collector = require("./route_collector");
var socket = require("./socket");
var hooks = require("./hooks");

var readfile = require("./readfile");

var _ = require_vendor("underscore");


// Read the routes in from an external file
// TODO: make this more automagic
var Controllers = JSON.parse(readfile("routes.json"));

var routes = route_collector.collect(Controllers);

var install_socket = function(io) {
  socket.install(io, Controllers);
};

var template = require_core("server/template");
var bridge = require_core("server/bridge");
var readfile = require_core("server/readfile");

var API = {
  bridge: bridge,
  page: page,
  template: template,
  readfile: readfile,
  inspect: function() {
    return "API: " + _.keys(API).sort().join(", ");
  }
};

_.each(API, function(v, k) {
  v.inspect = function() {
    return k + ":" + _.keys(v).sort().join(",");
  };
});

var zlib = require("zlib");
function request_handler_factory(app, route, handler, name) {
  return function handle_req(req, res) {
    var stream = zlib.createGzip();
    stream._flush = zlib.Z_SYNC_FLUSH;
    stream.pipe(res);

    hooks.invoke("setup_request_ip", req, function() {
      var ip = req.headers['x-forwarded-for'] || 
        req.connection.remoteAddress || 
        req.socket.remoteAddress ||
        req.connection.socket.remoteAddress;

      req.ip = ip;
    });

    hooks.invoke("setup_request", req, res, function() { 
      context.create(
        {
          req: req,
          res: res,
          route_name: name,
          stream: stream,
          app: app,
          router: app.router },
        function(ctx) {
          hooks.invoke("setup_context", ctx, function() { 
            page.emit("start", {
              route: route
            });

            debug("Starting request", ctx.id, ctx.req.url.pathname);
            res.set("Transfer-Encoding", "chunked");

            handler(ctx, API);

            page.emit("main_duration");
            debug("Ending main request", ctx.id, ctx.req.uri.pathname);
            // Nulling out context after request is over
            ctx.exit();
          });
      });
    });
  };
}

var setup = function(app) {
  var Router = require('reversable-router');
  var router = new Router();
  router.extendExpress(app);
  router.registerAppHelpers(app);

  app.router = router;

  _.each(routes, function(route_data) {
    var type = route_data.method || 'get';
    var handler = route_data.handler;
    var route = route_data.route;
    var name = route_data.name;

    if (!app[type]) {
      console.log("Route", route_data.route, "has an invalid method");
      return;
    }


    router.add(type, route, request_handler_factory(app, route, handler, name), {
      name: name
    });
  });

  var named_routes = _.map(router.routesByNameAndMethod, function(v, k) {
    var type = v.get || v.post;
    return [k, type.path];
  });

  console.log("Routes:\n", named_routes);
  app.use(function(req, res, next) {
    // pretend we are expressive
    req.path = req.uri.pathname;
    res.set = res.setHeader;

    router.dispatch(req, res, next);
  });
};

module.exports = {
  install: setup,
  socket: install_socket,
  API: API
};
