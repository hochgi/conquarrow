# P92 — Remote agent MCP seat

> **Status:** ready for `/spec-to-ship`. **Kind:** online adapter. **Depends on:**
> P17–P19 (invites, moves, WebSocket), P66 (the BYOK offer text), P67 (the
> local stdio server this packet deletes), [ADR 0002](../../adr/0002-cheap-async-online.md),
> [ADR 0007](../../adr/0007-invite-only-byok-relay.md),
> [ADR 0009](../../adr/0009-remote-agent-mcp-seat.md).
>
> **SPEC coverage:** none. No game rule is added or changed. Nothing is owed
> to SPEC §11.

A person plays in the browser. Another person, or the same person, plays an
`agent` seat from Claude Code, Cursor, or OpenCode. The IDE's model decides
when to call a tool. The tool runs in one Lambda and dies. We do not call a
model, and we do not poll while a human is at lunch.

## What exists

- Online invites, Start, `POST /moves`, and the WebSocket ping are
  [ADR 0002](../../adr/0002-cheap-async-online.md). `validatePlan` refuses a
  plan with fewer than two `human` seats (`invite-record.ts`). `InviteSeat`
  is `human` or `heuristic` only (`contracts` `online-port.ts`). Browser
  accept binds the next unbound human. `POST /moves` accepts one `Move` from
  the active human and then runs the heuristic burst in that same invocation.
- The wake-up is `PostToConnection` on the API Gateway management API
  (`apigw-post-to-connection.ts`). The WebSocket Lambda only handles connect
  and disconnect. `notifyOthers` skips the caller's `userHash`.
- The BYOK offer is text built in `packages/web/src/byokBot.ts` (numbered
  rows, embedded `STATE_JSON`, the reply line). The reply the web seat
  parses is `{"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}`.
  `endTurn: false` means the web client asks the model again for the leftover
  tempo. That loop is the logic this packet is for testing.
- `packages/mcp` is a local stdio server (P67). Its observation is not that
  text. Its match lives in the process. It is the wrong door.
- The online lobby picker is Player / AI (`Lobby.tsx`, `ONLINE_SEAT_KINDS`).
  `byok` is refused online. Switching Local to Online forces seats 0 and 1
  to human (P27). Local play is unchanged.

## Decisions (BSSN, recorded here)

Do not re-open these in phase 1. They were settled with the human on
2026-11-09, or they are the smallest system that satisfies that settlement.
[ADR 0009](../../adr/0009-remote-agent-mcp-seat.md) holds the hard one.

### Seat and lobby

1. **New kind `agent`.** Online plans may name `human`, `heuristic`, and
   `agent`. `byok` stays refused online. The local lobby does not grow an
   agent chair. An agent chair cannot be the host seat. The P27
   Local-to-Online coercion still forces two human seats only when the
   plan has no agent chair. A plan that already has an agent chair keeps
   that chair, and keeps a single human.
2. **At least one human.** Create and Start refuse a plan with no human.
   One human plus heuristics and no agent still does not create a group or a
   game. One human plus an agent does.
3. **Start waits for every bindable seat.** Every human seat and every agent
   seat must be bound. Start is still a browser action by a bound human.
   An agent JWT cannot Start. After Start the token is 410, as today, so
   join-after-Start is impossible and is not added.
4. **`groupHash` stays humans only.** Agent hashes are not in the preimage.
   One human's games against any agents share one group folder.
5. **Two chairs, one Google user.** Browser accept binds the next unbound
   human, even if that user already holds the agent seat. MCP `join` binds
   the next unbound agent, even if that user already holds the human seat.
   A second agent seat for the same `userHash` is refused; joining again
   returns the seat already held. Two different Google users may each hold
   an agent seat.
6. **Labels.** Library and the in-game roster show `Agent (given_name)`,
   else `Agent`. `your-turn` / `waiting` / `won` / `lost` stay about the
   caller's **human** seat. An agent chair is never `your-turn`. If the
   caller holds the agent seat, that chair is marked `you` as well, so the
   row does not look like a stranger.

### Door

7. **URL.** `https://mcp.games.hochgi.com/conquarrow`. The host exists so
   OAuth discovery is not on `api.games`. The path is the game, same as
   `api.games.hochgi.com/conquarrow` and `ws.games.hochgi.com/conquarrow`.
   A later game adds a path, not a hostname. Do not use `/mcp`.
8. **One Lambda, same match.** The MCP function reads and writes the same
   S3 keys as the HTTP function, calls the same `apply`, and uses the same
   `PostToConnection` leaf. It does not HTTP-call `POST /moves`. It does not
   invoke the WebSocket Lambda. Extract the shared persist-and-burst so
   there is one implementation.
9. **Ping the browser even when the userHash matches.** `notifyOthers`
   skips the caller so a browser that just POSTed does not echo. An agent
   move did not come from the browser. Wake every bound human's sockets,
   including the acting user's, when the move came in the agent door.
10. **Heuristic burst stays in the ending invocation.** When the agent's
    game turn ends, heuristic seats play in that same call, until the next
    seat is human or agent or the game is over. Another agent is not played.
    One conditional put for the whole burst, as `handlePostMove` does today.
11. **Cost ceiling is ADR 0007.** Reserved concurrency, a throttle on the
    MCP route, a Budgets alert. No new datastore.

### Tools

Stateless Streamable HTTP. One POST, one invocation, then gone. No
`wait_for_turn`. No server push to the IDE. The invite link the human
pasted is the handle on every call, so a chat that still has the link can
resume days later, and a fresh chat pastes it again. Accept the
`#/invite/<token>` URL or the bare token. Never log the token or the JWT.

12. **`join`.** Binds the caller to the next unbound agent seat. Refuses a
    plan with no agent seat, a full agent roster, a revoked invite, and a
    started invite. Idempotent for the seat this user already holds.
    Returns `{ seatIndex, kind: "agent", status: "joined" }`. Does not Start.
13. **`observe`.** Rebuilds the offer from S3. Returns one of:
    - not started: `stop: true`, no offer. The model ends the chat turn.
    - not this seat's turn, or game over: `stop: true`, no offer.
    - this seat's turn: the BYOK offer **text** (decision 16), `stop: false`.
14. **`move`.** Arguments are the invite handle plus the BYOK reply:
    `moves` (integer indices), `endTurn` (boolean), optional `why` and
    `plan`. The server rebuilds the offer. It does not trust indices
    against text the model saw earlier.
    - Bad JSON, unknown index, or a step that is illegal now: state
      unchanged, an error the model can read, `stop: false`. The tool
      description says to correct once, then stop. The server does not
      count attempts. The throttle is the backstop.
    - Legal prefix and `endTurn: false`: apply the prefix only, return the
      new offer text, `stop: false`. The chat turn stays open. This is the
      BYOK leftover-tempo loop, and it is in scope.
    - Legal prefix and `endTurn: true`, or no legal step remains: apply
      end-turn, run decision 10, persist, ping, return
      `{ applied: true, version, stop: true }` and no offer.
15. **The model ends the chat turn. We cannot.** Tool descriptions and the
    `stop: true` result say: do not call another tool; tell the person to
    send a message when the human seat has moved. The next message is the
    resume. Zero invocations while they are away. A premature resume is one
    `observe` that returns `stop: true`.

### Offer, auth, cleanup

16. **The real offer, not a copy.** Move the pure prompt builder and the
    reply parser out of `packages/web/src/byokBot.ts` into a new package
    `@conquarrow/byok-offer` with no React and no `fetch`. Web and the MCP
    Lambda both call it. The web seat's HTTP call to the model stays in web.
17. **OAuth is ours, Google is the identity provider.** The MCP Lambda (or
    a route on the same API) is the authorization server. It redirects the
    IDE's browser to Google, then issues a signed JWT. Audience is exactly
    `https://mcp.games.hochgi.com/conquarrow`. Access token 15 minutes.
    Refresh tokens rotate. No revocation list in this packet: a stolen
    access token dies in 15 minutes. Cognito stays out.
    Client registration is a **client-id metadata document**, not dynamic
    registration. Dynamic registration is deprecated in MCP 2026-07-28, and
    an open register endpoint is an abuse hole.
18. **Speak 2026-07-28, and answer a sessionless `initialize`.** Claude Code
    negotiates 2026-07-28. Cursor and default OpenCode still begin with
    `initialize`. Answer that handshake. Do not mint `Mcp-Session-Id`, do
    not require a sticky session, do not hold a GET stream. Ignore a
    session header if one is sent.
19. **Replies are recorded, the harness is not.** On a persisted `move`,
    append a playtest record the replay ignores: the reply fields
    (`moves`, `endTurn`, `why`, `plan`) and the version. No token, no JWT,
    no full offer text (replay rebuilds the offer). A benchmark run that
    scores those records is a later packet.
20. **Delete `packages/mcp` in this packet.** P67's stdio server, its
    frozen greedy-v1, and its P66-era observation go when the remote door
    is in. Do not keep two doors.

## Human steps before deploy

Not agent work. A wizard, when the code is otherwise done:

- A Google OAuth client (authorization code) whose redirect is this host's
  callback. The existing GIS ID-token client is not that client.
- A Namecheap CNAME `mcp.games` to the new API Gateway. No new Route53 zone.
- The ADR 0007 Budgets alert covers this function too.

Tests use the existing injected Google verifier and the in-memory S3 rig.
They do not need those accounts.

## Scenarios

- Create with one human and one agent, the rest heuristic: the invite is
  stored. Create with no human: refused, nothing stored. Create with one
  human and the rest heuristic: refused, as today.
- Browser accept binds the next unbound human. It does not take an agent
  chair. MCP `join` binds the next unbound agent. It does not take a human
  chair. The same `userHash` may hold both. A second `join` from that user
  returns the same agent seat and does not take another.
- Start before the agent has joined: refused, invite still open. Start by
  an agent JWT: refused. Start once every human and every agent seat is
  bound: game allocated, token 410, `groupHash` is the humans only.
- `join` on a started or revoked invite: refused, no seat change.
- `observe` before Start: `stop: true`, no offer, S3 unchanged.
- `observe` when a heuristic or the other human is to move: `stop: true`.
- `observe` on the agent's turn: the shared package's offer text, including
  the numbered rows and the reply instruction. Same state and seat produce
  the same text the web BYOK seat would be shown.
- `move` with a bad index: state and version unchanged, `stop: false`.
- `move` with a legal prefix and `endTurn: false`: those steps are applied,
  the turn is not ended, the result is the new offer, `stop: false`.
- `move` with `endTurn: true` on the agent's turn: the turn ends, following
  heuristic seats play in that invocation, one version is written, other
  humans' sockets (including the acting user's, if they have one) receive
  `stateChanged`. Result is `stop: true` and no offer.
- A `move` when it is not the agent's turn: state unchanged, `stop: true`.
- The reply record on the log has the indices and `endTurn`, and no token.
  Replaying the log's moves still reconstructs the position. The record is
  not a move.
- An unauthenticated POST to `/conquarrow` is 401 and names the protected
  resource metadata. A token whose audience is not that exact URL is 401.
- `packages/mcp` is gone. No stdio bin remains.

## Non-goals

- A poll, a long-poll, a push, or an elicitation dialog as the resume.
- The agent creating an invite, pressing Start, or joining after Start.
- A second agent seat for one Google user in one game.
- Calling a model, holding a key, or a hosted-LLM seat.
- A benchmark harness over the logged replies.
- A revocation list, per-user quotas beyond the ADR 0007 throttle, or Cognito.
- Dynamic registration, including as a fallback so Cursor can connect. If a
  client cannot fetch a metadata document, it is out of this packet.
- Changing a game rule, the geometry, or the local lobby.
- MCP Apps, a rendered button, or a durable task the client polls.

## Acceptance

- A human can, in the online lobby, put an agent chair on a 3- or 6-seat
  plan, share the invite link, wait until `join` has bound it, press Start,
  and play in the browser.
- An MCP client that only has that link and a Google login can `join`,
  `observe`, and `move` through a whole game, including a leftover-tempo
  reply (`endTurn: false`) and a gap of hours with no invocation in between.
- The browser updates through the existing WebSocket ping and GET.
- An illegal reply does not change the stored position.
- `packages/mcp` is deleted.
- Cost stays inside the ADR 0007 ceiling.
