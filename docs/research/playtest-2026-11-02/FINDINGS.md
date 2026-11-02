# Playtest 2026-11-02: human vs the post-P81 heuristic

The human played seat C against **two** heuristic seats (A and B) after P81,
which made the bot finish games. The config was the 2026-10-29 playtest
config with 3 players and spawner seed 1. Log: [`match-log.json`](./match-log.json).

## Result: the human won in about 42 rounds, eliminating both bots

| round | A heads / land / income | B heads / land / income | **C (human)** heads / land / income |
|---:|---|---|---|
| 5 | 3 / 8 / 0.58 | 3 / 7 / 0.58 | **3 / 16 / 0.75** |
| 10 | 3 / 8 / 0.58 | 3 / 12 / 0.75 | **3 / 40 / 1.89** |
| 20 | 4 / 11 / 0.83 | 5 / 26 / 1.81 | **5 / 66 / 2.78** |
| 30 | 4 / 24 / 1.61 | 6 / 37 / 3.81 | **13 / 110 / 7.86** |
| 35 | 6 / 28 / 1.78 | 7 / 44 / 4.58 | **21 / 204 / 11.17** |
| end | out at r36 | out at r42 | **61 / 426 / 20.50** |

Income is heads per round. The numbers come from replaying the log through
P78's analyser.

- **Closes:** C 26 (16 area captures, 7 land bridges, 3 with enemy heads
  inside), B 16 (12 land bridges), A 10 (6 land bridges).
- **Heads lost, all seats:** encirclement 21, combat 8, evaporation 0. First
  contact came at move 298, about round 28.

**What it says:**
1. **The post-P81 heuristic is not too strong for a human.** The human led
   on land from round 5 and on income from round 10. There is no case for a
   difficulty setting yet.
2. **Bot A stalled early.** It passed **11 turns in a row** (rounds 6–16),
   holding 3 heads and 8 land, and had a legal step on every one of those
   turns (checked by replay with `hasLegalStep`). A passed once more at r35
   and B once at r26, both with a legal step. This is the P81 follow-up "the
   beam still sometimes passes when a step is legal", now in a 3-player
   opening.
3. **A human reference for the BYOK opening.** P82's BYOK seat had income
   0.25–0.5 at round 20 in 2-player games, against the heuristic's 1.9–5.4.
   The human had 2.78 by area captures close to home from the first rounds,
   not by walking out. This is the opening a BYOK-opening packet should aim
   for.

## UX warts

### 1. "Merge into tiling:a:0,-2,0" means nothing to a human

**Seen:** the human selected a 2-stack. The strip showed:

> Selected: 2 on tiling:a:1,-2,2 · 4 of 5
> [Merge into tiling:a:0,-2,0] [Merge into tiling:a:2,-3,0]

The human could not tell what the buttons do. In their words, it is bad UX
that was not designed for humans.

**What the buttons are** (P77, `RouteDock.tsx`, `input/modes.ts` `mergeInto`):
- There is one button per own stack that the selected stack can reach this
  turn.
- Each button drafts a route that walks the selected heads onto that stack.
- On the board, those target stacks have a dashed outline.
- Nothing is applied until **Send**.

**Problems:**
- **The text uses internal arrow ids** (`tiling:a:q,r,k`), which are
  meaningless to a player. The status line has the same problem:
  `Selected: 2 on tiling:a:1,-2,2`.
- **The link between a button and its target is invisible.** Hovering a button
  does not highlight its dashed stack, and the label carries no position cue
  such as a direction, the target's head count or the step count.
- **The price is hidden.** SPEC §4's "Merging costs the turn" rule (the merged
  stack has speed 1, or speed 0 if the arriving group is larger than the stack
  it joins) is not shown, so the player cannot weigh a merge.
- "4 of 5" (the selected stack's place in the `Next stack` lap) reads like a
  count of heads or moves.

**Possible directions** (to decide in a packet, not here):
- Label each button by what the player sees, e.g. "Merge into the 1-stack
  (up-left, 2 steps)".
- Highlight the target stack while its button is hovered or focused.
- Show the speed price before Send.
- Drop arrow ids from all player-facing copy, or keep them behind a debug
  toggle.
