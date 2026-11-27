// Oxlint reports rules as `plugin(rule)`. These are mapped to the rule IDs
// ESLint uses, so the same approvals.json works with both linters.
// Browser-safe: no Node.js APIs.
const PLUGIN_PREFIXES = {
  eslint: "",
  typescript: "@typescript-eslint/",
  next: "@next/next/",
  nextjs: "@next/next/",
  node: "n/",
  react_perf: "react-perf/",
  jsx_a11y: "jsx-a11y/",
};

/**
 * Convert an oxlint diagnostic code to an ESLint-style rule ID.
 *   "eslint(no-console)"            -> "no-console"
 *   "typescript(no-explicit-any)"   -> "@typescript-eslint/no-explicit-any"
 *   "unicorn(no-array-reduce)"      -> "unicorn/no-array-reduce"
 *   "my-plugin(rule)" (JS plugin)   -> "my-plugin/rule"
 */
function normalizeRuleId(code) {
  if (!code) {
    return null;
  }

  const match = /^([^()]+)\((.+)\)$/.exec(code);
  if (!match) {
    return code;
  }

  const [, plugin, rule] = match;
  const prefix =
    plugin in PLUGIN_PREFIXES ? PLUGIN_PREFIXES[plugin] : `${plugin}/`;
  return `${prefix}${rule}`;
}

module.exports = { normalizeRuleId, PLUGIN_PREFIXES };
