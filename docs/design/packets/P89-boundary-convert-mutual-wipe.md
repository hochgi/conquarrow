# P89 — Conversion at the round boundary; a mutual wipe does not land

> **Status:** shipped 2026-11-05. **Kind:** rules-core fix. **Depends on:** P88.
>
> **Evidence:** SPEC §11 items 5 and 6, found by P86's fresh reading of
> SPEC.md and decided by the human on 2026-11-05.
>
> **SPEC coverage:** §6.2 (outcomes), §6.3 (when conversion is judged), §7
> (the accrual tick).

## The rules (decided by the human, 2026-11-05)

1. **Both wiped.** When a battle wipes both sides at once (2 v 3, 3 v 4, 4 v 6,
   …), "no unit managed to cross". It is the *A* = 0 outcome: the attacker
   does not land and does not mark the arrow, and the step cuts nothing. The
   defender's stack is still wiped, so the ordinary combat-wipe evaporation
   from its arrow runs (§6.1).
2. **Conversion at the round boundary.** "Spawn cut is a cut. Units on
   enemy territory with no life line connecting to their own territory get
   converted." At the round boundary the order is births, then birth-cuts,
   then conversion, then the starvation tick.

## Today

1. A mutual wipe counts as a landing. The engine marks the arrow, wipes both
   stacks, and the crossing cuts.
2. No conversion runs at the boundary. A raider demoted by a birth-cut
   converts after the next step anyone takes.

## Where the code is

- `packages/rules-core/src/movement.ts`, `applyStep`: `landed` on contact.
- `packages/rules-core/src/movement.ts`, the `endTurn` tail:
  `tickStarvation(accrueRound(…))`.

## Same PR

- P88's edge scenario "A mutual wipe lands and cuts" flips.
- `docs/design/backlog.md`: revisit the combat rules so a battle cannot
  wipe both sides (the human, 2026-11-05).
- Free measurement: `mirror` and `reach --round-cap 200`, before and after.

## Acceptance

- One test per scenario; `pnpm verify` green; CI green.
