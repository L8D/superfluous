/**
 * The router hooks up the routes on the server to the express app. It pull the
 * routes off the bootloader, as well as any controllers listed in routes.json
 * and creates their 'routes' and 'post_routes' handlers on behalf of the controller.
 *
 * @class router (server)
 * @module Superfluous
 * @submodule Server
 */

"use strict";

var _ = require_vendor("underscore");
var context = require("./context");
var load_controller = require("./controller").load;
var load_core_controller = require("./controller").core;
var readfile = require_core("server/readfile");
var component = require_core("server/component");

var path_ = require("path");

module.exports = {
  get_path: function(controller_name) {
    return this.paths[controller_name];
  },

  collect: function(controllers) {
    var config = require_core("server/config");
    // Takes an enumerable of controller names, loads the controllers and then
    // harvests their routes
    var routes = [];
    var self = this;
    self.paths = {};
    self.controllers = {};
    self.controller_apps = {};

    function add_core_controller(controller, name) {
      var inst = load_core_controller(controller);
      if (inst.is_package) {
        self.controller_apps[controller] = true;
        console.log("'" + controller + "' controller is packaged, adding it to static asset path");
        readfile.register_path(path_.join("core", "controllers", controller, "static"));
      }

      function run_route(handler) {
        return function() {
          context("controller", "bootloader");
          inst[handler].apply(inst, arguments);
        };
      }

      _.each(inst.routes, function(handler, subpath) {
        routes.push({
          route: path_.normalize("/" + name + "/" + subpath),
          method: "get",
          name: name + "." + handler,
          handler: run_route(handler)
        });
      });
    }

    add_core_controller("bootloader", "pkg");

    _.each(controllers, function(controller, path) {
      var inst = load_controller(controller);

      if (inst.is_package) {
        self.controller_apps[controller] = true;
        console.log("'" + controller + "' controller is packaged, adding it to static asset path");

        // TODO: move the path registration out of router. It seems like it belongs somewhere else
        readfile.register_path(path_.join("app", "controllers", controller, "static"));
        component.register_path(path_.join("app", "controllers", controller));
      }

      self.paths[controller] = path;
      self.controllers[path] = controller;

      function run_route(handler) {
        return function() {
          context("controller", controller);
          context("controller_path", path);

          inst[handler].apply(inst, arguments);
        };
      }

      _.each(inst.routes, function(handler, subpath) {
        var subberpath = path + subpath;

        routes.push({
          route: path_.normalize(subberpath),
          method: "get",
          name: controller + "." + handler,
          handler: run_route(handler)
        });
      });

      _.each(inst.post_routes, function(handler, subpath) {
        var subberpath = path + subpath;
        routes.push({
          route: path_.normalize(subberpath),
          method: "post",
          name: controller + "." + handler,
          handler: run_route(handler)
        });
      });
    });

    return routes;
  },
  get_packaged_controllers: function() {
    return _.keys(this.controller_apps);
  }

};
