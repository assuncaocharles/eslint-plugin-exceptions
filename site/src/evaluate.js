// Playground logic, without any DOM code so it can be tested in Node.
// Lints with ESLint's Linter (browser build) and applies approvals with the
// package's own code from src/core.

const { applyApprovals } = require("../../src/core/apply");
const { getAllowedExceptions } = require("../../src/core/allowed");

/** Core ESLint rules offered in the playground. */
const RULES = [
  { id: "no-underscore-dangle", description: "Disallow dangling underscores in identifiers" },
  { id: "no-console", description: "Disallow console.* calls" },
  { id: "no-var", description: "Require let or const instead of var" },
  { id: "eqeqeq", description: "Require === and !==" },
  { id: "prefer-const", description: "Require const for variables never reassigned" },
  { id: "no-unused-vars", description: "Disallow unused variables" },
  { id: "no-debugger", description: "Disallow debugger statements" },
  { id: "no-eval", description: "Disallow eval()" },
  { id: "no-empty", description: "Disallow empty blocks" },
  { id: "curly", description: "Require braces around all control statements" },
];

const SEVERITY = { off: 0, warn: 1, error: 2 };

/** Display code for a rule, as each linter prints it. */
function ruleLabel(ruleId, linter) {
  if (!ruleId) return "";
  return linter === "oxlint" ? `eslint(${ruleId})` : ruleId;
}

function parseApprovals(text) {
  if (!text.trim()) return { approvals: {}, error: null };
  try {
    const approvals = JSON.parse(text);
    if (!approvals || typeof approvals !== "object" || Array.isArray(approvals)) {
      return { approvals: null, error: "approvals.json must be an object of rules" };
    }
    for (const [rule, files] of Object.entries(approvals)) {
      if (!files || typeof files !== "object" || Array.isArray(files)) {
        return { approvals: null, error: `"${rule}" must map file paths to counts` };
      }
      for (const [file, count] of Object.entries(files)) {
        if (!Number.isInteger(count) || count < 0) {
          return {
            approvals: null,
            error: `"${rule}" → "${file}" must be a whole number, got ${JSON.stringify(count)}`,
          };
        }
      }
    }
    return { approvals, error: null };
  } catch (e) {
    return { approvals: null, error: `Invalid JSON: ${e.message}` };
  }
}

function normalizePath(filePath) {
  return (filePath || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * @param {object} input
 * @param {import("eslint").Linter} input.linter   ESLint Linter instance
 * @param {string} input.code
 * @param {string} input.filePath     Path relative to approvals.json
 * @param {string} input.approvalsText
 * @param {Record<string, "off"|"warn"|"error">} input.rules
 * @param {"eslint"|"oxlint"} input.view
 * @param {boolean} [input.strict]
 */
function evaluate({ linter, code, filePath, approvalsText, rules, view, strict = false }) {
  const relativePath = normalizePath(filePath) || "file.js";
  const ruleConfig = {};
  for (const [id, level] of Object.entries(rules)) {
    if (SEVERITY[level]) ruleConfig[id] = level;
  }

  const raw = linter
    .verify(code, [
      {
        files: ["**/*.js"],
        languageOptions: { ecmaVersion: "latest", sourceType: "module" },
        rules: ruleConfig,
      },
    ], { filename: relativePath.endsWith(".js") ? relativePath : `${relativePath}.js` })
    .map((m, index) => ({
      index,
      ruleId: m.ruleId || null,
      message: m.message,
      severity: m.severity,
      line: m.line,
      column: m.column,
      endLine: m.endLine,
      endColumn: m.endColumn,
      fatal: Boolean(m.fatal),
    }));

  const { approvals, error: approvalsError } = parseApprovals(approvalsText);
  const effectiveApprovals = approvals || {};

  const reported = applyApprovals(raw, effectiveApprovals, relativePath);
  const reportedIndexes = new Set(reported.map((m) => m.index));
  const approved = raw.filter((m) => !reportedIndexes.has(m.index));

  // Per-rule summary for every rule that has violations or approvals here
  const found = new Map();
  for (const m of raw) {
    if (m.ruleId) found.set(m.ruleId, (found.get(m.ruleId) || 0) + 1);
  }
  const ruleIds = new Set(found.keys());
  for (const [ruleId, files] of Object.entries(effectiveApprovals)) {
    if (typeof files[relativePath] === "number") ruleIds.add(ruleId);
  }

  const perRule = [...ruleIds].sort().map((ruleId) => {
    const count = found.get(ruleId) || 0;
    const allowed = getAllowedExceptions(effectiveApprovals, ruleId, relativePath);
    let status = "ok";
    if (count > allowed) status = allowed === 0 ? "unapproved" : "over";
    else if (count < allowed) status = "stale";
    return { ruleId, found: count, approved: allowed, status };
  });

  const stale = perRule.filter((r) => r.status === "stale");
  const otherFiles = new Set();
  for (const files of Object.values(effectiveApprovals)) {
    for (const file of Object.keys(files)) {
      if (normalizePath(file) !== relativePath) otherFiles.add(file);
    }
  }

  const errors = reported.filter((m) => m.severity === 2).length;
  const warnings = reported.length - errors;
  const exitCode = errors > 0 || (strict && stale.length > 0) ? 1 : 0;

  return {
    relativePath,
    approvalsError,
    raw,
    reported,
    approved,
    perRule,
    stale,
    otherFiles: [...otherFiles].sort(),
    errors,
    warnings,
    exitCode,
    cli: cliOutput({ view, relativePath, reported, stale, errors, warnings, strict, exitCode }),
  };
}

function cliOutput({ view, relativePath, reported, stale, errors, warnings, strict, exitCode }) {
  const lines = [];
  const command =
    view === "oxlint" ? "npx eslint-exceptions check --linter oxlint" : "npx eslint-exceptions check --linter eslint";
  lines.push({ kind: "prompt", text: `$ ${command}${strict ? " --strict" : ""}` });
  lines.push({ kind: "dim", text: "" });
  lines.push({ kind: "dim", text: `🔍 Running ${view === "oxlint" ? "oxlint" : "ESLint"} on .../project...` });

  if (reported.length) {
    lines.push({ kind: "dim", text: "" });
    lines.push({ kind: "file", text: relativePath });
    for (const m of reported) {
      const location = `${m.line || 0}:${m.column || 0}`.padEnd(8);
      const level = (m.severity === 2 ? "error" : "warning").padEnd(8);
      lines.push({
        kind: m.severity === 2 ? "error" : "warning",
        text: `  ${location}${level}${m.message}  ${ruleLabel(m.ruleId, "eslint")}`,
      });
    }
  }

  if (stale.length) {
    lines.push({ kind: "dim", text: "" });
    lines.push({ kind: strict ? "error" : "hint", text: `${strict ? "❌" : "💡"} ${stale.length} approval(s) can be lowered:` });
    for (const s of stale) {
      lines.push({ kind: "dim", text: `   ${s.ruleId}  ${relativePath}: ${s.approved} approved, ${s.found} found` });
    }
  }

  lines.push({ kind: "dim", text: "" });
  if (errors === 0 && warnings === 0) {
    lines.push({ kind: "success", text: `✨ ${view === "oxlint" ? "oxlint" : "ESLint"}: no unapproved violations.` });
  } else {
    lines.push({
      kind: "error",
      text: `✖ ${errors + warnings} unapproved problem(s) (${errors} error(s), ${warnings} warning(s))`,
    });
  }
  lines.push({ kind: exitCode ? "error" : "success", text: `exit code ${exitCode}` });
  return lines;
}

/**
 * approvals.json with this file's counts set to the current violations,
 * keeping entries for other files. Mirrors `eslint-exceptions --merge`
 * but also lowers this file's counts.
 */
function approveCurrent(result, approvalsText) {
  const { approvals } = parseApprovals(approvalsText);
  const next = {};
  for (const [ruleId, files] of Object.entries(approvals || {})) {
    for (const [file, count] of Object.entries(files)) {
      if (normalizePath(file) === result.relativePath) continue;
      next[ruleId] = next[ruleId] || {};
      next[ruleId][file] = count;
    }
  }
  for (const m of result.raw) {
    if (!m.ruleId) continue;
    next[m.ruleId] = next[m.ruleId] || {};
    next[m.ruleId][result.relativePath] = (next[m.ruleId][result.relativePath] || 0) + 1;
  }

  const sorted = {};
  for (const ruleId of Object.keys(next).sort()) {
    sorted[ruleId] = {};
    for (const file of Object.keys(next[ruleId]).sort()) {
      sorted[ruleId][file] = next[ruleId][file];
    }
  }
  return JSON.stringify(sorted, null, 2) + "\n";
}

module.exports = { RULES, evaluate, approveCurrent, parseApprovals, ruleLabel };
