# Playtest 2026-11-07: human vs two heuristic seats, on a phone

Same setup as [2026-11-06](../playtest-2026-11-06/FINDINGS.md): seat C human,
A and B heuristic, 3 players, R 7, `homeOffset` 5, spawner seed 1. Log:
[`match-log.json`](./match-log.json), 895 moves. The numbers come from
replaying it through `rules.apply`.

## 1. C's ×4 converted at move 333: a clean cut, not a repelled attack

The human read it as an attack on C's trail that was repelled and still
evaporated the trail. The replay shows no battle:

- Move 333: A steps ×2 from `3,0,1` to `2,1,1`. The arrow `2,1,1` was
  **empty** and in C's trail, so the step lands and crosses C's trail: a cut
  (§6.1).
- The cut evaporates C's trail both ways. One front halts at C's ×4 on
  `2,2,0`, which stood on **A's land**; the other at C's ×1 on `1,2,1`
  (§6.1, firebreaks).
- The ×4 survives the cut, but its road home is gone, and it stands on enemy
  land with no life line, so it converts to A (§6.3). The convert wipe then
  takes the trail under it (`0,2,0`, `1,2,0`, `2,2,0`).

The engine followed SPEC. What needs checking is the screen: if the effects
showed a battle or a repelled attack at that step, the effects code restates
a rule (P86 leftover item 1, `fx/events.ts`). The screenshot cannot settle
it; the next playtest should note what the effects showed.

Two more conversions of C's ×4 happen later, both by the same rules: move
474 (B lands on C's empty trail arrow `-1,3,0`, cutting the road home of a ×4
on B's land) and move 500 (B attacks ×5 into C's ×4 on C's own land and
wins; one survivor lands).

## 2. B's loop of doom: a ×2 stack on a 3-arrow ring of its own trail

Between moves 102 and 691, B spent 19 steps walking a ×2 stack around
`-2,4,2 → -2,3,1 → -3,4,0`, all neutral arrows of its own trail at the tip of
a sortie. With speed 2 on a 3-arrow ring it ends each turn on a different
arrow, as the human predicted on 2026-11-06: ending on the start arrow is not
the defect. This is the second instance (A's ×4 on 2026-11-06 was the first).
Both fixtures go into the loop-of-doom packet's diagnosis.
