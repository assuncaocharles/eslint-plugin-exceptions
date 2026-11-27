const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const IS_WINDOWS = process.platform === "win32";

/**
 * Find `node_modules/.bin/<bin>` in `cwd` or any parent directory.
 */
function findLocalBin(bin, cwd) {
  const filename = IS_WINDOWS ? `${bin}.cmd` : bin;
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, "node_modules", ".bin", filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Run a linter binary in `cwd` and collect stdout/stderr.
 *
 * Prefers the locally installed binary. Falls back to `npx --no -- <bin>`;
 * the `--` matters because otherwise npm consumes flags like `--format`.
 *
 * Linters exit non-zero when they find violations, so the exit code is
 * returned rather than treated as a failure.
 */
function runCommand(bin, args, { cwd, env } = {}) {
  const local = findLocalBin(bin, cwd);
  const [command, commandArgs] = local
    ? [local, args]
    : ["npx", ["--no", "--", bin, ...args]];

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, ...env },
      // .cmd shims on Windows need a shell
      shell: IS_WINDOWS,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));

    child.on("error", (err) =>
      reject(new Error(`Failed to run ${bin}: ${err.message}`))
    );
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Parse JSON from linter stdout, ignoring any text printed before it
 * (oxlint prints e.g. "No files found to lint." ahead of the JSON).
 */
function parseJsonOutput(stdout, linterName, stderr) {
  const trimmed = stdout.trim();
  const start = trimmed.search(/^[[{]/m);

  if (start === -1) {
    if (stderr && stderr.trim()) {
      throw new Error(`${linterName} error: ${stderr.trim()}`);
    }
    if (trimmed) {
      throw new Error(`Unexpected ${linterName} output:\n${trimmed}`);
    }
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(start));
  } catch (e) {
    throw new Error(
      `Failed to parse ${linterName} output: ${e.message}\n${stdout}${stderr ? `\n${stderr}` : ""}`
    );
  }
}

module.exports = { runCommand, parseJsonOutput, findLocalBin };
