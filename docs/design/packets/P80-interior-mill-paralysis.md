# P80 — Interior stacks: `home_mill` must not call a walk to the edge "waste"

> **Status:** ready. **Depends on:** P15, P32, P64, P66, P79 (the gate).
> Independent of P74 and P75. Each is measured alone.
>
> Audit of the archived grok matches ([benchmark ledger](../../research/byok-benchmark.md#1-interior-paralysis-passing-with-nowhere-useful-to-go-5-of-42-calls)):
> a seat whose stacks sit **inside** its own territory passed its turn with
> no moves, **four turns running**, because every legal row said it was
> waste. That is 5 of 42 archived calls. The cause is in the offer, not the
> model.
>
> **SPEC coverage:** none. No rule change. Adapter-only, in `packages/web`.

## Intent

An interior stack has to cross its own territory to reach the frontier.
Today every one of those steps is tagged `home_mill,onto_home` with
`tipDist=0→0`. The teaching says a mill with an empty trail "is wasted tempo",
and `millOmit` withholds the baseline suggestion when every row is a mill. The
seat is told every move is waste, shown no distance that says otherwise, and
given no suggestion. It passes forever.

Make the offer **true**. A step that shortens the walk to the territory's edge
is not a mill, and the row says how far the edge is.

## BSSN (locked)

- **Edge distance.** For a stack on its own territory, `edgeDist` is the grain
  BFS distance from the arrow to the nearest arrow **not** in the seat's
  territory, capped like `distanceToTerritory` (`DIST_CAP`). It is computed
  for `from` and `exit` of a step whose `from` is own territory.
- **The row carries it.** Every step row whose `from` is own territory emits
  `edgeDist=a→b` in place of `tipDist=0→0`. `tipDist` keeps its meaning for
  every other row and is unchanged there.
- **`home_mill` narrows.** It is emitted only when `fromHome && ontoHome` **and
  `b ≥ a`**, i.e. the step does not bring the stack closer to the edge. A
  step with `b < a` gets the tag **`to_edge`** instead. `onto_home` is
  unchanged.
- **`millOmit` follows the tag.** A `to_edge` row is not a mill. If any row is
  `to_edge`, the baseline suggestion is not withheld.
- **Teaching.** One sentence in `docs/byok-teaching.md`: *crossing your own
  territory toward its edge (`to_edge`) is how an interior stack gets back to
  work; it is not a mill.* The existing mill sentence is scoped to `home_mill`
  only. This is the only prose change. Anything broader is P74.
- **No new port method.** The BFS uses `geometry.outArrows`/`target` and
  `state.territory`, the same pattern as `homewardPath` in `botEvaluate.ts`.
  Generalise that helper with a goal predicate rather than writing a second
  BFS. That is a private change in `web`.
- **Determinism.** Same frontier discipline as `homewardPath`: geometry
  order, `seen` set for membership only, never for ordering. Two geometry
  ports, identical text.
- **Budget.** Offer growth ≤ 5% on a mid-game position. The change replaces a
  token pair rather than adding a clause.

## Out of scope

- Any other tag's semantics: `borders_spawner` is P75, teaching breadth is P74.
- Multi-step lookahead. `edgeDist` is a distance, never a route.
- The heuristic seat. It has its own `chooseMove` and does not stall.

## Scenario inventory

- A stack two arrows inside territory gets `edgeDist=2→1` and `to_edge` on the
  step that approaches the edge
- A sideways interior step (`b = a`) keeps `home_mill`
- A step moving deeper inside (`b > a`) keeps `home_mill`
- A step from territory onto non-territory keeps `leave_home` and is not
  `to_edge`
- With every row either `home_mill` or `to_edge`, `millOmit` is false and the
  baseline suggestion is printed
- With every row `home_mill`, `millOmit` stays true, as today
- Rows whose `from` is not own territory print `tipDist` exactly as before
- Both geometry implementations produce identical offer text
- The archived position (2026-09-10T0657, call 10) re-rendered: at least one
  row is `to_edge`, and the baseline suggestion is present

## Definition of done

- [ ] `pnpm verify` green.
- [ ] Offer growth measured; ≤ 5%.
- [ ] P79 `positions`: the interior-pass rate on the corpus drops to zero for
      positions that have a `to_edge` row.
- [ ] **Passes the [P79 gate](./P79-byok-benchmark-harness.md#the-gate-predeclared-before-any-arm-runs)
      as an arm on its own, branched from main.** Numbers recorded in
      `docs/research/byok-benchmark.md`. If it does not pass, it does not
      merge; the branch and its numbers are kept.
