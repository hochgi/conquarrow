# ADR 0011 — The server is the source of truth; clients retry and catch up

**Status:** Accepted
**Date:** 2026-11-16
**Amended:** 2026-11-17 (P97) — the shell reads sign-in only from the host. A leftover `sessionStorage` token is not migrated.
**Context:** [P95](../design/packets/P95-online-reliability.md), [ADR 0002](./0002-cheap-async-online.md), [P49](../design/packets/P49-online-move-log-replay.md), [P97](../design/packets/P97-signin-lobby.md)

## Context

ADR 0002 chose a cheap async design: Lambda + S3, a conditional write per
version, and a WebSocket that only says "version N exists". The P95 playtest
showed where that design was incomplete, not wrong:

- A request can land after its client gave up (API Gateway's 30 s cap, a
  dropped phone connection). The client could not tell "lost" from "landed".
- The WebSocket is best-effort. API Gateway closes it after 10 minutes idle and
  after 2 hours, and the client had no other way to learn about a new version.
- Some turns are nobody's to play. A lost seat is offered only the pass (SPEC
  §9); a heuristic seat's turn is played by the server only when a human's
  POST happens to run the burst. A pass-only agent or human seat held the game.

## Decision

1. **Idempotent submits.** Each `POST /moves` carries a client submit id; the
   envelope remembers the last applied one, and a repeat answers the version it
   produced. Clients retry transport failures with the same id.
2. **The server advances the game on every write and every read.** Any seat
   whose only move is the pass is passed, any heuristic seat is played, until a
   human or agent has a real choice or the game is won. Reads heal a game that
   an earlier request left short (budget, crash, older code). The advance is
   bounded by a wall-clock budget so one request stays under the gateway cap;
   the rest continues on the next read.
3. **Pull is the floor, push is the fast path.** Wakes stay version-only and go
   to every device of every human. Clients ping the socket, reopen it when it
   closes, and poll a small version endpoint while in a game. Any newer version
   takes the P49 wake path.
4. **Browser storage is a cache.** The ID token is cached in `localStorage` and
   refreshed ahead of expiry through One Tap; boards, logs and seats come from
   the server. The shell asks the online host whether it is signed in
   (`signedIn()`). It does not read the token key itself, and it does not read
   `sessionStorage` for that key. A leftover `sessionStorage` token from before
   P95 is not migrated (P97).

## Consequences

- A GET can write. It writes only when the position needs an advance, under the
  same conditional put as every other write, so two readers cannot both
  advance.
- The asynchronous worker (an SQS- or self-invoked burst) is not needed while a
  budgeted advance fits in a request. If heuristic turns grow slower, the
  budget simply spreads a burst over more reads; an async worker can replace
  the read-time heal without changing the protocol.
- Polling costs a member-checked S3 read per client every 15 s while a game is
  open and visible. At hobby scale that is negligible; the interval is a single
  constant.
- `notify` no longer skips the caller, so a client receives its own wakes and
  ignores them by version.
