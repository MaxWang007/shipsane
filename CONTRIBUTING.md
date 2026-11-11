# Contributing to shipsane

You will need Node.js 20 or newer, npm, and git.

```bash
git clone https://github.com/MaxWang007/shipsane.git
cd shipsane
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

`npm test` uses Node's built-in test runner via `tsx` and should finish in a few seconds. Fixture repos live under `test/fixtures/` as `before/` and `after/` trees; the tests turn those into throwaway git checkouts so we do not have to store `.git` directories.

When you add a detector, give it:

- a rule id in `src/types.ts` and a one-pager in `src/rules.ts`
- a fixture under `test/fixtures/`
- a golden finding (rule + path, plus a line number when it applies)

Please keep findings deterministic. shipsane must not call a model, and tests must not need the network.

If a real project produces a false positive, add a fixture that reproduces it and tighten the detector, or document why an allow rule with a reason is the right escape hatch.
