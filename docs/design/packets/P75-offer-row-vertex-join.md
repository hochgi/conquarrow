# P75 — Offer rows name the vertices they advance

> **Status:** ready. **Depends on:** P15, P32, P64, P66, P79 (the gate).
> **Independent of P74**: each is measured alone and their combination after.
> Shipping this without P74's prose is a real arm, not a mistake. With
> reasoning off, the model can emit nothing but indices, so a short
> annotation may beat a long explanation.
> Playtest 2026-10-29 ([findings](../../research/playtest-2026-10-29/FINDINGS.md) §2.2):
> the offer already carries spawner rows (`vertex`, `force`, `held`, `unclaimed`)
> and move rows carry `borders_spawner` as a **boolean**. The seat is handed two
> tables and left to join them. That join is the single most load-bearing
> calculation in the economic game, and it is the one a human seat got wrong by
> hand for four turns.
>
> **SPEC coverage:** §7. No rule change. Adapter-only, in `packages/web`.

## Intent

Make each step row say **which** spawner vertices it advances and **by how
much**, so a seat can rank rows by income without reconstructing the board.

`borders_spawner` becomes a pointer, not a flag.

## BSSN (locked)

- **Annotation only.** `annotateMove` in `packages/web/src/byokBot.ts` gains the
  join. No new port method: `GeometryPort.flankVertices(arrow)` returns exactly
  2, and `borderArrows(vertex)` exactly 3 — both already in scope in that file.
  **Do not** add a method to `GeometryPort`, `RulesPort` or `EconomyPort`.
- **Replace the boolean.** `borders_spawner` is retired in favour of one
  `advances=` clause per affected vertex, emitted in `compareArrows` order so
  two ports produce byte-identical offers:

  ```
  advances=<vertex> <held>/3→<held+1>/3 force=<n>/<d>
  ```

  A row that touches no spawner vertex emits no `advances=` clause and no tag.
- **Exactly 2 flanked vertices per arrow.** An arrow can emit at most two
  `advances=` clauses. If both appear, the arrow is **double-fed**; say so with
  a `double_fed` tag rather than making the reader count clauses.
- **`share+N` stays.** It is the realised gain on closure; `advances=` is the
  potential. They are different numbers and both are wanted. Where a row both
  closes and completes, both appear.
- **Completion is called out.** When a step takes a vertex to `3/3`, add tag
  `completes_spawner`. This is the case `share+N` already covers on a closing
  row, but not on the row that merely walks the third arrow of a loop.
- **`unclaimed` is not a holding.** `held` counts owners. An arrow owned by
  nobody advances nothing until it is territory; `advances=` is computed against
  the state **after** `rules.apply`, exactly as `share+N` already is.
- **The spawner-row cap gets a reason.** `MAX_SPAWNER_ROWS = 12` is a relevance
  filter and a seat cannot tell a filtered-out vertex from a non-existent one.
  Either (a) state the cap in the prompt — *"the N most relevant spawners; there
  may be others"* — or (b) raise it to cover every vertex flanked by an arrow in
  the current offer, whichever is smaller. **Pick (a) unless measurement shows
  the cap hides a vertex an offer row advances**, in which case (b) is required
  for correctness and the cap applies only to the non-incident tier.
- **Budget.** Offer size is the constraint. Measure tokens for a mid-game
  position before and after; **growth ≤ 15%**. If it exceeds that, drop the
  `force=` repetition (it is on the spawner row already) before dropping the
  vertex id.
- **Determinism.** No `Date`, no `Math.random`, no iteration over an unordered
  collection feeding ordered output. The existing `compareArrows` / sorted
  `spawners` discipline applies.

## Out of scope

- Teaching prose (P74).
- Lookahead past one step (P76).
- Scoring, ranking or recommending rows. The offer states facts; the model
  decides.
- Any change to the JSON reply contract.
- The heuristic seat.

## Scenario inventory

- A step onto an arrow flanking one spawner emits one `advances=` clause
- A step onto a double-fed arrow emits two clauses and the `double_fed` tag
- A step onto an arrow flanking no spawner emits neither
- Walking the third arrow of a vertex emits `completes_spawner`
- A closing row that completes a vertex emits both `share+N` and `completes_spawner`
- `advances=` reflects post-`apply` ownership, not pre
- An arrow flanking a vertex wholly held by an opponent reports that opponent's
  `held`, so denial is visible
- Two `GeometryPort` implementations (fixture board, generated tiling) produce
  identical offer text for the same state
- Clause order is stable across calls
- Offer token growth for a mid-game position is within budget
- `borders_spawner` no longer appears anywhere in the offer or the prompt

## Repealed assertions

Any test asserting the literal `borders_spawner` tag. This packet also
removes every `borders_spawner` mention from `docs/byok-teaching.md` itself,
including the worked examples ("Hit 5 / 9 shape"). Whichever of P74 and P75
merges second rebases over the other.

## Definition of done

- [ ] `pnpm verify` green.
- [ ] Offer token growth measured and recorded; ≤ 15%.
- [ ] A seat can answer *"which rows complete a spawner, and which force?"*
      from the offer alone, without joining tables.
- [ ] Byte-identical offers from both geometry implementations.
- [ ] **Passes the [P79 gate](./P79-byok-benchmark-harness.md#the-gate-predeclared-before-any-arm-runs)
      as an arm on its own, branched from main**: the primary-mode mean beats
      baseline by more than the noise floor, and nothing regresses past it.
      Numbers recorded in `docs/research/byok-benchmark.md`. **If it does not
      pass, it does not merge.** The branch and its numbers are kept, and the
      packet is marked parked with the result.
