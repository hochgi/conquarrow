# P67 — Conquarrow MCP (rules-core adapter)

**Local agent handoff:** `/spec-to-ship docs/design/packets/P67-conquarrow-mcp.md`

Phase 1 writes a **new** spec directory
[`docs/spec/conquarrow-mcp/`](../../spec/conquarrow-mcp/)
(core + edge-cases `.feature`, mermaid, EARS). Do not burst
P15/P61/P64/P66 spec dirs. Do not touch `chooseTurnBeam`. Do not
edit `docs/byok-teaching.md` in this packet — P66 owns that file
this round.

**Layer:** new adapter package (suggested `packages/mcp`) over
`rules-core` + `contracts`. Optional thin reuse of web helpers
(`annotateMove`, P21 `findings`) **imported as libraries**, not a
UI scrape and not a Playwright drive of Pages. No
`contracts` / `rules-core` behaviour change. **No game rule is
added, changed, or implied.**

**Depends on P01, P04, P11-read, P15-read, P21-read, P64-read.**
Ship **after** P66 so the self-improve loop does not start from
the dirt-close / tag-chase teaching. BYOK on Pages stays the
browser seat (ADR 0003). This packet is a **stdio MCP server**
for a local OpenCode / tool-calling seat.

**Not this packet:** online BYOK (P20+), worker (P60),
personalities (P58), temperature, live grok in CI, rewriting
the BYOK JSON contract, substituting MCP for `playLlmBotTurn`,
scraping `https://games.hochgi.com/conquarrow/`.

## Why this exists

BYOK is one POST per leftover-tempo offer: numbered `LEGAL_MOVES`,
stripped `plan`/`why`, 3.4k-token dump. That is the right shape
for Pages + a prepaid key.

An OpenCode seat wants the other shape: **tools** over the same
engine, billed against quota, with observation views a human
can also read. The 2026-09-02 note still holds: adapter over
`legalMoves` / `apply` / `playBotTurn`, observation + findings,
not raw `GameState`. Distinct from the abandoned BYOK turn-runner.

Self-improve loop (not this packet’s code, this packet’s
*reason*): play seed-1 mixed → write what the offer allowed vs
what was played, in packet language → change P66 teaching or
this observation → replay. Not “rewrite the prompt until it
wins.”

## Surface

One MCP server, stdio, local. Suggested name `conquarrow`.

### Tools (v0 — lock these names)

| Tool | Does | Does not |
|---|---|---|
| `new_match` | `makeTiling` + setup. Args: `R`, `homeOffset`, `playerCount`, `spawnerSeed`, `dominationN`, seat kinds (`human` / `heuristic` / `byok` reserved but unused here). Returns `matchId` + observation. | Persist to disk unless phase 1 adds a single temp file. No AWS. |
| `observe` | Seat-scoped **view**: scores, my groups, exposed tips, threat line (P64 facts), tip-local spawners (cap 12), findings (P21 kinds that have a legal first step), longest enemy trail length + sample cap. | Raw `GameState`. Full 58-spawner dump. Territory cell list. |
| `legal_moves` | Numbered rows in the same text shape BYOK already prints (`from`, `exit`, `count`, `spent`, `left`, `tipDist`, `trailLen`, tags). | Invent a row. Filter mills unless the caller asks `includeMills`. Default **includes** mills — hiding them is an offer-filter and is parked. |
| `apply_steps` | Ordered list of `{from, exit, count}` **or** BYOK-style indices into the last `legal_moves` offer for this seat. Each step is `rules.apply`. Returns observation + tags of what landed (`closes`, `cut`, `share+N`, …). | A step that is not legal. A cut that is not a row. |
| `end_turn` | `applyEndTurn` / the existing end-turn move. Returns observation. | Skip / vanished `SkipMove` (deleted in P51). |
| `play_heuristic_turn` | One seat-turn of `chooseTurnGreedy` (frozen `greedy-v1`). Optional later flag for `chooseTurnBeam` is **parked** — do not lift Pages and do not make beam the MCP default. | Search budget knobs. |

`matchId` is in-process. One live match per server is enough for
v0. A second `new_match` replaces it and clears BYOK-style plan
state if any is held here (MCP does not have to persist `plan`;
that is the BYOK seat).

### Resources (optional, park if costly)

- `conquarrow://spec/byok-teaching` — read the teaching file.
- `conquarrow://match/observation` — last `observe` payload.

Not required to ship v0 if tools alone pass the scenarios.

## Observation contract (the whole point)

`observe` returns a JSON object the spec locks field-by-field.
Suggested keys (phase 1 may rename, not add a dump):

```
me, activePlayer, winner,
shareCounts, territoryCounts, starvationStreaks,
myGroups, exposedTips,
leadLine,          // same facts as P64 threat line
offerTags,         // cut / closes / borders_spawner / dirt-closes
longestEnemyTrail, // {seat, length, sample[]}
spawnersNearTips,  // cap 12, tip-local rank
findings           // P21 kinds with legal first step only
```

Findings are **read-only hints**. The model still picks a legal
row. A finding cannot create a cut.

Do not ship raw `trails` of every seat as a full arrow list
beyond the sample cap already used in BYOK snapshots.

## Invariants

- WHILE serving a tool, the server SHALL call `rules-core`
  `legalMoves` / `apply` / end-turn. It SHALL NOT scrape a DOM.
- WHEN `apply_steps` names an illegal step, the server SHALL
  refuse and leave state unchanged. Same `ContractViolation`
  family the engine already throws — wrap, do not swallow.
- WHEN `observe` runs, the payload SHALL NOT include a legal
  step that `legalMoves` would not emit for `activePlayer`.
- WHEN two findings tie, reuse P21’s deterministic tie-break.
- No `Math.random` / `Date.now` in observation or findings
  collection.
- Keys never leave the process. No OpenAI call from this
  package. The caller (OpenCode) owns the model.

## Scenario inventory (phase 1 must write each)

Core:

1. `new_match` seed 1, R=7, 3 seats → observation has three
   shareCounts of 4/4/3 or the locked opening counts for that
   setup, `winner` null, `activePlayer` A.
2. `legal_moves` for A’s opening home stack returns numbered
   rows; at least one `leave_home` and one `home_mill`.
3. `apply_steps` of one legal opening step changes
   `exposedTips` / trailLen; a second call with the same
   (now-illegal) index is refused and state matches after the
   first apply.
4. `end_turn` advances `activePlayer`.
5. `observe` after a dirt-shaped close (fixture or reconstructed
   3-seat walk) reports `closes` and does **not** invent
   `share+N` when the engine did not award a share.
6. `play_heuristic_turn` on a quiet opening returns a legal
   move list the engine accepts, then the next seat is active.
7. Findings list only contains kinds whose `step` is in
   `legalMoves` for `me`.
8. No tool returns the full 58-spawner array.

Edge:

9. `apply_steps` on a won match refuses (P38).
10. `new_match` twice: second match id differs; first match is
    gone.
11. Index form of `apply_steps` is relative to the last
    `legal_moves` for that seat; a stale index after an apply
    is refused.
12. Stdio handshake: tools/list includes the six names above.

## Non-goals

- Replacing BYOK on Pages.
- Teaching-file edits (P66).
- Temperature / plan echo inside MCP.
- Path-to-enemy search.
- Hosting this server on AWS.
- Multi-match concurrency.
- Lifting `chooseTurnBeam` as the MCP default.

## Acceptance

- `pnpm` test in the new package (or web test folder if phase 1
  keeps it there) covers core 1–8 without a live model.
- `pnpm verify` green.
- Packet + spec state in one sentence that this is not a UI
  scrape and not raw `GameState`.
- README / package bin shows the OpenCode stdio one-liner
  (`opencode mcp add` or the repo’s existing convention). Do
  not invent a second config format if the repo already has one.

## Module sketch

```
packages/mcp/package.json
packages/mcp/src/server.ts          // stdio MCP
packages/mcp/src/observe.ts         // seat view
packages/mcp/src/tools.ts
packages/mcp/test/mcp-observe.test.ts
docs/spec/conquarrow-mcp/
docs/design/packets/P67-conquarrow-mcp.md
```

Reuse `packages/rules-core` and, if cheap, `packages/web/src/findings.ts`
+ `annotateMove`. If importing web pulls the renderer, copy the
pure helpers into `packages/mcp/src/` rather than dragging SVG.

## Handoff checklist

1. Read this packet, P21 findings kinds, P64 observation rank,
   `makeRules` / `legalMoves` / `apply` in `rules-core`.
2. `/spec-to-ship docs/design/packets/P67-conquarrow-mcp.md`
   **after** P66 is the live teaching, or in the same OpenCode
   session as a second spec-to-ship once P66’s PR is locally
   green.
3. Paste a P67 index row into `docs/design/02-work-packets.md`
   (this handoff already does).
4. Escalate if the MCP SDK forces a rules-core API change, if
   findings cannot be imported without the renderer, or if
   stdio auth disagrees with an existing repo convention.
