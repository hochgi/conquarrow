---
name: verify-changes
description: >-
  Phase 4 of spec-to-ship. Mechanical read-only gate: re-run pnpm verify, and
  the mutation command when the patch touches rules-core or online-api. Kick
  every new survivor back. Do not judge mutants, accept a failure, or review
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

## 2. Mutation, only when the patch touches those files

```bash
pnpm test:mutation:incremental    # stryker.config.json mutate[] — packages/rules-core/src
pnpm test:mutation:online-api     # packages/online-api
```

Run the first when the patch touches a file in `mutate[]`. Run the second when
it touches `packages/online-api`. Do not add web to Stryker. Do not run CRAP
as a gate. Do not run either command on a patch that touches neither tree.

`break` is `null`. A zero exit does not mean the patch is clean. Read the
summary. A survivor that was not in the baseline is new. Every new survivor
goes back to test-author. Pre-existing survivors are named and left.

## Kick-back

| Failure | Next |
|---|---|
| `pnpm verify` exits non-zero | coder |
| A new survivor | test-author: kill it with a test, or suppress it with its invariant |
| A zero-mutant run, or a script that crashes | the orchestrator |

## Handoff

Report, command by command, the exit code and the summary lines. Include the
new-survivor list as printed, and the suppressions on the patch — the
orchestrator passes that list to the reviewer verbatim. **Pass** only when
`pnpm verify` exits 0 and the new-survivor list is empty. You do not push and
you do not open a PR.
