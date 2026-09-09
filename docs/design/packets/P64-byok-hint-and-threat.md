# P64 — BYOK: tags are hints, threat line, lump-close baseline, plan echo

**Local agent handoff:** `/spec-to-ship docs/design/packets/P64-byok-hint-and-threat.md`

Phase 1 writes a **new** spec directory
[`docs/spec/byok-hint-and-threat/`](../../spec/byok-hint-and-threat/)
(core + edge-cases `.feature`, mermaid, EARS). Do not burst P15/P61/P62/P63
spec dirs. Do not rewrite P61’s apply-prefix / empty-prefix / `llmHits`
seat-turn loop. Do not touch `chooseTurnBeam`.

**Layer:** `web` adapter (`byokBot.ts`, `docs/byok-teaching.md`) + one
recorded-offer fixture. No `contracts`, `rules-core`, or `online-api`
behaviour change. **No game rule is added, changed, or implied.** Teaching
stays **non-normative**. If it disagrees with SPEC.md, SPEC wins.
`greedy-v1` / `chooseMove` stay frozen as the named *chooser*; this packet
only changes **which offer row the baseline sentence names**, and only when
the offer already carries `closes` / `cut`.

**Depends on P63, P62, P61, P15, P11.** P30 playback unchanged.

**Not this packet:** temperature, offer-filter, hiding `count=1`,
`beam-v1` as hint or offer, runner resurrection, P58/P60, Pages
`chooseTurnBeam`, `evaluate` as an IQ score, MCP, live grok in CI,
path-to-enemy search, inventing a `cut` tag that `annotateMove` would not
already emit. `plan` **is** this packet — not optional, not parked.

## Playtest that named this packet

`conquarrow-match-2026-09-08T18:00:34.723Z` — R=7, seed 1, 3 seats.
A heuristic / B grok-4.6 BYOK (`temperature: 0`, `max_tokens: 4096`,
thinking on) / C human. 16 `chooseLlmMove` POSTs, 8 B seat-turns,
0 fallbacks, 0 cuts, 7 closes, `firstCloseAt` 11 (A’s home close).

Unbiased read of the **requests only** (already established; do not
overwrite with “the code meant X”):

- Model policy: max count on the tagged exit; prefer `closes` > `on_target`
  > `homeward` > `outward`; refuse `home_mill`; spend leftover tempo.
- Tempo / mill teaching worked. The 2026-09-02 peel of `2^k` singletons
  did not recur.
- `on_target` was treated as an **order**. Hits 0–2 walk it outward; hit 2
  raises `tipDist` 4→6 on an open trail.
- B painted a private 8-loop, closed `share+1` (terr 3→14), left home,
  painted another local loop. Shares 4→5→7. C (human) 3→25 terr / 3→18
  shares. A leftover singleton sat on `6,0,1`.
- No offer to B ever carried a `cut` tag. B and C were in different sectors.
- Hit 12 is the first “creative” reply: `[4,0]` = 2 outward
  `borders_spawner` + 1 close, instead of closing the 3-stack.
- Hit 14 closes `share+2` then sends an idle home head out, which produces
  hit 15’s forced pass (only mills offered; the new tip is `spent=1` and
  absent from `LEGAL_MOVES`).
- Observation in every user prompt: `spawnersShown=12` of 58, `groups` =
  heads only, trail samples, no path-to-enemy, no “C just took 18 shares.”
- Reasoning tokens 1.5k–7.4k per offer to re-derive “take the lump.”
  `content` is a slogan `why`.

Temperature is **not** the next knob. Temperature jitters among three
exits; it does not create a cut that is not on the offer, and it re-opens
singleton peeling. `plan` is in this packet because hit 12/14 abandoned a close the offer
still named. Echoing it stops that. It still cannot route toward C if
`LEGAL_MOVES` never contains that walk — that is why observation rank
ships too. `plan` is not the whole fix; it is a required piece.

## 1. How the reply is consumed (quote the code)

`playLlmBotTurn` POSTs once per leftover-tempo offer, up to 64 completions
per seat-turn. Each completion is `parseMoveBatchResult` →
`asUsableBatch` → `applyMappedPrefix` → `afterPrefix`.

Quoted from `packages/web/src/byokBot.ts`:

```ts
const asUsableBatch = (value: unknown): ParsedMoveBatch | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec['endTurn'] !== 'boolean') return undefined;
  const indices = integerIndices(rec['moves']);
  if (indices === undefined) return undefined;
  return { indices, endTurn: rec['endTurn'] };
};
```

- Usable = `moves` is an integer array **and** `endTurn` is boolean.
- Extra JSON keys (`why`, `plan`, `mission`, anything else) are **stripped**.
  They never reach `apply`. `why` is not logged.
- Empty `moves` + `endTurn: true` + no illegal indices → `forceEndTurn`
  (a real pass). That is hit 15.
- Empty `moves` + `endTurn: false`, or unusable text → `greedyRemainder`
  (`chooseTurnGreedy`). Counted as a fallback.
- Nonempty legal prefix + `endTurn: true` (or no remaining steps) →
  `forceEndTurn`. Nonempty prefix + leftover legal steps + `endTurn: false`
  → another POST. That is why 16 POSTs cover 8 B turns.

P61 lock stands. This packet does not change apply-prefix. `plan` is
read **beside** `asUsableBatch`, never instead of it, and is never an
offer index. A missing `plan` key is valid; an empty `moves` +
`endTurn: false` is still a fallback even if `plan` is present.

## 2. Sixteen offers: impossible vs rejected

Same 16 user prompts as
`requests.conquarrow-match-2026-09-08T180034-723Z.json`.

### Impossible — never in `LEGAL_MOVES`

These acts cannot be chosen because no numbered row names them. Prompt
copy cannot create them. Observation must change before the model can
aim at C.

| Act | Why it was absent |
|---|---|
| Cut C | `annotateMove` emits `cut` only when `move.exit` is already on an enemy trail. C’s trail lived around `1,-5` / `3,-7`. B’s exits stayed around `-4,5` … `-5,8`. Zero `cut` tags in 16 offers. |
| Contest `tiling:v:-1,-2,up` | C later holds 1 of 3 shares there. No B legal exit is a border of that vertex. The vertex appears in the lex-first-12 spawner dump as `held: {C:1}` from hit 12 on; it is never a reachable row. |
| Walk toward C’s 8-trail | No legal exit shares C’s sector. Trail samples list C’s arrows; they are not offered as destinations. |

`groups` is heads-on-arrows only. `STATE_JSON` has territory **counts**,
not a map, so the model also cannot reconstruct a path.

### Possible but rejected

| Hit | On the offer | Model played | Note |
|---|---|---|---|
| 2 | Homeward lump `[5]` / `[8]` (`tipDist` 4→3, `trailLen` already 2 ≥ girth−1). Outward `on_target` `[2]` (`tipDist` 4→6). | `[2]` endTurn false — “3-lump outward on_target” | Tag treated as an order. Trail already long enough to close soon; tip is receding. |
| 12 | Full-stack close `[2]` and `[8]` (`closes`, count=3, `tipDist` 1→0). Outward `borders_spawner` `[3]`–`[5]`. Baseline named **`[0]` count=1 close**. | `[4,0]` — 2 outward + 1 close | Creative split abandoned the 3-stack close. Baseline taught the singleton close, not the lump. |
| 14 | Lump close `[8]` (`closes,share+2`) **and** idle home head `[0]` `leave_home`. | `[8,0]` endTurn false | Close is correct; the extra sortie produces hit 15. |
| 15 | Six rows, all `home_mill,onto_home`. New tip `-3,7,0` is `spent=1` / `speed=1` so it has no leftover and is absent from the offer. Baseline named **`[0]` count=1 mill**. | `[]` endTurn true | Correct pass. Keep this. |

Hits 0–1, 3–11, 13 follow the lump / leftover / refuse-mill policy and are
in-policy for what the offer allowed. They do not aim at C because C was
not on the offer.

## 3. Prompt changes (smallest first)

### 3a. Teaching: tags are hints

Add **one short paragraph** under “Close, cut, mill” in
`docs/byok-teaching.md`. Keep every P62/P63 lock (`speed(N) = 1 + floor(log₂ N)`,
inherit `spent`, majority `speed 0`, grain, `3-in / 3-out`, `girth is 3`,
`one seat remains`, `starvation`, no domination / §11 / even-odd /
evaporation front, JSON contract, T1 split-vs-lump numbers, close-vs-cut
two afters, pinwheel 1-share vs 3-share).

Required beats (do not turn them into “prefer X” orders):

- Tags name outcomes. They are not orders.
- `on_target` loses to: an available `closes`, an available `cut`, an
  opponent share/territory lead, `trailLen` already ≥ girth and `tipDist`
  not shrinking.
- Do not invent a tag. Do not treat `borders_spawner` as “walk past the
  close.”

No fourth canned example. No “prefer split.” No “prefer don’t close.”

JSON contract becomes
`{"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}`.
`plan` may be omitted on a one-batch job or a pass. `asUsableBatch`
still ignores it for apply. Teaching and the user-prompt reply line
must show the key so the model knows to write it.

### 3b. User header: one threat line

`buildUserPrompt` already prints seat, `Shares=…`, `trailLen=…`, exposed
tips. Add **one line** immediately after that block, before `STATE_JSON`.

Facts only, computed from the same state the snapshot already has:

```
Lead: C 18 shares / 25 terr; B 5 / 14; A 6 / 5. Longest enemy trail: C 6. Offer tags: closes. No cut/contest/deny row.
```

Rules:

- Name who leads **shares**, then territory, including `me`.
- Name the longest enemy trail owner + length (0 if none).
- Name whether **any** legal step row is tagged `cut`, `closes`,
  `borders_spawner` (contest-ish), or none of those. Do not invent
  `deny` unless `annotateMove` already emits it (it does not today —
  say `No cut/contest/deny row` when no `cut` and no `closes`).
- Deterministic wording. Same state → same line.
- Do **not** dump C’s 8-trail sample again; `STATE_JSON.trails` already
  has it.

This is the line hit 12 lacked: the model closed a private loop while the
header never said “C has 18 shares.”

### 3c. Weak baseline names the lump close/cut

`greedyBaselineLines` currently:

```ts
const chosen = chooseMove(geometry, rules, state, me);
```

On hit 12 that is `[0] count=1` of a `closes` exit. On hit 15 that is
`[0] count=1` of a mill.

Change **only the sentence**, not `chooseMove` itself:

1. Collect offer steps whose `annotateMove` tags include `cut` or
   `closes`.
2. If that set is nonempty, the baseline index is the member with
   **largest `count`**, ties broken by existing offer order (first
   matching index). Sentence still starts
   `A weak one-ply baseline would play \`[i]\`` and still ends
   `Suggestion only`.
3. If that set is empty, keep today’s `chooseMove` index — **except**
   when every step is `home_mill` / `onto_home` with no `closes` / `cut`
   / `leave_home` expansion. Then **omit** the baseline paragraph
   (same as “`chooseMove` is `endTurn`”). Hit 15 must not advertise a mill.

`chooseMove` / `chooseTurnGreedy` / `chooseTurnBeam` bodies are not
edited. Pages still calls `chooseMove`.

### 3d. Persist `plan` and teach how to write it

Required. Not the whole fix. Do not drop this section from the PR.

**Teaching file — new `## Plan` section** (after JSON contract). Locked
beats; no prefer-orders:

- `plan` is one clause naming the job this seat is still on after this
  batch (close this trail, walk the tagged cut, spend leftover on the
  same exit). Not an offer index. Not geometry. Not a second `why`.
- Write it when the job needs another POST or another seat-turn. Omit
  it on a pass (`[]` + `endTurn: true`) or when this batch finishes the
  job (close lands, trailLen will be 0).
- Keep it under ~80 characters, one line, no invented destinations.
- Rewrite when the job is done, when this offer no longer contains that
  walk, or when the threat line shows a `cut` / `closes` that beats the
  old job.
- The echoed `Plan:` line is a reminder, not an order. `LEGAL_MOVES`
  still binds. A plan cannot create a cut that is not a row.
- Do not put indices in `plan` (`close the 3-stack` not `play [2]`).
  Indices go stale on the next offer.

Worked contrast, compact, no fourth full example:

```
Hit 12 shape. Offer has count=3 closes [2] and [8].
Good: {"moves":[2],"endTurn":true,"why":"lump close","plan":"close the open trail"}
Bad:  {"moves":[4,0],"endTurn":false,"why":"split for spawner"}  // abandoned the close; no plan
```

**User prompt**

- Reply line becomes:
  `Reply with only JSON: {"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}`
- If this seat has a stored plan, print `Plan: <text>` as its own line
  under the threat line, before `STATE_JSON`. Cap 80 chars, strip
  newlines. Omit the line when the store is empty.
- Do not print `Plan:` as an order. Facts only.

**Adapter**

- After a usable batch, if `plan` is a nonempty string, store it on a
  per-seat map keyed by `PlayerId`. If `plan` is `""` or the reply is a
  pass (`[]` + `endTurn: true`), clear the seat’s plan.
- If the key is absent, keep the previous plan (hit 13 should still see
  hit 12’s “close the open trail” if the model forgot the key).
- Clear the map when a new local match starts (export
  `clearByokPlans()` and call it from the existing new-match path in
  `App.tsx` / lobby start — one call, no `localStorage`, no match-log
  field).
- Apply path still only reads `moves` + `endTurn`. A reply with only
  `plan` and empty `moves` + `endTurn: false` is still a fallback.

**Tests**

- Extra key does not break `asUsableBatch`.
- Echoed plan is truncated to 80 and has no newline.
- Missing `plan` keeps the previous echo.
- `""` or pass clears the echo.
- `clearByokPlans()` drops the line on the next prompt.
- Hit 12 expected batch includes
  `"plan":"close the open trail"` (or the locked fixture phrase).
- Hit 15 expected batch omits `plan` or sends `""`.

## 4. Observation — only because step 2 showed C was unreachable

Candidate, tiny:

1. **Spawners near *my tips*, not lex-first 12 interesting.**
   `snapshotForPrompt` already filters to mine / contested / fully
   unclaimed, then takes the first `MAX_SPAWNER_ROWS` in vertex-id
   order. That is why the dump is a belt of `-1,*` / `-2,*` centre
   vertices and not the pinwheel B is standing on.
   Re-rank the interesting list: spawners whose `borderArrows` include
   a current `me` group arrow, or a current legal `exit`, first; then
   the rest. Still cap at 12. Still no 58-row dump.
2. **Mark an enemy trail that shares a vertex with any legal exit.**
   `cut` already means “this exit *is* the enemy trail.” Add a header
   clause or a row tag `near_trail:<seat>` when
   `geometry.origin(exit)` or `geometry.target(exit)` equals
   `origin`/`target` of any enemy-trail arrow, and it is not already
   `cut`. Facts only. If no legal exit shares a vertex, say so on the
   threat line (`no enemy trail on a legal vertex`).

Do **not** compute a path-to-C. Do not add findings. Do not call
`chooseTurnBeam`.

If (2) needs new geometry thinking beyond `origin`/`target`, ship (1)
alone and park (2) as a sentence in Escalate-if.

## 5. Temperature

Not this packet. After a later playtest where the mission is chosen
(close the open trail / cut the tagged row / walk the `near_trail`
exit) **and** the model still picks the wrong one of two equal tagged
exits, then jitter. Not on the raw untagged row list.

## 6. Fixtures

Recorded offers live at
`docs/design/fixtures/P64-hit12-hit15.json`
(copied from the 2026-09-08T18:00:34Z requests; not live grok).

### Hit 12 — expect a full-stack close

Offer (condensed): one group, 3 heads on `-5,7,0`, `spent=0`, `trailLen=3`,
`tipDist=1`.

- `[0][1][2]` close homeward onto `-4,7,0` (count 1/2/3)
- `[3][4][5]` outward `borders_spawner` onto `-4,7,1`
- `[6][7][8]` close homeward onto `-4,7,2` (count 1/2/3)

Recorded reply: `{"moves":[4,0],"endTurn":false,...}` — **wrong for this
packet’s contract**.

Expected: a batch whose first (or only) index is a **count=3 close** —
`[2]` or `[8]`. `endTurn` true or false is accepted (leftover after a
close may mill-only on the next POST). `[4,0]` fails the fixture.

The fixture does **not** call grok. It asserts:

- reconstructed baseline sentence names `[2]` or `[8]`, not `[0]`;
- threat line mentions C’s share lead (18 vs B 5) and that the offer
  carries `closes`;
- teaching body contains the “tags are not orders” / `on_target` loses
  to close beats;
- a helper used by tests, `isFullStackClose(batch, offerTags)`, is true
  for `{moves:[2], endTurn:true}` and false for `{moves:[4,0],...}`.

Replaying the recorded user prompt through `buildUserPrompt` requires a
real `GameState`. If reconstructing territory from the compact snapshot
is too lossy, assert against the **recorded legal rows + new helpers**
(`baselineIndexFromTags`, `threatLineFromCounts`) and keep the JSON as
the scenario’s Given. Do not invent a tiling for CI.

### Hit 15 — expect `[]` endTurn

Offer: two B groups; tip `-3,7,0` spent out; only `-4,8,2` can walk;
six rows, all `home_mill,onto_home`.

Recorded reply: `{"moves":[],"endTurn":true,...}` — **correct**.

Expected: `moves: []`, `endTurn: true`. Baseline paragraph **omitted**.
Threat line may still mention C’s lead. A mill baseline `[0]` fails the
fixture.

## Scenario inventory (phase 1 must write each)

Core:

1. Teaching file contains the tags-are-hints paragraph and still contains
   every P62/P63 lock; still has no domination / §11 / even-odd /
   evaporation front.
2. `buildUserPrompt` prints one threat line with share lead, longest
   enemy trail, and whether the offer has `cut` / `closes`.
3. Same state → same threat line (determinism).
4. When the offer has a `closes` or `cut` row, the baseline sentence
   names the **largest count** on that tagged exit, not `chooseMove`’s
   count=1. Hit 12 shape: baseline is `[2]` or `[8]`, not `[0]`.
5. When every offered step is a non-expanding mill, the baseline
   paragraph is omitted. Hit 15 shape.
6. Hit 12 fixture: `{moves:[2], endTurn:true}` (or `[8]`) passes
   `isFullStackClose`; recorded `{moves:[4,0], endTurn:false}` fails.
7. Hit 15 fixture: `{moves:[], endTurn:true}` is the expected batch;
   a mill index is not.
8. `asUsableBatch` still strips extra keys. `why` / `plan` do not affect
   apply-prefix. P61 empty-prefix / illegal-tail tests stay green.
9. `chooseTurnBeam` / P53 shuttle tests untouched. Pages still imports
   `chooseMove`.

Edge:

10. Threat line with tied shares: stable seat order (`state.players`).
11. No enemy trail → “Longest enemy trail: none” (or equivalent locked
    phrase).
12. `plan` echo: stored string is truncated and printed as `Plan:`;
    missing key keeps the previous plan; `""` or pass clears it;
    `clearByokPlans()` drops the line; `plan` is never an offer index.
13. Spawner dump prefers vertices incident to my groups / legal exits
    over lex-first interesting (if 4.1 ships). Cap remains 12.
14. No `Date` / `Math.random` / `performance.now` in the prompt builder
    except the existing fetch on play.

## Non-goals

- Temperature.
- Offer-filter / hiding singletons.
- Scoring the model with `evaluate` / `chooseTurnBeam`.
- Asserting a live model pick (no grok in CI).
- Unfreezing `greedy-v1`.
- Path-to-enemy / MCP / worker / personalities.

## Acceptance

- Hit 12 fixture helpers name a count=3 close as the baseline and reject
  `[4,0]` as a full-stack close. Expected batch includes a `plan` clause
  about closing the open trail.
- Hit 15 fixture helpers expect `[]` + `endTurn`, omit a mill baseline,
  and clear `plan`.
- Threat line present on a multi-seat snapshot that has uneven shares.
- Teaching contains `## Plan` and the JSON contract with a `plan` key;
  still syncs to SPEC locks.
- P61/P62/P63 protocol tests still pass.
- `pnpm verify` green.

## Module sketch

```
docs/byok-teaching.md                       // + tags-are-hints + ## Plan
docs/design/fixtures/P64-hit12-hit15.json   // recorded offers + expected batches
packages/web/src/byokBot.ts                 // threat line; baseline by tag+count;
                                            // plan store + echo; spawner rank
packages/web/src/App.tsx                    // clearByokPlans on new match
packages/web/test/byok-hint-and-threat.*.ts
docs/spec/byok-hint-and-threat/             // phase 1
```

## Why header + baseline + plan together

Hit 12 had the close on the offer and still split off it. The baseline
named the singleton. The header never said C was winning. Those two
lines use facts already computed for tags. A `plan` echo stops the
*next* POST from abandoning the close (hit 14’s idle-home sortie after
`share+2`). None of the three can put C’s trail onto the offer.
Observation rank / near-trail is the only change that can eventually
surface a cut, and only when an exit actually shares a vertex.

## Handoff checklist

1. Read this packet, the 2026-09-08T18:00:34Z requests/responses/match
   JSON, P62/P63, `asUsableBatch` / `greedyBaselineLines` /
   `snapshotForPrompt` in `byokBot.ts`. Do not edit `chooseTurnBeam`.
2. `/spec-to-ship docs/design/packets/P64-byok-hint-and-threat.md`
3. P64/P65 index rows are in `docs/design/02-work-packets.md` on this branch.
4. Escalate if teaching prose would add a game rule, if baseline wants
   to call `chooseTurnBeam`, or if near-trail tagging needs more than
   `origin`/`target`.
5. Do not open temperature, offer-filter, or P58/P60 in the same ship PR.
   P65 is a separate `/spec-to-ship` on the same handoff branch.

## Escalate-if

- Temptation to put “Prefer closes” back in the user prompt (that is an
  order; 3a is the hint paragraph + 3c is the baseline).
- Temptation to filter `count=1` off a close exit.
- Reconstructing a full `GameState` from `STATE_JSON` for the fixture
  looks necessary — use the recorded rows + helpers instead.
- Near-trail tagging needs `flankVertices` / a search. Ship 4.1 only.
