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
