# eslint-plugin-exceptions

Approve a fixed number of lint violations per file with an `approvals.json` file. Works with **ESLint** and **oxlint**.

## Why?

When you turn on a stricter rule in an existing codebase, you rarely want to fix every violation at once. This package lets you:

- Record the violations that already exist, per rule and per file
- Fail the build on any **new** violation
- Lower the approved counts as you fix issues, until each file drops out of `approvals.json`

## How it works

You keep one `approvals.json` (per project or per package) that maps each rule to the number of violations approved in each file:

```json
{
  "no-underscore-dangle": {
    "src/legacy/utils.ts": 5,
    "src/components/DataGrid.tsx": 3
  },
  "@typescript-eslint/no-explicit-any": {
    "src/api/client.ts": 10
  }
}
```

For every file, the nearest `approvals.json` (in the file's directory or a parent) is used:

- If a file has **at most** the approved number of violations for a rule, they are hidden.
- If it has **more**, the extra violations are reported, with context:

```
Unexpected dangling '_' in '_privateVar4' (4 violations found, but only 3 approved in approvals.json)
```

How the filtering is wired in depends on the linter:

| | ESLint | oxlint |
| --- | --- | --- |
| Integration | Processor in your ESLint config | `eslint-exceptions check` CLI that wraps `oxlint` |
| Editor integration | ✅ Works with the ESLint extension, no setup | ✅ Point the oxc extension at the bundled language server wrapper |
| Generate `approvals.json` | `npx eslint-exceptions` | `npx eslint-exceptions --linter oxlint` |
| Enforce in CI | `npx eslint .` | `npx eslint-exceptions check --linter oxlint` |

Oxlint has no processor API, so with oxlint the CLI runs `oxlint --format json`, applies `approvals.json` to the output and sets the exit code. In the editor, a small wrapper sits between the editor and `oxlint --lsp` and removes approved diagnostics the same way.

Both linters read the same `approvals.json` format. Oxlint rule names are converted to ESLint rule IDs (see [Rule IDs with oxlint](#rule-ids-with-oxlint)), so one file works for both. This is handy while migrating from one linter to the other.

---

## Using with ESLint

### 1. Install

```bash
npm install --save-dev eslint eslint-plugin-exceptions
```

Requires ESLint 8 or later and Node.js 18 or later.

### 2. Generate `approvals.json`

From the project (or package) root:

```bash
npx eslint-exceptions
```

This runs ESLint, counts the current violations and writes `approvals.json`. Review it and commit it.

### 3. Add the processor to your config

#### Flat config (`eslint.config.js`)

```javascript
import exceptions from "eslint-plugin-exceptions";

export default [
  // ... your other configs with rules
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: { exceptions },
    processor: "exceptions/passthrough",
  },
];
```

Or use the recommended config, which applies the processor to all files:

```javascript
import exceptions from "eslint-plugin-exceptions";

export default [
  exceptions.configs.recommended,
  // ... your other configs
];
```

#### Legacy config (`.eslintrc.js`)

```javascript
module.exports = {
  plugins: ["exceptions"],
  overrides: [
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      processor: "exceptions/passthrough",
    },
  ],
};
```

### 4. Lint as usual

```bash
npx eslint .
```

Approved violations are hidden, both on the command line and in your editor. Only new violations are reported.

> The processor does not change the source, so it works alongside parsers like `@typescript-eslint/parser`. When ESLint applies more than one processor to the same file, only one of them is used. If another plugin already sets a processor for those files (for example, for `.vue` or `.md`), use `eslint-exceptions check` there instead.

---

## Using with oxlint

### 1. Install

```bash
npm install --save-dev oxlint eslint-plugin-exceptions
```

Requires oxlint 1.0 or later and Node.js 18 or later. ESLint is **not** required.

### 2. Configure oxlint

Configure your rules in `.oxlintrc.json` as usual. Nothing in it changes for this package:

```json
{
  "plugins": ["typescript"],
  "rules": {
    "no-underscore-dangle": "error",
    "typescript/no-explicit-any": "error"
  }
}
```

### 3. Generate `approvals.json`

```bash
npx eslint-exceptions --linter oxlint
```

Review the generated `approvals.json` and commit it.

### 4. Run the check

Run this in place of `oxlint`, locally and in CI:

```bash
npx eslint-exceptions check --linter oxlint
```

It exits with `1` when there are unapproved errors and `0` otherwise. A typical setup in `package.json`:

```json
{
  "scripts": {
    "lint": "eslint-exceptions check --linter oxlint",
    "lint:approve": "eslint-exceptions --linter oxlint --merge"
  }
}
```

To pass extra flags to oxlint, add them after `--`:

```bash
npx eslint-exceptions check --linter oxlint -- --type-aware --config .oxlintrc.ci.json
```

### 5. Set up your editor

Out of the box, the oxc editor extension shows every violation, including approved ones. The package includes a wrapper around oxlint's language server that hides approved violations, so the editor matches `eslint-exceptions check`.

#### VS Code (and Cursor and other VS Code forks)

Install the [Oxc extension](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode), then point its oxlint binary path at the wrapper in `.vscode/settings.json`:

```json
{
  "oxc.path.oxlint": "./node_modules/eslint-plugin-exceptions/src/oxlint-lsp.js"
}
```

Relative paths resolve from the first workspace folder. In a monorepo, use the path to wherever the package is installed.

#### Other editors

Any editor where you can set the oxlint language server command works. Use `node_modules/.bin/eslint-exceptions-oxlint-lsp --lsp` in place of `oxlint --lsp`. For example, in Neovim 0.11+:

```lua
vim.lsp.config("oxlint", {
  cmd = { "node_modules/.bin/eslint-exceptions-oxlint-lsp", "--lsp" },
})
```

#### How the editor wrapper works

- It starts the project's own `oxlint --lsp` and forwards everything unchanged, except diagnostics.
- For each file, it applies the nearest `approvals.json` with the same rules as `check`.
- It supports both ways editors get diagnostics: the server pushing them, or the editor requesting them (VS Code).
- When `approvals.json` changes, open files are re-checked within about a second.
- It finds oxlint from the project's `node_modules`. To use another binary, set `OXLINT_EXCEPTIONS_OXLINT_PATH`.

### Rule IDs with oxlint

Oxlint reports rules as `plugin(rule)`. In `approvals.json` they use the ESLint rule IDs:

| oxlint | `approvals.json` key |
| --- | --- |
| `eslint(no-console)` | `no-console` |
| `typescript(no-explicit-any)` | `@typescript-eslint/no-explicit-any` |
| `next(no-img-element)` | `@next/next/no-img-element` |
| `node(no-path-concat)` | `n/no-path-concat` |
| `unicorn(no-array-reduce)`, `react(...)`, `import(...)`, `jsx-a11y(...)`, … | `unicorn/no-array-reduce`, `react/...`, `import/...`, `jsx-a11y/...` |
| JS plugins, e.g. `my-plugin(no-foo)` | `my-plugin/no-foo` |

### Using ESLint and oxlint together

If you run oxlint for most rules and ESLint for the rest (for example with [`eslint-plugin-oxlint`](https://github.com/oxc-project/eslint-plugin-oxlint)), both can share one `approvals.json`:

```bash
npx eslint-exceptions --linter oxlint --merge
npx eslint-exceptions --linter eslint --merge
```

Then run `eslint-exceptions check --linter oxlint` and `eslint .` (with the processor) in CI.

---

## CLI reference

The package installs two equivalent commands: `eslint-exceptions` and `eslint-plugin-exceptions`.

```
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
```

Notes:

- **Linter detection:** without `--linter`, oxlint is used when the closest config file is `.oxlintrc.json`; otherwise ESLint is used. If both configs are in the same directory, ESLint is used. Pass `--linter` in scripts to be explicit.
- **Raw counts:** `generate` and `check` always see every violation, even if the ESLint processor is configured, so the counts are never filtered twice.
- **Merging:** `--merge` keeps the higher count for each entry and never removes entries. To shrink `approvals.json` after fixing violations, run `generate` without `--merge`.
- **Lowering counts:** `check` lists approvals that are higher than the actual count. Use `--strict` in CI to make them fail the build, so fixed violations can't come back unnoticed.
- **Exit codes:** `0` success, `1` unapproved violations (or a `--strict`/`--max-warnings` failure), `2` usage or linter error.
- **Binaries:** the CLI uses the linter installed in `node_modules`. If none is found, it falls back to `npx`.

`check` also works with ESLint (`--linter eslint`), for example where you can't add the processor to the config.

## Tips

### Monorepo support

Each package can have its own `approvals.json`. The nearest one up the directory tree is used for each file.

```
my-monorepo/
├── approvals.json          # Fallback for root-level files
├── packages/
│   ├── app/
│   │   ├── approvals.json  # Approvals for this package
│   │   └── src/
│   └── lib/
│       ├── approvals.json  # Approvals for this package
│       └── src/
```

Generate one per package with `--path`:

```bash
npx eslint-exceptions --path packages/app
npx eslint-exceptions --linter oxlint --path packages/lib
```

### Path format

Paths are relative to the directory that contains `approvals.json`. Use forward slashes (`/`), even on Windows:

```json
{
  "some-rule": {
    "src/components/Button.tsx": 2
  }
}
```

### Reducing technical debt

1. Generate the initial `approvals.json`.
2. When you fix violations in a file, lower its count (or run `generate` again without `--merge`).
3. Add `--strict` to `check` in CI so counts can't stay higher than needed.
4. The goal is to eventually remove each file from `approvals.json`.

## Debugging

To see how the ESLint processor filters each file, set `DEBUG_EXCEPTIONS`:

```bash
DEBUG_EXCEPTIONS=1 npx eslint src/
```

## Releasing

Releases are published to npm from GitHub Actions (`.github/workflows/publish.yml`) with [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored in the repo.

To release, open a PR that bumps `version` in `package.json` (and `package-lock.json`):

```bash
npm run release:minor   # or release:patch / release:major
```

When the PR is merged, the workflow sees a version that isn't on npm yet, runs the tests, publishes it and creates the `vX.Y.Z` tag and GitHub release. Merges that don't change the version publish nothing. To retry a failed publish, run the workflow by hand from the Actions tab.

## License

MIT
