# P67 — Conquarrow MCP (rules-core adapter)

**Local agent handoff:** `/spec-to-ship docs/design/packets/P67-conquarrow-mcp.md`

Phase 1 writes a **new** spec directory
[`docs/spec/conquarrow-mcp/`](../../spec/conquarrow-mcp/)
(core + edge-cases `.feature`, mermaid, EARS). Do not burst
P15/P61/P64/P66 spec dirs. Do not touch `chooseTurnBeam`. Do not
edit `docs/byok-teaching.md` in this packet — P66 owns that file
this round.

**Layer:** new adapter package (suggested `packages/mcp`) over
`rules-core` + `contracts` + `geometry-tiling`. Optional thin reuse of web helpers
(`annotateMove`, P21 `findings`) **imported as libraries**, not a
UI scrape and not a Playwright drive of Pages. The board picture
is a simple SVG from state
([ADR 0004](../../adr/0004-mcp-board-picture-is-svg.md)), not
`Board.tsx`. No `contracts` / `rules-core` behaviour change.
**No game rule is added, changed, or implied.**

**Depends on P01, P03-read, P04, P09-read, P11-read, P15-read, P21-read,
P38-read, P53-read, P64-read.**
Ship **after** P66 so the self-improve loop does not start from
the dirt-close / tag-chase teaching. BYOK on Pages stays the
browser seat (ADR 0003). This packet is a **stdio MCP server**.
The caller is not a seat kind. Seats it drives are **human**
([`CONTEXT.md`](../../../CONTEXT.md)).

**Not this packet:** online BYOK (P20+), worker (P60),
personalities (P58), temperature, live grok in CI, rewriting
the BYOK JSON contract, substituting MCP for `playLlmBotTurn`,
scraping `https://games.hochgi.com/conquarrow/`, attaching to
the running web app, a server rasterizer, shelling out to
ImageMagick.

## Why this exists

BYOK is one POST per leftover-tempo offer: numbered `LEGAL_MOVES`,
stripped `plan`/`why`, 3.4k-token dump. That is the right shape
for Pages + a prepaid key.

A local tool caller wants the other shape: **tools** over the same
engine, with an observation a human can also read, and a board
picture to look at. The caller submits moves for every human seat
— the living person's orders and its own. This package does not
call a model and does not hold a key. Distinct from the abandoned
BYOK turn-runner.

The 2026-09-02 note still holds: adapter over `legalMoves` /
`apply` / `playBotTurn`, observation + findings, not raw
`GameState`.

Self-improve loop (not this packet’s code, this packet’s
*reason*): play seed-1 mixed → write what the offer allowed vs
what was played, in packet language → change P66 teaching or
this observation → replay. Not “rewrite the prompt until it
wins.” The caller writes that note from tool results it already
saw. The server does not keep an offer history.

## Surface

One MCP server, stdio, local. Suggested name `conquarrow`.
One client. The match is in-process. There is no browser on
the other end.

Before `new_match` the caller asks, in chat, whether the match
is 3 or 6 seats and which seats are human versus heuristic.
Which human id is the living person stays in the chat. The
server stores the seat plan only. It does not prompt.

### Tools (v0 — lock these names)

| Tool | Does | Does not |
|---|---|---|
| `new_match` | `makeTiling` + `makeMatch`. Args: `R`, `homeOffset`, `playerCount`, `spawnerSeed`, `dominationN`, and a kind per seat (`human` \| `heuristic` only). `playerCount` is 3 or 6. Returns `matchId` + observation for seat A. | `byok`. Any other count (refuse, do not clamp — `mintPlayers` would). A temp file. A stored “living person” seat. A blocking prompt. |
| `observe` | Seat-scoped **view** for the seat id. `me` is that seat. Scores, my groups, exposed tips, `threatLine` (P64 string, derived from the fields), tip-local spawners (cap 12), findings (P21 kinds whose `move` is a legal step), longest enemy trail length + sample cap. Any seat. | Raw `GameState`. Full 58-spawner dump. Territory cell list. A field named `leadLine` or `step`. |
| `legal_moves` | Numbered rows in the BYOK text shape, including `spd` and conditional `leave`: `[i] step from=… exit=… count=… [leave=N] spd=… spent=… left=… tipDist={d0}→{d1} trailLen=… [tags=…]`. Any seat. | Invent a row. Drop `spd` or `leave`. Filter mills unless the caller asks `includeMills`. Default **includes** mills — hiding them is an offer-filter and is parked. |
| `apply_steps` | Ordered list of `{from, exit, count}` **or** BYOK-style indices into the last `legal_moves` offer for this seat. Each step is `rules.apply`. Only the active **human** seat. Returns observation + tags of what landed (`closes`, `cut`, `share+N`, …). | A heuristic seat. A seat that is not active. A step that is not legal. A cut that is not a row. |
| `end_turn` | `applyEndTurn` / the existing end-turn move. Only the active **human** seat. Returns observation. | A heuristic seat (that would skip greedy). Skip / vanished `SkipMove` (deleted in P51). |
| `play_heuristic_turn` | One seat-turn of `chooseTurnGreedy` (frozen `greedy-v1`), including its end. Only the active **heuristic** seat, and only when called. | A human seat. Auto-play. Search budget knobs. `chooseTurnBeam` — parked; do not lift Pages and do not make beam the MCP default. |
| `see_board` | Board picture: simple SVG of the match `R`-window from state. Flat fills and strokes. Every arrow, trail, territory, and spawner in that window. Seat id highlights that seat’s groups and nothing else. Same state + seat id → same SVG. Any seat. | A PNG. A rasterizer. A shell-out. `Board.tsx`. A Pages screenshot. An offer — a shape in the picture is not a legal move. |

`matchId` is in-process. One live match per server is enough for
v0. A second `new_match` replaces it. The server holds the last
`legal_moves` offer per seat, for index apply, and nothing older.
No match log. No temp file. Process death loses the match. MCP
does not persist `plan`; that is the BYOK seat.

### Resources

None in v0. The caller can read `docs/byok-teaching.md` from the
repo. Do not serve `conquarrow://spec/byok-teaching` or
`conquarrow://match/observation`.

## Observation contract (the whole point)

`observe` returns a JSON object the spec locks field-by-field.
Do not add a dump. `me` is the seat id on the call, not a living
person.

```
me, activePlayer, winner,
shareCounts, territoryCounts, starvationStreaks,
myGroups, exposedTips,
threatLine,        // P64 sentence, built from these fields
offerTags,         // cut / closes / borders_spawner / dirt-closes
longestEnemyTrail, // {seat, length, sample[]}
spawnersNearTips,  // cap 12, tip-local rank
findings           // P21 kinds; field is move, not step
```

`threatLine` is `threatLineFromCounts` over those fields, so the
sentence and the keys cannot disagree. Not `leadLine`.

Findings are **read-only hints**. The caller still picks a legal
row. A finding cannot create a cut. A finding’s `move` is a step
`legalMoves` would emit for `me`.

Do not ship raw `trails` of every seat as a full arrow list
beyond the sample cap already used in BYOK snapshots.

The board picture may show spawners and territory the JSON caps.
That is looking, not a second observation. JSON tools still must
not return the full spawner array.

## Invariants

- WHILE serving a tool, the server SHALL call `rules-core`
  `legalMoves` / `apply` / end-turn. It SHALL NOT scrape a DOM,
  launch a browser, or shell out.
- WHEN `playerCount` is not 3 or 6, or a kind is not `human` or
  `heuristic`, or the kind list length is not `playerCount`,
  `new_match` SHALL refuse and leave no match.
- WHEN `apply_steps` or `end_turn` names a seat that is not the
  active human seat, the server SHALL refuse and leave state
  unchanged.
- WHEN `play_heuristic_turn` names a seat that is not the active
  heuristic seat, the server SHALL refuse and leave state
  unchanged.
- WHEN `apply_steps` names an illegal step, the server SHALL
  refuse and leave state unchanged — including when an earlier
  step in the same batch was legal. The batch is staged on a
  local state and committed only if every step applies. Same
  `ContractViolation` family the engine already throws — wrap,
  do not swallow.
- WHEN `observe` runs, the payload SHALL NOT include a legal
  step that `legalMoves` would not emit for `me`.
- WHEN `see_board` runs, the SVG SHALL NOT be treated as an
  offer. It SHALL NOT differ between two calls with the same
  state and seat id.
- WHEN two findings tie, reuse P21’s deterministic tie-break.
- No `Math.random` / `Date.now` in observation, findings, or the
  board picture.
- Keys never leave the process. No OpenAI call from this
  package. The caller owns the model. A PNG, if any, is a caller
  step (`magick` on a dev machine). CI must not need it.

## Scenario inventory (phase 1 must write each)

Core:

1. `new_match` seed 1, R=7, 3 seats (human / human / heuristic)
   → observation has three shareCounts of 4/4/3 or the locked
   opening counts for that setup, `winner` null, `activePlayer`
   A, `me` A.
2. `legal_moves` for A’s opening home stack returns numbered
   rows in the BYOK shape, including `spd`; at least one
   `leave_home` and one `home_mill`. A row with `leave > 0`
   prints `leave`.
3. `apply_steps` of one legal opening step changes
   `exposedTips` / trailLen; a second call with the same
   (now-illegal) index is refused and state matches after the
   first apply.
4. `end_turn` on the active human seat advances `activePlayer`.
5. `observe` after a dirt-shaped close (fixture or reconstructed
   3-seat walk) reports `closes` and does **not** invent
   `share+N` when the engine did not award a share. `threatLine`
   contains the P64 dirt clause when the fields say so.
6. `play_heuristic_turn` on the active heuristic seat returns a
   legal move list the engine accepts, then the next seat is
   active. It does not run unless called.
7. Findings list only contains kinds whose `move` is in
   `legalMoves` for `me`.
8. No JSON tool returns the full 58-spawner array. `see_board`
   may show those spawners in the `R`-window.
9. `see_board` returns SVG, not PNG. Two calls with the same
   state and seat id match. A different seat id changes only
   the highlight.

Edge:

10. `apply_steps` on a won match refuses (P38).
11. `new_match` twice: second match id differs; first match is
    gone. No file is left behind.
12. Index form of `apply_steps` is relative to the last
    `legal_moves` for that seat; a stale index after an apply
    is refused.
13. `playerCount` 2 or 4, or a `byok` kind, is refused. State
    is unchanged. The count is not clamped into 2..8.
14. `apply_steps` or `end_turn` on a heuristic seat is refused.
    `play_heuristic_turn` on a human seat is refused. State
    matches before the call.
15. Stdio handshake: tools/list includes the seven names above
    and no resource.

## Non-goals

- Replacing BYOK on Pages.
- Teaching-file edits (P66).
- Temperature / plan echo inside MCP.
- Path-to-enemy search.
- Hosting this server on AWS.
- Multi-match concurrency.
- Lifting `chooseTurnBeam` as the MCP default.
- MCP resources.
- A match log, an offer transcript, or a temp file.
- A server-side bitmap, a vendored rasterizer, or `magick`.
- Storing which human seat is the living person.
- A fourth seat kind for the caller.

## Acceptance

- `pnpm` test in the new package covers core 1–9 without a live
  model and without ImageMagick.
- `pnpm verify` green.
- Packet + spec state in one sentence that this is not a UI
  scrape and not raw `GameState`.
- README / package bin shows the OpenCode stdio one-liner
  (`opencode mcp add` or the repo’s existing convention). Do
  not invent a second config format if the repo already has one.
  There is no MCP convention in the repo today; one stdio
  one-liner is enough.

## Module sketch

```
packages/mcp/package.json
packages/mcp/src/server.ts          // stdio MCP
packages/mcp/src/observe.ts         // seat view + threatLine
packages/mcp/src/see-board.ts       // simple SVG, no React
packages/mcp/src/tools.ts
packages/mcp/test/mcp-observe.test.ts
docs/spec/conquarrow-mcp/
docs/design/packets/P67-conquarrow-mcp.md
docs/adr/0004-mcp-board-picture-is-svg.md
```

Reuse `packages/rules-core` and, if cheap, `packages/web/src/findings.ts`
+ `annotateMove` + `threatLineFromCounts`. If importing web pulls
the renderer, copy the pure helpers into `packages/mcp/src/`
rather than dragging `Board.tsx`. Do not import the React board
to paint `see_board`.

## Handoff checklist

1. Read this packet, ADR 0004, P21 findings kinds (`move`, not
   `step`), P64 threat line, `makeRules` / `legalMoves` / `apply`
   in `rules-core`.
2. `/spec-to-ship docs/design/packets/P67-conquarrow-mcp.md`
   after P66 is on main (it is — `#57`).
3. Paste a P67 index row into `docs/design/02-work-packets.md`
   from `docs/design/packets/_index-rows-P67.md`.
4. Escalate if the MCP SDK forces a rules-core API change, if
   findings cannot be imported without the renderer, or if
   stdio auth disagrees with an existing repo convention.
