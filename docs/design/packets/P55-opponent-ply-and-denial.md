# P55 — Opponent ply and denial

**Spec:** [`docs/spec/opponent-ply-and-denial/`](../../spec/opponent-ply-and-denial/opponent-ply-and-denial.md).

**Layer:** `web` adapter only. No `contracts`, `rules-core`, or `online-api`
change. **No game rule is added, changed, or implied.** Nothing is owed to
SPEC §11.

**Depends on P53 and P54.**

## Problem

The bot never plays preventatively. It does not plant a firebreak ahead of a cut,
does not block the arrow an enemy needs, does not deny a spawner border, and
cannot set the **box** — the trap where an enemy group is left with no legal exit
at all and is then closed around and converted intact.

The tempting fix is to enumerate those cases as evaluator terms. That is a losing
game: firebreaks, blocking, spawner denial and boxing are four views of **one**
thing — *the enemy's best reply got worse* — and any enumeration will miss the
cases nobody thought of. One opponent ply gets all four, plus the unlisted ones.

## What ships

### 1. One enemy reply, worst-case across enemies that can reach me

After scoring a candidate plan's terminal state, let one enemy take its best turn
against that position and score the result; take the **minimum** across enemies.

**Whose reply.** Not "the next seat in rotation" — in a 6-seat game the seat
threatening your trail is usually not the seat that moves next, and a firebreak
planted against seat C is worthless if only seat B was ever modelled. Take the
worst single reply **across all enemy seats**, restricted to enemies with a group
within grain-reach of anything of mine. That filter makes the cost near-zero in
the opening and one or two seats in practice.

**Not max-n, not paranoid-over-all-seats.** Modelling five opponents in a
free-for-all costs 5× the search for a *worse* assumption than "some enemy does
something." This is deliberately one ply and deliberately not a minimax tree.

The enemy's reply search is P53's `beam-v1` with a much smaller budget — reuse it,
do not write a second searcher. Budget it separately and cap it hard; this is the
term most likely to blow the node cap.

### 2. `exposure` becomes real

P54 ships `survival(exposure)` against a distance proxy. Replace the proxy with
the worst reply's actual damage to my trail. P54 was written so this is a
one-function swap.

### 3. What denial we still encode: nothing new

The symmetric size-scaled mobility term already landed in **P53**, and it is the
gradient that lets the search build a box within budget. P55 adds no further
denial terms. If playtesting shows a specific denial the search still cannot find,
that is a new packet with evidence attached — not a term added on suspicion.

## The box, stated once

Three rules compose into it, and none of them is new:

- SPEC §6.2 stay-behind: an attack may not empty the source arrow, so **a lone
  head cannot attack**. A single blocker is untouchable by a single enemy head.
- P28 / SPEC §11: stepping onto enemy territory without an anchored trail is
  **illegal** — `apply` throws. The head does not move and does **not** convert
  itself.
- SPEC §6.3: closing around an immobile group converts it **intact** — a boxed
  3-stack becomes your 3-stack.

So: an enemy single head adjacent to your trail with one open exit and two exits
into your territory can be boxed by splitting a 2-stack, parking one head on the
open arrow, and walking the other around it to close. The bot should find this,
and after P53's mobility term plus P55's reply search it has both the gradient and
the confirmation (the reply search returns zero legal moves for that group).

## Non-goals

- Max-n, paranoid multi-seat search, or any tree deeper than one enemy ply.
- Enumerated denial terms — firebreak detectors, spawner-blocking detectors,
  trap detectors. The whole argument for this packet is that they are the wrong
  shape.
- Modelling the enemy's *economy* (spawner accrual during their turn).
- Moving search off-thread. If one ply blows the budget, the answer in this
  packet is a tighter reply budget; a worker is a separate, justified packet.
- Editing SPEC.md.

## Acceptance

- Given an enemy group two arrows from the bot's open trail versus an otherwise
  identical quiet board, `replyScore` on the threatened terminal is no greater
  than on the quiet board — with no firebreak-specific code in the evaluator.
- Given an enemy single head with one open exit and two exits into the bot's
  territory, and a bot 2-stack in range, the bot splits and blocks the open exit.
- After that block, the reply search reports zero legal moves for the boxed group,
  and the bot's subsequent turns move toward closing around it.
- The bot declines a plan that leaves a stack takeable when an equally-scoring
  safe plan exists.
- Self-mobility is respected: the bot does not walk a group into a position with
  one exit when an equal-value two-exit position is available.
- `beam-v1` still beats `greedy-v1` on the head-to-head seed set, by a wider
  margin than after P54.
- Mean `rules.apply` calls per bot turn stays inside the node cap with the reply
  search enabled.
- Determinism holds: same state in, same plan out. Ties in the reply search break
  on the stable move-key ordering. No `Date`, no `Math.random`.
- `pnpm verify` green.
