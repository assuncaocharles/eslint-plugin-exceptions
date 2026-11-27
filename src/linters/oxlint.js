const path = require("path");
const { runCommand, parseJsonOutput } = require("./run");
const { normalizeRuleId } = require("../core/rule-ids");

const name = "oxlint";

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
