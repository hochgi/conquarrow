# P66 — BYOK: plan budget, dirt close, tag-chase rewrite

**Local agent handoff:** `/spec-to-ship docs/design/packets/P66-byok-plan-budget-and-dirt.md`

Phase 1 **amends**
[`docs/spec/byok-hint-and-threat/`](../../spec/byok-hint-and-threat/)
(plan cap + teaching beats + three recorded-offer fixtures). Do not open
a new spec directory. Do not burst P15/P61/P62/P63 spec dirs. Do not
rewrite P61’s apply-prefix / empty-prefix / `llmHits` seat-turn loop.
Do not touch `chooseTurnBeam`.

**Layer:** `web` adapter (`byokBot.ts`, `docs/byok-teaching.md`) + one
recorded-offer fixture. No `contracts`, `rules-core`, or `online-api`
behaviour change. **No game rule is added, changed, or implied.**
Teaching stays **non-normative**. If it disagrees with SPEC.md, SPEC
wins. `greedy-v1` / `chooseMove` stay frozen. Pages still calls
`chooseMove`.

**Depends on P64** (which depends on P63, P62, P61, P15). P65 is
heuristic-only and is not edited here.

**Not this packet:** temperature, offer-filter, hiding `count=1`,
`beam-v1` as hint, runner, P58/P60, Pages `chooseTurnBeam`, `evaluate`
as an IQ score, MCP (that is P67), live grok in CI, path-to-enemy
search, inventing a `cut` tag, prefer-orders (“prefer spawners”,
“prefer 4-stacks”, “never close”). `plan` already shipped in P64;
this packet only changes its **budget and rewrite rules**, and names
two outcomes the offer already prints.

## Playtest that named this packet

`conquarrow-match-2026-09-10T06:57:10.109Z` — R=7, seed 1, 3 seats.
A heuristic / B grok-4.6 BYOK (`temperature: 0`, `max_tokens: 4096`,
thinking on) / C human. 14 `chooseLlmMove` POSTs, 9 B seat-turns,
0 fallbacks, 0 cuts, 7 closes, `firstCloseAt` 11 (A’s home close).

P64 plumbing worked. P65 worked for A (r3 walked; no three-pass gap).
P64 *content* did not:

- Hit 0 plan is `continue on_target and spend leftover on same exit`.
  That names a tag. The echoed `Plan:` line then makes the hint an
  order for hit 1. Three exits were on the offer; the untagged pair
  is `tipDist 0→3`, the tagged pair is `0→2`.
- Hits 5 and 9 take a `closes` row that does **not** carry `share+N`.
  After hit 9, B terr 8→13 and **shares stay 4**. Dirt close. The
  same offers also carry `borders_spawner` lumps (`[5]` on hit 5,
  `[6]` on hit 9).
- Hits 10–13 correctly pass (`[]` + `endTurn`) on mill-only offers
  while C goes 9→24 shares / 11→35 terr. Prompt copy cannot cut a
  trail that is not a row. `no enemy trail on a legal vertex` is
  true every time.
- Spawners dump is still the lex belt. Cap stays 12; rank is P64 §4.1
  and is not reopened here.
- Reasoning tokens 1k–12k to re-derive “don’t mill.” Content is a
  slogan. Raising the plan cap without changing what a plan may
  *name* stores a longer slogan.

## 1. Consumption (unchanged — quote so phase 1 does not “fix” it)

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

`why` and `plan` are still stripped before apply. A missing `plan`
key is valid. Empty `moves` + `endTurn: false` is still a fallback
even if `plan` is present. P61 lock stands.

## 2. Impossible vs rejected (this match)

### Impossible — never in `LEGAL_MOVES`

Same geometry as 2026-09-08. B lives around `-4,5` / `-5,6` / `-4,7`.
C paints around `0,-4` … `-1,-2`. Zero `cut` tags in 14 offers. Zero
legal exits share a vertex with C’s trail. Header already says so.

### Possible but rejected

| Hit | On the offer | Model played | Note |
|---|---|---|---|
| 0 | Untagged pair `[4]` `tipDist 0→3`. `on_target` pair `[1]` `0→2`. Mills `[6]`–`[8]`. | `[1]` + plan `continue on_target…` | Tag-chase plan. |
| 5 | Dirt `closes` `[2]`/`[3]` (no `share+N`). `borders_spawner` lump `[5]`. `on_target` `[6]`. Plan: `close the open trail`. | `[3]` lump dirt close | Plan executed the close. Shares stay 4. |
| 9 | Dirt `closes` `[7]`/`[8]` (no `share+N`). `borders_spawner` lump `[6]`. Plan still `close the open trail`. | `[8]` lump dirt close | terr 8→13, shares 4→4. |
| 13 | Nine mills, trailLen=0, C 24/35. | `[]` endTurn | Correct. Keep this. |

## 3. Prompt + adapter changes (smallest first)

### 3a. Plan budget 80 → 512

P64 locked “~80 characters, one line.” That is too small for a job
clause that names a trail and a reason to rewrite. It is not a
travelogue budget.

- Teaching: “Keep it under 512 characters, one paragraph, no invented
  destinations.” Not 1K. 1K becomes a second `why`.
- Adapter: `PLAN_CAP` (or the truncate in the echo path) becomes
  **512**. Strip newlines to spaces before store and before echo.
  Tests that lock `80` update to `512`.
- JSON contract key is unchanged:
  `{"moves":[i,...],"endTurn":true|false,"why":"short","plan":"…"}`.
  Reply-line copy may say `plan` without “short” as the only hint;
  the 512 cap lives in teaching + adapter.

### 3b. Teaching facts — outcomes, not orders

Add **one short section** after `## Plan` (or extend `## Plan` and
“Close, cut, mill”). Keep every P62/P63/P64 lock (`speed(N)`, inherit
`spent`, majority `speed 0`, grain, `3-in / 3-out`, `girth is 3`,
`one seat remains`, `starvation`, tags-are-hints, `on_target` loses
to close/cut/lead/mature trail, JSON contract, T1 numbers, close-vs-cut
two afters, pinwheel 1-share vs 3-share, Hit 12 good/bad).

Required beats. Do **not** turn them into “prefer X”:

- A **share** is a factory. Force on a held vertex is future heads.
  Territory with no new share is painted dirt.
- `closes` without `share+N` on that row claims painted dirt only.
  The pinwheel 1-share vs 3-share example already shows the other
  case. Do not invent `share+N`.
- `speed(N) = 1 + floor(log₂ N)` already ships. Opening implication
  only: a 4-stack is 3 tiles this turn; three singletons are 1+1+1.
  That is why an early lump has more ground, not because we said
  “prefer 4.”
- Other seats have a job you can read from the header: share lead,
  longest enemy trail, whether any legal row is `cut` / `closes` /
  `borders_spawner`. Weigh cut-if-present against expand-if-present.
  A plan cannot create a cut that is not a row.
- A plan that **names a tag** (`continue on_target`, `walk on_target`)
  is already wrong. Tags are hints. Rewrite it.
- Rewrite when: the job is done; this offer no longer contains that
  walk; the threat line shows a `cut` / `share+N` close that beats
  the old job; the current `closes` row has no `share+N`; the lead
  has flipped against this seat and the plan is still “close this
  dirt trail.”

Worked contrast, compact, no fourth full canned example:

```
Hit 5 / 9 shape. Offer has closes [3] (no share+N) and borders_spawner [5].
Plan: close the open trail
Good: {"moves":[5],"endTurn":false,"why":"border the pinwheel","plan":"walk a border of the open pinwheel; dirt close is not a share"}
Bad:  {"moves":[3],"endTurn":true,"why":"lump close"}  // dirt; shares stay 4
```

Hit 12 good/bad from P64 stays. Do not delete it.

### 3c. Header — one dirt clause when it is true

Threat line already names share lead, longest enemy trail, and
whether the offer has `cut` / `closes` / `borders_spawner`.

Add at most **one clause** when any legal row is tagged `closes`
and **none** of those closing rows carry `share+N`:

```
closes without share+N (dirt)
```

Deterministic. Same offer → same clause. Omit when every `closes`
row has `share+N`, or when there is no `closes` row. Do not invent
a `deny` tag.

### 3d. Observation

Not this packet. P64 §4.1 (tip-local spawners) already shipped and
did not bite on this seed’s dump. Reopen only if a later match
shows a reachable unclaimed pinwheel missing from the 12. Do not
compute a path-to-C.

## 4. Temperature

Not this packet. Same rule as P64 §5.

## 5. Fixtures

Recorded offers live at
`docs/design/fixtures/P66-hit5-hit9-hit13.json`
(copied from the 2026-09-10T06:57:10Z requests; not live grok).

### Hit 5 — reject the dirt close

Offer (condensed): B 2-stack on `-4,6,2` `spent=1`, leftover 1-stack
on `-5,6,0`. `trailLen=5`. Shares B=4. Plan echoed:
`close the open trail`.

- `[2]`/`[3]` `closes,homeward,onto_home` — no `share+N`
- `[4]`/`[5]` `borders_spawner,outward`
- `[6]` `outward,on_target`

Recorded reply: `{"moves":[3],"endTurn":true,"why":"lump close"}`
— **wrong for this packet**.

Expected: first (or only) index is **not** a `closes` row that
lacks `share+N`. Acceptable recorded shape: `[5]` (or `[4]`)
`borders_spawner`. `[3]` / `[2]` fail `isDirtClose`. `[6]` fails
`isTagChase` if the plan still names `on_target`.

The fixture does **not** call grok. It asserts:

- teaching contains the dirt-close sentence and the “plan that
  names a tag is wrong” sentence;
- `PLAN_CAP` / echo truncate is 512;
- `isDirtClose({moves:[3]}, offerTags)` is true;
- `isTagChasePlan("continue on_target and spend leftover on same exit")`
  is true;
- `isTagChasePlan("walk a border of the open pinwheel")` is false;
- threat / header helper emits `closes without share+N (dirt)` on
  this offer.

### Hit 9 — same reject

`closes` `[7]`/`[8]` without `share+N`; `borders_spawner` `[5]`/`[6]`.
Recorded `[8]` is dirt. Acceptable: `[6]` (or `[5]`). Shares stay 4
after the recorded close — that is the Given, not an apply in CI.

### Hit 13 — expect `[]` endTurn

Nine rows, all `home_mill,onto_home`, trailLen=0. Recorded
`{"moves":[],"endTurn":true}` — **correct**. Baseline paragraph
omitted (P64). `plan` omitted or `""`. Keep this.

## Scenario inventory (phase 1 must write each)

Core:

1. Teaching still contains every P62/P63/P64 lock; adds dirt-close,
   factory/share, 4-stack = 3 tiles, tag-chase plan is wrong; still
   has no domination / §11 / even-odd / evaporation front / prefer-
   orders.
2. Plan echo / store truncate at 512, newlines stripped.
3. Tests that locked 80 now lock 512.
4. Header clause `closes without share+N (dirt)` iff the offer has
   a `closes` row and none of those rows carry `share+N`.
5. Hit 5 fixture: `{moves:[3]}` is `isDirtClose`; `{moves:[5]}` is not.
6. Hit 9 fixture: `{moves:[8]}` is `isDirtClose`; `{moves:[6]}` is not.
7. Hit 13 fixture: `{moves:[], endTurn:true}` is the expected batch.
8. `isTagChasePlan` true for the hit-0 recorded plan, false for a
   job that does not name a tag.
9. `asUsableBatch` still strips extra keys. P61 empty-prefix /
   illegal-tail tests stay green.
10. `chooseTurnBeam` / P53 / P65 tests untouched. Pages still
    imports `chooseMove`.

Edge:

11. `closes` + `share+N` on the same row → no dirt clause.
12. Plan of length 81 is stored (was truncated at 80).
13. Plan of length 513 is truncated to 512.
14. No `Date` / `Math.random` / `performance.now` in the prompt
    builder except the existing fetch on play.

## Non-goals

- Temperature.
- Offer-filter / hiding singletons.
- Scoring the model with `evaluate` / `chooseTurnBeam`.
- Asserting a live model pick (no grok in CI).
- Unfreezing `greedy-v1`.
- Path-to-enemy / MCP / worker / personalities.
- Reopening P64 §4.1 spawner rank.

## Acceptance

- Hit 5 / hit 9 helpers reject the recorded dirt close and accept
  a `borders_spawner` lump.
- Hit 13 helpers expect `[]` + `endTurn` and clear `plan`.
- Teaching names dirt close, factory/share, tag-chase rewrite;
  plan budget 512; still syncs to SPEC locks.
- P61/P62/P63/P64 protocol tests still pass.
- `pnpm verify` green.

## Module sketch

```
docs/byok-teaching.md                         // plan cap + dirt + rewrite
docs/design/fixtures/P66-hit5-hit9-hit13.json // recorded offers + expected
packages/web/src/byokBot.ts                   // PLAN_CAP 512; dirt clause
packages/web/test/byok-hint-and-threat.*.ts   // cap + helpers
docs/spec/byok-hint-and-threat/               // phase 1 amends
```

## Handoff checklist

1. Read this packet, the 2026-09-10T06:57:10Z requests/responses/log,
   P64, `asUsableBatch` / plan store / threat line in `byokBot.ts`.
   Do not edit `chooseTurnBeam`.
2. `/spec-to-ship docs/design/packets/P66-byok-plan-budget-and-dirt.md`
3. Paste a P66 index row into `docs/design/02-work-packets.md` above
   P20+ if that table is still the living index (this handoff already
   does).
4. Escalate if teaching prose would add a game rule, if a helper
   wants to call grok, or if dirt detection needs a new
   `annotateMove` tag instead of reading the offer’s existing tags.
