# P53 — Bot turn search: the heuristic AI learns to stride

**Layer:** `web` adapter only. No `contracts`, `rules-core`, or `online-api`
change. **No game rule is added, changed, or implied** — every behaviour this
packet teaches the bot is already stated in SPEC §3 and §6.2. Nothing is owed to
SPEC §11.

## Problem

The heuristic bot cannot perceive SPEC §3. Two symptoms, one cause.

### Symptom 1 — the shuttle

Given a 2-stack, the bot splits it and walks one head onto the next arrow, then
walks the other head onto the same arrow to re-merge. Two steps spent, **one**
arrow gained, where striding the pair (`speed(2) = 2`) would have gained two.

Measured on a real 6-seat match — committed at
[`data/P53-baseline-match-2026-08-31.json`](./data/P53-baseline-match-2026-08-31.json):

| metric | baseline |
|---|---|
| steps | 207 (184 at `count=1`, 23 at `count=2`) |
| turns | 71 |
| turns containing a shuttle (two `count=1` steps sharing `from` **and** `exit`) | **34 of 71** |
| wasted steps to shuttling | 36 |
| steps per turn | 3, in 65 of 71 turns |
| closes | 11 (`firstCloseAt` move 56) |

The "3 steps per turn, forever" row is the tell. Six seats, ~3 heads each, three
steps a turn, the whole match: **no seat's allowance ever exceeded its head
count.** The `speed` curve was never used once. Exactly one seat ever moved a
`count=2` group, and that seat strided correctly — so the machinery is not
broken, nothing simply ever *values* holding a pair together.

### Symptom 2 — it does not close

11 closes across 71 turns and 6 seats, the first at move 56. The bot lays long
trails and wanders instead of returning to claim.

### The one cause

Both are **within-turn sequencing errors, not evaluation errors.** Striding only
beats shuttling after two of the bot's *own* plies. A close four arrows away
scores as zero progress on every single step in between. A per-step greedy
chooser is structurally blind to both no matter how the weights are tuned.

Two structural facts in the code make it concrete:

1. [`opponent.ts` `chooseMove`](../../../packages/web/src/opponent.ts) calls
   `bestFindingMove` **first** and returns it whole if legal. Only if no finding
   fires does the `evaluate` + `scoreStepExtras` machinery run — and that is
   where *all* the pair bias, close-urgency and homeward-distance logic lives.
   `approach_spawner` fires nearly always, so that machinery is close to dead
   code in practice.
2. Inside `collectFindings`' approach branch the step is picked by `d1` then
   `moveKey` ([`findings.ts`](../../../packages/web/src/findings.ts)). `moveKey`
   is `step:from>exit:count`, so `"…:1" < "…:2"` lexically — **ties break toward
   `count=1`**. Then `pickPortion(heads, best.move.count)` sees `preferred = 1 ≤
   heads` and keeps it. Nothing in the findings layer ever consults `speed(N)`.

## What ships

### 1. A `chooseTurn` seam — one function signature, two implementations

```ts
export type ChooseTurn = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
) => readonly Move[];   // a full turn, terminated by endTurn()
```

- `greedy-v1` — today's `chooseMove` loop, moved behind the signature and
  **frozen**. It is the baseline the head-to-head test measures against. Do not
  tune it in this packet.
- `beam-v1` — the new search. `playBotTurn` calls this one.

**BSSN, deliberately.** No registry, no port in `contracts`, no seat-kind change,
no lobby UI, no match-log format change. Difficulty tiers are a possible future
we are not blocking, not a thing we are building. If tiers ever ship, the seam is
a one-line lookup away.

### 2. `beam-v1` — beam search over turn plans

The unit of search is a **whole turn**: a sequence of steps ending in `endTurn`.

```
seed  := [ empty plan at `state` ]
repeat until no plan can extend, or plan length hits MAX_PLAN:
  for each plan in the beam:
    order its legal steps by the findings heuristic (§3 below)
    extend by the top BRANCH steps, plus the endTurn terminal
  score every resulting plan's terminal state with `evaluate`
  keep the best BEAM plans (ties on the plan's stable move-key sequence)
return the best terminal plan
```

- **`endTurn` becomes a searched decision**, not the forced fallback it is today.
  Ending a turn early to preserve a merge for full speed next turn is now a plan
  the search can pick. The current hard rule "never pass while a step is legal"
  (`opponent.ts`, from the idle-turn autopsy) is **deleted** — it existed only
  because close-urgency was making every extension look worse than `endTurn`, and
  plan-level scoring removes that failure mode at the root.
- **Stride falls out.** No stride-specific rule is written. The plan that steps a
  2-stack twice simply reaches further and scores higher than the plan that
  shuttles. This is the whole reason for searching plans rather than steps.
- **Determinism is non-negotiable.** Ties break on the plan's move-key sequence,
  never on insertion or `Map` order. No `Date`, no `Math.random`, no elapsed-time
  cutoff — a time-based budget would break replay.

**Budget.** `BEAM`, `BRANCH`, `MAX_PLAN` are the play-quality knobs; a hard
`MAX_APPLIES` node cap is the backstop that guarantees the UI never janks.
On exhaustion, return the best plan found so far — the cutoff must land on the
stable ordering so the same position always yields the same plan. Start at
`BEAM = 8`, `BRANCH = 6`, `MAX_PLAN = 8`, `MAX_APPLIES = 2000` and let
playtesting move them; these are opening bids, not measured values.

### 3. `findings.ts` is demoted to move ordering

It stops deciding and starts prioritising: `bestFindingMove` / `collectFindings`
rank which steps the beam expands first. Beam search lives or dies on move
ordering, and `findings.ts` is already a tuned, deterministic, well-tested
"which steps look promising" function wearing the wrong hat. This keeps the
P21/P23 intercept work alive rather than throwing it away.

Consequence worth stating: the `approach_spawner` mill bug — a group already
standing on an open share is skipped, so the bot arrives at a spawner and mills
there forever — stops mattering. Ordering that is merely *wrong* now costs search
quality, not correctness. **Do not fix it here**; P54 owns spawner value.

### 4. A symmetric mobility term in `evaluate`

For each group, count its legal exits (0–3 out-arrows, less those barred by
territory-illegality per P28 and by §6.2's lone-head-cannot-attack). Sum over
**all** groups, sign by ownership, scaled by group size.

```
mobility  := Σ_groups  sign(owner) × size × legalExits(group)
```

Symmetric is *simpler* than an enemy-only rule — no ownership branch, no special
case for zero — and it is the honest statement, since the same trap works against
the bot. Size scaling is what makes boxing a 3-stack read as the 6-head swing it
is.

**Why this term is here and not in P55.** It is 15 lines in `evaluate`, testable
with no opponent search, and it is the gradient that lets a bounded search *build*
a **box** (see `CONTEXT.md`) rather than stumble into one. A bare
"reward zero exits" bonus would be a cliff the search can only hit by accident;
graded pressure is a slope it can climb. Landing it now means P54 and P55 both
build on an evaluator that already understands boxing.

The payoff a box eventually yields — closing around the immobile group and
converting it intact ([SPEC.md §6.3](../../../SPEC.md)) — is several turns beyond
any affordable search depth. That is precisely why immobility must be worth
something *in itself*.

### 5. `pnpm bots` — the measuring stick

A report command, advisory, in the spirit of `pnpm crap`. Runs N seeded
bot-vs-bot matches per implementation and prints a metric table:

- shuttle rate (fraction of turns containing two `count=1` steps sharing `from`
  and `exit`)
- share of steps with `count > 1`
- steps per turn
- closes per 100 turns, and `firstCloseAt`
- shares held at turn 50
- mean `rules.apply` calls per bot turn (the budget check)

**One committed test** asserts `beam-v1` beats `greedy-v1` on shares-at-turn-50
and closes-per-100-turns over a fixed seed set. Relative, not absolute: it stays
valid when `beam-v1` is superseded — re-point it at the new pair.

**No absolute thresholds and no CI gate on metric values.** The algorithm will
change, and a future "easy" tier would legitimately fail an absolute bar. The
head-to-head plus the existing replay fixtures already fail loudly on real
regressions.

## Non-goals

- **Opponent plies.** One-ply enemy reply, exposure, and preventative play are
  **P55**. `beam-v1` searches only the bot's own turn.
- **Close valuation.** Rate-with-survival-discount, multi-step close paths, and
  superlinear share value are **P54**. Symptom 2 is expected to improve here as a
  side effect of plan-level scoring, and expected *not* to be solved.
- Fixing `approach_spawner`'s mill (P54).
- Any strategy registry, lobby difficulty picker, seat-kind change, or match-log
  format change.
- Moving search off-thread into a worker. The node cap is the answer until
  playtesting proves it has to be low enough to hurt play strength.
- Editing SPEC.md. Nothing here is a game-rule gap.
- Touching `greedy-v1`'s weights.

## Acceptance

- A fresh 2-stack with a two-arrow run available strides it: one `count=2` step,
  then a second `count=2` step. It does **not** emit two `count=1` steps sharing
  a `from` and `exit`.
- A 4-stack (speed 3) with a clear run ahead moves three arrows in one turn.
- On the committed baseline position set, `beam-v1`'s shuttle rate is below
  **10%** of turns (baseline: 48%).
- `beam-v1` uses `count > 1` on a materially larger share of steps than
  `greedy-v1` (baseline: 11%).
- The head-to-head test passes: `beam-v1` > `greedy-v1` on shares-at-turn-50 and
  closes-per-100-turns across the fixed seed set.
- Splitting is still chosen when it is right: given a position where two separate
  destinations are each worth more than one deeper advance, the bot splits.
  Striding is not a rule, it is an outcome — SPEC §3 is explicit that splitting
  always wins on raw throughput.
- Given an enemy single head whose three exits are (a) one open arrow and (b,c)
  the bot's territory, the bot's chosen plan puts a head on the open arrow when
  it can. A lone blocker suffices — §6.2 stay-behind means a single enemy head
  cannot attack it.
- `endTurn` is chosen with steps still legal in at least one constructed
  position where passing is correct.
- Same state in, same plan out, every time. Two runs on the same position produce
  byte-identical move sequences; shuffling `Map` insertion order does not change
  the plan.
- The node cap is never exceeded, and hitting it yields a valid, deterministic
  plan.
- `pnpm verify` green. No `Date` / `Math.random` anywhere in the new code.
