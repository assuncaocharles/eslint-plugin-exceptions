const path = require("path");
const { runCommand, parseJsonOutput } = require("./run");

const name = "oxlint";

// Oxlint reports rules as `plugin(rule)`. These are mapped to the rule IDs
// ESLint uses, so the same approvals.json works with both linters.
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

/**
 * Convert `oxlint --format json` output into normalized results:
 * [{ filePath, messages: [{ ruleId, message, severity, line, column }] }]
 */
function parseResults(json, cwd) {
  const diagnostics = (json && json.diagnostics) || [];
  const byFile = new Map();

  for (const d of diagnostics) {
    const filePath = path.resolve(cwd, d.filename);
    if (!byFile.has(filePath)) {
      byFile.set(filePath, []);
    }

    const span = (d.labels && d.labels[0] && d.labels[0].span) || {};
    byFile.get(filePath).push({
      ruleId: normalizeRuleId(d.code),
      message: d.message,
      severity: d.severity === "error" ? 2 : 1,
      line: span.line,
      column: span.column,
    });
  }

  return [...byFile].map(([filePath, messages]) => ({ filePath, messages }));
}

async function run(targetPath, extraArgs = []) {
  const { stdout, stderr } = await runCommand(
    "oxlint",
    ["--format", "json", ...extraArgs, "."],
    { cwd: targetPath }
  );

  const json = parseJsonOutput(stdout, name, stderr);
  return parseResults(json, targetPath);
}

module.exports = { name, run, parseResults, normalizeRuleId };
