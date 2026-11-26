# P107 — Match log v2: timestamps, seats, resolved agent replies and event records

> **Not a game-rule change.** contracts (`GameEvent` / `AppliedStep` moved in,
> `LogEvent`, export v2 types), rules-core (the event resolver moved in from
> web, plus `resolveShareEvents`, `toLogEvent`, `logEventsOf`), online-api
> (the log writer, the advance, the agent door's reply line, the export) and
> web (imports only). No SPEC.md edit, no new route, no new AWS. The
> agent-facing offer text is unchanged (MCP and BYOK stay identical).
> Breaking: `formatVersion: 2`; export `seats[].kind` `bot` → `heuristic`;
> the reply record's `seat` moves out of `agentReply`; `stampLogLine` takes a
> logged move; `advance` returns `logged` (moves with their line data);
> `packages/web/src/fx/events.ts` is gone.

**Status:** awaiting review. **Depends on:** P49, P92, P95, P96. **Issue:**
[#122](https://github.com/hochgi/conquarrow/issues/122).
**Spec:** [match-log-v2](../../spec/match-log-v2/match-log-v2.md) ·
[SCENARIOS](../../spec/match-log-v2/SCENARIOS.md).

## Symptom

From the P97 export and the 2026-11-26 match analysis: log lines are only
`{v, move}` and `{v, agentReply}`. No per-move time, no seat, an agent reply
records offer indices that mean nothing without the offer, and every battle,
cut, closure, conversion, birth, share change and elimination had to be
re-derived by replaying the game. Seats said `bot` while standings said
`heuristic`.

## Decisions

See the spec's D1–D7. In short:

1. One resolver: `resolveEvents` moves to rules-core, the types to
   contracts; the web imports it. `resolveShareEvents` adds share deltas
   (needs geometry).
2. Move lines `{v, at, seat, by?, move, events}`, per applied move;
   `by: "server"` for the advance's moves.
3. Reply lines `{v, at, seat, agentReply: {moves, resolved, offerVersion,
   endTurn, why?, plan?}}`. No `latencyMs` (would need a write per observe;
   the line `at`s give the agent's time).
4. Export: `formatVersion: 2`, kinds `human | agent | heuristic`, v2 fields
   passed through, v1 lines exported as they are.

## Open questions (for Gilad)

1. **`latencyMs`.** Worth a write per `observe` to record exactly when the
   offer was served? Today the gap between line `at`s measures it from the
   moment the turn reached the agent.
2. **Backfill old games?** Pre-P107 logs export without `at`/`seat`/`events`.
   Events and seats could be recomputed at export time by replay; times
   cannot.

## Tests

`packages/rules-core/test/match-log-v2.events.test.ts` (projection, share
events, `logEventsOf`), `packages/online-api/test/match-log-v2.scenarios.test.ts`
(SCENARIOS 1–4), and the updated P49/P92/P96 tests that read the line or
the export shape. The web's event-legibility and seat-vanish tests run
against the moved resolver unchanged.
