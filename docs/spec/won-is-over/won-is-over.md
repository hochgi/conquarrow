# A won match is over — P38

Resolves **SPEC §11 item 46**. Rules + adapter.

## Overview

Two rules and one sequencing rule.

```
apply(state, move):
  if state.winner !== undefined: throw ContractViolation   # NEW — the match is over
  next = dispatch(state, move)
  return resolveLosses(next)

legalMoves(state):
  if state.winner !== undefined: return []                 # NEW — nothing, not even the pass
  ...as before
```

```mermaid
flowchart TD
  M["the deciding move"] --> D["dispatch: step #59; endTurn"]
  D --> E["its own effects resolve in full<br/>closure, fill, convert, evaporation"]
  E --> R["resolveLosses"]
  R --> W["winner is set"]
  W --> Q["the move's overlays play out"]
  Q --> C["celebration begins"]
  W --> T["legalMoves is empty #59; apply throws"]
```

## Why empty, and not "nothing but the pass"

P37 invariant 4 says a **lost** player is offered nothing but the pass, and the
reason is structural: `players[0]` is the round-boundary marker, and a seat is
*passed*, never skipped, so the round still has to advance through a dead seat's
slot. `legalMoves` returning `[]` there would hang the match.

A **won** match has no next turn to advance to. There is no round to close, no
seat to hand on, and nothing for a pass to mean. This is the one state where an
empty offer list is the correct answer rather than a deadlock — and it is worth
saying explicitly, because the two states look adjacent and the reasoning that
makes the pass mandatory in one makes it meaningless in the other.

## Why `apply` throws rather than returning the state unchanged

Two shapes were available and they are not equivalent.

**Returning the input unchanged** keeps `apply` total: a record that runs past the
win folds harmlessly to the winning state. That is the friendlier option for a
truncated log, and it is the wrong one here. A caller that applies a move and gets
back a state where nothing happened has no way to tell "the match is over" from
"that move was a no-op", and the engine would be silently absorbing a caller bug.

**Throwing `ContractViolation`** matches the invariant this repo already keeps in
both directions — *everything `legalMoves` offers, `apply` accepts*, and P28's
precedent that an illegal step throws rather than degrading. It makes the caller
error loud at the point it happens.

The cost is real and is accepted: **a replay that runs past the win now throws.**
The 2026-08-20 log still has four moves recorded after 1242 — that is what the
fixture *contains*, and the tests still pin those kinds as a fixture guard.
Under current rules the fold never gets there: **P47** evaporates sibling fork
arms, which on this log demotes an E trail onto F land, and **P28** then refuses
E's recorded step `3,-4,0 → 4,-4,0` at move **233**. The log is a **prefix
golden**. P38's engine claim — refuse the first move after a win, and name it —
is proven on the hand-authored won position (`aWonPosition` / a match that loses
three of four seats), not on a fold that can no longer reach 1243. Same as P38
slicing 1244 → 1243: the fixture is unchanged; the fold is shorter.

## The winning move is not truncated

`resolveLosses` sits at the **tail** of `apply` (P37), after `dispatch` has run
every effect the move causes. That ordering is what makes "the winning move only
invokes effects" true, and it is now load-bearing rather than incidental: an
implementation that noticed a win early and skipped the rest of the pass would
produce a board missing the fill, the conversion, or the evaporation that won the
match.

The refusal is therefore at the **top** of `apply`, gating the *next* move, and
never inside the pass gating the current one.

## When the celebration begins

The adapter derives the celebration from `state.winner` alone today, so it paints
on the same frame the winning move commits, over that move's own overlays. It
shall instead begin once the effects of the winning move have **finished
playing**.

Two constraints on how that is implemented:

- **It shall not gate input.** The fx queue's own contract is that it "never gates
  input" and is "allowed to be lossy under pressure". Waiting on it here does not
  break that: input is already locked, because `inputLocked` reads
  `winner !== undefined`, which is true from the deciding move onward.
- **It shall be bounded — and the first draft of this section got the direction of
  the risk backwards.** It said the queue being lossy meant *"wait until the queue
  is empty"* could strand a match with no celebration, and picked
  `MAJOR_SEQUENCE_MS` as the ceiling on that reasoning. Both halves were wrong.

  Losing an overlay makes queue-empty fire **earlier**, not later, and `pruneQueue`
  drops every item on its own lifetime, so nothing in the queue outlives itself. The
  only way the queue stays non-empty is new overlays arriving — and after the
  deciding move nothing can enqueue, because this packet's *own* rules half refuses
  every subsequent move and `inputLocked` is already true. **Queue-empty is
  therefore self-bounding**, and it is the trigger.

  Worse, the ceiling as drafted was **shorter than the move it was meant to wait
  for**. Measured through `presentSteps` on this feature's own Given — a closure
  that fills ground and converts a stack — the queue settles at **1200 ms**:

  | overlay | offset | duration | settles |
  |---|---|---|---|
  | `advance` | 0 | 220 | 220 |
  | `loopPulse` | 40 | 300 | 340 |
  | `captureFill` | 220 | 400 | 620 |
  | `lossRetract` | 260 | 420 | 680 |
  | `conversion` | 300 | 360 | 660 |
  | **`captureFresh`** | **500** | **700** | **1200** |

  `MAJOR_SEQUENCE_MS` is 700. A ceiling of 700 fires **500 ms early, on top of
  `captureFresh`** — a smaller copy of the exact bug this packet was filed to fix,
  and a direct contradiction of the requirement it is implementing.

  The ceiling therefore stays, but as a guard against a **bug** rather than against
  the design, and it shall be a genuine **upper** bound: not less than the settle
  time of the queue as it stands when the deciding move commits. Take it from the
  queue itself — `max(offset + lifetime)` over the items present — rather than from
  a constant, so it cannot go stale when a timing value changes.

  ~~A fixed fallback applies only when the queue is empty at that instant.~~ —
  **The fallback is zero: there is none.** An empty queue at the deciding instant
  means the winning move queued no overlay, and then there is nothing to wait for —
  a fixed pause there is a dead pause with nothing playing under it, which is the
  opposite of what this section asks for. A positive floor is also not implementable
  as written: the phase is recomputed from the **live** queue on every render and
  nothing remembers what the queue held at `decidedAt`, so *"empty at that instant"*
  can only read as *"empty now"* — and a floor read that way is not monotone. It
  would flip the banner **on** at the settle, **off** again when `pruneQueue` empties
  the queue below the floor (the prune timer fires at `settle + 40`, so any move
  settling under ~660 ms), and **on** again at the floor. Invariant 13 — *exactly
  once per match* — outranks a nominal ceiling with nothing under it. Invariant 11
  is unaffected: with nothing queued the settle time is 0, and a ceiling of 0 is not
  less than it.

  **`timing.ts` carries a false claim** and it is what this section leaned on:
  *"the biggest sequence in the game (enclosure → capture → production) fits inside
  `MAJOR_SEQUENCE_MS`"*. `captureFresh` alone settles at 1200 against a stated 700.
  Retuning any `FX_MS` value is out of scope for this packet, so the numbers stand;
  the **comment** is corrected to say what they do.

  P39's vanish overlay settles at 880 ms (offset 360 + duration 520), still under
  `captureFresh` at 1200, so the headline wait is unchanged. It is **above**
  `MAJOR_SEQUENCE_MS` (700), so the suite's *quiet* deciding move — the one that
  must settle inside the ceiling to tell queue-wait from a constant — cannot be a
  legal `vanishSeat` result. That fixture keeps a head on the vacated seat so the
  land reads as `lossRetract` (680 ms). The board is unreachable (T=0 ⇒ heads go
  with the seat). It is a presentation discriminant, not a rules position.

During the wait the board shall read as **playing**: no dim, no shine, no banner.
The transition is what carries the meaning.

## A cut can never be the deciding move

Worth recording, because it looks like it should be able to and a test was written
on the assumption that it could. Evaporation destroys **trail** and nothing else —
`cuts.ts` opens with *"fronts destroy trail until they would enter an occupied
arrow; that arrow and its stack survive. No kills."* Trail is none of *T*, *S* or
*H*, so no cut can move any seat into a losing row of the §9 table.

A deciding move is therefore a closure, a combat wipe, or the starvation tick at a
round boundary. The wipe case still *starts* an evaporation — which is why
evaporation belongs in the list of effects the deciding move must resolve — but the
cut is never the thing that decides.

## Cost

Both new gates are a single `undefined` check on a field already in hand. The
refusal is O(1) and runs before any board read, so a won state is *cheaper* to
call `legalMoves` on than a live one. Nothing here touches the vertex lattice, so
P37 invariant 16 is unaffected.

## Invariants (EARS)

1. When `state.winner` is set, the system shall offer no legal move.
2. When `state.winner` is set, the system shall refuse every move with a
   `ContractViolation`, and shall not return a state.
3. The system shall resolve every effect of the deciding move — closure, fill,
   and conversion — in the state that move returns. *(Evaporation is deliberately
   not on that list: the seat whose trail a deciding front runs along is the seat
   that move loses, and a lost seat vanishes trail and all, so the two removals are
   indistinguishable in the returned state. A bystander whose trail burned instead
   would be a second survivor, and then the move would not have decided anything.
   Assert that the evaporation was reached through, not that its result is visible.)*
4. The system shall never refuse a move on account of a winner set by that same
   move.
5. A replay whose record continues past the deciding move shall refuse at the
   first move after it, and shall name that move. *(Proven on a hand-authored
   won position. The 2026-08-20 log no longer reaches a winner — see 6.)*
6. On the 2026-08-20 reported playtest log the system shall refuse at move
   **233**, E's step `3,-4,0 → 4,-4,0`, and shall name that move. The prefix of
   233 moves shall fold without a winner. *(P47 prefix golden. 1242/1243 remain
   in the fixture as historical landmarks and are not reached.)*
7. The system shall not mutate the input state when it refuses.
8. Equal won states shall refuse equal moves with equal messages.
9. The system shall reach a won state only through a move, never through
   `legalMoves`.
10. The adapter shall present the board as playing until the deciding move's
    overlays have finished, and as over thereafter.
11. The adapter shall begin the celebration no earlier than the deciding move's
    own overlays settle, and no later than a ceiling not less than that settle
    time. *(Queue-empty is the trigger and is self-bounding, because nothing can
    enqueue after the win. The ceiling guards a bug, not the design — see **When
    the celebration begins**, which corrects a first draft that had this backwards
    and picked a ceiling 500 ms shorter than the packet's headline move.)*
12. The adapter shall lock input on `winner`, not on the celebration. *(`Hud.tsx`
    computes `controlsLocked(victory)`, which is `fx.kind === 'over'`. So the moment
    the celebration reads *playing* during the wait, the board **unlocks for the
    length of the winning move's animation** — a bug this packet would introduce if
    the lock is not rewired first.)*
13. The adapter shall begin the celebration exactly once per match.

## Out of scope

- §11 item 45 — whether a vanishing seat's trail evaporates rather than clearing,
  and the flicker-then-fade requested for it. **Resolved by P39:** it still
  clears; the adapter presents flicker-then-fade. P38 sequences the effects that
  exist; P39 adds the vanish overlay to that sequence. See
  `docs/spec/seat-vanish-fx/seat-vanish-fx.md`.
- The celebration's content (P29): dim, shine, pulse, banner.
- Restart or rematch from a finished board (P20+).
