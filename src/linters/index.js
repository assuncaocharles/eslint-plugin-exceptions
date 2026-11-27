const fs = require("fs");
const path = require("path");

const linters = {
  eslint: require("./eslint"),
  oxlint: require("./oxlint"),
};

const OXLINT_CONFIGS = [".oxlintrc.json", "oxlintrc.json"];
const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
];

function findUp(startDir, filenames) {
  let dir = startDir;
  while (true) {
    if (filenames.some((f) => fs.existsSync(path.join(dir, f)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Pick a linter for `targetPath`: oxlint if the nearest config is an oxlint
 * config (closer than any ESLint config), otherwise ESLint.
 */
function detectLinter(targetPath) {
  const oxDir = findUp(targetPath, OXLINT_CONFIGS);
  const esDir = findUp(targetPath, ESLINT_CONFIGS);

  if (oxDir && (!esDir || oxDir.length > esDir.length)) {
    return "oxlint";
  }
  return "eslint";
}

function getLinter(id) {
  const linter = linters[id];
  if (!linter) {
    throw new Error(
      `Unknown linter "${id}". Use one of: ${Object.keys(linters).join(", ")}`
    );
  }
  return linter;
}

module.exports = { linters, getLinter, detectLinter };
