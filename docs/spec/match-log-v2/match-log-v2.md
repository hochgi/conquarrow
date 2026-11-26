# match-log-v2 — timestamps, seats, resolved agent replies and event records in the server's match log

Packet: [P107](../../design/packets/P107-match-log-v2.md). Issue
[#122](https://github.com/hochgi/conquarrow/issues/122). Amends
[game-management](../game-management/game-management.md) D1–D2 (the export
shape) and [online-move-log-replay](../online-move-log-replay/online-move-log-replay.md)
D2 (the log line). [SCENARIOS](./SCENARIOS.md) ·
[core](./match-log-v2.core.feature) · [edge cases](./match-log-v2.edge-cases.feature).
**Status:** awaiting review. **SPEC:** not edited. No game rule is touched:
every event is a reading of a state `rules.apply` already produced.

## Purpose

The server's `log.jsonl` is the record of an online game, and the export
(`GET …/export`, the web Download log, the MCP `export` tool) serves it. The
v1 line was `{v, move}` and `{v, agentReply}`. A reviewer could not tell when
a move was made, which seat made it, what an agent's offer indices turned
into, or what a move did (a battle, a cut, a closure, a conversion, a share
change, an elimination) without replaying the game with rules-core and
re-deriving it. The 2026-11-26 match analysis did exactly that replay to
count conversions, births, share swings and eliminations. v2 writes those
facts down when the move is applied.

## Glossary

| Term | Meaning |
|---|---|
| **move line** | One applied move in `log.jsonl`: `{v, at, seat, by?, move, events}`. |
| **reply line** | One agent reply record: `{v, at, seat, agentReply}`. Not a move. |
| **seat** | The player id (`A`…`F`) whose turn it was when the move was applied: `before.activePlayer`. |
| **server move** | A move the server chose, not a client: the P95 advance (a heuristic seat's move, a pass-only seat's pass, the 64-choice turn cap's `endTurn`). Marked `by: "server"`. |
| **event resolver** | `resolveEvents(step)` in `@conquarrow/rules-core` (`events.ts`), the one the web animates with. Moved there from `packages/web/src/fx/events.ts`; the `GameEvent` type is in `@conquarrow/contracts` (`game-events.ts`). |
| **log event** | The compact record of one event in a move line (`LogEvent`, contracts): ids and counts, no arrow lists. |

## Decisions (online BSSN, recorded here)

### D1 — one event resolver, shared

`resolveEvents` / `resolveBatch` move to `packages/rules-core/src/events.ts`
unchanged and are exported from `@conquarrow/rules-core`. The `GameEvent`
union and `AppliedStep` move to `packages/contracts/src/game-events.ts`. The
web imports both from the packages; `packages/web/src/fx/events.ts` is gone.
Nothing else about the resolver changes: same events, same order. Agent
context (#123) and event animations (#124) build on the same module.

Share ownership needs the board geometry (a share is a spawner-border arrow
of the player's territory, `shareCountOf`), and `resolveEvents` is
geometry-free. So the same module adds `resolveShareEvents(geometry, step)`:
one `sharesChanged {player, from, to}` per player whose share count changed,
in turn order (`players`).

### D2 — what a move line records

`logEventsOf(geometry, step)` (rules-core) is what the server writes:
`resolveEvents(step)` projected by `toLogEvent`, then
`resolveShareEvents(geometry, step)`. The projection keeps the facts the
issue lists and drops what the move itself already says:

| `GameEvent` kind | Log event |
|---|---|
| `combat` | `{kind, arrow, attacker, defender, attackerSent, defenderBefore, attackerLost, defenderLost, holder?}` |
| `trailCut` | `{kind, victim, attacker, cutArrow?, arrowCount}` |
| `enclosureClosed` | `{kind, player, closingArrow?, boundaryCount, claimedCount}` |
| `territoryCaptured` | `{kind, player, arrowCount, takenFrom}` |
| `territoryLost` | `{kind, player, to?, arrowCount}` |
| `unitsConverted` | `{kind, arrow, from, to, heads}` |
| `unitsProduced` | `{kind, player, arrow, amount}` (a spawner birth) |
| `seatVanished` | `{kind, player, arrowCount}` (an elimination) |
| `turnPassed` | `{kind, from, to}` (every `endTurn`, auto-passes included) |
| `matchWon` | `{kind, player}` |
| `moved`, `trailLaid`, `stackSplit`, `sentryLeft`, `stackMerged` | dropped: the move line's `move` and the previous position say them |
| — | `sharesChanged {kind, player, from, to}` (D1) |

Ids are strings. An absent optional (`holder`, `cutArrow`, `closingArrow`,
`to`) is left out of the JSON. Events are written **per applied move**, not
per turn: a three-step trip that cuts on step one and closes on step three
keeps its two causes apart, which is why the resolver is per step too.

### D3 — the move line

```
{"v":N,"at":"<ISO>","seat":"B","by":"server","move":{…},"events":[…]}
```

- `v` — the version the write produced (P49 D2, unchanged).
- `at` — the server clock (ISO 8601) read right after this move was applied
  (`applyLogged`), for every move: a client's, an agent's steps, and each of
  the advance's, so a long heuristic burst shows its pace.
- `seat` — `String(before.activePlayer)`.
- `by` — `"server"` on a server move; absent on a move a human posted or an
  agent's `move` call applied (its steps and the `endTurn` that closes its
  turn, whether the agent asked for it or had no step left).
- `events` — D2, possibly `[]`.

`GET …/log?since=` still serves `moves` only (the extra fields are for the
record, not the replay).

### D4 — the reply line

```
{"v":N,"at":"<ISO>","seat":"B","agentReply":{"moves":[5],"resolved":[{…}],"offerVersion":N-1,"endTurn":false,"why":"…","plan":"…"}}
```

- `moves` — the offer row indices the agent sent (unchanged).
- `resolved` — the moves those indices became, in order (the steps the call
  applied). `[]` when it sent only `endTurn: true`.
- `offerVersion` — the version of the position the offer was built from (the
  version the call acted on, so `v - 1`).
- `at` — when the server received the reply: the clock read before any of
  its moves applied (so it is earlier than its own move lines' `at`).
- `seat` moves from inside `agentReply` to the line, like every line.
- **No `latencyMs`.** The server does not record when an `observe` served an
  offer, and storing it would add a write to every observe. The time an
  agent spent is readable as this line's `at` minus the `at` of the last line
  of an earlier version (the move that handed it the turn). Backlog.

A refused or unusable call writes nothing (unchanged).

### D5 — one kind vocabulary

The export says `human | agent | heuristic` everywhere: `seats[].kind` was
`bot` and is now `heuristic`, matching `summary.standings[].kind` and the
stored invite. A heuristic seat's `name` stays `AI`.

### D6 — the export is format version 2

`formatVersion: 2`. `log` entries:

- move: `{v?, at?, seat?, by?, move, events?}`
- reply: `{v, at?, seat?, agentReply: {moves, resolved?, offerVersion?, endTurn, why?, plan?}}`

The fields after `v` are optional because a game started before P107 keeps
its v1 lines: they export as they are, with no `at`, `seat`, `by` or
`events`, and are not backfilled. A pre-P107 reply's nested `seat` is lifted
to the entry. Withholding (game-management D2) reads that seat: a reply of
another seat, or one with no seat, is withheld while the game has no winner.
`moves`, `config`, the summary and everything else are unchanged;
`replay(makeMatch(config), moves)` is still the served state.

### D7 — size

Measured on the 2026-11-07 playtest fixture and a 6-seat AI self-play (the
packet's size note): about ×2.2 per line, 180 B on average. Events are ids and
counts, so a line grows by a near-constant amount, not by a closure's size.

## EARS

- **E1** When the server persists a version, every move line it appends shall
  carry `v`, `at`, `seat`, `move` and `events`, and `by: "server"` exactly
  when the advance chose the move.
- **E2** When a line's events are written, they shall equal
  `logEventsOf(geometry, {before, after, move})` for that move.
- **E3** When an agent's `move` call is applied, the reply line shall carry
  `resolved` equal to the steps applied from its indices and `offerVersion`
  equal to the version it acted on.
- **E4** When a game is exported, the export shall have `formatVersion: 2`,
  seat kinds from `human | agent | heuristic`, and every stored line's v2
  fields as written.
- **E5** While the game has no winner, the export shall withhold every reply
  line whose seat (top-level, or nested for a pre-P107 line) is not one of the
  caller's seats.
- **E6** The web shall animate with the resolver from `@conquarrow/rules-core`
  and keep no copy of it.

## Out of scope

Animation pacing (#124), the agent's "since your last turn" text (#123),
scoring logged replies as BYOK samples, backfilling pre-P107 logs.
