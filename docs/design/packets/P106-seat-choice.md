# P106 — Seat choice: the creator picks their own seat; five options per online seat

> **Not a game-rule change.** Contracts (`PlannedSeatKind` gains `creator`
> and `creator-agent`; `InviteSeat`'s agent gains `reservedFor`; one new
> label row), online-api (create, MCP join and observe/move with several
> agent chairs) and web (lobby options, plan note, Start gate, mode
> switches). Breaking: `CreateInviteBody.hostSeatIndex` is removed, and a
> plan with no `creator` is 422. Removed from web: `hostSeatIndex`,
> `onlineSeatKindAllowed`, the 3-argument `lobbyKindOptions`, `CREATE_PLAN_NOTE`.
> No SPEC.md edit, no new route, no new AWS. The agent-facing offer text is
> unchanged (MCP and BYOK stay identical); the MCP `join` tool description
> names reserved chairs.

**Status:** awaiting review. **Depends on:** P92, P96, P105. **Issue:**
[#119](https://github.com/hochgi/conquarrow/issues/119) follow-up (Gilad's 2b
answer, 2026-11-26).
**Spec:** [seat-choice](../../spec/seat-choice/seat-choice.md) ·
[SCENARIOS](../../spec/seat-choice/SCENARIOS.md).

## Symptom

P105 kept the spec default: the first human chair is the creator's and seat A
never offers `Agent`. Gilad: "I don't want to pin creator to first seat. And I
want agent to be an eligible option for seat A … only after picking my seat I
can create the invite … 5 options: player (you), player, Agent (yours), Agent,
AI."

## Decisions

1. **Five online choices**, on every seat: `Player (you)` = `creator`,
   `Player` = `human` (open), `Agent (yours)` = `creator-agent` (reserved for
   the creator's own agent), `Agent` = `agent` (open), `AI` = `heuristic`.
   Local is unchanged.
2. **One `Player (you)`, required.** Picking it moves it; Create is disabled
   with `Pick your seat: choose Player (you) on one seat.` until it is
   picked. The server refuses no / two `creator` with 422.
3. **Enough chairs.** At least two chairs that are not AI (`needs-another`:
   `Create needs you and at least one more Player or Agent.`). `Agent
   (yours)` counts and may repeat.
4. **Reserved agent chairs.** Stored `{ kind: 'agent', reservedFor }`. MCP
   `join` by the creator binds all of them in one write; another user's agent
   never takes one (`full` when no open chair is left). Accept never takes
   one. Start waits for them (P92 rule), and the browser's Start gate now
   checks agent chairs too.
5. **Several agent chairs, one user.** `observe`/`move` play the active seat
   when the caller holds it; else `not-your-turn`. The offer text is the
   shared `byok-offer` one.
6. **Labels.** An unbound chair reserved for the caller reads `your agent
   (waiting)`; `your agent (waiting)` is a reserved word, never a name.
7. **Mode switches.** Local → Online never picks `Player (you)`; Online →
   Local maps `creator` → Player and both agent choices → AI.
8. **Creator in any seat.** Turn order is seat order; nothing else keys on
   seat 0 (groupHash, library status, standings, export and the door key on
   hashes). Tested end to end with the creator in seat C and an agent in A.

## Open questions (for Gilad)

1. **Agent-only creator.** May the creator pick only `Agent (yours)` seats
   and no `Player (you)`? P106 requires `Player (you)` ("after picking my
   seat"). Allowing it needs a Start owner who has no human chair.
2. **The creator's agent on an open `Agent` chair.** P92 lets the creator's
   agent take an open chair when it has no reserved one. Kept.

## Tests

`packages/online-api/test/seat-choice.*.test.ts`,
`packages/web/test/seat-choice.*.test.ts`, and the updated P17/P92/P105 tests
that posted `hostSeatIndex` or a plan with no `creator`.
