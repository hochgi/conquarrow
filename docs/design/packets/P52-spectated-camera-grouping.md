# P52 — Spectated camera grouping

**Layer:** web adapter only. No `contracts` or `rules-core` change. No game rule
is touched, invented, or implied.

## Problem

P48 gives every replayed move its own camera beat: `hopTargets` eases out to a
bridging fit over `{previous beat} ∪ {upcoming move}`, then eases in to a close
fit over the upcoming move alone. Across a turn of many short steps — the common
case, since a seat usually works one neighbourhood — the result is a continuous
dribble of small pans and re-zooms between moves that are all already on screen.
Play-testing P48/P49 makes this the dominant complaint: the board never settles,
and the motion carries no information, because the next move was visible before
the camera moved to it.

The fix is not smaller hops. It is **fewer**: look ahead over the turn, frame a
run of moves once, and hold perfectly still while they play.

## What ships

A **camera group** — a maximal run of consecutive moves by one seat, within one
turn, that the camera frames in a single shot. One camera movement per group;
zero movement inside one.

### Segmentation

Grouping is planned **per turn, per seat**, over the whole turn's moves, which
are known before playback begins in both drivers (`planLocalAiTurn` locally,
`commitSequence` online).

- A replay window may carry several turns. Split it at `endTurn` and plan each
  turn separately. This costs nothing: `game-handlers.ts` force-appends an
  `endTurn()` when a submission leaves the seat still to move, so every persisted
  version is a whole turn by construction and a turn never straddles a batch.
- Never group across a **seat** boundary.
- Never group across a **turn** boundary either, including the same seat's
  consecutive turns (a mobile seat while the others live only on spawner shares).
  A turn is the unit the player reads; a fresh camera beat marks one.
- `endTurn` names no arrows and contributes nothing to a group's bounds.

### How the groups are chosen

Two passes, in this order, over one turn's moves.

1. **`k`, the number of camera movements, is fixed by a greedy prefix** at
   `SPECTATE_ZOOM_MIN`: walk the moves in order, admit while the union of their
   arrows fits `SAFE_BOX` at the floor zoom, cut at the first move that does not.
   This is provably minimal — the fit predicate is monotone (a union's bounds only
   grow), so no contiguous partition beats a greedy prefix on count.
2. **The moves are then redistributed across exactly those `k` groups** by a
   contiguous dynamic program maximising **lexicographic maximin** on the group
   scale: raise the worst-framed group first, then the second-worst, and so on.

Pass 2 exists because greedy alone frames badly. Greedy stuffs group 1 until it
hits the box at *floor* zoom and leaves the remainder a cosy singleton: a
six-move turn becomes a wide, ugly five plus a close-up one. Balancing it to
three-and-three lifts the bad group without costing a camera movement. Balancing
can lower the best group's zoom to raise the worst; that is the intended trade,
since the badly-framed group is the one the eye complains about.

The DP scores the **capped** scale (see framing). Zoom above the cap is worthless
on screen, so a group already at the cap looks equal to any other capped group
and the DP spends its moves on a needier neighbour instead.

Splits are contiguous — the camera cannot revisit a neighbourhood it has left —
so this is a 1-D partition with an exact answer, not a clustering heuristic.
Ties break on the **earliest** split point. `n` is a few dozen moves, so
`O(n²k)` is free.

Determinism is not negotiable here even though this is an adapter: two clients
watching the same match must see the same choreography. No `Set` iteration order
feeds any of it.

### Framing

A group's target is the tightest fit of the union of its members' arrows
(`arrowsOfMove`, from and exit) inside `SAFE_BOX`, clamped to
`[SPECTATE_ZOOM_MIN, SPECTATE_ZOOM_MAX]`.

The floor governs **collection**, not display: a **singleton** group whose own
move does not fit the box at the floor zooms out past `SPECTATE_ZOOM_MIN`, down
to the global `ZOOM.min = 24`. The floor must not be able to crop a move the
camera had no choice about showing. Past `FIT_CAP_RADIUS` the existing hard cut
still applies — a seat that has fled the field is cut to, not dollied to.

### Motion

- **One merged tween per group boundary.** `easeOutMs + easeInMs` become a single
  duration so the pan reads as one gesture rather than two.
- **No bridge into the first group.** The bridging fit existed to soften
  per-move hops; there are no per-move hops any more. One direct ease from
  wherever the camera stands.
- **Suppression.** If the next group's target is within ~4 % of the viewport's
  shorter side in pan and 3 % in scale, do not move at all. This is what makes
  successive groups in one neighbourhood read as a single still shot, and it
  quietly absorbs the seam between two turns of the same seat.
- **Inside a group the camera does not move.** Moves land where they fall, some
  near the edge of the box, none re-centred. A "gentle re-centre" would be
  exactly the micro-movement this packet removes.
- `gapMs` between moves, the move hold, and the longer seat/turn hold are
  **unchanged**. Only the camera's rhythm changes; the reading rhythm does not.

### Thresholds

One commented tuning block in `spectate.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `SPECTATE_ZOOM_MIN` | 30 | how far out grouping will go to collect moves. Tighter than the global `ZOOM.min = 24`: playback should never dump the player into the survey view. |
| `SPECTATE_ZOOM_MAX` | 56 | how far in a tight group may punch. A little above `ZOOM.default = 48`. |
| `SAFE_BOX` | 0.72 | fraction of each viewport dimension a group's union must fit inside. |
| `GROUP_MOVE_PAN_EPS` | 0.04 | suppression threshold, fraction of the shorter viewport side. |
| `GROUP_MOVE_SCALE_EPS` | 0.03 | suppression threshold, scale ratio. |

Every one of these is expected to move after the first play-test. They are
knobs, not findings.

## Scope

Both drivers, one code path: local bot playback (`applyMovesSequentially`) and
online replay (`playBatch`). Divergence between them would be a bug magnet, and
the visual complaint is identical in each.

## Shape

- `packages/web/src/spectate.ts` — the grouping is pure and lives here beside the
  fitting it already owns. `hopTargets` and its per-move close fit are **deleted**;
  `App.playHop` becomes a per-group `playGroup`.
- `cameraTween.ts` is untouched. It stays a clock owner with no decision in it.
- The plan for a turn is a value: `readonly {moves, target}[]`. App consumes it;
  it does not build it.

## Explicitly out of scope

- Any change to what a move *does*, to FX, or to the match log.
- Re-tuning `fx/timing.ts` against the new stillness.
- The yield-on-gesture camera handover P48 deferred.
- Anything online beyond consuming P49's existing batches.

## Amending P48

P48's "Choreography" section is superseded, not deleted: mark the per-hop
sequence **resolved** in place, pointing at this packet, and keep the reasoning
that survives — the absence of a full-board fit beat, the cap, the restore
policy, the input lock, and reduced motion all still hold verbatim.
