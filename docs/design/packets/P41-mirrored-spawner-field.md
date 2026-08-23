# P41 — The spawner field is mirrored, not merely thinned

**Kind**: setup (geometry-tiling) · **SPEC**: §2 *map symmetry*, §4 *travel*, §7
*the radial gradient*, §11 item 48 · **Depends on**: P03, P08, P36

## Why

The homes are already mirror images of each other (§2, *map symmetry*). The
**spawner field is not.** `setup.ts` hash-thins every eligible vertex
independently through `thinningSample(cell, seed)`, so two seats placed as exact
mirror images sit in a field that is not, and one of them can wake up with three
spawners inside a short walk while the other has one. Under the accumulator an
opening force edge compounds, so this is not cosmetic.

Placement is setup data (§7) and nothing downstream reads it, so this is not a
rule change. It is a change to *which* eligible vertices survive the thinning.

## What travel actually costs, and why it decides the design

Two facts, neither of them previously written down. Both fall out of the out-set
being `{N, SE, SW}` at every point (§11 item 1) with `N + SE + SW = 0`.

**1. Travel is anisotropic — 1 step with the grain, 2 against.** A net
displacement of *k* in an anti-grain direction costs exactly *2k* steps: *k* SE
plus *k* SW, in any order. Walking 5 N and coming back is 5 out, 10 home. The
three grain directions are cheap and the three anti-grain directions cost double.

**2. A closed walk is balanced — and that is all it settles.** A walk back to the
arrow it left needs `a·N + b·SE + c·SW = 0` with non-negative counts, forcing
`a = b = c`: length 3*k*, equal counts of each direction. That fixes girth 3 and
the 3-step U-turn. It does **not** say anything about claiming, because **a claim
is not a closed walk**: closure (§7) leaves your territory and lands back on it at
a *different* arrow, and the boundary you already own closes the loop. The trail
is unconstrained, so a favourably oriented frontier encloses at 1 step per unit
and an unfavourable one pays 2.

**So the anisotropy prices three separate journeys** — walking out to the centre,
walking home, and closing around the ground taken — and a seat can be handed an
edge in any of them, independently. There is no single scalar that captures it.
That is the argument for symmetry: an automorphism equalises every directed path
length at once, while a threshold fixes whichever quantity it happens to measure
and silently trades the others away.

## Why symmetry rather than a fairness threshold

Fairness on a directed anisotropic cost is exactly what a graph automorphism
gives for free: if the map is an automorphism of the oriented graph, every line of
play for one seat has an equal-length counterpart for the other (§2 already argues
this for the homes). A tolerance-and-search approach would have to measure
directed cost both ways for every seat and then pick a threshold — more machinery,
and a theorem replaced by a constant.

**Which symmetries are available is fixed by the out-set.** The point group
preserving `{N, SE, SW}` is *D*₃ — the identity, ±120° rotations, and the three
mirrors through the grain directions. Order 6. **180° rotation is not in it**: it
maps N to S, which is not an out-arrow. So exact fairness is available for **2
seats (a mirror), 3 seats (120°), or 6 seats (the full group)** — and *not* for
two seats placed on opposite sides by rotation, which is precisely the
"one seat attacks cheaply, the other closes cheaply" asymmetry that motivated
this packet.

MVP is 2 players (§4), so this packet does the mirror. The 120° construction is
the 3-seat analogue and is deliberately left unbuilt.

## The change

**Sample the hash at the orbit representative, not at the vertex.**

For each eligible vertex *v*, let *M* be the grain-preserving reflection §2
already uses to place the homes, and let `rep(v)` be whichever of `v` and `M(v)`
sorts first under the total id order (`compareIds`). Feed `rep(v)` to
`thinningSample` instead of *v*. Because *M* fixes the origin it preserves the
radius, so *v* and *M(v)* see the same band, the same density and the same force —
they therefore always agree, and the field is exactly mirror-symmetric.

Vertices *on* the axis are their own mirror and need no special case. The rule
that a home vertex always carries a spawner regardless of thinning is unchanged.

Cost: one reflection and one comparison per vertex. No extra window walk, no
search, no new tuning constant, and the density table is untouched.

**The one thing it does change**, and it should be said out loud: the number of
independent samples halves, so the surviving spawners cluster slightly more
coarsely than before at the same nominal density. The density *target* is
unaffected; the texture is a little lumpier.

## The one geometry fact to verify first

§2 says the involution is "the reflection in the x-axis". By the vector argument
above the grain-preserving mirrors are the lines *along* a grain direction, so if
`up` is +y the axis should be the y-axis. This is very likely a coordinate
convention (`up` may well be +x in cell space) rather than an error, but the
packet must not be built on the assumption. **Check the reflection helper in
`geometry-tiling` maps vertex cells to vertex cells preserving parity, and that
`M` composed with itself is the identity, before anything else.** If it does not,
that is a kickback, not something to work around.

## Out of scope

- The 120° / 3-seat construction.
- Retuning the density or force tables (§11 items 11, 12 still own the sweep).
- The drafted opening (Appendix A) — sunset by this packet's SPEC edit.
