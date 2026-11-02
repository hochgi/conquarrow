# BYOK benchmark

Results ledger for [P79](../design/packets/P79-byok-benchmark-harness.md).
The gate, the grid and the scoring rule are defined there and fixed before any
arm runs. This file records what happened.

## Audit — archived grok matches vs the 2026-10-29 failure modes

**Corpus:** the three archived grok-4.6 matches (`archive/requests|responses.*.json`,
2026-09-08 and 2026-09-10), reasoning on, 42 calls in all. All three are
**early game only**: the longest ran 55 steps. They predate P64/P66 in part,
so this audit names failure *classes*. P79's `positions` tier re-checks them
under the current prompt.

**Headline: grok's failures are not the ones the playtest found.** The
playtest's seat B walked outward into weak bands, closed ground with no
spawners on it, and clustered next to a larger stack. None of the three grok
matches shows any of these. They are too short to show the late-game ones at
all, so absence is not evidence either way. Grok fails in two other ways, and
it fails in them repeatedly.

### 1. Interior paralysis: passing with nowhere "useful" to go (5 of 42 calls)

Match 2026-09-10T0657, calls 10–13: four consecutive turns of
`{"moves":[],"endTurn":true}`, with reasons like
*"all rows home mill, empty trail, no expansion"*. Match 2026-09-08, call 15:
the same.

Both of B's stacks sat **inside** B's own 13-arrow territory. Every legal step
was tagged `home_mill,onto_home` with `tipDist=0→0`, so no row could show that
it moved toward the edge. Three things then combine:

- `home_mill` is `fromHome && ontoHome` (`byokBot.ts` `annotateMove`). It fires
  on **every** interior step, including one that walks toward the frontier.
- The teaching says a mill with an empty trail *"is wasted tempo"*.
- `millOmit` suppresses the baseline suggestion when every row is a mill.

So the seat is told every move is waste, is shown no distance that would
contradict that, and is given no suggestion. It passes, and keeps passing for
as long as the stack is interior. That is a **permanent stall from a tag that
says something false**. No P74–P78 packet covered it. → **P80**.

### 2. Border-walk cycle: re-walking its own trail for shares (9 of 12 calls)

Match 2026-09-10T1442, calls 3–11: a 3-stack walks the same three arrows round
and round, `-4,7,1 → -5,8,0 → -4,8,2 → -4,7,1`. `trailLen` stays at 6 and it
never closes. Each row is tagged `borders_spawner`. Its plan reads *"walk
remaining borders of the open pinwheel for shares"*. Meanwhile C goes from 3
territory to 22.

`bordersOpenSpawner(exit)` is true whenever the exit borders a spawner with an
unclaimed arrow. It is true even when **the exit is already on the seat's own
trail**, so re-walking a trail arrow advances nothing. The seat reads the tag
as progress, and nothing in a one-step offer shows a cycle. → **P75**: its
`advances=` clause must not fire on an arrow the seat already holds as trail
or territory. Added as a scenario there. P74's "trail is not territory"
teaching and P76's delta also bear on this.

### What this changes

- **The playtest is a weak proxy for grok.** The packets built from it are
  hypotheses until P79 measures them. That was already the plan; this audit is
  the evidence that it was needed.
- **P80 and P75 have direct evidence. P74 has none yet.** P74's gradient and
  defensive-half material addresses failures grok has not yet been seen
  making. It stays an arm, but it is the one most likely to come back
  inconclusive.
- **Seat behaviour depends on tags far more than on prose.** In 42 calls,
  `why`/`plan` cites an offer tag in 37 (`mill`, `on_target`, `homeward`,
  `outward`, `border`, `leave home`, …). It names `force` in none, even though
  `force` is printed on every spawner row.

## Mirror (heuristic vs heuristic)

P79 harness, safety cap 400 rounds, `{dominationN: 5, R: 7, homeOffset: 5, playerCount: 2}`.
Each seed was played twice, once with the "BYOK chair" seated first and once
second. Both chairs were driven by the heuristic, and the two runs produced
identical move lists.

| seed | first seat land | second seat land | rounds | winner |
|---|---|---|---|---|
| 1 | 86/118 (0.729) | 32/118 (0.271) | 400 | none |
| 2 | 64/107 (0.598) | 43/107 (0.402) | 400 | none |
| 3 | 50/134 (0.373) | 84/134 (0.627) | 400 | none |

- **No mirror match ends.** The heuristic mostly passes. Seed 1 logged 557
  steps against 800 end-turns, and the first seat finished holding 1,238 heads.
  So P79's "2 × median length" rule for K had nothing to measure, and K is now
  fixed at 20 (see the packet).
- **Seat bias.** On land share the first seat leads on 2 of 3 seeds (mean
  0.567 vs 0.433). That is within seed-to-seed spread, so it is not a clear
  first-mover advantage. Every arm is scored over both seat orders anyway.
- **This bears on P78.** A heuristic that hoards heads and stops expanding
  means no match ends by itself. That is a finding about the heuristic seat,
  not about the rules. It is recorded here only; nothing changes from this
  packet.

### After P81 (2026-11-02): the heuristic finishes

[P81](../design/packets/P81-heuristic-finishes-matches.md) diagnosed the stall
as search-budget starvation plus a reply-scoring asymmetry that favoured
`[endTurn]`, and then a missing finishing objective
([spec](../spec/heuristic-finishes/heuristic-finishes.md#diagnosis-recorded-before-the-fix-as-the-packet-requires)).
Measured with the same tiers, free only. **Before** is `main` `6e0cee3`
(it reproduces the archived run above move for move); **after** is
`56de8dc`.

**Mirror** (`pnpm byok-bench mirror`, 400-round safety cap, concurrency 6):

| seed | before: rounds / winner | after: rounds / winner | after: steps per 40-round window (A / B) |
|---|---|---|---|
| 1 | 400 / none | **55 / B** | 66/123, 2/45 |
| 2 | 400 / none | **95 / B** | 67/68, 112/119, 23/57 |
| 3 | 400 / none | **63 / A** | 111/68, 83/15 |

- **Matches end: 6/6** cells within 200 rounds (gate ≥ 5/6). Both seat orders
  of a seed are the same game, as before.
- **No late stasis.** In every window the seat ahead on heads took ≥ 45 steps
  (gate ≥ 20). Before, the leader had 40-round windows with **0** steps in all
  three seeds (seed 1 rounds 227–267, seed 2 319–359, seed 3 172–212).
- **Deterministic.** Two runs at `7a367a5` and the run at `56de8dc` gave
  byte-identical move lists in all six cells (`56de8dc` only touches code that
  used to throw).
- **Wall time.** Before 1,688 s for 800 seat-turns per cell (6 cells in
  parallel), **2.11 s per turn**. After 132 s, longest cell 190 seat-turns,
  **0.70 s per turn** (0.93 s if all six cells' turns share the wall). Both
  are under the 1.5× gate. The before run shared the machine with prototype
  experiments, and early-game turns are cheaper than late-game ones, so the
  matched-position figure is the fairer one: the round-160 seed-1 position
  took 1.6 s per `chooseTurnBeam` before and 0.6 s with the multi-source BFS.

**Reach grid** (`pnpm byok-bench reach --round-cap 200`, 16 cells):

| reading | P78 (cap 100, before) | after P81 (cap 200) | gate |
|---|---|---|---|
| cells ending with a winner | 0/16 | **15/16** (only `p3-R7-h5-s1` capped) | ≥ 12/16 ✔ |
| combat share of heads lost, 2 seats | 85 % (417/489) | 73 % (303/416) | |
| combat share of heads lost, 3 seats | 83 % (1361/1648) | 79 % (1647/2094) | |
| combat share, whole grid | 83–85 % | **78 %** (1950/2510) | ≥ 50 % ✔ |

Ends by round: two seats 52–95, three seats 103–169. Evaporation still kills
nobody; 4 heads vanished with a lost seat.

**Finding: the beam still passes with a step legal.** The packet keeps
`chooseMove`'s "never pass while a step is legal" rule and asked for any beam
breach to be named. The breach is older than P81 and much rarer after it.
Zero-step seat-turns in the three mirror games fell from 1,236 to 92. Replayed,
62 of those 92 had a legal step: seed 1 has 5 (a 1-head seat), seed 2 has 47
(both seats, 1–33 heads, rounds 12–95) and seed 3 has 10. In 60 of the 62 the
seat is not dominant, so the finisher is off and P53's `swapIdle` /
`IDLE_SLACK` still lets `[endTurn]` win. The other 2 are seed 3's A at rounds 28
and 29 (15 and 17 heads, dominant), where no staging walk existed. This is not
fixed here; a follow-up packet should decide it.

## Calibration and cost

Measured on 2026-10-30 against xAI `grok-4.7`, at main + P79 (`1fba075`).

| run | cap | spent | calls | tokens in (cached) | reasoning tokens | wall |
|---|---|---|---|---|---|---|
| `matches` s1-first, K=20, reasoning on | $0.75 | **$0.7277** | 16 (7 rounds, then cap) | 70,225 (18,432) | 101,920 | 24.7 min |
| `positions`, 3 positions, **fast** mode | $0.10 | **$0.0945** | 2 | 8,823 (2,304) | 13,301 | 3.2 min |

- **$0.045 per call, about 85% of it reasoning tokens.** Calls average ~6.4k
  reasoning tokens against ~4.4k prompt tokens. Output is billed at $6/M,
  input at $2/M.
- **About 2.3 calls per BYOK turn, about 92 s per call.** A full K=20 match is
  roughly **$2.10 and 70 minutes**.
- **Fast mode does not exist for grok-4.7.** With `enable_thinking: false`
  and `max_tokens: 64` it still reasons (6.6k tokens per call, billed). So
  P79's secondary "reasoning off" mode is the same cost and the same
  behaviour. That mode is dropped for grok-4.7.
- **0 fallbacks** in 16 reasoning calls.
- **Spent so far: $0.82 of $9.40.**

**Consequence:** the predeclared grid cannot be afforded. It would take
6 cells × ~$2.10 per run, at least 4 runs. Cutting reasoning-off, a seed, then
the second baseline still leaves about 4 matches in total, which cannot gate
anything. The gate needs re-planning; see the next entry.

## Gate plan A (chosen by the human, 2026-10-30, after calibration)

This replaces P79's 6-cell × 2-mode grid, which the budget cannot buy. It is
fixed here **before any arm runs**.

### Primary: targeted positions on `grok-4.7` (the model the human plays)

The `positions` tier runs on 12 corpus positions. Each position is one full
seat turn from the logged state.

| group | ids | failure it targets | reading |
|---|---|---|---|
| **P** stall | `grok-2026-09-10T0657#56,#64,#72,#80` | interior paralysis | `interiorPasses` |
| **C** cycle | `grok-2026-09-10T1442#24,#34,#43,#53` | re-walking own trail | `rewalks` |
| **O** ordinary | `grok-2026-09-10T0657#13,#25,#45`, `grok-2026-09-10T1442#13` | none (regression guard) | fallbacks, `missedCloses` |

Baseline runs the set **twice**, which shows how much grok-4.7 varies from run
to run at `temperature: 0`.

**An arm's target reading must beat both baseline runs**:
- P80 targets group P: fewer interior passes there than *either* baseline run.
- P75 targets group C: fewer rewalks there than *either* baseline run.
- P74 has no group of its own. It passes on either reading.

**And it must not regress anywhere.** On every group, interior passes, rewalks,
missed closes and fallbacks must not exceed the *worse* of the two baseline
runs.

### Secondary: whole-game no-regression on a proxy model

`matches` tier, `grok-4.20-0309-non-reasoning` (list price $1.25 / $0.20
cached / $2.50 per M), K = 20.
- **Cells:** all 6 (seeds 1–3 × both seat orders). This was widened from 4
  before any arm ran, once the proxy calibration measured **$0.137 per K=20
  match** (48 calls, 52 s, 0 fallbacks, score 0.250 on `s1-first`). The full
  grid is about $0.82 per run.
- **Baseline:** run twice. The noise floor is the largest per-cell score
  difference between those two runs.
- **Pass:** the arm's mean over valid cells is not below baseline's mean
  (taken over both runs) by more than the noise floor, and its fallback rate
  is ≤ 5%.
- **Purpose:** this guards against a prompt change that fixes the targeted
  positions but plays the whole game worse. It does **not** gate on
  improvement, because the proxy is not the model the human plays.

### Order and money

Runs go in this order: baseline (both checks), then P80, then P75, then P74.
**P74 runs only if what remains covers it plus a $1.00 reserve.** Every run
passes `--max-usd`. The amounts spent are recorded below as they happen.

## Baseline

main at P79 + #69. Spend to here: $3.33, including both calibrations.

**grok-4.7, 12 targeted positions, two runs (`base1` $0.79, `base2` $0.62).**
The two runs were **identical, position by position**:

| group | interior passes | rewalks | missed closes | fallbacks |
|---|---|---|---|---|
| P stall (4) | **4** | 0 | 0 | 0 |
| C cycle (4) | 0 | **6** (2 at each of #34, #43, #53) | 0 | 0 |
| O ordinary (4) | 0 | 1 (#25) | 0 | 0 |

Both audited failures reproduce **under the current prompt**, every time.
grok-4.7 at `temperature: 0` was stable on this set, so any change an arm
produces is not run-to-run variance. Prompt size: 4,542 tokens per call.

**Proxy `grok-4.20-non-reasoning`, 6 cells, K = 20, two runs (`pbase1` $0.59,
`pbase2` $0.38).** Identical scores per cell, so the **noise floor is 0**.

| s1-first | s1-second | s2-first | s2-second | s3-first | s3-second | mean |
|---|---|---|---|---|---|---|
| 0.250 | 0.143 | 0.130 | 0.122 | 0.107 | 0.111 | **0.144** |

At 20 rounds the BYOK seat holds about 14% of claimed land against the
heuristic.

## Arms

### P80 — interior mill paralysis: **PASS** (2026-10-30)

Run as PR #70 merged with main, so the harness was identical to baseline's.
Cost $1.64 ($1.01 positions + $0.63 proxy).

| reading | baseline (both runs) | P80 | gate |
|---|---|---|---|
| P stall: interior passes | 4 | **0** (each plays 3 steps) | beats both runs ✔ |
| C cycle: rewalks | 6 | 6 | no regression ✔ |
| O ordinary: rewalks / missed closes | 1 / 0 | 1 / 0 | no regression ✔ |
| fallbacks | 0 | 0 | ✔ |
| proxy mean (6 cells) | 0.144 | 0.144, identical per cell | no regression ✔ |
| prompt tokens per call | 4,542 | 4,586 (+1.0%) | ≤ 5% ✔ |

The proxy's 20-round matches never reach an all-interior position, so its
identical scores confirm only that nothing else moved. The targeted
positions carry the improvement.

**Spend to here: $4.97 of $9.40.**

### Measuring after P80: increments over main

With P80 merged, main *is* the P80 arm, and its row above is the new baseline.
Later arms are measured as increments over main, not alone against pre-P80
main. That saves a combination run the budget cannot buy. It is fair because
P80 left the other readings untouched: rewalks were 6 with and without it, and
the proxy was identical per cell.

### P74 — teaching: the defensive half: **FAIL, parked** (2026-10-30)

Branch `parked/p74-byok-defensive-half` (teaching rewrite `d4a9619`, +23.7%
body by chars/4). Measured over main = P80. Cost $1.80 ($1.01 positions +
$0.79 proxy).

| reading | baseline (main = P80) | P74 | gate |
|---|---|---|---|
| P stall: interior passes | 0 | 0 | nothing left to improve |
| C cycle: rewalks | 6 | **7** (#53: 2 → 3) | **regression ✘** |
| O ordinary: rewalks / missed closes | 1 / 0 | 1 / 0 | ✔ |
| fallbacks | 0 | 0 | ✔ |
| proxy mean (6 cells) | 0.144 | 0.156 (s2-second 0.122 → 0.214, s1-second 0.143 → 0.125) | no regression ✔ |
| prompt tokens per call | 4,586 | 4,945 (+7.8%) | ≤ 25% ✔ |

P74 improves neither targeted reading and makes the cycle reading worse, so it
does not merge. This is what the audit predicted: grok acts on tags, not
prose. The rewrite adds 360 tokens to every call and changes the loop
behaviour for the worse. The proxy's +0.012 mean is the only sign of a
whole-game effect. The proxy does not gate improvement, so that is a hint for
a future arm, not a pass.

The SPEC §7 correction that P74's drafting surfaced is independent of the arm
and lands on its own: the band table now follows `SPAWNER_BANDS`.

**Spend to here: $6.77 of $9.40.**

### P75 — offer rows name the vertices they advance: **PASS** (2026-10-31)

Run as PR #72 merged with main, so it is measured over main = P80. Cost
$1.64: $0.99 positions, plus $0.55 proxy and $0.10 for one cell (s3-second)
re-run from the reserve after the cap stopped it at round 17.

| reading | baseline (main = P80) | P75 | gate |
|---|---|---|---|
| C cycle: rewalks | 6 | **0** (#34, #43, #53 each 2 → 0) | beats both runs ✔ |
| P stall: interior passes | 0 | 0 | ✔ |
| O ordinary: rewalks / missed closes | 1 / 0 | 1 / 0 | ✔ |
| fallbacks | 0 | 0 | ✔ |
| prompt tokens per call | 4,586 | 4,632 (+1.0%) | ≤ 15% ✔ |

**Proxy, 6 cells:**

| | s1-first | s1-second | s2-first | s2-second | s3-first | s3-second | mean |
|---|---|---|---|---|---|---|---|
| baseline | 0.250 | 0.143 | 0.130 | 0.122 | 0.107 | 0.111 | 0.144 |
| P75 | 0.130 | **0.489** | 0.120 | 0.172 | 0.107 | **0.615** | **0.272** |

No regression on the mean, so the proxy check passes. It is also the
largest whole-game movement any arm has produced: the mean nearly doubles. That
is still a proxy reading, so it is reported, not counted as the gain. It is
uneven: two cells go down (s1-first −0.12, s2-first −0.01) and three go up a
lot. With six cells, this is a strong hint, not a measurement of how much
better the proxy plays.

**Spend to here: $8.41 of $9.40.** That leaves about $0.99, which is the
reserve. No further arm is funded.

## P81 changed the opponent (2026-11-02)

**Every proxy whole-game number above predates P81** — the baseline mean
0.144, the P74 and P75 proxy rows, and the P80 proxy check. The `matches` tier
plays the BYOK seat against the heuristic, and since P81 that heuristic
spends its surplus and finishes games (see "After P81" under Mirror). Those
baselines must be **re-measured before any further BYOK arm**; do not compare
a new arm's proxy score with them. The `positions` tier never plays the
heuristic and is unaffected.

### Post-P81 proxy baseline (2026-11-02)

Measured on main at `8d98a0d` (P81 merged; P80 + P75 already on main), with
the same command as the earlier proxy rows: `grok-4.20-0309-non-reasoning`,
6 cells, K = 20, tag `pbase81`. **This is the baseline every later BYOK arm's
proxy run compares against.**

| cell | s1-first | s1-second | s2-first | s2-second | s3-first | s3-second | mean |
|---|---|---|---|---|---|---|---|
| P75 arm, pre-P81 opponent | 0.130 | 0.489 | 0.120 | 0.172 | 0.107 | 0.615 | 0.272 |
| **main, post-P81 opponent** | **0.130** | **0.564** | **0.120** | **0.400** | **0.081** | **0.661** | **0.326** |

All 6 cells were capped at round 20 with 0 fallbacks, over 230 calls. That
cost **$0.62**.

The opponent change moves the second-seat cells up (s2-second +0.23) and
s3-first down (−0.03). Within 20 rounds the finishing heuristic spends heads
it used to hoard, which leaves the BYOK seat more land. The first-seat cells
barely move.

**Budget.** The human added $10 to xAI on 2026-11-02, so the balance was
$11.01 before this run. Spent since the top-up: $0.62.

### P72 — decision-API advisor: gate predeclared (2026-11-02)

[Packet](../design/packets/P72-decision-api-advisor.md). This gate is fixed here
before any paid P72 run. The arm is the seat's model (grok) **advised** by jev:
one System One `choice` over the offer before each completion, with
` advisor=p` on every row. It is measured as an increment over main, which is
P80 + P75 + P81.

**This replaces plan A's no-group rule, for P72 only.** Under plan A, an arm
with no group of its own passes "on either reading": P-group interior passes
or C-group rewalks. main already reads **0** on both, so no arm can beat
them, and the rule would fail P72 by construction. Counting the one remaining
rewalk (O#25) instead would rest the verdict on a single position. The
positions corpus is saturated for what P72 claims, so improvement moves to
the proxy grid.

- **Positions** (the same 12, `grok-4.7`, reasoning on): **no-regression
  only**. The baseline is main's row, from P75's run: P 0, C 0, O 1/0, and
  0 fallbacks. P81 does not touch the BYOK seat-turn. The arm **fails** if
  either holds:
  - interior passes + rewalks + missed closes, summed over the 12, rises
    above main's (1);
  - any single position is worse than main on any reading (interior pass,
    rewalks, missed close, fallback).
- **Improvement: proxy grid.** 6 cells, `grok-4.20-0309-non-reasoning`,
  K = 20, measured against the **post-P81 proxy baseline**, which is
  in the section above (mean 0.326). The arm **passes** only if both hold:
  - its mean score is at least **+0.05** above the baseline mean, i.e.
    **≥ 0.376**;
  - at least **4 of 6** cells score at or above their baseline cell (0.130,
    0.564, 0.120, 0.400, 0.081, 0.661).

  The margin exists because jev may not be deterministic, even though grok at
  temperature 0 is.
- **Any invalid cell fails the arm**, as before. A cell is invalid when its
  fallbacks exceed 10% of its turns after one rerun. Advisor failures are not
  fallbacks: an unadvised completion still plays. They are reported
  separately.
- **Copy rate, reported on both tiers, gate or no gate.** It is the share of
  advised completions where grok's first pick equals jev's top pick. The
  2026-10-28 A/B measured 37/39. A copy rate that high means the seat defers
  rather than weighs, and that is a finding even if the gate passes.
- **Money.** xAI ≤ **$2.50** in total: the positions run plus one proxy run.
  A re-run needs the human's OK. jev ≤ **$0.50**. Every run passes
  `--max-usd` (xAI) and `--advisor-max-usd` (jev).

### P72 — decision-API advisor: **FAIL, parked** (2026-11-02)

Branch `parked/p72-decision-api-advisor`. Measured at `58e5ff3`, which is main
`a0f1dc2` (P80 + P75 + P81) plus the advisor and the bench's `--advisor jev`
arm. jev answered as `jev-1.14.0` on every call, with 0 advisor failures in
222 calls. Cost: xAI **$1.68** ($1.10 positions + $0.58 proxy), jev
**$0.03**.

**Positions (12, `grok-4.7`, reasoning on): no-regression fails.**

| reading | main (P75 row) | P72 | gate |
|---|---|---|---|
| P stall: interior passes | 0 | 0 | ✔ |
| C cycle: rewalks | 0 | **1** (#43: 0 → 1) | **regression ✘** |
| O ordinary: rewalks / missed closes | 1 / 0 | 1 / 0 (#25) | ✔ |
| fallbacks | 0 | 0 | ✔ |
| sum over the 12 | 1 | **2** | **✘** (must not rise) |
| prompt tokens per call | 4,632 | 4,740 (+2.3%) | — |

**Proxy (6 cells, `grok-4.20-0309-non-reasoning`, K = 20): improvement fails.**

| | s1-first | s1-second | s2-first | s2-second | s3-first | s3-second | mean |
|---|---|---|---|---|---|---|---|
| post-P81 baseline | 0.130 | 0.564 | 0.120 | 0.400 | 0.081 | 0.661 | 0.326 |
| P72 | **0.462** | 0.385 | **0.566** | 0.200 | **0.512** | 0.188 | **0.385** |
| ≥ baseline? | ✔ | ✘ | ✔ | ✘ | ✔ | ✘ | 3 of 6 |

- The mean clears the +0.05 bar (0.385 ≥ 0.376), but only **3 of 6** cells
  reach their baseline, and the gate needs 4. All 6 cells were capped at
  round 20 with 0 fallbacks, so none is invalid.
- **The effect splits by seat order.** Advice lifts every first-seat cell by
  +0.33 to +0.45 and lowers every second-seat cell by −0.18 to −0.47. A mean
  that hides a seat-order sign flip is not a uniform improvement. One run per
  arm cannot say whether the split is real or seed noise.

**Copy rate: grok defers to jev rather than weighing it.**
- **Positions:** grok-4.7 played jev's top pick on **23/25** advised
  completions (92%).
- **Proxy:** grok-4.20 did on **167/197** (85%). Per cell it ranged from
  25/33 to 29/29.
- The 2026-10-28 A/B measured 37/39. On every reading so far, an advised seat
  is mostly jev with a chat model's latency.
- jev's top pick was the offer's **last row** in 75/197 proxy completions and
  11/25 position completions. At all four C positions it was row 8 of 9. The
  last-row lean the research note found persists in 1.14.0.

**Why it is parked, not merged.** It fails both checks:
- **Positions:** a new rewalk at C#43.
- **Proxy:** 3 of 6 cells.

The copy rate says the annotation format makes grok follow jev rather than
weigh it, so what the gate measures is jev's play, not advice. A softer
format, or a decision model that is stronger on its own, would be a new arm.
It is not a re-run of this one.

**Spend:** P72 used $1.68 of its $2.50 xAI cap and $0.03 of its $0.50 jev cap.

## P82: long game and 3-player check (2026-11-02)

These run on main at `a0f1dc2` (P80 + P75; P72 parked) with the proxy model.
The full write-up is in [`byok-long-game.md`](./byok-long-game.md).

- **Long game, 2 players, cap 150: the BYOK seat lost all 6 cells.** It was
  eliminated at rounds 62–116, so there are 0 wins and rounds-to-win has no
  value yet.
- **Cause: production.** In 5 of 6 cells the opening walks past the offer's
  `tipDist` cap of 17 with nothing to close. At round 20 the heuristic leads
  income in 5 of 6 cells, and afterwards small enemy closures take shares
  faster than the seat replaces them.
- **Missed closes and stalls are minor.** After round 20 the seat closed in
  61 of the 66 turns where a close was available, and stalled 0 times.
- **P76 trigger: the bleed half is met** (unanswered closure bleeds in 6/6
  cells). Unparking is the human's call.
- **3 players, K = 20: the smoke check passes.** 9/9 cells are valid, with
  0 fallbacks and a mean of 0.184. Seat order dominates: the third seat
  averages 0.335.
- **Cost:** $5.13. That is $3.40 for the long run (including a partial cell
  cut off by its per-worker spend share), $0.82 for that cell's rerun and
  $0.91 for the 3-player run.

**Budget since the $10 top-up** ($11.01 available): post-P81 baseline $0.62,
P72 $1.68, P82 $5.13. **Spent $7.43; about $3.58 left.**

### P83 — BYOK opening: gate predeclared (2026-11-02)

[Packet](../design/packets/P83-byok-opening-close-near-home.md). This gate is
fixed here before any paid P83 run. The arm is main (P80 + P75 + P81) plus
P83's offer rows: `homeIn=`, `leaves_horizon`, `none` for the 17 sentinel,
and `ifHome=` on the tips line.

**The main reading is P82's long grid**, so the baseline is P82's `long150`
results (with the `s3-second` rerun). **It is not re-measured.**

**Improvement** (2 players, cap 150, `grok-4.20-0309-non-reasoning`, 6 cells).
The arm passes only if both hold:

- **(a)** BYOK income at round 20 is above P82's in at least **4 of 6** cells.
  P82's per-cell round-20 incomes:

  | cell | P82 income at r20 |
  |---|---|
  | s1-first | 1/4 |
  | s1-second | 1/2 |
  | s2-first | 1/3 |
  | s2-second | 1/2 |
  | s3-first | 1/4 |
  | s3-second | 7/3 |

- **(b)** At least **1 win**, **or** mean rounds survived ≥ **95.3**. That is
  P82's mean of 85.3 plus 10; P82's rounds were 70, 108, 70, 86, 62 and 116.

**No-regression checks:**
- **Positions:** the 12 positions on `grok-4.7`. Interior passes + rewalks +
  missed closes, summed, must not exceed main's **1**, and no single position
  may be worse than main on any reading.
- **Proxy K = 20 grid:** compared against the post-P81 baseline `pbase81`
  (mean 0.326). The mean must be **≥ 0.326**, with no invalid cell.

**Any invalid cell fails the arm.** A cell is invalid when its fallbacks
exceed 10 % of its turns after one rerun.

**Money.** The xAI balance is $13.65. P83's total cap is **$8.00**: about
$5.00 for the long grid, $1.20 for positions and $0.90 for K = 20. Every run
passes `--max-usd`.
- The long grid runs at `--concurrency 3 --max-usd 5`, a $1.67 share per
  worker. One long cell cost up to $1.03 in P82, so no cell should abort on
  its share.
- An aborted cell is re-run alone, with a small cap, only if the total stays
  under $8.00.
- Any other re-run needs the human's OK.

**Also recorded for the first time:** each BYOK turn's `plan` and `why`, so
"named in plan" is checkable.

### P83 — BYOK opening: **FAIL, parked** (2026-11-02)

Branch `parked/p83-byok-opening`. Measured at `2e486b5`, which is main
`3eb72a2` (P80 + P75 + P81) plus P83's rows (`homeIn=`, `leaves_horizon`,
`none`, and `ifHome=` on the tips line). Offer growth was 7.4–8.5 %. Results
are in `packages/web/bench/results/*-2e486b537cd5-*-p83*.json` in the P83
worktree (gitignored).

**Improvement: the long grid passes** (2 players, cap 150, proxy, against
P82's `long150`):

| cell | P82 income at r20 | **P83 income at r20** | above? | P82 rounds | **P83 rounds** | P83 outcome | P82 first own close | **P83 first own close** | P83 cost |
|---|---|---|---|---:|---:|---|---|---|---:|
| s1-first | 1/4 | **1/2** | ✔ | 70 | 78 | eliminated | r39 | **r6** | $0.44 |
| s1-second | 1/2 | **49/36** | ✔ | 108 | ≥ 117 | stopped by budget, alive | r3 | r2 | $1.66 |
| s2-first | 1/3 | **7/12** | ✔ | 70 | **128** | eliminated | r22 | **r6** | $0.95 |
| s2-second | 1/2 | **17/12** | ✔ | 86 | ≥ 107 | stopped by budget, alive | r2 | r2 | $1.23 |
| s3-first | 1/4 | 1/4 | ✘ (equal) | 62 | 64 | eliminated | r40 | **r3** | $0.36 |
| s3-second | 7/3 | 1/4 | ✘ | 116 | ≥ 100 | stopped by budget, alive | r11 | r50 | $0.72 |

- **(a)** Round-20 income is above P82's in **4 of 6** cells. ✔
- **(b)** There are 0 wins. Mean rounds survived is **≥ 99.0**, against P82's
  85.3 and the bar of 95.3. ✔
  - Three cells hit the run's per-worker spend share while the BYOK seat was
    still alive. P83's games last longer than P82's, and s1-second alone cost
    $1.66.
  - Their rounds are lower bounds. A lower bound is safe for a "≥" bar: the
    seat survived at least that long.
  - They were not re-run, because the budget could not cover them.
- **s3-first was skipped** when the run's cap was reached. It was then run
  alone under its own cap (`--max-usd 1.3`), as the gate allows.
- **No invalid cell.** Fallbacks were 0–1 per cell (two failed fetches and
  one illegal tail), out of 64–128 turns.

**No regression on positions fails** (12 positions, `grok-4.7`, $1.07):

| reading | main | P83 | gate |
|---|---|---|---|
| P stall: interior passes | 0 | 0 | ✔ |
| C cycle: rewalks | 0 | **1** (#43: 0 → 1) | **regression ✘** |
| O ordinary: rewalks / missed closes | 1 / 0 | 1 / 0 (#25) | ✔ |
| fallbacks / parse rate | 0 / 1.000 | 0 / 1.000 | ✔ |
| sum over the 12 | 1 | **2** | **✘** |
| prompt tokens per call | 4,632 | 4,741 (+2.4 %) | — |

**No regression on the proxy K = 20 grid passes** ($0.51):

| | s1-first | s1-second | s2-first | s2-second | s3-first | s3-second | mean |
|---|---|---|---|---|---|---|---|
| `pbase81` | 0.130 | 0.564 | 0.120 | 0.400 | 0.081 | 0.661 | 0.326 |
| P83 | 0.512 | 0.267 | 0.531 | 0.771 | 0.081 | 0.472 | **0.439** |

All 6 cells were valid, with 0 fallbacks over 208 calls. That clears
≥ 0.326, but two cells are below their baseline. This check gates on the
mean, so that does not fail it.

**Verdict: FAIL.** The positions regression at C#43 fails the arm,
whatever the long grid shows. This is the same position and reading that
parked P72. The opening improvement is real on the proxy:
- first own closes moved to r2–r6 in 5 of 6 cells;
- round-20 income rose in 4 cells;
- survival rose by at least 14 rounds on average.

It does not merge under this gate.

**What the new `plan`/`why` record shows**:
- **s1-first:** "expand" for 3 turns, then "close this trail to claim new
  shares" from turn 4, and a close at r6.
- **s3-second, the cell that got worse:** "advance the 3-stack outward to
  claim the spawner at tiling:v:3,-3,down" for most of its opening. The seat
  followed `advances=` rows outward, and played 5 of the 29 `leaves_horizon`
  rows offered in rounds 1–20.

**Spend.**
- P83 used **$6.94** of its $8.00 cap: long grid $5.00, s3-first $0.36,
  positions $1.07, K = 20 $0.51.
- The xAI balance was $13.65 before P83, so about **$6.71** is left.

