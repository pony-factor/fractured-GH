# Tests

The Node.js test suites mirror the feature areas in `features/`:

- `commits/` — commit formatting.
- `interface/` — shared GitHub interface behavior and styles.
- `notifications/` — inbox and notification behavior.
- `people/` — profile, nickname, and avatar behavior.
- `pull-requests/` — pull request controls and notices.
- `repositories/` — repository controls and navigation.
- `writing/spellcheck/` — spellcheck, ChatGPT integration, drafts, and images.

Filename prefixes should not repeat their parent folder: for example,
`repositories/hide-languages.test.cjs` rather than
`repositories/hide-repository-languages.test.cjs`, and
`writing/spellcheck/undo.test.cjs` rather than
`writing/spellcheck/spellcheck-undo.test.cjs`.

Run all tests from the repository root with:

```sh
node --test
```

The built-in Node.js test runner discovers nested `*.test.cjs` files.
To run a particular suite, pass its path to `node --test`.
