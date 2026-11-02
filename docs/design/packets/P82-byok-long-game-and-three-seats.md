# P82 — BYOK long game and 3-player check

> **Status:** done 2026-11-02. Results: [`byok-long-game.md`](../../research/byok-long-game.md). **Kind:** measurement, plus one harness flag. It is a
> tooling packet, so it skips the four-phase pipeline (`AGENTS.md`).
> **Depends on:** P79 (harness), P81 (the heuristic finishes matches). It runs
> on the **final combination**: main after P72 is either merged or parked.
>
> **SPEC coverage:** none. This changes no rule, no BYOK prompt and no
> heuristic. It may *raise* a packet or a §11 item. It must not resolve one.

## Why

- **K = 20 sees only the opening.** That is learning 6 of the BYOK delivery.
  Every audited grok failure lived in the first 20 rounds, and nothing has
  measured what the BYOK seat does after round 20.
- **The human's original target is now measurable.** The BYOK seat's target
  was always to *minimise the rounds it takes to win*. Before P81 no match
  against the heuristic could end, so the gate scored land share at a fixed
  K. Since P81 the heuristic spends its surplus and closes out games: mirror
  cells end at rounds 55–95. A long cap therefore produces real wins and
  losses.
- **The 3-player check was planned and never funded.** P79 deferred a
  3-player run on the final combination, because a third seat adds
  kingmaking noise. It is a smoke check, not a gate.

## The harness change

- `pnpm byok-bench matches --players 3` runs the 3-player grid: seeds 1–3 ×
  the BYOK seat first, second or third, which is 9 cells with ids
  `p3-s<seed>-<seat>`. Each cell uses the 2026-10-29 playtest config with
  `playerCount: 3`.
- The 2-player grid is unchanged: the same ids, the same configs and no
  `config` on the cell, so every earlier result file stays comparable.
- `--players` is refused outside the `matches` tier. The mirror tier's seat
  bias and pair checks are 2-player only.
- **3 players, read with care.** When the BYOK seat is eliminated, the
  match plays on until one of the two heuristic seats wins. `rounds` is
  therefore the round the match ended, not the round the BYOK seat went out.
  Its score is 0 either way.

## Runs (predeclared)

Both runs use `grok-4.20-0309-non-reasoning`, the proxy model, priced at
$1.25 / $0.20 / $2.50 per M. They run on main once P72 is resolved.

| # | run | command shape | cap |
|---|---|---|---|
| 1 | **long game**: 2 players, 6 cells | `matches --round-cap 150 --tag long150` | `--max-usd 5.00` |
| 2 | **3-player**: 9 cells | `matches --players 3 --round-cap 20 --tag p3k20` | `--max-usd 1.50` |

A cell stopped by the cap (`aborted_budget`) is reported and is not re-run
unless what remains of the xAI balance covers it plus a $1 reserve.

### What run 1 reports

For each cell:
- the outcome, and the round it came at;
- the score at K = 150 (a win scores `1 + (150 − r)/150`);
- the BYOK seat's peak heads and closes;
- the fallback rate.

Across the grid:
- **rounds to win**, over the cells the BYOK seat wins. This is the human's
  target number, and the baseline every later BYOK arm can be scored on;
- **rounds to loss**, over the cells it loses;
- wins / losses / capped.

### The audit of run 1

Read each cell's `moves` after round 20 the way the ledger's "Audit" section
read the archived grok matches. Count each of these as an occurrence:
- **bleed:** the BYOK seat loses territory or heads to an enemy enclosure and
  does not respond within 3 of its turns;
- **missed reachable goal:** a spawner share or a closing step was on the
  offer and the seat neither took it nor named it in `plan`;
- **stall:** a turn that passes with a legal step on the offer;
- **rewalk:** P79's existing metric.

**Unpark trigger for P76** (BYOK horizon): a bleed or a missed reachable
goal in **≥ 2 cells**. Report it; unparking is the human's call.

### What run 2 reports

For each cell: the outcome, the score, the fallback rate and the BYOK seat's
land share. It **fails the smoke check** when any cell is invalid (fallback
over 10 %, P79's rule) or when the parse rate is under 95 %. A failure is a
finding to packet, not a reason to change P82.

## Deliverables

- The `--players` flag with its tests, `packages/web/bench/test/players.core.test.ts`.
- `docs/research/byok-long-game.md`, containing both runs' tables, the audit
  counts with move references, and the P76 trigger verdict.
- A ledger entry in `docs/research/byok-benchmark.md`: the runs, the cost and
  the running total.
- An index row update in `docs/design/02-work-packets.md`.
