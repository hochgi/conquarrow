---
name: mutation-testing
description: >-
  Workflow for mutation-testing every change with Stryker's vitest-runner,
  scoped to the changed lines (pnpm test:mutation:changed). The verifier lists new survivors and does not classify them.
  test-author kills or suppresses. The reviewer judges every suppression.
  Use from verify-changes, or when a test gap is suspected.
---

# Mutation testing workflow

**Every change to `packages/*/src` gets a Stryker run, in every package.**
Runner: **`@stryker-mutator/vitest-runner`**. The gate is
`pnpm test:mutation:changed`: it mutates only the lines the branch changed and
fails on any survivor, any no-coverage mutant, and on a run with nothing to
mutate. The whole-package configs keep `break: null`; they are baselines.

Skip for typo fixes, doc-only changes, mechanical refactors with no behaviour
delta.

The verifier runs the command and lists new survivors. It does not classify
them. test-author kills each with a test, or suppresses it with the invariant.
The reviewer judges every suppression. A coder's "equivalent" is not a verdict.
Do not add test-kit to kill a rules-core mutant —
rules-core may never use it (see `component-testing`).

## Running Stryker

```bash
pnpm test:mutation:changed                 # THE GATE: changed lines, related tests only
pnpm test:mutation:changed --dry           # print the mutate ranges and tests, run nothing
pnpm test:mutation:changed --base <ref>    # diff against another base
pnpm test:mutation                         # whole rules-core baseline (hours)
pnpm test:mutation:incremental
pnpm test:mutation:report
pnpm test:mutation:online-api              # stryker.online-api.config.json
pnpm test:mutation:online-api:incremental
```

### The scoped run

`scripts/stryker-changed.mjs` diffs the merge-base with `main` (`hochgi/main`,
`upstream/main` or `origin/main`, or `--base`) against the working tree, and
turns every changed line range under `packages/*/src/**/*.{ts,tsx}` (barrels
excepted) into one `--mutate 'file:start-end,…'`. It walks each test's static
runtime import closure (`import type` skipped; a named import from a package
barrel follows only the files that export those names) and writes the tests
that reach a mutated file into `vitest.changed.config.mjs` (gitignored), which
`stryker.changed.config.json` runs. Exit 0 pass, 2 survivors, 1 nothing to
mutate / no test reaches it / zero mutants / crash.

When a change is not covered — a new package, a new file kind, a test the
closure misses — fix the script or the config so it is. Do not skip, and do
not swap in a whole-package run. A `.tsx` component with no DOM harness: move
the decision into a pure module and test it there; suppress only the wiring
line in the component, with the reason.

Target a few files by hand with **one comma-separated** `--mutate`
(Stryker keeps only the last of repeated flags):
`npx stryker run stryker.online-api.config.json --mutate 'packages/online-api/src/a.ts,packages/online-api/src/b.ts'`.

Line ranges work too: `--mutate 'packages/web/src/a.ts:10-24'`. An
incremental run always uses a scoped mutate list; a whole-package run is only
for a baseline.

### Local run

Stryker is **not** in CI. The scoped run takes about a minute; a full
`rules-core` pass takes hours and will be killed by agent tool-call timeouts. Format survivors with
`pnpm test:mutation:report`.

`stryker.config.json` mutates `packages/rules-core/src/**/*.ts` (except the
barrel). `stryker.online-api.config.json` mutates `packages/online-api/src/**`
and runs only online-api's tests (`vitest.online-api.config.mjs`); its edge
seams are tested with test-kit (`component-testing`). Survivors there are
triaged the same way — equivalent, not sensible (message text, unreachable
SDK shapes, composition-root wiring), or a missing test.

### Baseline capture

Before writing new tests or code, capture the current survivor count on the
files you are about to touch. After implementation, re-run and compare.
**The bar is: no NEW survivors introduced.** Pre-existing survivors are
pre-existing — flag them, do not take them as this packet's job.

If the files are new, there is no baseline — say so in the handoff.

## Triage

`excludedMutations` already drops `StringLiteral` and `ObjectLiteral`. For
everything that survives, walk worst-covered file first. Classify:

- **Real bug the tests didn't catch.** A user would observe a wrong outcome
  → fix the code, add or strengthen a **committed** Vitest test.
- **Missing coverage.** Observable behaviour, no assertion → add a focused
  test that kills it.
- **Noise.** Semantically equivalent / unobservable → suppress with an inline
  comment + rationale, or narrow `mutate[]`.

Lean on: "If this shipped, would it produce a wrong outcome a player could
see?" Yes → kill. No → noise.

### Do not write tests to kill trivial mutations

Ignore (do not test):

- log-statement / HUD-string swaps with no control-flow change
- cosmetic literals in error messages that are not a typed contract
- dead-code-equivalent branches protected by a stronger guard upstream

A test whose only job is pinning a mutant with no user-observable consequence
is slop.

### Stryker disable comments

```ts
// Stryker disable next-line LogicalOperator -- equivalent given the guard
// above; the mutant is unobservable at the port.
```

Unacceptable: "no test calls this" for something a player could observe.

## CRAP (companion, also advisory)

`pnpm crap` prints functions that are complex *and* under-tested (CRAP) and
functions over the complexity budget even when well covered.

- **Not a gate.** `CRAP_FAIL` stays unset.
- Coverage can hide high complexity (the CRAP term shrinks). The number we
  will eventually error on is **raw complexity**, currently ESLint `warn`.
- Boy-scout: if you *touch* a hot function, do not make its CRAP or
  complexity worse; extract if you grew it past the budget. You do not have
  to clean the whole file.

## What "done" looks like

- Suite green, lint/typecheck clean (complexity warnings on *untouched*
  files are the ratchet, not a blocker).
- `pnpm test:mutation:changed` exits 0 on the final diff.
- Every survivor on the changed lines killed, or suppressed with a
  `// Stryker disable next-line <Mutator> -- reason` the reviewer accepts.
- Handoff and PR body include the `stryker-changed: score` line.

## When NOT to follow this loop

- Typos, comments, dependency bumps with no API change.
- Mechanical refactors with identical observable behaviour.
- Doc-only PRs, including P14's ADR.

## Reference

- `scripts/stryker-changed.mjs` + `stryker.changed.config.json` — the scoped gate.
- `stryker.config.json` — `mutate[]`, `excludedMutations`, and `ignorePatterns`.
  `ignorePatterns` excludes `.claude` / `.agents`: the skill directories contain
  symlinks that point outside the repo, and Stryker's sandbox copy follows them.
- `scripts/format-stryker-report.cjs`
- `scripts/crap-report.cjs`
- Companion: `code-to-green`, `engineering-principles`, `rules-invariants`.
