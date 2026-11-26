# match-log-v2 — sequence diagrams

Participants are the seams the tests probe:

- **Browser**: a signed-in member's HTTP request (`createOnlineApi`).
- **API**: the handlers (`handlePostMove`, the P95 heal `ensurePosition`, `handleGetExport`).
- **Door**: the MCP door (`tools/call` `move` / `export`).
- **Advance**: `advance` (`game-advance.ts`), the server's own moves.
- **Resolver**: `logEventsOf` (`@conquarrow/rules-core` `events.ts`).
- **Store**: the object store (`state.json`, `log.jsonl`).

[Overview](./match-log-v2.md). Every `alt` and `opt` below has a test; the test
name starts with the diagram number. Server paths:
`packages/online-api/test/match-log-v2.scenarios.test.ts`. Resolver and
projection: `packages/rules-core/test/match-log-v2.events.test.ts`.

## 1. A browser move is logged

```mermaid
sequenceDiagram
  participant Browser
  participant API
  participant Advance
  participant Resolver
  participant Store
  Browser->>API: POST /games/{g}/{n}/moves {move} If-Match "N"
  alt refused (stale, not your seat, illegal, finished — P49/P95 tests)
    API-->>Browser: 4xx, log.jsonl unchanged
  else applied
    API->>Resolver: logEventsOf(before, after, move)
    API->>Advance: advance(after)
    opt the next seats are the server's (heuristic / pass-only / turn cap)
      Advance->>Resolver: logEventsOf per server move
    end
    API->>Store: put state N+1, append lines v=N+1
    Note over Store: client move: {v, at, seat, move, events} (no by)<br/>server moves: {v, at, seat, by:"server", move, events}
    API-->>Browser: 200 {version: N+1}
  end
```

## 2. The heal logs server moves

```mermaid
sequenceDiagram
  participant Browser
  participant API
  participant Advance
  participant Store
  Browser->>API: GET game / version / export
  API->>Store: get state
  alt no state yet (opening)
    API->>Advance: advance(opening)
    API->>Store: put state 0, append the opening's server lines (v=0, by:"server")
  else state exists
    API->>Advance: advance(position)
    alt nothing to play
      API-->>Browser: the position, log.jsonl unchanged
    else server moves
      API->>Store: put state N+1, append their lines (by:"server")
    end
  end
```

## 3. An agent move is logged with what it resolved to

```mermaid
sequenceDiagram
  participant Door
  participant Advance
  participant Resolver
  participant Store
  Door->>Store: get invite, state N
  alt reply unusable / index unknown or illegal / empty indices with steps left (P92 tests)
    Door-->>Door: error or offer, log.jsonl unchanged
  else applied
    Door->>Resolver: logEventsOf per applied step (seat = agent, no by)
    opt the turn finishes and the agent's seat is still active
      Door->>Resolver: logEventsOf(endTurn) (no by)
    end
    opt finished and no winner
      Door->>Advance: advance (lines by:"server")
    end
    Door->>Store: put state N+1 (If-Match)
    alt 412 (raced)
      Door-->>Door: "the position changed", log.jsonl unchanged
    else written
      Door->>Store: append move lines, then {v:N+1, at, seat, agentReply:{moves, resolved, offerVersion:N, endTurn, why?, plan?}}
    end
  end
```

## 4. The export serves v2

```mermaid
sequenceDiagram
  participant Browser
  participant API
  participant Store
  Browser->>API: GET /games/{g}/{n}/export (or Door export)
  API->>Store: heal (2), get log.jsonl
  loop each line
    alt reply line
      alt game won, or the line's seat (top-level, else nested pre-P107) is the caller's
        API->>API: entry {v, at?, seat?, agentReply{moves, resolved?, offerVersion?, endTurn, why?, plan?}}
      else
        API->>API: withheldReplies += 1
      end
    else move line
      API->>API: entry {v?, at?, seat?, by?, move, events?} (v1 lines: only what they have)
    else unreadable
      API->>API: skipped
    end
  end
  API-->>Browser: 200 {formatVersion: 2, seats[].kind ∈ human|agent|heuristic, …, log, moves}
```

## 5. One move's log events

```mermaid
sequenceDiagram
  participant Caller
  participant Resolver
  Caller->>Resolver: logEventsOf(geometry, {before, after, move})
  Resolver->>Resolver: resolveEvents(step) (the web's resolver)
  loop each GameEvent
    alt moved / trailLaid / stackSplit / sentryLeft / stackMerged
      Resolver->>Resolver: dropped
    else combat / trailCut / enclosureClosed / territoryCaptured / territoryLost / unitsConverted / unitsProduced / seatVanished / turnPassed / matchWon
      Resolver->>Resolver: toLogEvent: lists → counts, absent optionals left out
    end
  end
  Resolver->>Resolver: resolveShareEvents: sharesChanged per player whose share count changed (player order)
  Resolver-->>Caller: LogEvent[]
```
