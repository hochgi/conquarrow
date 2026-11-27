# agent-context-v2 — sequence diagrams

Participants are the seams the tests probe:

- **Agent**: an MCP client calling `tools/call` (`observe`, `move`, `tools/list`).
- **Door**: `mcp-door.ts` (`offerResult`, `offerAbout`).
- **Store**: the object store (`invite`, `state.json`, `log.jsonl`).
- **Seat**: the web's BYOK seat (`playLlmBotTurn`), with its local match log.
- **Builder**: `@conquarrow/byok-offer` (`offerText` / `buildUserPrompt`, `recentWindow`, `recentFromMoves`).

[Overview](./agent-context-v2.md). Every `alt` and `opt` below has a test
whose name starts with the diagram number. The door paths are in
`packages/online-api/test/agent-context-v2.scenarios.test.ts`, the builder in
`packages/byok-offer/test/agent-context-v2.*.test.ts`, and the BYOK seat in
`packages/web/test/agent-context-v2.byok.test.ts`.

## 1. The door's offer says who is who and what happened

```mermaid
sequenceDiagram
  participant Agent
  participant Door
  participant Store
  participant Builder
  Agent->>Door: observe {handle, board?}
  Door->>Store: invite, heal, state N
  alt stop (not seated / not your turn / game over — P92/P95 tests)
    Door-->>Agent: {stop: true, reason}
  else offer
    Door->>Store: get log.jsonl
    Door->>Door: about = seat rows (relation you / also you / your owner) + recent lines (P107 lines with seat and events; older lines skipped)
    Door->>Builder: offerText(state, seat, about)
    Builder-->>Door: offer text
    Door-->>Agent: JSON block, offer block (+ map)
  end
```

## 2. A move's next offer includes the moves it applied

```mermaid
sequenceDiagram
  participant Agent
  participant Door
  participant Store
  participant Builder
  Agent->>Door: move {handle, moves, endTurn, why?, plan?}
  alt unusable / unknown index / raced (P92/P107 tests)
    Door-->>Agent: error, nothing written
  else applied
    Door->>Store: put state N+1, append lines
    alt the turn goes on
      Door->>Store: get log.jsonl (now with this call's lines)
      Door->>Builder: offerText(after, seat, about)
      Door-->>Agent: {applied, version, stop: false} + offer
    else the turn ended or the game is won
      Door-->>Agent: {applied, version, stop: true}
    end
  end
```

## 3. The `move` tool says what it takes

```mermaid
sequenceDiagram
  participant Agent
  participant Door
  Agent->>Door: tools/list
  Door-->>Agent: move.inputSchema: moves.items integer (minimum 0), why string, plan string; description states the batch rule
```

## 4. A BYOK seat gives its model the same offer

```mermaid
sequenceDiagram
  participant Seat
  participant Builder
  Seat->>Builder: recentFromMoves(geometry, opening, log moves, me)
  Builder-->>Seat: the window's recent lines
  loop each completion of the turn
    Seat->>Builder: buildUserPrompt(state, me, offer, …, about{seats, recent + this turn's lines})
    Seat->>Seat: apply the reply's legal prefix
    opt a step applied
      Seat->>Seat: append {seat, move, logEventsOf(before, after, move)} to recent
    end
  end
```

## 5. The builder renders the about blocks

```mermaid
sequenceDiagram
  participant Caller
  participant Builder
  Caller->>Builder: offer(state, seat, about?)
  opt about.seats
    Builder->>Builder: "Seats in turn order:" one row each (kind, name cut to one line, relation)
  end
  Builder->>Builder: "Starvation: … dominationN=<state> … Streaks: …" (always)
  alt about.recent undefined
    Builder->>Builder: no history block
  else recent given
    Builder->>Builder: recentWindow: from the start of this seat's last completed run
    alt window empty
      Builder->>Builder: "Since your last turn: nothing recorded yet."
    else
      loop each run
        alt the run has no printable event
          Builder->>Builder: "<seat>, <n> steps: nothing"
        else
          Builder->>Builder: events in order, at most 12, then "… +k more"
        end
      end
    end
  end
  Builder->>Builder: rows: spd = allowance of the group on from, left = spd − spent, then = what the stack on exit has left after apply (0 when none of the mover's stands there)
  Builder->>Builder: batch rule line, then the reply instruction
```
