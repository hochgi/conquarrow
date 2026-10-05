# P17 — Online auth, invites, discovery

> **Status:** shipping. Gate 4: PR to `hochgi/conquarrow`.
> **Depends on:** P14, P16.

## Intent

- Verify Google ID tokens in Lambda (`sub` → `userHash`)
- `GET /me`
- `POST /invites` — creator makes a 3- or 6-seat lobby, marks seats
  `human | heuristic`, occupies `hostSeatIndex` (default: first human seat)
- `GET /invites/:token` — unauthenticated peek while open
- `POST /invites/:token/accept` — next unbound human seat; full → 409
- Creator revoke; **no TTL**; 410 `{ reason: "revoked" | "started" }`
- Reject create with **fewer than 2 human seats** → 422, no S3
- Membership pointers + `GET /my-games` (that user only: open lobbies + games)
- `POST /invites/:token/start` — any bound human, when every human seat is
  bound → open-or-create `groupHash`, allocate **next** `games/NNNNNN`
  (never overwrite). **Meta only** (no `state.json` / `log.jsonl`)

## Scenario inventory (for spec-author)

- Happy: 3-seat (2 human + 1 heuristic) invite → two Google users → Start → membership on both `/my-games`
- 6-seat all-human fill then one extra accept → 409, no spectator row
- All-heuristic or 1-human create → 422, no S3
- Same user accepts twice → idempotent same seat
- Unauthenticated accept → 401
- Start before human seats are full → 409
- Revoked token → 410 `{ reason: "revoked" }`
- `/my-games` never lists another user's group

Committed tests: Vitest against an `OnlinePort` (or HTTP handler ports) with
fake S3 / fake Google verify. Kit/S3 probes stay on `local-main`.

> **Superseded by P68:** the `local-main` overlay is retired; S3 probes are
> committed in `packages/online-api/test/online-edge-probes.*`.

## Out of scope

Move submit / WebSocket notify / heuristic burst (P18), FE wiring (P19),
Google Cloud OAuth client creation (operator env `GOOGLE_CLIENT_IDS`).
Concurrent accept/Start and rematch game-number allocation (conditional S3
put, `If-None-Match` on `games/NNNNNN`) — P18, when ObjectStore gains
versioned writes for moves.
