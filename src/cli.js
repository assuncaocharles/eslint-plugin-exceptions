#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { getLinter, detectLinter } = require("./linters");
const { generateApprovals, mergeApprovals } = require("./core/approvals");
const { applyApprovals } = require("./core/filter");
const {
  getApprovalsForFile,
  getRelativePath,
  APPROVALS_FILENAME,
} = require("./utils/approvals-loader");

const USAGE = `
Usage: npx eslint-exceptions [command] [options] [-- <linter args>]

Commands:
  generate (default)  Write approvals.json from the current violations
  check               Run the linter and fail only on violations that are
                      not covered by approvals.json (use this with oxlint)

Options:
  --linter, -l <name>   eslint | oxlint (default: auto-detected from config files)
  --path, -p <dir>      Directory to lint (default: current directory)
  --help, -h            Show this help message

generate options:
  --output, -o <file>   Output file (default: approvals.json in --path)
  --merge, -m           Merge with existing approvals.json instead of overwriting

check options:
  --max-warnings <n>    Fail if more than n unapproved warnings remain (default: no limit)
  --strict              Also fail when an approval count is higher than the
                        actual number of violations (keeps approvals.json tight)

Anything after "--" is passed to the linter, e.g. -- --type-aware

Examples:
  npx eslint-exceptions
  npx eslint-exceptions --linter oxlint
  npx eslint-exceptions check --linter oxlint
  npx eslint-exceptions check --path packages/my-app --strict
  npx eslint-exceptions --merge
`;

function parseArgs(argv) {
  const options = {
    command: "generate",
    linter: null,
    path: process.cwd(),
    output: null,
    merge: false,
    maxWarnings: null,
    strict: false,
    help: false,
    linterArgs: [],
  };

  const args = [...argv];
  const separator = args.indexOf("--");
  if (separator !== -1) {
    options.linterArgs = args.splice(separator).slice(1);
  }

  if (args[0] === "generate" || args[0] === "check") {
    options.command = args.shift();
  }

  const requireValue = (flag, value) => {
    if (value === undefined || value.startsWith("-")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--path" || arg === "-p") {
      options.path = requireValue(arg, args[++i]);
    } else if (arg === "--output" || arg === "-o") {
      options.output = requireValue(arg, args[++i]);
    } else if (arg === "--merge" || arg === "-m") {
      options.merge = true;
    } else if (arg === "--linter" || arg === "-l") {
      options.linter = requireValue(arg, args[++i]);
    } else if (arg === "--max-warnings") {
      const value = Number(requireValue(arg, args[++i]));
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--max-warnings must be a non-negative integer");
      }
      options.maxWarnings = value;
    } else if (arg === "--strict") {
      options.strict = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.path = path.resolve(options.path);
  options.output = options.output
    ? path.resolve(options.output)
    : path.join(options.path, APPROVALS_FILENAME);

  return options;
}

function loadExistingApprovals(outputPath) {
  try {
    if (fs.existsSync(outputPath)) {
      return JSON.parse(fs.readFileSync(outputPath, "utf8"));
    }
  } catch (e) {
    console.warn(`⚠️  Could not read existing approvals file: ${e.message}`);
  }
  return null;
}

function printSummary(approvals) {
  let totalRules = 0;
  let totalFiles = 0;
  let totalViolations = 0;

  for (const files of Object.values(approvals)) {
    totalRules++;
    for (const count of Object.values(files)) {
      totalFiles++;
      totalViolations += count;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Rules with violations: ${totalRules}`);
  console.log(`   Files with violations: ${totalFiles}`);
  console.log(`   Total violations: ${totalViolations}`);
}

async function generate(options, linter, results) {
  let approvals = generateApprovals(results, options.path);

  if (options.merge) {
    const existing = loadExistingApprovals(options.output);
    if (existing) {
      console.log(`📎 Merging with existing ${APPROVALS_FILENAME}...`);
      approvals = mergeApprovals(existing, approvals);
    }
  }

  if (Object.keys(approvals).length === 0) {
    console.log("✨ No violations found. No approvals file needed!");
    return 0;
  }

  fs.writeFileSync(options.output, JSON.stringify(approvals, null, 2) + "\n");

  console.log(`\n✅ Generated ${options.output}`);
  printSummary(approvals);

  console.log(`\n💡 Next steps:`);
  console.log(`   1. Review the generated ${APPROVALS_FILENAME}`);
  if (linter.name === "ESLint") {
    console.log(`   2. Add the exceptions processor to your ESLint config`);
  } else {
    console.log(
      `   2. Run "npx eslint-exceptions check --linter oxlint" in CI instead of "oxlint"`
    );
  }
  console.log(`   3. Gradually reduce the counts as you fix violations\n`);
  return 0;
}

/**
 * Find approval entries whose count is higher than the actual number of
 * violations. Only entries for files inside `targetPath` are considered.
 */
function findStaleApprovals(results, approvalsByDir, targetPath) {
  const actual = new Map();
  for (const result of results) {
    for (const m of result.messages) {
      if (!m.ruleId) continue;
      const key = `${result.filePath}\0${m.ruleId}`;
      actual.set(key, (actual.get(key) || 0) + 1);
    }
  }

  const stale = [];
  for (const [approvalsDir, approvals] of approvalsByDir) {
    for (const [ruleId, files] of Object.entries(approvals)) {
      for (const [relPath, allowed] of Object.entries(files)) {
        const filePath = path.resolve(approvalsDir, relPath);
        if (path.relative(targetPath, filePath).startsWith("..")) continue;

        const count = actual.get(`${filePath}\0${ruleId}`) || 0;
        if (count < allowed) {
          stale.push({ ruleId, filePath, allowed, actual: count });
        }
      }
    }
  }
  return stale;
}

async function check(options, linter, results) {
  const approvalsByDir = new Map();
  const target = getApprovalsForFile(path.join(options.path, "_"));
  if (target.approvals) {
    approvalsByDir.set(target.approvalsDir, target.approvals);
  }

  const reported = [];
  for (const result of results) {
    const { approvals, approvalsDir } = getApprovalsForFile(result.filePath);
    let messages = result.messages;
    if (approvals) {
      approvalsByDir.set(approvalsDir, approvals);
      messages = applyApprovals(
        messages,
        approvals,
        getRelativePath(result.filePath, approvalsDir)
      );
    }
    if (messages.length > 0) {
      reported.push({ filePath: result.filePath, messages });
    }
  }

  let errors = 0;
  let warnings = 0;
  for (const { filePath, messages } of reported) {
    console.log(`\n${path.relative(process.cwd(), filePath) || filePath}`);
    for (const m of messages) {
      const isError = m.severity === 2;
      if (isError) errors++;
      else warnings++;
      const location = `${m.line || 0}:${m.column || 0}`.padEnd(8);
      const level = (isError ? "error" : "warning").padEnd(8);
      console.log(`  ${location}${level}${m.message}  ${m.ruleId || ""}`);
    }
  }

  const stale = findStaleApprovals(results, approvalsByDir, options.path);
  if (stale.length > 0) {
    console.log(
      `\n${options.strict ? "❌" : "💡"} ${stale.length} approval(s) can be lowered:`
    );
    for (const s of stale) {
      console.log(
        `   ${s.ruleId}  ${path.relative(process.cwd(), s.filePath)}: ${s.allowed} approved, ${s.actual} found`
      );
    }
  }

  const failedWarnings =
    options.maxWarnings !== null && warnings > options.maxWarnings;
  const failedStale = options.strict && stale.length > 0;

  if (errors === 0 && warnings === 0) {
    console.log(`\n✨ ${linter.name}: no unapproved violations.`);
  } else {
    console.log(
      `\n✖ ${errors + warnings} unapproved problem(s) (${errors} error(s), ${warnings} warning(s))`
    );
  }

  return errors > 0 || failedWarnings || failedStale ? 1 : 0;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.log(USAGE);
    return 2;
  }

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  if (!fs.existsSync(options.path)) {
    console.error(`❌ Path does not exist: ${options.path}`);
    return 2;
  }

  try {
    const linter = getLinter(options.linter || detectLinter(options.path));
    console.log(`\n🔍 Running ${linter.name} on ${options.path}...`);
    const results = await linter.run(options.path, options.linterArgs);

    return options.command === "check"
      ? await check(options, linter, results)
      : await generate(options, linter, results);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    return 2;
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  });
}

module.exports = { parseArgs, findStaleApprovals };
