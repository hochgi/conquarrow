# P59 — Mission and staging: search only the job, paint only as a step

**Local agent handoff:** `/spec-to-ship docs/design/packets/P59-mission-and-staging.md`

Phase 1 writes a **new** spec directory
[`docs/spec/mission-and-staging/`](../../spec/mission-and-staging/)
(core + edge-cases `.feature`, mermaid, EARS). Touch
[`docs/spec/bot-turn-search/`](../../spec/bot-turn-search/bot-turn-search.md)
only to point expansion/reply-finalists at this spec. Touch
[`docs/spec/close-and-spawner-value/`](../../spec/close-and-spawner-value/close-and-spawner-value.md)
only to replace P57's "quiet dirt = 0" sentence with the staging exception
below. Do not burst either file with the new predicates.

**Layer:** `web` adapter only. No `contracts`, `rules-core`, or `online-api`
behaviour change. **No game rule is added, changed, or implied.** Nothing is
owed to SPEC §11.

**Depends on P53, P54, P55, P56, P57.** `greedy-v1` stays frozen. Pages still
calls `chooseMove`. P55's reply *algorithm* stays; this packet changes **which
completes pay for it**.

**Not this packet:** a worker, unlocking input while the bot thinks, P58
personalities, retuning `evaluate`.

## Problem

Two playtests, one leftover, one new.

P56 stopped the home pinwheel mill. P57 stopped the quiet 1-turn empty loop
from beating a walk to production on `closeValue`. The 09:50 playtest after
P56 was still a **dirt painter** (18 closes / 0 cuts). P57 zeros sideways
dirt on a quiet board. That is necessary and stays.

What P57 does not decide:

1. **A dirt close can be a stepping stone.** Grain is one-way. A share of
   campaign vertex `V` that is 3 arrows *outbound* can be ~9 arrows of trail
   once the seat has to close *against* the grain. A human who sees an enemy
   in range will paint a short loop that moves the border toward `V`, then
   walk the remaining 1–2 arrows. P57 treats every 0-share quiet close as
   worthless unless the *landing arrow* is closer to `V`. Staging that paints
   a new frontier (remaining path drops, landing itself may not be "the"
   closer tile) still loses to the 9-arrow kite, because the kite's loot is a
   share.
2. **Risk is pointed at the wrong trail.** P55 `exposure` / replies score the
   trail that exists at a terminal. They do not ask "if I commit to that
   share *now*, can an enemy reach the return path I have not walked yet?"
   So the kite looks like +1 share and a long tipTerm, and still wins when
   no current trail exists at origin (quiet home / just-landed).
3. **The beam is unfocused.** Findings only *sort* exits. Every layer still
   grows a general beam and `considerEnd`s every extendable child with a
   full enemy reply (`withReplies: true`, `REPLY_TURN_APPLIES = 400`). That
   is the local-heuristic hitch after P53–P55. The algorithm is heavier
   *and* it spends the budget on mill-plans and early passes.

This packet is **issue 1 only** (smarter, cheaper search). Issue 2
(non-blocking compute / worker) is a follow-on, parked here as P60.

## What is not the fix

- **A* on the tiling toward findings.** A finding is a first step, not a
  turn. Stride, split, merge-for-speed, and pass-to-keep-a-pair only exist
  as *plans*. Replacing `beam-v1` with pathfinding walks back P53.
- **"Dirt is good again."** Pinwheel / sideways paint stays `closeValue = 0`
  on a quiet board. Staging is a *predicate on remaining path*, not a second
  loot constant.
- **Spawner-gravity in `evaluate`.** Still forbidden (P53/P56/P57).
- **Personalities (P58).** `BotDrive` stays all-1. Do not unpark P58 in this
  run.
- **A wall-clock cutoff inside `chooseTurn`.** P53 invariant 4 stands. Speed
  comes from not expanding off-mission plans and not reply-scoring every
  complete.
- **A worker.** Parked as **P60**. The node cap and the mission filter are
  the answer in this packet.

## What ships

### 1. One mission menu per `chooseTurn` (size ≤ 3)

Search-origin fact, like `campaignTarget`. Recomputed at the start of
`chooseTurnBeam`. Not stored on `GameState`. Deterministic. No clock, no RNG.

```
outbound      := remainingPath(origin, me, V)
V             := campaignTarget(origin, me)          // P57, may be undefined
onTrail       := trailSize(origin, me) > 0
underFire     := onTrail AND exposure(origin, me) > 0
cutAvailable  := collectFindings contains a cut (or attack-on-trail)
                 whose move is legal at origin
boxAvailable  := the P55 constructed-box shape is legal this turn
                 (enemy 1-stack, one open exit, other exits are our territory,
                  we can occupy the open arrow)

missions := []
if underFire:              missions.push(bank)
if cutAvailable:           missions.push(cut)
if missions is empty:      missions.push(contest)     // default quiet job
if boxAvailable
   and missions.length < 3
   and bank not in missions:
                           missions.push(deny)
missions := first 3
if V is undefined and contest in missions:
  drop contest; if missions is empty, missions := [contest] anyway
  (walk any unowned share by P57's fallback — spec-author writes the
   "no V" edge: treat remainingPath as CAMPAIGN_DIST_CAP + 1 and do not
   invent a second target)
```

Priority is **insertion order** above, not a score. `bank` and `contest`
do not co-exist: if we are already cuttable, we bank. `cut` may sit next
to `contest` or `bank`. `deny` never overrides `bank`.

Export `MissionKind = 'bank' | 'cut' | 'contest' | 'deny'` and
`missionsOf(...)` from a new pure module `packages/web/src/botMission.ts`.
`botSearch` imports it. `botClose` / `findings` must not import `botSearch`.
If `findings` needs `remainingPath`, put that helper in `botMission` or
`botClose` — **no new import cycle**.

### 2. Remaining path, kite, staging (predicates)

All grain BFS reuse `grainDistanceToAny` / `homewardPath` / P54 `close_path`.
Do not write a third BFS.

```
KITE_RATIO = 2                          // named export
REPLY_DIST = DEFAULT_REPLY_DIST_CAP     // 12, already named

remainingPath(state, me, V) =
  min grainDist(from, borderArrow of V)
  over from in { own groups } ∪ { own territory arrows }
  cap CAMPAIGN_DIST_CAP
  if V undefined: CAMPAIGN_DIST_CAP + 1

originTerritory := territory arrows owned by me at origin
                    (frozen for the kite test; a terminal that already
                     painted does not get a free 0 returnDist)

kiteLength(terminal, me) =
  if trailSize(terminal, me) > 0:
    max homewardPath(terminal, me, tip).distance
    using originTerritory as "home", not terminal territory
  else:
    0
  (the against-grain return from the far tip onto the *old* border)

projectedTrail(plan) =
  every arrow the plan stepped onto
  ∪ every arrow of the homeward / close_path used for kiteLength
  (deterministic id order)

enemyCanReach(arrows) =
  some enemy group at origin has grainDist(group, some arrow in arrows)
  ≤ REPLY_DIST

isKite(plan) =
  contest ∈ missions
  AND (sharesOf(terminal) > sharesOf(origin)
       OR some own group stands on a border of V)
  AND kiteLength(terminal) >= KITE_RATIO * max(1, outbound)

isThreatenedKite(plan) =
  isKite(plan) AND enemyCanReach(projectedTrail(plan))

isStagingClose(plan) =
  sharesOf(terminal) == sharesOf(origin)
  AND trailSize(terminal, me) == 0
  AND remainingPath(terminal, me, V) < outbound
  AND NOT isThreatenedKite(plan)
  AND planHasStep(plan)

isSidewaysDirt(plan) =
  sharesOf(terminal) == sharesOf(origin)
  AND trailSize(terminal, me) == 0
  AND remainingPath(terminal, me, V) >= outbound
```

P57 dirt-close gate becomes:

```
if isSidewaysDirt(candidate) and exposure == 0:
  closeValue = 0
else if isStagingClose(candidate):
  closeValue = (loot / T) × survival     // loot may be arrows × A
else:
  closeValue = (loot / T) × survival     // P54 unchanged
```

`hitsCampaign` / `advancesCampaign` stay as implementation details of
`remainingPath` if they already match. Do not keep a second sort key that
can fight staging. Do not add `A_staging`. Do not change `SHARE_VALUE_S`
or `ARROW_VALUE_A`.

Under fire (`bank` mission / `exposure > 0` at origin): a 1-turn empty
land-bridge is still the P54 corridor. Staging is not required to fire
for that close to keep a non-zero rate.

### 3. On-mission expansion (the beam filter)

`beam-v1` stays. `BEAM` / `BRANCH` / `MAX_PLAN` / `MAX_APPLIES` opening
bids stay. What changes is **which children enter `next`**.

A step-child is **on-mission** if *any* listed mission accepts it:

| mission | a step is on-mission when |
|---|---|
| **bank** | `close_path` / homeward finding, or it shrinks `distanceToTerritory` / trail size, or it is a 1-turn land-bridge under fire |
| **cut** | `cut` or `attack` finding on an enemy trail |
| **contest** | the exit is on a shortest grain path from that group to a border of `V`, **or** `count` is a merge/split that raises `speed` of a group already on such a path, **or** the child state `isStagingClose` vs origin, **or** the child occupies a border of `V` |
| **deny** | the exit is the boxed enemy's open arrow |

`endTurn` remains a complete candidate for every parent (P53 BSSN 4). It
does not occupy a beam slot. A mid-plan `endTurn` that produces
`isSidewaysDirt` may still be recorded as a complete; it must not win the
return value when an on-mission complete exists (return-time gate, §5).

If `selectBranch` yields **zero** on-mission steps, fall back to today's
unfiltered `selectBranch` for that parent only — otherwise a quiet
opening with a missing findings rank could return `[endTurn]` and freeze.
The fallback is the escape hatch; the happy path is filtered.

Do not call `collectFindings` twice per parent. Cache the origin findings
for mission detection; per-parent findings stay the expansion order.

### 4. Reply-score finalists only

`scoreWithReplies` today runs `worstReachableReply` on every adopted
complete. Change:

```
finalists :=
  for each mission in missions:
    the best complete that serves that mission
    (evaluate desc, then planKey asc)
  if that set is empty: the single best complete

a complete serves bank     iff it shrinks trail or exposure vs origin
a complete serves cut      iff some enemy trail is smaller than at origin
a complete serves contest  iff remainingPath dropped OR sharesOf rose
                             OR isStagingClose
                             AND NOT isThreatenedKite
a complete serves deny     iff the target enemy group's legal exits dropped
```

Only finalists get `worstReachableReply`. Every other complete keeps
`replyScore = evaluate(...)`. `REPLY_TURN_APPLIES` still caps the
finalists as a group. Nested enemy search stays `withReplies: false`.

Do not change `REPLY_BEAM` / `REPLY_BRANCH` / `REPLY_MAX_PLAN` /
`REPLY_MAX_APPLIES` unless the spec-author measures that finalists alone
still blow the hitch — then drop `REPLY_TURN_APPLIES` to 120 and write
that number into the spec. Do not drop `MAX_APPLIES` in this packet; the
filter should drop applies on its own. `pnpm bots` mean-applies is the
check.

### 5. Return-time gates (after P56/P57 swaps)

Order, last write wins among these, after `swapIdle` / `swapSortie` /
`swapCampaign`:

```
chosen := pickReturnedPlan(...)           // existing P56/P57 swaps

if a non-threatened contest-or-staging complete exists
   and isThreatenedKite(chosen):
  chosen := best such complete            // never return the kite

if a staging or contest-advancing complete exists
   and isSidewaysDirt(chosen)
   and bank not in missions:
  chosen := that complete                 // P57 dirt painter, now at return time too

if bank in missions
   and a bank-serving complete exists
   and chosen does not serve bank:
  chosen := that bank complete
```

Ties: `planKey` ascending. No third slack constant. `IDLE_SLACK` /
`SORTIE_SLACK` stay.

`swapCampaign` already prefers a walk over quiet dirt. Keep it. Staging
must be allowed to *beat* a threatened kite even when the kite's raw
`evaluate` includes a share (`heads` / `shares` will make the kite look
better). That compare is this gate, not an `evaluate` edit.

### 6. Spec / CONTEXT / module

- New spec dir `docs/spec/mission-and-staging/` — purpose, BSSN table,
  terms, mermaid, core + edge-cases features, EARS invariants.
- `CONTEXT.md` — **mission**, **bank**, **cut**, **contest**, **deny**,
  **staging close**, **remaining path**, **kite**, **kite length**,
  **threatened kite**, **KITE_RATIO**, **finalist**. Amend `beam-v1` and
  `dirt close`. (This commit already lands those entries; phase 1 only
  edits if a predicate name changes.)
- New module `packages/web/src/botMission.ts` plus tests next to the
  existing bot-*.test.ts files. Wire from `botSearch.ts` and the P57
  dirt gate in `botClose.ts`.
- `pnpm bots` gains optional columns `staging closes / 100` and
  `threatened kites returned / 100` if cheap; not a CI gate.

## Scenario inventory (phase 1 must write each)

Core:

1. Generated opening after the P56 first 0-share home close: missions =
   `[contest]`, first step still leaves home toward `V` (P56+P57 hold).
2. Quiet constructed board: 1-turn 0-share loop that does **not** drop
   `remainingPath` vs a 3-turn walk toward `V` — returned plan is the
   walk, not the loop (P57).
3. Quiet constructed board: 1-turn 0-share loop that **does** drop
   `remainingPath` to `V`, vs a walk that occupies a share of `V` whose
   `kiteLength >= KITE_RATIO * outbound` and an enemy group grain-reaches
   that projected trail — returned plan is the staging close, not the
   kite.
4. Same geography as (3) but **no** enemy within `REPLY_DIST` of the
   projected trail — returned plan may take the share / walk; staging is
   not required.
5. Origin already on open trail, `exposure > 0`: missions start with
   `bank`; a 1-turn land-bridge is allowed again (P54 corridor); contest
   walk is not the return if a bank complete existed.
6. Enemy trail in grain reach, origin not under fire: `cut` is on the
   menu; a legal cut complete beats a sideways dirt complete.
7. P55 constructed box position: `deny` is on the menu when not under
   fire; the plan still occupies the open exit.
8. `chooseTurnBeam` twice on equal inputs → byte-identical plans.
9. P53 stride construction still strides; shuttle rate head-to-head on
   the P53 baseline turn-starts still holds.

Edge:

10. `V` undefined (monopolised every vertex): no crash; do not invent a
    second campaign; sideways dirt stays zero on a quiet board.
11. `selectBranch` filter empty for a parent → unfiltered fallback fires;
    the returned plan is still a legal turn ending in `endTurn`.
12. Threatened kite with **no** staging complete in the beam → return the
    best non-kite contest walk if one exists (stop short / pass), else
    the least-kite complete; never invent a move.
13. Staging close whose own short trail *is* enemy-reachable → not
    staging (`isThreatenedKite`); bank/corridor rules apply if
    `exposure > 0`.
14. Map insertion shuffle of groups / territory / trails does not change
    `missionsOf` or the returned plan.
15. Pages / `pages-heuristic.ts` still imports `chooseMove`, not
    `chooseTurnBeam`.
16. Counted `RulesPort`: applies inside replies, summed over a turn, stay
    ≤ `REPLY_TURN_APPLIES`. Completes that are not finalists do not call
    `foldEnemyReply`.
17. `greedy-v1` output on the P53 baseline positions is unchanged
    (frozen).

## Non-goals

- Worker thread, `planning` vs `playing` HUD, planning the next seat
  during playback, unlocking pan during think. That is **P60**.
- P58 personalities, lobby difficulty, extra `chooseTurn`
  implementations, seat-kind, match-log fields.
- Retuning `evaluate`, `tipTerm`, `closeUrgency`, `MOBILITY_SCALE`,
  `SHARE_VALUE_S`, `ARROW_VALUE_A`, `IDLE_SLACK`, `SORTIE_SLACK`,
  `BEAM`, `BRANCH`, `MAX_PLAN`, `MAX_APPLIES`.
- A* / replacing `beam-v1`.
- Unfreezing `greedy-v1`.
- Lifting Pages onto `chooseTurnBeam` (P53 BSSN 2).
- Editing SPEC.md.
- Multi-vertex campaigns, waypoints, stored plans across turns.
- Teaching `closeValue` a second rate for "risk of a future trail"
  beyond the predicates above.

## Acceptance

- All P53 stride / shuttle / box constructions stay green.
- All P54 rate constructions stay green (2-turn-one-share vs
  6-turn-two-share; both hit shares, staging gate off).
- All P55 reply-budget and box / takeable-stack constructions stay
  green. Invariant "replies do not run for an out-of-range enemy" stays.
- All P56 leave-after-paint constructions stay green.
- All P57 campaign-target / quiet-dirt / under-fire corridor
  constructions stay green, **plus** scenario 3 (threatened kite loses
  to staging).
- Reconstructing heuristic turn-starts from the 09:50 log *after each
  seat's first close*, `chooseTurnBeam` does not return `isSidewaysDirt`
  when a contest-advancing or staging complete existed, and does not
  return `isThreatenedKite` when a staging complete existed.
- `pnpm bots` mean applies / turn is **below** the post-P57 baseline on
  the same seeds (advisory number in the PR body; not a CI gate). If it
  does not drop, the filter is not wired.
- Determinism: same state in, same plan out; no `Date`, no
  `Math.random`, no `performance.now` in `botMission` / `chooseTurn` /
  `evaluate`.
- `pnpm verify` green.

## Module sketch (not normative layout)

```
botMission.ts
  missionsOf(geometry, rules, state, me) -> readonly MissionKind[]
  remainingPath(...)
  kiteLength(...)
  isKite / isThreatenedKite / isStagingClose / isSidewaysDirt
  onMissionStep(...)
  servesMission(complete, mission, origin)

botSearch.ts
  at start: V, missions = missionsOf(...)
  expandBeam: drop off-mission children unless fallback
  adoptComplete: track best-per-mission
  scoreWithReplies: only finalists
  pickReturnedPlan: existing swaps, then §5 gates

botClose.ts
  quiet dirt zero uses isSidewaysDirt, not the old three-boolean
```

Search stays pure. Ties break on `planKey` / `moveKey` / vertex id /
`PlayerId`, never on `Map` insertion.

## Why this and not a worker first

The hitch has two causes. The worker hides both. This packet removes the
cause that also makes **wrong plans**: an unfocused beam that values a
share-kite and a pinwheel the same way it values a staging close. After
this lands, a worker (P60) is "keep the UI alive for the leftover
100–200ms," not "the bot is frozen because it is considering 400 enemy
replies to mill-plans."

## Handoff checklist for the local agent

1. Read this packet, `CONTEXT.md` (new terms), P57 packet, P53 BSSN 4–8,
   P55 reply budgets. Do not start from the code.
2. `/spec-to-ship docs/design/packets/P59-mission-and-staging.md`
3. Escalate only if: a SPEC.md game-rule gap appears (it should not); the
   fallback-when-filter-empty causes a behavioural shift on the P53
   baseline shuttle test; or `botMission` cannot be wired without an
   import cycle. Then stop and write the cycle into the spec as BSSN,
   do not invent a third module "just to compile."
4. Do not open P58 or P60 work in the same PR.
