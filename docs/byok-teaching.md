# Conquarrow BYOK teaching

Curated for the BYOK seat. If this disagrees with SPEC.md, SPEC wins.

## Win

The match ends when one seat remains. A seat with no territory is lost. A seat that owns no spawner share for N consecutive full rounds loses (starvation). Loop: risk heads → take territory → hold specials → make heads.

## Gradient

A spawner pays `force` heads per full round, round-robin over its 3 shares; you get the shares you hold. By graph distance r from the origin:

| r | force | density |
|---|---|---|
| 0–1 | 1/3 | 1/2 |
| 2–3 | 1/9 | 1/3 |
| 4–5 | 1/12 | 1/6 |
| 6–R | 1/12 | 1/12 |

Past R (default 7) there are no spawners. Force runs 4:1 centre to outer band, density 6:1. An arrow borders exactly 2 vertices, so dense centre arrows are often double-fed. A spawner row's `force` tells you its band; higher pays faster. By default homes start in the 4–5 band: expanding outward from home moves into the worst ground on the board.

## Board

The board is an unbounded plane tiled with arrows. Movement follows the grain only, inside your own territory too: territory is safe, not free. Against the grain costs double, so a head deep in your back-country can be turns from the fighting. Every point is 3-in / 3-out. The girth is 3. A spawner sits on a vertex (never occupied).

## Move and turn

A move takes one portion of one arrow one step along an out-arrow. A turn is an ordered list of such steps, ended with endTurn on the JSON — that flag is not an offer index.

## Tempo

speed(N) = 1 + floor(log₂ N). On a split, both parts inherit spent. Arrive as majority and the joined group is barred at speed 0. Splitting is a decision before you walk, not after. A 2^k lump walks k+1 steps as one count; send it as one count, not as 2^k singletons. The leftover keeps the parent's spent, so you may send the lump first and still move the remainder. A 4-stack is 3 tiles this turn; three singletons are 1+1+1.

Between powers of two the spare head is free: speed(2) = speed(3) = 2, so a 3-stack can leave a sentry and still walk 2. A cut destroys your trail only up to your nearest head (or territory) each way. The tip already stops it, so a sentry belongs between the deep end of the trail and home.

Merging into a larger stack is free in the right order: walk the larger stack first, then step the smaller group onto it once its steps are spent. Crossing a power of two (3→4, 7→8) buys a tile every turn after.

## Close, cut, mill

Closing claims enclosed ground, including enemy heads. Read backwards, that is encirclement: your heads inside an enemy loop convert whole, whatever the stack size, unless on a territory-grade trail. Concentration wins combat and loses to closure; two enemy trails flanking your salient can be the two arms of a pincer. home_mill with empty trail and no expansion is wasted tempo. Crossing your own territory toward its edge (`to_edge`) is how an interior stack gets back to work; it is not a mill. Tags on the offer name outcomes (leave_home, home_mill, onto_home, closes, cut, share+N, on_target); they are not orders.

`on_target` loses to an available `closes`, an available `cut`, an opponent share or territory lead, and when trailLen is already at least girth and tipDist is not shrinking. Do not invent a tag. Do not treat `borders_spawner` as walking past the close.

## Missing rows are rules

`LEGAL_MOVES` omits illegal steps; a missing row is a rule.

- A step onto enemy territory needs `from` on your own territory or your territory-grade trail. Otherwise it is refused: "step onto enemy territory without a territory-grade trail would convert".
- Enemy territory is taken only by a closure: a step onto it lays trail, the landing claims it.
- Anchors: trail reaching neither your territory nor one of your stacks is dormant and claims nothing until a head re-attaches. A head inside enemy territory whose trail no longer reaches your territory converts; sentries do not save it.

## JSON contract

Return only a JSON object (no markdown fence):
{"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}
"moves" is an ordered array of LEGAL_MOVES step indices from this offer only. Set endTurn true when this seat is done. Do not invent moves. Do not reprint STATE_JSON. `plan` may be omitted on a one-batch job or a pass.

## Plan

`plan` is one clause naming the job still open after this batch (close this trail, contest the open enemy trail). Not an offer index, not geometry, not a second `why`.

Keep it under 512 characters, one paragraph, no invented destinations. Do not put indices in plan; they go stale on the next offer.

A share is a factory. closes without share+N on that row claims painted dirt only — unless it shortens the next loop to a spawner, e.g. leaves a vertex one arrow short. A land bridge across spawner borders turns those arrows into shares. Do not invent `share+N`.

Other seats have a job you can read from the header: share lead, longest enemy trail, whether any legal row is `cut` / `closes` / `borders_spawner`. Weigh cut-if-present against expand-if-present. A plan cannot create a cut that is not a row.

A plan that names a tag is already wrong. Rewrite it when the job is done, its walk left the offer, a `cut` / `share+N` close beats it or the lead flipped. The echoed `Plan:` line is a reminder, not an order.

Hit 12 shape. Offer has count=3 closes [2] and [8].
Good: {"moves":[2],"endTurn":true,"why":"lump close","plan":"close the open trail"}
Bad:  {"moves":[4,0],"endTurn":false,"why":"split for spawner"}  // abandoned the close; no plan

Hit 5 / 9 shape. Offer has closes [3] (no share+N) and borders_spawner [5].
Plan: close the open trail
Good: {"moves":[5],"endTurn":false,"why":"border the pinwheel","plan":"walk a border of the open pinwheel; dirt close is not a share"}
Bad:  {"moves":[3],"endTurn":true,"why":"lump close"}  // dirt; shares stay 4

Hit 12 is how: if this batch closes, send the lump already on the offer; do not peel. Hit 5 / 9 is whether: a `closes` row with no `share+N` is painted dirt — rewrite that job when a `borders_spawner` walk is also on the offer. The baseline may still name the lump close; it is a suggestion, not an order.

## Close vs cut

Before
You: 1 head, trailLen=3, shares=1. Enemy: 1 head on their trail, trailLen=2.
[0] closes (lands back on your territory).
[1] cuts (steps onto the enemy trail).

After close
apply(state, move) → state: enclosed ground is yours, including any enemy heads inside. The closing trail is now territory.

After cut
apply(state, move) → state: the enemy trail evaporates. You still have an open trail.

## T1 tempo

Same (from, exit):
[0] count=1
[1] count=2
[2] count=3

Lump count=3 walks 2 tiles (speed(3)=2). Split 2+1 before walking: the pair walks 2 and the singleton 1 → 3 tiles. Do not peel three count=1 as three POSTs.

## Pinwheel 1-share vs 3-share

The girth is 3: one pinwheel is one vertex and three border arrows — three shares.

Before
You: 1 head on one border of an open pinwheel, trail back home. Shares=0.
[0] homeward close (lands; claims the trail and that one border).
[1] walk another border of the same pinwheel.

After 1-share
apply(state, move) → state: the path and one border are territory. Shares=1.

After 3-share
Walk the other two borders, then land: all three borders are territory. Shares=3.

## Losing

With a share and no heads you are alive, skipped until a spawner pays. With no share you starve in N full rounds, or lose at once with no heads. So zero heads is survivable and zero shares is not: when behind, spend heads on shares, do not hoard them.

Reducing an opponent's production counts: spawner rows show their `held`. When behind, taking or blockading their share is often worth more per step than any gain.
