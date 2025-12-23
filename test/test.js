const assert = require("assert");
const path = require("path");
const {
  getApprovalsForFile,
  getRelativePath,
  getAllowedExceptions,
  clearCache,
} = require("../src/utils/approvals-loader");
const processor = require("../src/processor");

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

test("processor.preprocess returns source with preserved extension", () => {
  const source = "const x = 1;";
  const result = processor.preprocess(source, "test.tsx");

  assert(Array.isArray(result), "Should return array");
  assert.strictEqual(result.length, 1, "Should have one element");
  assert.strictEqual(result[0].text, source, "Source text should be unchanged");
  assert.strictEqual(
    result[0].filename,
    "0.tsx",
    "Filename should preserve extension"
  );
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
  const fileWithSuffix = exampleFile + "/0_";

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

console.log("\n=== All tests completed ===\n");
