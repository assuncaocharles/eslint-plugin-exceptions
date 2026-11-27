const path = require("path");
const { runCommand, parseJsonOutput } = require("./run");

const name = "ESLint";

/**
 * Convert `eslint --format json` output into normalized results:
 * [{ filePath, messages: [{ ruleId, message, severity, line, column }] }]
 * where `severity` is 1 (warning) or 2 (error).
 */
function parseResults(json, cwd) {
  if (!Array.isArray(json)) {
    return [];
  }

  return json.map((result) => ({
    filePath: path.resolve(cwd, result.filePath),
    messages: result.messages.map((m) => ({
      ruleId: m.ruleId || null,
      message: m.message,
      severity: m.severity === 2 ? 2 : 1,
      line: m.line,
      column: m.column,
    })),
  }));
}

async function run(targetPath, extraArgs = []) {
  const { stdout, stderr } = await runCommand(
    "eslint",
    [".", "--format", "json", ...extraArgs],
    {
      cwd: targetPath,
      // Report raw violations even if the exceptions processor is configured
      env: { ESLINT_EXCEPTIONS_DISABLE: "1" },
    }
  );

  const json = parseJsonOutput(stdout, name, stderr);
  return parseResults(json || [], targetPath);
}

module.exports = { name, run, parseResults };
