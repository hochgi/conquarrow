# P42 — Claim walk ignores firebreaks

> **Status:** ready to ship (packet only — `/spec-to-ship` from a laptop).
> **Depends on:** P05b (against-grain claim walk), P22 (simple trails; this
> repeals D5 / item 42 only).
>
> Playtest 2026-08-23 (`conquarrow-match-2026-08-23T181014-387Z`, human seat F):
> tip landed home `4,-5,0 → 5,-5,0` from a **stack-grade** trail. Reverse-grain
> from the landing was S, NE, S (empty) then NE (F's other 1 on `3,-3,2`) then
> NE, S. P22 D5 painted only the three empty arrows; the occupied NE and the
> tail stayed trail. Designer: a firebreak stops **evaporation**, not tile
> claim. The land claim should have continued through the sentry.

**SPEC coverage:** §6.1 (firebreak = evaporation halt only), §7 (claim walk),
§11 item 42 (re-resolved) / item 49. Engine seam: `closure.ts` `walkBack` /
`stopAtFirebreak`. Does **not** reopen P22 D1–D4, D6, D8 (no toll, dormant
legal, no size-1 freeze, paint *trigger*, convert predicate, cut halt).

## Intent

A garrison on your own trail is a firebreak for **cuts, wipes, convert, and
birth-cut**. It is not a paint cap. Landing home claims the full against-grain
walk, including mid sentries — whether or not the component was territory-grade
before the step.

P22 D5 made unanchored reconnect "symmetric with cut halt." That symmetry is
wrong: evaporation destroys until it would enter an occupied arrow; claim
**takes** the occupied arrow (the stack now stands on land).

## BSSN (locked here)

- **Repeal P22 D5 / §11 item 42.** The claim walk never stops for an
  owner-occupied trail arrow.
- **Walk is still against the grain** from the closing step's `from`
  (`Y` precedes `X` when `Y` is trail and `target(Y) === origin(X)`). Everything
  reached is claimed. Occupied arrows on that walk become territory; the stack
  stays, now on land.
- **Grade no longer changes paint amount.** Stack-grade reconnect and
  territory-rooted landing both claim the full upstream walk (and fill if the
  claimed ground rings a pocket). Territory-grade still matters for
  **conversion resistance** (P22 D6) — unchanged.
- **A fork's other arm stays trail.** That arm is *downstream*, not a
  firebreak. Grain, not occupation, is why it is not claimed (P05b / §7).
- **At a merge, every trail in-arrow is claimed** (no pairing in the set).
- **Firebreaks still halt evaporation** — movement cut, combat wipe, convert
  wipe (P33), birth-cut (P40). Vocabulary: firebreak = owner-occupied trail
  arrow that stops a front. Paint does not consult it.
- **Paint trigger unchanged** (P22 D4): head lands on own territory with trail
  behind.
- **No new port method.** `closureOf` / `walkBack` drop the cap flag (always
  walk the full upstream set). Observe via `territory` + `trails` + groups.
- **Purity / determinism.** No `Date`, no `Math.random`, no insertion-order
  dependence. Arrow-id order of the walk result stays `compareArrows`.

## Out of scope

- Cut / wipe / convert / birth-cut halt-at-first.
- Branch toll, dormant legality, size-1 freeze (P22 D1–D3).
- Conversion predicate (territory-grade still required to resist).
- Adapter FX. Claimed arrows already go through existing closure overlays;
  a sentry that becomes land is ordinary territory.

## Scenario inventory

- Unanchored tip lands home with a mid sentry → full against-grain walk
  becomes territory, **including the sentry's arrow**; distal beyond the sentry
  is claimed too if it is upstream.
- Playtest spine: `2,-2,0 → 3,-2,2 → 3,-3,2` (F×1) `→ 3,-4,0 → 4,-4,2 →
  4,-5,0` landing `5,-5,0` → all six trail arrows become F land; both stacks
  stand on territory.
- Territory-rooted tip lands with a mid sentry → still the full walk
  (existing P22 scenario; stays).
- Fork: landing claims the stem / the arm that is upstream; the other arm
  stays open trail (downstream).
- Merge: every in-arrow on the walk is claimed, occupied or not.
- Empty trail (no sentry) → unchanged full walk.
- Head conservation, purity, replay determinism.
- Existing cut / wipe / convert / birth-cut / dormant scenarios still pass
  **with firebreaks still halting evaporation**.

## Definition of done

- [ ] Packet index row present (this PR).
- [ ] `/spec-to-ship` this packet: SPEC §6.1 / §7 prose + item 42 struck /
      item 49; Gherkin in `docs/spec/trails-simple/` flipped from "paint stops
      before firebreak" to "paint continues through the sentry";
      `walkBack(..., stopAtFirebreak)` removed or always false.
- [ ] `pnpm verify` green.
- [ ] Playtest case (F's landing paints only three arrows) cannot be
      reproduced: the six-arrow spine is F territory after the close.
- [ ] Cut / wipe / convert / birth-cut still halt at a garrison.
- [ ] No nondeterminism introduced.
