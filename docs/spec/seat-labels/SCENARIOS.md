# seat-labels — sequence diagrams

Participants are the seams the tests probe:

- **Lobby/App**: the web callers of the port.
- **Pages**: `createOnlinePages`.
- **API**: `createOnlineApi`, or the probed `fetch` in web tests.
- **Google**: the verifier.
- **Store**: the object store.

[Overview](./seat-labels.md).

## 1. Create: the creator's own name comes back

```mermaid
sequenceDiagram
  participant Pages
  participant API
  participant Google
  participant Store
  Pages->>API: POST /invites {seats} (Bearer)
  API->>Google: verify
  alt bearer rejected
    API-->>Pages: 401 (no invite written)
  else plan invalid
    API-->>Pages: 422
  else ok
    API->>Store: put profile, invite, lobby pointer
    API->>Store: get profile of each bound chair (once per user)
    API-->>Pages: 201 {token, seats: [{human, userHash, name?}, …]}
  end
```

## 2. Peek: names only for a member

```mermaid
sequenceDiagram
  participant Pages
  participant API
  participant Google
  participant Store
  alt signed in (usable token)
    Pages->>API: GET /invites/t (Bearer)
  else signed out
    Pages->>API: GET /invites/t (no Authorization)
  end
  API->>Store: get invite
  alt no invite
    API-->>Pages: 404
  else closed (revoked / started / deleted)
    API-->>Pages: 410 {reason, …}
  else open
    alt no bearer
      API-->>Pages: 200 {token, seats} — no names
    else bearer
      API->>Google: verify
      alt rejected or verifier throws
        API-->>Pages: 200 — no names (never 401)
      else verified, not a member
        API-->>Pages: 200 — no names
      else verified member (bound to a chair)
        API->>Store: get profiles of bound chairs
        API-->>Pages: 200 {seats with name}
      end
    end
  end
  Note over Pages: 200 → inviteSeats() → the frozen roster labels with rosterLabel
```

## 3. Accept: the joiner sees names

```mermaid
sequenceDiagram
  participant Pages
  participant API
  participant Google
  participant Store
  Pages->>API: POST /invites/t/accept (Bearer)
  API->>Google: verify
  alt rejected
    API-->>Pages: 401 (the P98 door)
  else
    API->>Store: get invite
    alt no invite
      API-->>Pages: 404
    else closed
      API-->>Pages: 410
    else already bound
      API->>Store: get profiles
      API-->>Pages: 200 {seats with name}
    else no free human chair
      API-->>Pages: 409 (lobbyIsFull)
    else
      API->>Store: put invite (If-Match), lobby pointer
      API->>Store: get profiles
      API-->>Pages: 200 {seats with name}
    end
  end
```

## 4. Game: names on every bound chair

```mermaid
sequenceDiagram
  participant Pages
  participant API
  participant Store
  Pages->>API: GET /games/g/n (Bearer)
  alt not a member / unknown game
    API-->>Pages: 403 / 404 (unchanged)
  else
    API->>Store: get meta, state, profiles of bound chairs
    alt profile missing or unreadable JSON
      Note over API: that chair has no name
    end
    API-->>Pages: 200 {…, seats: [{human, userHash, name?}, {agent, userHash?, name?}, {heuristic}]}
  end
  Note over Pages: board().seats → seatLineLabels → "A=you · B=Ada's agent · C=AI"
```

## 5. My games: labels from the same table

```mermaid
sequenceDiagram
  participant Pages
  participant API
  participant Store
  Pages->>API: GET /my-games (Bearer)
  alt rejected
    API-->>Pages: 401
  else
    API->>Store: list pointers, metas, profiles (once per user)
    API-->>Pages: 200 rows; seat.label = seatLabel(…): you · your agent · name · Player B · Agent · waiting · AI
  end
```

Store failures (a `get` that throws) answer 500 on every route above, as
they did before P105; P105 adds no catch around the profile reads.
