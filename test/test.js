const assert = require("assert");
const path = require("path");
const {
  getApprovalsForFile,
  getRelativePath,
  getAllowedExceptions,
  clearCache,
} = require("../src/utils/approvals-loader");
const processor = require("../src/processor");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");
const { applyApprovals } = require("../src/core/filter");
const { generateApprovals, mergeApprovals } = require("../src/core/approvals");
const oxlint = require("../src/linters/oxlint");
const eslint = require("../src/linters/eslint");
const { detectLinter } = require("../src/linters");
const { parseJsonOutput, findLocalBin } = require("../src/linters/run");
const { parseArgs, findStaleApprovals } = require("../src/cli");

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

clearCache();

console.log("\n=== Testing approvals-loader ===\n");

test("findApprovalsFile finds approvals.json in example directory", () => {
  const exampleFile = path.join(__dirname, "../example/src/utils.js");
  const { approvals, approvalsDir } = getApprovalsForFile(exampleFile);

  assert(approvals !== null, "Should find approvals");
  assert(approvalsDir !== null, "Should have approvalsDir");
  assert(
    approvals["no-underscore-dangle"],
    "Should have no-underscore-dangle rule"
  );
});

test("getRelativePath returns correct relative path", () => {
  const approvalsDir = path.join(__dirname, "../example");
  const filePath = path.join(__dirname, "../example/src/utils.js");

  const relative = getRelativePath(filePath, approvalsDir);
  assert(
    relative === "src/utils.js" || relative === "src\\utils.js",
    `Expected 'src/utils.js', got '${relative}'`
  );
});

test("getAllowedExceptions returns correct count", () => {
  const approvals = {
    "no-underscore-dangle": {
      "src/utils.js": 3,
      "src/other.js": 5,
    },
  };

  assert.strictEqual(
    getAllowedExceptions(approvals, "no-underscore-dangle", "src/utils.js"),
    3
  );
  assert.strictEqual(
    getAllowedExceptions(approvals, "no-underscore-dangle", "src/other.js"),
    5
  );
  assert.strictEqual(
    getAllowedExceptions(approvals, "no-underscore-dangle", "src/unknown.js"),
    0
  );
  assert.strictEqual(
    getAllowedExceptions(approvals, "unknown-rule", "src/utils.js"),
    0
  );
});

test("getAllowedExceptions handles null approvals", () => {
  assert.strictEqual(
    getAllowedExceptions(null, "some-rule", "some-file.js"),
    0
  );
});

console.log("\n=== Testing processor ===\n");

test("processor.preprocess returns source unchanged", () => {
  const source = "const x = 1;";
  const result = processor.preprocess(source, "test.tsx");

  assert(Array.isArray(result), "Should return array");
  assert.strictEqual(result.length, 1, "Should have one element");
  assert.strictEqual(result[0], source, "Source should be unchanged");
});

test("processor.postprocess filters approved violations", () => {
  const exampleFile = path.resolve(__dirname, "../example/src/utils.js");

  const messages = [
    [
      { ruleId: "no-underscore-dangle", message: "Violation 1", line: 1 },
      { ruleId: "no-underscore-dangle", message: "Violation 2", line: 2 },
      { ruleId: "no-underscore-dangle", message: "Violation 3", line: 3 },
    ],
  ];

  const result = processor.postprocess(messages, exampleFile);

  assert.strictEqual(
    result.length,
    0,
    `Expected 0 violations (3 approved), got ${result.length}`
  );
});

test("processor.postprocess handles ESLint processor suffix in filename", () => {
  const exampleFile = path.resolve(__dirname, "../example/src/utils.js");
  // When preprocess returns [text], ESLint appends "/0" to the filename
  const fileWithSuffix = exampleFile + "/0";

  const messages = [
    [
      { ruleId: "no-underscore-dangle", message: "Violation 1", line: 1 },
      { ruleId: "no-underscore-dangle", message: "Violation 2", line: 2 },
      { ruleId: "no-underscore-dangle", message: "Violation 3", line: 3 },
    ],
  ];

  const result = processor.postprocess(messages, fileWithSuffix);

  assert.strictEqual(
    result.length,
    0,
    `Expected 0 violations with suffix (3 approved), got ${result.length}`
  );
});

test("processor.postprocess reports excess violations", () => {
  const exampleFile = path.resolve(__dirname, "../example/src/utils.js");

  const messages = [
    [
      { ruleId: "no-underscore-dangle", message: "Violation 1", line: 1 },
      { ruleId: "no-underscore-dangle", message: "Violation 2", line: 2 },
      { ruleId: "no-underscore-dangle", message: "Violation 3", line: 3 },
      { ruleId: "no-underscore-dangle", message: "Violation 4", line: 4 },
      { ruleId: "no-underscore-dangle", message: "Violation 5", line: 5 },
    ],
  ];

  const result = processor.postprocess(messages, exampleFile);

  assert.strictEqual(
    result.length,
    2,
    `Expected 2 excess violations, got ${result.length}`
  );
  assert(
    result[0].message.includes("5 violations found"),
    "Should include violation count in message"
  );
});

test("processor.postprocess passes through unapproved files", () => {
  const unapprovedFile = path.resolve(__dirname, "../example/src/unknown.js");

  const messages = [
    [{ ruleId: "no-underscore-dangle", message: "Violation 1", line: 1 }],
  ];

  const result = processor.postprocess(messages, unapprovedFile);

  assert.strictEqual(
    result.length,
    1,
    "Should pass through all violations for unapproved files"
  );
});

test("processor.postprocess handles files without approvals.json", () => {
  const noApprovalsFile = "/some/random/path/file.js";

  const messages = [[{ ruleId: "some-rule", message: "Violation", line: 1 }]];

  const result = processor.postprocess(messages, noApprovalsFile);

  assert.strictEqual(
    result.length,
    1,
    "Should pass through all violations when no approvals.json"
  );
});

test("processor.postprocess preserves messages without ruleId", () => {
  const exampleFile = path.resolve(__dirname, "../example/src/utils.js");

  const messages = [
    [
      { message: "Parsing error", line: 1 },
      { ruleId: "no-underscore-dangle", message: "Violation 1", line: 2 },
    ],
  ];

  const result = processor.postprocess(messages, exampleFile);

  assert.strictEqual(result.length, 1, "Should keep parsing error");
  assert(!result[0].ruleId, "Kept message should be the parsing error");
});


test("processor.postprocess does not mutate input messages", () => {
  const exampleFile = path.resolve(__dirname, "../example/src/utils.js");
  const original = { ruleId: "no-underscore-dangle", message: "V4", line: 4 };
  const messages = [
    [
      { ruleId: "no-underscore-dangle", message: "V1", line: 1 },
      { ruleId: "no-underscore-dangle", message: "V2", line: 2 },
      { ruleId: "no-underscore-dangle", message: "V3", line: 3 },
      original,
    ],
  ];

  const result = processor.postprocess(messages, exampleFile);
  assert.strictEqual(result.length, 1);
  assert(result[0].message.includes("4 violations found"));
  assert.strictEqual(original.message, "V4", "Input should not be mutated");
});

test("processor.postprocess returns everything when disabled via env", () => {
  const exampleFile = path.resolve(__dirname, "../example/src/utils.js");
  const messages = [
    [
      { ruleId: "no-underscore-dangle", message: "V1", line: 1 },
      { ruleId: "no-underscore-dangle", message: "V2", line: 2 },
    ],
  ];

  process.env.ESLINT_EXCEPTIONS_DISABLE = "1";
  try {
    assert.strictEqual(processor.postprocess(messages, exampleFile).length, 2);
  } finally {
    delete process.env.ESLINT_EXCEPTIONS_DISABLE;
  }
});

console.log("\n=== Testing core ===\n");

test("applyApprovals keeps excess and unapproved rules", () => {
  const approvals = { a: { "f.js": 1 } };
  const result = applyApprovals(
    [
      { ruleId: "a", message: "a1" },
      { ruleId: "a", message: "a2" },
      { ruleId: "b", message: "b1" },
      { message: "parse error" },
    ],
    approvals,
    "f.js"
  );

  assert.deepStrictEqual(
    result.map((m) => m.ruleId || null),
    ["a", "b", null]
  );
  assert(result[0].message.startsWith("a2 (2 violations found"));
});

test("applyApprovals returns input when there are no approvals", () => {
  const messages = [{ ruleId: "a", message: "a1" }];
  assert.strictEqual(applyApprovals(messages, null, "f.js"), messages);
});

test("generateApprovals counts per rule and file with sorted keys", () => {
  const base = path.resolve("/repo");
  const approvals = generateApprovals(
    [
      {
        filePath: path.join(base, "src/b.js"),
        messages: [{ ruleId: "z" }, { ruleId: "a" }, { ruleId: "a" }],
      },
      { filePath: path.join(base, "src/a.js"), messages: [{ ruleId: "a" }] },
      { filePath: path.join(base, "src/c.js"), messages: [{ ruleId: null }] },
      { filePath: path.join(base, "src/d.js"), messages: [] },
    ],
    base
  );

  assert.deepStrictEqual(approvals, {
    a: { "src/a.js": 1, "src/b.js": 2 },
    z: { "src/b.js": 1 },
  });
  assert.deepStrictEqual(Object.keys(approvals.a), ["src/a.js", "src/b.js"]);
});

test("mergeApprovals keeps the max and does not mutate inputs", () => {
  const existing = { a: { "x.js": 5 }, b: { "y.js": 1 } };
  const merged = mergeApprovals(existing, { a: { "x.js": 2, "z.js": 3 } });

  assert.deepStrictEqual(merged, {
    a: { "x.js": 5, "z.js": 3 },
    b: { "y.js": 1 },
  });
  assert.deepStrictEqual(existing.a, { "x.js": 5 });
});

console.log("\n=== Testing linter adapters ===\n");

test("oxlint normalizeRuleId maps to ESLint rule IDs", () => {
  const cases = {
    "eslint(no-console)": "no-console",
    "typescript(no-explicit-any)": "@typescript-eslint/no-explicit-any",
    "unicorn(no-array-reduce)": "unicorn/no-array-reduce",
    "jsx-a11y(alt-text)": "jsx-a11y/alt-text",
    "next(no-img-element)": "@next/next/no-img-element",
    "import(no-duplicates)": "import/no-duplicates",
    "my-plugin(no-foo)": "my-plugin/no-foo",
  };
  for (const [code, expected] of Object.entries(cases)) {
    assert.strictEqual(oxlint.normalizeRuleId(code), expected, code);
  }
  assert.strictEqual(oxlint.normalizeRuleId(undefined), null);
});

test("oxlint parseResults groups diagnostics by absolute file path", () => {
  const cwd = path.resolve("/repo");
  const json = {
    diagnostics: [
      {
        message: "Unexpected any",
        code: "typescript(no-explicit-any)",
        severity: "error",
        filename: "src/a.ts",
        labels: [{ span: { offset: 7, length: 3, line: 1, column: 8 } }],
      },
      {
        message: "Unexpected console statement.",
        code: "eslint(no-console)",
        severity: "warning",
        filename: "src/a.ts",
        labels: [{ span: { offset: 16, length: 11, line: 2, column: 1 } }],
      },
      { message: "Unexpected token", severity: "error", filename: "src/b.js" },
    ],
    number_of_files: 2,
  };

  const results = oxlint.parseResults(json, cwd);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].filePath, path.join(cwd, "src/a.ts"));
  assert.deepStrictEqual(results[0].messages[0], {
    ruleId: "@typescript-eslint/no-explicit-any",
    message: "Unexpected any",
    severity: 2,
    line: 1,
    column: 8,
  });
  assert.strictEqual(results[0].messages[1].severity, 1);
  assert.strictEqual(results[1].messages[0].ruleId, null);
});

test("eslint parseResults normalizes ESLint JSON output", () => {
  const cwd = path.resolve("/repo");
  const results = eslint.parseResults(
    [
      {
        filePath: path.join(cwd, "src/a.js"),
        messages: [
          { ruleId: "no-console", message: "m", severity: 1, line: 1, column: 2 },
          { ruleId: null, message: "Parsing error", severity: 2, line: 3, column: 1, fatal: true },
        ],
      },
    ],
    cwd
  );

  assert.deepStrictEqual(results[0].messages, [
    { ruleId: "no-console", message: "m", severity: 1, line: 1, column: 2 },
    { ruleId: null, message: "Parsing error", severity: 2, line: 3, column: 1 },
  ]);
});

test("parseJsonOutput skips leading text and rejects non-JSON output", () => {
  const json = parseJsonOutput(
    'No files found to lint.\n{ "diagnostics": [] }',
    "oxlint",
    ""
  );
  assert.deepStrictEqual(json, { diagnostics: [] });
  assert.strictEqual(parseJsonOutput("", "oxlint", ""), null);
  assert.throws(
    () => parseJsonOutput("src/a.js:1:1: error eslint(x): y", "oxlint", ""),
    /Unexpected oxlint output/
  );
});

console.log("\n=== Testing CLI ===\n");

test("parseArgs handles commands, options and linter passthrough", () => {
  const options = parseArgs([
    "check",
    "--linter",
    "oxlint",
    "-p",
    "example",
    "--max-warnings",
    "0",
    "--strict",
    "--",
    "--type-aware",
  ]);

  assert.strictEqual(options.command, "check");
  assert.strictEqual(options.linter, "oxlint");
  assert.strictEqual(options.path, path.resolve("example"));
  assert.strictEqual(options.maxWarnings, 0);
  assert.strictEqual(options.strict, true);
  assert.deepStrictEqual(options.linterArgs, ["--type-aware"]);

  const defaults = parseArgs(["--merge"]);
  assert.strictEqual(defaults.command, "generate");
  assert.strictEqual(defaults.merge, true);
  assert.strictEqual(defaults.output, path.resolve("approvals.json"));

  assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--linter"]), /Missing value/);
});

test("findStaleApprovals reports counts higher than actual", () => {
  const dir = path.resolve("/repo");
  const stale = findStaleApprovals(
    [
      {
        filePath: path.join(dir, "src/a.js"),
        messages: [{ ruleId: "r" }],
      },
    ],
    new Map([
      [dir, { r: { "src/a.js": 3, "src/b.js": 1 }, s: { "src/a.js": 0 } }],
    ]),
    dir
  );

  assert.deepStrictEqual(
    stale.map((s) => [s.filePath, s.allowed, s.actual]),
    [
      [path.join(dir, "src/a.js"), 3, 1],
      [path.join(dir, "src/b.js"), 1, 0],
    ]
  );
});

test("detectLinter falls back to ESLint when configs are side by side", () => {
  assert.strictEqual(
    detectLinter(path.join(__dirname, "../example")),
    "eslint"
  );
});

console.log("\n=== End-to-end (requires installed linters) ===\n");

const cliPath = path.join(__dirname, "../src/cli.js");
const exampleDir = path.join(__dirname, "../example");

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: exampleDir,
    encoding: "utf8",
  });
}

for (const linter of ["oxlint", "eslint"]) {
  if (!findLocalBin(linter, exampleDir)) {
    console.log(`- skipped ${linter} (not installed)`);
    continue;
  }

  test(`${linter}: check passes when violations are approved`, () => {
    const { status, stdout, stderr } = runCli(["check", "--linter", linter]);
    assert.strictEqual(status, 0, stdout + stderr);
  });

  test(`${linter}: check fails on violations above the approved count`, () => {
    const extra = path.join(exampleDir, "src/__extra.js");
    fs.writeFileSync(extra, 'export const _extra = "x";\n');
    try {
      const { status, stdout } = runCli(["check", "--linter", linter]);
      assert.strictEqual(status, 1, stdout);
      assert(stdout.includes("no-underscore-dangle"), stdout);
      assert(stdout.includes("__extra.js"), stdout);
    } finally {
      fs.unlinkSync(extra);
    }
  });

  test(`${linter}: generate writes the current counts`, () => {
    const out = path.join(os.tmpdir(), `approvals-${linter}-${process.pid}.json`);
    try {
      const { status, stdout, stderr } = runCli(["--linter", linter, "-o", out]);
      assert.strictEqual(status, 0, stdout + stderr);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, "utf8")), {
        "no-underscore-dangle": { "src/utils.js": 3 },
      });
    } finally {
      if (fs.existsSync(out)) fs.unlinkSync(out);
    }
  });
}

console.log("\n=== All tests completed ===\n");
