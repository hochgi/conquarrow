# ADR 0008 — Design rationale behind SPEC.md

**Status:** Accepted
**Date:** 2026-11-05
**Context:** [`SPEC.md`](../../SPEC.md), [P86](../design/packets/P86-spec-conflict-resolution.md), [the conflict register](../research/spec-conflicts.md)

## Context

SPEC.md states the current design once, with no history in its text
(AGENTS.md). P86 removed its strikethroughs and "resolved / withdrawn" notes.
Some of those notes carried a reason that is not obvious from the rule and
still matters. This ADR keeps them, one short section each, with the SPEC
section it explains. Earlier wordings are in git.

## Decision

Each section below is the reasoning behind a rule SPEC.md states.

### The board is the plane, not a torus (§2, §7)

A cut-out rectangle breaks 3-in/3-out at its rim, where camping happens. A torus
fixes the rim, but on a torus every lattice ray is a closed loop, so it crosses
any contractible curve an even number of times: a parity fill reports *outside*
for every enclosure. Fill is now reachability ("cannot reach infinity"), and
that is undefined on a torus, which has no outside. The plane also gives a
centre and removes the board-size floor, which existed only because wrap
collapsed *girth 3 encloses exactly one vertex* on small tori. The costs:
`GeometryPort` answers a bounded window, and running away is possible, which
§7's gradient and §9's starvation answer.

### Fixture boards: the floor and the finiteness limit (§2, `GeometryPort`)

A fixture board need not be a lattice, only satisfy the conformance suite. Its
floor is 7 points, 21 arrows, 14 vertices: no rim forces undirected degree 6 at
every point, which needs at least 7 points, and 7 is attained by a unique board
(the tournament on ℤ/7, `i → j` iff `j − i` is a square mod 7). That board is
`K₇`, so a second 8-point fixture covers non-adjacency and proper windows.
On any finite board, *straight ahead* is a bijection on arrows, so every ray
closes on itself and fill cannot be defined there. Movement, the chord test,
cuts and accrual are local and run on fixtures; closure, fill and encirclement
are tested against the generated tiling. No authoring choice fixes that.

### Alternation binds every board; the phase does not (§2)

The conformance suite once asserted only six distinct slots, so a chiral
fixture passed while contradicting §2. §5 and §6 assume a head can turn either
way aside from a trail; a chiral fixture would answer those scenarios
differently and break the promise that any conforming board is
interchangeable. The phase is free because slot indices are the port's own
labelling and the chord test is rotation-invariant.

### Integer speed, not a harmonic curve (§3)

A harmonic curve with banked remainders had a pleasing rhythm and was hard to
read: you could not tell how far a 5-stack moves this turn without knowing what
it banked last turn. The game's appeal is that an attentive player can compute
the next move, so predictable whole steps win. The log₂ ladder also makes the
pair free (`speed(2) = 2`).

### The merge override rides with the heads (§3)

The state has no stack to hang a price on: a group is whoever stands on an arrow.
If the override belonged to the arrow, one ordinary step would shed it, and
*reinforce, then advance* would be the free mid-turn speed upgrade the rule
exists to price. Only "with the heads" charges it. The two readings differ only
after the merged group moves again, so a property test, not a scenario, pins it.

### Branching is free (§5)

Earlier rule sets required one head per open side, then one head per branch.
Playtests showed the toll froze tips that players and bots could not read, so
the garrison stays a choice. Whether a toll returns is parked in §11.

### Route drafting, not destinations (§5)

A destination underdetermines the route — `C(n−1, a)` routes reach it — and the
route is the trail every rule reads. An adapter picking among them would pick
the move by iteration order. Drafting names the route one run at a time.

### A point is all-to-all (§6.1, §6.1a)

The arrow set holds no pairing between a point's ins and outs. A canonical
pairing by slot convention would route damage down arrows the player never
connected. Declaring an ambiguous point uncuttable would make a crossover a free
wall with no mechanism behind it. All-to-all asserts only what the set holds.
The same reading makes a cut on one fork arm flood every arm: only the cut point
being all-to-all left a directed-front hole (playtest 2026-08-27).

### A front halts per arrow, not per point (§6.1, §6.2)

A point-wide shield cannot work: a front that reaches a point has already come
through one of its arrows, and letting a head on another arrow bar it after the
fact contradicts the ordinary cases. Per arrow is local, and locality keeps
evaporation total.

### Every evaporation front destroys trail, never heads (§6.1)

A cut once killed the first head it met and halted at the second, which made
the pair the smallest wall. Killing belongs to combat. Any garrison now halts a
front, and sentry size matters only for contact combat.

### No head is trapped by trail (§6.1a)

An earlier proof (each visit to a point uses one in and one out, so an exit is
always free) holds for a path and fails for a tree: a split lets one arrival
fund several departures. Making the trail a set, with re-traversal legal,
removes the premise, and §2's Eulerian argument covers movement on its own.

### A claim does not demote an uncut trail (§6.3, §7)

The human, 2026-11-05: "If the trail isn't cut, there shouldn't be any
evaporation." So a claim spares a territory-grade stretch that carries its
owner's stack, wherever the stack stands. A claim that takes the trail's
anchoring land is treated as the territory-root cut it is, because a spared
stretch with no anchor left would otherwise need a grade-memory rule nobody
chose. Bare trail on claimed tiles is still removed (the human, 2026-11-04).

### A repelled attack does not cut (§6.1, §6.2)

The human, 2026-11-05: to cross a trail and cause evaporation the crossing
must succeed; an attacker that is repelled did not cross. Otherwise a one-head
suicide attack would be a cheap cut.

### Fill is reachability, not parity (§7)

A claim is bounded by the trail on one side and by existing territory on the
other, so it is not a closed curve; a probe can escape through the territory
side having crossed the trail zero times. Treating territory as boundary fails
too, because territory is thick. Where the two readings differ on a real shape
(a trail ringing a region with two separate loops), parity calls the core
outside and reachability calls it yours, which is what a player predicts.

### The claim walk ignores occupation (§7)

A cap at the first firebreak once left a garrisoned arrow and the tail beyond it
as trail after a stack-grade landing (playtest 2026-08-23). A firebreak stops
evaporation, not a claim; grade governs conversion, not how much is claimed.

### Spawner bands at 4:1 (§7)

`1/3^r` ran the rim at 1/2187 against 1/3 at the centre (729:1), so reaching the
middle first won and the rest of the board was scenery. Bands use only 1/3, 1/9
and 1/12. With ~14 eligible vertices inside r = 1 against ~264 beyond r = 3, the
band totals are close: the centre is concentrated, not richer. Unthinned, the
disc held 338 spawners and was unreadable; the bands leave ~50–70. The table was
retuned in the 2026-08-07 playtest commit; `SPAWNER_BANDS` is authoritative.
Thinning is irregular (a hash, not a sublattice) because irregular clusters
produce the double-fed arrows the density argument needs.

### A mirrored field (§4, §7)

Homes were mirror images while the field around them was not, so an opening
force edge compounded under the accumulator. A per-match seed with no fairness
constraint, one fixed canonical board, and a tolerance-and-search over seeds
were weighed. The anisotropy decided it: travel cost is directed and
out-and-back, which an automorphism of the oriented graph equalises for free
and a distance threshold only approximates. 180° is not an automorphism.

### Starvation, not domination or upkeep (§9)

Domination (hold every share for *N*) started too late: once an opponent had
zero shares, the attacker still had to own the whole board and then wait.
Starvation starts the clock at destitution. Upkeep also ends a fleeing player
but adds per-turn bookkeeping; starvation reads ownership the board carries.
Destitution is per seat because a two-seat clock let two broke seats cancel
each other and ended the whole match for 3+ seats.

### The turtle is a losing position (§9)

The turtle looked like a permanent stalemate on the premise that the attacker
needed its heads, and so had to encircle the whole enclave. Under starvation
the attacker needs its production, and a spawner is enclosable at the minimum
size the game has.

### A loss is immediate (§9)

Resolving loss once per round left a decided win unannounced for four moves in
playtest, and the already-lost seat took a turn in between.

### A won match is terminal (§9)

The human: "what's the point to continue a game once it been won? Lets keep it
simple." Returning the input unchanged was rejected: a caller could not tell "the
match is over" from "that move was a no-op". The gate sits at the top of
`apply`, so it never truncates the deciding move.

### Seat vanish clears, it does not evaporate (§9)

Evaporation is what a cut causes. Making a seat's departure evaporate its trail
would add a new evaporation trigger nobody chose. The adapter presents the
clearance as flicker-then-fade (one event, every cell together, no stagger) so a
player can tell it from a cut.

### No state has every seat lost (§9)

Every seat opens owning its home spawner's whole triangle. A claim only ever
gives territory to the mover, so territory changes hands and is never cleared
there. Seat vanish is the only path that leaves territory unowned, and a
vanishing seat never owned a share. So some seat always owns a share, and a
share owner is never lost. The chain is pinned by invariant tests: if territory
can ever revert to unowned elsewhere, or setup stops granting the home triangle,
the state becomes reachable and its failure mode is an unbounded auto-pass loop.

## Consequences

SPEC.md stays a statement of the current game. A reader who wants to know why a
rule is shaped the way it is reads this ADR or the packet that made the change.
A new decision with a non-obvious reason adds a section here, or its own ADR.
