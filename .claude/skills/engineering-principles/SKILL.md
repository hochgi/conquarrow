---
name: engineering-principles
description: The standing engineering conventions for conquarrow — purity, exact arithmetic, hexagonal boundaries, naming from the spec vocabulary, and the complexity budget. Use when writing or reviewing any code in this repo, or when a judgement call about structure comes up mid-implementation.
---

# Engineering principles

Standing conventions. `AGENTS.md` is the short form; this is the reasoning.

## 1. The core is a pure function

```
apply(state, move) -> state
```

No clocks, no randomness, no I/O, no input mutation, anywhere inside the rules
core. This is a **product property**, not a test convenience — SPEC.md contains
no randomness by design, and the whole appeal of the multi-prong bonus and the
spawner rhythm is that an attentive player can compute them in their head.

Determinism additionally buys exact replays, a searchable state space for the AI,
and impossibility of netplay desync. Losing it costs all three at once, silently.

**Nondeterminism is a defect, not a style issue.** It usually arrives as ordering:
a `Set` iterated in insertion order that happens to match input order today, or a
`sort` whose ties break on object identity. Both pass every unit test and both
surface as replay drift.

## 2. Exact arithmetic where the spec says rational

Spawner force is a rational ≤ 1/3, deliberately chosen so that coprime
denominators produce an exact, player-computable pattern. Harmonic movement
banking (§3) is the same. Represent both as integer numerator/denominator.

`1/9 + 1/12` must be exactly `7/36`. As floats it becomes drift, and drift in an
accumulator is drift in the economy, which is drift in who wins.

## 3. Dependencies point inward

Adapters → ports → core, never the reverse. The core imports only from
`contracts`.

The practical test, and the one worth running in your head before adding an
import: **could a second implementation of this port satisfy the existing suite
unchanged?** Geometry is genuinely pluggable here — hand-authored fixture boards
today, extracted tiling tomorrow — so this is not hypothetical.

## 4. Name things the way the spec names them

`AGENTS.md` has the vocabulary table. Use it exactly. Several terms are near
misses that name genuinely different objects:

- **point** (movement junction, 3-in/3-out) vs **vertex** (pinwheel centre, holds
  a spawner, can never be occupied)
- **head** (one unit, one life) vs **stack** (merged heads; size *is* lives)
- **cut** (an enemy crossing your trail) vs **crossing** (any traversal of a point
  another trail passes through — most crossings are not cuts)
- **closure** (departing and landing on your territory) vs **land bridge**
  (a closure that encloses nothing)

A blurred name becomes a blurred test becomes a blurred rule.

## 5. Model the spec's shapes, not convenient ones

A trail is a **set of arrows** (SPEC §6.1a) — not a walk, not a tree. Forks are
ordinary trail; a point the trail uses twice joins every in to every out, with
no pairing to recover. A list or tree would record an order or a pairing the
spec deliberately does not have, and fill must read the set, never the move
list. An accumulator
belongs to an **arrow**, not to a player, because that is what makes capture
reset it. Fighting the spec's data shapes for short-term convenience is how the
rules quietly diverge.

## 6. Complexity budget

Keep functions small enough to hold in your head. The standing budget is
cyclomatic complexity ≤ 12, max-depth ≤ 4, max-lines-per-function ≤ 80,
max-params ≤ 5. **ESLint warns today; it does not fail `pnpm verify`.** When
you exceed the budget on a function you touched, **extract** — do not disable
the rule and do not split arbitrarily at a line count. Red → green →
**refactor**; the third step is not optional.

`pnpm crap` is a hint, not a gate. CRAP shrinks when coverage rises, so a
well-tested god function looks "fine" on CRAP and still needs extracting.
Boy-scout functions you already edited; as the hotspot list shrinks we will
flip complexity from warn to error, then tighten the numbers.

Do not churn a file you did not otherwise need to touch just to silence a
pre-existing warning.

## 7. When the rules and the code disagree, the rules win

`SPEC.md` is the source of truth. If the implementation makes a rule awkward,
that is worth saying out loud — but it is a phase-1 conversation, not a
unilateral edit. Phases 2 and 3 may not touch the spec at all.
