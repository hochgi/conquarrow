# online-reliability — sequence diagrams

Participants are the seams the tests probe: **App** (the port's caller),
**Pages** (`createOnlinePages`), **API** (`createOnlineApi`, or the injected
`fetch` in web tests), **Store** (the object store) and **WS** (post to
connection). [Overview](./online-reliability.md).

## 1. A gateway timeout, then the retry is a duplicate

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant API
  participant Store
  App->>Pages: submitMoves([endTurn])
  Pages->>API: POST /moves If-Match 4 {move, submitId s}
  API->>Store: put state v5 (lastSubmit s), log, summary
  API--xPages: 503 (gateway cap)
  Pages->>API: POST /moves If-Match 4 {move, submitId s}
  API->>Store: get state (lastSubmit s, version 5)
  API-->>Pages: 200 {version 5, duplicate true}
  Pages->>API: GET /games/g/n, GET /log?since=4
  Pages-->>App: sent
```

## 2. A 401 holds the submit until the next credential

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant API
  App->>Pages: submitMoves([endTurn])
  Pages->>API: POST /moves {submitId s}
  API-->>Pages: 401
  Note over Pages: held = {moves, ids, version}#59; pending true#59; gis.prompt()
  Pages-->>App: unauthorized (note: sign in and it will be sent)
  App->>Pages: deliverGoogleCredential(token)
  Pages->>API: POST /moves {submitId s}
  API-->>Pages: 200 {version 5}
  Pages->>API: GET /games/g/n (reconcile)
  Note over Pages: held cleared#59; pending false
```

## 3. The advance passes a lost seat and heals on read

```mermaid
sequenceDiagram
  participant Client
  participant API
  participant Store
  participant WS
  Client->>API: GET /games/g/n
  API->>Store: get state v7 (active seat pass-only)
  Note over API: advance: endTurn for the pass-only seat, heuristic turns, until a choosing seat or a winner or the budget
  API->>Store: put state v8, log lines v8
  API->>WS: stateChanged v8 to every connection of every bound human
  API-->>Client: 200 {version 8, state, seats}
```

## 4. The poll is the fallback for a dead socket

```mermaid
sequenceDiagram
  participant Runtime
  participant Pages
  participant API
  Runtime->>Pages: handlePoll() every 15 s while visible
  alt no open socket
    Note over Pages: openSocket(url, {onClose})
  end
  Pages->>API: GET /games/g/n/version
  API-->>Pages: {version 6}
  alt 6 > replay baseline 4
    Pages->>API: GET /games/g/n, GET /log?since=4
    Note over Pages: queue batch (4, 6]
  end
  Runtime->>Pages: handleHeartbeat() every 5 min
  Note over Pages: socket.send({"action":"ping"}) → $default → 200
```

## 5. Game over

```mermaid
sequenceDiagram
  participant Agent
  participant Door as MCP door
  participant Store
  Agent->>Door: tools/call observe
  Door->>Store: get state (winner set), log
  Door-->>Agent: {stop true, reason game-over, summary {winner, turns, standings}}
```

## 6. A credential on the lobby lists My games

The lobby route. An invite route and a game route are the other outcomes of the
same credential delivery (D13). The chooser slot is the shell's element. GIS
does not create or remove it.

```mermaid
sequenceDiagram
  participant GIS
  participant Pages
  participant API
  participant App
  GIS->>Pages: credential callback
  Note over GIS: does not remove the chooser slot
  Pages->>Pages: store the token, signedIn() true
  alt lobby route
    Pages->>API: GET /my-games
    API-->>Pages: 200 {lobbies, games, counts}
    Note over Pages: library is that body, one GET
  else invite route
    Pages->>API: POST /invites/token/accept
    API-->>Pages: 200
    Note over Pages: no GET /my-games
  else game route
    Pages->>API: GET /games/g/n
    API-->>Pages: 200
    Note over Pages: no GET /my-games
  end
  Pages-->>App: settled
  Note over App: Sign out shown, chooser slot unmounted, My games offered on the lobby
```
