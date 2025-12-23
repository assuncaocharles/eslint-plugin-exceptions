# eslint-plugin-exceptions

An ESLint plugin that allows you to approve a specific number of rule violations per file using an `approvals.json` configuration file.

## Why?

Sometimes you need to gradually migrate a codebase to stricter linting rules. This plugin lets you:

- Track known violations in a structured way
- Prevent new violations while allowing existing ones
- Gradually reduce the approved count as you fix issues

## Installation

```bash
npm install eslint-plugin-exceptions --save-dev
```

## Configuration

### 1. Create `approvals.json`

Create an `approvals.json` file at the root of your project (or package):

```json
{
  "no-underscore-dangle": {
    "src/legacy/utils.ts": 5,
    "src/components/DataGrid.tsx": 3
  },
  "@typescript-eslint/no-explicit-any": {
    "src/api/client.ts": 10,
    "src/types/legacy.ts": 25
  }
}
```

The format is:

```json
{
  "rule-name": {
    "relative/path/to/file": numberOfAllowedViolations
  }
}
```

### 2. Configure ESLint

#### Flat Config (ESLint 9+, `eslint.config.js`)

```javascript
import exceptions from "eslint-plugin-exceptions";

export default [
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      exceptions,
    },
    processor: "exceptions/passthrough",
  },
  // ... your other configs with rules
];
```

Or use the recommended config:

```javascript
import exceptions from "eslint-plugin-exceptions";

export default [
  exceptions.configs.recommended,
  // ... your other configs
];
```

#### Legacy Config (`.eslintrc.js`)

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

## How It Works

1. ESLint runs all your configured rules normally
2. The plugin's processor intercepts the results
3. For each file, it looks for an `approvals.json` in the file's directory or any parent directory
4. Violations are grouped by rule
5. If a file has approved exceptions for a rule, those violations are filtered out (up to the approved count)
6. Any violations beyond the approved count are reported normally

### Example

Given this `approvals.json`:

```json
{
  "no-underscore-dangle": {
    "src/utils.ts": 3
  }
}
```

And `src/utils.ts` with 3 underscore violations:

- ✅ No errors reported (3 violations ≤ 3 approved)

If you add a 4th underscore variable:

- ❌ 1 error reported (4 violations > 3 approved)

The error message will include context:

```
Unexpected dangling '_' in '_privateVar' (4 violations found, but only 3 approved in approvals.json)
```

## Supported File Extensions

The plugin includes processors for common file types:

- `.js`, `.jsx`
- `.ts`, `.tsx`
- `.mjs`, `.cjs`
- `.mts`, `.cts`
- `.vue`, `.svelte`

## Tips

### Monorepo Support

Each package can have its own `approvals.json`. The plugin searches up the directory tree from each file to find the nearest `approvals.json`.

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

### Path Format

Use forward slashes (`/`) in paths, even on Windows:

```json
{
  "some-rule": {
    "src/components/Button.tsx": 2
  }
}
```

### Reducing Technical Debt

Start by documenting all existing violations:

```bash
# Run ESLint and note the violations per file
npx eslint src/ --format json > violations.json
```

Then create your `approvals.json` based on the current state. Over time, reduce the counts as you fix issues.

## License

MIT
