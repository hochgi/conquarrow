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
   displayed version, `GET` the game, and answer `stale` (clear + refresh, so
   App installs the latest snapshot and reports it displayed). A flush never
   replays the stuck batch again: App may have applied part of it.
2. **Guards** (`submitRefusal`, P100 order).
3. **`held`.** With a usable token, heal. A heal that posted or dropped
   returns its outcome. `drop-other` clears the hold and the guards run again.
   `wait` returns `held`.
4. **`not-your-turn`.** Re-check once, then `afterRecheck`.
5. Send (P94/P95 unchanged).

`poll` and `becomeVisible` run step 1 (without returning) and step 3 when a hold
exists, storing a `held-sent` / `held-dropped` / POST outcome for
`takeHealOutcome` (read once; `undefined` after).

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
   or `poll` shall clear the queue and the in-flight batch, read the game, and
   (for `submitMoves`) answer `stale` with no POST.
7. When `submitMoves` would answer `not-your-turn`, the system shall first read
   `/me` and the game exactly once each.
8. The system shall not POST after a re-check that found a newer version.
9. `takeHealOutcome` shall return a stored outcome once, then `undefined`.
10. `heldPlan`, `replayStalled`, `afterRecheck` shall be total and
    deterministic over their inputs.
