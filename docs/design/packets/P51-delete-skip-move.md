# P51 — Delete `SkipMove`

**Layer:** `contracts`, `rules-core`, `web`, `online-api`, plus a SPEC.md
correction. **Depends on P50**, which stops the only producer of a skip.

**No behavioural delta.** After P50 nothing emits a skip, so removing it changes
nothing a player can observe. This packet is a deletion and a spec fix.

## Why

`applySkip` ([`movement.ts:325`](../../../packages/rules-core/src/movement.ts))
is a state no-op: it validates the arrow and returns the same state. Its entire
content is being a *recorded decision*. It was only ever a way to jump to the
next actionable stack — the job P50 now does client-side — and recording it in
the move log made a UI cursor into a domain concept, put it on the online wire,
and got it written into SPEC.md as a game rule it never was.

Leaving it in place leaves a move kind that no code path produces, that every
consumer must still handle, and that SPEC.md still describes as first-class.

## What ships

### 1. The deletion

- `contracts`: `SkipMove`, the `skip()` constructor, the `Move` union member,
  the equality arm; `MOVE_KINDS` becomes `['step', 'endTurn']`; the `index.ts`
  export.
- `rules-core`: `applySkip`, the `moves.push(skip(arrow))` emission in
  `legalMoves`, the `case 'skip'` dispatch arm.
- `web`: `requestSkip` and the `InputMode` member, the residual `Hud` /
  `App` / `tutorial/restrict.ts` / `matchLog.ts` / `findings.ts` /
  `opponent.ts` / `byokBot.ts` references P50 left behind.
- `online-api`: the `'skip'` decode arm in `game-handlers.ts`.

Nothing regresses on the AI side:
[`byokBot.ts:97`](../../../packages/web/src/byokBot.ts) already does
`moves.filter((m) => m.kind !== 'skip')`, so no bot has ever emitted one.

### 2. No backward compatibility

A persisted move log containing `"skip"` is **rejected** by the decoder, not
translated. Matches logged before P50 do not replay. This is a deliberate call by
the human owner — those logs are being deleted — and it is what keeps this a
deletion rather than a compatibility shim.

### 3. The test and feature sweep

This is the bulk of the diff and it is mechanical.

**43 uses of `skip(` across 30 test files.** Three kinds, and they are not
interchangeable:

- **Incidental no-op nudges** — `apply(state, skip(x))` used to advance without
  moving while asserting something else did not change. Delete the nudge; the
  assertion stands on the state it already had.
- **Assertions about skip itself** — skip on an arrow that is not yours throws;
  skip does not convert; a skipped step does not bank. These lose their subject.
  Each must be either deleted (the behaviour no longer exists) or restated
  against the surviving expression of the same idea, which is that **no step is
  ever compelled**. Decide per test in phase 2; do not blanket-delete, and do not
  blanket-keep.
- **Replay fixtures** containing a skip in their move list. Re-record without it;
  the final state must be identical, and if it is not, that is a defect to
  report rather than a fixture to adjust.

**94 lines across 27 `.feature` files.** Shipped specs whose scenarios name skip.
Correct the ones describing live behaviour. A scenario that only exists to
exercise skip goes with it.

### 4. SPEC.md correction

`skip` is load-bearing prose in six places. Declining stays legal — nothing ever
compelled a move, and **End turn** remains the only way to forfeit remaining
allowance — but the *mechanism* changes from "skip is a move you make" to "no
move is compelled".

- **§4 `:285`** — "A stack may move or skip" → a stack may move, or not; there is
  no move that means *not*.
- **§4 `:332`** — skipping is normal: keep the point (a rearguard standing still
  is doing its job), reword off the word *skip*.
- **§2 `:54`** and **§6.2 `:508`** — "declining is always legal … Skip is a
  first-class move (§4)" → declining is legal because no step is ever forced, not
  because a decline is a move.
- **§6.2 `:1059`**, **§6.3 `:1097`** — "skip still declines advancing" / "Skip
  does not convert" → reword to *not stepping*.
- **§11 item 19 `:947`** — the resolution says "skip is a first-class move".
  Amend in place per CLAUDE.md (strike, do not delete) and point at this packet.
- **§11 item 19's sub-item `:951`** — "does a skipped step bank" is moot; the
  answer (no) is unchanged and now follows from there being nothing to skip.

No §11 item is opened. If a behaviour turns up that this packet has not decided,
that is a §11 entry and an escalation, not a default.

## Acceptance

- `MOVE_KINDS` contains no `'skip'`; `grep -r "skip" packages/*/src` returns
  nothing outside comments.
- A log or wire payload carrying `"skip"` is rejected.
- `pnpm verify` green with no test skipped, `.only`'d, or weakened to pass.
- No behavioural test changed its *expected* value — only its setup. Any that
  did is called out in the review.
