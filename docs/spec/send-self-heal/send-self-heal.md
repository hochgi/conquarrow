# send-self-heal — a held submit, a stalled replay and a stale turn recover without a reload

**Packet:** [P104](../../design/packets/P104-send-self-heal.md). Issue
[#129](https://github.com/hochgi/conquarrow/issues/129), second half.
**SPEC:** not edited. No game rule. Nothing owed to SPEC §11.
**Amends:** [send-refusal](../send-refusal/send-refusal.md) — `held`,
`replaying` and `not-your-turn` are no longer final on the first try.
**Layer:** `packages/web` (`online-heal.ts` new and pure, `online-pages.ts`,
`online-submit.ts`, `App.tsx`) and `packages/contracts`
(`SUBMIT_OUTCOMES`, `OnlinePagesPort.takeHealOutcome`,
`OnlinePagesDeps.replayStallMs`).
**Protocol:** [SCENARIOS.md](./SCENARIOS.md) — every path is a
`@hochgi/test-kit` component test in
`packages/web/test/send-self-heal.scenarios.test.ts`.
**Features:** [core](./send-self-heal.core.feature) ·
[edge cases](./send-self-heal.edge-cases.feature)

## Terms

| Term | Means |
|---|---|
| **hold** | P95 D10's `HeldSubmit`: game, moves, ids, version, and (new) the `userHash` it was made under |
| **usable token** | `readUsableSessionToken` returns one |
| **heal** | the `GET /me` (+ `GET` game) and the `heldPlan` decision that follows |
| **progress** | a batch queued (`planWake`), taken (`takeReplay`) or displayed (`noteDisplayed`) |
| **stalled** | a batch queued or in flight, and `now − lastProgress ≥ replayStallMs` |

## Pure decisions (`online-heal.ts`)

```
REPLAY_STALL_MS = 20_000

heldPlan({ held, onHeldGame, meOk, me, boardVersion }):
  if not meOk:                                   'wait'
  if not onHeldGame:                             'drop-other'
  if held.userHash, me both known and differ:    'drop-stale'
  if boardVersion undefined:                     'wait'
  if boardVersion === held.version:              'send'
  otherwise:                                     'drop-stale'

replayStalled({ pending, progressAt, now, stallMs }) =
  pending and progressAt defined and now − progressAt ≥ stallMs

afterRecheck({ refusal, before, after }) =
  refusal defined ? refusal : before === after ? 'send' : 'stale'

healedOutcome(posted) = posted === 'sent' ? 'held-sent' : posted
```

## Notes (`submitNote`)

| Outcome | Note | Draft |
|---|---|---|
| `held-sent` | `Your waiting move was sent. The board has caught up — check it before you move again.` | clear, refresh |
| `held-dropped` | `Your waiting move was dropped: the game moved on while you were signed out. The board has caught up.` | clear, refresh |

## Order inside `submitMoves`

1. **Watchdog.** If stalled: clear the queue, the in-flight batch and the
   displayed version, `GET` the game when the hash is a game, and answer
   `stale` (clear + refresh, so App installs the latest snapshot and reports
   it displayed). A flush never replays the stuck batch again: App may have
   applied part of it. The next Send is not `replaying` even if App has not
   reported that batch displayed.
2. **Guards** (`submitRefusal`, P100 order).
3. **`held`.** With a usable token, heal. A heal that posted or dropped
   returns its outcome. `drop-other` clears the hold and the guards run again,
   including when no board is loaded. `wait` returns `held`. A heal `GET` of
   the held game that answers 404 is not a wait: [P96 D12](../game-management/game-management.md)
   has already dropped the hold, cleared the board, set the hash to `''` and
   `gameDeleted()`. `submitMoves` answers `no-game` and posts nothing. The
   hold is not restored. `held` would say the move is still waiting;
   `held-dropped` would say the board moved on and caught up. Neither is true.
   This packet does not add an outcome and does not rewrite P100's `no-game`
   note. The lobby's "That game was deleted." is the explanation.
4. **`not-your-turn`.** Re-check once, then `afterRecheck`. A re-check `GET`
   that answers 404 is the same P96 clear, then the guards answer `no-game`.
5. Send (P94/P95 unchanged).

A stalled flush clears the queue, the in-flight batch and the displayed
version even when the hash is no longer a game — navigation does not clear an
in-flight batch. It `GET`s the game only on a game route. It never requests a
game whose id is missing.

`poll` and `becomeVisible` run the flush (without returning) and step 3 when a
hold exists. A `held-sent`, `held-dropped` or POST outcome is stored for
`takeHealOutcome` (read once; `undefined` after). A 404 deletion is not stored:
the lobby already says the game was deleted, so `takeHealOutcome` stays
`undefined`.

## Invariants (EARS)

1. While a hold exists and `/me` has not answered 200, the system shall not
   POST the held moves.
2. When a heal posts, the system shall POST exactly the held moves with their
   held ids, in order, the first with `If-Match` the held version.
3. The system shall never POST a held move against a version other than the
   held one.
4. When the board moved past the held version, the system shall drop the hold
   and answer `held-dropped` with no POST.
5. While a batch is queued or in flight and has progressed within
   `replayStallMs`, `submitMoves` shall answer `replaying` with no POST.
6. When a batch has not progressed for `replayStallMs`, the next `submitMoves`
   or `poll` shall clear the queue and the in-flight batch, read the game when
   the hash is a game, and (for `submitMoves`) answer `stale` with no POST.
   That clear holds even if App has not reported the flushed batch displayed.
7. When `submitMoves` would answer `not-your-turn`, the system shall first read
   `/me` and the game exactly once each.
8. The system shall not POST after a re-check that found a newer version.
9. `takeHealOutcome` shall return a stored outcome once, then `undefined`.
10. `heldPlan`, `replayStalled`, `afterRecheck` shall be total and
    deterministic over their inputs.
11. When a heal's `GET` of the held game answers 404, the system shall answer
    `no-game` from `submitMoves`, post nothing, and shall not restore the hold.
    A poll or resume on that path shall not store a heal outcome.
12. When a stalled flush runs and the hash is not a game, the system shall clear
    the queue and the in-flight batch and shall not `GET` a game.
13. When a heal runs off the held game, the system shall drop the hold even if
    no board is loaded, and shall not post the held moves.
