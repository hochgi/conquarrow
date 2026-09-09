# byok-hint-and-threat — tags are hints, threat line, lump-close baseline, plan echo

**Packet:** [P64 — BYOK: tags are hints, threat line, lump-close baseline, plan echo](../../design/packets/P64-byok-hint-and-threat.md)
**Depends on:** P63, P62, P61, P15, P11. P30 playback unchanged.
**SPEC:** read [§1](../../../SPEC.md) (existing non-normative teaching pointer
only — **do not add a second**), [§2](../../../SPEC.md) (grain, 3-in / 3-out,
girth 3), [§3](../../../SPEC.md) (`speed(N)`, inherit `spent`). **No game rule
is added, changed, or implied.** Teaching stays **non-normative**. If it
disagrees with SPEC.md, SPEC wins. Nothing is owed to SPEC §11.
**Layer:** `packages/web` adapter (`byokBot.ts`, `App.tsx`) +
`docs/byok-teaching.md` + one recorded-offer fixture. No `contracts`,
`rules-core`, or `online-api` behaviour change. `greedy-v1` / `chooseMove`
stay frozen as the named *chooser*; this packet only changes **which offer
row the baseline sentence names**, and only when the offer already carries
`closes` / `cut`.
**Features:** [core](./byok-hint-and-threat.core.feature) ·
[edge cases](./byok-hint-and-threat.edge-cases.feature)

**Counts:** 22 scenarios (10 core, 12 edge) · 22 invariants · 0 deferred ·
0 SPEC §11 items.

Do not burst [byok-batch-turn](../byok-batch-turn/byok-batch-turn.md),
[byok-teaching-prompt](../byok-teaching-prompt/byok-teaching-prompt.md),
[byok-thinking-teach](../byok-thinking-teach/byok-thinking-teach.md), or
[bot-turn-search](../bot-turn-search/bot-turn-search.md). Do not rewrite
P61’s apply-prefix / empty-prefix / `llmHits` seat-turn loop. Do not touch
`chooseTurnBeam`.

## Purpose

Playtest `conquarrow-match-2026-09-08T18:00:34.723Z` (R=7, seed 1, 3 seats:
A heuristic / B grok-4.6 BYOK / C human) never saw a `cut` on B’s offer.
`on_target` was treated as an order. Hit 12 had a count=3 `closes` on the
offer and the model played `[4,0]` (2 outward + 1 close) because the weak
baseline named `[0]` count=1 and the header never said C led shares. Hit 15
correctly passed a mill-only leftover; the baseline must stop advertising
that mill.

This packet changes **prompt facts and one store**: tags-are-hints teaching,
one threat line, a lump-close/cut baseline sentence, a `plan` echo, and
spawner-row rank / near-trail tags so observation is not lex-first-12 of
the centre belt. Apply-prefix is untouched. Temperature is not this packet.

## Scope

In: `docs/byok-teaching.md` (one paragraph under “Close, cut, mill”; JSON
contract `plan` key; new `## Plan`); `buildUserPrompt` threat line + plan
echo + reply line; `greedyBaselineLines` **sentence** (not `chooseMove`);
per-seat plan map + `clearByokPlans()` on new match; `snapshotForPrompt`
interesting-spawner rank; `annotateMove` `near_trail:<seat>` via
`origin`/`target`; fixture
`docs/design/fixtures/P64-hit12-hit15.json`; helpers
`threatLineFromCounts`, `baselineIndexFromTags`, `isFullStackClose`.

Out: temperature; offer-filter / hiding `count=1`; `beam-v1` as hint or
offer; runner; P58/P60; Pages `chooseTurnBeam`; `evaluate` as an IQ score;
MCP; live grok in CI; path-to-enemy search; inventing a `cut` or `deny` tag
that `annotateMove` would not already emit; unfreezing `greedy-v1`;
SPEC.md game-rule edits; a second SPEC.md teaching pointer; bursting
P61/P62/P63/P53 feature files; P65.

## BSSN (recorded)

Adapter / docs decisions, not game rules. Written here so phases 2–4 do not
re-litigate them. No SPEC §11 item.

### 1. Teaching: tags are hints (not orders)

Add **one short paragraph** under `## Close, cut, mill` in
`docs/byok-teaching.md`. The existing sentence “Tags on the offer name
outcomes … they are not orders” may stay or be folded into the new
paragraph. Required beats — do **not** turn them into “prefer X” orders:

- Tags name outcomes. They are not orders.
- `on_target` loses to: an available `closes`, an available `cut`, an
  opponent share/territory lead, `trailLen` already ≥ girth and `tipDist`
  not shrinking.
- Do not invent a tag. Do not treat `borders_spawner` as “walk past the
  close.”

Keep every P62/P63 lock (verbatim where those packets required them):

| Lock | Exact substring |
|---|---|
| Speed | `speed(N) = 1 + floor(log₂ N)` |
| Split inherit | `On a split, both parts inherit` and `spent` in that sentence |
| Majority bar | `majority` and `speed 0` |
| Grain | `follows the grain` |
| Points | `3-in / 3-out` |
| Girth | `girth is 3` |
| Board | `unbounded` |
| Win | `one seat remains` |
| Starvation | `starvation` |
| JSON | `"moves"` and `endTurn` |

Still required: P38 “won match offers nothing”; loop
`risk heads → take territory → hold specials → make heads`; `2^k` lump;
T1 split-vs-lump numbers (`[0]` count=1, `[1]` count=2, `[2]` count=3,
lump walks 2, split 2+1 walks 3, no peel-three-POSTs); close-vs-cut
`Before` / `After close` / `After cut`; pinwheel `After 1-share` /
`After 3-share`; no `Play [2]`.

**Forbidden** (any case for domination): `domination`; `§11`; `even-odd`;
`evaporation front`; P43 ids `L0`–`L7`; prefer-orders (`prefer split`,
`prefer don’t close`, `prefer the 3-share`, `Prefer closes` as an order).
No fourth canned example.

### 2. JSON contract includes `plan`

Teaching JSON contract becomes:

```
{"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}
```

`plan` may be omitted on a one-batch job or a pass. `asUsableBatch` still
ignores it for apply. Teaching **and** the live user-prompt reply line must
show the key.

Live reply line (exact):

```
Reply with only JSON: {"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}
```

The live user prompt shall not contain `prefer ` (trailing space,
case-insensitive) and shall not contain `via count=` or a `TARGETS`
heading (P62). Do **not** put “Prefer closes” in the user prompt — 3a is
the hint paragraph and 3c is the baseline sentence.

### 3. Teaching `## Plan` (required)

New section **after** JSON contract, before Close vs cut. Locked beats; no
prefer-orders:

- `plan` is one clause naming the job this seat is still on after this
  batch (close this trail, walk the tagged cut, spend leftover on the same
  exit). Not an offer index. Not geometry. Not a second `why`.
- Write it when the job needs another POST or another seat-turn. Omit it
  on a pass (`[]` + `endTurn: true`) or when this batch finishes the job
  (close lands, trailLen will be 0).
- Keep it under ~80 characters, one line, no invented destinations.
- Rewrite when the job is done, when this offer no longer contains that
  walk, or when the threat line shows a `cut` / `closes` that beats the
  old job.
- The echoed `Plan:` line is a reminder, not an order. `LEGAL_MOVES` still
  binds. A plan cannot create a cut that is not a row.
- Do not put indices in `plan` (`close the 3-stack` not `play [2]`).

Worked contrast, compact, no fourth full example — required substrings:

```
Hit 12 shape. Offer has count=3 closes [2] and [8].
Good: {"moves":[2],"endTurn":true,"why":"lump close","plan":"close the open trail"}
Bad:  {"moves":[4,0],"endTurn":false,"why":"split for spawner"}  // abandoned the close; no plan
```

### 4. Threat line (one line, facts only)

`buildUserPrompt` already prints seat, `Shares=…`, `trailLen=…`, exposed
tips. Add **one line** immediately after that block, before `STATE_JSON`
(and before an optional `Plan:` line).

Exported helper `threatLineFromCounts` is the live wording. Same inputs →
same string. Do not dump an enemy trail sample; `STATE_JSON.trails`
already has it.

Inputs: `me`, `players` (`state.players` as printed ids), per-seat
`shares` and `territory` counts, per-seat `trailLen`, the set of tags
present on any **this-offer** step (`cut` / `closes` / `borders_spawner`
from `annotateMove`), and whether any legal exit shares a **point** with
an enemy-trail arrow (BSSN 10).

**Lead clause.** Every seat including `me` is listed. Sort: shares
descending, then territory descending, then `state.players` index
(stable). First seat: `{id} {shares} shares / {terr} terr`. Later seats:
`{id} {shares} / {terr}`. Prefix `Lead: `; join with `; `.

**Longest enemy trail.** Among seats ≠ `me`, take max `trailLen`. Ties:
first in `state.players`. If that max is 0 or there is no enemy:
`Longest enemy trail: none`. Else: `Longest enemy trail: {id} {n}`.

**Offer-tag clause.** Let `named` be those of `cut`, `closes`,
`borders_spawner` that appear on any offer step, in that order. If
`named` is nonempty: `Offer tags: {named joined by ", "}`. If there is
**no** `cut` and **no** `closes`: also `No cut/contest/deny row` (even
when `borders_spawner` is present). Do **not** invent a `deny` tag —
`annotateMove` does not emit `deny`.

**Near-trail clause.** If no legal offer exit shares a point with any
enemy-trail arrow: `no enemy trail on a legal vertex`. If some do, omit
that phrase (the LEGAL_MOVES row carries `near_trail:<seat>`).

Join clauses with `. ` (period-space). Deterministic. No `Date` /
`Math.random` / `performance.now`.

Hit 12 counts (documentary; helper tests use the fixture JSON): C 18
shares / 25 terr, B 5 / 14, A 6 / 5; longest enemy trail C 6; offer has
`closes` (and `borders_spawner`); no `cut`.

### 5. Weak baseline names the lump close/cut

Change **only the sentence**, not `chooseMove` / `chooseTurnGreedy` /
`chooseTurnBeam` bodies. Pages still imports `chooseMove`.

Exported `baselineIndexFromTags(rows)`: among offer steps whose
`annotateMove` tags include `cut` or `closes`, return the member with
**largest `count`**, ties broken by existing offer order (smallest
index). `undefined` if that set is empty.

`greedyBaselineLines`:

1. If `baselineIndexFromTags` returns an index `i`, the sentence still
   starts `A weak one-ply baseline would play \`[i]\`` and still ends
   `Suggestion only — you may return any ordered indices from this offer.`
   Fill `count` / `from` / `exit` from **that** step, not from
   `chooseMove`.
2. If the set is empty, keep today’s `chooseMove` index — **except**
   mill-omit (3).
3. **Mill-omit:** when every offered step’s tags include `home_mill` or
   `onto_home`, and none include `closes`, `cut`, or `leave_home`, omit
   the baseline paragraph (same as “`chooseMove` is `endTurn`”). Hit 15
   must not advertise a mill. Empty offer / omitted `rules` /
   `chooseMove` is `endTurn` / chosen step not in the offer: still omit
   (P62).

Do not call `chooseTurnBeam` / `evaluate` for this hint. Do not filter
`count=1` off a close exit. Do not edit `opponent.ts` scoring.

P62 invariant 5 (baseline is `chooseMove`’s in-offer step) **holds when
the closes/cut set is empty and mill-omit does not fire**. Do not burst
P62 feature files. Opening `t1Opening` boards that have no `closes`/`cut`
and are not mill-only stay green.

### 6. Plan store and echo

Module-level per-seat map keyed by `PlayerId`. No `localStorage`. No
match-log field.

After a **usable** batch (P61/P63: integer `moves` array + boolean
`endTurn`), read `plan` **beside** `asUsableBatch`, never instead of it,
never as an offer index:

| Reply | Store |
|---|---|
| `plan` is a nonempty string | sanitize and store for that seat |
| `plan` is `""` (or sanitizes to empty) | clear that seat |
| key absent or non-string | **keep** the previous plan |
| pass: `moves: []` and `endTurn: true` | **clear** (even if `plan` is nonempty) |

Sanitize: strip `\n` and `\r`, trim, cap at 80 characters. Echo the
sanitized value.

Exported `clearByokPlans()` empties the map. `App.tsx` `startMatch`
calls it once (the existing new-match path). One call.

Exported `rememberByokPlan(me, batch)` applies the table so tests can
drive the store without reconstructing a tiling. `playLlmBotTurn` calls
it after a usable parse, **before** apply-prefix. A reply with only
`plan` and empty `moves` + `endTurn: false` is still a **fallback**
(P61 empty-prefix); the store may still update from a nonempty `plan`.

**Echo.** If this seat has a stored plan, print `Plan: <text>` as its
own line **under the threat line, before `STATE_JSON`**. Omit the line
when the store is empty. Do not print `Plan:` as an order (no
`prefer` / `must` / `follow`). Facts only.

### 7. Fixture helpers — do not reconstruct a tiling

`docs/design/fixtures/P64-hit12-hit15.json` is the scenario’s Given.
Do **not** invent a tiling for CI. Do **not** reconstruct a full
`GameState` from `STATE_JSON`. Assert against recorded legal rows +
helpers.

`OfferTagRow`: `{ index, count, tags }` parsed from a LEGAL_MOVES row
(`tags=` comma list; `count=` integer).

`isFullStackClose(batch, rows)` is true iff `batch.moves[0]` is a row
tagged `closes` whose `count` equals the **maximum `count` among
`closes` rows**. `endTurn` is ignored. Empty `moves` is false. Hit 12:
`{moves:[2], endTurn:true}` and `{moves:[8],…}` true;
`{moves:[4,0], endTurn:false}` false.

Hit 12 expected batch: first (or only) index is a count=3 close — `[2]`
or `[8]`. `endTurn` true or false accepted. Expected teaching/fixture
phrase includes `"plan":"close the open trail"`. Recorded `[4,0]` fails
the fixture.

Hit 15 expected batch: `moves: []`, `endTurn: true`. Baseline paragraph
omitted. Threat line may still mention C’s lead. A mill baseline `[0]`
fails. Expected `plan` omitted or `""`.

No live grok. `isFullStackClose` does not call the model.

### 8. Extra keys still stripped

`asUsableBatch` remains: non-null object, `moves` integer array,
`endTurn` boolean; extra keys (`why`, `plan`, `mission`, …) ignored for
apply. `ParsedMoveBatch` stays `{ indices, endTurn }`. Plan is read from
the same JSON object **beside** that helper. P61 illegal-tail /
empty-prefix / lump apply stay green.

### 9. Spawner dump rank (observation 4.1 — ships)

`snapshotForPrompt` still filters to mine / contested / fully unclaimed
(`unclaimed === 3`), still caps at `MAX_SPAWNER_ROWS` **12**, still no
58-row dump.

Re-rank that interesting list **before** the cap: **tier 0** = a
`borderArrows` member is a current `me` group arrow **or** a current
legal step `exit` from this offer; **tier 1** = the rest. Within a
tier, vertex-id string order (today’s sort). Take 12.

`snapshotForPrompt` receives this offer’s steps (the same list
`buildUserPrompt` already has). When the offer is omitted, only group
incidence is tier 0.

Do not expand the interesting filter. Do not compute a path-to-enemy.
Do not add findings. Do not call `chooseTurnBeam`.

### 10. Near-trail (observation 4.2 — ships; origin/target only)

`cut` already means “this exit **is** an enemy-trail arrow.”

When `geometry.origin(exit)` or `geometry.target(exit)` equals
`origin`/`target` of any **enemy**-trail arrow, and the step is not
already tagged `cut`, `annotateMove` appends `near_trail:<seat>`.
`<seat>` is the enemy trail owner; if several match, first in
`state.players`. One tag.

This is a shared **point** (movement junction). Do **not** call
`flankVertices`. Do not invent `deny`. Do not invent `cut`.

If no legal exit shares a point with any enemy-trail arrow, the threat
line includes `no enemy trail on a legal vertex` (BSSN 4).

### 11. Purity

`threatLineFromCounts`, `baselineIndexFromTags`, `isFullStackClose`,
`snapshotForPrompt`, `annotateMove`, `buildUserPrompt`,
`buildSystemPrompt`, `rememberByokPlan`, and the plan map shall not use
`Date.now`, `Math.random`, or `performance.now`. Existing `fetch` on
play is unchanged.

### 12. Temperature / offer-filter / beam

Not this packet. After a later playtest where the mission is chosen and
the model still picks the wrong of two equal tagged exits, then jitter.
Not on the raw untagged row list.

## Terms

| Term | Means |
|---|---|
| **teaching file** | `docs/byok-teaching.md` — still non-normative |
| **threat line** | one facts line after Shares/tips, before `STATE_JSON` / `Plan:` |
| **baseline** | optional two-sentence weak one-ply hint, labelled suggestion only |
| **lump-close baseline** | baseline index from max `count` among `closes`/`cut` rows |
| **mill-omit** | every offer step is non-expanding mill → no baseline paragraph |
| **plan** | extra JSON string; reminder of the seat’s job; never an offer index |
| **plan echo** | `Plan: <text>` line when the per-seat store is nonempty |
| **usable batch** | P61: non-null object, `moves` integer array, `endTurn` boolean |
| **offer** | P61: `legalMoves` steps, engine order, global `[i]` |
| **near_trail:\<seat\>** | LEGAL_MOVES tag: exit shares a **point** with that enemy’s trail and is not `cut` |
| **greedy-v1** | frozen `chooseMove` (P11). Still the chooser. Not retuned here |
| **full-stack close** | first batch index is a max-`count` `closes` row on this offer |

Use AGENTS.md vocabulary for game words (*arrow*, *grain*, *point*,
*vertex*, *head*, *stack*, *trail*, *cut*, *closure*, *spawner*,
*share*). Origin/target of an arrow are **points**, not vertices.

## Flow

User prompt (per completion):

```mermaid
flowchart TD
  Build["buildUserPrompt"] --> Seat["Seat line"]
  Seat --> Phase["Shares=n, trailLen=n."]
  Phase --> Tips["exposed tips"]
  Tips --> Threat["threat line facts"]
  Threat --> Stored{"stored plan?"}
  Stored -->|yes| PlanLine["Plan: text"]
  Stored -->|no| Json
  PlanLine --> Json["STATE_JSON"]
  Json --> Legal["LEGAL_MOVES grouped by from"]
  Legal --> Tags{"closes or cut on offer?"}
  Tags -->|yes| Lump["baseline names max count tagged index"]
  Tags -->|no| Mill{"every step non-expanding mill?"}
  Mill -->|yes| Omit["omit baseline paragraph"]
  Mill -->|no| Greedy["chooseMove index if in offer"]
  Lump --> Reply
  Omit --> Reply
  Greedy --> Reply["JSON reminder with plan key"]
```

Plan store (beside apply):

```mermaid
flowchart TD
  Parse["usable batch JSON"] --> Apply["applyMappedPrefix reads moves + endTurn only"]
  Parse --> PlanKey{"plan key?"}
  PlanKey -->|pass [] + endTurn true| Clear["clear seat plan"]
  PlanKey -->|empty string| Clear
  PlanKey -->|nonempty string| Store["sanitize #59; store per seat"]
  PlanKey -->|absent or non-string| Keep["keep previous"]
  Store --> Next["next buildUserPrompt may echo Plan:"]
  Keep --> Next
  Clear --> Next
```

## Invariants

1. WHEN the teaching file is read, it shall contain the tags-are-hints
   beats (tags are not orders; `on_target` loses to an available `closes`
   or `cut`, an opponent share/territory lead, and `trailLen` already ≥
   girth with `tipDist` not shrinking; do not invent a tag; do not treat
   `borders_spawner` as walk-past-the-close) and the P62/P63 locked
   substrings, and shall not contain `domination` (any case), `§11`,
   `even-odd`, or `evaporation front`.
2. The teaching file shall contain a `## Plan` section after the JSON
   contract, and the JSON contract shall include a `plan` key. It shall
   contain the Hit 12 Good/Bad contrast including
   `"plan":"close the open trail"`. It shall not contain a fourth canned
   example and shall not match `/prefer (split|closes|don’t close|don't close)/i`.
3. WHEN `buildUserPrompt` runs, it shall print exactly one threat line
   after the Shares/tips block and before `STATE_JSON`, naming who leads
   shares then territory (including `me`), the longest enemy trail owner
   and length (or `none`), and whether the offer has `cut` / `closes`.
4. WHEN the same state, offer, and ports are given twice, the threat line
   shall be identical.
5. WHEN the offer has a `closes` or `cut` row, the baseline sentence shall
   name the largest-`count` such index (offer-order ties), not
   `chooseMove`’s count=1 when that is smaller. Hit 12 shape: `[2]` or
   `[8]`, not `[0]`.
6. WHEN every offered step is a non-expanding mill (`home_mill` /
   `onto_home`, no `closes` / `cut` / `leave_home`), the baseline
   paragraph shall be omitted.
7. WHEN Hit 12 recorded rows are the offer, `isFullStackClose` shall be
   true for `{moves:[2], endTurn:true}` and `{moves:[8],…}` and false for
   `{moves:[4,0], endTurn:false}`.
8. WHEN Hit 15 recorded rows are the offer, the expected batch shall be
   `moves: []` and `endTurn: true`, and a mill index shall not be the
   expected batch.
9. WHEN a usable batch includes extra keys `why` / `plan`, `asUsableBatch`
   shall still return only `indices` and `endTurn`, and apply-prefix shall
   not read `plan`. Empty `moves` + `endTurn: false` shall still be a
   fallback even if `plan` is present.
10. `packages/online-api/src/pages-heuristic.ts` shall keep importing
    `chooseMove` and shall not import `chooseTurnBeam`. `byokBot.ts` shall
    not call `chooseTurnBeam` or `evaluate` to build the prompt, baseline,
    or a tag. `chooseMove` / `chooseTurnGreedy` / `chooseTurnBeam` bodies
    shall not be edited.
11. WHEN two seats tie on shares (and territory if needed), the threat
    line’s lead order shall use `state.players` as the last sort key.
12. WHEN no enemy has a trail, the threat line shall contain
    `Longest enemy trail: none`.
13. WHEN a seat has a stored plan, `buildUserPrompt` shall print `Plan:`
    plus at most 80 characters with no newline, under the threat line and
    before `STATE_JSON`. A missing `plan` key shall keep the previous
    echo. `""` or a pass (`[]` + `endTurn: true`) shall clear it.
    `clearByokPlans()` shall drop the line on the next prompt. `plan`
    shall never be used as an offer index.
14. WHEN interesting spawners are listed, vertices incident to `me` group
    arrows or legal exits shall rank before other interesting vertices,
    and `spawnersShown` shall be ≤ 12.
15. Prompt builders, fixture helpers, `annotateMove`, and the plan store
    shall not use `Date.now`, `Math.random`, or `performance.now`.
16. WHEN a legal exit shares a point (`origin`/`target`) with an
    enemy-trail arrow and is not already `cut`, `annotateMove` shall tag
    `near_trail:<seat>`. WHEN no legal exit shares such a point, the
    threat line shall contain `no enemy trail on a legal vertex`.
    `annotateMove` shall not emit `deny`.
17. `App.tsx` `startMatch` shall call `clearByokPlans()`. The plan map
    shall not be written to `localStorage` or the match log.
18. WHEN `buildUserPrompt` runs, the live user prompt shall contain
    `"plan":"short"` on the reply line and shall not contain `prefer `
    (case-insensitive).
19. P61 illegal-tail re-prompt, empty-prefix `greedy-v1`, and mocked
    `count=3` lump apply shall stay green.
20. The system shall not invent a `cut` tag for an exit that is not on an
    enemy trail, and shall not compute a path-to-enemy.
21. Hit 12 expected batch text shall include
    `"plan":"close the open trail"` (or the locked fixture phrase). Hit 15
    expected batch shall omit `plan` or send `""`.
22. SPEC.md §1 shall still contain one `docs/byok-teaching.md` pointer
    labelled non-normative. This packet shall not add a second.

## P62 BSSN this packet supersedes (prompt only)

- P62 BSSN 9 / invariant 5 “baseline is `chooseMove`’s in-offer step”:
  **when the offer has `closes` or `cut`**, the sentence names
  `baselineIndexFromTags` instead. **When mill-omit fires**, the
  paragraph is omitted even if `chooseMove` would name a mill. Otherwise
  P62 BSSN 9 stands. Do not burst P62 feature files.
- P62 JSON reminder without `plan`: **extended** by BSSN 2. Do not burst
  P62 feature files; P64 tests pin the new reply line.
- P63 “P62 baseline hint unchanged”: **this packet changes which row the
  sentence names**, not the chooser.

## What this file deliberately does not decide

- Game rules. Do not add a §11 item.
- Temperature.
- Offer-filter / hiding singletons.
- Scoring the model with `evaluate` / `chooseTurnBeam`.
- Asserting a live model pick (no grok in CI).
- Unfreezing `greedy-v1`.
- Path-to-enemy / MCP / worker / personalities.
- P65 quiet-home leftover.

## Game-rule edges (out of scope)

Cut mid-closure, fork-stem cut, chord coincide vs interleave, pincer arms
on different turns, land bridge vs enclosing heads, accumulator capture,
stack reduced to one head, stranded head, contested spawn (SPEC §11 item
15), cell far from origin (item 4): **not this packet**. Engine behaviour
is unchanged. Teaching restates decided SPEC; it does not extend it.
`near_trail` is a prompt tag on an already-legal exit, not a new cut
rule.

## Escalate-if (answered, not blocking)

- “Prefer closes” in the user prompt: **no** — hint paragraph + baseline.
- Filter `count=1` off a close exit: **no**.
- Reconstruct `GameState` from Hit 12 `STATE_JSON`: **no** — recorded
  rows + helpers.
- Near-trail needs `flankVertices` / a search: **no** — `origin`/`target`
  only, so 4.2 ships with 4.1.
