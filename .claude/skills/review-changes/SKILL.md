---
name: review-changes
description: Final review of a completed conquarrow change — hunt invented rules, verify core purity and exact arithmetic, check spec↔tests↔code coherence and hexagonal boundaries, and keep SPEC.md self-consistent. Use as phase 4 of spec-to-ship, or when reviewing any rules-engine diff.
---

# review-changes — the coherence pass

You are the **reviewer** phase. The suite is already green; that is not what you
are checking. You are checking that the green suite is testing the right game.

## Priority order

Work in this order. The first two are what this pipeline exists for; the rest are
ordinary review.

### 1. Hunt invented rules

For every behaviour the implementation exhibits, **find the sentence in SPEC.md
that requires it.** Not a section that is broadly about the area — a sentence.

Flag anything without one, *even when it looks obviously correct*, and especially
then. A rule that looks obviously correct is precisely the one that got invented
rather than chosen; the spec is full of decisions whose plausible alternative is
also obviously correct.

Cheap way in: read the diff for conditionals and ask "who decided this branch?"

### 2. Verify purity and exactness

Grep the core for `Date.now`, `new Date`, `performance.now`, `Math.random`,
`process.`, `fetch`, `crypto`. Any hit inside the rules core is a **blocker**.

Then the ones that survive a grep:

- iteration over an unordered collection feeding an ordered decision
- `sort` without a total comparator — ties breaking on identity or insertion order
- `number` where SPEC says rational (accumulators §7, movement banking §3)

Check that the replay fixtures pass and were not re-recorded in this diff. A
re-recorded golden with no rule change in the same commit is a nondeterminism bug
being papered over — treat it as a blocker and ask what drifted.

### 3. Spec ↔ tests coherence

- Every Gherkin scenario has exactly one component test.
- Every EARS invariant has an assertion, preferably a property test.
- No test asserts on internal shape where behaviour was available.
- Tests run against ports, not concretions — except an I/O-edge suite whose
  subject is the adapter itself (`component-testing`).

### 4. Hexagonal boundaries

The core imports only from `contracts`. No geometry, renderer, storage or netcode
type crosses the seam. The practical check: **could a second `GeometryPort`
implementation satisfy this suite unchanged?** If not, something concrete leaked.

### 5. Complexity, dead code, naming, mutation

Naming against the AGENTS.md vocabulary table — *point* vs *vertex*, *cut* vs
*crossing*. Drift here is not pedantry; these terms name different objects and a
blurred name becomes a blurred test.

Complexity of functions **this diff grew** past the budget is a request to
extract, not a repo-wide cleanup ticket. Pre-existing warnings on untouched
lines are the ratchet, not a blocker.

If the packet touched `mutate[]` files, expect a Stryker note. New survivors
without a noise classification are a blocker. A test-kit import or manifest
entry in `contracts` / `rules-core` / `geometry-*`, or a test-kit package in
`dependencies` rather than `devDependencies`, is a **blocker** — test-kit is an
I/O-edge tool (see `component-testing`).

## Spec hygiene — you are one of two phases that may edit SPEC.md

- §11 items this packet closed are marked **resolved in place**, pointing at the
  section that now owns them. Not deleted — the record of what was once open is
  useful, and SPEC.md already uses this convention.
- Gaps found during the run were **added** to §11, not quietly decided.
- No two sections now contradict each other. This document has been revised many
  times and a change that invalidates earlier prose must fix the prose. Two
  sections disagreeing is worse than either being wrong.

## Output

A verdict with actionable findings, most severe first, each naming the file and
line and the SPEC / ADR sentence (or its absence). When clean, prepare the PR:
title, body (starts with `🤖: `) linking the packet and the spec files.

## Ship

The **orchestrator** pushes, opens the PR, requests Copilot, triages, and
squash-merges. The reviewer does **not** push. Never push `shalevhoch`.
