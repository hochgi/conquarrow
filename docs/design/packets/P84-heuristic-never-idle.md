# P84 — The heuristic seat never passes while a step is legal

> **Status:** ready. **Depends on:** P53 (beam), P59 (mission gates), P65
> (quiet-home pass), P81 (the finisher; `mirror` / `reach` acceptance).
> Held back until P82 and P83 finished, so P82's BYOK proxy baseline stayed
> valid. Both are done.
>
> **Evidence:**
> - P81's finding (`docs/research/byok-benchmark.md`, "Finding: the beam
>   still passes with a step legal"): 62 zero-step seat-turns with a legal
>   step in the three mirror games.
> - Playtest 2026-11-02 (`docs/research/playtest-2026-11-02/FINDINGS.md`,
>   item 2): seat A passed 11 turns in a row (rounds 6–16) holding 3 heads
>   and 8 land, with a legal step every time. A passed again at r35 and B at
>   r26.
>
> **SPEC coverage:** none. This is the heuristic seat in `packages/web`.
> **No rules change**, so nothing is owed to SPEC §11.

> **Diagnosis (2026-11-03, before the fix):** two causes, and only two.
> 70 % of the cases come from **P59's threatened-kite gate**: its
> "least-kite" fallback picks `[endTurn]`, whose kite length is 0. The other
> 30 % come from **P53's `IDLE_SLACK`**: the pass beats every stepped plan by
> more than one `MOBILITY_SCALE`. The beam always kept a stepping plan. The
> fix is one never-idle guard at the return seam of the live search. Evidence
> and decisions:
> [`docs/spec/heuristic-never-idle/`](../../spec/heuristic-never-idle/heuristic-never-idle.md#diagnosis-recorded-before-the-fix).

## Intent

When the live heuristic seat (`chooseTurnBeam`) has at least one legal step,
its turn takes at least one step. A seat with no legal step still passes.
`chooseMove` already keeps this rule. The beam is brought in line with it.

**This reverses a decided behaviour, deliberately.** P53 EARS 11 (and P65,
which kept it) let the beam pass when every stepped plan scored worse by more
than `IDLE_SLACK`. P59's edge 12 let a pass win the least-kite fallback. Both
are superseded for the live seat (decision 1 in the spec). Nested enemy-reply
searches (`withReplies: false`) keep them.

## BSSN (locked)

- **Heuristic seat only:** `botSearch.ts`, `opponent.ts`, and the `bot*.ts`
  modules they use.
- **Do not touch:**
  - `packages/rules-core` or `packages/contracts`;
  - `byokBot.ts` or anything else in the BYOK seat;
  - `packages/mcp/src`'s parked bot copy (note the drift only);
  - `online-api`'s `pagesHeuristic` (it calls `chooseMove`, which already
    complies).
- **Deterministic, as now.** No randomness. Ties break on `planKey`, and in
  `chooseMove` on `compareMoves`.
- **Complexity.** `botSearch.ts` is about 1,080 lines. The guard's logic goes
  in a new pure module, `botNeverIdle.ts`, and `botSearch.ts` gains only the
  wiring. Run `hotspot-expansion-review` before extending `botSearch.ts`.
- **Out of scope:** the other P81 follow-ups ("a cut counts as quiet", MCP
  drift), any retuning of `evaluate`, `IDLE_SLACK`, `SORTIE_SLACK` or the
  beam budgets, and making the seat stronger in general.

## Acceptance (predeclared 2026-11-03, before any code change)

Baselines were measured on `main` `a16f571`.

| gate | baseline (`a16f571`) | required after P84 |
|---|---|---|
| **Never idle:** zero-step seat-turns with a legal step, summed over the 6 `mirror` cells | **124** (62 per seat order: s1 5, s2 47, s3 10) | **0** |
| **Playtest positions:** `playBotTurn` takes ≥ 1 step at A r6–r16 and r35, and B r26 (13 positions) | 0 / 13 | **13 / 13** |
| mirror cells that end with a winner within 200 rounds | 6 / 6 (rounds 55, 95, 63) | ≥ 5 / 6 |
| reach grid (`--round-cap 200`, P81's cap) cells that end | 15 / 16 | ≥ 12 / 16 |
| combat share of heads lost, reach grid | 78 % (1,950 / 2,510) | ≥ 50 % |
| no late stasis: the seat ahead on heads takes ≥ 20 steps in every 40-round mirror window | holds | holds |
| determinism: two runs of each mirror cell give byte-identical move lists | holds | holds |
| speed: mirror per-turn wall time (wall ÷ the longest cell's seat-turns, concurrency 6) | 165.9 s ÷ 191 = 0.87 s | ≤ 1.30 s (1.5×) |

Before and after go side by side under "Mirror" in
`docs/research/byok-benchmark.md`.

## Consequences outside this packet (state them in the PR)

- **The BYOK proxy baselines predate P84.** `pbase81` (K = 20, 0.326) and
  P82's `long150` were measured against the pre-P84 heuristic. They are
  **not** re-measured here. The next BYOK arm re-baselines, possibly on
  another provider.
- **The `positions` tier is unaffected.** It never plays the heuristic.
- **Lone 1-stacks now leave home.** The P53 / P65 `passIsBest` and
  `passWithManySteps` boards used to pass. They now take a step.

## Scenario inventory

- The playtest A r6 position: the seat steps (kite-gate cause).
- The playtest A r35 position: the seat steps (`IDLE_SLACK` cause).
- A non-dominant seat whose best stepped plan scores below `[endTurn]` by
  more than `IDLE_SLACK`: the seat steps (`passIsBest`).
- Every contest plan is a threatened kite: the seat returns a stepping plan,
  preferring one that is not a threatened kite.
- The beam keeps no stepping complete: the seat falls back to `chooseMove`'s
  step.
- A seat with no legal step still returns `[endTurn]`.
- A plan that already steps is returned unchanged.
- Nested reply searches (`withReplies: false`) are unchanged.
- `chooseMove` is unchanged.
- Determinism: the same position twice gives the same plan.

## Definition of done

- [ ] Diagnosis recorded before the fix (spec).
- [ ] `pnpm verify` green.
- [ ] Acceptance measured and recorded before and after in
      `docs/research/byok-benchmark.md` under "Mirror".
- [ ] Ledger and PR say that the BYOK proxy baselines predate P84.
- [ ] MCP drift noted (spec decision 7).
