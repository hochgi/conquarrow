# cuts — evaporating a trail

**Packets:** [P13 — Trail fire & anchors](../../design/packets/P13-trail-fire-anchors.md)
(was P06 for the original kill-per-front rule) ·
[P47 — A cut floods every arm of a fork](../../design/packets/P47-fork-cut-floods-every-arm.md)
**SPEC:** §6.1, §6.1a, §2, §11 items 8, 24, 26, 27, 28 (P12 re-resolutions), item 47 (P40), item 50 (P47)
**Features:** [core](./cuts.core.feature) · [edge cases](./cuts.edge-cases.feature)
**Sibling:** [combat](../combat/combat.md) · [birth-cut](../birth-cut/birth-cut.md)
**Builds on:** [crossings](../crossings/crossings.md)

## Purpose

An enemy traversal that crosses your trail **cuts** it. A territory-root feeder
mark is a cut at `P0`. A birth onto foreign trail is also a cut
([P40](../birth-cut/birth-cut.md)), started from the birth arrow. Combat wipe
and convert wipe start the **same** evaporation from an arrow
(`evaporateFromArrow`); they are not a second destruction, and they are not
named a cut. Evaporation clears trail paint in both directions until a garrison
or territory stops it. **It does not kill heads** — combat does. A point a
front *reaches* is all-to-all, not only the cut point: a cut on one fork arm
floods every arm (P47). The cutter occupying an arrow is not a firebreak.

## Terms

| Term | Means |
|---|---|
| **cut** | a crossing step, a territory-root cut at `P0`, or a birth on foreign trail |
| **cut point** | the point evaporation starts from, when the seed is a crossing or a territory-root cut |
| **front** | one advancing edge of evaporation (no kill) |
| **firebreak** | the first *victim-occupied* trail arrow a front would enter — halt; arrow and stack survive. The cutter is never one |
| **region** | trail between two firebreaks, or a firebreak and territory — undirected: arrows that share a point belong to one component |
| **sibling arm** | another out-arrow of the same fork point that the front did not arrive along |
| **territory-root cut** | last enemy mark on a territory feeder into `P0` |

## How a cut resolves

```mermaid
flowchart TD
  Cross["crossing step / last feeder mark"] --> P["evaporate from point"]
  Birth["birth on foreign trail"] --> A["evaporate from arrow"]
  Wipe["combat wipe / convert wipe"] --> A
  P --> F["forward fronts on every trail continuation"]
  A --> F
  P --> B["backward fronts on every trail continuation"]
  A --> B
  F --> E["enter arrow: if victim stack on it, halt without destroying"]
  B --> E
  E --> R["else remove arrow from trail #59; all-to-all flood at both endpoints"]
  R --> T{"front hits victim territory?"}
  T -- yes --> W["stop"]
  T -- no --> D["survivors beyond firebreaks are stack grade"]
```

## Invariants

- When a cut resolves, the system shall evaporate the victim's trail both ways from the cut point without reducing any head counts.
- When a front would enter an arrow occupied by the victim, the system shall halt and shall not destroy that arrow.
- At a branch, the system shall send a front into every continuation, including a sibling arm the front did not arrive along (P47).
- When evaporation starts from one arm of a fork (crossing, combat wipe, convert wipe, or birth-cut), the system shall remove the sibling arm's unoccupied non-territory trail arrows (P47).
- The system shall not treat the cutter's occupying stack as a firebreak for the victim (P47).
- The system shall halt per arrow, never by a head on another arrow of the same point.
- When a front reaches the victim's territory, the system shall stop and shall not remove that territory arrow.
- When a step marks the last clean territory feeder into a trail root `P0`, the system shall cut the owner's trail at `P0`.
- When a stack is wiped to 0, the system shall evaporate that owner's trail from that arrow.
- When a spawner birth lands on another player's trail arrow, the system shall evaporate that trail from the birth arrow (P40).
- The system shall not mutate the input state.
- The system shall not consult `Date`, `Math.random`, or insertion order when computing the flood; trail removals SHALL enumerate in `compareArrows` order.

25 scenarios (12 core, 13 edge). 12 invariants. P47 adds the sibling-arm flood, shared wipe/birth flood, cutter-is-not-a-firebreak, and the 2026-08-27 tiling replay. It does not add a second evaporation.
