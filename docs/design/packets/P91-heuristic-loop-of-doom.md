# P91 — The heuristic seat stops walking a ring of its own trail

> **Status:** shipped 2026-11-08 ([ledger](../../research/byok-benchmark.md#p91-2026-11-08-the-live-sortie-credit-pays-only-a-sortie-that-grew)). **Kind:** web heuristic seat.
> **Depends on:** P85 (sortie credit), P84 (never idle).
>
> **Evidence:**
> - [Playtest 2026-11-06](../../research/playtest-2026-11-06/FINDINGS.md),
>   finding 1: A's ×4 walked a 3-arrow ring of its own trail every turn from
>   move 209 to 529 (rounds 17–43). Its land sat at 30 for twenty rounds.
> - [Playtest 2026-11-07](../../research/playtest-2026-11-07/FINDINGS.md),
>   finding 2: B's ×2 did the same on another 3-arrow ring from move 102 to
>   691, ending each turn on a different arrow.
> - The skipped tests
>   [`heuristic-loop-of-doom.replay.test.ts`](../../../packages/web/test/heuristic-loop-of-doom.replay.test.ts)
>   (fixtures L1 and L2, merged in #104).
>
> **SPEC coverage:** none. No game rule is touched; this is the heuristic
> seat in `packages/web`. Nothing is owed to SPEC §11.

> **Diagnosis (2026-11-08, `main` `229892d`):** P85's sortie credit pays a
> terminal for keeping its sortie open, and a walk over its own trail never
> uses that credit up. With an open trail and a close in reach, every turn
> scores the walk above the close, and the stateless seat repeats the choice
> forever. Evidence:
> [`docs/spec/heuristic-loop-of-doom/`](../../spec/heuristic-loop-of-doom/heuristic-loop-of-doom.md#diagnosis).

## Intent

When the live seat holds an open sortie, it earns P85's credit only for
growing it. A turn that leaves the trail no larger than it was earns no
credit, so `evaluate` decides between closing, extending or anything else,
and the close that `evaluate` prefers is taken.

## BSSN (locked)

- **Heuristic seat only.** The pure predicate goes in `botTempo.ts`, beside
  `sortieCredit`; `botSearch.ts`'s `liveCredit` gains one call.
- **Do not touch:** `evaluate`, `sortieCredit`'s signature and its P85 EARS
  (it still answers "what is this open sortie worth"), the constants
  (`SORTIE_CREDIT`, `SORTIE_TURN_CAP`, `SORTIE_TOTAL_CAP`), P59's threat
  test, the nested search (`withReplies: false`), `chooseMove`, BYOK, the
  parked MCP copy, `rules-core`, `contracts`.
- **Deterministic, as now.**
- **Out of scope:** the credit's size. Half the projected loot can be worth
  more than the land the close actually banks (L1: 3475 against 1696). The
  gate removes the trap; resizing the credit is a backlog item.

## Acceptance

- The four skipped tests in `heuristic-loop-of-doom.replay.test.ts` are
  unskipped and pass. Their premise tests still pass.
- The new scenarios in the spec pass.
- `pnpm verify` green, P85's fixture floors included.
- `pnpm byok-bench mirror` and `pnpm byok-bench reach --round-cap 200` are
  re-run and recorded in [the ledger](../../research/byok-benchmark.md) with
  P85's gates: never idle 0, ≥ 5 / 6 mirror cells with a winner. A large
  shift in mirror rounds or reach cells is reported, not tuned away.
