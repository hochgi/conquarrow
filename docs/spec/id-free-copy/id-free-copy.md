# id-free-copy — player-facing copy names stacks, not arrows; the camera is free while a seat thinks

**Packet:** [P103](../../design/packets/P103-id-free-copy.md). Issue
[#120](https://github.com/hochgi/conquarrow/issues/120), items 5–7.
**SPEC:** not edited. No game rule is added, changed, or implied. Nothing is
owed to SPEC §11.
**Amends:** the strip's selection line, count note and refusal sentences
([board-selection-model](../board-selection-model/board-selection-model.md),
*Strip copy*), the Merge buttons (P77), and the input lock of
[spectated-turn-camera](../spectated-turn-camera/spectated-turn-camera.md)
(*Input lock* — what App feeds `inReplayWindow`).
**Layer:** `packages/web` — `stackCopy.ts` (new, pure), `selection/status.ts`,
`route.ts`, `fx/present.ts`, `spectate.ts`, `RouteDock.tsx`, `App.tsx`. No
protocol change, so no `SCENARIOS.md` and no `@hochgi/test-kit` test.
**Features:** [core](./id-free-copy.core.feature) ·
[edge cases](./id-free-copy.edge-cases.feature)

## Purpose

A player reads stacks by size and place, never by an internal id. The words
live in pure functions; React only paints them. Pan and zoom belong to the
player whenever no move is being shown to them.

## Terms

| Term | Means |
|---|---|
| **arrow id** | an `ArrowId` string (`tiling:a:q,r,k`, or a fixture id). Never player copy |
| **n-stack** | `N-stack` with the head count as digits: `3-stack`, `1-stack` |
| **heads phrase** | `1 head`, otherwise `N heads` |
| **compass word** | one of `up`, `up-right`, `right`, `down-right`, `down`, `down-left`, `left`, `up-left` — screen directions, y grows downward |
| **centre** | `arrowCentroid` — the tile's layout-space centroid App already uses for the camera |
| **showing moves** | an online batch is playing, an online batch is queued, or a local seat's planned moves are being applied |

## Copy (normative)

| Where | Before | After |
|---|---|---|
| selection line, selected | `Selected: 2 on <id> · 4 of 5` | `Selected: 2 heads · 4 of 5` |
| selection line, no move left | `Selected: 1 on <id> · no move left · 2 can move` | `Selected: 1 head · no move left · 2 can move` |
| count note | `1 head stays on <id>` / `2 heads stay on <id>` | `1 head stays where the last run began` / `2 heads stay where the last run began` |
| refusal, out of reach, with a selection | `Too far for the stack on <id>` | `Too far for the selected stack` |
| refusal, no exit, with a selection | `The stack on <id> has no move left this turn` | `The selected stack has no move left this turn` |
| Merge button | `Merge into <id>` | `Merge into your 3-stack, up-left` |
| Merge button, no direction | — | `Merge into your 3-stack` |

`No head stays behind`, the no-selection lines, `turnStatus` and every
`REFUSAL_TEXT` entry are unchanged.

### Merge options

```
mergeOptions({ merges, locked, selected, headsOf, centreOf }) =
  mergeButtons(merges, locked)                 -- compareArrows order, [] when locked
    .map(arrow => { arrow, label: mergeLabel(headsOf(arrow), direction(arrow)) })

direction(arrow) = selected === undefined ? undefined
                 : compassWord(centreOf(selected), centreOf(arrow))
```

`headsOf` reads the live board; a missing group reads 0 (`your 0-stack` is
never offered by the mode, but the function stays total).

### Compass word

```
compassWord(from, to):
  dx = to.x - from.x ; dy = to.y - from.y
  if dx === 0 and dy === 0: undefined
  k = round(atan2(dy, dx) / (π/4))            -- Math.round: a tie rounds up
  [right, down-right, down, down-left, left, up-left, up, up-right][(k + 8) mod 8]
```

There is no distance threshold: two distinct tiles always have distinct
centroids, and any threshold would be a magic number.

## Camera lock (normative amendment)

```
showingMoves({ replaying, pendingReplays, localPlayback }) =
  replaying or pendingReplays > 0 or localPlayback

cameraLocked({ spectating, autoFocus, inReplayWindow: showingMoves(…), paused })
```

`cameraLocked` itself is unchanged. App used to pass `replayOpen` — the
camera-save window, open from the first replayed hop until control returns —
which also covered the next seat's *decision*. That contradicted
spectated-turn-camera's *Sequential opponents*: "the wait for the next seat's
decision is outside the replay window … not locked". The save and restore of
the camera still follow `replayOpen`.

`localPlayback` is true from the first applied move of a local AI seat's plan
to its last, and false while it plans (heuristic search or a BYOK request).

## Passing delay (finding, no change)

Online, the pass posts at `setTimeout(…, 0)`. The visible wait is three
sequential requests (POST the `endTurn`; the reconcile's `GET` game; `GET
…/log`) and then the first camera group of the replay (`groupTiming`, from
`BASE_TIMING` scaled by the playback-speed preference). No constant in the
client delays the pass. The local pass is also `setTimeout(…, 0)`. Faster needs
an optimistic local pass or a POST that returns the log window. Backlog.

## Invariants (EARS)

1. The system shall never return an arrow id inside any string produced by
   `selectionLine`, `stripLines`, `leftoverNote`, `refusalText` or
   `mergeOptions`, for any input.
2. When a merge target exists and input is not locked, the system shall label
   it `Merge into your N-stack` followed by `, <compass word>` exactly when a
   selection exists and the centres differ.
3. `mergeOptions(...).map(o => o.arrow)` shall equal `mergeButtons(merges,
   locked)` for every input.
4. `compassWord` shall return one of the eight words for every pair of distinct
   points, and `undefined` for equal points; reversing the pair shall give the
   opposite word, except on the round-half ties.
5. `showingMoves` shall be true exactly when one of its three inputs says moves
   are on screen or queued.
6. No template literal in `packages/web/src` that contains a space shall
   interpolate `String(<arrow-ish>)`, except in the agent-prompt allowlist.
