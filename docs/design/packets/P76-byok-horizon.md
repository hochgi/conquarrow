# P76 — BYOK horizon: what changed, and what is reachable

> **Status:** **parked 2026-11-01 by the human.** P80 and P75 fixed both audited grok failures. P76's evidence comes from late-game play in the Claude playtest, which the K = 20 benchmark cannot see. **Unpark when** a longer-game measurement of grok's own play (K = 40–60) shows a territorial bleed or a missed reachable goal. If it is unparked, the shape decision below still has to be made and recorded in an ADR. Was: blocked on one design decision (below). **Depends on:** P79, and the measured results of P74 and P75. If those close
> the gap, this packet may not be needed.
> Playtest 2026-10-29 ([findings](../../research/playtest-2026-10-29/FINDINGS.md) §2.3, §2.9):
> the offer is regenerated per position and describes **one step**. Two
> consequences showed up repeatedly in play:
>
> 1. A goal that was out of reach becomes reachable as the frontier moves, and
>    nothing re-surfaces it. The centre went from "12 steps away" to "7 steps
>    away and still unclaimed" with no action of the seat's.
> 2. Losing ground to an **enclosure** produces no tag and no event. A seat with
>    no memory of the previous offer cannot see a slow territorial bleed.
>
> **SPEC coverage:** §7, §9. No rule change. Adapter-only.

## The decision this packet is blocked on

**How much search belongs on the adapter side?** Three shapes, in increasing
cost. The human picks one before this is specified further.

| | shape | gives the seat | cost / risk |
|---|---|---|---|
| **A** | **Delta only.** One line naming what changed since this seat's last offer. | Visibility of bleed (§2.9). | Cheapest. Needs per-seat memory in the adapter. Does nothing for §2.3. |
| **B** | **Delta + reachable-vertex summary.** Plus, for each spawner vertex within *k* steps, its force, `held`, and the loop cost to complete it. | Both §2.3 and §2.9. The seat still chooses the move. | A bounded BFS per turn. Must not become a move recommender. |
| **C** | **Candidate loops.** Enumerate closed loops out of territory and back, scored by income delta. | Everything, plus the seat's planning is mostly done for it. | This is the heuristic seat wearing a hat. It makes the BYOK seat's play a property of our search, not of the model — which defeats the point of the experiment. |

**Recommendation: B**, with *k* fixed and small. A is too thin to change play;
C relocates the decision into the adapter and would make any future model
comparison meaningless. B gives the seat the same *information* a human gets
from looking at the board for ten seconds, and leaves the choice where it
belongs.

**This packet is not ready for `/spec-to-ship` until that is decided.** What
follows specifies B.

## Intent (assuming B)

Add two blocks to the user prompt:

1. **`CHANGED_SINCE_YOUR_LAST_TURN`** — a short, bounded diff.
2. **`REACHABLE_SPAWNERS`** — vertices within *k* steps that are not already
   3/3 this seat's, with what it would cost to finish them.

## BSSN (locked, for shape B)

- **Memory lives in the adapter, keyed by seat, for the current match only.**
  The rules core stays pure and stateless. Nothing persists across matches.
  If no previous offer exists (first turn, or a reload), the block is omitted
  entirely rather than emitted empty.
- **The delta is bounded and factual.** At most *m* lines, in `compareArrows`
  order: arrows this seat lost and to whom, arrows gained, spawner vertices
  whose `held` changed, and head-count change. **No causes** — do not try to
  say "encircled" or "cut"; say what is different.
- **`REACHABLE_SPAWNERS` is a BFS along the grain from this seat's territory and
  stacks**, depth *k*, reporting per vertex: id, `force`, `held` per player,
  the arrows still needed, and the **loop cost** (out-steps + return-steps) as
  already computed by the existing distance helpers. It reports **cost**, never
  a route and never a ranking.
- **Fixed *k*, chosen by measurement, not taste.** Start at *k* = 6 and tune
  down if the block exceeds budget. Record the chosen value and why.
- **Nothing recommends.** No ordering by value, no "best" marker, no
  `on_target`-style steering. Rows sort by vertex id.
- **Budget.** Combined growth over P75's baseline **≤ 20%**. These blocks are
  the first thing to shrink if the offer gets tight — drop `REACHABLE_SPAWNERS`
  to the incident tier before dropping the delta.
- **Determinism.** Sorted output, no clock, no set iteration feeding order.
  Two ports, identical text.

## Out of scope

- Route-finding, loop enumeration, or any form of move scoring (that is C).
- Persisting memory across matches or reloads.
- Explaining *why* something changed.
- Changing the JSON reply contract or the `plan` field (see note below).

## Note for a follow-up, not this packet

`plan` is one clause naming "the job this seat is still on", and every worked
example assumes a single job. A seat with two stacks has two jobs. Whether
`plan` becomes a short list is a **contract** change and wants its own packet
and ADR; it is recorded here so it is not lost.

## Scenario inventory

- First offer of a match omits both blocks
- Second offer includes a delta; an unchanged board yields an omitted, not
  empty, delta block
- Arrows lost to an opponent appear in the delta with the new owner
- A spawner vertex whose `held` changed appears once, with old and new counts
- The delta is capped at *m* lines and the cap is stated in the block
- `REACHABLE_SPAWNERS` omits vertices already 3/3 for this seat
- A vertex at exactly depth *k* appears; *k*+1 does not
- Loop cost for a vertex one arrow short matches the hand-computed value on a
  fixture board
- Rows are vertex-id sorted and identical across both geometry implementations
- Combined offer growth within budget
- A seat with no territory (all captured) still gets a well-formed offer

## Definition of done

- [ ] The shape decision is recorded in an ADR before implementation starts.
- [ ] **Passes the [P79 gate](./P79-byok-benchmark-harness.md#the-gate-predeclared-before-any-arm-runs)
      as an arm over whatever P74/P75 shipped**: the primary-mode mean beats
      baseline by more than the noise floor, and nothing regresses past it.
      Numbers recorded in `docs/research/byok-benchmark.md`. **If it does not
      pass, it does not merge.** The branch and its numbers are kept, and the
      packet is marked parked with the result.
- [ ] `pnpm verify` green.
- [ ] Growth measured and recorded; ≤ 20% over P75.
- [ ] No ranking, no route, no recommendation in either block.
- [ ] Replaying the 2026-10-29 log's seat-C positions, the delta block correctly
      reports every arrow seat B lost on turns 29–39.
