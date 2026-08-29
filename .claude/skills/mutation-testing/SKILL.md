---
name: mutation-testing
description: >-
  Workflow for mutation-testing rules-core (and later online-api) with Stryker's
  vitest-runner and triaging survivors. Baseline → implement → compare → triage.
  Use in code-to-green and review-changes, or when a test gap is suspected.
---

# Mutation testing workflow

For any non-trivial change that touches behaviour we care about (anything in
`stryker.config.json` `mutate[]`). Runner: **`@stryker-mutator/vitest-runner`**.
`break` is `null` — the score is **advisory/triaged**, not a hard gate.

Skip for typo fixes, doc-only changes, mechanical refactors with no behaviour
delta.

This skill is one step inside `code-to-green` / `review-changes`. Committed
tests are plain Vitest. Do not add `@vnatures/test-kit` to kill a mutant.

## Running Stryker

```bash
pnpm test:mutation
pnpm test:mutation:incremental
pnpm test:mutation:report
```

Use `:incremental` while iterating; full run when capturing a baseline or
before calling a packet done.

### Local run

Stryker is **not** in CI. Run it in a normal terminal (agent tool-call
timeouts will kill a full `rules-core` pass). Format survivors with
`pnpm test:mutation:report`.

First cut mutates `packages/rules-core/src/**/*.ts` (except the barrel).
Online-api joins `mutate[]` when that package exists.

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
- Incremental Stryker run on changed mutate[] files.
- Every NEW survivor killed or classified as noise with rationale.
- Handoff includes a one-line mutation summary per mutated file.

## When NOT to follow this loop

- Typos, comments, dependency bumps with no API change.
- Mechanical refactors with identical observable behaviour.
- Doc-only PRs, including P14's ADR.

## Reference

- `stryker.config.json` — `mutate[]`, `excludedMutations`, and `ignorePatterns`.
  `ignorePatterns` excludes `.claude` / `.agents`: the skill directories contain
  symlinks that point outside the repo, and Stryker's sandbox copy follows them.
- `scripts/format-stryker-report.cjs`
- `scripts/crap-report.cjs`
- Companion: `code-to-green`, `engineering-principles`, `rules-invariants`.
