# P61 — BYOK commits a step batch per completion

**Local agent handoff:** `/spec-to-ship docs/design/packets/P61-byok-batch-turn.md`

Phase 1 writes a **new** spec directory
[`docs/spec/byok-batch-turn/`](../../spec/byok-batch-turn/)
(core + edge-cases `.feature`, mermaid, EARS). Do not burst
[`docs/spec/bot-turn-search/`](../../spec/bot-turn-search/bot-turn-search.md)
or rewrite P53 shuttle/stride scenarios.

**Layer:** `web` adapter only (`byokBot.ts` and its tests). No `contracts`,
`rules-core`, or `online-api` behaviour change. **No game rule is added,
changed, or implied.** Nothing is owed to SPEC §11. `greedy-v1` stays frozen.

**Depends on P15, P11.** P30 still plays back the returned `Move[]` with 400ms
gaps. Pages still calls `chooseMove`.

**Not this packet:** P58 personalities, P60 worker / HUD-during-think, the
2026-09-02T15:17 6-seat quiet-board freeze, MCP adapter, Pages lift onto
`chooseTurnBeam`, `evaluate` / `BotDrive` / mission retune, SPEC.md /
rules-core / a new `Move` kind, online BYOK (P20+), spending more
`max_tokens` so the model "notices" tempo, resurrecting
`tools/byok-turn-runner`.

## Problem

P15 loops `chooseLlmMove` over numbered `legalMoves` and `apply` until
`endTurn`. The system prompt already says send `2^k` as one `count`. Prompt
text did not beat a one-ply index picker. Same class of bug P53 fixed for
`beam-v1` by searching a whole turn.

Playtest that names it (do not re-litigate the heuristic 6-seat idle):

- 2026-09-02T17:54:37Z, 3-seat mixed, R=7, seed 1
- A heuristic / B grok-4.6 BYOK / C human
- `byokStats`: `llmHits` 7, `llmFallbacks` 0 (those hits are **per step**,
  P15 meaning)
- B T1: `-4,5,1` → `-5,6,0` ×1 then ×2 (same exit, peel+lump)
- B T2: `-5,6,0` → `-4,6,0` ×1 ×1 ×1 (three singletons; `count=3` was legal,
  same speed band)
- `firstCloseAt` 11 is heuristic A walking home, not B

Cause: each completion picks **one** step. A 3-stack's `count=1` and
`count=3` sit as sibling indices; the model picks `count=1` three times.

## What is not the fix

- **Louder tempo prose / bigger `max_tokens`.** Already lost to the one-ply
  list.
- **Numbered complete turn plans** (legalMoves* closure listed as rows).
  Grilled and rejected: origin batch + re-prompt instead.
- **`beam-v1` finalists as the offer.** BYOK would rubber-stamp the heuristic.
- **Offer-filter / hiding dominated singletons.** Grilled and rejected. Keep
  the engine list. Shuttle across prompts is allowed for BYOK; if it floods,
  that is a prompting issue and a later log, not this packet's chooser.
- **Coercing peel-then-lump.** Engine-legal (SPEC §3 inherit `spent`). Adapter
  does not make it illegal.
- **Resurrecting `byok-turn-runner`.** Still a per-step index picker
  (`POST /v1/pick` → `"move": N`).
- **Call-2 extract retry.** That was per-step salvage of a truncated essay.

## What ships

### 1. One completion commits an ordered step batch

Still OpenAI `chat/completions`, `temperature: 0`, `response_format: json_object`,
thinking off (P15). Still no conversation history.

**Offer** = `rules.legalMoves(state)` **steps only**, unfiltered, one global
index space `[0]…[n-1]`. Prompt may **print** them grouped under each `from`
(arrow id, never seat letters). `endTurn` is **not** an index.

Reply:

```json
{"moves":[3,0],"endTurn":false,"why":"short"}
```

`why` is optional. Both `moves` and `endTurn` are required. Missing either,
non-array `moves`, or non-boolean `endTurn` → unusable (empty prefix).

`testByokConnection` stays the tiny `{"move":0,"why":"probe"}` connectivity
check. Do not retarget the lobby probe at this contract.

### 2. Apply prefix; re-prompt; fallback only if prefix is empty

For each completion, against **this** offer:

1. Map each index to a `step`. Out-of-range indices are illegal items, not a
   hard fail of the whole array.
2. Apply in order while the next mapped step is in `legalMoves(now)`.
   Stop at the first that is not. That stop is the **legal prefix**. The rest
   is the **illegal tail**. Log every illegal item on `lastError` (no secrets).
3. **Prefix empty** (unusable JSON, or every index illegal, or
   `moves: []` and `"endTurn": false`) → `chooseMove` / `greedy-v1` for the
   **whole remaining** seat-turn. One fallback. Do not call `chooseTurnBeam`.
4. **Illegal tail** (prefix nonempty): **ignore `endTurn`**. Re-prompt from
   the state after the prefix, unless the prefix left no legal step (then
   force `endTurn`).
5. **Whole `moves` array applied:**
   - no legal step left → force `endTurn` even if `"endTurn": false`
   - `"endTurn": true` → `endTurn` (under-walk / pass is legal)
   - `"endTurn": false` and steps remain → re-prompt
6. `moves: []` and `"endTurn": true` → `endTurn` (pass). Hit, not fallback.
7. Mid-batch **win** (`winner` set): **stop**. Do not `endTurn` (P38). Not a
   fallback.
8. Completions cap **64** (same order as today's `MAX_MOVES_PER_TURN`). If
   completions ≥ **8**, `console.warn` (not a fallback, not a new match-log
   field). If the loop exits and the seat is still active, force `endTurn`
   (existing P15 tail).

No Date / `Math.random` / `performance.now` in the chooser. Fetch is the
impure adapter call it already is.

`useTurnRunner` stays unwired (no lobby checkbox work). not-ready still
calls `playBotTurn` (`beam-v1`) as today — name that split; do not silently
retarget it at `chooseMove`.

### 3. `byokStats` are seat-turns

Same JSON fields. New meaning:

- `llmHits += 1` iff this seat-turn never took the empty-prefix fallback
- `llmFallbacks += 1` iff it did (including after a good prefix on an
  earlier completion)
- Match log still stores every applied `Move`

A listed under-walk / pass is a **hit**. Fallback is HTTP / parse / empty
prefix only.

### 4. Prompt contract (guidance, not a filter)

System: pick an ordered `moves` index array from this offer; set `endTurn`
when the seat is done. Keep P15's rules/tempo/priorities prose as guidance
(including “send a `2^k` lump as one count”). Do not claim the adapter will
reject a shuttle.

User: `STATE_JSON` + targets + phase hint + numbered steps (grouped by
`from` in the text, global `[i]`). Not “pick one index.”

Drop `parseMoveIndex` as the live turn contract (tests migrate to the batch
parser). Distinctive `<<<MOVE:N>>>` tags are not required for v1 of this
packet; BSSN a batch tag only if parse tests need a non-JSON fallback.

## Scenario inventory (phase 1 must write each)

Core:

1. Constructed T2 board (3-stack on `-5,6,0`, `count=3` onto `-4,6,0` legal):
   mock `{"moves":[i],"endTurn":true}` with `i` the `count=3` index → applied
   `[step count=3, endTurn]`. Fixture; **not** an assert that a live model
   picks this.
2. Same board: mock three sequential `count=1` indices that stay legal →
   adapter **applies** them (no hide). Kickback from the original brief.
3. Human log 2026-09-07T10:13:27Z opening: mock `count=3` + `"endTurn":false`,
   then a second completion with two `count=1` **different** exits from the
   landing arrow → applied lump-then-2-way-split; leftover stays. SPEC §3
   inherit `spent` (the third head does not take a 2nd tile).
4. `{"moves":[],"endTurn":true}` → pass; `llmHits=1`.
5. `{"moves":[],"endTurn":false}` → empty prefix; `greedy-v1` remainder;
   `llmFallbacks=1`.
6. `{"moves":[legal, 99],"endTurn":true}` → apply `legal`, **ignore**
   `endTurn`, re-prompt; logged illegal 99.
7. Prefix exhausts all steps, `"endTurn":false` → force `endTurn`; hit.
8. Two different `from`s in one `moves` array, order preserved (close vs
   zigzag interleave at origin).
9. One successful seat-turn with 3 completions → `llmHits=1`, not 3.
10. Unusable JSON → empty prefix → `chooseMove` remainder; no extract retry
    POST.
11. `chooseTurnBeam` / P53 stride-shuttle constructions stay green and are
    **not** rewritten. `greedy-v1` output on P53 baseline positions unchanged.

Edge:

12. Mid-batch win → stop; `endTurn` is not applied; not a fallback.
13. Completions ≥ 8 → warn; still not a fallback. Cap 64 then force
    `endTurn` if the chair is still active.
14. not-ready config → `playBotTurn` (`beam-v1`), not this batch protocol.
15. `useTurnRunner: true` still does not call the runner.
16. `testByokConnection` still accepts a `{"move":0}` probe.
17. Same state + same mock replies → byte-identical `Move[]`. Offer order is
    `legalMoves` order (engine). No `Date` / `Math.random` / `performance.now`
    in `byokBot` chooser paths.
18. Pages / `pages-heuristic.ts` still imports `chooseMove`.

## Non-goals

- Offer-filter, coalescing `[i,i,i]` into `count=3`, forbidding shuttle.
- Enumerating complete turn plans.
- Calling `chooseTurnBeam` on parse fail.
- Unfreezing `greedy-v1`.
- Worker, lobby runner checkbox removal, match-log new fields.
- Editing SPEC.md.
- Online BYOK.

## Acceptance

- `playLlmBotTurn` issues **one** completion when the mock returns a full
  origin batch + `"endTurn": true`.
- Illegal tail never honours `"endTurn": true` (scenario 6).
- Empty prefix is the only path into `chooseMove`; that path runs until
  `endTurn`.
- T2 fixture accepts a lump mock (scenario 1) **and** applies three
  `count=1` if mocked (scenario 2). No chooser assert “never three count=1”.
- P53 shuttle/stride inventory stays green; this packet does not touch it.
- `llmHits` / `llmFallbacks` count seat-turns.
- `pnpm verify` green.
- No `Date` / `Math.random` / `performance.now` in the chooser.

## Module sketch (not normative layout)

```
byokBot.ts
  movesForLlm(legalMoves) -> steps only
  parseMoveBatch(text, length) -> { indices, endTurn } | unusable
  fetchLlmMoveBatch(...) -> one chat/completions, no extract retry, no runner
  playLlmBotTurn -> completion loop in §2
  chooseLlmMove -> unused by the live loop (delete or keep as test helper;
    spec-author BSSN; do not leave two live turn protocols)

buildSystemPrompt / buildUserPrompt
  JSON batch contract; group print by from; global [i]
```

Search/heuristic modules stay untouched.

## Why this and not a numbered turn-plan list

A 2nd-tile fan is not in the origin offer. Listing every legal **turn plan**
re-opens P53's explosion. Re-prompt after the lump sees the new steps.
Typical turn is one POST (every origin stack takes its next step, then
`endTurn`). Multi-step on one stack is the uncommon extra completion.
Cheaper than P15's per-step POST, cheaper to generate than the closure,
and it keeps close-vs-zigzag order as array order on the origin snapshot.

## Handoff checklist for the local agent

1. Read this packet, P15, `byokBot.ts` (`playLlmBotTurn`, `chooseLlmMove`,
   `annotateMove`, tempo prose), `CONTEXT.md` **API shape**. Do not start
   from the abandoned runner.
2. `/spec-to-ship docs/design/packets/P61-byok-batch-turn.md`
3. Escalate only if: a SPEC.md game-rule gap appears (it should not); parse
   of the batch cannot be made deterministic without a second completion;
   or playtest logs after this ships show shuttle flood and someone wants
   the offer-filter back — **stop**, do not silently hide counts.
4. Do not open P58, P60, P53 rewrites, or runner resurrection in the same PR.

## Escalate-if

- SPEC §3 split-after-lump is misread as illegal (it is not; leftover
  inherits `spent`).
- Temptation to call `chooseTurnBeam` on fallback.
- Temptation to restore “never three `count=1`” as a deterministic chooser
  test without an offer-filter (contradicts Q15).
