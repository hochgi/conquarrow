# P47 — A cut floods every arm of a fork

> **Status:** shipping via `/spec-to-ship`. **Depends on:** P06 / P13
> (directional fronts, halt-at-first), P22 (dormant legal), P33 / P40 (wipe and
> birth reuse `runFronts`).
>
> Playtest 2026-08-27 (`conquarrow-match-2026-08-27T121122-127Z`, human seat F,
> green = D): F's 4-stack interleaved through D's trail at `p:-1,0`
> (`0,-1,1 → -1,0,1`). Backward evaporation cleared a long chain, including
> `-2,1,0`. The sibling out `-1,1,0` of `p:-1,1` survived. F then stepped onto
> the evaporated `-2,1,0` and saw that leftover paint immediately ahead —
> reading it as "my stack was a firebreak" and "forward evaporation did not
> apply".
>
> **Neither reading is what the engine did.** F's stack is the cutter, not a
> firebreak (halt-at-first is *victim* occupation only). True forward along D's
> grain *did* run: out `-1,0,2`, then halt at D's own sentry `-1,-1,1`. The
> leftover is a **sibling fork arm** a directed backward front never entered.

**SPEC coverage:** §6.1 (region between firebreaks; all-to-all points), §6.1a
(item 26), §11 item 50. Engine seam: `cuts.ts` `runFronts` / `continuations`.
Does **not** reopen halt-at-first, combat, claim walk (P42), or "the cutter's
own trail is unmarked".

## Intent

§6.1 already defines a cut as destroying **one region**: trail between
firebreaks (or a firebreak and territory). A point is all-to-all — every in
feeds every out — so a fork is one region, not a bundle of directed rays.
Today only the *cut point* is all-to-all. A front that later *reaches* a
branch still travels in one polarity, so a cut on one arm leaves the sibling
standing. That leftover is the same undirected component, still between the
same firebreaks. It is a hole in item 26, not a new kind of hurt.

The cutter occupying an arrow is never a firebreak for the victim. Firebreaks
are the victim's garrisons.

## BSSN (locked here)

- **Region, not ray.** The destroyed set is the connected component of
  *unoccupied, non-territory* victim trail in the **incidence graph** (two
  trail arrows are adjacent when they share a point), grown from the cut's
  seeds, **not entering** a victim-occupied arrow or a victim-territory
  arrow. That is the existing "between firebreaks" sentence made operational.
- **Every point a front touches is all-to-all**, not only the cut point.
  Destroying one out of `Q` via a backward front still floods the other outs
  of `Q` (and the ins); destroying one in via a forward front still floods
  the other ins. *Never against it* means a front does not reverse along the
  **same** arrow it just destroyed. It does **not** mean a sibling arm is
  immune.
- **The cutter is not a firebreak.** Halt-at-first is `standing.owner ===
  victim && heads > 0`. An interleave that lands on a non-trail out, or a
  coincide landing whose occupant is the mover, does not stop the victim's
  fronts.
- **Same primitive.** Crossing and territory-root still `evaporateFrom` the
  point; wipe / convert / birth still `evaporateFromArrow`. The change is
  inside the shared flood (`runFronts`). Birth or wipe on one arm therefore
  also takes the sibling — same region, no second rule.
- **Cut behind a fork and cut at a join stay.** Those already flood. This
  packet adds the missing twin: cut *on* one arm (or backing into the fork)
  floods the other arm too.
- **Halt-at-first, territory wall, no kills — unchanged.** A garrison on the
  sibling still stops that arm; distal beyond it remains. Victim territory is
  still a wall. Head counts do not move.
- **No new port method.** Observe via `trails` + groups. Queue / removal order
  stays `compareArrows`.
- **Purity / determinism.** No `Date`, no `Math.random`, no insertion-order
  dependence.

## Out of scope

- Combat math, stay-behind, claim walk (P42), branch toll, dormant legality.
- Treating the cutter as occupying the victim's trail for any other rule
  (blockade, conversion, paint).
- Adapter FX. Surviving sibling paint already presents as ordinary trail; once
  it evaporates it uses the existing `cutSnap` + `evaporate` path.
- A second cut point at the cutter's destination. The cut stays at
  `target(from)` (crossing) or at the emptied arrow (wipe / birth).

## Scenario inventory

- Cut on one ungarrisoned fork arm → sibling arm evaporates too (the playtest
  shape, on a fixture).
- Playtest tiling: F `0,-1,1 → -1,0,1` (interleave, not coincide) evaporates
  D's `-1,1,0` as well as the backward chain; D's sentry on `-1,-1,1` still
  holds. After F steps onto `-2,1,0`, no D trail remains on the outs of
  `p:-1,1`.
- Cutter's stack is not a firebreak: interleave landing on a non-trail out,
  and coincide landing on a trail out, both continue past the mover.
- Sibling arm with a garrison → that arrow and distal beyond it remain; the
  empty sibling stretch still dies.
- Cut *behind* a fork still floods both arms (existing).
- Cut at a join still spreads into every in-arrow (existing).
- Birth / combat wipe / convert wipe on one arm take the sibling (shared
  flood). Convert's remaining neutral firebreak still holds (P33).
- Territory wall, head conservation, cutter's own trail unmarked, purity,
  replay determinism.

## Definition of done

- [ ] Packet index row present (this PR).
- [ ] `/spec-to-ship` this packet: SPEC §6.1 / §6.1a + item 26 note + item 50;
      Gherkin in `docs/spec/cuts/` gains the sibling-arm / cutter-is-not-a-
      firebreak scenarios.
- [ ] `pnpm verify` green.
- [ ] Playtest case cannot be reproduced: after `0,-1,1 → -1,0,1`, `-1,1,0`
      is not in D's trail.
- [ ] Halt-at-first, territory wall, P33 remaining firebreak, P40 birth-cut
      still hold.
- [ ] No nondeterminism introduced.
