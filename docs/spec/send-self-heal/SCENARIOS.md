# send-self-heal — sequence diagrams

Participants are the seams a test probes: **App** (the shell), **Host**
(`OnlineHostPort`), **Pages** (`createOnlinePages`), **Clock** (the injected
`now`), **API** (the injected `fetch`). [Overview](./send-self-heal.md).

Each diagram, including every `alt`, is a `@hochgi/test-kit` component test in
`packages/web/test/send-self-heal.scenarios.test.ts`. The component is the
host. The probed leaf is the HTTP door (`PagesApi.send`). The clock is a
counted fake (synchronous, so the kit cannot probe it).

A hold is made the P95 way in every diagram: `POST …/moves` answers 401 and
the token is then replaced in the session store without a GIS credential (the
stuck case — no `deliverGoogleCredential`, so no `sendHeld`).

## 1. A Send heals a hold

```mermaid
sequenceDiagram
  participant App
  participant Host
  participant Pages
  participant API
  App->>Host: submitMoves(moves)
  Host->>Pages: submitMoves(moves)
  Note over Pages: guards say held, token usable
  Pages->>API: GET /me
  alt /me 200, board still at the held version
    API-->>Pages: 200 userHash of the hold
    Pages->>API: GET /games/g/n
    API-->>Pages: 200 version = held version
    Pages->>API: POST /games/g/n/moves, held ids, If-Match held version
    API-->>Pages: 200 version + 1
    Pages->>API: GET /games/g/n (reconcile)
    Pages-->>App: held-sent, hold cleared, nothing of moves posted
  else /me 200, board moved on
    API-->>Pages: 200 userHash of the hold
    Pages->>API: GET /games/g/n
    API-->>Pages: 200 version > held version
    Pages-->>App: held-dropped, hold cleared, no POST
  else /me 200 for another user
    API-->>Pages: 200 other userHash
    Pages->>API: GET /games/g/n
    Pages-->>App: held-dropped, no POST
  else /me 401
    API-->>Pages: 401
    Note over Pages: P98 door, token removed, sessionExpired
    Pages-->>App: held, hold kept, no POST
  else held POST 401 again
    API-->>Pages: 200 /me, 200 game at held version
    Pages->>API: POST moves
    API-->>Pages: 401
    Pages-->>App: unauthorized, hold kept
  else held game 404
    API-->>Pages: 200 userHash of the hold
    Pages->>API: GET /games/g/n
    API-->>Pages: 404
    Note over Pages: P96 clear — hold dropped, hash '', gameDeleted
    Pages-->>App: no-game, no POST, hold not restored
  else off the held game, no board loaded
    Note over Pages: hash is not the held game, board absent (invite accept 409)
    Pages-->>App: hold dropped, then no-game, no POST of the hold
  end
```

## 2. A poll heals a hold, and App hears it once

```mermaid
sequenceDiagram
  participant App
  participant Host
  participant Pages
  participant API
  App->>Host: handlePoll()
  Host->>Pages: poll()
  Pages->>API: GET /me
  API-->>Pages: 200
  Pages->>API: GET /games/g/n
  alt board at held version
    API-->>Pages: 200 held version
    Pages->>API: POST moves (held ids)
    API-->>Pages: 200
    Pages->>API: GET /games/g/n (reconcile)
    Note over Pages: heal outcome held-sent stored
  else board moved on
    API-->>Pages: 200 newer version
    Note over Pages: heal outcome held-dropped stored
  else held game 404
    API-->>Pages: 404
    Note over Pages: P96 clear, no heal outcome stored
  end
  App->>Pages: takeHealOutcome()
  Pages-->>App: the stored outcome
  App->>Pages: takeHealOutcome()
  Pages-->>App: undefined
```

## 3. The replay watchdog

A flush installs the latest snapshot (the issue's "flushed to the latest
server snapshot"), it does not replay again: App may already have applied part
of the stuck batch, and a second replay of it would diverge.

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant Clock
  participant API
  Note over Pages: a batch was queued and taken, never displayed
  App->>Pages: submitMoves(moves)
  Pages->>Clock: now()
  alt within replayStallMs of the last progress
    Pages-->>App: replaying, no request
  else stalled, still on the game
    Note over Pages: queue, in-flight batch and displayed version cleared
    Pages->>API: GET /games/g/n
    API-->>Pages: 200 latest board
    Pages-->>App: stale, no POST (App refreshes and installs the snapshot)
    Note over Pages: the next Send posts without App reporting that batch displayed
  else stalled, hash is not a game
    Note over Pages: queue, in-flight batch and displayed version cleared
    Note over Pages: no GET — there is no game route
    Pages-->>App: stale, no request
  end
  Note over Pages: a poll does the same flush, including a batch still queued, then its usual version check
```

## 4. One re-check before not-your-turn

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant API
  App->>Pages: submitMoves(moves)
  Note over Pages: guards say not-your-turn
  Pages->>API: GET /me
  Pages->>API: GET /games/g/n
  alt now the caller's turn, same version
    API-->>Pages: 200 seats and board, caller active
    Pages->>API: POST moves
    Pages-->>App: sent
  else now the caller's turn, newer version
    API-->>Pages: 200 caller active, version + 1
    Pages-->>App: stale, no POST
  else still another seat's turn
    API-->>Pages: 200 another seat active
    Pages-->>App: not-your-turn, no POST
  else game 404
    API-->>Pages: 404
    Note over Pages: P96 clear — hold dropped, hash '', gameDeleted
    Pages-->>App: no-game, no POST
  end
```
