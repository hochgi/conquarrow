# online-turn-flow — sequence diagrams

Participants are the seams the tests probe: **App** (the caller of the port),
**Pages** (`createOnlinePages` behind `OnlinePagesPort`), and **API** (the
injected `fetch`, faked in tests). Gherkin in the feature files is the
assertable contract; these say the message order.
[Overview](./online-turn-flow.md).

## 1. A submit that lands replays from the displayed baseline

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant API
  App->>Pages: submitMoves([m1 … mk])
  Note over Pages: pending true
  loop each move, while answered 200 with a version
    Pages->>API: POST /games/g/n/moves If-Match v(i-1)
    API-->>Pages: 200 {version vi}
  end
  Pages->>API: GET /games/g/n
  API-->>Pages: snapshot {version to}
  alt displayed baseline b < to
    Pages->>API: GET /games/g/n/log?since=b
    API-->>Pages: {from b, to, gap false, moves}
    Note over Pages: queue replay batch (b, to]
  else no baseline, gap, mismatch, or log read fails
    Note over Pages: keep the snapshot for install
  end
  Note over Pages: pending false
  Pages-->>App: sent
```

## 2. A refused or stale move stops the rest, then reconciles

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant API
  App->>Pages: submitMoves([m1, m2])
  Pages->>API: POST moves m1 If-Match b
  alt 422
    API-->>Pages: 422
    Note over Pages: outcome illegal
  else 409 or 412
    API-->>Pages: 409 or 412
    Note over Pages: outcome stale
  else other status
    API-->>Pages: 5xx
    Note over Pages: outcome failed
  end
  Pages->>API: GET /games/g/n
  API-->>Pages: snapshot
  Pages->>API: GET /games/g/n/log?since=b
  API-->>Pages: window
  Note over Pages: queue or install, pending false
  Pages-->>App: outcome
```

## 3. A network failure settles as failed

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant API
  App->>Pages: submitMoves([m1])
  Pages->>API: POST moves m1
  API--xPages: rejected
  Pages->>API: GET /games/g/n
  alt snapshot read
    API-->>Pages: snapshot
    Note over Pages: reconcile as in 1
  else rejected
    API--xPages: rejected
    Note over Pages: board unchanged
  end
  Note over Pages: pending false
  Pages-->>App: failed
```

## 4. Unauthorised, and a submit while one is in flight

```mermaid
sequenceDiagram
  participant App
  participant Pages
  participant API
  App->>Pages: submitMoves([m1])
  Pages->>API: POST moves m1
  App->>Pages: submitMoves([m2])
  Pages-->>App: sending (a P100 refusal, no request)
  alt 401
    API-->>Pages: 401
    Note over Pages: GIS prompt, no reconcile
    Pages-->>App: unauthorized
  else 200
    API-->>Pages: 200 {version}
    Note over Pages: reconcile as in 1
    Pages-->>App: sent
  end
```
