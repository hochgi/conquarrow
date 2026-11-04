# P85 — The heuristic seat counts the race: tempo horizon

> **Status:** **parked 2026-11-04: failed two predeclared gates**, opening
> income (3.935 against ≥ 4.791) and speed (1.49 s per turn against ≤ 0.89 s).
> Every other gate held, land included (43.00, 1.77×). See
> [the result](#result-2026-11-04-fail-parked). The code, spec and tests are on
> branch `parked/p85-heuristic-tempo-horizon` (`462a340` plus this record),
> which was reviewed (ship-ready, no blocking findings) and green under
> `pnpm verify`, and is not merged.
> **Depends on:** P53 (beam),
> P55 (one-ply replies), P59 (missions and the threatened-kite gate), P81
> (the finisher; `mirror` / `reach` acceptance), P84 (never idle).
>
> **Evidence:**
> - Playtest 2026-11-03 ([findings](../../research/playtest-2026-11-03/FINDINGS.md)):
>   with P84 in, the human still wins easily, at r38. At r20 the human holds
>   113 land against the bots' 24 and 21, and income 6.69 against 1.94 and
>   1.03. The human averages about 13 land per close; the bots average 2–3.
> - Playtest 2026-11-02 ([findings](../../research/playtest-2026-11-02/FINDINGS.md)):
>   the same shape before P84 (human wins at r42; r20 land 66 against 11 and 26).
> - The human's observation (2026-11-03): the human was on a long trail that a
>   bot could have cut within two turns, while the human needed three to close.
>   The bot never moved toward it.
>
> **SPEC coverage:** none. This is the heuristic seat in `packages/web`.
> **No rules change**, so nothing is owed to SPEC §11.

> **Diagnosis (2026-11-03, before the fix):** the two lists, recorded in the
> [spec](../../spec/heuristic-tempo-horizon/heuristic-tempo-horizon.md#diagnosis-recorded-before-the-fix).
> - **Missed intercepts:** 45 won races over both playtests and the three
>   mirror games. 6 multi-turn misses, all because no mission refers to an
>   enemy trail that is not cuttable this turn. 5 more misses had a cut legal
>   (a P81-dominant seat's finisher ignores it): a different defect, left out.
> - **Small sorties:** 181 heuristic closes, mean loot 2.73; 43 small sorties
>   (loot ≤ 3 at W ≥ 4), 37 by non-dominant seats. Traced stage by stage, the
>   main cause is `evaluate`'s one-turn horizon (the larger sortie is in the
>   search at 39 of 43 starts and scores below staying home). P59's 12-step
>   threat test is a second cause (5 starts, every one at W ≥ 4). P55 never
>   fired.
> - **Decided:** a half-value sortie credit inside a safe window and a
>   whole-sortie cap; P59's threat test reads the race; an `intercept`
>   mission. A throwaway prototype met the land (1.77×) and fixture gates and
>   **missed two: income (1.23×) and speed (1.51 s per turn)**. The speed
>   comes from heavier positions in longer games, not from the new readings.

## Intent

The heuristic seat's horizon is one turn. Two weaknesses follow from that one
cause (the human's diagnosis, and the code agrees):

1. **It never punishes a long trail it cannot reach this turn.** The `cut`
   mission switches on only when a cut is legal at the origin (`cutAvailable`,
   `botMission.ts`). An enemy trail two turns away is invisible.
2. **It never takes a big first close.** The threat model is one enemy reply
   (P55, `botReply.ts`), and P59's threatened-kite gate penalises any trail an
   enemy could cut next turn. Without a sense of *how many turns* until an
   enemy can arrive, the seat keeps every trail short, even in an opening
   where no rival can arrive for 7–8 turns.

P85 gives the seat a **tempo horizon**: race arithmetic over several turns,
from distances it already computes and from `speed(N)`. It is **not** a deeper
search. Both readings are pure functions of the current state:

- **Own sortie, the safe window.** For a candidate trail, W = the number of
  turns before the nearest enemy stack can reach any arrow of it. The seat
  may plan a close whose remaining turns-to-land fit inside W. Early in the
  game W is wide, so a large first close becomes affordable. Late in the game
  W shrinks by itself.
- **Intercept, the race.** For each enemy trail, compare the enemy's turns
  to close (its tips' homeward distance ÷ speed) with my turns to reach any
  arrow of that trail. Turn order counts. If I win the race, march toward the
  trail over several turns, even with no cut legal this turn. If I cannot win
  it, an approach that shrinks the enemy's safe close is still worth
  something ("shadowing"). Whether shadowing is in scope is decision 5 below.

The seat keeps no memory between turns. Each turn it recomputes the same race,
and it keeps marching while the race is still won.

## Measured facts (2026-11-03, `main` `7299c3f`)

At R 7, `homeOffset` 5, spawner seed 1 (the playtest and `mirror` board):

| | 2 players | 3 players |
|---|---|---|
| each seat's starting stack → any rival's land (grain steps) | 14 and 16 | 16 |
| land → rival land | 14 | 14 |

The starting stack has 3 heads, so `speed(3)` = 2. A rival's stack needs about
7–8 turns to reach the home edge. The human's estimate was "about 13 steps,
about 7 rounds", which is close.

## BSSN (locked)

- **Heuristic seat only:** `botSearch.ts`, `botMission.ts`, `botClose.ts`,
  `botEvaluate.ts`, `botReply.ts`, `botFinish.ts`, `botNeverIdle.ts`,
  `opponent.ts`, and the finders they use.
- **Do not touch:**
  - `packages/rules-core` or `packages/contracts`;
  - `byokBot.ts` or anything else in the BYOK seat;
  - `packages/mcp/src`'s parked bot copy (note the drift only);
  - `online-api`'s `pagesHeuristic` (it calls `chooseMove`; if `chooseMove`
    changes, say so in the spec).
- **Race arithmetic, not search.** Do not raise `BEAM`, `BRANCH`,
  `MAX_PLAN`, `MAX_APPLIES` or the reply budgets to buy the horizon. The tempo
  readings are bounded distance computations (`grainDistance…`,
  `homewardPath`) divided by `speed`, with explicit caps.
- **Stateless and deterministic.** Nothing is stored on `GameState` or across
  calls. No randomness, no clocks. Ties break on `compareArrows` / `planKey` /
  `compareMoves`. Iteration over maps feeds no ordered decision without a sort.
- **New logic in a new pure module**, `packages/web/src/botTempo.ts`. The
  existing modules gain only wiring. `botSearch.ts` is about 1,120 lines, so
  run `hotspot-expansion-review` before extending it or `botMission.ts`.
- **Live seat first.** Nested enemy-reply searches (`withReplies: false`)
  stay as they are, unless the spec shows the reply model must change too.
  That would be decision 6.
- **P84's rule stands.** The seat never passes while a step is legal.
- **Out of scope:**
  - the other P81 follow-ups ("a cut counts as quiet", MCP drift);
  - the BYOK seat and its offer rows (P83 is parked separately);
  - difficulty levels;
  - re-measuring BYOK baselines.

## Decisions for phase 1 (decide BSSN and write them into the spec)

These are bot-strategy decisions, not game rules. Decide them from the
diagnosis. Escalate to the human only if one turns out to be a big behavioural
shift beyond what this packet already states.

1. **Turn order in the race.** In a 3-player game, which enemies' turns fall
   between mine and the trail owner's? State the exact turn arithmetic.
2. **Who threatens a sortie.** Use every enemy stack, or the nearest per enemy?
   Use full stack speed, or the speed after a split?
3. **How W enters the choice.** Options: a gate (refuse plans that overrun W),
   an evaluation term (scale the trail risk by the turns of margin), or a
   replacement for P59's threatened-kite test on the live seat. State what
   P59 keeps.
4. **How an intercept enters the choice.** Options: a mission (`intercept`,
   beside `cut`/`bank`/`contest`/`deny`), a campaign target, or an evaluation
   term. Say how a multi-turn march survives re-planning from scratch each
   turn without dithering.
5. **Shadowing when the race is lost:** in or out.
6. **The reply model.** Does P55's one-ply reply need the tempo reading too?
   Default: no.
7. **Caps.** Distance and turn caps, so the cost per turn stays bounded.

## Diagnosis first (free, no model calls)

Before choosing the decisions above, replay the two playtest logs
(`docs/research/playtest-2026-11-02/match-log.json`,
`docs/research/playtest-2026-11-03/match-log.json`) and the `mirror` tier
(baseline on `main`). Record two lists in the spec.

- **Missed intercepts:** turn starts where some bot stack could reach an
  enemy trail in fewer turns than that enemy needs to close it, and the bot
  did not move toward it. Also count the cases where it could have cut that
  turn and did not; those are a different defect.
- **Small sorties:** bot closes whose claimed land was small while the safe
  window W at the sortie's start was wide. Fix a threshold, for example W ≥ 4
  turns and loot ≤ 3 arrows.

Pick fixtures from both lists. They become the spec's scenarios and the
`positions`-style acceptance below.

## Acceptance (predeclared 2026-11-03, before any code change)

Baselines were measured on `main` `c7ee34c` (the spec's "Baselines" has the
detail). The fixture floors are the packet's 80 %, expressed in fixtures.
No gate is lowered.

| gate | baseline (`c7ee34c`) | required after P85 |
|---|---|---|
| **Intercepts:** at the 6 missed-intercept fixtures, the live seat's turn moves a stack strictly closer to the enemy trail, or cuts it | 0 / 6 | **≥ 5 / 6** |
| **Sorties:** at the 37 small-sortie fixtures (the turn the logged seat landed), the live seat's plan reaches for a larger close | 4 / 37 | **≥ 30 / 37** |
| **Opening land:** mean land per seat at r20 over the 6 `mirror` cells | 24.33 | **≥ 36.50** (1.5×) |
| **Opening income:** mean income per seat at r20 over the 6 `mirror` cells | 3.194 | **≥ 4.791** (1.5×) |
| never idle (P84): zero-step seat-turns with a legal step, 6 `mirror` cells | 0 | **0** |
| mirror cells that end with a winner within 200 rounds (P81) | 6 / 6 (56 B, 83 B, 44 A) | **≥ 5 / 6** |
| reach grid (`--round-cap 200`) cells that end (P81) | 15 / 16 (`p3-R7-h5-s2` capped) | **≥ 12 / 16** |
| combat share of heads lost, reach grid (P81) | 79 % (2,075 / 2,621) | **≥ 50 %** |
| no late stasis (P81): the seat ahead on heads takes ≥ 20 steps in every full 40-round mirror window | holds (≥ 76) | **holds** |
| determinism: two runs of each mirror cell give byte-identical move lists | holds (two runs, 6 / 6 cells) | **holds** |
| speed: mirror per-turn wall time (wall ÷ the longest cell's seat-turns, concurrency 6) | 99.0 s ÷ 167 = 0.59 s | **≤ 0.89 s** (1.5×) |

The human reference is not a gate: the human averaged 37–40 land at r10 and
66–113 at r20. The human plays P85 after it ships, and the result goes into
the ledger.

Before and after go side by side under "Mirror" in
`docs/research/byok-benchmark.md`.

## Consequences outside this packet (state them in the PR)

- **The BYOK proxy baselines predate P85**, as they already predate P84.
  Do not re-measure them here.
- **The `positions` tier is unaffected.** It never plays the heuristic.
- **The heuristic will take bigger risks in the opening.** That is intended.
  The P81 combat share and the end-within-200 gates are what keep it honest.

## Scenario inventory (phase 1 grows this from the diagnosis)

- A playtest position where the human's long trail is reachable in 2 turns and
  needs 3 to close: the bot moves toward it.
- The same position with the race lost by one turn: no march, or shadowing if
  decision 5 keeps it in.
- The opening position, before any rival has moved: the seat's plan starts a
  close larger than a land bridge.
- A sortie whose W is 1 turn: the seat stays short. P59's protection is
  unchanged where the threat is real.
- A cut that is legal this turn: taken as today; P85 does not weaken `cut`.
- A seat with no legal step still passes; a seat with a legal step never
  passes (P84).
- 3 players: the race counts the turns of the seat in between (decision 1).
- Determinism: the same position twice gives the same plan.

## Definition of done

- [x] Diagnosis recorded before the fix (spec).
- [x] Acceptance thresholds predeclared from baselines on `main`.
- [x] `pnpm verify` green (on the parked branch: 3,822 tests).
- [x] Acceptance measured and recorded before and after in
      `docs/research/byok-benchmark.md` under "Mirror".
- [x] Ledger and PR say that the BYOK proxy baselines predate P85.
- [x] MCP drift noted (spec decision 11).

## Result (2026-11-04): FAIL, parked

**Before** is `1d0673f` (bot code identical to `main` `c7ee34c`; it
reproduces the baseline exactly). **After** is `462a340`. Free tiers only,
concurrency 6, no model calls. The after mirror ran twice (phase 3 and phase
4) with byte-identical move lists.

| gate (predeclared) | before | after | required |
|---|---|---|---|
| intercept fixtures | 0 / 6 | **6 / 6** (phase 3's count; the suite's set gate passed) | ≥ 5 / 6 ✔ |
| sortie fixtures | 4 / 37 | **37 / 37** (phase 3's count; the suite's set gate passed) | ≥ 30 / 37 ✔ |
| mirror r20 land per seat | 24.33 | **43.00** (1.77×) | ≥ 36.50 ✔ |
| mirror r20 income per seat | 3.194 | **3.935** (1.23×) | ≥ 4.791 ✘ |
| zero-step seat-turns with a step legal | 0 | **0** | 0 ✔ |
| mirror cells ending ≤ 200 rounds | 6 / 6 (56 B, 83 B, 44 A) | **6 / 6** (85 B, 67 A, 100 B) | ≥ 5 / 6 ✔ |
| reach cells ending | 15 / 16 | **12 / 16** | ≥ 12 / 16 ✔ |
| reach combat share | 79 % | **82 %** (3,383 / 4,134) | ≥ 50 % ✔ |
| late stasis: leader's steps per full 40-round window | ≥ 76 | **≥ 105** | ≥ 20 ✔ |
| determinism | holds | **holds** | holds ✔ |
| mirror per-turn wall | 99.7 s ÷ 167 = 0.60 s | **299.7 s ÷ 201 = 1.49 s** (phase 3: 1.47 s) | ≤ 0.89 s ✘ |

**What it means.**
- **The seat does take bigger sorties.** Land at r20 rose 1.77×, every
  fixture passed, and the opening closes are no longer land bridges.
- **Income did not follow land.** Both mirror seats grow, and they contest
  the same spawners near their homes, so shares per seat rise far less than
  land (r20 per seat: s1 3.72 / 3.33, s2 5.33 / 2.97, s3 4.94 / 3.31). The
  phase-1 prototype predicted this (1.13–1.23× in every setting tried).
- **The speed cost comes from the games, not the readings.** Games run
  longer (longest cell 201 seat-turns against 167), and later positions
  cost more to search. In phase 1 the same positions cost the
  same with and without P85. Reach wall rose from 1,324 s to 2,211 s.
- **Three-seat games end later.** Reach still met its floor, but only just:
  four three-seat cells hit the 200-round cap (one before). One cell
  (`p3-R5-h5-s1`) lost 5 heads to "vanished", where every earlier run had 0.
  Nothing gates on it; it is recorded for whoever picks this up.

**For a successor packet.** The income gate measures something this design
does not target: it buys land, not shares. Either the sortie credit should
weight shares more (P54's `loot` already counts them), or the gate should be
restated by the human. The speed gate needs the cost of longer games
separated from per-position cost, for example per-turn wall on fixed
positions as well as whole games. Neither is decided here.

