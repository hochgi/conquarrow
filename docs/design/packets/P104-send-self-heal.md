# P104 — A stuck Send heals itself: a held submit, a stalled replay, a stale turn

> **Not a game-rule change.** Web adapter (`online-pages.ts`, a new pure
> `online-heal.ts`, the submit notes, one App effect). Breaking contract edits:
> `SubmitOutcome` gains `held-sent` and `held-dropped`; `OnlinePagesPort` gains
> `takeHealOutcome()`; `OnlinePagesDeps` gains an optional `replayStallMs`. No
> `online-api` change, no new route, no SPEC.md edit, no new AWS.

**Status:** delivered. **Depends on:** P49, P94, P95, P98, P100. **Issue:**
[#129](https://github.com/hochgi/conquarrow/issues/129) (second half).
**Spec:** [send-self-heal](../../spec/send-self-heal/send-self-heal.md) ·
[SCENARIOS](../../spec/send-self-heal/SCENARIOS.md).

## Symptom

P100 made every refused Send say why. Three refusals could still last forever:

1. **`held`.** A 401 holds the unsent rest (P95 D10) and only a GIS credential
   on the same route sends it. A usable token with a hold still in memory left
   the board locked and every Send refused.
2. **`replaying`.** The adapter's in-flight batch is cleared only by
   `noteDisplayed`. If App's drain loop ends without reporting the batch (a
   throw in `playBatch`, say), the adapter refuses every Send as `replaying`
   while App shows an unlocked board.
3. **`not-your-turn`.** Stale seats or `/me` (a sign-out and back in) made
   `callerIsToMove` false with no way to correct it short of a reload.

## Decisions (adapter BSSN — normative detail is the spec)

1. **Heal a hold when the session is valid.** On a Send that finds a hold, on
   every poll and on every resume, with a usable token: `GET /me`, then (on the
   held game's route) `GET` the game. A pure `heldPlan` decides:
   - `/me` not 200 → wait (a 401 already ran the P98 door);
   - not on the held game → drop silently (P95 D10: a hold belongs to its game);
   - `/me` names another user than the one the hold was made for → drop;
   - the board is still at the held version → send the held rest, same ids
     and `If-Match` (outcome `held-sent` on success, else that POST's outcome);
   - the board moved on → drop (outcome `held-dropped`).

   **No rebase across a moved board.** The held moves were chosen on the held
   version; posting them against a newer one is a move chosen from the past
   (P49 D7). "Rebase" is therefore exactly the same-version case. The current
   Send's own moves are not posted after a heal: they were drawn while the
   board was locked or before the hold resolved, so the heal's outcome is the
   answer and the board catches up (`held-*` clear the route and refresh).
2. **Replay watchdog.** The adapter stamps `now()` whenever the replay queue
   makes progress (queued, taken, displayed). When a batch is queued or in
   flight and nothing has progressed for `replayStallMs` (default
   `REPLAY_STALL_MS = 20_000`, injectable), a Send or a poll flushes the queue,
   the in-flight batch and the displayed version, and reads the game. App then
   installs the latest snapshot. A Send that flushed answers `stale` (clear and
   refresh). The stuck batch is never replayed again: App may already have
   applied part of it.
3. **One re-check before `not-your-turn`.** `GET /me` and `GET` the game once,
   then guard again. Still not the caller's turn → `not-your-turn`. The
   caller's turn now and the version unchanged → send. The caller's turn at a
   newer version → `stale` (no POST; the board catches up).
4. **A heal outside a Send still says so.** The adapter keeps the last heal
   outcome from a poll or resume; App reads it once (`takeHealOutcome`) and
   shows its note.

## Out of scope (backlog)

The P100 + P104 phone check. A server-side hold. Rebasing a held route onto a
moved board (would need the rules engine to re-validate a route the player
can no longer see).
