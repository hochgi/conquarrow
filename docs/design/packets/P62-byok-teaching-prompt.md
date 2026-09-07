# P62 — BYOK teaching prompt (curated rules, no T0 order)

**Local agent handoff:** `/spec-to-ship docs/design/packets/P62-byok-teaching-prompt.md`

Phase 1 writes a **new** spec directory
[`docs/spec/byok-teaching-prompt/`](../../spec/byok-teaching-prompt/)
(core + edge-cases `.feature`, mermaid, EARS). Do not burst P53/P61 spec
dirs. Do not rewrite P61’s batch JSON contract.

**Layer:** `web` adapter + one teaching markdown + a **one-line** SPEC
pointer. No `contracts`, `rules-core`, or `online-api` behaviour change.
**No game rule is added, changed, or implied.** The teaching file is
**non-normative**. If it disagrees with SPEC.md, SPEC wins and the file is
wrong. `greedy-v1` stays frozen (still the named baseline hint).

**Depends on P61, P15, P11.** P30 playback unchanged.

**Not this packet:** offer-filter, enumerated turn plans, `beam-v1` as the
offer, runner resurrection, P58/P60, Pages `chooseTurnBeam`, `evaluate`
retune, raising `max_tokens` so the model “notices” tempo, importing P43
tutorial lessons, live grok playtest as CI.

## Problem

P61 let one completion commit a batch. Playtest 2026-09-07T13:16:19Z (R=7,
seed 1, A heuristic / B grok-4.5 / C human) still peeled `count=1` and
passed on B’s first turn. The model’s `why` was `T0 on_target leave_home
count=1`. The **user** prompt printed:

```
Prefer on_target when present
[T0] kind=merge_pair … via count=1 exit=…
```

`tagOnTarget` ignores count, so `[0][1][2]` were all `on_target` while T0
named `1`. The system prompt’s tempo line never got a vote.

The system prompt also does not state how a seat **wins**, does not describe
the board, and still says “Domination needs shares” — **stale**: SPEC §9
repealed domination; the match ends when one seat remains; a seat with no
shares starves after *N* rounds.

A longer essay that still prints `via count=1` and “prefer on_target” will
lose T1 the same way.

## What is not the fix

- **Dumping SPEC.md** into the prompt (fill, evaporation fronts, §11
  history). Curated teaching only.
- **Offer-filter / hiding `count=1`.** P61 lock stands.
- **Rubber-stamping `beam-v1`.** Hint is `chooseMove` / `greedy-v1` one ply,
  labelled a suggestion.
- **P43 tutorial dump.** Two canned examples only.
- **Raising `max_tokens`.** Input tokens grow; completion budget stays.

## What ships

### 1. `docs/byok-teaching.md` — system-prompt body

Imported into `buildSystemPrompt` as a string (Vite `?raw` or equivalent).
Stable across turns so providers can cache it.

**Must contain** (spec-author writes the prose; each bullet is a SPEC
quote or a faithful paraphrase — **escalate** if tempted to invent):

1. **Win.** Last remaining seat wins (P38: won match offers nothing). A
   seat with no territory is lost; no shares for *N* rounds is starvation
   (§9). **Do not** teach domination. Loop: risk heads → take territory →
   hold spawner shares → make heads.
2. **Board.** Unbounded plane; tiles are arrows; movement follows grain
   only; every **point** is 3-in / 3-out; girth 3. One paragraph.
3. **Move / turn.** A move is one portion of one arrow, one step along an
   out-arrow. A turn is an ordered list of such steps, ended with
   `endTurn` (P61: that flag is on the JSON, not an offer index).
4. **Tempo.** `speed(N) = 1 + floor(log₂ N)`. On a split both parts inherit
   `spent`. Majority merge **bars** the joined group (`speedOverride` 0)
   — T2’s `[1,6]`. Splitting is a decision **before** you walk, not after
   (§3 table last row). Same `(from,exit)`, larger `count` is the same
   walk, faster.
5. **Close / cut / mill.** Closing claims enclosed ground (including
   enemy heads). A cut evaporates enemy trail. `home_mill` / `onto_home`
   with empty trail and no expansion is wasted tempo. Tags on the offer
   name these; do not invent extra tags.
6. **JSON contract** (P61): `{"moves":[i,…],"endTurn":true|false,"why":"short"}`.
   Indices are this offer only. Do not invent moves. Do not reprint
   `STATE_JSON`.

**Must contain two worked examples**, compact snapshots (groups / trails /
shares — not 58 spawners):

- **Close vs cut.** One before-state, two legal indices, **two after
  snapshots**, so `apply(state, move) → state` is visible.
- **T1 tempo.** Same exit `[0] count=1 [1] count=2 [2] count=3` → the
  teaching answer is `[2]` (or `[1]` then more), **not** `[0]` +
  `endTurn`.

No third novel. No P43 lessons.

### 2. SPEC pointer

One line in SPEC.md §1 (playtest / BYOK sentence), labelled
**non-normative**: the BYOK teaching summary lives at
`docs/byok-teaching.md`. Teaching file must not add a rule. Sync test:
the file contains the locked phrases from §2 grain / 3-in-3-out, §3
`speed(N)` and inherit `spent`, §3 majority bar, §9 last seat +
starvation (and does **not** contain a live “domination” win).

### 3. User prompt: facts, not orders

- Keep: seat, `Shares=…`, `trailLen=…`, exposed tips, `STATE_JSON`,
  grouped `LEGAL_MOVES` with tags (including `on_target` if a finding
  matches **exit**, still ignoring count — tag is not an order).
- **Drop:** “Prefer on_target / prefer homeward / prefer leave_home”.
  Phase line is facts only.
- **Drop** the `TARGETS (locked plans… via count=N)` block.
- **Add** one optional paragraph, only if `chooseMove` returns a `step`:

  > A weak one-ply baseline would play `[i]` (`count=… from=… exit=…`).
  > Suggestion only — you may return any ordered indices from this offer.

  `i` is that step’s index in **this** offer. If `chooseMove` is
  `endTurn` (no legal step), omit the paragraph. Revisit after playtest
  (Q3b). Do **not** use P21 T0 / `merge_pair via count=1` as the baseline.

`formatTargetsForPrompt` may remain for tests but must not be concatenated
into the live user prompt. `syncTargetLocks` may still run **only** to
drive `on_target` tags.

`max_tokens` / thinking-off / `temperature: 0` / P61 parse-prefix loop
unchanged.

## Scenario inventory (phase 1 must write each)

Core:

1. `buildSystemPrompt` includes the teaching file body (win, board,
   `speed(N)`, inherit `spent`, majority bar, JSON contract).
2. Teaching file does not contain domination-as-win; does contain
   last-seat + starvation.
3. Reconstruct T1 user prompt (3-stack, T0 would have been `via count=1`):
   live user prompt **does not** contain `via count=` or `Prefer on_target`;
   **does** contain a baseline line whose index is `chooseMove`’s step, not
   necessarily `[0]`.
4. Close-vs-cut example is in the system prompt, with two after snapshots.
5. T1 tempo example is in the system prompt (`[2]` not `[0]`+`endTurn`).
6. Empty offer / `chooseMove` is `endTurn` → no baseline paragraph.
7. P61 batch parse / illegal-tail / empty-prefix scenarios stay green.
8. `chooseTurnBeam` / P53 shuttle tests untouched.

Edge:

9. Same state → same baseline index (`chooseMove` determinism).
10. Teaching file change that drops a locked SPEC phrase fails the sync
    test.
11. Vite/`?raw` (or chosen import) works in unit tests without fetch.
12. Pages still `chooseMove`; no `Date` / `Math.random` / `performance.now`
    in the prompt builder except the existing fetch on play.

## Non-goals

- Offer-filter, `beam-v1` hint, P43 import, runner, worker, SPEC rule
  edits beyond the one non-normative pointer.
- Asserting a live model picks `[2]` (no grok in CI).
- Unfreezing `greedy-v1`.

## Acceptance

- T1-shaped `buildUserPrompt` has no `via count=` and no “Prefer
  on_target”.
- System prompt teaches last-seat + starvation, not domination.
- Two canned examples present.
- P61 protocol tests still pass.
- `pnpm verify` green.

## Module sketch

```
docs/byok-teaching.md          // curated; SPEC §1 points here
packages/web/src/byokBot.ts    // import teaching; strip TARGETS/prefer;
                               // optional greedy baseline line
SPEC.md §1                     // one non-normative pointer
```

## Why this and not SPEC verbatim

T1 failed on an **order** in the user prompt, not on missing chord-test
theory. A cached teaching file can state win + grain + tempo once;
findings stay tags; one named weak step is a lifeline, not a lock.

## Handoff checklist

1. Read this packet, P61, the 2026-09-07T13:16 playtest (T0 `via count=1`),
   SPEC §2 / §3 / §9. Do not copy P15’s domination sentence.
2. `/spec-to-ship docs/design/packets/P62-byok-teaching-prompt.md`
3. Escalate if teaching prose would add a game rule, or if `chooseMove` in
   the prompt builder cannot be called without dragging `beam-v1`.
4. Do not open offer-filter or P58/P60 in the same PR.

## Escalate-if

- Temptation to put `via count=` back “for guidance”.
- Temptation to teach domination as a win condition.
- Sync test cannot quote SPEC without importing all of §11.
