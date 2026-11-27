# agent-context-v2 — who is who, what happened since your last turn, and honest step counts in the agent's offer

Packet: [P108](../../design/packets/P108-agent-context-v2.md). Issue
[#123](https://github.com/hochgi/conquarrow/issues/123) (first slice).
Amends [remote-agent-mcp](../remote-agent-mcp/remote-agent-mcp.md) (the
`move` tool schema and description) and
[byok-hint-and-threat](../byok-hint-and-threat/byok-hint-and-threat.md) (the
LEGAL_MOVES `spd` / `left` slots). [SCENARIOS](./SCENARIOS.md) ·
[core](./agent-context-v2.core.feature) ·
[edge cases](./agent-context-v2.edge-cases.feature).
**Status:** awaiting review. **SPEC:** not edited. No game rule is touched.

## Purpose

An agent (an MCP agent through the door, or a BYOK seat in the browser) reads
one offer per call. The P95–P97 playtests showed what the offer could not
tell it:

- who the other seats are: their kind, their name, and which seat is its
  owner;
- what happened since its last turn: whether its cut or fight worked, and
  what the others did;
- how long it has before starvation: `dominationN` and the streaks were only
  in `STATE_JSON`;
- how many steps a split portion has left. A row could read `left=-1` for a
  step the engine accepts;
- that the `move` tool takes integer indices and `why` / `plan` strings. The
  schema said none of it, so models often left the reasons out;
- that every index in one reply refers to the same offer.

Everything here is built by `packages/byok-offer`, so the door and the BYOK
seat give a model the same text for the same position and history.

## Glossary

| Term | Meaning |
|---|---|
| **offer** | The text `offerText` / `buildUserPrompt` render for one seat at one position. |
| **about** | `OfferAbout`: what the offer is told besides the state, namely the seat table and the recent history. The caller builds it; the builder renders it. |
| **seat row** | `{player, kind, name, relation?}`, one per seat in turn order. `kind` is `human`, `agent` or `heuristic`. `relation` is `you`, `also you` or `your owner`. |
| **recent line** | `{seat, move, events}`: one applied move, the seat whose turn it was, and its P107 log events (`LogEvent[]`). |
| **run** | A maximal stretch of consecutive recent lines with the same seat: one seat's turn, or the part of it played so far. |
| **completed run** | A run whose last move is `endTurn`. |
| **allowance** | The engine's step budget for a group this turn: `speedOverride ?? speed(heads)`. |

## Decisions

### D1 — the seat table

The offer's second block lists every seat in turn order:

```
Seats in turn order:
A human Gilad (your owner)
B agent Gilad's agent (you)
C heuristic AI
```

- **Online (the door).**
  - `kind` is the chair's kind.
  - `name` is the P105 wording without the caller's view (`seatLabel` with relation `other`): the chair's stored owner name, `<name>'s agent`, `AI`, or `Player <letter>` when there is no usable name.
  - `relation`:
    - `you` is the seat being offered.
    - `also you` is another agent chair of the same user (P106).
    - `your owner` is a human chair bound to the agent's own user.
- **Local (BYOK).**
  - `Player` → `human` with the name `Player <letter>`.
  - `AI` → `heuristic` with the name `AI`.
  - `BYOK LLM` → `agent` with the name `Agent`.
  - `relation` is `you` for the offered seat only. A local BYOK seat has no owner seat (see open questions).
- A name is printed on one line. Line breaks become spaces, and it is cut to 40 characters, so a name cannot add lines to the offer.

### D2 — starvation, read from the state

```
Starvation: a living seat with no spawner share loses after dominationN=5 full rounds in a row. Streaks: A 0, B 2, C 0.
```

`dominationN` is `state.dominationN`, and each streak is
`state.starvationStreaks.get(player) ?? 0`, in turn order. Nothing is
hardcoded. `STATE_JSON` still carries both until P109 trims it.

### D3 — since your last turn

`recentWindow(lines, me)` picks the window. Let `j` be the last completed run
whose seat is `me`. The window is every line from the start of run `j` to the
end, the current unfinished run included. With no such run, the window is
every line (the agent's first turn). It is rendered after the threat line:

```
Since your last turn (oldest first; B is you):
B, 3 steps: B cut C's trail at <arrow> (4 arrows); B closed a loop at <arrow> (6 claimed); B shares 2→3
C, 2 steps: combat at <arrow>: C sent 3 vs B 2, C lost 1, B lost 2, C holds
A, 0 steps: nothing
```

- **Each run is one line:** `<seat>, <n> steps: <events>`.
  - `n` counts its `step` moves.
  - `turnPassed` is not printed, because every completed run ends in one.
  - A run with no other events reads `nothing`.
  - At most 12 events are printed per run, then `… +<k> more`. These are presentation caps, not balance.
- **Event wording:**

  | Log event | Text |
  |---|---|
  | `combat` | `combat at <arrow>: <attacker> sent <n> vs <defender> <m>, <attacker> lost <a>, <defender> lost <d>, <holder> holds` (or `nobody holds`) |
  | `trailCut` | `<attacker> cut <victim>'s trail[ at <arrow>] (<n> arrows)` |
  | `enclosureClosed` | `<player> closed a loop[ at <arrow>] (<n> claimed)` |
  | `territoryCaptured` | `<player> took <n> territory from <seats>` |
  | `territoryLost` | `<player> lost <n> territory[ to <seat>]` |
  | `unitsConverted` | `<heads> heads at <arrow> converted <from>→<to>` |
  | `unitsProduced` | `<player> +<amount> heads at <arrow> (spawner)` |
  | `seatVanished` | `<player> is out` |
  | `sharesChanged` | `<player> shares <from>→<to>` |
  | `matchWon` | `<player> won` |

- **Empty window:** `Since your last turn: nothing recorded yet.`
- **No history:** when the caller passes none (`about.recent` undefined), the block is left out.

Where the lines come from:

- **Door.** The game's `log.jsonl` move lines that carry `seat` and `events` (P107 lines), in order. Lines written before P107 have neither and are skipped. The log is read after the call's own write, so a `move` result's offer includes the moves it just applied.
- **BYOK.**
  - `recentFromMoves(geometry, opening, moves, me)` replays the local match log from `makeMatch(config)`. The first pass finds each move's seat; the second computes `logEventsOf` only for the window's moves.
  - Inside one turn, the seat appends a line for each move it applies, so a later completion's offer sees them, as the door's does.

Both paths call the same `logEventsOf` (P107) and the same renderer.

### D4 — honest step counts on every row

`left=-1` came from the row's display, not from illegal rows. The engine
checks the *whole group's* allowance (`spent < speedOverride ?? speed(heads)`)
before any portion steps. The row printed `spd=speed(count)` and
`left=spd-spent`, so a 1-head portion of a 4-head stack that had walked 2
printed `spd=1 left=-1` for a legal step. Each row's tempo slot is now:

- `spd=` the allowance of the group on `from`;
- `spent=` that group's `spent`;
- `left=` `spd − spent`. It is at least 1 on every offered row, because the engine offers only groups with `spent < allowance`;
- `then=` the steps the stack on `exit` has left after this step: its allowance minus its `spent` in `rules.apply(state, move)`, and `0` when no stack of the mover's stands there afterwards. A portion that splits off at speed 1 after two steps reads `then=0`: this step is its last.

### D5 — the `move` tool schema

`moves: {type: 'array', items: {type: 'integer', minimum: 0}}`,
`why: {type: 'string'}`, `plan: {type: 'string'}`. `endTurn` and `board` are
unchanged. The door's checks are unchanged too: an index the offer does not
have is refused, and `why` / `plan` are clipped and redacted.

### D6 — the batch rule, stated

The protocol is unchanged: indices only, no `{from, exit, count}` steps. The
offer and the `move` description now say it:

> Batch rule: every index refers to this offer, so move each stack at most once per reply. A stack's rows here describe it before it moves; walk it further from the next offer. A step that is no longer legal when it is reached spoils the reply.

"Spoils" is deliberately one word for both paths: the door refuses the whole reply and writes nothing (all or nothing, [remote-agent-mcp: Door](../remote-agent-mcp/remote-agent-mcp.md#door)); a BYOK seat keeps the legal prefix and falls back to the heuristic for the rest. The text is the same for both.

### D7 — one builder, one text

- `offerText(state, seat, about?)` (door) and `buildUserPrompt(…, about?)` (BYOK) render the same blocks from the same `about`.
- For the same state, seat and `about`, with no BYOK plan echo and no locks, the door's offer block equals the BYOK user prompt.
- The door always passes `about`. The BYOK seat passes it on every completion.

## EARS

- **E1** When an offer is rendered with a seat table, it shall list every seat in turn order with its kind, its name, and the relation to the offered seat.
- **E2** When an offer is rendered, it shall state `dominationN` and every seat's starvation streak as read from the state.
- **E3** When an offer is rendered with history, it shall list, per run, the log events of every line from the start of the offered seat's last completed run.
- **E4** Every offered row shall print `left ≥ 1` and `then ≥ 0`, with `spd` the allowance of the group on `from`.
- **E5** The `move` tool shall declare integer `moves` items and `why` / `plan` strings.
- **E6** For the same state, seat and `about`, the door's offer block and the BYOK prompt (no plan, no locks) shall be equal.

## Out of scope (next slice, P109)

Closing-path hints per exposed tip, stuck-tip reason lines, and trimming or
dropping `STATE_JSON`. Off-turn `observe` stays out (Gilad).
