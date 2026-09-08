# P63 — BYOK thinking on, split/share teaching, token totals

**Local agent handoff:** `/spec-to-ship docs/design/packets/P63-byok-thinking-teach.md`

Phase 1 writes a **new** spec directory
[`docs/spec/byok-thinking-teach/`](../../spec/byok-thinking-teach/)
(core + edge-cases `.feature`, mermaid, EARS). Do not burst P61/P62/P53
spec dirs. Do not rewrite P61’s apply-prefix / empty-prefix / `llmHits`
seat-turn loop.

**Layer:** `web` adapter (`byokBot.ts`, `byokConfig.ts`, `matchLog.ts`) +
`docs/byok-teaching.md`. No `contracts`, `rules-core`, or `online-api`
behaviour change. **No game rule is added, changed, or implied.** The
teaching file stays **non-normative** (SPEC.md §1 pointer already exists;
do not add a second). If teaching disagrees with SPEC.md, SPEC wins.
`greedy-v1` / `chooseMove` stay frozen (P62 baseline hint unchanged).

**Depends on P62, P61, P15, P11.** P30 playback unchanged.

**Not this packet:** offer-filter, enumerated turn plans, `beam-v1` as
hint or offer, runner, P58/P60, Pages `chooseTurnBeam`, `evaluate` as an
“IQ” score, per-completion log rows, in-app graph/HUD chart, P43 lesson
import, live grok in CI, a fourth canned example, prefer-orders
(`prefer split`, `prefer don’t close`).

## Playtest that named this packet

`conquarrow-match-2026-09-08T06:00:52.500Z` — R=7, seed 1, 3 seats.
A heuristic / B grok-4.6 BYOK / C human. `llmHits: 3`, `llmFallbacks: 0`,
`cuts: 0`, `closes: 1` (A’s, `firstCloseAt: 11`).

B never split. Six steps, all `count=3`:

```
-4,5,1 → -5,6,0 → -4,6,0 → -3,6,0 → -2,6,1 → -3,7,1 → -4,8,2
```

Last screenshot: the `3` sits on **one** border of a spawner pinwheel,
trail back to a small home blob. Homeward close from there paints the
path and **one** share. One more SE around the pinwheel is the other two
borders — **three** shares (SPEC §2 girth-3 triangle = one vertex = three
border arrows).

Model `why` (five completions; thinking forced **off**):

```
"full stack, last step outward on_target"
"lump of 3 outward on_target; spd2 so continue"
"all 3 homeward on_target; 1 step left"
"full stack homeward toward close; keep remaining tempo"
"full count-3 one step homeward (tipDist 4→3, borders_spawner); spent 1/spd 2 so turn done"
```

The last `why` is a **rules error**: `spent=1`, `spd=2` ⇒ **one step
left**, not turn done. `reasoning_content` was boilerplate (“The user
wants me to play Conquarrow as seat B”) — not position reasoning.

## Why P62 caused this

P62 removed T0/`via count=`/`Prefer on_target` (correct). Its T1 example
ends **Play `[2]`**. Combined with “send a `2^k` lump as one count”, B
learned **never split**. SPEC §3 says the opposite for throughput:

| a fresh 3-stack | tiles this turn |
|---|---|
| moves as one (`count=3`, speed 2) | **2** |
| splits **2+1 before walking** | **3** (pair speed 2 + singleton speed 1) |
| three `count=1` peels | 3 tiles but wastes the pair’s extra step as three POSTs / three peels — still legal; teaching must not hide them |

P61 forced `enable_thinking: false` even when the lobby **Reasoning**
checkbox is on. That checkbox only flips 512 vs 64 tokens and the role
line. Nemotron had dumped CoT into `content`, hit
`finish_reason=length`, returned no JSON → empty prefix → greedy. Grok-4.6
puts CoT in `reasoning_content` and JSON in `content`, so that failure
mode is weaker — but **512 cannot hold think+JSON**.

`share` on a LEGAL_MOVES row is boolean (`gainedShare > 0`). A 1-share
land-bridge and a 3-share pinwheel look the same. `borders_spawner`
means the **exit** touches an open spawner, not “this close takes 3”.

The human does **not** want prefer-orders. The model must **see the
rules** (teaching + row facts) and **be allowed to think**.

## What is not the fix

- “Prefer split” / “prefer don’t close yet” / bringing back TARGETS.
- Dumping SPEC fill, evaporation fronts, §11.
- Offer-filter / hiding `count=3`.
- Scoring the model with `evaluate` / `chooseTurnBeam` (grades it against
  the heuristic).
- An in-app chart. Graph = downloaded match JSON after several playtests.
- Raising tokens again in this packet after 4096. Next bump only if
  `lengthOuts` / `completionTokens` show the cap binding.

## What ships

### 1. Thinking follows the lobby flag

`byokCompletionBody`:

- `config.reasoning === true` → `BYOK_THINKING_ON`, `max_tokens = 4096`
  (`BYOK_REASONING_MAX_TOKENS`, retarget this constant; update tests that
  pin 512).
- `config.reasoning === false` → `BYOK_THINKING_OFF`, `max_tokens = 64`
  (unchanged).

Keep sending both `chat_template_kwargs` and `extra_body.chat_template_kwargs`
(NVIDIA + xAI). `temperature: 0`, `response_format: json_object` stay.

**`testByokConnection`:** still the tiny `{"move":0,"why":"probe"}`
probe. Thinking **off**, small token budget. Do not spend 4096 on a
lobby ping.

### 2. Parse: last usable batch object

P61 fence-strip + whole-string `JSON.parse` is **not** enough once
thinking can put an essay in `content`.

`parseMoveBatch` / a helper used by it:

1. `extractReplyText` unchanged: non-empty `content`, else
   `reasoning_content`.
2. Strip one optional wrapping markdown fence (P61).
3. Find JSON objects in that string. Walk **last to first**. First
   **usable batch** wins: non-null object, `moves` is an array of
   integers, `endTurn` is boolean. Extra keys ignored. `why` ignored for
   control flow.
4. If none → unusable → empty prefix → greedy remainder (P61).
5. Still **one POST**. No extract-retry completion. No digit harvest.

**Usable** is the P61 batch contract, not “any `{`”. A CoT example object
that is not a batch is skipped. If a later usable batch exists, it wins.

**`salvageParses`:** +1 on a completion whose **whole-string** parse
failed but a nested/last usable batch succeeded. Whole-string success
(typical Grok JSON-in-`content`) does **not** increment salvage.

### 3. `byokStats` totals (no per-completion rows)

Extend `ByokRunStats` (aggregate **and** per-seat). Old logs: missing
fields read as **0**. `withByokStats` **adds** the numeric fields
(same as hits/fallbacks). `maxTokens` on a delta is the config value
used for that seat-turn’s POSTs; persist **max** (or the config value)
on the aggregate — one match, one budget. Recommended:

| Field | Meaning |
|---|---|
| `promptTokens` | sum of `usage.prompt_tokens` when the field is a number |
| `completionTokens` | sum of `usage.completion_tokens` when a number |
| `lengthOuts` | completions whose `finish_reason` is `length` (or vendor synonym) |
| `salvageParses` | nested-batch recoveries (above) |
| `maxTokens` | `BYOK_REASONING_MAX_TOKENS` or `BYOK_FAST_MAX_TOKENS` as sent |

If `usage` / `finish_reason` is absent, skip (treat as 0). Never log
secrets, raw `content`, or `reasoning_content`.

**Hits** still mean “this seat-turn never took empty-prefix greedy”.
Salvage that yields a nonempty legal prefix is a **hit**. A length-out
that still salvages JSON can increment **both** `lengthOuts` and still
be a hit. Length-out + unusable text → fallback, `lengthOuts` +1.

No HUD graph. Existing HUD hits/fallback line may stay. Reviewers
compare playtests by downloading JSON:

- `lengthOuts` / `completionTokens` vs `maxTokens` → was 4096 enough?
- `salvageParses` / `llmFallbacks` → is last-JSON salvage doing work?
- Human read of `moves` (did B split? share count?) → play quality.
  Do **not** add an `evaluate` score.

### 4. Teaching file (`docs/byok-teaching.md`)

Keep P62 locks (win / grain / `3-in / 3-out` / `girth is 3` /
`speed(N) = 1 + floor(log₂ N)` / inherit `spent` / majority `speed 0`
/ `one seat remains` / `starvation` / no `domination` / no `§11` /
no `even-odd` / no `evaporation front` / JSON contract).

**Tempo section — rewrite T1 punchline.** Must still say don’t peel
three `count=1` as three POSTs. Must **not** say “Play `[2]`” as the
only good answer. Required beats (SPEC §3 table, 3-stack numbers):

- Same `(from, exit)`: `[0] count=1`, `[1] count=2`, `[2] count=3`.
- Lump `count=3` walks **2** tiles this turn (`speed(3)=2`).
- Split **2+1 before walking**: pair walks 2, singleton walks 1 → **3**
  tiles. Splitting is a decision **before** you walk; after the lump
  both parts inherit `spent`.
- Three `count=1` is legal (P61 offer unfiltered) but is the same
  singleton throughput without the pair’s extra step.

**New example — pinwheel 1-share vs 3-share.** Compact snapshots
(groups/trails/share counts, not 58 spawners). Shape matches
close-vs-cut: **Before**, two indices, **After 1-share** / **After 3-share**.
Faithful to SPEC: girth-3 pinwheel encloses exactly one spawner vertex;
three border arrows are three **shares**. Homeward close that only
claims the trail + one border → 1 share. Walking the other two borders
then landing → 3 shares. Do not invent *N* for starvation. Do not
say “prefer the 3-share line” — show `apply(state, move) → state` and
the share counts.

**Keep** the close-vs-cut example (two afters). Three examples total.
No P43 lesson ids.

### 5. LEGAL_MOVES row facts

- When `gainedShare > 0`, tag **`share+N`** (N = that delta), not boolean
  `share`. Omit if 0.
- Every step row: **`left=K`** where `K = portionSpd - spent` (same
  integers already printed as `spd` / `spent`). Legend may keep
  “steps left this turn = spd-spent”; the per-row `left=` is what T3
  inverted.

Do not add prefer-orders. `on_target` stays a tag (exit match, ignores
count). P62 phase line, no TARGETS block, optional `chooseMove`
baseline — unchanged.

`annotateMove` already computes `gainedShare`. Do not call `beam-v1`
for a share hint.

## Scenario inventory (phase 1 must write each)

Core:

1. `config.reasoning === true` → request has `enable_thinking: true` and
   `max_tokens === 4096`.
2. `config.reasoning === false` → thinking off, `max_tokens === 64`.
3. `testByokConnection` still probe, thinking off, not 4096.
4. Teaching T1 no longer says Play `[2]` as the only answer; contains
   split 2+1 = 3 tiles vs lump = 2; still lists `[0] count=1` …
   `[2] count=3`.
5. Pinwheel example: Before + After 1-share + After 3-share in teaching
   file and thus in `buildSystemPrompt`.
6. Close-vs-cut example still present.
7. A step that gains 2 shares is tagged `share+2`, not bare `share`.
8. Step rows contain `left=` equal to `spd - spent`.
9. `parseMoveBatch` on `essay…\n{"moves":[1],"endTurn":true}` then a
   second batch object uses the **last** usable one.
10. Whole-string JSON still parses (Grok path); `salvageParses` stays 0.
11. Unusable text (no batch object) → empty prefix → greedy, fallback.
12. P61 illegal-tail / empty-prefix / lump apply still green.

Edge:

13. Missing `usage` / `finish_reason` → token fields 0, not a throw.
14. Old match log without new fields loads; fold treats them as 0.
15. `finish_reason: length` increments `lengthOuts`; if last-JSON still
    usable and prefix nonempty, still a hit.
16. Salvage +1 only when whole-string parse failed and nested batch
    succeeded.
17. Pages still `chooseMove`; `opponent.ts` unscored; no `Date` /
    `Math.random` / `performance.now` in parse/prompt/stats fold.
18. Teaching sync: P62 locked phrases still present; still no
    `domination`; T1 must **not** require the old “Play `[2]`”
    assertion (update P62 tests that pin that punchline).
19. `byok-teaching-prompt` / P61 tests that pin `enable_thinking: false`
    unconditionally must be updated to the flag split — do not leave
    two live thinking contracts.

## Non-goals

- Per-completion array, HUD graph, `evaluate` score.
- Offer-filter, `beam-v1` hint, unfreezing greedy.
- SPEC.md game-rule edits (pointer already there).
- Asserting grok walks the pinwheel (no live model in CI).
- Changing 4096 in this PR after playtest — new packet if logs say so.

## Acceptance

- Reasoning-on POST: thinking on, 4096.
- Reasoning-off POST: thinking off, 64.
- Probe unchanged.
- Teaching: three examples; T1 split-throughput; pinwheel 1 vs 3; no
  Play-`[2]`-only; no domination; P62 SPEC locks kept.
- Rows: `share+N`, `left=`.
- Last usable batch JSON; salvage counter; token totals on `byokStats`.
- P61 apply loop green. `pnpm verify` green.

## Module sketch

```
docs/byok-teaching.md                 // T1 rewrite + pinwheel example
packages/web/src/byokBot.ts           // thinking flag, 4096, last-JSON,
                                      // share+N, left=, usage fold
packages/web/src/matchLog.ts          // ByokRunStats new fields
packages/web/test/byok-thinking-teach.*.test.ts
```

P62 tests that assert “Play `[2]`” or unconditional thinking-off **must
move** with this packet (same PR). Do not leave them red or skip them.

## Why thinking + teaching, not prefer-orders

P61 turned thinking off to save JSON. This log shows the cost: tag
pattern-match, never split, invert `spd-spent`, close 1 share. 4096 +
lobby-true thinking is the reasoner. Teaching must stop saying Play
`[2]`. Rows must print share **delta** and **remaining** steps. Prefer
lines would recreate P62’s T0 failure.

## Handoff checklist

1. Read this packet, P61 BSSN (parse, prefix, hits), P62 BSSN (teaching
   file, no prefer, no TARGETS), playtest `2026-09-08T06:00:52.500Z`,
   SPEC §2 girth-3 / §3 speed table / §9 starvation (do not invent *N*).
2. `/spec-to-ship docs/design/packets/P63-byok-thinking-teach.md`
3. Escalate if teaching would add a game rule, if last-JSON salvage
   turns into a second POST, or if someone wants `evaluate` as quality.
4. Do not open offer-filter, P58, P60 in the same PR.

## Escalate-if

- Temptation to write “prefer split” or “prefer the 3-share close”.
- Temptation to parse digits / retry completions.
- Temptation to log `reasoning_content` or the API key.
- Token budget above 4096 in this packet without `lengthOuts` evidence.
