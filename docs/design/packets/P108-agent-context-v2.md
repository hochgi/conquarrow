# P108 — Agent context v2 (first slice): seats, starvation, since your last turn, honest step counts

> **Not a game-rule change.** byok-offer (the shared builder: seat table,
> starvation line, recent-events block, row tempo slot, batch rule),
> online-api (the door builds `about` from the invite and `log.jsonl`; the
> `move` schema), web (the BYOK seat builds `about` from its seats and local
> log). No SPEC.md edit, no new route, no AWS change. MCP and BYOK get the
> same text from the same builder.
> Breaking: the LEGAL_MOVES tempo slot (`spd` is the group's allowance,
> `then=` added), the offer gains blocks, and `move`'s schema is stricter.

**Status:** awaiting review. **Depends on:** P92, P93, P106, P107. **Issue:**
[#123](https://github.com/hochgi/conquarrow/issues/123) (first slice).
**Spec:** [agent-context-v2](../../spec/agent-context-v2/agent-context-v2.md) ·
[SCENARIOS](../../spec/agent-context-v2/SCENARIOS.md).

## Symptom

From the P93–P97 playtests:

- The offer named seats by letter only.
- It said nothing about what happened since the agent's last turn.
- It hid the starvation clock in `STATE_JSON`.
- A split row read `left=-1` for a legal step.
- The `move` schema declared neither integer indices nor `why` / `plan`.
- No text said that every index in a reply refers to the same offer.

## Decisions

See the spec's D1–D7. In short:

1. A seat table (kind, name, `you` / `also you` / `your owner`).
2. A starvation line read from the state.
3. "Since your last turn": the P107 log events of every move from the start of the agent's last completed turn, one line per turn.
4. Row tempo: `spd` = the allowance of the group on `from`, `left` = `spd − spent` (≥ 1), and `then=` the steps the stack on `exit` keeps. The `-1` was the display, not an illegal row.
5. The `move` schema: integer `moves` items, plus `why` and `plan` strings.
6. The batch rule is stated (indices stay; no `{from, exit, count}`).
7. One builder, so the door's offer block equals the BYOK prompt for the same `about`.

## Scope

Issue #123 is M–L. This packet ships the header, the history and the protocol
fixes. The next slice (P109) is the geometry hints:

- a closing path per exposed tip and per outward step;
- stuck-tip reason lines;
- trimming or dropping `STATE_JSON` once those hints replace what it carries.

## Open questions (for Gilad)

1. **A local BYOK seat's owner.** Locally nobody is `your owner`. Should the human seat(s) of a local game read `your owner`?
2. **Window length.** It runs from the agent's last completed turn. Should it also keep the turn before that, so a slow plan can see two rounds?
3. **Batch protocol.** Should `{from, exit, count}` steps be accepted so one reply can walk a stack twice? Today the rule is stated instead.

## Tests

- `packages/byok-offer/test/agent-context-v2.*.test.ts`: the seat table, the starvation line, the window and its rendering, the row tempo with a property test over played positions, and the identical-text invariant.
- `packages/online-api/test/agent-context-v2.scenarios.test.ts`: SCENARIOS 1–3.
- `packages/web/test/agent-context-v2.byok.test.ts`: SCENARIOS 4.
