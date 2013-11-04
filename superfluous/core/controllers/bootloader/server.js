var fs = require("fs");
var _ = require_vendor("underscore");
var template = require_core("server/template");
var page = require_core("server/page");
var context = require_core("server/context");
var packager = require_core("server/packager");
var Component = require_core("server/component");
var async = require("async");
var readfile = require_core("server/readfile");

function multi_pack(dir, extension, prepack) {
  return function() {
    var req = context("req");
    var res = context("res");

    var loaded = {};
    var modules = JSON.parse(req.query.m);

    async.each(modules, function(module, done) {
      var filename = dir + "/" + module;

      // Does an unwind and prepack, technically
      if (prepack) {
        prepack([filename], function(data) {
          if (_.isObject(data)) {
            _.each(data, function(v, k) {
              loaded[k] = v;
            });
          } else if (_.isString(data)) {
            loaded[module] = data;
          }

          done();
        });

      } else {
        fs.readFile(filename + "." + extension, function(err, data) {
          if (err) {
            data = template.render_core("helpers/missing_resource.html.erb", {
              name: module,
              file: filename,
              extension: extension
            });

          } else {
            data = data.toString();
          }

          loaded[module] = data;
          done();
        });

      }

    }, function resolution(err) {
      res.set("Content-Type", "application/json");
      res.write(JSON.stringify(loaded));
      res.end();
    });
  };
}

var js = multi_pack("", "js", packager.js);
var css = multi_pack("app/static/styles", "css", packager.less);


var js_prelude = function() {
  // Shrink wrap the prelude files
  var req = context("req");
  var res = context("res");

  var data = readfile("core/client/prelude.json");

  data = JSON.parse(data);
  res.set("Content-Type", "text/javascript");


  var contents = {};

  // The files need to be ordered properly
  async.each(data.vendor.concat(data.files),
    function(item, cb) {
      fs.readFile(item, function(err, data) {
        if (err) {
          console.log("ERROR READING", item);
          return cb();
        }

        var ret = data.toString();
        contents[item] = ret;

        cb();
      });
    },
    function(err) {
      _.each(data.vendor.concat(data.files), function(file) {
        res.write(contents[file]);
      });
      res.end();
    });
};

var css_prelude = function() {
  var req = context("req");
  var res = context("res");
  var ctx = context.get();

  // Shrink wrap the prelude files
  var data = readfile("core/client/prelude.json");

  data = JSON.parse(data);
  res.set("Content-Type", "text/css");

  async.each(
    data.styles,
    function(file, cb) {
      fs.readFile(file, function(err, data) {
        if (!err) {
          res.write(data.toString());
        } else {
          console.log("Error reading", file);
        }
      cb();
      });
    },
    function(err) { res.end(); });
}

var component = function() {
  var req = context("req");
  var res = context("res");

  var loaded = {};

  var modules = JSON.parse(req.query.m);
  async.each(
    modules, 
    function(module, cb) {
      Component.build_package(module, function(ret) {
       loaded[module] = ret;
       cb();
      });
    }, function(err, results) {
      res.set("Content-Type", "application/json");

      res.end(JSON.stringify(loaded));
    });
}

module.exports = {
  js: js,
  css: css,
  js_prelude: js_prelude,
  css_prelude: css_prelude,
  component: component,

  routes: {
    "/css" : "css",
    "/js" : "js",
    "/component" : "component",
    "/prelude.js" : "js_prelude",
    "/prelude.css" : "css_prelude"
  }
}
