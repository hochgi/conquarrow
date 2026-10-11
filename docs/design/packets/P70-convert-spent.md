# P70 — A converted stack is spent for the capturing turn

> **Status:** in flight. **Depends on:** P07, P28, P33, P39, P48, P49.
> Playtest 2026-10-08: blue cut an orange raider's trail, the orange 1 converted,
> and blue stepped that new head onto an empty tile in the same turn. The flip
> and the departure were one blur. The human chose a rule, plus a quieter cue.
>
> **SPEC coverage:** §6.3, §11 item 40 (spent clause re-resolved). Presentation
> amends the existing `conversion` overlay. It does not reuse P39's vanish flicker.

## Intent

A stack that converts has no step left on the capturing turn. `spent` is set to
`speed(heads)` and any merge override is dropped — the same state as a stack
that has already walked its allowance. End of turn still clears `spent`, so the
next time that seat plays, the stack has its full speed.

The adapter shows the flip as a **hand-off** on the tile, then a spectated
playback holds there long enough to read it. The camera looks at the stack
before the colours trade.

## BSSN (locked)

- **No new status.** Do not add a flag, a grade, or a glossary word. The group
  is spent. `legalMoves` already refuses a group with `spent >=` its allowance.
- **Allowance is `speed(heads)`.** `speed` is the contracts function
  (`1 + floor(log2 heads)`). A 1-stack is spent at 1. A 3-stack is spent at 2.
  Neither gets a step, of any count, from that arrow.
- **Override still drops.** A victim merge penalty does not carry. `spent` is
  the plain speed, not the victim's old `spent` and not 0.
- **Merge is ordinary.** A later step that lands on the converted stack keeps
  the destination's `spent` (arrivals' spending is discarded). Joining does not
  wake it. No convert-specific merge branch.
- **Who converts is unchanged.** Territory grade still protects. Stack-grade
  and dormant still do not. Neutral ground still does not convert, and a group
  that does not convert keeps its `spent`. Self-convert stays illegal (P28).
  Convert wipe stays (P33). Heads stay intact.
- **Other stacks of the capturer move normally.**
- **Hand-off, not a new event.** Same `unitsConverted`, same `conversion`
  overlay kind. Four equal beats in 700 ms: old colour, new colour, old colour,
  hold on the new colour. The head count stays drawn, in the beat's ink. The
  outgoing plate ends transparent, stays transparent through the 300 ms offset,
  and steps between beats. No new-accent ring. It is not P39's flicker-then-fade
  (that dips and disappears).
- **Offset stays 300 ms** (`FX_OFFSET_MS.converted`), so the hand-off still
  follows the cut. Do not retune other `FX_MS` values.
- **Spectated gap after a converting step** is `300 + 700 + 500 = 1500` ms and
  does **not** scale with playback speed. The 500 ms is stillness after the
  colours have settled.
- **Reduced motion:** no alternation (the un-animated plate is transparent, so
  the committed new colour shows at once). The spectated gap is the 500 ms hold
  only, also unscaled.
- **A step that does not convert** keeps today's scaled gap (`400 / speed`).
- **The hold is spectated playback only** (P48's predicate: local AI and online
  move-log replay). The human's own turn and hot-seat play the hand-off and do
  not insert a gap. Tutorial pacing is out of scope.
- **Framing.** If any converted arrow's centroid lies outside the current safe
  box, ease to a shot of the step's arrows plus those centroids, using the
  existing `groupTarget` fit (`SAFE_BOX`, `FIT_CAP_RADIUS` hard cut), and only
  then start the hand-off. If every converted centroid is already inside the
  shot, the camera stays put. The ease duration still scales with playback
  speed, like every other camera move. Several stacks converted by one step
  share one shot and one hand-off.
- **No new port method.** Rules are observed through `apply`, `legalMoves`, and
  `speed`. Presentation is pure helpers in `packages/web` plus the stylesheet.
  No React Testing Library.

## Out of scope

- Who converts, convert wipe, self-convert legality.
- A click-to-dismiss banner. A turn-log line.
- Freezing the human's own input during the hand-off.
- Scaling the 1500 ms or the 500 ms by playback speed.
- Retuning vanish, capture, or the ordinary 400 ms gap.

## Scenario inventory

Rules:

- A converted 1-stack is spent at `speed(1)` and offers no step
- Stacks of 1, 2, 3 and 4 heads are spent at `speed(heads)`
- The capturer's other stack can still step
- The capturing turn's `endTurn` clears that `spent`
- A victim `spent` and merge override are discarded
- A larger friendly arrival onto the converted stack leaves no step
- An equal friendly arrival onto the converted 1 leaves no step
- A friendly arrival onto a converted 3-stack keeps `spent` at 2
- A group that does not convert keeps its `spent`
- A step from the converted arrow is absent from `legalMoves` and `apply` throws
- Heads are conserved. Convert wipe still clears the victim trail on that arrow
- Self-convert stays illegal

Presentation:

- One conversion overlay, duration 700, offset 300, head count included
- Two conversions on one step share that offset
- Spectated gap after a converting step is 1500 at every playback speed
- Reduced-motion spectated gap after a converting step is 500
- A non-converting spectated step keeps the scaled 400 ms gap
- A non-spectated caller keeps the ordinary gap even when the step converted
- Converted centroid outside the shot: one fit contains it, hand-off waits for the ease
- Converted centroid already inside: the target is unchanged
- Two converted centroids share one fit. Past `FIT_CAP_RADIUS`, `hardCut` is set
- The hand-off's last keyframe is transparent, and it is not the vanish animation

## Repealed assertions

These expect `spent === 0` on a converted group and must move to `speed(heads)`:

- `packages/rules-core/test/encirclement.invariants.test.ts` (`resets spent on convert`)
- `packages/rules-core/test/encircled-path.edge-cases.test.ts` (`spent 0`)
- `packages/rules-core/test/closure.core.test.ts` (converted head's `spent`)

## Definition of done

- [ ] `pnpm verify` green.
- [ ] A converted group has no step on the capturing turn, and has its full speed after that turn's `endTurn`.
- [ ] Spectated playback of a converting step holds through the hand-off plus 500 ms, unscaled.
- [ ] No `Date` / `Math.random` / insertion-order dependence in the rule.
