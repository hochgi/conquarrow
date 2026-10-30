# P77 — replaying the five selection incidents

Hand replay of the 2026-10-29 selection incidents
([FINDINGS §4](../FINDINGS.md), [seat-B reasoning](../seat-B-reasoning.md)) on the
P77 build, in the dev server (`pnpm --filter @conquarrow/web dev`), on a fresh
three-seat hot-seat match with all seats `Player`. Clicks were real pointer
events on the board. Player A drafted one step from home at count 2, which left
a sentry of 1 on `5,0,0` and a pair of 2 on `6,0,0`. That is the turn-2 shape:
the sentry's only reach is the pair's tile.

| # | Incident | Replay | Result | Shot |
|---|---|---|---|---|
| 1 | Turn 2: with the sentry auto-selected, a click on the pair's tile applied a merge | Sentry selected; the strip offers `Merge into tiling:a:6,0,0`. Clicked the pair's tile | The pair is selected (`Selected: 2 on tiling:a:6,0,0 · 2 of 2`); `Moves logged` stays at 1 | [1](./1-turn2-sentry-selected-merge-offered.jpg), [2](./2-turn2-pair-tile-click-selects-no-move.jpg) |
| 2 | Turns 16 and 32: "Too far this turn" with the wrong stack selected, and nothing said which | Sentry selected; clicked an arrow only the pair could reach | `Too far for the stack on tiling:a:5,0,0`; the selection line names the sentry | [3](./3-turn16-out-of-reach-names-stack.jpg) |
| 3 | Turn 17: `Next stack` alternated between one stack and nothing | Pressed `Next stack` five times | sentry `1 of 2` → pair `2 of 2` → `No stack selected · 2 can move` → sentry → pair. No move emitted | [4](./4-turn17-next-stack-none-step.jpg) |
| 4 | Turn 18: the turn opened with the sentry auto-selected and nothing saying so | Ended A, B and C's turns | On A's new turn the sentry carries the cream marker and the strip reads `Selected: 1 on tiling:a:5,0,0 · 1 of 2` | [5](./5-turn18-turn-start-selection-named.jpg) |
| 5 | Turn 37: the first click was consumed as a selection change, the next as a move | Clicked the sentry's one-step, one-count destination, then the pair's tile, then a pair destination, then Send | The one-step move drafts and waits for Send (`Moves logged` stays at 4). The pair click selects the pair and discards the draft. Only Send commits | [6](./6-turn37-one-step-waits-for-send.jpg) |

Also observed:

- The HUD buttons kept their exact positions as the hint went between one line
  and three ([4](./4-turn17-next-stack-none-step.jpg) against
  [6](./6-turn37-one-step-waits-for-send.jpg)).
- Once A's last stack had moved, the turn passed by itself to B, as the turn
  status had said it would.
- At 375 px the strip fits with no horizontal scroll
  ([7](./7-mobile-375-strip.jpg)).

Not replayed by hand:

- Turn 37's self-convert "lit ray". It needs a stack with no trail home standing
  beside enemy territory, which takes many turns to set up from a fresh match.
  `board-selection-model.invariants.test.ts` covers it on fixture boards with
  enemy territory: every target and merge target is a draft that `apply`
  accepts, and refused is disjoint from everything lit.
- The `board-busy` refusal. It needs an AI seat. Unit tests cover the pointer
  intent.
