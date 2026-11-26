# seat-choice — sequence diagrams

Participants are the seams the tests probe:

- **Lobby**: `pickOnlineSeat`, `lobbyKindOptions`, `planProblem`, `createPlanNote`
  (pure web helpers the `<select>` and the Create button call).
- **Pages**: `createOnlinePages` / `createOnlineHost` with the probed `fetch`.
- **API**: `createOnlineApi` (handlers).
- **Door**: the MCP door (`tools/call`).
- **Google**: the verifier.
- **Store**: the object store.

[Overview](./seat-choice.md). Every `alt` branch below has a test; the test
file names the diagram number.

## 1. Lobby: pick a seat

```mermaid
sequenceDiagram
  participant User
  participant Lobby
  User->>Lobby: pick choice c on seat i (online)
  alt c = creator
    Lobby->>Lobby: seat that held creator → human; seat i → creator
  else any other choice
    Lobby->>Lobby: seat i → c (no pick is refused)
  end
  Lobby->>Lobby: planProblem(plan)
  alt pick-your-seat (no creator)
    Lobby-->>User: Create disabled + "Pick your seat: choose Player (you) on one seat."
  else needs-another (< 2 chairs that are not AI)
    Lobby-->>User: Create disabled + "Create needs you and at least one more Player or Agent."
  else valid
    Lobby-->>User: Create enabled, no note
  end
```

Mode switches: Local → Online never adds `creator`; Online → Local maps
`creator` → `human` and `agent` / `creator-agent` → `heuristic`.

## 2. Create

```mermaid
sequenceDiagram
  participant Pages
  participant API
  participant Google
  participant Store
  Pages->>API: POST /invites {seats: [creator|human|creator-agent|agent|heuristic …], name?}
  API->>Google: verify
  alt bearer rejected
    API-->>Pages: 401 (nothing written)
  else seats not a list of known tokens / size / byok / no creator / two creators / < 2 non-AI
    API-->>Pages: 422 (nothing written)
  else valid
    API->>Store: put invite: creator → {human, userHash}, creator-agent → {agent, reservedFor}, human/agent open
    API-->>Pages: 201 {token, seats (named)}
  end
```

## 3. MCP join (after the P92 handle / status checks)

```mermaid
sequenceDiagram
  participant Door
  participant Store
  Door->>Store: get invite
  alt no invite
    Door-->>Door: error bad-handle
  else revoked / started / deleted
    Door-->>Door: error revoked / started / deleted
  else chairs reserved for caller, unbound
    Door->>Store: put invite (If-Match): bind all of them, drop reservedFor
    alt 412 (raced)
      Door->>Store: re-read, start again
    end
    Door->>Store: put lobby pointer
    Door-->>Door: joined {seatIndex: caller's first agent seat}
  else caller holds an agent chair
    Door->>Store: put lobby pointer
    Door-->>Door: joined {seatIndex: held}
  else no agent chair
    Door-->>Door: error no-agent-seat
  else no open unbound agent chair (only reserved for others, or all bound)
    Door-->>Door: error full
  else open chair
    Door->>Store: put invite (If-Match): bind it (412 → retry)
    Door-->>Door: joined {seatIndex}
  end
```

## 4. Accept never takes a reserved chair

```mermaid
sequenceDiagram
  participant Pages
  participant API
  participant Store
  Pages->>API: POST /invites/t/accept
  alt an unbound human chair
    API->>Store: bind the first unbound human chair
    API-->>Pages: 200
  else no unbound human chair (reserved agent chairs only)
    API-->>Pages: 409
  end
```

## 5. Start

```mermaid
sequenceDiagram
  participant Pages
  participant API
  alt any human or agent chair unbound (reserved included)
    Pages-->>Pages: Start not offered (startOffered false)
    Note over Pages,API: a forced POST /start is 409 (P92, unchanged)
  else every chair bound
    Pages->>API: POST /invites/t/start → 200, game with players in seat order
  end
```

## 6. MCP observe / move with several agent chairs

```mermaid
sequenceDiagram
  participant Door
  participant Store
  Door->>Store: get invite, meta, state
  alt caller holds no agent chair
    Door-->>Door: stop not-seated
  else game over
    Door-->>Door: stop game-over
  else active seat is one of the caller's agent chairs
    Door-->>Door: offer for that seat (byok-offer text, same as BYOK)
  else
    Door-->>Door: stop not-your-turn
  end
```

## 7. Labels for a reserved chair

```mermaid
sequenceDiagram
  participant Caller
  participant Label as labelInviteChair
  Caller->>Label: unbound agent chair {reservedFor}
  alt reservedFor = caller
    Label-->>Caller: "your agent (waiting)"
  else anyone else, or signed out
    Label-->>Caller: "waiting"
  end
```

## 8. Creator in any seat (end to end)

```mermaid
sequenceDiagram
  participant Creator
  participant API
  participant Door
  Creator->>API: create [agent, human, creator] (seat C is the creator)
  Door->>API: join (Bob's agent) → seat A
  Creator-->>API: Bob accepts → seat B
  Creator->>API: start → players in seat order; seat A (the agent) moves first
  Door->>API: observe → offer for seat A
  Creator->>API: my-games → status waiting, labels A=Bob's agent, B=Bob, C=you
```
