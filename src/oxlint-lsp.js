#!/usr/bin/env node

// Editor entry point: point the oxc extension's `oxc.path.oxlint` setting at
// this file. The editor runs `node oxlint-lsp.js --lsp`; this starts the
// project's real `oxlint --lsp` and filters its diagnostics with
// approvals.json.
//
// stdout is the LSP channel, so nothing else may be written to it.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createProxy } = require("./lsp/proxy");

/**
 * Find the oxlint JS entry script. `OXLINT_EXCEPTIONS_OXLINT_PATH` wins;
 * otherwise oxlint is resolved from the current directory, then from this
 * package's location (which is inside the project's node_modules).
 */
function resolveOxlint() {
  const override = process.env.OXLINT_EXCEPTIONS_OXLINT_PATH;
  if (override) return path.resolve(override);

  const pkgPath = require.resolve("oxlint/package.json", {
    paths: [process.cwd(), __dirname],
  });
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.oxlint;
  return path.join(path.dirname(pkgPath), bin);
}

function main() {
  let oxlintPath;
  try {
    oxlintPath = resolveOxlint();
  } catch (error) {
    process.stderr.write(
      `[eslint-plugin-exceptions] Could not find oxlint. Install it in your project or set OXLINT_EXCEPTIONS_OXLINT_PATH.\n${error.message}\n`
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  if (!args.includes("--lsp")) args.push("--lsp");

  // A native binary is run directly; oxlint's npm entry is a Node script
  const isScript = /\.(c|m)?js$/.test(oxlintPath) || !path.extname(oxlintPath);
  const [command, commandArgs] = isScript
    ? [process.execPath, [oxlintPath, ...args]]
    : [oxlintPath, args];

  const server = spawn(command, commandArgs, {
    stdio: ["pipe", "pipe", "inherit"],
  });

  const proxy = createProxy({
    clientIn: process.stdin,
    clientOut: process.stdout,
    serverIn: server.stdin,
    serverOut: server.stdout,
  });

  server.on("error", (error) => {
    process.stderr.write(
      `[eslint-plugin-exceptions] Failed to start oxlint: ${error.message}\n`
    );
    process.exit(1);
  });

  server.on("exit", (code, signal) => {
    proxy.close();
    process.exit(code === null ? (signal ? 1 : 0) : code);
  });

  process.stdin.on("end", () => server.stdin.end());
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.kill(signal));
  }
}

if (require.main === module) {
  main();
}

module.exports = { resolveOxlint };
