# P65 — Quiet-home leftover: pass is not a contest

**Local agent handoff:** `/spec-to-ship docs/design/packets/P65-quiet-home-pass.md`

Phase 1 **amends**
[`docs/spec/mission-and-staging/`](../../spec/mission-and-staging/)
(BSSN 20 idle-as-dirt + one core scenario). Do not open a new spec
directory. Do not burst `bot-turn-search` or `close-and-spawner-value`.
Do not touch BYOK files, prompts, temperature, or plan-memory.

**Layer:** `web` adapter only (`botSearch.ts` return-time gate). No
`contracts`, `rules-core`, or `online-api` behaviour change. **No game
rule is added, changed, or implied.** Nothing is owed to SPEC §11.

**Depends on P59** (which depends on P53–P57). `greedy-v1` stays frozen.
Pages still calls `chooseMove`. P58 personalities and P60 worker stay
parked.

## Problem

Playtest `2026-09-08T18:00:34Z` (3-seat, `R=7`, `homeOffset=5`,
`dominationN=5`, `spawnerSeed=1`, A heuristic / B grok-4.6 BYOK / C
human):

| seat | what happened |
|---|---|
| A r1 | sortie from `5,0,0` (split 2+1, walk the pair to `6,-1,1`) |
| A r2 | close `6,-1,1 → 5,0,0 ×2`. `summary.firstCloseAt = 11` |
| A r3, r4, r5 | **empty `endTurn`**. Three consecutive passes |
| A r6 | wakes: leftover `6,0,1 → 5,1,1` and the stack `5,0,0 → 6,0,1 → 5,1,1` |

Through B r1–r6 the leftover singleton is still on `6,0,1` with
`spent=0`, `speed=1`. Pass is not “no legal step.” C in those rounds
goes 3→25 territory / 3→18 shares. 0 cuts in the match.

This is the 2026-09-02 **6-seat quiet-board freeze** (bots stay
home-ring, wake when the human enters their sector), not the P56 mill
and not the P57 dirt-painter. `IDLE_SLACK` / `SORTIE_SLACK` already
shipped and do not stop it: after the first close the seat still has
a pair and leftover speed, but sitting scores higher than walking.

Reproduced without BYOK: 3-seat seed 1, A=`chooseTurnBeam`, B=
`chooseTurnBeam`, C=`chooseMove` peel. After A r2 close + B r2 + C r2,
`chooseTurnBeam` for A returns `[endTurn]`.

## Exact predicate (current main)

At A r3 of that reconstruction:

- `missions = [contest]`, `V = tiling:v:4,1,down`, `outbound = 1`
- `trackSortie` is **true** (empty trail, groups on own territory, no
  threatened departing exit)
- leftover `6,0,1` h=1 spent=0 and home `5,0,0` h=2 spent=0
- on-mission departing steps exist (`6,0,1 → 5,1,1`, and the split
  `5,0,0 → 6,0,0 ×1`)
- `evaluate(pass) = -522`
- `evaluate(leftover toward V) = -674` (singleton on trail: shape −90)
- `evaluate(2-stack leave ×2) = -536`

`swapIdle` / `swapSortie` keep `[endTurn]` because the walk loses by
more than `IDLE_SLACK` / `SORTIE_SLACK` (16). Then P59
`gateSidewaysDirt` (BSSN 20):

```
if chosen is [endTurn] and a contest-advancing complete exists:
  if players >= 6: return the walk
  if evaluate(walk) <= evaluate(idle): return idle   // 2–3 seat
```

3-seat seed 1 hits the second arm. The 6-seat `afterFirstHomeMillClose`
tests stay green because they take the first arm. P53
`passWithManySteps` / `passIsBest` are all 1-stacks whose one-step
terminals are 147 worse than passing — they *should* still pass.

## What is not the fix

- **Forcing a random legal move.** The walk must still serve contest
  (remaining path to `V` drops, or a share, or staging).
- **Re-enabling home-mill / empty-trail `onto_home` as activity.**
- **Retuning `evaluate`, `tipTerm`, `closeUrgency`, `MOBILITY_SCALE`,
  `IDLE_SLACK`, `SORTIE_SLACK`, beam / reply budgets.** Aug 31 already
  forbade the evaluate edits.
- **A round clock / “first N rounds.”** Search-origin facts stay
  clockless. The distinguisher is structural: a 2⁺ stack with leftover
  speed (the opening pair after the first close), not a turn index.
- **BYOK / prompt / temperature / plan-memory.** Not this session.
- **Unparking P58 / P60.** Pages stays on `chooseMove`.

## What ships

Amend P59 BSSN 20 idle-as-dirt:

```
if chosen is [endTurn] and a contest-advancing complete exists:
  if players >= 6:                         return the walk
  if some own group has heads >= 2
     and spent < speed(heads):             return the walk
  if evaluate(walk) <= evaluate(idle):     return idle
  return the walk
```

`hasLumpReady` lives next to `gateSidewaysDirt` in `botSearch.ts`.
No third slack constant. `servesContest` / `onMissionStep` unchanged.

## Scenario inventory

1. **Core (this packet):** 3-seat seed 1 A r3 reconstruction above.
   `chooseTurnBeam` returns a legal terminating plan that contains a
   step, departs own territory, and is not a 0-share home mill.
2. P53 `passWithManySteps` / `passIsBest` still return `[endTurn]`.
3. P56 6-seat `afterFirstHomeMillClose` still leaves.
4. P59 staging / threatened-kite / deny / bank scenarios stay green.
5. `chooseTurnBeam` twice on the A r3 state → byte-identical plans.

## Non-goals

Worker (P60), personalities (P58), Pages lift onto `chooseTurnBeam`,
unfreezing `greedy-v1`, SPEC.md, a new `Move` kind, MCP.
