# CodeRelic

CodeRelic is a lightweight command-line tool for finding code that **may have been abandoned** by analyzing repository history and code relationships.

CodeRelic does not claim that a file is definitely dead or safe to delete. Instead, it combines multiple signals and produces an explainable **Evidence Score** so developers can investigate suspicious files before removing them.

## What It Checks

CodeRelic currently analyzes:

- Git file history and file age
- Relative imports and `require()` relationships
- Static imports
- Dynamic `import()` calls
- Re-export relationships
- Test-file references
- Possible framework/runtime-managed files
- Feature / area-level activity
- An explainable Evidence Score

## Evidence Score

Each old file receives a score from `0` to `100`.

Higher scores mean that the available evidence is more consistent with an abandoned file.

Current scoring signals:

| Signal | Effect |
|---|---:|
| Old file | +40 |
| No importers | +30 |
| Imported by files | -10 per importer, capped at -30 |
| No test references | +20 |
| Referenced by tests | -5 per test reference, capped at -15 |
| Runtime/framework signal | -30 |

The final score is clamped between `0` and `100`.

### Evidence labels

- `HIGH` — score `70–100`
- `MEDIUM` — score `40–69`
- `LOW` — score `0–39`

These labels describe the strength of the available evidence, not certainty that the code is unused.

## Evidence Breakdown

CodeRelic explains how each score was produced.

Example:

```text
Evidence breakdown:
  +40  Old file
  +30  No importers
  +20  No test references

Evidence score: 90/100
Evidence: HIGH
```

For a file with active relationships or a framework signal:

```text
Evidence breakdown:
  +40  Old file
  -20  Imported by 2 files
  -10  Referenced by 2 tests
  -30  Runtime/framework signal

Evidence score: 0/100
Evidence: LOW
```

This makes the score auditable instead of presenting a number without explanation.

## Installation

Clone the repository:

```bash
git clone https://github.com/usejd66/coderelic.git
cd coderelic
npm install
```

For local CLI development, link CodeRelic globally:

```bash
npm link
```

## Usage

Scan the current Git repository:

```bash
coderelic scan
```

The default age threshold is `180` days.

Use a custom age threshold:

```bash
coderelic scan --days 90
```

The supported range is:

```text
1–365 days
```

Display help:

```bash
coderelic --help
```

You can also run the CLI directly during development:

```bash
node index.js scan
```

## Example Output

```text
CodeRelic
────────────────────────────────────────
Scanning repository...
Age threshold: 180 days

Files analyzed: 42

Possible abandoned files:

👻 src/legacy/old-feature.js
   Last changed: 2025-01-10
   Imported by: 0
   Test references: 0

   Evidence breakdown:
   +40  Old file
   +30  No importers
   +20  No test references

   Evidence score: 90/100
   Evidence: HIGH

Feature / area analysis:

>> legacy/
   Files: 4
   Old files: 3
   Active imports: 0
   Test references: 0
   Evidence score: 70/100
   Evidence: HIGH

────────────────────────────────────────
Old files found: 3
High-confidence candidates: 2
Medium-confidence candidates: 1
Feature areas analyzed: 5
```

The actual results depend on the repository being scanned.

## How CodeRelic Interprets Results

A file being old does **not** automatically mean that it is abandoned.

For example:

- A file may be old but still be imported.
- A framework may load a file automatically.
- A dynamic import may not be visible as a normal static import.
- Tests may still reference the file.
- A file may be intentionally retained for compatibility or future use.

CodeRelic therefore treats its output as **evidence for investigation**, not an automatic deletion recommendation.

## Runtime / Framework Signals

Some files may be used without being imported directly.

CodeRelic currently treats names and directories such as the following as possible runtime/framework signals:

```text
index.*
controller.*
route.*
router.*
middleware.*
handler.*
plugin.*
page.*
layout.*
```

and directories such as:

```text
routes/
pages/
api/
controllers/
handlers/
middleware/
plugins/
```

These are signals only. CodeRelic does not assume that every framework-managed file is active.

## Feature / Area Analysis

CodeRelic groups files by their first path segment.

For example:

```text
payments/PaymentService.js
payments/PaymentController.js
users/UserService.js
users/UserController.js
legacy/OldFeature.js
```

can be analyzed as:

```text
payments/
users/
legacy/
```

The area analysis reports:

- Total files
- Old files
- Active import relationships
- Test references
- Evidence score
- Evidence label

This provides a higher-level view of areas that may deserve investigation.

## Supported Source Files

CodeRelic currently analyzes these source extensions:

```text
.js
.jsx
.ts
.tsx
.mjs
.cjs
```

## Test Detection

CodeRelic recognizes common test naming and directory patterns:

```text
.test.
.spec.
__tests__/
tests/
test/
```

## Development

Install dependencies:

```bash
npm install
```

Run the test suite:

```bash
npm test
```

The project uses Node.js's built-in test runner:

```text
node --test
```

## Project Structure

```text
coderelic/
├── index.js
├── src/
│   └── scoring/
│       └── evidence.js
├── test/
│   ├── coderelic.test.js
│   └── scoring/
│       └── evidence.test.js
├── package.json
├── package-lock.json
├── README.md
└── .gitignore
```

## Current Scope

CodeRelic is intentionally focused on evidence-based repository analysis.

It currently does not attempt to prove that code is mathematically or semantically unreachable, nor does it automatically delete files.

The project is designed to help developers identify suspicious areas and investigate them safely.

## Roadmap

Possible future directions include:

- More language support
- More framework-specific runtime detection
- Better AST-based analysis
- More precise symbol-level reachability
- Additional Git history signals
- CI integration
- Machine-readable output
- Configurable scoring rules
- More detailed repository reports

These features are future possibilities and are not required for the current `v0.1.0` scope.

## Contributing

Contributions are welcome.

Before submitting changes:

```bash
npm test
```

Please keep changes focused and include tests for new behavior.

## License

ISC

## Author

**Usejd Nasufi**

CodeRelic is created and maintained by Usejd Nasufi.

- GitHub: [@usejd66](https://github.com/usejd66)
- Repository: [github.com/usejd66/coderelic](https://github.com/usejd66/coderelic)
