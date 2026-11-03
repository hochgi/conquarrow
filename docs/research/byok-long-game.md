# BYOK long game and 3-player check (P82, 2026-11-02)

[P82](../design/packets/P82-byok-long-game-and-three-seats.md) measured the final BYOK combination: main at `a0f1dc2`, which has P80 and P75, with P72 parked. The BYOK seat played `grok-4.20-0309-non-reasoning` (the proxy) against the post-P81 heuristic.

**Run 1** was the 2-player grid at a 150-round cap. **Run 2** was the 3-player grid at K = 20.

The audit replayed every match from its recorded moves, with no model calls. Its full per-event tables are kept outside the repo; every number below comes from them.

## Headline

**The BYOK seat lost every long game.** The heuristic eliminated it in all 6 cells, between rounds 62 and 116. Rounds-to-win, the human's original target, therefore has no value yet: there are 0 wins.

| cell | outcome | rounds | how it ended | cost |
|---|---|---:|---|---:|
| s1-first | eliminated | 70 | territory 0 (enemy land bridge) | $0.42 |
| s1-second | eliminated | 108 | starved: no heads, shares 0 | $1.03 |
| s2-first | eliminated | 70 | territory 0 (enemy area capture) | $0.44 |
| s2-second | eliminated | 86 | starved while still holding 79 land | $0.78 |
| s3-first | eliminated | 62 | starved | $0.51 |
| s3-second | eliminated | 116 | starved while still holding 53 land | $0.82¹ |

There were 0 fallbacks in every cell, so every BYOK turn was the model's own.

¹ A rerun. The first run stopped at round 38 when it hit the harness's per-worker spend share ($5 cap ÷ 4 workers), not the run cap. That partial run cost $0.22, and its record is ignored.

## Why it lost: production, not tactics

**1. It walked past the distance horizon in the opening.**
- In 5 of 6 cells, the seat spent its opening walking one stack away from home. It played rows whose `tipDist` stayed at the offer's cap of 17 (no own territory within 16 grain steps) for runs of up to 31 turns.
- It built trails of 76–93 arrows with nothing to close.
- First own closes came at r22–r40 when it sat first, and at r2–r11 when it sat second.

**2. The heuristic out-produced it by round 20.**

At round 20 the heuristic was ahead on income in 5 of 6 cells:

| cell | BYOK income | enemy income | BYOK shares | enemy shares |
|---|---|---|---:|---:|
| s1-first | 1/4 | 47/18 | 3 | 17 |
| s1-second | 1/2 | 157/36 | 6 | 20 |
| s2-first | 1/3 | 107/36 | 4 | 21 |
| s2-second | 1/2 | 109/36 | 6 | 19 |
| s3-first | 1/4 | 49/9 | 3 | 26 |
| s3-second | **7/3** | 23/12 | **22** | 14 |

s3-second is the only cell the seat won the opening. It closed at r11 for +19 shares. The heuristic still overtook it by r40.

**3. Small enemy closures took its shares faster than it replaced them.**
- From the seat's peak in shares to the end, the heuristic made 6–50 closures per cell. 5–26 of them took BYOK shares, and most were land bridges.
- Attacks on stacks were occasional: 2–10 per cell.
- Births over that stretch: BYOK 0–10, heuristic 24–351.

**What did not lose it:**
- **Closing when it could.** After round 20 a close was available in 66 BYOK turns, and the seat closed in 61.
- **Stalls:** 0 in every cell.
- **Evaporation:** 0.
- **Combat** was a minority of its losses:

| cell | combat, defending | combat, attacking | encirclement | evaporation | removed at elimination | BYOK births | enemy births |
|---|---:|---:|---:|---:|---:|---:|---:|
| s1-first | 2 | 0 | 1 | 0 | 3 | 3 | 103 |
| s1-second | 11 | 2 | 7 | 0 | 3 | 20 | 256 |
| s2-first | 5 | 0 | 1 | 0 | 5 | 8 | 117 |
| s2-second | 9 | 1 | 7 | 0 | 3 | 17 | 170 |
| s3-first | 2 | 0 | 1 | 0 | 3 | 3 | 154 |
| s3-second | 15 | 0 | 10 | 0 | 2 | 24 | 390 |

- **A cut was never possible.** In all 514 BYOK turns, no legal step reached an enemy trail, so the seat could never answer with a cut. The heuristic's trail was 3–5 arrows at the start of each BYOK turn.

**Rewalks** after round 20 were 2–24 per cell. They concentrate in the late game, after the seat has lost its shares and has nothing to close. They are a symptom, not a cause.

## The audit (predeclared in P82)

Readings after round 20, per cell:

| cell | BYOK turns | missed closes | stalls | rewalks (turns) | bleeds | unanswered closure bleeds, full 3-turn window |
|---|---:|---:|---:|---|---:|---:|
| s1-first | 51 | 0 | 0 | 2 (1) | 11 | 7 |
| s1-second | 88 | 1 | 0 | 24 (17) | 19 | 2 |
| s2-first | 51 | 1 | 0 | 5 (3) | 6 | 2 |
| s2-second | 66 | 0 | 0 | 16 (13) | 17 | 5 |
| s3-first | 42 | 0 | 0 | 17 (16) | 8 | 6 |
| s3-second | 96 | 3 | 0 | 20 (17) | 44 | 15 |

**P76 unpark trigger: met on the bleed half.** Unanswered closure bleeds appear in all 6 cells, against a trigger of ≥ 2.
- The missed-goal half cannot be fully checked. The results do not record the model's `plan`/`why` text, so a missed close may have been named in a plan.
- As P82 says, unparking P76 is the human's call.

**Note on the horizon.** P76 is about memory and one-step depth. The decisive failure here is earlier and more basic: an opening walk past `tipDist = 17` that has nothing to close. Whether that is P76's job or a new offer-row packet is a design question for the human. It is not decided here.

## Run 2: 3-player smoke check, K = 20

| cell | score | cell | score | cell | score |
|---|---:|---|---:|---|---:|
| p3-s1-first | 0.091 | p3-s1-second | 0.059 | p3-s1-third | 0.186 |
| p3-s2-first | 0.059 | p3-s2-second | 0.127 | p3-s2-third | 0.349 |
| p3-s3-first | 0.192 | p3-s3-second | 0.123 | p3-s3-third | 0.469 |

**Passes the smoke check.**
- 9/9 cells are valid and all capped at round 20.
- 0 fallbacks over 338 calls, and parse rate 100 %.
- The mean is 0.184.

Seat order dominates: the third seat averages 0.335, the second 0.103 and the first 0.114. There is no 3-player baseline, so this is a reference reading, not a comparison.

## Cost

| run | cost |
|---|---:|
| long150 (5 scored cells + the aborted partial) | $3.40 |
| s3-second rerun | $0.82 |
| p3k20 | $0.91 |
| **P82 total** | **$5.13** |

The predeclared caps were $5.00 + $1.50.

## P83: the opening arm (2026-11-02)

[P83](../design/packets/P83-byok-opening-close-near-home.md) tested an
offer-row fix for the opening walk. Every off-territory row prints `homeIn=`,
this portion's own turns until it can land home. The step that crosses a
2-turn horizon is tagged `leaves_horizon`. The 17 sentinel prints `none`, and
each exposed tip shows `ifHome=+L share+S`. It re-ran this grid at the same
cap. **It failed its gate on the positions no-regression check, so it is
parked.** On this grid:

| cell | rounds (P82 → P83) | income at r20 (P82 → P83) | first own close (P82 → P83) |
|---|---|---|---|
| s1-first | 70 → 78 | 1/4 → **1/2** | r39 → **r6** |
| s1-second | 108 → ≥ 117 (alive when the budget stopped it) | 1/2 → **49/36** | r3 → r2 |
| s2-first | 70 → **128** | 1/3 → **7/12** | r22 → **r6** |
| s2-second | 86 → ≥ 107 (alive when the budget stopped it) | 1/2 → **17/12** | r2 → r2 |
| s3-first | 62 → 64 | 1/4 → 1/4 | r40 → **r3** |
| s3-second | 116 → ≥ 100 (alive when the budget stopped it) | 7/3 → 1/4 | r11 → r50 |

- **The walk-away opening is mostly gone.** The three cells whose first own
  close came at r22–r40 now close by r6, and 5 of 6 cells close by r6.
- **Income at r20 rose** in 4 cells. Mean survival rose from 85.3 to at
  least 99.0.
- **There are still 0 wins.** Eliminations came at r64–r128.
- **s3-second got worse.** It had been P82's only good opening; now it chased
  an `advances=` spawner outward for 50 rounds.

Numbers and the gate are in the
[ledger](./byok-benchmark.md#p83--byok-opening-fail-parked-2026-11-02).

