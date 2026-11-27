import exceptions from "../src/index.js";

export default [
  {
    files: ["**/*.js"],
    plugins: {
      exceptions,
    },
    processor: "exceptions/passthrough",
    rules: {
      "no-underscore-dangle": "error",
      "no-console": "warn",
    },
  },
];

