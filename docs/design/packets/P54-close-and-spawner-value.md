# P54 — Closing and spawner value

**Layer:** `web` adapter only. No `contracts`, `rules-core`, or `online-api`
change. **No game rule is added, changed, or implied.** Nothing is owed to
SPEC §11.

**Depends on P53.** P54 aims a multi-step route at a goal; without P53's turn-plan
search there is nothing to aim.

## Problem

The bot does not close, and when it does it does not close on anything worth
having. On the committed baseline match
([`data/P53-baseline-match-2026-08-31.json`](./data/P53-baseline-match-2026-08-31.json)):
**11 closes across 71 turns and 6 seats, the first at move 56.**

Three distinct faults underneath that number.

**No multi-step close goal.** The only distance-driven finding in
[`findings.ts`](../../../packages/web/src/findings.ts) is `approach_spawner`,
which always points **away** from territory. `close` and `claim_share` are
detected only when the closure completes *on this very step*. So there is a goal
that walks the bot out and none that walks it home.

**The spawner mill.** `collectFindings` explicitly skips any group already
standing on an open share — a guard added because hopping between sibling borders
is a pinwheel mill, not progress. The result is that the bot walks to a spawner
and then has no goal at all, and mills there anyway via other findings. Every one
of those wasted turns is visible in the baseline log. P53 deliberately left this
alone; P54 owns it.

**No answer to close-fast-versus-close-big.** Closing a small loop now and looping
wider for more shares are both correct, in different positions, and nothing in
the bot expresses the trade.

## What ships

### 1. Close value is a rate, discounted by survival

```
value(plan) = (shares × S + arrows × A) / turnsToClose × survival(exposure)
```

`turnsToClose` is the real clock, so a 2-turn close of one share beats a 6-turn
close of two **automatically** — no tuning knob decides it, the arithmetic does.
That is the point: the trade resolves by division, not by a weight someone has to
keep re-balancing.

`survival(exposure)` is where the tension actually lives. Extending the loop one
more turn is correct only while the **marginal** shares-per-turn of extending
exceeds the rate you would bank by closing now, discounted by the chance the trail
is cut in the meantime. That is a marginal-value stopping rule, and it makes the
bot close small and fast under pressure and loop wide when the board is quiet —
which is how SPEC §3's "neither dominates" is supposed to feel.

`S` and `A` are the **only** two tuned constants. Resist adding a third.

**`exposure` in this packet** is a self-contained proxy: open-trail length, plus
grain-distance from each enemy group to the nearest arrow of my trail. **P55
replaces the proxy** with the real thing — the worst enemy reply — and `survival`
is written so that swap is a one-function change, not a re-derivation.

### 2. A multi-step `close_path` goal

Symmetric with `approach_spawner`: grain-distance BFS from a trail tip back to
own territory, ranked by the value above. Under P53's plan search this is a route
the beam can commit several steps to, which is the thing that has never existed.

The existing `closeUrgency` / `distanceToTerritory` machinery in
[`opponent.ts`](../../../packages/web/src/opponent.ts) is the right shape and was
simply never reachable, because `bestFindingMove` short-circuited it. Reuse it;
do not write a second homeward computation.

### 3. Superlinear share value

A share is one of the three arrows bordering a spawner vertex (SPEC §7);
production accrues to whoever holds it as territory. Taking **all three** is not
3× one share — it is a monopoly plus the denial of that spawner to every
opponent. Fold that into `S` as a superlinear term in shares-claimed-by-this-
closure, **not** as a separate "enclose the vertex" case. One rule, one constant.

### 4. The mill guard is replaced, not deleted

A group standing on an open share now has a goal: the closure that *claims* it.
The guard exists because visiting a border is not claiming it — that stays true.
Replace "skip this group" with "this group's goal is the close that banks the
share it is standing on."

## Non-goals

- **Opponent plies.** The real `exposure` — worst enemy reply — is **P55**. P54
  ships the proxy and the seam.
- Re-tuning P53's beam parameters, or `greedy-v1`'s weights.
- Any new absolute threshold in `pnpm bots`, or a CI gate on metric values. The
  head-to-head against `greedy-v1` remains the assertion.
- Adding a third tuned constant beyond `S` and `A`.
- Editing SPEC.md.

## Acceptance

- Closes per 100 turns rises materially against the P53 measurement, and
  `firstCloseAt` falls (baseline: 15 per 100 turns, first at move 56).
- Given a position where a 2-turn close banks one share and a 6-turn close banks
  two, the bot takes the fast one. Given the same shares with the slow close only
  one turn longer, it takes the big one. Both from the same formula, with no
  branch.
- Given a trail with an enemy group two arrows from it and an identical trail with
  no enemy in reach, the bot closes earlier in the first.
- A closure that takes all three shares of one vertex is preferred over three
  closures each taking one share from three vertices, at equal turn cost.
- A group standing on an open share commits to a close that banks it, rather than
  hopping to a sibling border.
- `beam-v1` still beats `greedy-v1` on the head-to-head seed set.
- Determinism holds: same state in, same plan out; no `Date`, no `Math.random`.
- `pnpm verify` green.
