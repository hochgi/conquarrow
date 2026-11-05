# ADR 0001 — A pure deterministic core behind pluggable geometry

**Status:** Accepted
**Date:** 2026-08-02
**Amended:** 2026-11-05 (P86)
**Context:** [`SPEC.md`](../../SPEC.md), [`AGENTS.md`](../../AGENTS.md)

## Context

Conquarrow is a turn-based game whose rules were specified in full before
any code existed. Two properties of that specification drive this decision.

**The design contains no randomness at all.** Combat is a deterministic
exchange with no dice: losses follow a threat-weighted floor rule, and equals
favour the attacker (§6.2). Spawner timing is deliberately irregular but fully
computable — coprime denominators over a round-robin (§7). The spec repeatedly
chose determinism *as a feature*: "a six-turn enclosure never dies to a bad
roll; it dies to being outplayed."

**Every rule depends on the arrow graph.** When this ADR was written, SPEC §2's
orientation pattern, shortest U-turn loop, and whether a minimal cycle's three
arrows are the same three that border a spawner vertex were unmeasured
properties of the real tiling. All three are now measured (§2: alternating,
U-turn 3, one spawner vertex per minimal cycle) and P03 generates the board.
The port stays: readable fixture boards earn it on their own.

## Decision

**1. The rules engine is a pure function.**

```
apply(state, move) -> state
```

No clocks, no randomness, no I/O, no input mutation anywhere in the core.

**2. Geometry is a port with multiple implementations.**

`GeometryPort` exposes adjacency, arrow direction, bounded enumeration, the point
lattice, the spawner-vertex lattice, and the chord test. It has at least two
implementations: hand-authored fixture boards, and the generated tiling.

The board is unbounded (SPEC §2), so enumeration is `window(centre, radius)`,
never "all of it". A port that exposed board size would have needed every
caller rewritten when the board stopped having one.

**3. Accumulators use exact rational arithmetic**, not floating point.
Movement allowance is a whole number (SPEC §3) and needs none.

## Consequences

### Good

- **Replays are exact.** A match is an initial state plus an ordered move list,
  so a replay reproduces the final state byte-for-byte. This gives cheap,
  enormously broad regression coverage and — more importantly — it is the only
  reliable detector of accidental nondeterminism.
- **The rules can be built against fixtures.** Fixture boards satisfy the same
  port and the same tests as the generated tiling.
- **Fixture boards make failures readable.** A bug on a three-arrow pinwheel is
  legible in a way the same bug on a full board is not.
- **Netplay cannot desync**, and an AI can search the state space directly,
  without a simulation/authority split.
- **Player-computable rhythm survives implementation.** The spawner pattern is
  only interesting because a player can work it out; float drift would make it
  merely noisy.

### Costs

- Rational arithmetic is more code than `number` and needs a total ordering for
  comparisons.
- The port boundary costs indirection on every geometry query, in a hot path.
  Accepted: correctness and testability first, and the fixture/real split pays
  for the indirection on its own.
- Purity has to be actively defended. The realistic violations are not `Math.random`
  but ordering — iteration over a `Set` that happens to match input order, or a
  `sort` whose ties break on object identity. Both pass unit tests. Both surface
  only as replay drift, which is why P10 lands early.

### Rejected alternatives

- **A single concrete geometry, built after the measurement.** Simpler, and it
  blocks the whole game behind one measuring task while making every rules test
  run against a large board nobody can reason about.
- **Floats for accumulators.** Materially simpler, and it silently destroys the
  exactness the economy's whole texture rests on.
- **Seeded PRNG for tiebreaks.** Tempting for "arbitrary" choices, and a trap:
  every tiebreak in this spec turns out to be a rule that was decided (equals
  favour the attacker, round-robin order, birth-cuts in arrow-id order). A PRNG
  would hide a missing decision rather than surface it.
