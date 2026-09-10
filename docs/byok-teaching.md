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

Tags name outcomes. They are not orders. `on_target` loses to an available `closes`, an available `cut`, an opponent share or territory lead, and when trailLen is already at least girth and tipDist is not shrinking. Do not invent a tag. Do not treat `borders_spawner` as walking past the close.

## JSON contract

Return only a JSON object (no markdown fence):
{"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}
"moves" is an ordered array of LEGAL_MOVES step indices from this offer only. Set endTurn true when this seat is done. Do not invent moves. Do not reprint STATE_JSON. `plan` may be omitted on a one-batch job or a pass.

## Plan

`plan` is one clause naming the job this seat is still on after this batch (close this trail, contest the open enemy trail, spend leftover on the same exit). It is not an offer index. It is not geometry. It is not a second `why`.

Write it when the job needs another POST or another seat-turn. Omit it on a pass (`[]` + `endTurn: true`) or when this batch finishes the job (close lands, trailLen will be 0).

Keep it under 512 characters, one paragraph, no invented destinations. Do not put indices in plan (`close the 3-stack` not `play [2]`). Indices go stale on the next offer.

A share is a factory. Force on a held vertex is future heads. Territory with no new share is painted dirt. closes without share+N on that row claims painted dirt only. The pinwheel 1-share vs 3-share example already shows the other case. Do not invent `share+N`.

Opening implication of `speed(N) = 1 + floor(log₂ N)` only: a 4-stack is 3 tiles this turn; three singletons are 1+1+1. That is why an early lump has more ground, not because we said "prefer 4."

Other seats have a job you can read from the header: share lead, longest enemy trail, whether any legal row is `cut` / `closes` / `borders_spawner`. Weigh cut-if-present against expand-if-present. A plan cannot create a cut that is not a row.

A plan that names a tag is already wrong (`continue on_target`, `walk on_target`). Tags are hints. Rewrite it.

Rewrite when: the job is done; this offer no longer contains that walk; the threat line shows a `cut` / `share+N` close that beats the old job; the current `closes` row has no `share+N`; the lead has flipped against this seat and the plan is still "close this dirt trail."

The echoed `Plan:` line is a reminder, not an order. `LEGAL_MOVES` still binds. A plan cannot create a cut that is not a row.

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
