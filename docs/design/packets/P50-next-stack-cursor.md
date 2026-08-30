# P50 — Next stack: a selection cursor

**Layer:** `web` adapter only. No `contracts` or `rules-core` change. **No game
rule is added, changed, or implied.** The `SkipMove` type survives this packet
untouched and unused; **P51** deletes it.

## Problem

Two problems, one of which was hiding the other.

**The reported one.** Pressing *Skip group* and then moving a different stack
puts the skipped stack straight back under the cursor, so a player who declines a
stack on purpose — the normal case, since SPEC §332 says a typical turn moves a
minority of units — has to press the button again after every single move.

**The real one.** The auto-picker at [`App.tsx:1258`](../../../packages/web/src/App.tsx) is
*memoryless*. It re-derives the candidate list from `legalMoves` on every commit,
sorts it, and picks `froms.find((a) => a !== lastFrom) ?? froms[0]` — the first
candidate that is not the one just acted on. With three movable stacks A < B < C
it selects B after A, then A after B, then B after A: it ping-pongs between the
two lowest arrow ids and **never offers C at all**. There is no lap and no
guarantee of one, because there is no cursor position — only a one-element
memory of where you just were.

That is the whole point of the button. With many stacks on the board, finding the
last one you have not played yet is genuinely hard, and a picker that cannot
promise a full lap does not solve it.

## What ships

### The button becomes a cursor

Renamed **"Next stack"**, enabled from idle (a rotation needs no subject), and it
does exactly one thing: **advance the cursor once**. It stops calling
`requestSkip`. It emits no move, changes no `GameState`, and — the point —
**nothing skip-shaped is ever written to a match log again.** Skip was never
meant to be a loggable move; from this packet on, it is not logged, whether or
not the type still exists.

**Baseline order** is `compareArrows` (exported from `rules-core`) over the
arrows that currently hold a movable stack of the active seat — *movable* being
`spent < allowanceOf(group)`. Any total order would do; this one is already
pinned for determinism and is already what the picker sorts by.

**Advance**, in precedence order. After a committed step:

1. if the step's **destination** holds a movable stack of yours, go there;
2. else if the step left a movable **remainder at the source**, go there;
3. else take the next arrow in baseline order strictly after the cursor's
   current position, wrapping.

Rules 1 and 2 are the merge/split preemption: a step that splits a stack, or
merges into one that still has allowance, puts the product under the cursor
immediately. A preemption **moves** the cursor — the lap resumes from the
preempted arrow, not from wherever it was interrupted. There is no saved resume
point, so a preempted arrow cannot be offered twice in one lap.

**One rule, two triggers.** The automatic advance after a commit and the button
call the same function. The button is a manual invocation of the thing that
already happens; the two can never disagree about where you are.

### Turn start is anchored

Each seat has a **recency stack**: on every acted-upon arrow, push, keeping at
most one entry per arrow (most recent wins). At the start of that seat's turn:
pop with a filter for arrows that still hold a movable stack of that seat, select
the first survivor, **then** clear — read before clear, or the anchor is gone. An
empty or fully dead stack falls back to first-in-baseline-order.

This is **most-recently-acted-first**. It is not an LRU despite the shape: the
last stack you drove last turn is the first one selected this turn.

Per seat (hot seat interleaves two seats between one seat's turns), in memory,
**not persisted**. A reload or an online rejoin lands with an empty recency
stack, which is exactly the first-turn condition — so rejoin needs no special
case.

### Camera

Unchanged from the current picker: pan only if the selection is off-screen, with
the existing `margin = min(w, h) * 0.16`. A camera jump after every trip destroys
spatial orientation during the capture effect, which is why that guard exists.

## Non-goals

- Deleting `SkipMove` or touching `contracts` / `rules-core` / `online-api` —
  that is **P51**, and it is a pure deletion with no behavioural delta.
- Editing SPEC.md. The skip prose is wrong, but it describes a type that still
  exists after this packet; P51 owns the correction.
- Persisting the cursor or the recency stack anywhere.
- Changing `allowanceOf`, `speed`, merge cost, or any turn-economy rule.
- Online-spectated cursors. A remote seat's cursor is that client's business.
- Tutorial camera policy (P43/P48 own it). The tutorial already bypasses the
  picker and continues to.

## Acceptance

- Three movable stacks, press *Next stack* repeatedly: all three are visited
  before any repeat. (The current picker fails this — it never reaches the third.)
- Decline a stack, move another, decline again: the declined stack is not
  re-offered until the lap comes back round.
- Split a stack with allowance left on both parts: the destination is next, then
  the remainder.
- Merge into a stack that has exhausted its allowance: no preemption, the lap
  continues in baseline order.
- End a turn on stack X; on that seat's next turn X is selected, or — if X is
  gone — the next-most-recent survivor from that turn.
- The button is usable with nothing selected.
- No `skip` move appears in a match log produced after this packet.
- `pnpm verify` green. The cursor is web state and never enters the core.
