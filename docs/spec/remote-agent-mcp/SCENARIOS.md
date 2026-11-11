# remote-agent-mcp — message flows

**Spec:** [overview](./remote-agent-mcp.md) · [core](./remote-agent-mcp.core.feature) · [edge cases](./remote-agent-mcp.edge-cases.feature)

One sequence diagram per protocol flow. An `alt` is another outcome of that
same exchange, not a second flow. Gherkin states what is assertable. These
diagrams state the message order. A path with no diagram will not be built.

Participants are doors and leaf seams, not internal functions. The component
under test is the handler. Tests probe the leaves, not the SDK and not a
service that already owns the rule.

| Leaf the test may probe | Why this seam |
|---|---|
| `ObjectStore` | handlers already take it. Probing `S3Client` is too thin |
| `PostToConnection`, wrapped as a Promise method | the ping is the behaviour. The API Gateway client is too thin |
| `GoogleVerifier`, `GoogleCodeExchange` | injected. Tests do not call Google |
| client-id metadata `fetch` | injected. A non-https `client_id` must not reach it |
| clock, signer, `log` | injected. Not I/O probes |

Do not probe a fatter type that owns join, the burst, or the offer check.
Those stay inside the handler. Phase 2 writes the leaf interfaces and no
implementation. Phase 3 implements behind them.

## 1. Unauthenticated discovery

```mermaid
sequenceDiagram
  participant IDE
  participant Mcp as MCP door
  participant S3
  IDE->>Mcp: POST /conquarrow with no bearer
  Mcp-->>IDE: 401 WWW-Authenticate resource_metadata
  Note over Mcp,S3: S3 unchanged
  IDE->>Mcp: GET /.well-known/oauth-protected-resource/conquarrow
  Mcp-->>IDE: resource and authorization_servers
  IDE->>Mcp: GET /.well-known/oauth-authorization-server
  Mcp-->>IDE: authorize and token endpoints, CIMD, no registration_endpoint
```

A bearer that is missing, badly signed, the wrong audience, expired, or a
Google ID token takes the same 401. The body does not echo the bearer.

## 2. Authorization code

```mermaid
sequenceDiagram
  participant IDE
  participant Mcp as MCP door
  participant Google
  participant S3
  IDE->>Mcp: GET /authorize with client_id, redirect, PKCE, resource
  alt client_id is not an https URL
    Mcp-->>IDE: refusal
    Note over Mcp: metadata fetch is not called
  else redirect_uri is not in the fetched document
    Mcp-->>IDE: refusal
    Note over Mcp,S3: no authorization code stored
  else document matches
    Mcp-->>IDE: 200 page naming the redirect host
    Note over Mcp,Google: not a redirect to Google yet
    IDE->>Mcp: continue
    Mcp->>Google: redirect
    Google->>Mcp: callback with Google code
    Mcp->>Mcp: exchange code, verify ID token
    Mcp->>S3: upsert profile, store one-time code
    Mcp-->>IDE: redirect with code, iss, and the client's state
    IDE->>Mcp: POST /token with code, verifier, resource
    Mcp->>S3: delete code, write one refresh-hash object
    Mcp-->>IDE: access token 15 minutes and refresh token
  end
```

`resource` must be exactly `https://mcp.games.hochgi.com/conquarrow`. PKCE is
S256. Our code lives 60 seconds by the injected clock and dies on use.

## 3. Refresh rotation

```mermaid
sequenceDiagram
  participant IDE
  participant Mcp as MCP door
  participant S3
  IDE->>Mcp: POST /token with refresh token
  alt hash matches and clock is before exp
    Mcp->>S3: overwrite the one refresh-hash object
    Mcp-->>IDE: new access token and new refresh token
    IDE->>Mcp: POST /token with the previous refresh token
    Mcp-->>IDE: 401
    Note over S3: still one object, not a list
  else hash mismatches or clock is at exp
    Mcp-->>IDE: 401
    Note over S3: current hash is kept
  end
```

There is no revocation list. A stolen access token is 401 once the clock
passes `exp`, and it is not stored.

## 4. Create

```mermaid
sequenceDiagram
  participant Browser
  participant Http as browser door
  participant S3
  Browser->>Http: POST /invites with a Google ID token
  alt one human and at least one agent, host is human
    Http->>S3: invite and the creator lobby pointer
    Http-->>Browser: 201
    Note over S3: agent seats unbound, no group, no game
  else no human, or one human and no agent, or byok, or bad length, or host is not human
    Http-->>Browser: 422
    Note over S3: nothing stored
  end
```

## 5. Browser accept

```mermaid
sequenceDiagram
  participant Browser
  participant Http as browser door
  participant S3
  Browser->>Http: POST /invites/:token/accept
  alt a human seat is already bound to this user
    Http-->>Browser: 200 that human seat
    Note over S3: no second human chair
  else this user holds only an agent seat, and a human seat is free
    Http->>S3: bind the next unbound human seat
    Http-->>Browser: 200
    Note over S3: the agent seat is unchanged
  else a human seat is free
    Http->>S3: bind the next unbound human seat
    Http-->>Browser: 200
    Note over S3: no agent seat is taken
  else every human seat is bound
    Http-->>Browser: 409
    Note over S3: a free agent seat stays free
  end
```

## 6. MCP join

```mermaid
sequenceDiagram
  participant IDE
  participant Mcp as MCP door
  participant S3
  IDE->>Mcp: tools/call join with handle
  alt invite open and an agent seat is free and this user holds none
    Mcp->>S3: bind the next unbound agent seat and the lobby pointer
    Mcp-->>IDE: seatIndex, kind agent, status joined
    Note over S3: a human seat this user holds is unchanged
  else invite open and this user already holds an agent seat
    Mcp-->>IDE: that same seatIndex
    Note over S3: no second agent seat is taken
  else no agent seat, roster full, revoked, started, or bad handle
    Mcp-->>IDE: tool error, no seat change
  end
```

Join does not Start. Two different Google users may each take an agent seat,
in seat-index order.

## 7. Start

```mermaid
sequenceDiagram
  participant Browser
  participant IDE
  participant Http as browser door
  participant S3
  alt every human and every agent seat is bound, caller is a bound human with a Google ID token
    Browser->>Http: POST start
    Http->>S3: group and game meta, pointers for every bound human and every bound agent
    Http-->>Browser: 200 groupHash from human hashes only
    Browser->>Http: GET the invite token
    Http-->>Browser: 410 started, with groupHash and gameNumber
  else a human or an agent seat is unbound
    Browser->>Http: POST start
    Http-->>Browser: 409
    Note over S3: invite stays open, no group, no game
  else the bearer is an MCP access token
    IDE->>Http: POST start
    Http-->>IDE: 401
    Note over S3: nothing allocated
  end
```

The browser door does not verify MCP access tokens. After Start, MCP `join`
is the started refusal in diagram 6, not a 410 on the MCP door.

## 8. Handshake, and no stream

```mermaid
sequenceDiagram
  participant IDE
  participant Mcp as MCP door
  IDE->>Mcp: POST initialize, optional Mcp-Session-Id header
  alt protocolVersion is 2025-03-26, 2025-06-18, 2025-11-25, or 2026-07-28
    Mcp-->>IDE: that same protocolVersion
  else any other version
    Mcp-->>IDE: 2026-07-28
  end
  Note over Mcp,IDE: no Mcp-Session-Id response header
  IDE->>Mcp: GET /conquarrow
  Mcp-->>IDE: 405, not an event stream
  IDE->>Mcp: POST /register
  Mcp-->>IDE: 404
```

A `tools/call` does not need a prior `initialize` in this process. Each POST
is one invocation.

## 9. observe

```mermaid
sequenceDiagram
  participant IDE
  participant Mcp as MCP door
  participant Offer as byok-offer
  participant S3
  IDE->>Mcp: tools/call observe with handle
  alt invite not started
    Mcp-->>IDE: stop true, reason not-started, no offer
    Note over S3: no state.json, no log.jsonl
  else caller holds no agent seat
    Mcp-->>IDE: stop true, reason not-seated, no offer
  else not this agent seat to move, or game over
    Mcp-->>IDE: stop true, reason not-your-turn or game-over, no offer
  else this agent seat to move
    Mcp->>S3: ensure the position, same as GET /games
    Mcp->>Offer: offerText of that state and seat
    Offer-->>Mcp: user prompt
    Mcp-->>IDE: stop false and that offer
  end
```

The offer is the package text: numbered rows and the reply instruction. Fresh
locks, no plan echo. The web prompt with those cleared is the same string.

## 10. move

```mermaid
sequenceDiagram
  participant IDE
  participant Mcp as MCP door
  participant S3
  participant Ws as PostToConnection
  IDE->>Mcp: tools/call move with moves, endTurn, optional why and plan
  alt an index is unknown or illegal now
    Mcp-->>IDE: readable error, stop false
    Note over S3: version unchanged, no agentReply line
  else not this seat to move
    Mcp-->>IDE: stop true, reason not-your-turn
    Note over S3: version unchanged
  else empty moves, endTurn false, and a legal step remains
    Mcp-->>IDE: stop false and the current offer
    Note over S3: version unchanged, not an error
  else legal prefix, endTurn false, and a legal step remains
    Mcp->>S3: one conditional put of the prefix only
    Mcp->>Ws: stateChanged to every bound human and the acting user
    Mcp->>S3: append one agentReply line
    Mcp-->>IDE: applied true, stop false, new offer
    Note over S3: the agent seat is still to move
  else legal prefix and endTurn true, or no legal step remains
    Mcp->>Mcp: apply prefix, end the turn, play heuristic seats until human or agent or game over
    Mcp->>S3: one conditional put for the whole burst
    Mcp->>Ws: one stateChanged
    Mcp->>S3: append one agentReply line
    Mcp-->>IDE: applied true, stop true, no offer
  else the conditional put loses
    Mcp-->>IDE: readable error, stop false
    Note over S3: this call wrote no version and no agentReply line
  end
```

The reply is all or nothing. The server rebuilds the offer from S3. It does
not apply a legal prefix and then keep an illegal tail. It does not call
`POST /moves` and it does not invoke the WebSocket Lambda.

## 11. Who gets the ping

```mermaid
sequenceDiagram
  participant Browser
  participant IDE
  participant Http as browser door
  participant Mcp as MCP door
  participant Ws as PostToConnection
  alt the write came from the browser door
    Browser->>Http: POST /moves
    Http->>Ws: stateChanged to other bound humans
    Note over Ws: the caller socket is not woken
  else the write came from the agent door
    IDE->>Mcp: a persisted move
    Mcp->>Ws: stateChanged to every bound human and the acting user
    Note over Ws: one ping after the put, not per burst step
  end
```

A missing socket is not an error. The payload is the existing `stateChanged`.

## 12. The record is not a move

```mermaid
sequenceDiagram
  participant Mcp as MCP door
  participant S3
  participant Browser
  participant Http as browser door
  Mcp->>S3: append agentReply beside the move lines of that version
  Browser->>Http: GET /log
  Http-->>Browser: move lines only
  Note over Http: replaying those moves reconstructs the position
  Note over S3: the agentReply line is not a gap and is not applied
  Browser->>Http: POST /moves
  Http->>S3: move lines only
  Note over S3: a browser write has no agentReply line
```

`why` or `plan` that contains the invite token or the bearer is stored with
that substring replaced by `[redacted]`. The injected log never receives the
handle, the token, or the bearer.

## Path index

| Diagram path | Gherkin |
|---|---|
| 1 unauthenticated 401 | edge: unauthenticated POST |
| 1 metadata document | edge: protected-resource metadata |
| 1 no registration endpoint | edge: no registration endpoint |
| 1 wrong bearer | edge outline: token that is not this door's access token |
| 2 consent page, then Google | edge: consent page |
| 2 non-https client_id | edge: non-https client_id |
| 2 redirect not in the document | edge: redirect not in the metadata document |
| 2 loopback ephemeral port | edge: loopback redirect may use an ephemeral port |
| 2 form-encoded token | edge: form-encoded token request redeems the code |
| 3 rotation | edge: rotated refresh token |
| 4 create stored | core: create stores a lobby |
| 4 create refused | edge outline: create refuses |
| 5 accept next human | core: browser accept |
| 5 accept while holding the agent seat | edge: accept by a user who already holds the agent seat |
| 5 humans full | edge: accept is 409 |
| 6 join binds agent, same user holds both | core: MCP join |
| 6 second join | core: a second join |
| 6 two users | edge: two different Google users |
| 6 join refusal | edge outline: join refuses |
| 7 start, humans-only groupHash | core: start allocates a game |
| 7 start too early | edge: start before the agent has joined |
| 7 MCP JWT on start | edge: start with an MCP access token |
| 8 initialize, no session | core: initialize is answered |
| 8 older protocol version | edge: older known initialize version |
| 8 GET 405 | edge: GET /conquarrow does not open a stream |
| 9 observe on turn, same offer text | core: observe on the agent's turn |
| 9 before start | edge: observe before Start |
| 9 not this turn | edge outline: observe when it is not this agent's turn |
| 9 not seated | edge: observe by a user who has not joined |
| 10 bad index, and legal-then-illegal | edge: bad index, legal then illegal |
| 10 not this turn | edge: a move when it is not the agent's turn |
| 10 empty prefix | edge: empty moves and endTurn false |
| 10 no legal step remains | edge: no legal step remains |
| 10 endTurn false | core: legal prefix with endTurn false |
| 10 endTurn true and burst | core: endTurn true |
| 10 lost put | edge: lost conditional put |
| 10 burst stops at the next agent | edge: burst stops at the next agent |
| 11 browser ping skips the caller | edge: a browser move still does not ping the caller |
| 11 agent ping includes the acting user | core: legal prefix with endTurn false |
| 12 record ignored by replay | edge: the log line has the reply fields |
| 12 redaction and log probe | edge: a token echoed into why |
| 12 browser write has no record | edge: a browser move does not append an agentReply line |

Lobby, library, and deletion scenarios are not message flows. They stay in
the feature files only.
