# send-refusal — a refused Send says why and keeps the route

**Packet:** [P100](../../design/packets/P100-send-refusal.md). Issue
[#129](https://github.com/hochgi/conquarrow/issues/129), first half.
**SPEC:** not edited. No game rule is added, changed, or implied. Nothing is
owed to SPEC §11.
**Amends:** [online-turn-flow](../online-turn-flow/online-turn-flow.md) D6
(“`illegal` keeps the host's own note”; `refused` had no note) and the
`refused` outcome of P94 D5 / P95 D9–D10. The guards themselves and their
meaning are unchanged; only what they return, what the human sees, and
whether the draft survives change.
**Layer:** `packages/contracts` (`SubmitOutcome`), `packages/web`
(`online-pages.ts`, `online-submit.ts`, `online-host.ts`, `input/modes.ts`,
`App.tsx`, `Board.tsx`). No `online-api` change. A refusal sends no request,
so there is no new protocol path, no `SCENARIOS.md` and no new
`@hochgi/test-kit` test. The existing session-expired diagrams are unchanged.
**Features:** [core](./send-refusal.core.feature) ·
[edge cases](./send-refusal.edge-cases.feature)

## Terms

| Term | Means |
|---|---|
| **refusal** | A `SubmitOutcome` decided before any request. One of `SUBMIT_REFUSALS` |
| **reached the server** | Every other non-`sent` outcome: `illegal`, `stale`, `forbidden`, `failed`, `unauthorized`. At least one request was made (or retried) |
| **guard input** | The facts `submitRefusal` reads: online env ready, a usable token, on a game route with a board, the move count, a submit in flight, a held submit, a replay in flight, a winner, the caller to move |
| **sent snapshot** | The snapshot `send()` returned: idle, empty highlights, `pending` = the draft |

## Decisions (adapter BSSN)

### D1 — one reason per guard, first failing guard wins

`SubmitOutcome = 'sent' | SubmitRefusal | 'illegal' | 'stale' | 'forbidden' |
'failed' | 'unauthorized'`. `SubmitRefusal` and the runtime lists
`SUBMIT_REFUSALS` and `SUBMIT_OUTCOMES` live in `@conquarrow/contracts`.
`refused` no longer exists.

`submitRefusal(input)` (pure, `online-pages.ts`) returns the first of:

| # | Reason | When |
|---|---|---|
| 1 | `not-ready` | the online env is not configured |
| 2 | `sending` | a submit is in flight |
| 3 | `held` | a submit is held for the next sign-in (P95 D10) |
| 4 | `signed-out` | no usable session token (P98 D6 already removed an expired one) |
| 5 | `no-game` | the route is not a game, or no board is loaded |
| 6 | `no-moves` | the move list is empty |
| 7 | `replaying` | a replay batch is queued or playing (P49 D7) |
| 8 | `game-over` | the board has a winner |
| 9 | `not-your-turn` | the caller's seat is not the active player |

or `undefined` when every guard passes. `submitMoves` sends nothing when it
returns a reason, and returns that reason. Past the guards the game target is
narrowed with a throw that cannot fire, not a second `no-game`, so the guard
is the only thing that answers `no-game`. `game-over` is checked before
`not-your-turn` because a finished board's active player says nothing about
the caller. `sending` before `held` because both are `submitPending()` and the
in-flight one is the more immediate fact (`sendHeld` submits while `held` is
still set). `held` before `signed-out` because the 401 that holds a submit
also clears the token (P98 D2): the held note already says to sign in, and it
says the move is waiting rather than lost.

### D2 — no outcome but `sent` is silent

`submitNote` returns a sentence for every outcome in `SUBMIT_OUTCOMES` except
`sent`, which stays `undefined`. Each refusal sentence says that nothing was
sent and, where there is one, what to do. `illegal` has a sentence. The host's
`illegal()` returns `submitNote('illegal')`, not the bare word `illegal`, so
the note in the HUD is the same sentence whichever path shows it. The other
outcomes' sentences (P94, P95) are unchanged.

### D3 — keep the route when nothing was sent

`draftAfterSubmit(outcome)` (pure, `online-submit.ts`) is `keep` for every
refusal and `clear` for `sent` and every outcome that reached the server.
`commitSnap` applies it through the pure `settleSubmit(outcome, mode)`
(`online-submit.ts`), which returns the snapshot and whether to refresh:
`keep` → `mode.restoreSent()` and no host refresh; `clear` → `mode.reset()`
and a refresh (as today). A
refusal changed nothing on the server, and a refresh bumps `gen`, whose
snapshot-install effect calls `mode.reset()` and would wipe the restored route.
A rejected `submitMoves` promise (`settleSubmit(undefined, …)`) counts as
`clear`.

A later `gen` bump (a wake, a poll, a replay finishing) still resets the input
as it does today. So a `replaying` refusal keeps the route until that replay's
install; the player redraws then. Not changed here.

`InputMode.restoreSent()` returns the route phase and highlights the mode
held when `send()` produced the sent snapshot, with no `pending` and no
`refusal`, and makes that the current snapshot. It restores only when the
current snapshot is still that sent snapshot. Otherwise (the player clicked,
cancelled or sent again, or the mode was reset), and when the last `send()`
had no draft, it behaves as `reset()`. A restore is one-shot.

Why not keep the draft on `failed`: the retries may have landed a prefix, and
resending the whole draft would post moves twice. Why not on `unauthorized`:
the unsent rest is already held and sent after the next sign-in (P95 D10).

### D4 — a cancelled pointer ends the drag

The board SVG passes `onPointerCancel` and `onLostPointerCapture`. Both drop
the event's pointer, clear the pinch when fewer than two pointers remain, and
clear the drag. The decision is the pure `cancelPointer(pointers, id)` in
`input/pointer.ts`; `App.tsx` only wires it. `touch-action: none` is already set on the board SVG. CI has
no DOM; the PR's phone check covers a pinch during a route draw.

## EARS

1. When `submitMoves` is called and a guard fails, the adapter shall make no
   request and shall return the first failing guard's reason (D1).
2. The submit note shall be defined for every outcome other than `sent` (D2).
3. When a POST is answered 422, the host's `illegal()` shall equal
   `submitNote('illegal')` (D2).
4. When a submit settles with a refusal, the shell shall restore the route
   that was sent; otherwise it shall clear it (D3).
5. When the pointer is cancelled or loses capture, the board shall end any
   drag or pinch that pointer was part of (D4).

## Mutation

`pnpm test:mutation:changed` on this packet's lines. The suppressions are the
`App.tsx` wiring (no DOM harness; `settleSubmit` and `cancelPointer` carry the
decisions and are tested) and the unreachable narrowing throw in
`submitMoves`. Pinned in `send-refusal.mutation-pins.test.ts`.

## Out of scope

Held-submit self-heal, a stuck-replay watchdog, and a `not-your-turn` re-fetch
(issue #129, second half; on the backlog). HUD turn copy (#120).
