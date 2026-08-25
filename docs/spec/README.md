# docs/spec — executable specs, one directory per feature

Phase-1 output of `/spec-to-ship`. Each directory holds three files:

- `<name>.md` — overview, terms, mermaid, and the `## Invariants` EARS list
- `<name>.core.feature` — happy path
- `<name>.edge-cases.feature` — boundaries, interactions, degeneracies

`write-failing-tests` turns these scenarios into tests, `code-to-green` makes
them pass, and `review-changes` checks the code back against them. **If a
behaviour is not here, it will not be built.**

## Index

| Feature | Packet | SPEC | Scenarios | Deferred | Invariants |
|---|---|---|---|---|---|
| [geometry-port](./geometry-port/geometry-port.md) | P01 | §2, §7 | 32 | — | 16 |
| [chord-test](./chord-test/chord-test.md) | P01 | §2 | 18 | — | 9 |
| [rational](./rational/rational.md) | P01 | §7 | 19 | 2 | 8 |
| [move](./move/move.md) | P01 | §3, §4, §5 | 25 | — | 12 |
| [tiling](./tiling/tiling.md) | P03 | §2 | 34 | — | 12 |
| [layout](./layout/layout.md) | P03 | §2 | 24 | — | 12 |
| [fixtures](./fixtures/fixtures.md) | P02 | §2, §7 | 18 | — | 13 |
| [movement](./movement/movement.md) | P04 | §3, §4, §2 | 30 | — | 16 |
| [trails](./trails/trails.md) | P05 | §5, §6.1a, §6.1 | 34 | — | 19 |
| [crossings](./crossings/crossings.md) | P05 | §2, §6.1a | 24 | — | 11 |
| [closure](./closure/closure.md) | P05b | §7, §6.1a | 27 | — | 13 |
| [fill](./fill/fill.md) | P05b | §7, §2 | 22 | — | 12 |
| [cuts](./cuts/cuts.md) | P06 | §6.1, §6.1a | 18 | — | 10 |
| [combat](./combat/combat.md) | P06 | §6.2, §11 item 37 | 14 | — | 10 |
| [encirclement](./encirclement/encirclement.md) | P07 | §6.3, §11 item 40 | 16 | — | 10 |
| [economy](./economy/economy.md) | P08 | §7, §11 item 41 | 10 | — | 8 |
| [refuse-self-convert](./refuse-self-convert/refuse-self-convert.md) | P28 | §6.3, §4, §11 item 43 | 25 | — | 12 |
| [win-board-celebration](./win-board-celebration/win-board-celebration.md) | P29 | §9 (read), §7 | 19 | — | 12 |
| [ai-move-playback](./ai-move-playback/ai-move-playback.md) | P30 | — (web) | 16 | — | 11 |
| [selection-chrome](./selection-chrome/selection-chrome.md) | P31 | §4 (read) | 24 (2 live, 22 `@superseded-P34`) | — | 12 |
| [match-summary-telemetry](./match-summary-telemetry/match-summary-telemetry.md) | P32 | — (web) | 26 | — | 11 |
| [encircled-path](./encircled-path/encircled-path.md) | P33 | §6.3, §6.1, item 40 | 11 | — | 9 |
| [ray-run-input](./ray-run-input/ray-run-input.md) | P34 | §5 (one prose edit), §3/§4 (read) | 86 | — | 21 |
| [seat-vanish-fx](./seat-vanish-fx/seat-vanish-fx.md) | P39 | §9, §6.1, §11 item 45 | 28 | — | 16 |
| [birth-cut](./birth-cut/birth-cut.md) | P40 | §6.1, §7, item 47 | 11 | — | 9 |
| [trails-simple](./trails-simple/trails-simple.md) | P22, P42 | §5–7, items 42, 49 | 20 | — | 11 |

631 scenarios. **94 are in scope for P01**, 2 are tagged `@deferred-P08`,
**58 belong to P03**, **18 to P02**, **30 to P04**, **58 to P05**, **49 to P05b**,
**32 to P06**, **16 to P07**, **10 to P08**, **25 to P28**, **19 to P29**,
**16 to P30**, **24 to P31** (22 of them now `@superseded-P34`), **26 to P32**,
**11 to P33**, **86 to P34**, **28 to P39**, **11 to P40**, and **20 to P22/P42**.
641 concrete cases once `Examples` rows are expanded (combat Examples add more),
315 invariants.

**This index is not complete.** The online packets (`online-*`) and the planner
directories (`findings-planner`, `intercept-findings`) have never had rows, and
the event-legibility work shipped its tests
(`packages/web/test/event-legibility.*`) with no `docs/spec` directory at all —
so the rule below cannot be checked against it. Both gaps predate P34 and are
recorded here rather than papered over.

A `@deferred-<packet>` tag means the behaviour is decided and specified here, but
its seam falls in another packet — an accumulator that knows its owner is not a
`Rational`. It is not a `@wip`. **A scenario with neither a test, this tag, nor a
`@superseded-<packet>` tag is a defect**, and eleven of them once were.

A `@superseded-<packet>` tag means the behaviour was built, shipped, and then
**removed** by the named packet, which now owns that surface. It is deliberately
testless, and permanently so: the scenario stays as the record of a decision that
moved, and the naming packet's overview says where any surviving half went. Do
not write a test for one — the app no longer does what it describes, so a passing
test would be asserting the wrong game.

> **These counts moved when SPEC §11 item 4 made the board unbounded.**
> `geometry-port` grew (windows need their own contract), `tiling` grew despite
> *losing* the whole seam and board-floor surface (unboundedness needs asserting,
> and so does the symmetry that setup may use), and one `@deferred-P02` scenario —
> *a board too small to be conformant is rejected* — was deleted outright, because
> there is no board size to be below.

## Reading order for P01

`geometry-port` and `rational` are shape and arithmetic — they assert facts, and
an implementation either has them or does not.

**`chord-test` is different and deserves more attention than its size suggests.**
It is the only file in P01 that encodes a *rule*, it is the subtlest logic in the
game, and it is the one place where a wrong-but-plausible implementation would
pass a casual reading. It is also totally specifiable — 225 ordered pairs over
the 15 chords six slots admit, of which a layout realizes 81 — so there is no
excuse for leaving any of it to inference.

`move` is a DTO, and its job is mostly to make illegal shapes unrepresentable.
Its edge cases carry more weight than its core.

## Reading order for P03

`tiling` is the first real `GeometryPort`, so most of what it must satisfy is
already written — the 37-assertion conformance suite. Its own scenarios cover what
the suite cannot: unboundedness in every direction, window degeneracies,
determinism, and which lattice symmetries setup is allowed to use.

**`layout` looks cosmetic and is not.** SPEC §2's out-directions have to sum to
zero *and* sit 120° apart; a set doing only the first is an isomorphic graph that
passes every conformance assertion and renders skewed. Layout holds the only
executable check on that, and on the up/down twist parity — a mistake there still
tiles the plane perfectly and just quietly deletes the arrowhead. Both failure
modes are invisible to every other test in the repo.

## Reading order for P02

`fixtures` is the *second* real `GeometryPort`, so like `tiling` it inherits the
whole 37-assertion conformance suite unedited — passing it against a board built a
different way is the packet's main claim. Its own scenarios cover what is peculiar
to *authoring* a board: construction-time validation that names the offending
point or arrow, vertices derived from cycles rather than authored, and finite-board
windows.

**The one scenario to read first is `Every straight-ahead ray closes on itself`.**
It is the finite-board limit made executable, and it is the reason `fixtures`
carries no closure, fill or encirclement scenarios — those are structurally
impossible on any finite board (SPEC §11 item 4) and test against the tiling
instead. A reader who misses it will think the packet forgot half the port.

## Reading order for P04

`movement` is the first rules behaviour. Read it after `move` (the DTO) and
`fixtures` (the board the scenarios run on). Trails, combat and territory are
deliberately absent — a step relocates heads on an occupancy map, and an
enemy-occupied destination is refused rather than resolved.

**The merge-cost scenarios are the ones to read first.** Minority / equal /
majority arrivals, and the "later small arrival cannot un-bar" case, are where a
plausible-but-wrong implementation most often invents a rule. The conveyor
scenario is the same arithmetic in costume.

The subtlest of them is not a scenario at all but the invariant that the override
**rides with the heads** (SPEC §11 item 33). Its only witness is a property test,
because the rejected reading — the override as a fact about the arrow the merge
happened on — passes every scenario here and lets one ordinary step refund the
whole merge price.

## Reading order for P05

Two directories, because trail bookkeeping and the crossing predicate fail in
different ways. Read `trails` first — `crossings` asks questions of the state
`trails` defines.

**In `trails`, the rule to read first is the branch-anchor mandate**, and the
overview's table of three readings is the reason. §5 states it in one sentence
that is grammatically ambiguous about *when* it bites, and two of the three
readings freeze the board the first time damage legally empties a fork. The
scenario that tells them apart — *an already-unanchored branch does not freeze the
board* — is in the edge cases and is the most load-bearing line in the packet.

That sentence turned out to be ambiguous about *how much* it charges as well, which
P05's review caught and **§11 item 35** settled: **one head per branch, not one per
strand**, so a sibling arm carries the toll for a whole junction. No scenario
discriminates the two readings — each puts heads on at most one strand per side —
so the three properties in `trails.invariants` are the only thing holding the
decision. Read them next.

**In `crossings`, read the `i × o` table first.** A point presents one chord per
(in, out) pair and an implementation that tests only the first passes every spine
and quietly fails every knot. The two predicates are the other trap: `chordsCross`
for an enemy trail, `chordsInterleave` for your own, differing exactly by
coincidence — and §7 needs the narrow one.

Neither directory resolves anything. A crossing is *reported*; what it destroys is
P06 and what it claims is P05b.

## Reading order for P05b

Two directories again, and the split is the same shape: `closure` is graph
bookkeeping over the trail set, `fill` is a topological algorithm. They fail
differently and one hands the other its input, so read `closure` first.

**In `closure`, the rule to read first is the backward walk.** §7 needed opposite
answers in two passages — the pincer's second arm has to stay an *open trail* or it
has nothing left to enclose, and a cut fragment driven home has to claim "the path
itself" even though a fragment is entirely a dangling arm. Following the trail
*against the grain* from the closing arrow gives both: a fork's other arm is
downstream, a fragment is upstream. It also decides enclose-versus-strip from the
same traversal, so there is no second gate — which is why `anchorGrade` is not
consulted here even though it looks like the obvious test.

**`fill` is the subtlest logic in the game and §6.1a says so.** It is the one place
where a wrong representation produces a *wrong answer* rather than a crash. Three
scenarios carry it:

- *A walk cannot escape between two boundary arrows meeting at a point* — the
  diagonal leak. If it fails, every enclosure on the board leaks and nothing else
  reports it.
- *Two separate rings around one region claim the whole interior* — where even-odd and
  reachability part company. **§7 chose reachability** (§11 item 36): parity would call
  that core *outside*, and it is plainly surrounded.
- *A finite board has no infinity to fail to reach* — the reason this is the first
  suite that cannot use a fixture board.

Neither directory converts a head. §7 grants the enclosed tiles "and everything
standing on them — enemy heads, converted", and the conversion half is P07's; the
seam is a named scenario so a surviving enemy head is not read as a rule.

## Reading order for P06

Two directories: `cuts` is evaporation (§6.1); `combat` is contact on an
enemy-occupied arrow (§6.2 / §11 item 37). Read `cuts` first if you care about
trail destruction; read `combat` first if you care about the P04 seam.

**In `combat`, the rule to read first is the trigger.** Contested-point 1:1 is
withdrawn — two stacks that merely point into the same point do not fight.
Stepping onto the enemy group is the only fight. Equals favour the attacker;
floor may zero the attacker's loss when moderately larger (accepted PoC).

**In `cuts`, read firebreaks and all-to-all next.** One kill per front; halt per
arrow; territory is a wall; survivors demote to stack grade. Conversion is P07.

When the same step is both contact and a cut: **combat first, then cut**.

## What is deliberately not here

A `Then` step that asserts a behaviour its packet does not own has leaked.

- **P01** owned shapes, not legality — whether an exit is really an out-arrow, or
  a crossing is won, lived in later packets.
- **P04** owns movement legality, not combat or territory — an enemy-occupied
  destination was refused here as a seam; **P06** now resolves it as contact
  combat (§6.2). Closure, fill, spawners and victory are later still.
- **P05b** owns what a landing claims and what a closed curve contains — not what
  happens to the heads standing on it. Conversion is P07, evaporation is P06, and
  an accumulator resetting on capture is P08. No scenario here enumerates a
  vertex: a special's ownership is a reading of its three bordering arrows
  (§11 item 34), and a second copy of that fact could drift from it.
- **P05** owns what a trail *is* and whether a traversal crossed it, not what
  either causes. A step landing on your own territory marks nothing and claims
  nothing (P05b owns closure); a crossing is a verdict with no consequence (P06
  owns evaporation and combat); no scenario reads a vertex (§11 item 34 — a
  special is owned in thirds by its bordering arrows, so ownership is a reading of
  tile ownership and this packet owns no tiles).
