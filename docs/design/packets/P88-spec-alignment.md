# P88 — Align rules-core with the P86 rulings

> **Status:** in progress. **Kind:** rules-core fix (several small fixes, one
> packet; each keeps its own tests). **Depends on:** P86's register and SPEC
> rewrite; P12, P13, P33, P47, P87.
>
> **Evidence:** the [conflict register](../../research/spec-conflicts.md):
> C2, R1–R3 (ruled by the human 2026-11-05), D1, D2. Every case was run on
> rules-core at `f25b0c4`.
>
> **SPEC coverage:** §6.1 (cuts, territory-root cut, anchor grades), §6.2
> (cut and combat on one step), §6.3 (conversion and the convert wipe), §7
> (what a claim clears). The rules are decided; this packet adds none.

## Intent

Make the engine do what SPEC.md says after P86. Five changes, plus a pinning
test for a sixth ruling that needs no change:

| Row | Rule (SPEC) | Today | After |
|---|---|---|---|
| R3 | A cut happens only when the crossing succeeds (§6.1, §6.2) | A repelled attack still evaporates the defender's other arms through the point | No evaporation when the attacker does not land |
| D1 | The victim's trail evaporates from each converted arrow (§6.3) | The claim strips the converted arrow first, so the wipe no-ops and trail beyond the claim survives | The wipe runs from the converted arrow |
| C2 | A claim never demotes a territory-grade trail carrying its owner's stack, wherever the stack stands (§7) | Spared only when the stack stands on another player's land | Spared wherever it stands |
| R2 | A claim that takes a trail's anchoring land is a territory-root cut (§6.1) | The claim takes the anchor; no evaporation beyond the claimed arrows | Evaporation from the root point to the first firebreak |
| D2 | A feeder in an enemy trail does not anchor (§6.1) | `stretchGrade` counts any owner-territory feeder | Only a clean feeder anchors |
| R1 | A stack on its owner's land can be attacked by a raider with a lifeline (§5, §6.2, §6.3) | Already so | Unchanged; pinned |

## Spec

[docs/spec/spec-alignment/](../../spec/spec-alignment/spec-alignment.md).

## Where the code is

- `packages/rules-core/src/movement.ts` `applyStep`: the step order. R3, R2.
- `packages/rules-core/src/closure.ts` `stripClaim` / `shieldingOf`: C2, D1.
- `packages/rules-core/src/stretch.ts` `stretchGrade`; `cuts.ts`
  `territoryRootCuts`: D2, and the shared clean-feeder predicate R2 uses.
- `packages/rules-core/src/encirclement.ts` `convertEncircled`: unchanged.

## Measurement (free, no gate)

`pnpm byok-bench mirror --concurrency 6` and
`pnpm byok-bench reach --round-cap 200 --concurrency 6`, before and after,
recorded under "Mirror" in `docs/research/byok-benchmark.md`. Report a large
shift to the human. No paid model runs.

## Same PR

- `docs/design/backlog.md`: P86's alignment items done; add what the run
  turns up.
- `docs/design/02-work-packets.md`: a P88 row.
- `raider-survives-claim` tests that pin C2's old behaviour flip (the spec
  dir already marks them superseded).

## Acceptance

- One committed test per scenario of the spec; the EARS invariants as
  properties.
- P87's #345 and #329 → #331 replays unchanged.
- `pnpm verify` green; merged with CI green.
