# P79 — BYOK benchmark harness: measure before changing the prompt

> **Status:** ready. **Depends on:** P10 (replay), P15, P32. **Blocks:** P74,
> P75, P76, P80 and the P72 re-gate. Each of those claims to make a BYOK seat
> play better. Today nothing can check that claim.
>
> Playtest 2026-10-29 ([findings](../../research/playtest-2026-10-29/FINDINGS.md))
> produced those packets from **one** match, played by a strong model through
> the browser, with screenshots, its own search scripts and mid-match coaching.
> A BYOK seat has none of these. The findings are hypotheses about the BYOK
> seat until this harness has measured them.
>
> **SPEC coverage:** none. This is tooling and measurement. No rule change.

## The program this packet anchors

**Goal:** ship BYOK changes **only when they measurably beat the current
prompt**. A change that does not beat it is parked with its numbers, not
merged. "We built it" is not the bar.

Work order:

1. **Audit.** Read the archived grok matches for the failure modes the
   playtest found. Recorded in [`byok-benchmark.md`](../../research/byok-benchmark.md).
2. **P79 (this packet).** The harness, the baseline and the noise floor.
3. **Cost checkpoint.** One calibration match, measured. The human approves
   the full grid's projected spend before it runs.
4. **P80, P75 and P74 as independent arms**, in that order of evidence (the
   audit found grok failures P80 and P75 address directly; P74's have not
   been seen in grok yet). Each branches from main and is measured alone;
   combinations of those that pass alone are measured after. Whatever passes
   the gate ships.
5. **P76.** Shape decision informed by step 4. If P74/P75 close the gap, P76
   may not be needed. The P72 jev re-gate becomes an arm on this harness.

P77 (selection UI) and P78 (combat probe) do not touch the BYOK seat and run
in parallel. P78 reuses this packet's match runner.

## Intent

A headless runner. It plays a BYOK seat against the heuristic seat in Node,
through the **real adapter functions** the browser uses, and scores the result.
Given a git ref, it says whether that ref's BYOK seat plays better than main's.

The seams already exist:

- `playLlmBotTurn(geometry, rules, state, me, config, fetchImpl)` in
  `packages/web/src/byokBot.ts` plays one BYOK seat turn. It takes an injected
  `FetchLike`.
- `playBotTurn(geometry, rules, state, me)` in `packages/web/src/opponent.ts`
  plays one heuristic seat turn.

Nothing about the prompt is reimplemented. An arm differs from main **only in
its source tree**.

## BSSN (locked)

### Where it lives

- `packages/web/bench/`, run by its own Vitest config so the Vite aliases
  (`docs/byok-teaching.md?raw`, workspace packages) resolve exactly as in the
  app. It is **excluded from `pnpm test` and CI**: it needs a network and a
  key, and it costs money.
- Command: `pnpm byok-bench <tier> [options]`. Tiers: `mirror`, `positions`,
  `matches`.
- An **arm is a git ref**. To run an arm, check the ref out in a worktree and
  run the harness there. No prompt-version flags in production code. The
  baseline is main at this packet's merge.

### Model access

- OpenAI-compatible endpoint from `BYOK_BASE_URL`, `BYOK_MODEL` and
  `BYOK_API_KEY`, read from the environment. The person running it sources
  them from `~/.env` (`XAI_API_KEY` for grok).
- Calls go through the same `fetchLlmMoveBatch` body the browser sends
  (`temperature: 0`, the reasoning flag's token budget and thinking kwargs).
  The harness passes a Node `fetch`. It wraps nothing else.
- **The key never reaches a results file, a log line or an error message.**
  A test asserts this.

### Tiers

| tier | what runs | model calls | role |
|---|---|---|---|
| `mirror` | heuristic vs heuristic, every grid cell | none | Measures seat bias and calibrates the round cap. Free. |
| `positions` | One BYOK seat turn at each corpus position | one per position | Cheap smoke test. Covers parse rate, prompt size and missed closes. **Not a gate**, except parse regressions. |
| `matches` | BYOK vs heuristic, full matches, every grid cell | ~1 per BYOK turn | **The gate.** |

### Grid

- **2 players.** A third seat adds kingmaking noise: in the 2026-10-29
  playtest both other seats mostly ignored seat A. A 3-player check runs only
  on the final shipped combination.
- Config: the playtest config with `playerCount: 2`, i.e.
  `{dominationN: 5, R: 7, homeOffset: 5, spawnerSeed: s}`.
- `spawnerSeed ∈ {1, 2, 3}` × **BYOK seated first or second** = **6 cells**.
- **Round cap K = 20, fixed.** ~~K = 2 × the median `mirror` match length~~:
  **resolved by measurement.** No `mirror` match ends. All 6 cells reached the
  400-round safety cap with no winner, and seed 1's first seat finished holding
  1,238 heads. So there is no median to double. 20 rounds was chosen for three
  reasons:
  - Both audited grok failure modes appear by round 10.
  - The archived grok matches ran only about 9 rounds in all.
  - The budget below cannot pay for long matches.

  A BYOK-vs-heuristic cell will almost always be scored by land share at the
  cap, so the win branch of the score is kept but is not expected to fire.

### Budget (hard)

The human's xAI balance is **$9.40, capped, no refill**. The jev balance is
**$8**. Every model-calling run passes `--max-usd`, and the harness refuses a
call that would cross it. Plan, in order:

| step | cap | what it buys |
|---|---|---|
| calibration | $0.75 | 1 cell, K = 20, reasoning on: measured $/call, calls/match, wall time |
| everything after | sized from calibration, recorded here before it runs | baseline ×2, then arms in evidence order (P80, P75, P74) |
| reserve | ≥ $1.50 | reruns of invalid cells |

If calibration shows the full grid does not fit, the grid shrinks before the
gate loosens. The order of cuts is fixed:
1. The reasoning-off secondary mode.
2. Seeds, from 3 down to 2.
3. The second baseline run, using the `positions` tier's per-call variance as
   the noise floor instead.

### Modes and models

- **Primary gate: grok-4.7, reasoning on** (the lobby flag;
  `BYOK_REASONING_MAX_TOKENS`).
- **Secondary, must not regress: grok-4.7, reasoning off.** This mode has
  `BYOK_FAST_MAX_TOKENS = 64`, so the model can emit indices and nothing
  else. A prose change can help here only by priming. An offer annotation can
  help directly. The two modes may disagree, and that disagreement is a
  finding.
- **Non-grok check:** one other model, run only on the final combination
  against baseline. It must not regress.

### Scoring

Per match, from BYOK's side:

| outcome | score |
|---|---|
| won at round *r* | `1 + (K − r) / K`, which falls in (1, 2]: a faster win scores higher |
| alive at the cap | BYOK land ÷ total claimed land, which falls in [0, 1) |
| eliminated | `0` |

Secondary, reported but not gated: rounds survived, peak income, final heads
and closes.

Per arm and mode: the **mean score over the 6 cells**, plus per-cell scores.

### The gate (predeclared, before any arm runs)

An arm **passes** when all of these hold:

1. Its primary-mode mean beats baseline's by more than the **noise floor**.
   The noise floor is the largest per-cell difference between two runs of
   baseline itself, each run with the same seeds. Model nondeterminism at
   `temperature: 0` is real. If the effect is smaller than the floor, the
   result is **inconclusive** and the arm does not ship.
2. It is worse than baseline in **at most 2 of 6** cells.
3. Its secondary-mode mean is not below baseline's by more than the noise
   floor.
4. Its fallback rate is ≤ 5% of BYOK turns, and no more than 2 points above
   baseline's. A fallback turn is played by the heuristic, and an arm must not
   "win" on the heuristic's moves. **A cell with more than 10% fallbacks is
   invalid** and is rerun once. If it is still invalid, it is reported as
   such, and **an arm with any invalid cell cannot pass**. The arm mean is
   taken over valid cells only (`meanValid`).
5. Prompt size is within the arm's own packet budget, measured as mean
   `promptTokens` per call.

Six cells will not support a significance test, and the note says so. The
gate is a defended decision rule, not a p-value.

### Corpus (for `positions`)

- Committed under `packages/web/bench/corpus/`: the two archived grok match
  logs that have move lists (2026-09-10), and
  `docs/research/playtest-2026-10-29/final-match-log.json` by reference.
- A **position** is the state before a seat's first step of a turn, found by
  replaying the log's moves through `rules.apply`. Replay must reproduce each
  log's `summary` line exactly (steps / closes / cuts). If it does not, the
  corpus loader is wrong.
- Per position, record: parse ok or fallback, `promptTokens`, income rate at
  the end of the seat's turn, **interior pass** (the batch is empty with
  `endTurn` while the seat has a movable stack — the audit's paralysis), and
  **missed close**. A missed close is a turn
  where the offer had a row tagged `closes` with `share+N > 0` and the batch
  played none.

### Results

- Each run writes one JSON file under `packages/web/bench/results/`
  (gitignored), named `<tier>-<arm-sha>-<mode>-<model>.json`. It contains the
  commit SHA, model, mode, K, seeds, per-cell scores, fallback counts and
  token totals. **No prompt text and no key.**
- Committed summary: [`docs/research/byok-benchmark.md`](../../research/byok-benchmark.md).
  One table per arm: score per cell, mean, noise floor, gate verdict, tokens
  and wall time.

### Hygiene

- **Module state resets between matches.** `byokBot.ts` keeps per-seat plans
  (`rememberByokPlan` / `clearByokPlans`) and a target lock
  (`advanceTargetLock`). A match that inherits the previous match's plan is a
  silent contamination. The runner clears both before every match, and a test
  proves a second match is unaffected by the first.
- **Concurrency.** Matches run in parallel with a cap (default 4) to respect
  rate limits. Cells are independent, so results do not depend on scheduling
  order.
- **Retries.** A transport failure (HTTP 429/5xx, timeout) retries with
  backoff **before** `playLlmBotTurn` would fall back. A model reply that does
  not parse is **not** retried. It is a fallback and counts against the arm.
- **Cost report.** Every run prints tokens in and out, call count and wall
  time. Before a `matches` run, it prints the projected cost from the last
  calibration's per-match tokens and asks for `--yes`.

## Out of scope

- Changing the prompt, the offer, the heuristic seat or any rule. Baseline is
  whatever main says.
- CI integration. This needs a key and money.
- A model leaderboard. Grok-4.7 is the subject. The second model is a
  regression check only.
- A move oracle, i.e. scoring individual moves as "right". Every candidate
  oracle encodes somebody's strategy, and an arm tuned to it would be teaching
  to the test. Matches are the judge.

## Scenario inventory

Harness correctness. Every scenario uses a **scripted `FetchLike`**: no
network, no key.

- A match with a scripted model runs to a winner or to the cap,
  deterministically. Two runs produce byte-identical results.
- A `mirror` cell run twice produces identical results.
- The round cap ends a match and scores it by land share.
- A win at round *r* scores `1 + (K − r) / K`. Elimination scores 0.
- A scripted unparseable reply is counted as a fallback, and the heuristic's
  moves are applied for that turn.
- A scripted 429 is retried, not counted as a fallback.
- A cell over the fallback threshold is marked invalid.
- Byok plans and target locks from match 1 do not affect match 2.
- Replaying each corpus log reproduces its `summary` line.
- A corpus position is a state with the seat to move and no step yet taken
  this turn.
- Interior pass is counted for an empty `endTurn` batch while a stack can
  move, and not for a seat with no legal step
- Missed close is counted when the offer had a `share+N > 0` close and the
  batch played none, and is not counted when it played one.
- The configured API key string appears in no results file and no captured
  log line.
- Seat order is honoured: in the "BYOK second" cells, BYOK is the second
  player to move.
- `pnpm test` does not run the bench suite.

## Definition of done

- [ ] `pnpm verify` green. The bench suite is excluded, and its own harness
      tests pass under `pnpm byok-bench:test`.
- [ ] `mirror` run on all 6 cells. Seat bias and K recorded in
      `byok-benchmark.md`.
- [ ] One calibration `matches` cell run on baseline, with measured tokens,
      calls, wall time and projected grid cost **reported to the human for
      approval**.
- [ ] After approval: baseline `matches` run **twice** in both modes. Noise
      floor recorded.
- [ ] `positions` baseline recorded.
