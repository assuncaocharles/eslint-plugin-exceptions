// Playground examples. Each one teaches one idea.

const legacyCode = `// A legacy module, written before the team turned on stricter rules.
var _cache = {};
var _hits = 0;

export function getUser(id) {
  if (_cache[id] == null) {
    console.log("cache miss", id);
    _cache[id] = fetchUser(id);
  }
  _hits++;
  return _cache[id];
}

function fetchUser(id) {
  return { id, name: "User " + id };
}
`;

const legacyRules = {
  "no-underscore-dangle": "error",
  "no-console": "warn",
  "no-var": "error",
  eqeqeq: "error",
};

const legacyApprovals = {
  eqeqeq: { "src/legacy/users.js": 1 },
  "no-console": { "src/legacy/users.js": 1 },
  "no-underscore-dangle": { "src/legacy/users.js": 2 },
  "no-var": { "src/legacy/users.js": 2 },
};

const json = (value) => JSON.stringify(value, null, 2) + "\n";

const EXAMPLES = [
  {
    id: "baseline",
    title: "Baseline: existing debt is approved",
    summary:
      "Every current violation is listed in approvals.json, so the check passes. This is the state right after running `npx eslint-exceptions`.",
    filePath: "src/legacy/users.js",
    code: legacyCode,
    rules: legacyRules,
    approvals: json(legacyApprovals),
  },
  {
    id: "new-violation",
    title: "A new violation slips in",
    summary:
      "Someone adds `_misses`. no-underscore-dangle now has 3 violations but only 2 are approved, so the extra one is reported, with a note saying how many were found and approved. The approved ones stay hidden.",
    filePath: "src/legacy/users.js",
    code: legacyCode
      .replace("var _hits = 0;", "var _hits = 0;\nlet _misses = 0;")
      .replace('    console.log("cache miss", id);', '    console.log("cache miss", id);\n    _misses++;'),
    rules: legacyRules,
    approvals: json(legacyApprovals),
  },
  {
    id: "new-rule",
    title: "A rule that isn't approved",
    summary:
      "prefer-const was turned on after approvals.json was generated. It has no entry for this file, so all of its violations are reported, while the approved rules stay quiet.",
    filePath: "src/legacy/users.js",
    code: legacyCode.replace(
      "export function getUser(id) {",
      "let defaultTtl = 60;\n\nexport function getUser(id, ttl = defaultTtl) {"
    ),
    rules: { ...legacyRules, "prefer-const": "error" },
    approvals: json(legacyApprovals),
  },
  {
    id: "paid-down",
    title: "Debt paid down: lower the counts",
    summary:
      "The vars became const and console.log is gone, so approvals.json is now higher than needed. The check still passes, but suggests lowering the counts. Turn on Strict to fail, as you would in CI, then click “Approve current violations”.",
    filePath: "src/legacy/users.js",
    code: legacyCode
      .replace("var _cache = {};\nvar _hits = 0;", "const _cache = {};\nlet _hits = 0;")
      .replace('    console.log("cache miss", id);\n', ""),
    rules: legacyRules,
    approvals: json(legacyApprovals),
  },
  {
    id: "paths",
    title: "Paths are relative to approvals.json",
    summary:
      "The file moved from src/legacy/users.js to src/users.js, but approvals.json still uses the old path. Nothing matches, so every violation is reported. Fix the path in approvals.json, or change the file path above, to see it pass again.",
    filePath: "src/users.js",
    code: legacyCode,
    rules: legacyRules,
    approvals: json(legacyApprovals),
  },
  {
    id: "fresh",
    title: "Start from scratch",
    summary:
      "No approvals.json yet, so every violation is reported. Click “Approve current violations” to generate one, as the CLI would.",
    filePath: "src/app.js",
    code: `export function total(items) {
  var sum = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].price != undefined) sum += items[i].price;
  }
  debugger;
  return sum;
}
`,
    rules: {
      "no-var": "error",
      eqeqeq: "error",
      "no-debugger": "error",
      curly: "warn",
    },
    approvals: "",
  },
];

module.exports = { EXAMPLES };
