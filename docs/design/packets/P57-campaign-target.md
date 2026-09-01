# P57 — Campaign target: close what is worth holding

**Spec:** edit [`docs/spec/close-and-spawner-value/`](../../spec/close-and-spawner-value/close-and-spawner-value.md)
(close-value rate + `close_path` ranking). Touch [`docs/spec/bot-turn-search/`](../../spec/bot-turn-search/bot-turn-search.md)
only if a return-time scenario must name the campaign vertex. No new spec
directory unless the spec-author finds the P54 file bursting.

**Layer:** `web` adapter only. No `contracts`, `rules-core`, or `online-api`
behaviour change. **No game rule is added, changed, or implied.** Nothing is
owed to SPEC §11.

**Depends on P53, P54, P56.** P55's reply search stays on; this packet does not
retune the reply budget. `greedy-v1` stays frozen. Pages still calls `chooseMove`.

## Problem

P56 stopped the home pinwheel mill. The next playtest is not a mill. It is a
**dirt painter**.

Playtest [`2026-09-01T09:50:40Z`](./data/conquarrow-match-2026-09-01T095040-792Z.json)
(3-seat, `R = 7`, `spawnerSeed = 1`, human C vs heuristic A/B, after P56):

| metric | 03:39 (pre-P56 mill) | 09:50 (post-P56) |
|---|---|---|
| steps | 52 | 115 |
| endTurns | 29 | 44 |
| closes | 5 | **18** |
| cuts | 0 | **0** |
| firstCloseAt | 12 | 12 |

They leave home. Then they close the nearest 1-turn empty loop. Then they
leave again, a little further from the homes and from any unowned spawner.
Eighteen paints, zero cuts, first close still at move 12. The human is the
only seat walking toward production.

This is P54's rate doing what P54 asked:

```
loot        = shareTerm(shares) + arrows × A          A = 25, S = 100
closeValue  = loot / turnsToClose × survival(exposure)
```

A 1-turn 0-share 3-arrow land-bridge is `75`. A 4-turn walk that would bank
one share is `100 / 4 = 25` before survival. The empty loop wins by
arithmetic. P56's non-goal said so out loud: *do not change `closeValue` so
0-share land-bridges score zero — those closes are correct on an expedition.*
That sentence is now the bug. After P56 the expedition *is* one step off home
and a landing on empty dirt. `evaluate` still pays `+25` per painted arrow,
so the beam agrees with the finding.

`approach_spawner` still exists. Findings only order the beam. A high-rate
`close_path` of empty arrows outranks a departing exit toward a vertex the
seat does not yet own. There is no *which* vertex. Nearest paintable loop
wins.

Cuts are zero for the same reason: `cut` / `attack` findings cannot beat a
75-point dirt close on a quiet board.

## What is not the fix

**Several AIs with preference sliders** (safe-close vs valuable-close, attack
vs defence) is a real product idea. It is the wrong next packet.

- `greedy-v1` is frozen as the aggressive-ish baseline. It still shuttles
  (P53) and still cannot close (P54). Shipping it as a lobby personality
  re-opens those two defects as a feature.
- Three weight vectors over the current `closeValue` all prefer the 75-point
  dirt loop, because the *rate* is the thing that is wrong. Personalities
  on a broken rate are three flavours of dirt painter.
- A lobby picker / seat-kind / match-log field is a product packet. This one
  is an evaluation packet. P53's `chooseTurn` seam already lets a later
  packet swap implementations in one line.

Park personalities as **P58**. This packet leaves a named weight object so
P58 does not have to invent the knobs from scratch — see §4.

Do **not** add spawner-gravity to `evaluate`. Aug 31 already forbade it:
that term broke the constructed 4-stack close and P55's takeable-stack
denial. The campaign lives in `closeValue` / findings rank / one return-time
compare, same family as P54 and P56.

## What ships

### 1. One campaign vertex per position

```
campaignTarget(state, me) =
  the spawner vertex V that maximises
    force(V) × (3 − ownShares(V, me)) / max(1, grainDist(nearest own group, V))
  among V with ownShares(V, me) < 3
  ties: vertex id
```

`force` is setup data already on the state (SPEC §7). Do not invent a second
force table. A vertex the seat already monopolises is not a campaign.
Grain distance is the same BFS `homewardPath` / `approach_spawner` already
use — reuse it; do not write a third.

Deterministic. Same state, same `me`, same `V`. No clock, no RNG.

The campaign is a **search-origin fact**, recomputed at the start of
`chooseTurnBeam` and threaded into `closeValue` / findings. It is not stored
on `GameState` and is not a game rule.

### 2. Dirt closes score zero on a quiet board

A close candidate is a **dirt close** when all of:

- `shares == 0`
- no claimed arrow borders the campaign vertex
- the landing is not strictly closer (grain) to the campaign than the tip
  the plan started from

Then:

```
if dirtClose and exposure == 0:
  closeValue = 0
else:
  closeValue = (loot / T) × survival     // P54 unchanged
```

Under fire (`exposure > 0`) the 1-turn empty land-bridge stays the P54
corridor close — bank what you have before the reply cuts it. On a quiet
board it is no longer a goal. `preferClose` already ranks by `closeValue`;
zero drops dirt behind any share-taking or campaign-advancing candidate.

Do not change `SHARE_VALUE_S` or `ARROW_VALUE_A`. Do not add a third loot
constant. The discriminant is the campaign, not a new `A_dirt`.

`estimateCloseLoot` gains a boolean `hitsCampaign` (claimed set borders `V`)
and a boolean `advancesCampaign` (landing grain-closer to `V`). Both are
pure functions of the candidate plus the origin campaign. Wire them into
`preferClose` only through the dirt-close gate above — do not add a second
sort key that can fight the rate.

### 3. Findings order the campaign, not "a" spawner

`approach_spawner` ranks departing exits by grain distance to
**`campaignTarget`**, not to the nearest spawner of any kind. A group already
standing on an open share of `V` keeps P54's "your goal is the close that
banks this share." Sibling-border hops that do not claim stay last.

`close_path` candidates that are dirt closes on a quiet board drop to the
bottom of the finding order (or are omitted). Share-taking and
campaign-advancing `close_path`s keep their P54 rate order.

`cut` / `attack` do not need new terms. Once dirt closes stop occupying the
top of the order, those findings get beam slots they currently never see.
Do not add an attack bonus in this packet; measure cuts on the 09:50 log's
reconstructed turn-starts and leave a number in `pnpm bots`.

### 4. Named weights, all `1`, not a lobby

```
BotDrive = {
  shareLoot: 1,       // P54 shareTerm
  arrowLoot: 1,       // P54 arrows × A, already gated by §2
  campaignPull: 1,    // findings rank toward V (§3)
  bankUnderFire: 1,   // keep dirt close when exposure > 0
}
```

Export from `botClose.ts`. Every factor in this packet multiplies one of
those. All stay `1`. P58 may clone the object into seat presets
(`raider`, `holder`, …) and a lobby control. This packet must not grow a
UI, a seat kind, or a match-log field. The object exists so P58 does not
re-derive which numbers were load-bearing.

### 5. Spec / CONTEXT, not a new module unless one file bursts

- Rewrite the P54 close-value section so the rate is **gated** by the
  campaign, not replaced. The 2-turn-one-share vs 6-turn-two-share
  scenario stays; add the quiet-board dirt-close case next to it.
- Core scenarios:
  - generated opening, after the first 0-share home close (P56 position):
    `chooseTurnBeam` still leaves (P56 invariant). The departing exit is
    on a shortest grain path toward `campaignTarget`, not toward an empty
    neighbour that is farther from every unowned spawner.
  - a constructed quiet board with a 1-turn 0-share 3-arrow loop and a
    3-turn walk that would border one unowned share of `V`: the returned
    plan does not terminate on the 0-share loop.
  - the same board with an enemy group grain-reachable to the open trail
    (`exposure > 0`): the 1-turn loop is allowed again (P54 corridor).
  - a constructed board where `V` is a contested centre vertex and a
    nearer empty home-adjacent vertex is also a spawner the seat already
    monopolises: `campaignTarget` is the contested one.
- Update `CONTEXT.md`: **campaign target**, **dirt close**. Amend
  `closeValue` / `beam-v1` one line each.
- Commit the 09:50 log next to this packet as
  `docs/design/packets/data/conquarrow-match-2026-09-01T095040-792Z.json`.

## Non-goals

- Personality sliders, lobby difficulty, extra `chooseTurn` implementations,
  seat-kind changes, match-log fields. That is **P58**.
- Retuning `evaluate`, `tipTerm`, `closeUrgency`, `MOBILITY_SCALE`,
  `SHARE_VALUE_S`, `ARROW_VALUE_A`, `IDLE_SLACK`, `SORTIE_SLACK`, or any
  beam / reply budget.
- Spawner-gravity in `evaluate`.
- Changing P56's expedition predicate. A 0-share home paint is still not
  an expedition. This packet decides what the expedition walks *toward*.
- Teaching multi-vertex campaigns, waypoints, or a stored plan across
  turns. The campaign is recomputed each `chooseTurn` from the board.
- Lifting Pages onto `chooseTurnBeam` (still P53 BSSN 2).
- Editing SPEC.md.
- Unfreezing `greedy-v1`.

## Acceptance

- P56 stays green: after a 0-share home close, territory > 3, trail empty,
  groups on home, `chooseTurnBeam` still steps onto a non-territory arrow.
- On that same position the stepped-onto arrow is on a shortest path to
  `campaignTarget` (or strictly closer to it than the origin groups were).
- Quiet constructed board: 1-turn 0-share loop vs 3-turn campaign-share
  walk — the plan is the walk, not the loop.
- Same board, `exposure > 0` on the open trail — the 1-turn loop is legal
  again and preferred when its P54 rate wins.
- `campaignTarget` prefers a contested / unowned vertex over a monopolised
  nearer one. Ties break on vertex id.
- P54's quiet-board 2-turn-one-share vs 6-turn-two-share still holds (both
  hit shares; dirt-close gate is off).
- P53 stride construction still strides. P55 box / takeable-stack still
  green. Threatened departing exit still disables the P56 swap.
- Reconstructing heuristic turn-starts from the 09:50 log *after each
  seat's first close*, `chooseTurnBeam` does not return a plan whose only
  effect is a 0-share dirt close when a campaign-advancing complete existed
  in the beam.
- Determinism: same state in, same plan out; no `Date`, no `Math.random`.
- `pnpm verify` green. `beam-v1` still beats `greedy-v1` on shuttle rate
  and `count>1` share on the P53 baseline turn-starts.

## Why this and not personalities first

The 09:50 log is one policy failing in one place: **empty arrows are priced
like production**. Until that price is gated, every personality that uses
`closeValue` will close empty loops; the only personality that will not is
`greedy-v1`, which cannot stride or close. Fix the price. Then P58 can
clone `BotDrive` into `raider` / `holder` without shipping two broken bots.
