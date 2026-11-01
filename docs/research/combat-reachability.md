# Is combat reachable?

Research note for [P78](../design/packets/P78-combat-reachability-probe.md).
This is a measurement only: no rule, constant or heuristic changed. It reports
ratios, not verdicts.

**Question.** The 2026-10-29 playtest
([FINDINGS §3](./playtest-2026-10-29/FINDINGS.md)) ended at **605 steps · 62
closes · 7 cuts**. From seat B's chair, *"no head was ever killed in head-to-head
combat"*. Is the §6.2 exchange reachable at default board size, or does
enclosure crowd it out?

## Headline

**Combat is reachable, and for the heuristic seat it is how most heads die.**
Across the 16-cell grid, **83–85 % of all heads lost were lost in §6.2 combat**
(417 of 489 with two seats, 1361 of 1648 with three). The share is between 76 %
and 96 % in every cell, and **every first death in the grid is a combat death**.

**The 2026-10-29 log has combat in it too.** Replayed through the harness, it
contains **5 attacks costing 7 heads**, which is 35 % of the 20 heads lost.
Two of those 7 were seat B's: at moves 361 and 677, a C stack of 3 attacked a
lone B head. So FINDINGS §3's *"no head was ever killed in head-to-head
combat"* does not survive replay. What does survive is the seat-level reading.
B lost 13 heads: 2 to combat and 11 to encirclement, 6 of those in one closure
at move 389. For B, enclosure was the main killer. Combat started late: first
contact at seat-turn 56 (round ≈ 19), first death at seat-turn 83 (round ≈ 28).

Three more readings, all stated as ratios:

- **Evaporation killed nobody, anywhere**: 0 in every match. That is §6.1 as
  written (P12: *"Evaporation does not kill heads"*), not an accident of play.
- **Most encirclement is not capture inside a closing loop.** 68 of 72
  (two seats) and 230 of 287 (three seats) converted heads changed owner on a
  step that closed nothing. Territory does not change hands without a closure,
  and P28 refuses a step that would convert the mover's own stack. So these are
  stacks already standing on another seat's ground whose trail lost its
  territory grade on that step (§6.3). Closures that claimed
  enemy heads were rare: none with two seats, 8 of 754 closures with three.
- **Closures are mostly land bridges**: 89 % (two seats) and 83 % (three seats).
  The playtest log is at 61 % (38 of 62).

The two grok logs end before any seat touches another (8 and 5 rounds), so they
show no contact and no death.

## Method

The harness is `packages/web/bench/src/reach.ts`, run by the `reach` tier of
P79's bench (`pnpm byok-bench reach`). It replays each match through
`rules.apply` and reads every apply from outside the core. It uses only the
before/after diff plus two port **queries**: `combatLosses` (§6.2) and
`closureOf` (§7). The core is not instrumented.

**Head losses, kept separable.** For each apply the harness builds the
occupancy the move itself should leave (split, merge, or the §6.2 exchange as
`combatLosses` prices it). It then compares that with what `apply` returned,
arrow by arrow:

| Cause | Read as |
|---|---|
| **combat** | the §6.2 exchange on the step's destination (both sides' losses) |
| **encirclement** | heads that changed owner without moving (§6.3). These are converted, not killed, but the loser loses them all the same |
| **evaporation** | any other head that left a living seat. §6.1 says evaporation kills nobody (P12), so this should read 0. It is counted, not assumed |
| **vanished** | heads removed with a seat that lost on that apply (§9) |

Anything the harness cannot explain throws instead of guessing: heads appearing
mid-turn, a conversion that gained heads, territory growing without a closure
claim, or a combat round that wipes neither side. The last one fires if a
retuned §6.2 table ever needs more than one round to wipe a side.

**Closures by kind.** A close is the summary's close: some seat's territory
grew. Its kind comes from `closureOf` on the pre-step state:

- **land bridge**: `enclosed` is empty, so the path itself becomes territory
- **area capture**: `enclosed` is not empty
- **capture with enemy heads**: the claimed ground (path or pocket) held at
  least one enemy head before the step. This kind wins over the other two, and
  each closure counts once however many arrows or heads it took

**Contact and first death.** *Contact* is a measurement definition, not a
rule. It is the first step whose destination holds an enemy stack, enemy trail
or enemy territory, or a closure that claims enemy heads. *First death* is the
first apply that costs any seat a head, by any cause. The gap between them is
counted in **seat-turns** (end-turns), so a round is `playerCount` seat-turns.

**Correctness, fixture-verified.** Two test files back the counts:

- `bench/test/reach.core.test.ts` covers the packet's scenario inventory, on
  hand-authored states on the generated tiling. Each scenario also checks the
  board that `apply` produced. The tiling is used rather than a fixture board
  because a finite board encloses everything (§11 item 36) and so can never
  show a land bridge. Scenarios:
  - a step onto an enemy stack counts as combat (2 v 2: 1 + 2 heads), not
    encirclement
  - a head inside a ring closure counts as encirclement, not combat
  - an evaporation kill lands in its own bucket. This uses a hand-edited
    after-state, since `apply` never kills by evaporation; the real after-state
    reads 0
  - a land bridge and an area capture are told apart
  - one enemy head on a closure of 7 or more arrows counts as one closure and
    one head
  - a removed seat counts as vanished
  - contact-to-death counts the end-turns between them
- `bench/test/reach.replay.test.ts` replays all three corpus logs. The
  2026-10-29 log reproduces **605 / 62 / 7** (and its whole summary line). On
  **every** apply of every log, heads off the board equal combat + evaporation
  + vanished − births, so encirclement nets to zero across seats. Closure kinds
  sum to the summary's closes, and a second scoring is identical.

Run them with `pnpm byok-bench:test packages/web/bench/test/reach`.

## The archived matches

All three corpus logs use the playtest board: 3 seats, `R` 7, `homeOffset` 5,
`spawnerSeed` 1, `dominationN` 5.

Columns: *combat / encirclement / evaporation / vanished* are heads lost by
cause. *(no closure)* is the part of encirclement that happened on a step that
closed nothing. *Combat share* is combat ÷ all heads lost. *Attacks* counts
steps onto an enemy stack. Closures read *land bridge / area capture / with
enemy heads*, with the enemy heads those closures claimed in brackets. Contact
and death are seat-turn indices (end-turns before the move), and *gap* is the
difference.

| match | rounds | steps · closes · cuts | combat | encirclement (no closure) | evaporation | vanished | combat share | attacks | bridge / area / with-enemy (enemy heads) | first contact → first death (seat-turn) | gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `grok-2026-09-10T0657` | 8 | 55 · 7 · 0 | 0 | 0 (0) | 0 | 0 | — | 0 | 4 / 3 / 0 (0) | — → — | — |
| `grok-2026-09-10T1442` | 5 | 39 · 4 · 0 | 0 | 0 (0) | 0 | 0 | — | 0 | 2 / 2 / 0 (0) | — → — | — |
| `playtest-2026-10-29` | 38 | 605 · 62 · 7 | 7 | 13 (4) | 0 | 0 | 35% | 5 | 38 / 22 / 2 (8) | 56 → 83 (combat) | 27 |

Playtest log, per seat:

| seat | lost to combat | lost to encirclement |
|---|---|---|
| A | 3 (moves 371, 395, 469) | 2 (move 445) |
| B | 2 (moves 361, 677) | 11 (moves 389, 633, 720) |
| C | 2 (moves 371, 395) | 0 |

These counts come from the per-apply readings; the corpus test checks that
every head is accounted for.

## The grid

**Configuration.** `homeOffset` ∈ {3, 5} × `R` ∈ {5, 7} × `playerCount`
∈ {2, 3} × `spawnerSeed` ∈ {1, 2}, with `dominationN` 5. That is 16 matches,
heuristic seat (`playBotTurn`) in every chair, no model calls. **Round cap
100**: mirror matches do not end on their own
([byok-benchmark.md, "Mirror"](./byok-benchmark.md)), and no grid match ended
before the cap either (no winner, no seat removed). Run at `27e1ff7` (clean
tree). `reach.ts` and `reachTier.ts` are unchanged from that commit in this PR.
Wall time was 1206 s on 8 worker processes.

Columns: *combat / encirclement / evaporation / vanished* are heads lost by
cause. *(no closure)* is the part of encirclement that happened on a step that
closed nothing. *Combat share* is combat ÷ all heads lost. *Attacks* counts
steps onto an enemy stack. Closures read *land bridge / area capture / with
enemy heads*, with the enemy heads those closures claimed in brackets. Contact
and death are seat-turn indices (end-turns before the move), and *gap* is the
difference.

#### 2 seats, R 5

| match | rounds | steps · closes · cuts | combat | encirclement (no closure) | evaporation | vanished | combat share | attacks | bridge / area / with-enemy (enemy heads) | first contact → first death (seat-turn) | gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `p2-R5-h3-s1` | 100 | 336 · 49 · 21 | 45 | 12 (12) | 0 | 0 | 79% | 28 | 41 / 8 / 0 (0) | 30 → 30 (combat) | 0 |
| `p2-R5-h3-s2` | 100 | 320 · 45 · 12 | 40 | 7 (7) | 0 | 0 | 85% | 32 | 41 / 4 / 0 (0) | 19 → 19 (combat) | 0 |
| `p2-R5-h5-s1` | 100 | 354 · 55 · 10 | 41 | 8 (6) | 0 | 0 | 84% | 26 | 50 / 5 / 0 (0) | 54 → 54 (combat) | 0 |
| `p2-R5-h5-s2` | 100 | 401 · 50 · 20 | 80 | 12 (11) | 0 | 0 | 87% | 44 | 45 / 5 / 0 (0) | 45 → 46 (combat) | 1 |

#### 2 seats, R 7

| match | rounds | steps · closes · cuts | combat | encirclement (no closure) | evaporation | vanished | combat share | attacks | bridge / area / with-enemy (enemy heads) | first contact → first death (seat-turn) | gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `p2-R7-h3-s1` | 100 | 336 · 49 · 21 | 45 | 12 (12) | 0 | 0 | 79% | 28 | 41 / 8 / 0 (0) | 30 → 30 (combat) | 0 |
| `p2-R7-h3-s2` | 100 | 320 · 45 · 12 | 40 | 7 (7) | 0 | 0 | 85% | 32 | 41 / 4 / 0 (0) | 19 → 19 (combat) | 0 |
| `p2-R7-h5-s1` | 100 | 378 · 40 · 19 | 46 | 2 (2) | 0 | 0 | 96% | 30 | 36 / 4 / 0 (0) | 24 → 40 (combat) | 16 |
| `p2-R7-h5-s2` | 100 | 401 · 50 · 20 | 80 | 12 (11) | 0 | 0 | 87% | 44 | 45 / 5 / 0 (0) | 45 → 46 (combat) | 1 |

#### 3 seats, R 5

| match | rounds | steps · closes · cuts | combat | encirclement (no closure) | evaporation | vanished | combat share | attacks | bridge / area / with-enemy (enemy heads) | first contact → first death (seat-turn) | gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `p3-R5-h3-s1` | 100 | 929 · 104 · 59 | 227 | 36 (25) | 0 | 0 | 86% | 127 | 86 / 17 / 1 (1) | 56 → 56 (combat) | 0 |
| `p3-R5-h3-s2` | 100 | 811 · 88 · 39 | 144 | 24 (23) | 0 | 0 | 86% | 95 | 76 / 11 / 1 (1) | 28 → 28 (combat) | 0 |
| `p3-R5-h5-s1` | 100 | 830 · 95 · 54 | 174 | 52 (44) | 0 | 0 | 77% | 115 | 80 / 14 / 1 (2) | 119 → 119 (combat) | 0 |
| `p3-R5-h5-s2` | 100 | 869 · 101 · 43 | 154 | 48 (36) | 0 | 0 | 76% | 105 | 86 / 15 / 0 (0) | 107 → 114 (combat) | 7 |

#### 3 seats, R 7

| match | rounds | steps · closes · cuts | combat | encirclement (no closure) | evaporation | vanished | combat share | attacks | bridge / area / with-enemy (enemy heads) | first contact → first death (seat-turn) | gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `p3-R7-h3-s1` | 100 | 929 · 104 · 59 | 227 | 36 (25) | 0 | 0 | 86% | 127 | 86 / 17 / 1 (1) | 56 → 56 (combat) | 0 |
| `p3-R7-h3-s2` | 100 | 811 · 88 · 39 | 144 | 24 (23) | 0 | 0 | 86% | 95 | 76 / 11 / 1 (1) | 28 → 28 (combat) | 0 |
| `p3-R7-h5-s1` | 100 | 830 · 95 · 54 | 174 | 52 (44) | 0 | 0 | 77% | 115 | 80 / 14 / 1 (2) | 119 → 119 (combat) | 0 |
| `p3-R7-h5-s2` | 100 | 746 · 79 · 27 | 117 | 15 (10) | 0 | 0 | 89% | 65 | 56 / 21 / 2 (3) | 69 → 69 (combat) | 0 |

**Under which configurations combat is more common:**

| | heads lost | combat | combat share | attacks | steps | closures (bridge share) |
|---|---|---|---|---|---|---|
| 2 seats, all 8 | 489 | 417 | 85 % | 264 | 2846 | 383 (89 %) |
| 2 seats, `homeOffset` 3 | 208 | 170 | 82 % | 120 | | |
| 2 seats, `homeOffset` 5 | 281 | 247 | 88 % | 144 | | |
| 3 seats, all 8 | 1648 | 1361 | 83 % | 844 | 6755 | 754 (83 %) |
| 3 seats, `homeOffset` 3 | 862 | 742 | 86 % | 444 | | |
| 3 seats, `homeOffset` 5 | 786 | 619 | 79 % | 400 | | |

- **Seat count is the strongest lever on volume.** Three seats lose about
  3.4× the heads that two seats do, over the same 100 rounds, at about the same
  combat share.
- **`homeOffset` moves *when*, not *whether*.** With three seats, first
  contact comes at seat-turn 28–56 for `homeOffset` 3 and at 69–119 for
  `homeOffset` 5. With two seats the spread overlaps (19–30 against 24–54).
  The combat share barely moves.
- **`R` was inert inside 100 rounds** for most of the grid. Six of the eight
  `R` 5 / `R` 7 pairs read identically on every counter: the summary, every
  loss bucket, every closure kind, and first contact and death. `R` only
  changes spawners beyond radius 5 (the bands are equal up to 5), and play in
  those six matches evidently never reached that far. The two pairs that
  differ (`p2-*-h5-s1`, `p3-*-h5-s2`) both have homes at radius 5.
- **Contact usually *is* the first death.** In 12 of 16 cells the first step
  that touches an enemy is an attack that kills on the spot (gap 0). The
  largest gap is 16 seat-turns (`p2-R7-h5-s1`).

## Open question for §11

**No §11 item is proposed.** The packet asks for one only *if* the answer is
"effectively never at default settings", and it is not. The playtest board
(3 seats, `R` 7, `homeOffset` 5) produced combat in the human/LLM playtest and
in both heuristic matches on it (`p3-R7-h5-s1`, `p3-R7-h5-s2`).

Two readings the human may want to weigh. Neither is a rules gap, so neither
goes to §11 from here:

- **Whether bots or humans fight is a separate question.** The heuristic seat
  attacks readily, so this grid shows combat is *reachable* and nothing about
  whether good players *choose* it (the packet scopes that out). The
  human/LLM playtest sits between the two: combat was 35 % of its losses.
- **Encirclement mostly happens without a closure.** The bulk of §6.3
  conversions come from losing territory grade, not from being inside a loop.
  That matches FINDINGS §3's *"the anchor concept is load-bearing and
  under-documented"*. B also lost two heads to it at move 633 with no closure.
  It is §6.3 as specified; whether players can *see* it coming is a UI
  question.

A doc drift spotted on the way, out of scope here: the vocabulary table in
`AGENTS.md` still says a front *"carries exactly one kill"*. SPEC §6.1 (P12)
says evaporation kills nobody.

## Reproducing

```bash
pnpm byok-bench reach --round-cap 100 --concurrency 8
```

That command writes `packages/web/bench/results/reach-<sha>-none-heuristic.json`
(gitignored) and prints one line per match. The tables above are that file's
`corpus` and `grid` arrays. Every reading is deterministic: the heuristic seat,
`makeMatch` and `rules.apply` are pure, and the harness visits arrows in id
order. **Rerun check:** `p2-R5-h3-s1` and `p3-R7-h5-s2` were run a second time
(`--tag rerun`, at `b1ee1f8`, same harness source). Both rows and the corpus
scores came out byte-identical. To score the corpus alone, run the replay test above. It
needs no grid and takes about 15 s.
