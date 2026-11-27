const assert = require("assert");
const { Linter } = require("eslint-linter-browserify");
const { evaluate, approveCurrent, parseApprovals } = require("../site/src/evaluate");
const { EXAMPLES } = require("../site/src/examples");

const linter = new Linter();

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

function run(id, overrides = {}) {
  const example = EXAMPLES.find((e) => e.id === id);
  return evaluate({
    linter,
    code: example.code,
    filePath: example.filePath,
    approvalsText: example.approvals,
    rules: example.rules,
    view: "eslint",
    ...overrides,
  });
}

const reportedRules = (result) => result.reported.map((m) => m.ruleId);

console.log("\n=== Testing playground ===\n");

test("baseline: all violations approved, nothing stale", () => {
  const r = run("baseline");
  assert.deepStrictEqual(r.reported, []);
  assert.deepStrictEqual(r.stale, []);
  assert.strictEqual(r.approved.length, 6);
  assert.strictEqual(r.exitCode, 0);
});

test("new-violation: the extra underscore is reported with a note", () => {
  const r = run("new-violation");
  assert.deepStrictEqual(reportedRules(r), ["no-underscore-dangle"]);
  assert.match(r.reported[0].message, /3 violations found, but only 2 approved/);
  assert.strictEqual(r.exitCode, 1);
});

test("new-rule: only the unapproved rule is reported", () => {
  const r = run("new-rule");
  assert.deepStrictEqual(reportedRules(r), ["prefer-const"]);
  assert.strictEqual(r.perRule.find((x) => x.ruleId === "prefer-const").status, "unapproved");
});

test("paid-down: passes, suggests lower counts, fails in strict mode", () => {
  const r = run("paid-down");
  assert.deepStrictEqual(r.reported, []);
  assert.deepStrictEqual(
    r.stale.map((s) => [s.ruleId, s.found, s.approved]),
    [["no-console", 0, 1], ["no-var", 0, 2]]
  );
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(run("paid-down", { strict: true }).exitCode, 1);
});

test("paths: approvals for another path do not apply", () => {
  const r = run("paths");
  assert.strictEqual(r.reported.length, 6);
  assert.deepStrictEqual(r.otherFiles, ["src/legacy/users.js"]);
});

test("fresh: approve current violations makes the check pass", () => {
  const r = run("fresh");
  assert(r.reported.length > 0);
  const approvalsText = approveCurrent(r, "");
  const after = run("fresh", { approvalsText });
  assert.deepStrictEqual(after.reported, []);
  assert.strictEqual(after.exitCode, 0);
});

test("approveCurrent keeps other files and lowers this file", () => {
  const r = run("paid-down");
  const text = approveCurrent(
    r,
    JSON.stringify({ "no-var": { "src/legacy/users.js": 2, "src/other.js": 4 } })
  );
  const { approvals } = parseApprovals(text);
  assert.deepStrictEqual(approvals["no-var"], { "src/other.js": 4 });
  assert.strictEqual(approvals["no-underscore-dangle"]["src/legacy/users.js"], 2);
});

test("parseApprovals reports invalid input", () => {
  assert.match(parseApprovals("{").error, /Invalid JSON/);
  assert.match(parseApprovals("[]").error, /must be an object/);
  assert.match(parseApprovals('{"a": {"f.js": 1.5}}').error, /whole number/);
  assert.deepStrictEqual(parseApprovals("").approvals, {});
});

test("parsing errors are always reported", () => {
  const r = run("baseline", { code: "const = ;" });
  assert.strictEqual(r.reported.length, 1);
  assert.strictEqual(r.reported[0].ruleId, null);
});

test("oxlint view changes only the command shown", () => {
  const r = run("new-violation", { view: "oxlint" });
  assert.match(r.cli[0].text, /--linter oxlint/);
  assert.strictEqual(r.reported.length, 1);
});

console.log("\n=== Playground tests completed ===\n");
