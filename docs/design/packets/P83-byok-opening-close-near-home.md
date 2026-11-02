# P83 — BYOK opening: say how far home is, in turns

> **Status:** **parked 2026-11-02: failed its P79 gate** on the positions
> no-regression check (C#43 rewalks 0 → 1). The long-grid improvement passed.
> See [the result](#result-2026-11-02-fail-parked). The code, spec and tests are on branch
> `parked/p83-byok-opening` (`2e486b5`), which was reviewed (PASS) and green
> under `pnpm verify`, and is not merged. **Kind:** web adapter (the BYOK offer) plus one bench
> hygiene change. **Depends on:** P79 (the gate), P80, P75, P82 (the evidence
> and the baseline).
>
> **SPEC coverage:** none. No rule changes, and no change to `rules-core`,
> `contracts` or the heuristic seat. Everything here is a fact the adapter
> prints about a legal step.

## Why

[P82](./P82-byok-long-game-and-three-seats.md) put the BYOK seat (proxy
`grok-4.20-0309-non-reasoning`) against the post-P81 heuristic for 150 rounds.
It lost all 6 cells, eliminated at rounds 62–116
([results](../../research/byok-long-game.md)). The cause is production:

- In 5 of 6 cells the opening walks one 3-stack straight away from its
  3-arrow home, laying a 76–93-arrow trail with nothing to close.
- Every row it played then read `tipDist=17→17` for runs of up to 31 turns.
  17 is not a distance. It is `DIST_CAP + 1`, the sentinel for "no own
  territory within 16 grain steps", printed as if it were a number.
- At round 20 its income was 1/4–1/2 heads per round, against the
  heuristic's 47/18–49/9.

The [2026-11-02 playtest](../../research/playtest-2026-11-02/FINDINGS.md)
is the reference opening. A human beat two heuristic seats in about 42 rounds
by closing small loops near home from round 5: 16 area captures, and income
2.78 at round 20.

**What the seat was shown.** Replaying P82's `s1-first` opening through
`formatLegalMoves` (free, no model calls), every row from the walking stack
is either `outward` or `homeward`, with `tipDist=a→b` in grain steps. Turn 1
plays `tipDist=3→5`, turn 2 `5→7` then `7→6`, turn 4 `7→9` then `9→11`.
Nothing on a row says what those numbers cost. A 3-stack walks 2 arrows a
turn, so `tipDist=9` is 5 of its turns from home, and its trail is exposed
for all of them.

**The ledger's lesson.** Grok acts on offer tags and row fields, not on prose
([ledger](../../research/byok-benchmark.md)). Both shipped wins fixed a tag
that said something false or vague: P80's `home_mill` and P75's
`borders_spawner`. The one prose change, P74, failed its gate. So this packet
changes rows and one header line. It adds no teaching paragraph.

## Intent

Make the distance home **true, and in the seat's own unit**: turns of this
portion, not grain steps. Warn on the one step that carries a portion beyond
a short horizon. Show, for each exposed tip, what the shortest walk home
would claim.

## BSSN (locked by the human's brief; phase 1 refines and writes the details down)

1. **`homeIn=` on every step row that ends off own territory.**
   - It is the number of this portion's seat-turns, after this step, until it
     can land on own territory by the shortest grain walk.
   - It counts the steps the portion still has left this turn. If the rest
     of this turn's walk can reach home, `homeIn=0`.
   - It uses this portion's speed, including a merge override, which is what
     `portionSlot` already prints as `spd`.
   - It is a distance, never a route.
   - Rows whose exit is own territory do not get it, because they have
     landed.
2. **`leaves_horizon` tag.** It goes on a row whose step takes the portion
   from **within** the horizon to **beyond** it: `homeIn` before the step is
   ≤ *H*, and after the step it is > *H*.
   - *H* = **2** turns. It is fixed, not tuned per position. Phase 1 records
     why. This packet's measurement is below.
   - It fires on the crossing step only. Once a portion is beyond *H*, its
     rows do not repeat the tag. A tag on every row of a far stack would be
     noise, like the 17 sentinel.
3. **The sentinel stops looking like a number.** Beyond the BFS cap,
   `tipDist` prints `none` instead of `17`, and so does `homeIn`. This
   applies to the row slot and to the `Exposed tips:` line. The cap itself
   (`DIST_CAP`) is unchanged.
4. **The nearest close, on the tips line.** Each `Exposed tips:` entry gains
   `homeIn=` and `ifHome=+L share+S` for the stack on that tip.
   - `homeIn=` there uses the whole stack.
   - `ifHome=` is the land and the spawner shares this seat would gain if the
     trail landed home by the shortest grain walk from that tip. That is the
     trail, plus the walk's non-own arrows, plus `rules.enclosedBy(own ∪
     trail ∪ walk)`.
   - It is a projection, not a promise: the board moves in between. The
     tips line's prefix labels it as one (`ifHome = claim if it walks home
     now`, spec Decision 8), and it is printed for the shortest walk only.
   - It is omitted when the tip has no way home within the cap.
   - It never ranks, and never names a route or a row index.
5. **Legend, not teaching.** The `LEGAL_MOVES` legend sentence gains one
   clause each for `homeIn=` and `leaves_horizon`, and the tips line gains a
   prefix that glosses `ifHome=`. The teaching doc's tag list names the new
   tag. No new paragraph.
6. **No new port method.** Reuse `distanceToTerritory` / `homewardPath`
   (`botEvaluate.ts`), `speed` and `rules.enclosedBy`. The claim arithmetic
   is the same as `botFinish.ts`'s claim estimate. If both can share one
   pure helper without changing the heuristic's behaviour, phase 1 decides
   that. **The heuristic must not change**: P82's baseline depends on it,
   and its own opening stall is a separate follow-up.
7. **Determinism.** Same frontier discipline as `homewardPath`. Sorted
   output. Identical text on both geometry ports.
8. **Budget.** Offer growth ≤ 10% on the P75 measurement positions, by
   `buildUserPrompt` characters. Measure it and record it in the spec.

### Bench hygiene (same packet)

- The `matches` tier records each BYOK seat-turn's model replies:
  - for every completion, its `plan` and `why` as strings or `null`;
  - sanitised the way the adapter sanitises a plan (one line, capped at
    `PLAN_CAP`);
  - keyed to the index of the turn's first move in `moves`.
- The adapter exposes them on `LlmBotTurn`. The bench copies them, so it
  re-parses nothing.
- Why: P82's audit could not check "named in plan" without them.
- The result file still carries no prompt text and no key, and the
  existing redaction still runs last.

## Evidence for *H* = 2 (free replay of P82's long150 moves, rounds 1–20)

The rows were re-derived at each BYOK decision point. *Crossing* means
`homeIn` goes from ≤ *H* to > *H* on that step.

| cell | BYOK steps played | of them crossing *H* = 2 | first crossing | offer rows crossing | homeward rows crossing |
|---|---:|---:|---:|---:|---:|
| s1-first | 40 | 3 | r1 | 9 | 0 |
| s1-second | 37 | 1 | r5 | 15 | 0 |
| s2-first | 41 | 3 | r2 | 14 | 0 |
| s2-second | 40 | 5 | r3 | 37 | 0 |
| s3-first | 38 | 1 | r2 | 6 | 0 |
| s3-second | 40 | 8 | r2 | 65 | 0 |

- A non-crossing variant (tag every row whose `homeIn` exceeds 2) tagged
  167–338 of 275–372 rows, and 40–146 homeward rows. That is
  indistinguishable from noise, so it was rejected.
- *H* = 3 moves the first crossing later (r2–r10), which is after most of
  the damage.

## Out of scope

- The heuristic seat, its opening stall, and any finding it produces.
- P76's delta and reachable-spawner blocks. P76 stays parked. Its bleed
  trigger is the human's call.
- Teaching prose beyond the legend and tag list.
- Route-finding or loop enumeration. `ifHome=` reports one walk's claim.
  It never chooses between walks.
- The 3-player grid. P82's smoke check stands.

## Scenario inventory (phase 1 expands)

- A row that lands on own territory carries no `homeIn=`.
- A row whose remaining steps this turn reach home prints `homeIn=0`.
- `homeIn` uses the portion's speed. A 1-head portion and a 3-head lump on
  the same exit print different `homeIn`.
- A merge-override portion uses `speedOverride`.
- `leaves_horizon` is on the step that takes `homeIn` from 2 to 3. It is not
  on a step from 3 to 4, or from 2 to 2.
- A row beyond the cap prints `tipDist=a→none homeIn=none`, and never `17`.
- The `Exposed tips:` entry prints `homeIn=` and
  `ifHome=+L share+S`. On a hand-built fixture where the walk home encloses
  a spawner border, `S` matches what `apply` realises when that walk is
  played out.
- `ifHome=` is omitted when the tip has no way home within the cap.
- Both geometry ports give identical text.
- `matches` results carry each BYOK turn's `plan` and `why` per completion,
  sanitised, with no prompt text, and with the key redacted.

## The gate

Predeclared in the [ledger](../../research/byok-benchmark.md) before any paid
run, and copied here unchanged.

- **Improvement:** P82's long grid (2 players, cap 150, proxy, 6 cells),
  against P82's `long150` results. The baseline is not re-measured. It needs
  both:
  - **(a)** BYOK income at round 20 above P82's in at least 4 of 6 cells;
  - **(b)** at least 1 win, or mean rounds survived ≥ 95.3.
- **No regression:**
  - **Positions** (12, grok-4.7): interior passes + rewalks + missed closes
    summed ≤ main's 1, and no single position worse.
  - **Proxy K = 20:** mean ≥ 0.326 (`pbase81`), with no invalid cell.
- **Any invalid cell fails the arm.**
- **Spend:** capped at $8.00 in total.

## Definition of done

- [ ] Spec, red suite, green code and review, through `/spec-to-ship` phase 4.
- [ ] `pnpm verify` green.
- [ ] Offer growth measured, ≤ 10%.
- [ ] The gate run and recorded in the ledger,
      [`byok-long-game.md`](../../research/byok-long-game.md) and the index row.
- [ ] **Pass:** merged. **Fail:** this packet and the index are marked
      parked, the code is pushed to `parked/p83-byok-opening` without
      merging, and the docs ship alone.

## Result (2026-11-02): FAIL, parked

Measured at `2e486b5`, which is main `3eb72a2` plus P83. All the numbers are
in the [ledger](../../research/byok-benchmark.md#p83--byok-opening-fail-parked-2026-11-02)
and in [`byok-long-game.md`](../../research/byok-long-game.md#p83-the-opening-arm-2026-11-02).

| check | P83 | bar | |
|---|---|---|---|
| (a) BYOK income at r20 above P82 | 4 of 6 cells | ≥ 4 of 6 | ✔ |
| (b) wins, or mean rounds survived | 0 wins; mean ≥ 99.0 (3 cells stopped by the budget while alive, so these are lower bounds) | ≥ 1 win or ≥ 95.3 | ✔ |
| positions (12, grok-4.7) | sum 2 (C#43 rewalk 0 → 1, O#25 1) | ≤ 1, no position worse | **✘** |
| proxy K = 20 | mean 0.439, 0 invalid cells | ≥ 0.326, no invalid cell | ✔ |

- **It fails on the same reading that parked P72:** one new rewalk at C#43.
  The opening improvement is real on the proxy, but the gate does not trade
  it against a positions regression.
- **Spend:** $6.94 of the $8.00 cap.

### Where the spec lives

- The spec (`docs/spec/byok-opening-horizon/`), the red suite and the code
  are on `parked/p83-byok-opening`. Nothing from them is on main.
- The spec records two amendments made during the pipeline:
  - an Examples row that cannot occur was replaced;
  - the legend and the tips prefix were shortened to keep within the 10%
    budget. Growth was 7.4–8.5%.

### For whoever reopens it

- **s3-second got worse.** Its recorded plans are "expand to contest
  spawners", and then "advance the 3-stack outward to claim the spawner at
  tiling:v:3,-3,down". The seat followed `advances=` rows outward, and
  `leaves_horizon` (5 of the 29 offered in rounds 1–20 were played) did not
  outweigh them.
- **C#43 is where grok-4.7 rewalks** once P83's rows are added. The
  positions tier records no `plan`/`why`, so the reason is unknown. Adding
  them there would be the first step.
