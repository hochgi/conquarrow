# P86 — SPEC conflict resolution and code alignment

> **Status:** not started. Written 2026-11-04 for a fresh session.
> **Kind:** spec audit, then rules-core alignment. **Depends on:** nothing
> open. Every shipped rules packet (P02–P70) is input.
>
> **Evidence:** playtest 2026-11-04
> ([findings](../../research/playtest-2026-11-04/FINDINGS.md), item 4). Two
> SPEC sections give opposite answers for one position, and the engine
> follows one in one shape and the other in another:
> - §6.3: "You cannot capture a trail-connected raider by claim alone: a cut
>   must first evaporate up to their anchor."
> - §7: "Closing grants the enclosed tiles **and everything standing on
>   them** — enemy heads, converted (§6.3)." `closure.commit` (P13) strips
>   every trail mark on a claimed arrow, and conversion is judged after the
>   strip.
>
> In the log, a raider standing on the human's existing land kept its trail
> and was not converted (#329), while a raider whose arrow the close newly
> claimed lost its trail mark and converted (#345). The human's reading: the
> conflict is the symptom, and SPEC.md as a whole has more of them.
>
> **SPEC coverage:** all of it. This packet changes SPEC.md prose, and may
> change rules only where the human decides a conflict.

## Intent

Make SPEC.md say each rule once, with no two sections disagreeing, and make
the engine and its tests match that text.

SPEC.md has been revised many times mid-design. It carries 95 strikethroughs
and about 24 "withdrawn / superseded / corrected / dissolved" notes. Most are
clean, but a revision that fixed one section can leave a sentence elsewhere
stating the old rule. The packet specs under `docs/spec/` and the ADRs add
more places where a rule is stated. An agent that reads the stale sentence
builds the old game, and tests written from it pass. That is the failure mode
AGENTS.md warns about ("good code implementing a rule nobody chose"), arriving
through the spec itself.

## Conflict 1 (decided 2026-11-04): §6.3 wins over the P13 strip

**Decision (human):** a raider whose trail still reaches its own territory
(territory grade) is **not converted** by a closure, even when the closure
claims the arrow it stands on. The arrows under it become the closer's
territory; the raider and the trail it stands on stay. It converts only once
a cut drops its grade (§6.1). Bare enemy trail inside a claim is still
stripped, as P13 intended.

**Concrete case:** `docs/research/playtest-2026-11-04/match-log.json`, replay
from `makeMatch(config)`:
- **#345** (C steps `tiling:a:3,1,1 → tiling:a:2,2,1`, a 3-arrow close that
  claims `2,1,0`, `2,2,2`, `3,1,1`). A ×1 on `tiling:a:2,2,2`, trail
  `{2,2,2}`, territory grade through feeder `tiling:a:2,3,2` (A's land, in no
  enemy trail). Today it converts. **After the fix it stays A**, on C's land.
- **#329 → #331** is the contrast that already follows §6.3. B ×2 on
  `tiling:a:-1,1,2` survives C's close at #329 and converts at #331, after
  C steps onto its trail (`tiling:a:-1,2,2`).

**Where the code is:** `packages/rules-core/src/closure.ts` `commit` (the P13
strip) and `packages/rules-core/src/encirclement.ts` `convertEncircled` (the
grade check), ordered in `movement.ts` `apply`. Decide BSSN which seam keeps
the mark (for example, judge grade on the pre-strip state, or do not strip
an arrow holding a territory-grade enemy group), and check what the claimed
arrow under a surviving raider means for fill, accrual and later cuts.

This one can ship first, on its own, through the normal pipeline. If it has
already shipped when this packet starts, mark it done here.

## The method

### 1. Inventory (read-only)

Read the sources that state rules, in this order:
1. `SPEC.md`, all of it, §1–§11 and the appendices.
2. The ADRs that bind rules: `docs/adr/0001`, `0005`.
3. The rules-side packet specs in `docs/spec/`: `birth-cut`, `chord-test`,
   `closure`, `combat`, `convert-spent`, `crossings`, `cuts`, `economy`,
   `encircled-path`, `encirclement`, `fill`, `immediate-loss`,
   `losing-conditions`, `move`, `movement`, `refuse-self-convert`, `tiling`,
   `trails`, `trails-simple`, `won-is-over`, `mirrored-spawner-field`,
   `geometry-port`, `rational`.

Adapter and bot specs (`bot-*`, `byok-*`, `online-*`, UI) are out of scope,
except where one restates a game rule.

For each mechanic, list every sentence that states how it works, with
section and line. Mechanics to cover at least: movement and allowance,
merge and split, trails as sets, crossings and the chord test, cuts and
evaporation (fronts, firebreaks, halt-at-first, territory-root cuts),
anchor grades, closure (path, fill, land bridge, pincer), claim and strip,
encirclement and conversion, combat, spawners and accrual, births on trail,
territory capture, starvation and loss, seat vanish, match end.

Fan this out to subagents by section if it helps. Each one returns
sentences, not conclusions.

### 2. The conflict register

Write `docs/research/spec-conflicts.md`. One row per conflict:
- **id;**
- **the sentences**, quoted with section and line;
- **a concrete case** where the two readings give different states. Prefer a
  hand-authored fixture board (the `rules-invariants` skill); a replay from a
  committed log is fine. No case means it is not shown to be a conflict yet;
  record it as "suspected";
- **what the engine does today**, from running the case;
- **the kind:**
  - **stale prose:** a later decision is clearly recorded, and one sentence
    was never updated. Fix the prose (BSSN, no human needed). Say which
    decision supersedes it;
  - **rule conflict:** both sentences are live and no recorded decision
    settles it. **This is a game rule. Ask the human.** Batch the questions,
    each with its concrete case and what each reading does in play;
  - **code divergence:** SPEC is consistent but the engine does something
    else. It goes to step 4;
- **the resolution**, with who decided and the date.

Gaps (behaviour SPEC does not state) are not conflicts. They go to §11 as
usual and are left open.

### 3. Rewrite SPEC.md conflict-free

Apply every resolution. Each rule is stated in one normative place; other
sections point to it rather than restating it.

**Open question for the human before rewriting:** how to keep history.
CLAUDE.md asks for in-place strikethroughs and **resolved** markers, and
that convention is part of how the stale sentences survive. Options:
- keep it as is, and only fix the stale sentences;
- keep the normative text clean, and move superseded wording into a
  "Decision history" appendix, linked from where it applied, keeping §11's
  resolved trail as it is.

Do not pick one without asking. If the human picks the second, update
CLAUDE.md's "Working with SPEC.md" to match.

A second, independent reading closes the step: a fresh `reviewer` agent
given only SPEC.md looks for statements that still disagree. Anything it
finds goes into the register.

### 4. Align code and tests

For each resolved rule, and each code divergence:
- find the implementation in `packages/rules-core` and the tests that pin
  it, including bot spec oracles that restate a rule in test support (for
  example `packages/web/test/*support.ts`);
- turn the concrete case into a committed failing replay or fixture test;
- fix through the spec-to-ship pipeline. Several small fixes can share one
  packet if they touch different code, and each keeps its own test.

The heuristic, BYOK and MCP seats read rules through `RulesPort`, so most
follow automatically. Where a bot module restates a rule (findings, threat
tests), list it.

## Out of scope

- New rules, and tuning constants (§11 tuning items stay open).
- Gaps: they go to §11 and stay open.
- Adapter, UI, online and bot behaviour, except where they restate a rule.
- `packages/mcp/src`'s parked bot copy (known drift; note only).

## Escalate

- Every rule conflict (step 2). Loop the human in on game mechanics only;
  decide prose, tests and code structure yourself.
- The history question in step 3.
- A resolution that changes how the game plays in a way a playtest would
  notice: say so when asking.

## Acceptance

- The register lists every conflict found, each with its concrete case and
  resolution; the rule conflicts carry the human's decision and date.
- SPEC.md: the fresh reviewer reading finds no remaining disagreement.
- Every resolved rule and code divergence has a committed test, and
  `pnpm verify` is green.
- Conflict 1's #345 case leaves A's stack unconverted; #329 → #331 is
  unchanged.
- Free measurements after any rules change: `pnpm byok-bench mirror` and
  `reach --round-cap 200`, before and after, recorded in
  `docs/research/byok-benchmark.md`. No gate here, but a large shift is
  reported to the human. The BYOK proxy baselines predate this too.
- No paid model runs.

## Suggested sessions

1. Conflict 1 on its own (small; decided).
2. Inventory and register (read-heavy; parallel subagents).
3. One human decision round on the rule conflicts and the history question.
4. The SPEC rewrite and the independent reading.
5. Alignment packets through spec-to-ship.
