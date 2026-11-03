# P85 — The heuristic seat counts the race: tempo horizon

> **Status:** packeted 2026-11-03, not started. **Depends on:** P53 (beam),
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

## Acceptance (predeclare in phase 1, before any code change)

Measure every baseline on `main` before the red suite exists, write the
thresholds into this packet, and do not change them afterwards.

| gate | required after P85 |
|---|---|
| **Intercepts:** at the missed-intercept fixtures, the live seat's turn moves a stack strictly closer to the enemy trail, or cuts it | ≥ 80 % of fixtures |
| **Sorties:** at the small-sortie fixtures, the live seat's plan reaches for a larger close, or starts one | ≥ 80 % of fixtures |
| **Opening land:** mean land per seat at r20 over the 6 `mirror` cells | ≥ 1.5× the baseline |
| **Opening income:** mean income per seat at r20 over the 6 `mirror` cells | ≥ 1.5× the baseline |
| never idle (P84): zero-step seat-turns with a legal step, 6 `mirror` cells | 0 |
| mirror cells that end with a winner within 200 rounds (P81) | ≥ 5 / 6 |
| reach grid (`--round-cap 200`) cells that end (P81) | ≥ 12 / 16 |
| combat share of heads lost, reach grid (P81) | ≥ 50 % |
| no late stasis (P81) | holds |
| determinism: two runs of each mirror cell give byte-identical move lists | holds |
| speed: mirror per-turn wall time (wall ÷ the longest cell's seat-turns, concurrency 6) | ≤ 1.5× the baseline (P84 measured 0.58 s) |

The fixture percentages are a floor; phase 1 may raise them after seeing the
lists. The human reference is not a gate: the human averaged 37–40 land at
r10 and 66–113 at r20. The human plays P85 after it ships, and the result goes
into the ledger.

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

- [ ] Diagnosis recorded before the fix (spec).
- [ ] Acceptance thresholds predeclared from baselines on `main`.
- [ ] `pnpm verify` green.
- [ ] Acceptance measured and recorded before and after in
      `docs/research/byok-benchmark.md` under "Mirror".
- [ ] Ledger and PR say that the BYOK proxy baselines predate P85.
- [ ] MCP drift noted.
