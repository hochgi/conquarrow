# P87 — A territory-grade raider survives a claim

> **Status:** shipped 2026-11-04 ([spec](../../spec/raider-survives-claim/raider-survives-claim.md), [ledger](../../research/byok-benchmark.md#p87-2026-11-04-a-territory-grade-raider-survives-a-claim)). Opened SPEC §11 item 51 for the human. **Kind:** rules-core fix.
> **Depends on:** P07 (encirclement), P13 (closure trail strip), P33 (convert
> wipe). It is Conflict 1 of
> [P86](./P86-spec-conflict-resolution.md#conflict-1-decided-2026-11-04-63-wins-over-the-p13-strip),
> shipped on its own.
>
> **Evidence:** playtest 2026-11-04
> ([findings](../../research/playtest-2026-11-04/FINDINGS.md), item 4).
>
> **SPEC coverage:** §6.3 (encirclement), §7 (closure: what the claim
> grants), §6.1 (anchor grades). The rule is decided; no §11 item is owed
> unless phase 1 finds a new gap.

## Intent

A raider whose trail still reaches its own territory cannot be captured by a
claim alone. Today it can. `closure.commit` (P13) strips every trail mark on
the arrows a closure takes, and `convertEncircled` (P07) judges the grade
afterwards. A raider standing on a newly claimed arrow has lost its mark by
then, reads as gradeless, and converts.

The same raider standing on the closer's *existing* land keeps its mark,
because the strip never touches that arrow. It survives and converts only
when a cut drops its grade. So the engine answers one position two ways,
depending on whether the arrow under the raider was already the closer's.

## The rule (decided by the human, 2026-11-04; do not re-ask)

A raider whose trail still reaches its own territory (territory grade) is
**not converted** by a closure, even when the closure claims the arrow it
stands on. The claimed arrows become the closer's territory. The raider and
the trail it stands on stay. It converts only once a cut drops its grade
(§6.1). Bare enemy trail inside a claim is still stripped, as P13 intended.

## Concrete cases

Replay `docs/research/playtest-2026-11-04/match-log.json` from
`makeMatch(config)`. Move numbers are 0-based indices into `moves`.

- **#345, the fix.** C steps `tiling:a:3,1,1 → tiling:a:2,2,1` (C's land).
  The claim is the path `2,1,0`, `3,1,1` and the pocket `2,2,2`. A ×1 stands
  on `tiling:a:2,2,2` with trail `{2,2,2}`, territory grade through the
  feeder `tiling:a:2,3,2` (A's land). Today it converts to C. **After the
  fix it stays A ×1, on C's land, with its trail mark.**
- **#329 → #331, the contrast that must not change.** B ×2 on
  `tiling:a:-1,1,2` (already C's land) survives C's close at #329 and
  converts at #331, when C steps onto its trail arrow `tiling:a:-1,2,2`.

## Where the code is

- `packages/rules-core/src/closure.ts` `commit`: the P13 strip.
- `packages/rules-core/src/encirclement.ts` `convertEncircled`: the grade
  check.
- `packages/rules-core/src/movement.ts` `applyStep` orders them: the strip
  runs first.

Phase 1 picks the seam BSSN and records it in the spec. Phase 1 also checks
what a surviving raider's trail on the closer's claimed land means for fill,
accrual and later cuts. A rule question SPEC does not answer goes to §11 and
to the human.

## SPEC.md

- Rewrite §6.3 and §7's "Closing grants the enclosed tiles and everything
  standing on them" so the two agree.
- Fix every other sentence that restates the old behaviour (grep for
  convert, encircl, strip). No strikethroughs; SPEC.md keeps no history in
  its text (AGENTS.md).

## Tests

- Both log cases as committed replay tests.
- Fixture-board tests per the `rules-invariants` skill: the fix, the bare
  trail strip that stays, and the contrast cases.

## Measurement (free, no gate)

`pnpm byok-bench mirror --concurrency 6` and
`pnpm byok-bench reach --round-cap 200 --concurrency 6`, before and after,
recorded under "Mirror" in `docs/research/byok-benchmark.md`. Report a
large shift to the human. No paid model runs.

## Same PR

- `docs/design/backlog.md`: delete the "§6.3 conversion fix" item.
- P86: mark Conflict 1 as shipped by P87.

## Acceptance

- #345 leaves A ×1 unconverted on `tiling:a:2,2,2`; #329 → #331 is
  unchanged. Both are committed replay tests.
- SPEC.md agrees with itself on conversion.
- `pnpm verify` is green; P87 is merged on `main` with CI green.
