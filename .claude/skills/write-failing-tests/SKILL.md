---
name: write-failing-tests
description: Turn a conquarrow spec into a red suite — one component test per Gherkin scenario, property tests per EARS invariant, replay fixtures for turn flow, plus compiling skeletons. Use as phase 2 of spec-to-ship.
---

# write-failing-tests — approved spec → red suite

You are the **test-author** phase. You run after phase 1 wrote the spec. Your
output is a suite that fails for the *right* reasons and a set of skeletons
thin enough that nobody mistakes them for an implementation.

## What you produce

1. **One component test per Gherkin scenario**, written against the ports in
   `packages/contracts` — never against a concrete geometry, renderer, or store.
   A second implementation of the port must be able to satisfy the same test.
   **Runner is Vitest.** At an I/O edge (`packages/online-api`) a component test
   may probe the seam with `@hochgi/test-kit*` — follow `component-testing` for
   the boundary choice, rig lifecycle and failure injection. **Never** in
   `contracts`, `rules-core` or `geometry-*`; a core test that "needs a probe"
   means the design leaked I/O into the core.
2. **A property test per EARS invariant**, where it is expressible as one. Most
   of this spec's invariants are. See `rules-invariants` for the catalogue.
3. **A replay fixture** whenever the packet touches turn flow — initial state
   plus an ordered move list, asserted to reproduce an exact final state.
4. **Minimal skeletons** so the suite compiles: signatures and types only, no
   logic, strict, no `any`. A skeleton that accidentally implements something is
   a phase-3 bug planted in phase 2.

## Fixture boards

Test against small hand-authored boards with known adjacency, not the real
tiling, which is **unbounded** (SPEC §11 item 4) and so cannot be enumerated,
printed or diffed whole:

- `minimal` — the 7-point board (`K₇`); the conformance witness and anything about a single point's neighbourhood
- `spacious` — the 8-point board, undirected diameter 2; the smallest conformant board that can express "not adjacent" or "outside the window"

Readable failures, instant runs, and they keep passing unchanged when generated
geometry lands behind the same port.

## Red for the right reason

Run the suite and **read the failures**. Each new test must fail because the
behaviour is missing — not because:

- it does not compile,
- a fixture is malformed,
- an assertion is comparing the wrong shape,
- or the port signature is wrong.

A test that is red for a setup reason will go green in phase 3 without the
behaviour ever being implemented. Verify each one individually; do not eyeball a
wall of red and call it done.

## Assert on behaviour, not on shape

`Then` steps came from the spec as observable behaviour — keep them that way.
Assert "player A holds the three arrows bordering vertex v" rather than
"`state.territory.byArrow` has these keys." Internal shape is phase 3's business
and will change under refactor; a test coupled to it will be weakened rather
than fixed.

## When you must stop

If a scenario cannot be tested without knowing a behaviour the spec does not
state, **do not pick one.** Report it as a blocking gap and hand back to phase 1.
Inventing it here is worse than inventing it in phase 3, because the invented
rule now arrives wearing the authority of a test.

## Gate

Stop when the suite is red. Report: scenarios covered, invariants encoded as
properties, replay fixtures added, and confirmation that each failure was
individually checked.
