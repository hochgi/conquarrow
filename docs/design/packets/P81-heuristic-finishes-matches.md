# P81 — The heuristic seat finishes matches

> **Status:** ready. **Depends on:** P55 (opponent ply), P79 (`mirror` tier),
> P78 (reach tier). The human called this a **defect** on 2026-11-02, after
> P78 reported.
>
> **Evidence** (`docs/research/byok-benchmark.md` "Mirror",
> `docs/research/combat-reachability.md`): **no heuristic-vs-heuristic match
> has ever ended.** That covers 6/6 cells at a 400-round cap and 16/16 grid
> cells at a 100-round cap, across 2 and 3 seats, `R` 5 and 7, and
> `homeOffset` 3 and 5. The heuristic fights readily (83–85 % of heads lost
> are combat), yet it never removes a seat.
>
> **SPEC coverage:** none. This is the heuristic seat in `packages/web`.
> **No rules change.** Any change that wants a rule is a §11 question for the
> human.

## Two symptoms

Both come from the archived mirror results; a rerun of
`pnpm byok-bench mirror` reproduces them.

1. **Late-game stasis while hoarding.** In seed 1 (first seat) the steps per
   40 rounds go `188, 125, 105, 82, 41, 4, 4, 3, 3, 2`. After about round 160
   the seat almost always ends its turn without moving. Its heads reach
   **1,238**. Seed 2 shows the same shape later and less sharply.
2. **No finishing drive.** In seed 3 the seat stays active to the cap (about
   130 steps per 40 rounds) and still never eliminates its opponent.

## Intent

Make the heuristic seat **turn a winning position into a win**. That means
spending a head surplus on expansion and on removing the opponent, under the
rules as they are: a seat with no territory loses, and a seat with no
spawner share for N full rounds starves (§9).

## BSSN (locked)

- **Diagnose before changing anything.** Use the `diagnosing-bugs`
  discipline on the seed-1 stasis. Replay the mirror moves to round ~160 and
  find out why `chooseTurnBeam` (`packages/web/src/botSearch.ts`,
  `BEAM = 8`) returns an empty turn. Hypotheses to check, not to assume:
  - **(a) Horizon shorter than the walk.** The head mass sits deep inside its
    own territory. Every step toward the edge scores as a "mill" inside the
    beam horizon, so nothing pays before the turn ends. This is P80's BYOK
    stall, seen in the heuristic.
  - **(b) The evaluation rewards hoarding.** `evaluate` values heads held more
    than the risk of laying trail, so any sortie lowers the score.
  - **(c) There is no finishing objective.** Nothing in the evaluation pulls
    toward an opponent's *last* territory or toward starving it.

  Record which hypothesis held, with the evidence, in the packet spec before
  writing the fix.
- **Fix in the heuristic seat only:** `opponent.ts`, `botSearch.ts`,
  `botEvaluate.ts`, `botClose.ts`, and the finder modules they use. Do not
  touch `packages/rules-core`, `packages/contracts`, the BYOK seat
  (`byokBot.ts`) or the `mcp` package's copy. MCP's beam is parked; note any
  drift.
- **Deterministic, as now.** No randomness. Ties break on `compareMoves` /
  `compareArrows`. A mirror cell run twice gives identical move lists.
- **Keep the "never pass while a step is legal" rule** from the idle-turn
  autopsy in `chooseMove`. If the beam path breaks that rule, that is a
  finding.
- **Budget.** Complexity per the repo budget. Bot turn time must not regress
  noticeably: measure the `mirror` tier wall time before and after, and keep
  the per-turn mean within 1.5× of today's.

## Acceptance (measured with the P79 / P78 harness, not by feel)

- **Mirror matches end.** On P79's six `mirror` cells (`playerCount` 2,
  seeds 1–3, both seat orders), at least **5 of 6 end with a winner within
  200 rounds**. On P78's 16-cell grid at a 200-round cap, at least **12 of 16**
  end. The thresholds are fixed here, before the change.
- **No late stasis.** In no mirror cell does a seat take fewer than 20 steps
  in any 40-round window while it holds more heads than its opponent.
- **Combat stays reachable.** In the P78 `reach` tier, combat's share of heads
  lost stays at or above 50 % on the grid. The fix must not turn the bot into
  a pure encloser.
- **Determinism.** Two runs of each mirror cell produce byte-identical move
  lists.

## Consequences outside this packet (state them in the PR)

- **The BYOK benchmark's opponent changes.** P79's `matches` tier plays BYOK
  against this heuristic. All proxy whole-game numbers in
  `docs/research/byok-benchmark.md` (baseline 0.144, P75 0.272) were measured
  against the *old* heuristic. After this packet merges, the next BYOK arm
  needs a fresh proxy baseline. Say so in the ledger. The `positions` tier is
  unaffected, since it never plays the heuristic.
- **The human playing against the bot** will meet a seat that closes out
  games. If that should be a difficulty setting, it is a separate packet.

## Out of scope

- Any rules change, including win or starvation conditions.
- Making the heuristic *stronger* in general. The goal is finishing, not
  rating.
- The BYOK seat and its prompt.
- MCP's bot copy, beyond noting drift.

## Scenario inventory

- The seed-1 mirror position at round ~160 (from the archived mirror moves):
  the bot takes at least one step, and the cause found in the diagnosis no
  longer holds.
- An interior head mass with a reachable frontier: the bot walks toward the
  edge rather than ending its turn.
- An opponent holding one territory component: the bot's turn moves toward
  closing or cutting it when it can afford to.
- A seat with a large head surplus and an opponent with a share deficit: over
  N rounds the surplus decreases (spent), not increases.
- Determinism: the same mirror cell twice gives identical moves.
- No regression of the existing bot suites (`bot-turn-search.*`,
  `close-and-spawner-value.*`, the pause and playback suites).

## Definition of done

- [ ] Diagnosis recorded: which of (a), (b), (c) held, or something else.
- [ ] `pnpm verify` green.
- [ ] Acceptance thresholds met and recorded in
      `docs/research/byok-benchmark.md` under "Mirror", with before and after
      tables.
- [ ] Mirror wall time before and after recorded; per-turn mean ≤ 1.5×.
- [ ] Ledger notes that BYOK proxy baselines predate this change.
