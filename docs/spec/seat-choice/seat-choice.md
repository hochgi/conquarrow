# seat-choice — the creator picks their own seat; five options per online seat

Packet: [P106](../../design/packets/P106-seat-choice.md). Issue
[#119](https://github.com/hochgi/conquarrow/issues/119) follow-up (Gilad's
2b answer, 2026-11-26). Amends [remote-agent-mcp](../remote-agent-mcp/remote-agent-mcp.md)
(seat 0, the host chair, one agent seat per user) and
[seat-labels](../seat-labels/seat-labels.md) (a reserved agent chair).
[SCENARIOS](./SCENARIOS.md).
**Status:** awaiting review. **SPEC:** not edited. No game rule.

## Glossary

| Term | Meaning |
|---|---|
| **choice** | One online seat's pick in the lobby: one of five wire tokens below. |
| **creator chair** | The human chair bound to the creator at create (`Player (you)`). |
| **reserved agent chair** | An agent chair kept for the creator's own agent (`Agent (yours)`): `{ kind: 'agent', reservedFor: creatorHash }`, unbound until that user's agent joins. |
| **open chair** | A human or agent chair anyone may take (`Player`, `Agent`). |

## The five choices (online)

| Lobby label | Wire token (`POST /invites` `seats[i]`) | Stored chair |
|---|---|---|
| `Player (you)` | `creator` | `{ kind: 'human', userHash: creator }` |
| `Player` | `human` | `{ kind: 'human' }` |
| `Agent (yours)` | `creator-agent` | `{ kind: 'agent', reservedFor: creator }` |
| `Agent` | `agent` | `{ kind: 'agent' }` |
| `AI` | `heuristic` | `{ kind: 'heuristic' }` |

Every online seat, seat A included, offers all five, in this order. Local
play is unchanged (`Player`, `AI`, `BYOK LLM`); `creator`, `creator-agent` and
`agent` are online-only, and `byok` is local-only.

## A valid online plan (client gate = server 422)

`onlinePlanProblem(choices)` (contracts `seat-plan.ts`), first match wins:

1. length not 3 or 6 → `size` (422)
2. any `byok` → `byok` (422)
3. no `creator` → `pick-your-seat`
4. more than one `creator` → `one-seat` (the lobby never builds this)
5. fewer than two chairs that are not `heuristic` → `needs-another`
   (you, plus at least one `Player`, `Agent` or `Agent (yours)`)
6. otherwise valid.

`Agent (yours)` may repeat. The request field `hostSeatIndex` is gone; the
creator's chair is wherever `creator` is. A body with the old shape (no
`creator`) is 422 and stores nothing.

## Lobby

- Picking `Player (you)` on a seat moves it there: the seat that held it
  becomes `Player`. Nothing else changes.
- Every other pick replaces only that seat. No pick is refused (the old
  "the last human cannot be dropped" guard is gone); the plan note says what
  is missing instead.
- Create is offered only when `onlinePlanProblem` finds no problem. The note reads:
  - `pick-your-seat` → `Pick your seat: choose Player (you) on one seat.`
  - `needs-another` → `Create needs you and at least one more Player or Agent.`
- Local → Online: seats 0 and 1 become `Player` unless the plan has an agent
  chair (P92, unchanged), `byok` becomes `AI`, and no seat is `Player (you)`:
  the creator picks it.
- Online → Local: `creator` → `Player`, `creator-agent` and `agent` → `AI`.

## Server

- **Create** (`POST /invites`): 401 on a rejected bearer; 422 on an invalid
  plan (nothing stored); else 201 with the stored chairs (named, P105).
- **Accept** (browser): unchanged — binds the next unbound human chair; a
  reserved agent chair is never taken by accept.
- **MCP `join`** (first match wins, after the P92 status checks):
  1. chairs reserved for the caller are still unbound → bind **all** of them
     in one write → `joined` with the caller's first agent seat;
  2. the caller already holds an agent chair → `joined` with that seat;
  3. no agent chair at all → `no-agent-seat`;
  4. no open unbound agent chair (only chairs reserved for someone else, or
     all bound) → `full`;
  5. bind the next open unbound agent chair → `joined`.
  A reserved chair is never bound to another user. Binding drops `reservedFor`.
- **Start**: unchanged rule — every human and every agent chair is bound,
  so Start waits for the creator's agent. The browser's Start button is
  offered under the same rule (it used to check humans only).
- **MCP `observe` / `move`**: when the caller holds several agent chairs,
  the turn is theirs when the active seat is one of them; otherwise
  `not-your-turn`. The offer is the shared `byok-offer` text for that seat, so
  MCP and BYOK context stay identical.

## Labels

`labelInviteChair` (P105) gains one row, before `waiting`: an unbound agent
chair reserved for the caller reads `your agent (waiting)`. A chair reserved
for someone else reads `waiting`. `reservedFor` is a user hash the peek
already shows on the creator's bound chair, so the peek may carry it.

## Creator in any seat

Nothing keys on seat 0 except the rules' round marker (`players[0]`), which is
whoever sits in seat A — a human, an agent or the AI. Turn order is seat order.
`groupHash` (bound human hashes), library status (the caller's human chair),
standings, the export and the MCP door all key on hashes, not on an index.

## EARS invariants

1. The online kind options for every seat index shall be exactly `creator`, `human`, `creator-agent`, `agent`, `heuristic`, in that order.
2. The client's `onlinePlanProblem` and the server's create validation shall agree for every plan of length 3 and 6 over the online tokens.
3. When a plan has no `creator` or more than one, the server shall answer 422 and store nothing.
4. After `pickOnlineSeat`, the plan shall hold at most one `creator`.
5. A chair reserved for user U shall only ever be bound to U.
6. MCP `join` by U shall bind every chair reserved for U, and no open chair, when U has reserved chairs.
7. Start shall not be offered, and shall be 409 on the server, while any human or agent chair is unbound.
8. When the caller holds several agent chairs, `observe` shall offer the active seat if and only if the caller holds it.
9. With the creator's chair at any index, create → accept → start shall produce the same `groupHash`, library status and labels as at index 0.
