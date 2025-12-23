#!/usr/bin/env node

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const APPROVALS_FILENAME = "approvals.json";

function printUsage() {
  console.log(`
Usage: npx eslint-plugin-exceptions [options]

Generates an approvals.json file based on current ESLint violations.

Options:
  --path, -p <dir>    Path to the package/directory to analyze (default: current directory)
  --output, -o <file> Output file path (default: approvals.json in the target directory)
  --merge, -m         Merge with existing approvals.json instead of overwriting
  --help, -h          Show this help message

Examples:
  npx eslint-plugin-exceptions
  npx eslint-plugin-exceptions --path packages/my-app
  npx eslint-plugin-exceptions -p ./src -o custom-approvals.json
  npx eslint-plugin-exceptions --merge
`);
}

function parseArgs(args) {
  const options = {
    path: process.cwd(),
    output: null,
    merge: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--path" || arg === "-p") {
      options.path = args[++i];
    } else if (arg === "--output" || arg === "-o") {
      options.output = args[++i];
    } else if (arg === "--merge" || arg === "-m") {
      options.merge = true;
    }
  }

  options.path = path.resolve(options.path);

  if (!options.output) {
    options.output = path.join(options.path, APPROVALS_FILENAME);
  } else {
    options.output = path.resolve(options.output);
  }

  return options;
}

function runEslint(targetPath) {
  return new Promise((resolve, reject) => {
    console.log(`\n🔍 Running ESLint on ${targetPath}...\n`);

    const eslintProcess = spawn(
      "npx",
      ["eslint", targetPath, "--format", "json"],
      {
        cwd: targetPath,
        shell: true,
        stdio: ["inherit", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    eslintProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    eslintProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    eslintProcess.on("close", (code) => {
      if (stderr && !stdout) {
        reject(new Error(`ESLint error: ${stderr}`));
        return;
      }

      try {
        const results = JSON.parse(stdout);
        resolve(results);
      } catch (e) {
        if (stdout.trim() === "") {
          resolve([]);
        } else {
          reject(
            new Error(`Failed to parse ESLint output: ${e.message}\n${stdout}`)
          );
        }
      }
    });

    eslintProcess.on("error", (err) => {
      reject(new Error(`Failed to run ESLint: ${err.message}`));
    });
  });
}

function generateApprovals(eslintResults, basePath) {
  const approvals = {};

  for (const result of eslintResults) {
    if (result.messages.length === 0) {
      continue;
    }

    const relativePath = path
      .relative(basePath, result.filePath)
      .replace(/\\/g, "/");

    const ruleViolations = {};
    for (const message of result.messages) {
      if (!message.ruleId) {
        continue;
      }

      if (!ruleViolations[message.ruleId]) {
        ruleViolations[message.ruleId] = 0;
      }
      ruleViolations[message.ruleId]++;
    }

    for (const [ruleId, count] of Object.entries(ruleViolations)) {
      if (!approvals[ruleId]) {
        approvals[ruleId] = {};
      }
      approvals[ruleId][relativePath] = count;
    }
  }

  const sortedApprovals = {};
  for (const ruleId of Object.keys(approvals).sort()) {
    const sortedFiles = {};
    for (const filePath of Object.keys(approvals[ruleId]).sort()) {
      sortedFiles[filePath] = approvals[ruleId][filePath];
    }
    sortedApprovals[ruleId] = sortedFiles;
  }

  return sortedApprovals;
}

function mergeApprovals(existing, generated) {
  const merged = { ...existing };

  for (const [ruleId, files] of Object.entries(generated)) {
    if (!merged[ruleId]) {
      merged[ruleId] = {};
    }

    for (const [filePath, count] of Object.entries(files)) {
      merged[ruleId][filePath] = Math.max(merged[ruleId][filePath] || 0, count);
    }
  }

  const sorted = {};
  for (const ruleId of Object.keys(merged).sort()) {
    const sortedFiles = {};
    for (const filePath of Object.keys(merged[ruleId]).sort()) {
      sortedFiles[filePath] = merged[ruleId][filePath];
    }
    sorted[ruleId] = sortedFiles;
  }

  return sorted;
}

function loadExistingApprovals(outputPath) {
  try {
    if (fs.existsSync(outputPath)) {
      const content = fs.readFileSync(outputPath, "utf8");
      return JSON.parse(content);
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

  for (const [ruleId, files] of Object.entries(approvals)) {
    totalRules++;
    for (const [filePath, count] of Object.entries(files)) {
      totalFiles++;
      totalViolations += count;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Rules with violations: ${totalRules}`);
  console.log(`   Files with violations: ${totalFiles}`);
  console.log(`   Total violations: ${totalViolations}`);
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  if (!fs.existsSync(options.path)) {
    console.error(`❌ Path does not exist: ${options.path}`);
    process.exit(1);
  }

  try {
    const eslintResults = await runEslint(options.path);

    if (eslintResults.length === 0) {
      console.log("✨ No ESLint results found. Your code is clean!");
      process.exit(0);
    }

    let approvals = generateApprovals(eslintResults, options.path);

    if (options.merge) {
      const existing = loadExistingApprovals(options.output);
      if (existing) {
        console.log(`📎 Merging with existing ${APPROVALS_FILENAME}...`);
        approvals = mergeApprovals(existing, approvals);
      }
    }

    if (Object.keys(approvals).length === 0) {
      console.log("✨ No violations found. No approvals file needed!");
      process.exit(0);
    }

    const outputContent = JSON.stringify(approvals, null, 2) + "\n";
    fs.writeFileSync(options.output, outputContent);

    console.log(`\n✅ Generated ${options.output}`);
    printSummary(approvals);

    console.log(`\n💡 Next steps:`);
    console.log(`   1. Review the generated approvals.json`);
    console.log(`   2. Add the exceptions plugin to your ESLint config`);
    console.log(`   3. Gradually reduce the counts as you fix violations\n`);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
