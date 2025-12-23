import exceptions from "../src/index.js";

export default [
  {
    files: ["**/*.js"],
    plugins: {
      exceptions,
    },
    processor: "exceptions/.js",
    rules: {
      "no-underscore-dangle": "error",
      "no-console": "warn",
    },
  },
];

