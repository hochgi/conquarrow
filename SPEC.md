# Conquarrow — Design Spec

*Turn-based territorial conquest on an arrow tiling. Volfied's carve-and-enclose loop, rebuilt as a deterministic skirmish game.*

Status: complete for MVP. What is not decided is listed in §11. Design reasoning that is not obvious from the rules lives in [ADR 0008](docs/adr/0008-spec-design-rationale.md).

---

## 1. Premise

Two or more players carve territory out of a plane tiled with interlocking arrows. You advance **heads** along the arrows, leaving a **trail** behind them. When your trails close a loop, everything inside becomes yours — including a share of every **spawner** the new ground borders, which then starts producing for you, and any enemy unit caught there with no way home (§6.3).

You can only be cut while you are growing. That is the spine of the whole design.

### MVP delivery shape

The first playable is a **stateless, client-only, hot-seat** game: players alternating on one machine, the whole match held in memory, no save/resume, no server. Perfect information (§4) is what makes hot-seat exactly right — there is nothing to hide between turns, so passing the mouse costs the design nothing. Local heuristic and BYOK seats are adapters on top; the rules do not know who drives a seat.

This is a **delivery decision, not a rules decision**. It removes netcode and persistence from MVP scope without touching a mechanic. Its one structural consequence is that *what a move is* has to be concrete — see §4.

The engine takes 2–8 seats (§8). The web lobby offers 3 or 6, which is an adapter choice. **Async online multiplayer is not specified in this document.** It is [ADR 0002](docs/adr/0002-cheap-async-online.md), amended by [ADR 0009](docs/adr/0009-remote-agent-mcp-seat.md): Lambda re-applies the same engine, S3 holds state. A lobby with no agent seat still needs at least two humans before any AWS game object; a lobby with an agent seat needs at least one human. Do not read HTTP, invites, or WebSockets into the rules chapters below.

A **non-normative** BYOK teaching summary lives at [the BYOK teaching file](docs/byok-teaching.md); the teaching file must not add a game rule.

---

## 2. The Board

The playing field is the arrow tiling from the source image.

- **Tiles are arrows.** Each arrow is a node in the movement graph.
- **Movement follows the grain, always.** A head advances *in the direction the arrow points*. There are no exceptions and no backwards movement — see the reachability note below for why none is needed.
- **Points are 3-in / 3-out.** Arrows converge at points; every point has **exactly 3 arrows in and 3 arrows out**. Points are where trails are crossed. Combat is per arrow (§6.2).
- **Girth is 3.** The shortest directed cycle is the pinwheel triangle — three arrows turning about a shared vertex. The minimum enclosable loop therefore costs 3 arrows and 3 steps, which is what sets the scale of the economy (§7).

### Trails own points, not just arrows

Consecutive arrows in a trail meet at a **point** — they share a vertex, not an edge. Two tiles touching at a single point **do not form a barrier**: this is the diagonal-leak problem from flood fill, where 8-connected movement escapes a 4-connected wall. If crossing meant "land on a trail arrow," an enemy could thread through the vertex between two trail arrows without touching either, and enclosures would leak.

> **A trail owns the points it passes through.** A crossing is a traversal of a point the trail passes through whose chord interleaves or coincides with the trail's (the chord test, below) — not the occupation of a trail arrow.

### The chord test

Each point has six surrounding arrow-slots (3 in, 3 out). A path transiting the point draws a **chord** from its in-slot to its out-slot.

> **Blue crosses red iff their chords interleave** — blue's pair separates red's around the circle — **or coincide**, meaning blue's exit arrow *is* one of red's trail arrows.

This single test covers both real cases: threading between two of red's arrows (interleave) and landing directly on a red arrow (coincide). Coincide is a crossing even where red presents no chord at the point — where red's trail only leaves it (no in-arrow there, `i = 0`), stepping onto that arrow still crosses. A blue chord that stays on one side of red's — turning aside rather than through — is not a crossing, and neither is a chord that shares one slot with red's without interleaving it, when blue's exit is not a red arrow (touching, not crossing).

**Crossing is therefore a decision, not a tripwire.** A head standing at a point an enemy trail runs through has not crossed anything; it commits by choosing its exit arrow. Three things follow with no extra design:

- A head can **shadow** an enemy trail, travelling alongside it point after point without triggering anything, choosing its moment.
- A defender can **hold a contested point** without committing to a fight.
- Two trails can **race in parallel** through the same corridor, mutually aware and mutually unobligated — until one of them turns.

All three survive contact combat (§6.2) only because **declining is always legal**: no step is ever forced (§4), so adjacency never forces a fight. Two stacks that merely share a point ahead do not fight; what costs heads is *stepping onto* an enemy-occupied arrow — never the right to stand beside it.

The chord test is read in two places:

- **Crossing an enemy trail** — a successful crossing is a **cut** (§6.1, which lists every kind of cut).
- **Fill** — two of your arrows meeting at a point wall a pocket, though no tile sits in the gap (§7).

Combat does not read chords; it is resolved on the destination arrow (§6.2). Revisiting a point of your own trail is legal and has no effect of its own (§6.1a).

It subsumes the tile rule for free: an enemy cannot stand on your trail arrow without entering it at its tail point, and that step is a coincide there, whatever chords your trail presents at that point.

**A point may present more than one chord.** Where a trail uses `i` in-arrows and `o` out-arrows at a point it is a join followed by a split (§6.1a), so it offers **`i × o` chords** there — one per (in, out) pair — and a traversal is tested against each for interleave; coincide is tested against the trail's arrows directly, so it applies where `i` or `o` is 0 too. A spine offers one, a fork or a join two, a **crossover** four, and a point the trail runs through three times over offers nine. At that last one all six slots are the trail's, so no enemy can transit the point at all: a full crossover is impassable by arithmetic rather than by rule.

### Formal definition — the oriented triangular lattice

An arrow touches exactly four interesting places: its origin point, its target point, and the two vertices on its left and right. With 6 arrows per point and 3 per vertex, the incidence counts close:

```
6P = 2A  →  A = 3P          (6 arrows per point, 2 points per arrow)
3V = 2A  →  V = 2P          (3 arrows per vertex, 2 vertices per arrow)

arrows : points : vertices  =  3 : 1 : 2
```

which is exactly *edges : vertices : triangles* of a triangular lattice.

> **The arrow tiling is the oriented triangular lattice.**
> Lattice **vertices** are the movement **points**. Lattice **edges** are the **arrows**, each carrying a fixed orientation. Triangle **centres** — a honeycomb, two per lattice point — are the **vertices**.

**Terms.** A **vertex** is a triangle centre: bordered by three arrows, never occupied, never enclosed. A **special** is what may sit on a vertex; in MVP the only special is the **spawner** (§7). `GeometryPort` calls the vertices "the spawner-vertex lattice"; it is the same set.

The chevron artwork is a decoration of a directed edge; the graph underneath is the lattice. Everything else follows rather than being asserted:

- A point has 6 incident edges — 3 in, 3 out.
- The **girth-3 pinwheel** is a lattice triangle whose three edges circulate.
- **That triangle's three arrows are exactly the three arrows bordering one vertex, its own centre.** The atomic unit of conquest and the atomic unit of value are the same object: the minimum enclosable territory holds every share of exactly one vertex, which carries a spawner if the field puts one there (§7). Every board must satisfy this: it is a `GeometryPort` conformance invariant.
- **An edge borders exactly two triangles**, so two spawners feeding one arrow is a structural hard cap. Triple-fed arrows do not exist.
- The **board is the lattice itself, unbounded** — no quotient, no cut-out, so 3-in/3-out holds everywhere and there is no rim. What is finite is the *interesting* region, not the geometry: §7's spawner force decays with distance from the origin and reaches zero, so all the balance lives inside a disc while adjacency stays total. See *the board is unbounded* below.

**The generator constants, confirmed against the artwork.** Basis `u = (1, 0)`, `v = (½, √3⁄2)`. The three out-directions in lattice coordinates are

```
OUT = { (1, 0), (-1, 1), (0, -1) }        world angles 0° / 120° / 240°
```

which must satisfy **both** conditions and it is easy to pick a set that satisfies only one: they sum to zero (so the directed 3-cycle closes and girth is 3) *and* they sit 120° apart (so the board is mirror-symmetric rather than skewed). Each point owns two triangles, at `+(⅓, ⅓)` and `+(⅔, ⅔)` — one "up", one "down" — whose centres are its two vertices. A point **owns** these two vertices.

Two facts fall out:

- **An arrow's two flanking triangles are always one up and one down.** Never two of the same kind. So §7's cap of two feed slots per arrow is geometry, not a rule.
- **Slots alternate in and out**, and with the generated tiling's slot indexing the in-arrows fall on the odd indices. That phase is the implementation's labelling, and nothing may depend on it (below).

The chevron's own outline — where the boundary between two tiles bends on its way from a triangle centre to a lattice point — is a **rendering** parameter and lives with the tiling implementation, not here. See [P03](docs/design/packets/P03-tiling.md).

### Orientation pattern: alternating

Balance (3 in, 3 out) does not by itself fix *which* slots are which — the 3-fold symmetry sits at the vertices, not at the points. Two patterns are consistent with everything above, and **the lattice has the alternating one**:

| Pattern | Successors from any arrow | Consequence |
|---|---|---|
| **Alternating** — out at 0°/120°/240° | straight, or turn **±120°** | both handednesses available; this lattice |
| Three-consecutive | straight, or turn +60°/+120° | chiral board — left turns only; not this lattice |

The out-set at every point is the three directions at 0°, 120° and 240°, so **the six slots alternate in/out around the hexagon** and the in-set is the complement at 60°, 180° and 300°. The three out-vectors sum to zero, so the directed 3-cycle exists and girth is 3; exits from any in-arrow are straight or ±120°, so both handednesses are available and the board is mirror-symmetric rather than chiral. That last property is the one the crossing examples demand: a head can turn *either* right or left aside from a trail without crossing it.

P03 generates the board from two basis vectors. Three-consecutive stays named because the chord test is written against cyclic slot order alone and its suite uses that layout as a **counterfactual** — the way it proves the predicate never asks which slots are in-slots.

**Alternation binds every board, not just the generated one.** It is part of what `GeometryPort` means and a conformance requirement, because *both handednesses available* is what the crossing rules (§2, §6.1) assume when a head turns aside from a trail without crossing it — a chiral board would answer those scenarios differently. What is **not** fixed is the *phase*: which slot index the alternation starts on is the port's own labelling, and nothing may depend on it. In-arrows may occupy the even slots or the odd ones; they may not sit two-in-a-row. Fixture boards need not be lattices, only satisfy the conformance suite (ADR 0008).

The shortest directed cycle is 3, so **a stranded head loops back onto its own trail in three moves** — legal, since a trail is a set and re-traversal adds nothing to it (§6.1a invariant 2). Retreat is cheap, and that is a balance watch-point in both directions: §6.1 softens a cut by demoting rather than destroying what lies beyond it, and hardens one by evaporating backward as well as forward.

### Reachability

The movement graph is directed, which normally risks one-way currents and absorbing pockets. It doesn't here:

> A weakly connected digraph in which every node is **balanced** (in-degree = out-degree) is **Eulerian**, and Eulerian implies **strongly connected**.

3-in/3-out satisfies balance exactly, so every arrow is reachable from every other and no head can ever be trapped. This is why no against-the-grain rule is needed: a head U-turns by navigating forward around a loop, which costs real distance and lays fresh cuttable trail the whole way. Retreat stays dangerous without any special case.

**This holds on the infinite tiling only.** Cutting a finite board out of it would leave rim points with missing arrows, breaking balance precisely where camping happens and potentially creating genuine sinks at the edge.

### The board is unbounded: the plane

> **The board is the infinite lattice.** It does not wrap and it does not end. Balance, and with it the connectivity proof, holds at every point because there is no point that is special.

A cut-out rectangle breaks balance at the rim, which is exactly where camping happens. A torus keeps balance but has no outside: fill (§7) asks whether a pocket can reach infinity, and on a torus that question is undefined (ADR 0008). The plane gives three things:

- **A closed curve has an inside** (§7).
- **There is a centre**, so map symmetry (below) and §8's contested middle mean what they say.
- **No size floor.** *A girth-3 triangle borders exactly one vertex* is local and unconditional, as is strong connectivity: the three out-directions span ℤ² and sum to zero, so every displacement is reachable in non-negative steps.

The costs are paid elsewhere. **Enumeration is never total** — `GeometryPort` answers a bounded window rather than "every point". And **running away is geometrically possible**; §7's radial gradient removes the *reward* for it and §9 ends it.

**Specials** sit on vertices, kept or dropped by an irregular, deterministic thinning at setup (§7).

### Map symmetry

For two seats, the field and the homes are **mirror images** in a line through the origin (below), so both home regions have the same specials at the same directed distances. For 3+ seats, homes are placed per §8, and an exactly fair field is open (§11). A denser contested cluster sits at the centre, far from every start. Deterministic — no random map generation. (StarCraft's naturals-plus-contested-center recipe.)

**Which symmetry, exactly, is not free to choose — the grain constrains it.** A fair map needs an automorphism of the *oriented* graph, and the obvious candidate is not one:

| Map | Effect on `OUT` | Verdict |
|---|---|---|
| 180° rotation `(i,j) ↦ (−i,−j)` | reverses every direction | **not a symmetry** — an anti-automorphism. The second seat would get a board running backwards |
| 120° / 240° rotation | permutes `OUT` | automorphism, **order 3** — serves three seats, not two |
| Reflection `(i,j) ↦ (i+j, −j)` | fixes `(1, 0)`, swaps the other two | automorphism **and** involution — the two-seat symmetry |

> **Two players are placed as mirror images in a line through the origin.** In world coordinates the reflection is the x-axis; it fixes the origin, so it preserves any radial gradient, and it is an exact automorphism of the oriented graph, so every line of play available to one player has an exact counterpart for the other.

The mirror swaps handedness, which is harmless precisely because the alternating pattern made the board non-chiral in the first place. The point group preserving the out-set is *D*₃ — identity, ±120°, and the three mirrors through the grain directions — so exact fairness is available for 2 seats (a mirror), 3 (120°) or 6 (the group). Where homes sit for each seat count is §8.

---

## 3. Units: Heads and Stacks

- A player's units are **heads**.
- A player's heads on the same arrow **merge** into a **stack**, automatically.
- **Stack size is lives** — in combat. A head is what an exchange takes (§6.2) and the stack is the pool it comes from. Heads are *not* lives in the match-survival sense: losing your last head is survivable while you still own production, and what ends a seat is being unable to ever claim again (§9). A 3-stack is literally three heads standing together. There is no separate HP stat — a stack that loses one becomes a 2-stack.
- **Splitting is unmerging.** A stack may shed heads freely (see §5, sentries). The rules impose no minimum — branching is free (§5).
- **Merging is free and automatic.** Two of your heads ending a move on the same arrow merge. No action cost, no declaration.

Both directions are free, deliberately. Spawners produce **dispersion** — heads arrive one at a time on different arrows (§7) — so concentration is already the work the player is doing. Taxing the merge would tax the exact play the economy forces on you.

### Speed

A stack moves faster than a single head, but **sub-linearly** — stacking must never beat splitting on raw throughput.

> **`speed(N) = 1 + floor(log₂ N)`** — every doubling adds one step.

```
N:      1  2  3  4  5  6  7  8  ...  15  16
speed:  1  2  2  3  3  3  3  4  ...   4   5
```

**Allowance is a whole number, and nothing banks.** No fractional movement, no carry between turns, no saving a step for later. A group gets its steps and either spends them or loses them.

Whole steps are chosen for readability: a player can tell at a glance how far any stack moves this turn, which a fractional curve with banked remainders would hide. Predictable jumps beat elegant fractions in a game whose whole appeal is that an attentive player can compute the next move (ADR 0008).

Two properties make this the right ladder:

- **Splitting still wins on throughput, always.** A 4-stack takes 3 steps where four singles take 4; a 16-stack takes 5 where sixteen singles take 16.
- **The pair is free.** `speed(2) = 2`, exactly what two separate heads get, so pairing costs nothing in distance and buys concentration. One head is enough to stop a front (§6.1), and the rules require no sentry at all (§5); a pair is what a player chooses when it wants a firebreak that can also hold its arrow in a fight. **The game's natural atom is the pair**, and it falls out of the curve rather than being chosen.

Exact rationals do not leave the engine: spawner accumulators carry their remainders (§7). **Movement is integer, economy is exact rational** — production is a slow trickle you must be able to bank, whereas tempo you did not use is tempo you gave away.

### Merging costs the turn

Merging is free (above) but it is **not instant**.

> **A stack that merged this turn has speed 1 for that turn**, and **speed 0 if any group that arrived was larger than what it joined.**

The heads that walked in have already spent their move getting there — they are carried, not carrying. So the only question is what fraction of the merged stack has already moved. Arrive as the **minority** and most of the stack is fresh, so it may still take a step. Arrive as the **majority** and most of it has already gone, so it stops. Equal counts still move: half is fresh.

***Any* is load-bearing.** Once a stack is barred for the turn, a later small arrival cannot un-bar it — otherwise merging big-then-small would launder the restriction, and the order the player chose (§4) would decide the rule rather than the rule deciding.

**The price rides with the heads, not with the arrow.** There is no stack to hang it on — a group is whoever stands on an arrow right now (§5) — so the override travels with the heads that paid it. A merged group stepping onto empty ground is still at its overridden speed when it arrives, and on a split both parts carry the override exactly as both inherit `spent`. Step onto ground already held and the override is computed **fresh** there, from arrival against joined, so nothing accumulates and big-then-small still cannot launder a bar. An override tied to the arrow would let one ordinary step refund the whole price, which is the free mid-turn upgrade this rule exists to close.

Stated as a speed override rather than a special case, so nothing else needs changing. The merged group keeps the destination's `spent` (below), so if the group it joined already stepped this turn, that step has used the speed-1 allowance; the bonus arrives next turn when the stack is no longer *recently merged*.

This prices two exploits at once. Without the speed-1 clause, walking a spare head into a stack would be a free mid-turn speed upgrade and the correct opening move every turn would be to merge before doing anything else. Without the speed-0 clause you get the conveyor below for nothing.

### Allowance and spending

A **group** is the heads of one player standing on one arrow. Allowance belongs to the group — not to a head, not to a player.

> **A group may step while `spent < speed(size)`**, where `spent` counts the steps that group has already taken this turn.

Both are whole numbers and neither survives the turn boundary. Two rules make a change of composition behave:

- **On a split, both parts inherit `spent`** — and any merge override with it (above). Only the portion that moves pays for the step. The portion that stayed has spent nothing extra and may still act — branching off in another direction, or following the same path a step behind (§6.1a).
- **On a merge, the arrivals' spending is discarded and the destination's is kept**, and the merged group's speed is overridden per the rule above. The arrivals already paid to get there; they are carried, not carrying.

**Splitting needs no penalty of its own, and that asymmetry is not an oversight.** Merging up mid-turn would be a free upgrade if unpriced, because a larger group is strictly faster. Splitting down needs no such guard: inheriting `spent` already prevents the double dip, because a stack that has taken its step cannot split into scouts that have not.

What survives is exactly the throughput advantage splitting is supposed to have:

| a fresh 4-stack (speed 3) | steps this turn |
|---|---|
| moves as one | **3** |
| splits 2 + 2, both move | **4** — two steps each |
| splits 1+1+1+1, all move | **4** — one step each |
| moves as one, *then* tries to split | **3** — the parts inherit the spend |

The last row is the whole rule in one line: **splitting is a decision you make before you move, not after.**

And a group large enough to afford two steps takes its rear guard with it. A 6-stack splitting 4 + 2 sends the 4 forward three steps while the 2 follows behind at two — a spearhead with its firebreak trailing it, from one ordinary split.

### The conveyor

The merge rule permits a real manoeuvre worth naming, because it looks like an exploit and — priced — is not.

Park heads along a chain of arrows and shuttle forward link by link: the rear group merges into the next arrow, that stack steps into the next, and so on, until the whole parked force stands on the far end. Unpriced this is a genuine throughput exploit — a chain of four single heads delivers 10 head-arrows in one turn where those four heads moving independently deliver 4.

The speed-0 clause prices it exactly. Each link must be **no smaller than the stack arriving at it**, and the arriving stack grows every link, so the breadcrumbs have to grow at least as fast as their own running total — geometrically. A five-link conveyor is `1, 1, 2, 4, 8`: sixteen heads parked to deliver **15** head-arrows, where those sixteen heads moving as their own groups would deliver 50.

So the conveyor is not a speed trick, it is a **concentration trick that costs most of its own movement** — exactly the trade §3 is about, made by hand. A naive chain of equal links gets one hop and stops.

On a trail the parked links stand on cuttable trail: a cut burns the bare trail between them up to the nearest link (§6.1), and contact combat can take a link (§6.2) — so a conveyor laid across open trail is a large, immobile, visible investment. In your own territory its links cannot be cut, only attacked (§5), and that is where it is strongest — the same "a large empire repositions instantly" pressure §10 already accepts.

### Why both merging and splitting are attractive

| | Merge | Split |
|---|---|---|
| Total throughput | ~1.5–2 moves/turn | N moves/turn |
| Chain-laying speed | fast | slow (one chain per head) |
| Combat strength | concentrated | scattered |
| Board coverage | one tile | N tiles |

A territory is closed by **one** chain, and that chain advances at the speed of the single unit laying it. So the stack is the only thing that can finish a large enclosure before the enemy arrives to cut it — while splitting gives you presence, garrisons, and more total work done. Neither dominates.

---

## 4. Turn Structure

- Seats alternate turns in a fixed order, hot-seat (§1). The engine takes 2–8 seats (§8).
- Perfect information. No fog of war, no hidden state.

### A turn is a sequence of single steps

> **A step takes a portion of one arrow's heads one step along an out-arrow. A turn is an ordered list of steps, ended by the pass.**

There are two kinds of **move**. A **step** names a **source arrow, a destination out-arrow, and a count** — nothing else. The **pass** (`endTurn`) ends the turn. Elsewhere in this document "a move" that goes somewhere is a step. There are no unit identities to track; a stack is just the count standing on an arrow (§5).

- **The player chooses the order.** Which stack steps next is a player decision, not an engine rule. This is why the per-step model was chosen: there is no within-turn resolution order to invent, and the ordering the player picked is already carried by the move list a replay stores.
- **A stack may move, or not.** There is no move that means *not*: a stack that stays put is simply named nowhere in the turn. Nothing compels a step.
- **A stack may step more than once per turn** if its allowance permits, and those steps may be **interleaved** with other stacks' steps. A 3-stack's 2 steps do not have to be spent consecutively.
- **Sending different portions to different out-arrows is how a fork is made** — two moves from the same source, each with its own count. The pincer (§7) needs no special move.
- **The turn ends when the player passes.** When no group has a step left, the pass is the only move offered.

### What travel costs, and what closure costs

The out-set at every point is the three directions at 0°, 120° and 240° (§2), and those three unit vectors sum to zero. Two consequences, and they pull in opposite directions.

- **Travel is anisotropic — 1 step with the grain, 2 against.** A net
  displacement of *k* in an anti-grain direction costs exactly *2k* steps: *k* of
  each of the other two out-directions, **in any order**. Walk 5 along 0° and it
  is 10 steps home. Three directions are cheap and three cost double, so *where
  you are going* is a real part of what a move costs.
- **A closed walk is balanced.** A walk returning to the arrow it left needs
  `a·d₀ + b·d₁₂₀ + c·d₂₄₀ = 0` with non-negative counts, and the only such
  combination is `a = b = c` — so it has length 3k with equal counts of each
  direction. This is what fixes girth at 3 and the U-turn at 3 steps (§2), and it
  is **all** it fixes.

**A claim is not a closed walk, so claiming is anisotropic too.** Closure (§7)
lands on your territory, ordinarily having departed it from a *different* arrow.
The loop is closed by the boundary you already own, not by the trail, so the trail
is free of the balance constraint above. A frontier the cheap directions sweep
across encloses at 1 step per unit; the same ground behind an unfavourably
oriented frontier costs 2.

**So the anisotropy touches everything: reach, return, and claim.** Walking out
to the contested centre, walking home from it, and closing around what you took
are three separately-priced journeys, and a seat can be handed an advantage in any
of them. There is no cheap scalar that captures it — which is exactly why §7's
field is mirrored rather than balanced to a tolerance. An automorphism of the
oriented graph equalises **all** directed path lengths at once; a threshold on a
distance equalises one and silently trades the rest.

**The trade this makes, said out loud.** Cheap-out/dear-back and
dear-out/cheap-back are genuinely different strategic postures — one seat better
placed to strike, the other to consolidate. A 180° board would hand two seats
opposite postures, which is more interesting than a mirror and is *not fair*: 180°
is not an automorphism (it maps 0° to 180°, which is not an out-direction). The
mirror gives both seats the **same** posture. That is the flavour the fairness
costs.

**Ordering within your own turn is therefore a real tactic.** Stepping one head onto a stack to reinforce it before another head commits to a crossing is a legal and intended play — though §3's merge rule means the reinforced stack pays for it in tempo.

**Illegal steps are refused, never applied.** A step against the grain, an overdraw, an attack that would empty its source (§6.2), or a step onto another player's territory that §6.3 does not allow is illegal: `legalMoves` omits it and `apply` throws. The stack does not move, does not fight, and does not convert.

**Standing still is normal, not a fallback.** A rearguard head on an open trail is doing its job by standing still (§5): stepping forward only lengthens the trail it is there to guard, and drags it away from the stretch it defends. Expect a typical turn to move a minority of the units on the board.

---

## 5. Trails, Safety, and Sentries

### The safety rule

> **Moving inside your own closed territory lays no trail and costs no exposure. The moment you step off it, you are trailing and you are vulnerable.**

Everything below follows from this one rule.

- A head on its owner's territory has **no trail**, so it **cannot be cut**. It can still be attacked by contact combat (§6.2) — by a raider stepping from its own territory or from a territory-grade trail (§6.3) — and it is taken when a claim carves the ground under it (§6.3, §7).
- Therefore: **you can only be cut while you are growing.** Turtling is safe from cuts but static; growth requires exposure; the game cannot stall.

### The geography this creates, for free

- A trail laid tight against the enemy border is **cheap for them to cut** — they slide up through their own safe ground and expose themselves only on the final step.
- A trail laid in **neutral ground** costs the defender a real trip through open terrain, which is where decoy-and-flank play pays.
- A **lasso deep inside enemy territory** is brutally hard: they are on safe ground the whole time and you never are.

Result: fights concentrate at the frontier, heartlands resist raiding, and conquest grinds borders inward. No special rules required.

### Sentries

There is **no drop action and no pickup action.**

> **An arrow holds a count of heads. A step takes any portion of that count one step along an out-arrow.**

Leaving some behind *is* the drop. Sending heads onto an arrow that already holds yours *is* the pickup, and it merges under §3 like any other arrival — no carve-out, no declaration, no placed-versus-loose distinction.

A **sentry** is therefore not a kind of unit. It is the name for heads you chose not to bring: a stationary garrison defending that stretch of trail, indistinguishable from any other stack of the same size sitting on the same arrow.

This is the third leg of the tension: every head left behind makes the chain safer and the far end slower and weaker. Greed, speed and safety trade against each other in a decision made repeatedly along the way — and because the portion is just a number on the move, that decision is available at *every* step rather than at authored moments.

### Branching is free

**Linear trail carries no heads.** A tip walks, marking arrows behind it, and leaves nothing. (Behind it *including the one under it*: a step marks its **destination** as trail, unless the destination is already the mover's territory. So a head off its own territory always stands on trail, and the step does not mark the ground it departed. A step from trail onto the mover's own territory is a closure (§7). §6.1 depends on that — a front halts when it would enter an arrow holding the victim's heads, which requires the occupied arrow to be part of the trail — and so does the safety rule above, since the first step off your own territory must not mark the territory it left.) The trail is a mark on the board, not a chain of garrisons — every sentry above is a head you *chose* to leave.

**Joins, splits and crossovers are free and unlimited.** A lone head may branch, and no move is refused for leaving a branch unguarded. Sentries are discretionary firebreaks against cuts (§6.1); the rules require none. A per-branch head toll is parked (§11).

### Reading the board

Each arrow shows the count of heads standing on it, in its owner's colour. Closed territory reads as solid; an **unclosed trail reads as visibly different** — reduced opacity, or stripes.

That distinction is not decoration. "Is this stretch cuttable?" is the question a player asks most often (§6.1), and under the safety rule it is the *only* thing separating a head that cannot be cut from one that can. It has to be answerable at a glance rather than by tracing a path back to its anchor.

The interaction model is **route drafting**: pick a source arrow, then click along one of the three straight **rays** to add a **run** to a drafted route, repeating from each new tip until the route is the trail you want, and send it.

**A move is still one portion, one step, one arrow** (§4). Drafting is an adapter affordance that composes a turn's worth of single steps; the rules engine never sees a route.

Naming a *destination* is the wrong question, and this is why: three out-arrows 120° apart summing to zero make a route a word over three letters, and a destination arrow fixes only that word's last letter, leaving its prefix orderable. So a destination underdetermines the trail — `C(n−1, a)` routes reach it, first ambiguous at distance 3 — and the trail is what §5–§7 compute closure, cuttability and crossings from. An adapter picking one of those routes would be picking the *move* by iteration order. Drafting names the word instead, one run at a time, and a run is the run-length encoding of the word: straight is one click, a dogleg is two.

Only unambiguous arrows are ever clickable, and that set has an exact shape — **straight along one grain, then optionally one turn at the end**. Everything within two steps qualifies, which is why the last hop never needs constraining.

---

## 6. Combat and Damage

There are three ways to hurt a player: cut their trail (§6.1), fight their stack (§6.2), and convert their heads (§6.3).

### 6.1 Cutting a trail

An enemy head crosses your open trail at a **point** (§2). If the crossing succeeds, the trail **evaporates in both directions from the cut point** — forward with the grain, and backward against it. A crossing onto an empty arrow always succeeds. A crossing onto an arrow your stack holds succeeds only if the attacker lands (§6.2). A step that does not land crosses nothing: it cuts no trail, a third player's included.

That destruction is reused. A **territory-root cut**, a **combat wipe**, a **convert wipe**, and a **birth onto another player's open trail** (below) start the same fronts from a point or from an arrow. They are not a second kind of hurt, and they do not invent a second evaporation.

Evaporation **does not kill heads** — that job is combat's (§6.2). Each front only destroys trail:

> **A front destroys every trail arrow it enters until it would enter an arrow occupied by the victim's stack. That occupied arrow and its stack survive untouched; the front halts there.**

So **any garrison is a firebreak.** Sentry *size* matters for contact combat, not for surviving a cut.

**A firebreak stops evaporation, not a claim.** The claim walk (§7) does not consult occupation: landing home claims every against-grain trail arrow reached, including garrisons; those stacks stay, now on land.

- **A point is all-to-all.** Where the trail has `i` in-arrows and `o` out-arrows at a point, that point is a join followed by a split: **every in feeds every out**. The arrow set holds no pairing to recover (§6.1a), and a set with `i` ins and `o` outs simply *is* a join-then-split.
- **A front per branch, at every point it reaches.** A forward front reaching a point continues into *every* out-arrow and a backward front into *every* in-arrow — and a front that *arrives* along one incidence still treats the point as all-to-all, so the other polarity floods too. A cut **on** a fork (one arm) therefore clears **every** arm until each arm's first garrison (or territory), as a cut *under* a fork (the stem) does. The destroyed set is the undirected region between firebreaks: victim trail arrows adjacent at a point belong to one component. A front does not reverse along the arrow it has just destroyed; a sibling arm is not immune.
- **A front halts per arrow, not per point.** It stops when it would enter an arrow that holds the **victim's** heads. A stack of the cutter's, or of any third player, is not a firebreak. A head does *not* shield the point ahead of it against evaporation — that range belongs to combat (§6.2), and the two jobs sit on different axes.
- **Territory is a wall.** Backward evaporation reaching your own closed ground stops there and costs nothing. There is nothing to destroy and nothing to charge (§5).
- **A stack is an anchor.** Trail beyond a halting stack is anchored *on that stack* — live. It can be extended, defended, and driven home.
- **Dormant trail is legal.** A dormant stretch — not territory grade and carrying none of the owner's stacks (anchor grades, below) — **stands as marked trail** until a friendly head re-attaches, evaporation reaches it (a cut, or a wipe — §6.3), a claim strips it (§7), or its owner's seat vanishes (§9). It does not decay. A headless territory-grade stretch is ordinary wall.
- A stranded stack **fights its way home** when it can still step. Because the graph is strongly connected (§2), it does this by looping forward around the grain rather than reversing, laying fresh cuttable trail the entire way.

**Anchor grades.** Grade belongs to a **stretch**: one connected component of a player's trail, arrows meeting at a point being connected (§6.1a). A stretch is **territory grade** while one of its arrows leaves a point `P0` that has a **clean feeder** — an in-arrow of `P0` that is the owner's territory and is **not** present in any enemy trail. Otherwise it is **stack grade** if it carries one of the owner's stacks, and **dormant** if it carries none.

**Territory-root cut.** When an enemy step marks the **last** clean feeder of `P0`, or an enemy claim takes it (§7), that is a **cut** of the owner's trail at `P0`: evaporation runs from `P0` under the halt rule above, stopping at the first arrow holding the owner's stack or at the owner's territory. Whether any of the owner's stacks then converts is decided by the ordinary state rule (§6.3).

**Evaporation from an arrow.** A wipe, a convert wipe and a birth-cut start from an arrow rather than a point. The starting arrow's mark is destroyed, and fronts run outward from both of its points — backward from its origin, forward from its target — under the same halt rule. The stack on the starting arrow (wiped, converted, or newborn) is not the victim's, so it is not a firebreak.

**Wipe starts evaporation.** When combat reduces a stack on an arrow to **0** heads, that owner's trail evaporates from that arrow. **Convert reuses that wipe** (§6.3). **Birth on open trail reuses it too:** after a spawner emits a head onto an arrow that is in another player's trail set (§7), that trail evaporates from the birth arrow. All births in an accrual tick complete before any birth-cut runs; birth-cuts then run in arrow-id order of the birth arrows, and the victims at one arrow in player-id order. Arrow-id and player-id order are the engine's total order on ids (`compareArrows`, `comparePlayers` in `rules-core`): string order of the opaque id.

**Two grades of anchor, and the difference is load-bearing.** Territory grade lets a stretch's heads resist conversion and lets them step onto enemy territory (§6.3). Stack grade is live but lesser: it can be extended and driven home, and that landing claims the same walk any landing claims (§7); it does **not** save a head from conversion inside enemy territory. Grade does not govern closing — any landing on your own territory claims (§7). Keeping the grades apart is what makes a garrisoned raider capturable: sentries anchor a fragment, but not at territory grade.

**Fragments are re-attachable, and this needs no special machinery.** A stretch is territory grade once one of its arrows leaves a point with a clean feeder (above). Lay a fresh path from home that reconnects to a stack-anchored fragment and the whole stretch is promoted back to the full grade. Nothing floats, nothing is tracked separately — a demoted fragment is simply a wall waiting for a road.

Four properties fall out of this:

**A cut destroys one region, and you choose how big a region is.** Heads standing on a trail partition it into regions, and evaporation runs from the cut in both directions until it would enter an arrow holding the victim's stack, or meets the victim's territory. Everything between those boundaries is lost as trail; garrisons and everything beyond them are untouched. So a player sets the price of being cut by choosing how far apart to place sentries — *region length*, legible at a glance (§5).

**Any sentry is a firebreak.** One head stops the front; a larger stack is for combat, not for surviving the cut. The rules *require* no heads (§5). Leaving a trail bare from home to tip is legal and means one cut takes the whole stretch between territory and tip.

**Cut depth is still everything.** A deep cut does not destroy heads; it **demotes** more. Take out the region touching the victim's territory and everything beyond survives — sentries intact, territory anchor gone — dropped to stack grade. Attackers are still drawn toward the victim's own border.

**Prying a firebreak open takes combat, not a second cut.** A cut stops at the first garrison. Removing that garrison is contact combat (§6.2); a wipe then evaporates trail from the emptied arrow. Dismantling a garrisoned trail is a siege of fights, not a sequence of lucky crossings.

**Forks are ordinary trail.** A fork is one arrow with two trail arrows leaving it; nothing about its *behaviour* is privileged, and it costs nothing (§5). A cut behind it **or on one arm** floods into both branches until each arm's garrison.

A cut is therefore expensive but survivable. You lose the region you were cut in; heads stay unless combat removes them; what lies beyond a firebreak is demoted rather than destroyed (or left as dormant marks if headless). Large enclosures stay attemptable — and the spearhead itself survives.

### 6.1a Trail invariants

> **A trail is a set of arrows.** Not a walk, not a tree.

Nothing about it records the order it was laid, which heads laid it, or how many times one has walked it. Every question the rules ask of a trail — where evaporation stops, whether a crossing happened, what is claimed, what is still anchored — is answerable from that set plus the counts standing on it. **Trails have no memory**, and that is a load-bearing property: it is what removes head identity from the engine entirely (§3, §4), and it is the reason none of the rules below need a resolution order.

Three invariants govern every trail:

1. **Movement is forward along the grain**, always (§2).
2. **The trail is a set.** Stepping onto an arrow it already holds is legal and adds nothing.
3. **Points may be revisited.** Crossing your own trail by looping around is legal. It does nothing on the spot; when the path lands, a loop it made rings ground the claim takes (§7).

**Invariant 2 constrains the trail, not the heads.** A **lagging group is legal and expected**: split a stack, send the front group two steps and the rear group one, and the rear group stands on an arrow the front group laid. The trail did not grow a second copy of that arrow. This is how a spearhead brings its firebreaks along (§6.1) instead of abandoning them at the start line.

**Why 2 and 3 matter more than they look.** Fill (§7) reads the claimed ground, and the claimed ground is read off the arrow set. A set holds no duplicates, and movement along the grain means a second traversal is *coincident*, never anti-parallel — so re-traversal is not doubling back, and fill reads the same ground however many times a head walked it.

> This is why **fill must read the arrow set and never the move list.** It is the one place where getting the representation wrong would silently produce a wrong answer instead of a crash.

**No head is trapped by trail.** Re-traversal is legal and the graph is strongly connected (§2), so a trail — its owner's or anyone's — never removes an out-arrow from the movement graph.

**A point is all-to-all — this is what "no memory" costs, and what it buys.** Where the trail uses a point more than once, the arrow set holds several in-arrows and several out-arrows and **no pairing between them**: a walk that went `a→a, b→b` and one that went `a→b, b→a` leave the identical set. There is nothing to recover, so nothing is guessed. The point simply *is* a join followed by a split, every in feeding every out. Two consequences, both intended:

- **Evaporation spreads to every continuation** at a point, including a sibling arm the front did not arrive along (§6.1).
- **The trail presents `i × o` chords there** for the crossing test (§2) — one per (in, out) pair. A knot is genuinely more cuttable than a spine, which is the right sign: more strands through a point, more ways through it.

All-to-all asserts nothing the set does not hold. A canonical pairing by slot convention would route damage down arrows the player never connected; declaring an ambiguous point uncuttable would make a crossover a free wall with no mechanism behind it (ADR 0008).

### 6.2 Contact combat

Combat has one trigger:

> **An attack is an ordinary step whose destination arrow is occupied by an enemy group.**

That is the only combat trigger. No battle slots, no secret allocation, no RNG. Merely sharing a point ahead is not a fight (§2).

**Stay-behind (Risk-style).** An attack may not empty the source arrow: at least one of the attacker's heads must remain on `from`. A lone head therefore **cannot attack**. That is intentional — singles are vulnerable to cuts and cannot contest occupied arrows, which pushes play toward fewer, larger groups.

**Resolve (one move, fight to wipe, deterministic).** Let *A* be the number of attacking heads stepping (the step's `count`, with `count ≤ heads − 1`) and *D* the defender heads on the destination. The battle resolves **fully inside that step** — no mid-fight interrupts, no reinforcements, no retreat, no other actions (HoMM-style). Retreat between rounds is parked (§11).

Each **round** uses the threat-weighted floor rule; rounds repeat until *A* or *D* is 0:

1. **Threats:** *tA* = *D*/(*A*+*D*), *tD* = *A*/(*A*+*D*).
2. **Loss weights** (attacker∶defender): *wa*∶*wd* = *tA*² ∶ *tD* (integer form *D*² ∶ *A*(*A*+*D*)).
3. **Magnitude:** scale so max(atk_loss, def_loss) = *D*, preserving *wa*∶*wd*; then cap atk_loss ≤ *A* and def_loss ≤ *D*.
4. **Integerize** with floor. If both floors are 0 but the weights are positive, deal 1 loss to the side with the larger weight (equal weights → the defender takes the 1).
5. Subtract losses; if both sides still have heads, repeat from (1) with the new *A*, *D*.

**Outcomes**

- *D* = 0 and *A* > 0: the attacker **lands** on the destination with remaining *A* (ordinary occupancy). The destination is marked as any step's destination is (§5): trail, unless it is already the attacker's territory, where a step from trail is a closure (§7). The stay-behind remains on `from` and may later merge.
- *A* = 0: the attacker **does not land** and **does not mark** the destination. The stay-behind stays on `from`; if `from` is trail, it is the trail's tip. The defender keeps any remaining *D* on the arrow.

- **Both wiped** (*A* = 0 and *D* = 0 in the same round, for example 2 v 3: weights 9∶10, the defender loses 3 and the attacker 2.7, capped to 2): no attacker reached the arrow, so this is the *A* = 0 outcome — the attacker does not land, does not mark, and the step crosses nothing (§6.1). The arrow is left empty. The defender's stack is still wiped, so the defender's trail evaporates from that arrow as for any combat wipe (§6.1).

Under the current magnitude step, a single round always wipes at least one side for positive integer *A*, *D*; the loop states the HoMM intent if the table is ever retuned.

The attack **costs one step of allowance** for the whole battle (§3).

**Equals favour the attacker** in a round where *A* = *D* (e.g. one round of 3v3 → attacker 2, defender 0). There is no defender-wins-ties rule. Minimum contact is *A* ≥ 1 with a stay-behind, so a 1-stack cannot open equals.

**Floor may yield zero attacker loss** in a round when *A* is moderately larger than *D* (e.g. 5v3). There is no minimum loss (§11).

- **Declining is always legal.** No step is forced (§4), so standing beside an enemy without stepping onto them fights nothing.
- **Cut and combat on one step.** If the destination is enemy-occupied *and* the traversal crosses that player's trail (§2), **combat resolves first**. If the attacker lands (*D* = 0), the crossing succeeded and cuts that trail (§6.1) — trail is independent of heads (§6.1a). If the attacker is repelled (*A* = 0), it did not cross: there is no cut, and the defender's trail is untouched. A cut is evaporation of **trail**, not a side-effect of what stands on it.
- **On territory.** A stack on its owner's territory can be attacked like any other (§5); the attacker must be allowed to step there (§6.3). Territory combat modifiers are parked (§11).

**Sentries have two distinct jobs, and they sit on different axes.** A sentry **holds its arrow** against contact combat, and **absorbs** evaporation arriving along that arrow from either side (§6.1). Both are per arrow. *Where* along a trail you place them stays a real decision.

Per-arrow is the local rule for the halt: a front that reaches a point has already come *through* one of that point's arrows, so a head on some *other* arrow of the point cannot bar it after the fact. Locality is what keeps evaporation total.

No randomness anywhere. A six-turn enclosure never dies to a bad roll; it dies to being outplayed.

### 6.3 Encirclement

Conversion triggers on **state, not on event**:

> **A stack standing on enemy land with no life line to its own territory is converted to the same seat as the land it stands on.**

A **life line** is a territory-grade stretch under the stack (§6.1). Stack grade and dormant do not protect, and a stack with no trail has none. Closing a shape around enemy heads is the common case, not a separate rule: the closure puts them on your territory, and those with no life line convert. A stack the claim did not enclose converts only through this same rule. **Stacks convert intact:** encircle a 3-stack and you gain a 3-stack, not three singles and not a token survivor.

**Entering enemy territory.** A step onto another player's territory is legal only when `from` is the mover's own territory, or `from` is in the mover's trail and that stretch is territory grade (§6.1). Any other step onto another player's territory is **illegal** (§4); it is refused, so it never converts its own mover. Conversion is judged after every step and at every round boundary, after that boundary's births and birth-cuts (§7) and before its starvation tick (§9). It follows another player's move — a claim, or a cut that demotes a raider already inside — or a birth-cut at the boundary, which can fall on the raider's owner's own pass.

A group with a life line is **not** encircled. You cannot capture a trail-connected raider by claim alone, even when the closure claims the arrow it stands on or the road it came by: the arrows become your territory, and the raider and its trail stay on them (§7). Only evaporation drops the grade (§6.1) — a cut or a wipe, including the territory-root cut a claim causes when it takes the stretch's last clean feeder. Conversion is judged on the board the move leaves: after the claim and any cut it causes.

On convert, the stack flips owner at the same head count, with **`spent` set to `speed(heads)` and any merge override dropped**, so the capturing turn has no step from that arrow. End of turn still clears `spent`, and a merge onto the stack in that turn is an ordinary merge: the destination's `spent` is kept (ADR 0005).

**The convert wipe.** The victim's trail evaporates from each converted stack outwards, under the halt-at-first rule (§6.1). Converted stacks are no longer the victim's, so they are not firebreaks: the path that connected them — including **both arms of a fork** — is gone. The front halts at the next arrow holding a stack that is still the victim's (on a demoted stretch, such a stack stands on neutral ground) or at the victim's territory. Dormant trail that no convert wipe reaches still stands (§6.1). Converted groups sit on the claimer's territory; co-location with a pre-existing friendly group on the same arrow does not arise (contact combat already forbids shared occupancy with enemies).

Two consequences that are easy to miss:

- **Sentries do not protect a raider from conversion.** A firebreak bounds how much trail a cut destroys, and the fragment beyond it stays live — but live on the **lesser grade**, anchored on a stack rather than on territory (§6.1). Conversion asks for a *territory* anchor. So a raider inside enemy ground whose trail is cut off from home is captured however well its trail was garrisoned, and the two grades are what keep this true without a carve-out.
- **"Stranded" means two different things.** Stranded in *neutral* ground is the recoverable case of §6.1: a stack-anchored fragment, fight your way home. Stranded inside *enemy territory* is capture. The distinction is load-bearing.

This is how the head pool moves between players, and it is what makes encirclement rather than attrition the decisive move (§9): a well-placed lasso is a 2× swing on the axis that decides the game, which is the comeback vector a losing player needs a reason to attempt.

---

## 7. Territory and Economy

### Closure — the Splix/Hexa model

> **Step from your trail onto your own territory. Everything the path encloses becomes yours, and so does the path itself.**

This is the hexa.io / splix.io rule, not "any cycle of your own trail." Ordinarily the trail departed your territory; it may instead be a fragment anchored on a stack (below). Landing is the requirement.

- **An unanchored loop is nothing until it lands.** A trail that never lands on your territory claims no ground. Dormant marks alone found nothing (§6.1).
- **A path that encloses nothing becomes a thin strip.** Travel from one holding of yours to another without surrounding anything and you have built a **land bridge** — the arrow chain itself becomes territory, one tile wide.
- **A stack-anchored fragment driven home pays the path.** Drive a fragment into your territory and you claim along the walk, the same walk a territory-grade landing claims. Ordinarily it encloses nothing: a strip has no inside. What it cannot do is *found* territory out of open ground — every claim lands on ground you already own.
- **Self-crossings claim what they ring.** Crossing your own trail doesn't close anything on the spot. It matters when you land: the path becomes territory, and a loop the path made is then a ring of *your own ground* with a bounded inside — so that inside is yours too. Figure-eights and crossovers resolve without a special case, and an open trail that would have been a bare bridge can loop onto itself to claim something.
- **The test is reachability, not parity.** After the path is claimed, any pocket of ground that is not yours and cannot reach infinity is enclosed and becomes yours. A claim is bounded by the trail on one side and by your existing territory on the other, so it is not a closed curve to take a parity of; and on a trail that rings a region with two separate loops, parity would call the plainly surrounded core outside (ADR 0008).

**Which arrows the landing claims: walk the trail backwards along the grain.**

> **From the arrow the closing step departed, follow trail arrows *against* the grain — `Y` precedes `X` when `Y` is trail and `target(Y)` is `origin(X)`. Everything reached is claimed. Nothing else is.**

Occupation never caps the claim walk: a garrison on the walk becomes territory and the stack stays (§6.1). The grade the stretch had before the landing does not change how much is claimed.

The trail is a set with no memory (§6.1a), so "the path you walked" is not recorded — but it does not need to be. The grain recovers it: every arrow the closing head *could* have come through is upstream of the landing, and nothing else is. Three consequences, and they are the reason this is the rule rather than *claim the whole connected stretch*:

- **A fork's other arm is downstream, so the walk does not claim it.** It stays an open trail, except where fill claims it, now rooted on ground that has just become territory — which is exactly what the pincer below needs in order to have anything left to enclose.
- **A cut fragment driven home is upstream.** Salvage claims all of it, occupied arrows included.
- **At a merge, every trail in-arrow is claimed** (occupied or not). The set holds no pairing to prefer one by (§6.1a), and a point is all-to-all in this direction for the same reason it is for evaporation.

There is **no separate enclose-or-strip test**: the walk claims the path either way, and what the claimed ground then rings is decided by reachability above. A walk that dead-ends claims a strip because *a strip rings nothing* — and a dead-ending walk that crossed itself on the way home claims the loop's inside all the same.

**What the claim does to trail on the claimed tiles.** The closer's own trail there becomes territory (an arrow is never both its owner's territory and its owner's trail). Enemy trail is cleared, with one exception:

> **Enemy trail on a claimed tile is removed, unless it belongs to a stretch that carries at least one of its owner's stacks and is territory grade on the board after the claim, with every trail still in place.**

Where that stack stands — neutral ground, enemy land, the closer's land — does not matter. If a trail is not cut, it does not evaporate: a claim alone never demotes a territory-grade stretch that carries its owner's stack. A spared stretch's arrows become the closer's territory with the trail still on them, exactly like a raider's trail laid across land the closer already held, and it stays cuttable (§6.1). Bare trail — a stretch with no owner stack on it, including dormant marks and a headless territory-grade wall — is removed from the claimed tiles.

A claim that takes a stretch's last clean feeder is a territory-root cut (§6.1), so that stretch is not territory grade after the claim and is not spared.

Enemy heads standing on claimed tiles are not granted by the claim: they stay where they are, and §6.3 decides whether they convert.

**A special is not among the claimed tiles, because a special is not a tile.** Specials live on vertices (below), and a vertex is never enclosed, occupied or granted: **it is owned in thirds, one share per bordering arrow**, and a closure moves those shares only by moving the arrows that carry them. So nothing here has to enumerate vertices at all — territory changes hands, and ownership of every special it borders follows.

Two consequences worth stating, because the shares rule is easy to read as being only about partial capture:

- **The minimal closure takes a whole spawner.** Three arrows around one vertex enclose no tile, so a closure clause that granted "the specials inside" would hand the minimum enclosable territory (§2) nothing at all. Under shares it takes all three, and the minimum really is one: three arrows, three steps, one spawner. That is the game's cheapest objective and it is meant to be — a three-arrow closure is also the most cuttable thing on the board and claims nothing besides.
- **An interior vertex comes free, and a surrounded spawner is never unowned.** A vertex strictly inside a filled region has all three borders claimed by the fill already, so it is wholly owned without a second pass. The reading is identical for an enclosure, a land bridge and a carve-out.

**The fill needs a plane, and that is what decided the board** (§2). *Enclosed* means **cannot reach infinity**, so there has to be an infinity to fail to reach: a pocket is yours exactly when no walk from it escapes **your** ground. Only your own ground walls the walk — whose the pocket was does not enter into it, which is *territory is contestable* below and what makes a carve-out one rule rather than two.

**A pocket does not leak at a point.** Reachability is over arrows, and two of your arrows meeting at a single point form a barrier even though no tile sits in the gap — that is §2's chord test, and without it every enclosure in the game would leak through the seam between two trail arrows.

Two consequences worth stating, because they are what "unbounded" costs and buys:

- **A closed curve always has an inside.** There is no girdling case, no non-separating loop, and no homology test anywhere in the engine.
- **Fill is bounded by the ground doing the ringing, not by the board.** A pocket is ringed by one closed run of arrows you hold, and a run of *L* arrows cannot ring more than `O(L²)` of them — so the sweep is finite even though the board is not, and it is the only place the engine ever needs a bounded region of an unbounded lattice. The bound belongs to the **ring**, not to the trail just walked: a one-arrow closure across the mouth of a C-shaped holding rings everything that holding curls around, and a second holding elsewhere on the board bounds nothing and must not widen the sweep.

### The pincer

A forked trail whose two branches both land on your territory **is a valid conquest**, and it requires no additional rule. Branches land one at a time: when the first arm lands, the walk to that landing becomes territory, stem included. The second arm is then an open trail hanging off a fork point that is *now territory*, so its landing is an ordinary territory-to-territory closure — and it takes the ground between itself and the now-solid first arm.

The two arms never need to form a directed cycle. **Enclosure is a property of the curve, not of the flow along it** — the *interior* does not care which way anything ran. What the flow does decide is *which arrows the landing claims*, which is the backward walk above: each arm is claimed by its own landing, and neither has to reach the other.

This gives forking an offensive identity rather than a purely defensive one: two arms sweep out, both come home, and the ground between them falls. Paid for by splitting (which slows both arms; branching itself is free, §5), by having two trails to defend instead of one, and by the stem — a cut there destroys its region and demotes *both* arms at once (§6.1), so the stem is the stretch most worth garrisoning and the stretch the defender most wants to reach. (A cut on one arm floods the other arm too, §6.1; the stem is where a cut also takes the road home.)

### Why this kills the corridor exploit

Every claim must land on your territory. So you cannot walk twenty tiles into contested territory, tie a small knot, and convert the walk into a permanent one-wide safe-movement highway. To keep anything, you have to return.

A land bridge needs a landing on ground you already own. The walk that lands may start at your territory or at a stack-anchored fragment in open ground — salvage — but it always ends at home, which is exactly the situation where connecting ground is a legitimate move rather than an exploit.

### Territory is contestable

Enclosed land is **not permanent**. An enemy can drive a trail out of its own territory, around a chunk of yours, and back onto its own territory, carving that chunk — and any specials in it — away. Enemy territory is hostile ground: enterable only as §6.3 allows, and you are exposed there while they are not.

Nothing is ever safe, so nobody snowballs. Taking a spawner early paints a target rather than winning the game.

### Specials live on vertices, not tiles

A special sits on a **vertex** — a pinwheel centre, not a point, bordered by exactly 3 arrows (§2).

This is the decisive property: **you cannot stand on a vertex.** A special is never occupied, only ever *bordered*. Had specials been arrow tiles they would also be movement tiles — occupiable, walkable, garrisonable — and we would be answering "does standing on it count?" forever. Putting them on the lattice the movement graph doesn't touch makes the ambiguity structurally impossible. Same principle as the chord test in §2: let the geometry enforce the rule.

**Ownership is fractional, in thirds.** Each of the 3 bordering arrows carries one share. Hold two arrows as territory and you hold 2/3 of that special.

**A vertex is bordered, never enclosed — one adjacent arrow gets you in on the action.** So specials are *shared by default* and monopoly is the exception: three different players can each hold one third of the same spawner. The fight is a continuous contest over shares rather than a binary flag, and a rival's income can be pared down a third at a time.

Three things follow:

- **Partial capture gives granular pressure.** Shaving one arrow off a rival cuts their income by a third — a real blow available without mounting a full operation, and one a weaker player can land. A raid that falls short still pays.
- **Border *shape* starts mattering.** Capturing fully is no longer about reaching, it's about how your seam runs; a sloppy border clips your own specials to 2/3. New, legible pressure toward compact, well-formed territory.
- **The atomic unit of conquest and the atomic unit of value are the same object.** The girth-3 minimum loop is three arrows pinwheeling about a centre; a special is a centre bordered by three arrows; and they are the same three arrows (§2). So **the smallest territory the board permits holds every share of exactly one vertex** — a whole spawner, where the field put one — which is what sets the scale of the whole economy.

### Spawner logic

- A spawner has a **force** *f*, a rational fraction ≤ 1/3. **1/3 is a very rare maximum**; typical values are **1/9 or 1/12**. Total output is *f* heads per **full round** (every seat has taken a turn).
- **Each full round, one adjacent arrow gains *f***, cycling round-robin. Post-MVP, other distributions per spawner type. Accrual runs when `endTurn` returns the active seat to `players[0]` — not on every `endTurn`. Births happen at that tick, then birth-cuts (§6.1), then conversion (§6.3), then the starvation tick (§9).
- Each **accumulator belongs to the arrow, not the player.** When one reaches 1, a head appears on that arrow — merging into any stack already there — and the accumulator **carries the remainder** rather than resetting to zero. Nothing is wasted, which matters once two spawners feed one arrow and overshoot is routine. **This is the only place in the game that banks anything** — §3 deliberately does not, since tempo you did not spend is tempo you gave away, whereas a spawner's trickle has to accumulate to be worth anything at all.
- **Spawned heads do not pay the §3 merge override.** A birth is not a spent move; merging into a friendly stack leaves `spent` and the merge override as they were.
- **A share arrow nobody owns accrues nothing.** The round-robin still lands on it; the fraction is lost, no head appears, and no accumulator is kept for it.
- **An arrow that changes hands starts fresh.** Its accumulator resets to zero on capture — the one case where progress is destroyed rather than carried. (A seat owning a share is never lost, §9, so land a vanishing seat leaves unowned holds no share and carries no accumulator.)
- **An enemy head standing on the arrow halts accrual.** The accumulator neither advances nor resets; it holds at whatever it had reached and resumes when the intruder leaves. Nothing spawns into an enemy-occupied arrow. A **friendly** stack on the arrow does not halt: accrual runs and a spawn merges in with no merge-cost penalty. **Bare trail is not occupation.** An enemy mark with no stack does not halt accrual. If the birth lands on another player's open trail, that birth is a **cut** of that trail at the birth arrow (§6.1).

**A blockade costs the spawner that share's output.** The round-robin still lands on the frozen arrow; the fraction simply does not accrue and is gone. Total output drops by a third per blockaded arrow. The rotation is a fixed cycle that never varies with board state, which keeps the deterministic rhythm players count on.

**Blockading is real, and it is not free.** A head parked on a rival's spawner arrow freezes that share outright. But to get there it laid a trail, and that trail is cuttable — and by §6.3 a head left inside enemy territory with no life line is *converted*, not merely stranded. So a blockade has a maintenance cost and a decisive failure mode: one cut that takes its anchor both damages the blockader and captures it.

**The round-robin is what implements the thirds.** No player-level fractional economy is needed: hold 2 of 3 arrows and you simply receive 2 of every 3 spawns.

**Reset-on-capture desynchronizes production.** Arrows taken on different rounds run on different clocks, so heads trickle out at staggered intervals instead of arriving in waves. The desynchronization is earned rather than configured.

It also makes **border churn economically sterile.** An arrow flipping back and forth never produces anything for anybody, so consolidating beats raiding for its own sake — and a raid that holds an arrow two rounds and loses it has still erased everything the owner banked there. Only securely held ground pays.

**Spawners produce dispersion, not stacks** — heads appear one at a time on different arrows. Concentration is something a player must actively do.

### Stacked spawners

An arrow may border **two** spawners. Its single accumulator receives from both, and coprime denominators (1/9 against 1/12) produce compound, aperiodic-feeling spawn timing.

**Overlap is common where spawners are clustered, and rare where they are scattered** — which, since density is deliberately uneven (below), means the contested centre is riddled with double-fed arrows while home regions mostly are not.

This is **deterministic irregularity** — no randomness anywhere, yet a rhythm complex enough to feel organic while staying fully predictable to a player willing to do the arithmetic. Double-fed arrows become natural **keystones**: capturing one wounds two spawners and gains two income streams at once, so overlapping neighbourhoods become the map's hot spots without any special-casing.

**Overlap roughly halves fill time.** A single-fed arrow at 1/12 needs 36 rounds; one fed by a 1/9 and a 1/12 gains 7/36 per three-round cycle and fills in about **15**. Two 1/12s give 18. That is what makes contested ground productive at all — an arrow that flips every twenty rounds is worthless at 36-round fill and worth fighting for at 15.

### The emergent income landscape

The consequence worth designing around: **a single spawner's three arrows produce at three different speeds**, because each has different *other* neighbours. The round-robin is perfectly even; the outcomes are not. One arrow is double-fed and pops every 15 rounds while its sibling is isolated and takes 36.

So the map develops rich arrows and poor arrows determined purely by spawner placement geometry, with **no per-tile data authored anywhere**. Knowing which arrows are the good ones becomes real map knowledge, and it comes free from the geometry.

### Force should scale with contestedness

Reset-on-capture has a consequence worth designing around. At *f* = 1/12 a single arrow needs **36 rounds** to fill — twelve gains at one per three rounds — so an arrow anywhere near a frontline will never pay out at all. A uniform scatter of slow spawners would therefore make the contested central cluster (§8) the *least* productive region on the map, inverting the entire point of putting it there.

> **Fast spawners belong where the fighting is.** Put the rare *f* = 1/3 specials in the contested centre, where 9 rounds per arrow is quick enough to pay out between flips. Put the slow 1/9 and 1/12 specials in home regions, which have the quiet decades they need.

This gives spawner placement a design principle rather than a scatter, and makes the centre genuinely worth bleeding for.

**Density scales with contestedness too, and for a second reason.** Force sets how fast one spawner pays; density sets how many arrows are *double-fed*, which halves fill time again on top of it. Clustering is therefore the cheaper of the two levers for making the centre productive, and scattering is what keeps home regions quiet without needing a slower *f* than 1/12.

It also removes a tension that would otherwise be real. Spawners must be **scarce** — they are the objective, and a board where a third of all arrows produce is a board nobody fights over. But overlap must be **common**, or contested arrows never pay out. No single uniform density meets both: overlap becomes typical only where spawners stop being scarce. A clustered placement meets both: scarce overall, dense where it matters.

### The radial gradient — and what bounds an unbounded board

The board does not end (§2), so *contestedness* cannot be a band index into a finite rectangle. It is **distance from the origin**, and both levers are functions of it:

> **Force and density both decay with radius, and both reach zero.** A spawner at distance *r* from the origin runs at *f*(*r*), and beyond a **cutoff radius *R*** there are no spawners at all. Everything outside *R* is barren ground: walkable, enclosable, and worth nothing.

The cutoff is what makes an unbounded board playable:

- **Scarcity is definable.** "Spawners are scarce" is a count inside a disc, and the disc is the tuning parameter. One number, *R*.
- **Fleeing gains nothing.** A player who runs past *R* is running into a region that produces nothing, while the opponent keeps every spawner they hold. Distance stops being shelter and starts being surrender. The gradient removes the reward for running.
- **The interesting region stays finite** even though the geometry does not, so every balance question — total force, spawner count, opening distance — is asked of a disc.

**Distance and eligibility.** A vertex's radius *r* is the undirected lattice distance (hex distance) from the origin point to the point that owns the vertex (§2). Every vertex with *r* ≤ *R* is **eligible**; a band's density is the fraction of its eligible vertices that carry a spawner.

> **MVP defaults (configurable).** Cutoff *R* = **7**. Homes at
> `homeOffset = 5` (§8). Starvation *N* = **5** full rounds (§9). Force and
> density are **authored bands** of *r*, and they are the same table:
>
> | *r* | force | density | ≈ spawners (seeds 1–3) | one head every |
> |---|---|---|---|---|
> | 0–1 | 1/3 | ½ | 6–9 | 3 rounds |
> | 2–3 | 1/9 | ⅓ | 17–26 | 9 rounds |
> | 4–5 | 1/12 | ⅙ | 27–34 across both 1/12 bands | 12 rounds |
> | 6–7 | 1/12 | 1/12 | | 12 rounds |
>
> The counts are measured at `R = 7`, `homeOffset = 5`, 2 players,
> `spawnerSeed` 1–3. **`SPAWNER_BANDS` is authoritative.** If this table
> disagrees with it, the table is wrong. All of these live in `MatchConfig` /
> `SPAWNER_BANDS` and are setup data only (below).

**Why these bands.** They use exactly the three force values §7 names and nothing between them, a **4:1** ratio from centre to rim. A geometric decay such as `1/3^r` would run the rim at 1/2187 against 1/3 at the centre — 729:1 — so whoever reached the middle first would have won and every other spawner on the board would be scenery. The band totals are deliberately close: with ~14 eligible vertices inside *r* = 1 against ~264 beyond *r* = 3, each band carries roughly the same total force. **The centre is concentrated, not richer**: it is worth bleeding for because it pays out between flips, not because everywhere else is barren. Thinning also keeps the board readable: every vertex inside *R* would be over 300 spawners; the bands leave ~50–70 (ADR 0008).

The arithmetic those are aimed at, since every arrow borders exactly two vertices and so has two feed slots. At half density, **three quarters of centre arrows are fed and a third of those are double-fed**, and **seven in eight centre spawners have at least one keystone arrow** — the double-fed ones that wound two spawners when captured. At a sixth and below (the home and rim bands), home arrows are mostly single-fed or bare and fill on the scale of decades, which is what the quiet is for.

What they are chosen to produce: a centre that pays out inside ten rounds and is therefore worth bleeding for, a home economy that rewards being left alone, and a board where sweeping the specials is not something a player can do. They are playtest defaults, not a derivation (§11).

**Bands rather than a smooth curve, deliberately.** A continuous *f*(*r*) would need a rounding rule to land on a rational, and §7 requires exact rationals with small coprime denominators — the whole coprime-denominator rhythm depends on 1/9 against 1/12 rather than on 1/9 against 0.1083. Bands keep the values authored. Post-MVP jitter is compatible with all of this on one condition: it must be a **pure function of the vertex and a setup seed**, never a draw from an RNG, or it takes determinism (ADR 0001) with it.

**And that condition is already load-bearing, because density below 1 needs it.** A band that keeps half its vertices has to decide *which* half, and there is no authored table for that — the disc holds hundreds. Setup therefore takes a **pure hash of a vertex and a `spawnerSeed`**, sampled at the vertex's reflection-orbit representative so a vertex and its mirror (§2) always keep or drop together (P41). The field is therefore mirror-symmetric, which makes it exactly fair for two seats placed as mirror images; the construction for 3 and 6 seats is open (§11). The hash satisfies the rule above: two calls on one vertex agree forever, so a replay cannot drift; two adjacent vertices that are not mirrors of each other do not, so the survivors cluster irregularly instead of landing on a sublattice. That irregular clustering is what produces double-fed arrows — a regular thinning would space spawners out and destroy the overlap it was supposed to preserve. Changing the seed reshuffles which vertices carry one; the count moves only within the ranges the table gives, because the density targets do not change. So the seed is a *map*, not a balance knob. Sampling at the orbit representative halves the independent samples, so the clusters are a little coarser at the same nominal density; that texture is for playtest, not a count to pin.

### Placement and force are setup data, not rules

Everything in the two blocks above is a **number to be tuned**, and none of it is a mechanic. That distinction has to survive contact with the code, or the first retune becomes an engineering task instead of a table edit.

> **No rule reads a force's value.** Accrual takes *a* rational per spawner and *a* set of spawners on vertices from the board, and does the same arithmetic whatever they are. Nothing in the core knows what "the centre band" is, nothing branches on 1/3 versus 1/12, and no threshold anywhere compares a force against a constant.

So the whole of the placement scheme — which eligible vertices carry a spawner, which band each sits in, what force each runs at — is produced by **match setup** (§8) and consumed as opaque rationals. Retuning means editing the table setup builds from; it does not mean touching the engine, and it cannot change which scenarios pass.

Two things must hold for that to stay true:

- **A force is an exact rational, never a float.** Carry, reset-on-capture and the coprime-denominator rhythm are rules; the numerator and denominator are data. `1/9 + 1/12` has to be exactly `7/36` for a retune to be a retune rather than a new drift profile.
- **Density and band boundaries live in one place.** They are inputs to placement, not conditions scattered through it — one table, read once, at setup.

If a rule ever needs to ask *how large* a force is, or *where* a spawner sits, that is a design change and not a tuning change, and it belongs in §11 rather than in a branch.

### What the spawn rate implies about victory

**Cutting is barely an attrition channel.** Linear trail carries no heads (§5), so a cut on a bare stretch kills **nobody**. It burns trail to the next head and destroys the region it landed in; everything beyond is demoted, not killed (§6.1). A committed attacker cutting every 3–4 turns is denying *tempo*, not removing heads.

So the comparison is not heads-destroyed against heads-produced. It is **turns of work denied** against **heads accrued**, and those are different currencies:

- A destroyed region of *k* arrows cost its owner *k* steps to lay, plus whatever the enclosure it was building would have been worth.
- A spawner accrues one head every 1/*f* rounds, and a head is worth roughly its remaining reach.
- Heads leave a player in three ways: **§6.2 contact combat** kills them, threat-weighted losses per exchange (often more than one head); **§6.3 conversion** transfers them, wholesale; and a **vanishing seat's** heads are removed (§9).

**The victim picks which currency they pay in**, which is the sharpest consequence of the bare-trail default. Run bare and fast, and cuts cost you trail and time but no heads. Garrison, and cuts cost heads instead — but you paid those heads up front by parking them. There is no dominant answer on paper, and finding out which is right is most of what the first playtest is for.

**Force still sets the game's character:**

| *f* | Head every | Effect |
|---|---|---|
| 1/3 | 3 rounds | Economy dominates outright. Nothing an attacker does with cuts keeps pace, so **encirclement is the only real killer**, and a seat stripped of its spawners is ended by starvation (§9). Reserved for the contested centre, where arrows flip too often to reward anything slower. |
| 1/9 | 9 rounds | Production and denial trade roughly evenly. Cuts hurt because of what they *cost you to rebuild*, not because of what they kill. |
| 1/12 | 12 rounds | Denial dominates. Heads are precious, a lost region is expensive, and a player who is cut repeatedly cannot outproduce it. The home-region value, where the quiet is supposed to be what pays. |

Attrition by cutting is close to nil, so on the head axis the balance sits toward economy, and the contest is on the tempo axis instead. That makes §6.3 conversion the clearest way to actually reduce an opponent — which is what §9 wants.

**What stays uncertain is the number, not the shape.** §6.2's exchange makes heads flow in **both** directions during a fight, so an attacker's losses scale with how long they stay. Which side of the crossover a given *f* lands on is a playtest question (§11).

**MVP ships spawners only.** Every special is the same kind of object, differing only in force and in where it sits — all the variety comes from placement geometry and overlap, none from authored perk types.

That has a clean consequence: **territory has no intrinsic value in MVP.** With no score, and the last seat not lost as the win condition (§9), area isn't points, it's *infrastructure* — you take ground to reach spawner arrows, to build safe highways, and to enclose people. Sprawl is therefore a liability with no scoring upside to offset it, so the pressure toward compact territory is stronger now than it will be once other specials exist, and conflict concentrates naturally around spawner neighbourhoods rather than spreading across the board. And holding *no* territory is a loss outright (§9): land is not score, but it is the licence to keep playing.

Post-MVP perk directions (content, not structure — not decided):

| Special | Effect |
|---|---|
| Spawner | *MVP.* Force *f* ≤ 1/3, round-robin across its 3 arrows (above) |
| Forge | Raises max stack size or improves the speed curve |
| Armory | Your heads are born as 2-stacks |
| Gate pair | Teleport between two specials you hold — makes a long perimeter defensible |
| Anvil | A head ending its turn here regains a life |

---

## 8. Match Setup

Fixed and symmetric. Each seat begins holding:

- a **home pinwheel** — a small pre-enclosed territory, the three arrows bordering its home vertex,
- **one spawner** on that vertex, all three shares owned (a home vertex always carries one, whatever the thinning),
- **one 3-stack** on one of those arrows.

**Seats and homes.** The engine takes 2–8 seats. Homes sit on the corners of a hexagon of radius `homeOffset` about the origin:

| Seats | Homes |
|---|---|
| 2 | a reflected corner pair under `(i,j) ↦ (i+j, −j)` (§2, *map symmetry*) |
| 3 | alternating corners |
| 4 | four corners, one opposite pair left free |
| 6 | all six corners |
| 5, 7, 8 | equal angular span (best effort) |

Opposite corners are never a two-seat pair: they are related by the 180° map, which reverses the grain (§2). A denser, faster cluster of spawners sits at the centre, far from every start, and the spawner field fades to nothing past the cutoff radius *R* (§7, *the radial gradient*).

**Setup is what makes an unbounded board finite.** The board itself has no size (§2); what setup chooses is *R*, the band radii and their force and density, `homeOffset`, the seat count, and the `spawnerSeed`. Those are the whole map, they are read once, and no rule reads any of them again (§7, *placement and force are setup data*).

**Setup code is authoritative for placement.** `makeMatch` (the `geometry-tiling` setup) fixes the details this section does not state — which of a corner point's two vertices is the home, which arrow of the home pinwheel holds the 3-stack, which reflected corner pair two seats take, and the home spawner's force. Like the field, these are setup data, not rules (§7).

**Starting territory is mandatory, not a convenience.** Under Splix closure (§7) every claim must land on your own territory, so a player holding none can never claim anything, ever. "Start with a head on bare ground and carve your way up" isn't hard, it's unplayable. The opening position has to be granted.

**Why a 3-stack.** Three is the smallest stack that can split into a pincer (§7) and still leave something behind, and it matches the girth-3 minimum loop.

There is no drafted opening (Appendix A).

---

## 9. Victory

Heads are not lives. Losing your last head is survivable while you still own production: a spawner share pays its owner with no heads anywhere on the board. What ends a seat is being unable to ever claim again. **A seat's standing is one of five rows**, over territory *T*, spawner shares *S* and heads *H* — and because a share *is* territory on an arrow bordering a spawner (below), `S > 0 ⟹ T > 0` and the rows are exhaustive and disjoint:

| *T* | *S* | *H* | Outcome |
|---|---|---|---|
| 0 | — | — | **lost.** §8: a player holding no territory can never claim anything, ever |
| >0 | 0 | >0 | **starvation clock** — *N* full rounds, then lost |
| >0 | 0 | 0 | **lost.** No production and no units: nothing can ever change |
| >0 | >0 | 0 | **alive**, offered only the pass until a spawner yields a head |
| >0 | >0 | >0 | normal play |

**A loss is immediate.** It resolves on the move that causes it, so a seat that can never claim again never acts again. Starvation is the exception in timing only: it fires at the round boundary, because its streak counts rounds.

A lost seat **vanishes**: its heads, trail marks and territory are removed, and vacated territory becomes unowned. The marks are **cleared**, not evaporated — evaporation is what a cut causes (§6.1), and a seat leaving the match is not a cut. The adapter presents the clearance as flicker-then-fade, which is not a cut and is not silent (see `docs/spec/seat-vanish-fx/seat-vanish-fx.md`). A lost seat keeps its place in turn order and is offered only the pass; that pass is a move in the log, and it is how the round still advances through the seat's slot (§7, accrual).

**The match ends when one seat remains**, and *ends* is literal: a state with a winner offers no move — not even the pass — and `apply` refuses any. The deciding move itself is never cut short; it resolves every effect it causes (claim, fill, conversion, evaporation, the loser vanishing), and the match is over afterwards. At least one seat is never lost: every seat opens owning a share, no path un-owns a share except a vanishing seat's, and a seat owning a share is never lost (ADR 0008). See `docs/spec/losing-conditions/losing-conditions.md`.

Heads remain what you risk and what conversion steals, and conversion by encirclement is still a literal step toward winning — but they are not *lives*. What §8 made mandatory at setup is what the first row makes permanent: territory is the licence to keep playing. Spawners are life support rather than score, and the loop tightens into:

> risk heads → take territory → hold specials → make heads

It also hands the trailing player a real comeback vector: a desperate lasso around an enemy stack doesn't just deal damage, it *takes* those heads — a 2× swing on the exact axis that decides the game.

**Starvation.** A seat not yet lost that owns **no spawner share at all** for *N* consecutive full rounds loses. The streak is read only at round boundaries: it advances by one at each boundary at which the seat owns no share, and returns to zero at a boundary at which it owns one. A partial round does not count, and a share held only between two boundaries does not reset it. Destitution is tracked **per seat**: two broke seats advance independent clocks and neither cancels the other, and reaching *N* removes that seat while play continues among the rest.

Starvation exists because a player who simply refuses to be reached cannot be ended by taking heads. It ends a seat on the axis the game is actually contested on — production — rather than on physically cornering a last head. Its clock starts at the first round boundary at which a seat is destitute, which is when the board is already decided (ADR 0008).

Two things about its shape are load-bearing and neither is a tuning choice:

- **Zero shares, not a fraction.** Neutral shares do not protect a seat — only *owning* a share resets the clock. A share is territory, not head position: a runner keeps its home shares until they are carved (§7), and past *R* there is nothing new to claim, so a runner that loses its land to a carve has no way back to a share.
- **Held for *N* rounds, not lost on the round of the last share.** An instant loss on the last share would end a seat at the moment it is most dangerous — it can still be holding large, fast stacks (§3) with every reason to counterattack. The window turns *I am broke* into *I stayed broke*, and gives a defined last chance.

*N* is a tuning number, deliberately (§11). Default **5**.

**A share means owning, not blockading.** A share *is* ownership of one of the three arrows bordering a spawner's vertex, as territory (§7). Parking on a rival's share freezes production without taking it — so a blockade does not keep you off the starvation clock, and does not put the owner onto it.

**This does not require upkeep.** Starvation needs no per-turn bookkeeping beyond a streak — it reads ownership the board already carries. Upkeep stays on the shelf as a balance knob (§11).

### The turtle is a losing position, not a stalemate

"You can only be cut while you're growing" means a player who **stops growing becomes uncuttable**. A losing player can pull every head onto safe ground inside a small enclave and never lay another trail.

That is not a stalemate, because the attacker does not need the turtle's heads. Under starvation they need the turtle's *production*, and that is a far smaller shape. The shell is proof against fire, and nobody is obliged to burn it.

Three things already in this spec close the case:

- **A spawner's shares fall to the minimum closure the game has.** Ownership is fractional across the three arrows bordering its vertex (§7), and the lattice triangle of exactly those three arrows is the minimum enclosable territory (§2). So taking a turtle's income is a three-arrow loop, not a siege of the enclave.
- **Territory is contestable** (§7). Safe ground is safe from *cutting*, never from *closure*.
- **Closing around the garrison converts it** (§6.3). Heads standing on the carved tiles have no trail, so no life line; they convert intact — a 2× swing on the axis that decides the game. The turtle's own garrison is what makes the carve worth attempting.

So a turtle faces a bill either way: garrison the spawner and lose the garrison when it is carved, or leave it thin and lose it cheaply. Meanwhile they cannot grow — that is the definition of turtling — so nothing replaces what they lose, and once the last share is gone the starvation clock runs on a player with no income at all.

**No clock bolted beside the rules, no upkeep.** Starvation *is* the clock, and it reads shares the board already carries.

### The board has no edge, and it does not need one

An unbounded board (§2) makes a second non-termination case reachable, and it looks like the turtle's twin: a losing player can walk their last heads past the cutoff radius *R* and keep walking.

Two things are true, and together they are why this needs a loss condition rather than a chase mechanic:

- **Fleeing gains nothing.** Past *R* there is no production to claim (§7). The runner earns only from the shares it left behind at home, and the pursuer can carve those without catching it. Every turn spent running widens the gap.
- **Pursuit converges.** `speed(N) = 1 + floor(log₂ N)` (§3), so a 16-stack closes four cells a turn on a lone head. Being faster is not enough on its own — the pursuer must also leave home to do it, and a chase is turns not spent defending.

So the runner cannot win, only decline to lose — and **starvation ends that seat** once its home shares are carved, because past *R* it can claim no new one. Ending it does not depend on catching the heads.

The two are the same problem — a player who has stopped playing and cannot be *reached* — and one condition answers both, because it stops asking to reach them. The runner's production is the home it left behind, and the turtle's is the home it sits in; both are enclosable at the cheapest size on the board (above).

---

## 10. Balance Posture

Known pressure points and their built-in counterweights:

| Snowball vector | Counterweight |
|---|---|
| Safe movement inside territory is free, so a large empire repositions instantly | A large empire has an enormous perimeter it cannot garrison everywhere |
| More specials → more heads | Specials are physical locations that can be carved away, and only produce for the owner of their arrows (§7) |
| Big stacks win fights | Big stacks are throughput-negative (§3); splitting is genuinely competitive |
| Leader can cut every enemy chain | Cutting requires leaving safety — the cutter becomes trailed and cuttable itself, and contact combat (§6.2) makes stepping onto a garrisoned arrow cost heads on both sides |

The decoy play this enables: bait an attacker into committing to a cut, and counterattack the now-exposed cutter with a flanking stack. If they refuse the bait, the decoy changes course and joins the flank to close the shape. This emerges from the rules rather than being designed in.

---

## 11. Open Questions

What SPEC.md does not decide yet. A behaviour this document does not state is an open question, not a default: add it here, not in the section that discovers it. When an item is settled, its rule goes into the section that owns it and the item is deleted.

**Tuning — numbers only playtesting can set; none changes a rule**

1. **The spawner field.** Cutoff *R*, the band radii, force and density per band, and `homeOffset` (§7, *the radial gradient*; §8). `SPAWNER_BANDS` holds the current values, and a retune must not change which scenarios pass (§7, *placement and force are setup data*).
2. **The production-versus-denial crossover.** Which side of it each force lands on, and whether 4:1 and a home band paying a head every 12 rounds are right (§7, *what the spawn rate implies about victory*).
3. **Starvation *N*.** Default 5 full rounds (§9).
4. **Minimum attacker loss.** The floor can give the attacker zero loss in a round (e.g. 5v3); whether to add a minimum of 1 (§6.2).

**Parked — decided for MVP, to revisit after playtest**

5. **Territory combat modifiers.** On the defender's territory, contact might cost the defender heads only and mark the arrow in the invader's trail. No rule until revisited (§6.2).
6. **Retreat between combat rounds.** Combat fights to a wipe inside one step (§6.2).
7. **Branch toll.** Branching is free (§5); a per-branch head toll is parked.
8. **Upkeep.** Each special sustaining some number of heads, a shortfall costing heads. Not needed by any rule (§9).
9. **Fair fields for 3 and 6 seats.** The field is mirror-symmetric, which is exact for 2 seats (§7). Exact fairness for 3 and 6 seats needs the 120° rotation and the full *D*₃ group (§2) in the thinning.
10. **Seat counts other than 2, 3 and 6, and kingmaking with 3+ seats.** 4 seats take four corners with one opposite pair free; 5, 7 and 8 take an equal angular span, best effort (§8). None is shown fair. Kingmaking is accepted for hot-seat playtest.

---

## Appendix A: Drafted Opening (retired)

A drafted opening — a setup-only placement phase in which any closed loop of a player's heads became territory (the reserved word *island*) — is retired. Constant, symmetric home triangles with a 3-stack (§8) give every seat land on turn one, and the setup seed with the mirrored field gives map variety and fairness (§7), which is what a draft would otherwise have had to supply.
