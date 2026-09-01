# P56 — Home expedition: stop painting the pinwheel after the first close

**Spec:** edit [`docs/spec/bot-turn-search/`](../../spec/bot-turn-search/bot-turn-search.md)
(First sortie + new scenarios). No new spec directory — this is a return-time
gate on the P53 search, not a new feature.

**Layer:** `web` adapter only. No `contracts`, `rules-core`, or `online-api`
behaviour change. **No game rule is added, changed, or implied.** Nothing is
owed to SPEC §11.

**Depends on P53, P54.** P55's reply search stays on; this packet does not
retune it.

## Problem

Playtest
[`2026-09-01T03:39:31Z`](./data/conquarrow-match-2026-09-01T033931-134Z.json)
(3-seat, `R = 7`, `spawnerSeed = 1`, human C vs heuristic A/B): both AIs
close a tiny loop on the home pinwheel, then mill that pinwheel for the rest
of the watchable game.

Two earlier return-time gates already shipped and both fired on that opening:

- **`IDLE_SLACK`** (P53, evening 2026-08-31) — a pass must beat the best
  stepped complete by more than one `MOBILITY_SCALE`, or the stepped plan
  wins. That forced *a* step. The step they took was a sibling mill
  (3-stack → 2+1 still on own territory).
- **`SORTIE_SLACK`** (same evening) — on a ≤3-arrow home with no trail and
  no threatened departing exit, prefer a complete that *left* unless the
  mill/idle wins by more than one `MOBILITY_SCALE`. That got them off the
  three-arrow home. They walked one arrow out, closed the three-arrow
  loop, and painted.

Then `trackSortie` went false, because `pinnedToSmallHome` is

```
trail empty  AND  ownedTerritory ≤ 3
```

and the close had just painted past 3. Next turn the same pinwheel is a
4-, 5-, 6-arrow home with no trail. `close_path` still sees 1-turn
0-share land-bridges (`loot = arrows × A`, `turnsToClose = 1`).
`evaluate` pays `+25` per own-territory arrow. The mill is now the
highest-scoring complete by ~75–150, which is several times
`SORTIE_SLACK` (16). They circle until a human or a cut interrupts.

The ≤3 predicate was an opening-shaped special case of the thing we
actually mean: **still at home, not yet on an expedition.** Territory
count is not that predicate. A 0-share paint is not an expedition either
— `isSortieTerminal` currently treats *any* territory increase as one,
so the paint both (a) satisfies the sortie swap this turn and (b) disables
tracking next turn.

Aug 31 already forbade the tempting evaluate edits: do not zero `tipTerm`
at urgency 0, do not add a short-trail term, do not add spawner-gravity.
Those broke the constructed 4-stack close and P55's takeable-stack denial.
This packet stays at return time, same as the two slacks.

## What ships

### 1. `trackSortie` drops the territory cap

```
trackSortie :=
  origin.trail is empty
  AND every own group stands on own territory
  AND no legal departing exit is an arrow a hypothesised enemy can
      step onto this turn
```

`ownedTerritory ≤ 3` is deleted. A six-arrow home with every stack still
on it is the same situation as a three-arrow home: the seat has not
started an expedition. The threatened-exit clause stays — that is what
keeps P55 boxing / takeable-stack denial off this path.

### 2. A 0-share home paint is not an expedition

`isSortieTerminal` (rename in code to `isExpeditionTerminal` if the
author wants the word in the identifier; the packet does not require the
rename) becomes:

```
sharesOf(terminal, me) > sharesOf(origin, me)
OR some own group stands off own territory
OR (terminal.trail.size > origin.trail.size
    AND terminal.trail is still non-empty)
```

Territory growth alone is **not** an expedition. A plan that walks one
arrow out and lands, painting the loop and emptying the trail, is a
**home mill close**. A plan that walks out and is still on open trail at
`endTurn`, or that banks a share, or that stands a group off home, is an
expedition.

`bestSortie` therefore only remembers real leaves / share-takes. The
paint can still be `best` on raw `evaluate`; it no longer occupies the
sortie slot that the swap uses.

### 3. Compare mill vs leave with own-territory arrows stripped

`SORTIE_SLACK` stays one `MOBILITY_SCALE`. It was sized for the
mill-vs-leave `tipTerm` gap (~9–14). After a paint, `evaluate`'s
`territory × 25` dwarfs that slack, which is why raising the slack
until the paint loses would just invent a third constant that has to
track `ARROW_VALUE_A` and loop size.

At return time only, when `trackSortie` is set:

```
homeboundScore(complete) =
  completeScore(complete) − ARROW_VALUE_A × territoryOf(complete.state, me)
```

Then the existing swap:

```
if trackSortie
   and chosen is not an expedition terminal
   and an expedition complete exists
   and homeboundScore(chosen) − homeboundScore(bestSortie) ≤ SORTIE_SLACK:
  return bestSortie
```

Stripping own-territory arrow value makes a 0-share paint and a leave
comparable on the terms that actually differ (`tipTerm`, shape, shares,
heads, mobility, reply damage). A suicidal leave still loses by
`heads × 120` and is not swapped in. Do not strip shares, enemy
territory, or mobility. Do not change `evaluate` itself.

`ARROW_VALUE_A` is already the named export in `botClose.ts` (P54).
Import it. Do not write `25` a second time.

### 4. Spec / CONTEXT, not a new module

- Rewrite the **First sortie** section of
  [`bot-turn-search.md`](../../spec/bot-turn-search/bot-turn-search.md)
  and BSSN 7 so the ≤3 cap and the territory-growth sortie clause are
  gone. Invariants 22 and 23 stay; add the post-paint case.
- Add two core scenarios next to *An opening home 3-stack leaves* /
  *After a home-pinwheel mill the bot still leaves*:
  - generated opening, apply one tiny home close so the seat now holds
    **more than 3** territory arrows and has no trail; `chooseTurnBeam`
    still steps onto an arrow that is not that seat's territory.
  - the same position: the returned plan does not terminate having only
    painted more 0-share home arrows (no share gain, no group off home,
    trail empty at the terminal).
- Update `CONTEXT.md` `beam-v1` / `SORTIE_SLACK` and add **home mill
  close** / **expedition**.
- `greedy-v1` stays frozen. Pages still calls `chooseMove`.

## Non-goals

- Retuning `evaluate`, `tipTerm`, `closeUrgency`, `MOBILITY_SCALE`,
  `SHARE_VALUE_S`, `ARROW_VALUE_A`, or any beam / reply budget.
- A short-trail term, a "don't close small" term, or spawner-gravity.
- Changing `close_path` / `closeValue` so 0-share land-bridges score
  zero. Those closes are correct *on an expedition* (P54's corridor).
  The discriminant is "are we still at home?", which is a search-origin
  fact, not a findings fact.
- Teaching the bot which distant spawner to walk toward. `approach_spawner`
  already ranks departing exits; this packet only stops the paint from
  beating that rank at return time.
- Lifting Pages onto `chooseTurnBeam` (still P53 BSSN 2).
- Editing SPEC.md.
- A new slack constant.

## Acceptance

- On the generated opening, a home 3-stack still leaves (existing
  invariant 23). The ≤3 path must not regress.
- After that seat's first 0-share home close — territory now **> 3**,
  trail empty, groups on home — `chooseTurnBeam` includes a step onto an
  arrow that is not that seat's territory.
- That same plan is an expedition terminal: open trail, or a group off
  home, or a share gained. A second 0-share pinwheel paint is not
  acceptable as the return value when an expedition complete existed
  inside the beam.
- On the committed 2026-09-01 3-seat log, reconstructing each heuristic
  seat's turn-start *after* that seat's first close, `chooseTurnBeam`
  leaves rather than milling the painted home. Commit the log next to
  the P53 baseline as
  `docs/design/packets/data/conquarrow-match-2026-09-01T033931-134Z.json`
  if it is not already there; the test may also construct the post-close
  position from the generated opening if the log is too heavy to replay
  in CI — either is fine, both is better.
- A threatened departing exit still disables the swap (P55 box /
  takeable-stack constructions stay green).
- A constructed 4-stack homeward close still strides (P53). A 2-turn
  one-share close still beats a 6-turn two-share close on a quiet board
  (P54). `beam-v1` still beats `greedy-v1` on shuttle rate and `count>1`
  share on the P53 baseline turn-starts.
- Determinism holds: same state in, same plan out; no `Date`, no
  `Math.random`. `pnpm verify` green.

## Why this and not a closeValue edit

P54's rate is doing what it was asked: a 1-turn close of three empty
arrows is `75` loot, and that beats sitting. The bug is not the rate.
The bug is that the search treats "bank three home tiles" as the
expedition it was trying to start. Findings should keep offering those
closes — they are legal, and on an already-open trail they are the
land-bridge P54 wants. Only the origin-at-home return-time swap is
allowed to prefer the leave.
