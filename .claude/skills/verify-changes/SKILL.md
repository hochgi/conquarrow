---
name: verify-changes
description: >-
  Phase 4 of spec-to-ship. Mechanical read-only gate: re-run pnpm verify, and
  a scoped Stryker run (pnpm test:mutation:changed) on every change. Kick
  every survivor back. Nothing to mutate is a failure. Do not judge mutants, accept a failure, or review
  spec coherence.
---

# verify-changes

You are the **verifier**. You are read-only and mechanical. Every check is
pass or fail from its exit code or, for mutation, from the new-survivor list.
You never classify a mutant, accept a failure, or judge a suppression.
`review-changes` does that in phase 5.

## 1. Re-run the gate

```bash
pnpm verify
```

**A skipped run is not a clean run.** If you did not run it, do not report it.
The exit code is the verdict. Do not interpret a failure as close enough.

## 2. Mutation — always, scoped to the change

```bash
pnpm test:mutation:changed
```

Mandatory on every patch that touches `packages/*/src`, in any package
(web, contracts, byok-offer, rules-core, online-api, …). The script mutates
only the changed line ranges (merge-base with `main` → working tree), runs
only the tests that import them, and exits:

- **0** — every mutant on the changed lines killed, timed out, or suppressed.
- **2** — survivors or `NoCoverage` mutants, printed one per line. All of
  them are this patch's: only changed lines are mutated.
- **1** — nothing to mutate, no test reaches the change, zero mutants, or a
  crash. **This is a failure, not a pass.** Source changed and the run did
  not cover it, so the scope is wrong.

If the touched package or file is not covered, the fix is to extend or scope
the config (`scripts/stryker-changed.mjs`, `stryker.changed.config.json`) to
the changed files — never to skip. Never use a whole-package run
(`test:mutation`, `test:mutation:incremental`, `test:mutation:online-api`) as
the gate; an incremental run always uses a scoped mutate list. Do not run CRAP
as a gate.

## Kick-back

| Failure | Next |
|---|---|
| `pnpm verify` exits non-zero | coder |
| `test:mutation:changed` exits 2 | test-author: kill it with a test, or suppress it with its invariant |
| `test:mutation:changed` exits 1, or crashes | the orchestrator: extend or scope the config; do not skip |

## Handoff

Report, command by command, the exit code and the summary lines (the
`stryker-changed: score` line and the mutate ranges included). Include the
survivor list as printed, and the suppressions on the patch — the
orchestrator passes that list to the reviewer verbatim. **Pass** only when
`pnpm verify` exits 0 and `pnpm test:mutation:changed` exits 0. You do not push and
you do not open a PR.
