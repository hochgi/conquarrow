---
name: review-changes
description: Final review of a completed conquarrow change — hunt invented rules, verify core purity and exact arithmetic, check spec↔tests↔code coherence, every SCENARIOS.md path, and every suppression. Use as phase 5 of spec-to-ship, or when reviewing any rules-engine diff.
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

### 1b. Message flows

A protocol delivery has `docs/spec/<feature>/SCENARIOS.md`. Every path,
including every `alt`, `opt`, and `par`, has a `@hochgi/test-kit` component
test that asserts the diagram's messages: order, method, path, and the visible
outcome. A scripted fetch that calls the same functions is not that test. A
probed SDK client, or a leaf that owns the rule, is a boundary miss. A protocol
branch with no diagram is an invented flow. The example is
`packages/web/test/session-expired.scenarios.test.ts`.

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

The verifier's new-survivor list must be empty. Judge every suppression on the
patch: the invariant has to hold for every input, not only the tested ones. A
coder's "equivalent" is not that judgment. A test-kit import or manifest
entry in `contracts` / `rules-core` / `geometry-*`, or a test-kit package in
`dependencies` rather than `devDependencies`, is a **blocker** — test-kit is an
I/O-edge tool (see `component-testing`).

## Spec hygiene

You are read-only. A SPEC.md fix is a kickback to phase 1.

- A closed §11 item is deleted from §11, and the rule is stated in the section
  that owns it. No strikethroughs, "resolved" or "withdrawn" notes
  (AGENTS.md, "SPEC.md states the current design, once"). History is git's job;
  a non-obvious *why* goes in an ADR or the packet.
- A gap found during the run is in §11, not quietly decided.
- No two sections contradict. Two sections disagreeing is worse than either
  being wrong.

## Output

A verdict with actionable findings, most severe first, each naming the file and
line and the SPEC / ADR sentence (or its absence). When clean, prepare the PR:
title, body (starts with `🤖: `) linking the packet and the spec files.

## Ship

The **orchestrator** pushes, opens the PR, and squash-merges once CI is
green. The reviewer does **not** push. Never push `shalevhoch`.
