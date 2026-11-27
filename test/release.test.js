const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  parseTitle,
  releaseType,
  latestVersion,
  bump,
} = require("../scripts/release");

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

console.log("\n=== Testing release scripts ===\n");

test("releaseType maps PR titles to release types", () => {
  const cases = {
    "feat: add oxlint support": "minor",
    "feat(cli): add check command": "minor",
    "fix: keep bin entries": "patch",
    "fix(lsp): handle pull diagnostics": "patch",
    "perf: cache approvals": "patch",
    "revert: undo the thing": "patch",
    "feat!: drop Node 18": "major",
    "fix(core)!: change approvals format": "major",
    "refactor!: rename exports": "major",
    "docs: fix typo": null,
    "chore: update deps": null,
    "ci: add workflow": null,
    "test: more cases": null,
  };
  for (const [title, expected] of Object.entries(cases)) {
    assert.strictEqual(releaseType(title), expected, title);
  }
});

test("releaseType treats BREAKING CHANGE in the body as major", () => {
  assert.strictEqual(
    releaseType("feat: new config", "Details\n\nBREAKING CHANGE: approvals.json v2"),
    "major"
  );
  assert.strictEqual(releaseType("fix: x", "mentions breaking change: later"), "patch");
});

test("parseTitle rejects titles that are not Conventional Commits", () => {
  for (const title of [
    "Release 1.2.1: restore the CLI commands",
    "Add oxlint support",
    "feat:missing space",
    "feat: ",
    "Feat: capitalized type",
    "feature: unknown type",
    "feat(): empty scope",
    "",
  ]) {
    assert.strictEqual(parseTitle(title), null, JSON.stringify(title));
  }
  assert.deepStrictEqual(parseTitle("feat(cli)!: add check"), {
    type: "feat",
    scope: "cli",
    breaking: true,
    subject: "add check",
  });
});

test("latestVersion picks the highest stable version from tags and npm", () => {
  assert.deepStrictEqual(
    latestVersion(["v1.2.0", "1.10.0", "v1.9.3", "1.2.1", "2.0.0-beta.1", "junk"]),
    [1, 10, 0]
  );
  assert.strictEqual(latestVersion([]), undefined);
});

test("bump increments the right part", () => {
  assert.strictEqual(bump([1, 2, 1], "patch"), "1.2.2");
  assert.strictEqual(bump([1, 2, 1], "minor"), "1.3.0");
  assert.strictEqual(bump([1, 2, 1], "major"), "2.0.0");
  assert.strictEqual(bump(undefined, "minor"), "0.1.0");
});

test("check-title command exits 1 with help for invalid titles", () => {
  const script = path.join(__dirname, "../scripts/release.js");
  const ok = spawnSync(process.execPath, [script, "check-title", "feat: x"], {
    encoding: "utf8",
  });
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /minor release/);

  const bad = spawnSync(process.execPath, [script, "check-title", "Add stuff"], {
    encoding: "utf8",
  });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /Conventional Commits/);
});


const { decide } = require("../scripts/release");

test("decide releases the next version from tags and npm", () => {
  const { outputs } = decide({
    tagsAtHead: "",
    change: { source: "PR #5", title: "feat: automatic releases", body: "" },
    tags: ["v1.2.0", "v1.2.1"],
    published: ["1.0.0", "1.1.0", "1.1.1", "1.2.0"],
  });
  assert.deepStrictEqual(outputs, {
    release: "true",
    version: "1.3.0",
    previous_tag: "v1.2.1",
  });
});

test("decide uses npm when it is ahead of the tags", () => {
  const { outputs } = decide({
    tagsAtHead: "",
    change: { source: "PR #6", title: "fix: x", body: "" },
    tags: ["v1.2.0"],
    published: ["1.2.0", "1.2.1"],
  });
  assert.strictEqual(outputs.version, "1.2.2");
  assert.strictEqual(outputs.previous_tag, "", "v1.2.1 has no tag to diff from");
});

test("decide skips no-release titles and already released commits", () => {
  const base = { tags: ["v1.2.1"], published: ["1.2.1"] };
  assert.deepStrictEqual(
    decide({ ...base, tagsAtHead: "", change: { source: "PR", title: "docs: x", body: "" } }).outputs,
    { release: "false" }
  );
  assert.deepStrictEqual(
    decide({ ...base, tagsAtHead: "v1.2.1", change: null }).outputs,
    { release: "false" }
  );
});

console.log("\n=== Release tests completed ===\n");
