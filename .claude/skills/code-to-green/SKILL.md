---
name: code-to-green
description: The red→green→refactor loop for conquarrow — implement behind the ports until the approved suite passes, keep the rules core pure and its arithmetic exact, and kick back rather than invent a rule. Use as phase 3 of spec-to-ship.
---

# code-to-green — red suite → green implementation

You are the **coder** phase. You run after the failing tests are red for the
right reason. Your job is to make them pass without changing what they mean.

## The loop

1. **Green.** Implement the minimum that turns the suite green.
2. **Refactor.** Fit the complexity budget by extracting, never by disabling a
   rule or splitting a function arbitrarily to duck a line count.
3. **Replay.** Re-run the replay fixtures. Green unit tests plus a drifted
   replay means you introduced nondeterminism.
4. **Stryker.** `pnpm test:mutation:incremental` on files you touched that sit
   in `mutate[]`. Triage per `mutation-testing`. No new survivors.
5. **CRAP glance.** `pnpm crap` is advisory. If you grew a function you
   touched past the complexity budget, extract. Do not churn the rest of the
   file to silence a warning you did not cause.
6. Repeat until green, clean, and stable.

## What you may not do

- **Change the spec.** Phases 1 and 4 own `SPEC.md`. If the implementation wants
  the spec different, that is a phase-1 kickback.
- **Weaken a test.** Not by loosening an assertion, not by widening a tolerance,
  not by deleting a case that "was testing the old design."
- **Invent a rule.** See below — this is the one that actually happens.

## The trap: design calls wearing implementation clothes

In this codebase "just make the test pass" routinely conceals a rule decision.
Real examples from the spec's own surface:

- Which stack does a fork's evaporation charge when two branches share a sentry?
- Does a chord that *coincides* with a trail arrow resolve before or after
  movement completes?
- Does an accumulator carry across a capture? (No — it resets. But the carry
  path is right there and it will look like an oversight.)
- Which arrow does a spawned head occupy when the round-robin target is full?

When you meet one:

1. **Check SPEC.md first.** It very likely answers it, and the answer is often
   three sections away from where you are looking. This spec is dense and
   cross-referential by design.
2. If it genuinely does not answer it, **stop and kick back to phase 1.** Add the
   gap to §11 and report it. Do not choose the sensible option.

An invented rule that passes the tests is the most expensive artifact this
pipeline can produce, because it looks designed and nothing will flag it again.

## Purity — the guardrail you cannot trade away

No `Date.now()`, no `Math.random()`, no I/O in the core. Not in a helper, not for
a tiebreak, not behind a flag. Determinism is a product property here (see
AGENTS.md), not a testing convenience.

The quiet violations that survive review:

- iterating a `Set` or `Map` whose order depends on input order, then making an
  ordered decision from it
- `Array.prototype.sort` without a **total** comparator — ties must break on a
  stable meaningful key (arrow id), never on object identity or insertion luck
- floating-point accumulation where the spec says rational

## Exact arithmetic

Spawner force is a **rational** (SPEC §7), and the entire point of coprime
denominators is that the resulting pattern is exact and player-computable.
Represent accumulators as integer numerator/denominator, not `number`.

The §7 accumulators are the **only** consumer of exact rationals. Movement is not
one: §3 is `speed(N) = 1 + floor(log₂ N)`, a whole integer with nothing carried
between turns — see `speed` in `packages/contracts/src/move.ts`.

`1/9 + 1/12` must be exactly `7/36`. If it is `0.19444444444444445`, the
"deterministic irregularity" the design is built on becomes drift.

## Gate

You do not stop mid-loop and you do **not** open the PR. Hand to the reviewer
reporting green state, lint/typecheck status, Stryker triage (new survivors
killed vs ignored), and — importantly — every question you had to kick back
rather than answer.

At an online I/O edge the red suite may drive `@hochgi/test-kit*` probes; read
`component-testing` before making one green — failure injection goes through
probe rules, not a new hand-written fake. Never add test-kit to `contracts`,
`rules-core` or `geometry-*`, not even to kill a mutant.
