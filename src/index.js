const processor = require("./processor");

const plugin = {
  meta: {
    name: "eslint-plugin-exceptions",
    version: "1.0.0",
  },

  processors: {
    passthrough: processor,
  },

  configs: {
    recommended: {
      plugins: {
        get exceptions() {
          return plugin;
        },
      },
      processor: "exceptions/passthrough",
    },
  },
};

module.exports = plugin;
