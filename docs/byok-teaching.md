# Conquarrow BYOK teaching

Curated for the BYOK seat. If this disagrees with SPEC.md, SPEC wins.

## Win

The match ends when one seat remains. A won match offers nothing. A seat with no territory is lost. A living player who owns no spawner share at all for N consecutive full rounds loses (starvation). Loop: risk heads → take territory → hold specials → make heads.

## Board

The board is an unbounded plane tiled with arrows. Movement follows the grain only. Every point is 3-in / 3-out. The girth is 3. A spawner sits on a vertex (never occupied).

## Move and turn

A move takes one portion of one arrow one step along an out-arrow. A turn is an ordered list of such steps, ended with endTurn on the JSON — that flag is not an offer index.

## Tempo

speed(N) = 1 + floor(log₂ N). On a split, both parts inherit spent. Arrive as majority and the joined group is barred at speed 0. Splitting is a decision before you walk, not after. Same (from, exit), larger count is the same walk, faster. A 2^k lump walks k+1 steps this turn as one count — send it as one count, not as 2^k singletons. The leftover keeps the parent's spent, so you may send the lump first and still move the remainder.

## Close, cut, mill

Closing claims enclosed ground, including enemy heads. A cut evaporates enemy trail. home_mill / onto_home with empty trail and no expansion is wasted tempo. Tags on the offer name outcomes (leave_home, home_mill, onto_home, closes, cut, share+N, on_target); they are not orders.

## JSON contract

Return only a JSON object (no markdown fence):
{"moves":[i,...],"endTurn":true|false,"why":"short"}
"moves" is an ordered array of LEGAL_MOVES step indices from this offer only. Set endTurn true when this seat is done. Do not invent moves. Do not reprint STATE_JSON.

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

Lump count=3 walks 2 tiles this turn (speed(3)=2). Split 2+1 before walking: the pair walks 2 tiles and the singleton walks 1 tile → 3 tiles. After the lump both parts inherit spent. Do not peel three count=1 as three POSTs — legal, but that is singleton throughput without the pair's extra step.

## Pinwheel 1-share vs 3-share

The girth is 3: one pinwheel is one vertex and three border arrows — three shares.

Before
You: 1 head on one border of an open spawner pinwheel, trail back to a small home blob. Shares=0.
[0] homeward close (lands; claims the trail and that one border).
[1] walk another border of the same pinwheel.

After 1-share
apply(state, move) → state: the path and one border are territory. Shares=1.

After 3-share
Each step is apply(state, move) → state. After walking the other two borders then landing, all three borders are territory. Shares=3.
