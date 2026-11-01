# P78 — Is combat reachable? A measurement, not a change

> **Status:** done — [research note](../../research/combat-reachability.md): combat is reachable
> (83–85 % of heads lost in the heuristic grid; 7 heads in the 2026-10-29 log). **Depends on:** P10 (replay), P07, P33, P79 (match runner). **Throwaway
> measurement** — produces a research note, not shipped code.
> Playtest 2026-10-29 ([findings](../../research/playtest-2026-10-29/FINDINGS.md) §3):
> the match summary reads **605 steps · 62 closes · 7 cuts**, and as far as the
> seat-B log could tell, **no head was ever killed in head-to-head combat** by
> any seat in 39 turns. Every head that died — on every side — was captured
> inside a closure.
>
> **SPEC coverage:** §6.2 (combat), §6.3, §11. This packet **may produce a §11
> item**; it must not resolve one.

## Intent

Find out whether the 1:1 combat exchange is reachable in real play at the
default board size, or whether enclosure dominates it so completely that
§6.2 and most of the conflict vocabulary — fronts, firebreaks, evaporation,
sentries — are effectively dead weight.

This is a **question**, not a complaint. If combat is rare by design, that is a
finding worth writing down. If it is rare by accident of `homeOffset` and `R`,
that is a tuning item for §11.

## BSSN (locked)

- **Measure first, change nothing.** No rules edit, no constant tuning, no
  balance "fix" lands from this packet. Output is a research note under
  `docs/research/`, plus a §11 item if one is warranted.
- **Instrument the replay, not the engine.** The core stays pure. Counting
  happens in a harness over `rules.apply`. Reuse P79's headless match runner
  for the bot-vs-bot grid rather than writing a second one.
- **Count these, per match:**
  - steps, closes, cuts, end-turns (the summary already has these)
  - **heads lost to combat** vs **heads lost to encirclement** vs **heads lost
    to evaporation** — the three must be separable
  - closures by kind: land bridge, area capture, capture-with-enemy-heads
  - how many closures enclosed at least one enemy head
  - turns from first contact to first head death
- **Corpus:** every committed match log (`docs/research/playtest-2026-10-29/`, P79's corpus), plus generated bot-vs-bot matches across
  a small grid of `homeOffset` × `R` × `playerCount`. The heuristic seat is a
  fine subject — the question is whether combat is *reachable*, not whether
  good players choose it.
- **Report ratios, not verdicts.** The note states what happened. Any
  recommendation is a separate conversation with the human.
- **Determinism.** Fixed seeds, recorded in the note. A rerun reproduces the
  table exactly, or the harness is wrong.

## Out of scope

- Changing combat, closure, evaporation, or any constant.
- Making the heuristic seat fight.
- Anything in `packages/rules-core` beyond reading it.
- Resolving a §11 item.

## Scenario inventory

Harness correctness, on fixture boards with hand-known outcomes:

- A step into an occupied enemy arrow is counted as combat, not encirclement
- A head captured by a closure is counted as encirclement, not combat
- A head killed by an evaporation front is counted as evaporation
- A land-bridge closure is distinguished from an area capture
- A closure enclosing one enemy head is counted once, not per arrow
- Replaying the 2026-10-29 log reproduces its printed summary line exactly
  (605 / 62 / 7) — if it does not, the harness is wrong before the corpus is

## Deliverable

`docs/research/combat-reachability.md`:

- the counting method and its fixture-verified correctness
- one table per configuration in the grid
- the archived matches, scored the same way
- a plain statement of whether head-to-head combat occurs at all, how often,
  and under which configurations it becomes more common
- **if** the answer is "effectively never at default settings", a proposed §11
  item saying so — phrased as an open question, not an answer

## Definition of done

- [ ] `pnpm verify` green (the harness is throwaway but must not break the build).
- [ ] The 2026-10-29 log reproduces 605 / 62 / 7 through the harness.
- [ ] Research note written, with seeds recorded and ratios tabulated.
- [ ] No constant, rule or test outside the harness was touched.
