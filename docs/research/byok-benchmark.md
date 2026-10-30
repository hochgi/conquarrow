# BYOK benchmark

Results ledger for [P79](../design/packets/P79-byok-benchmark-harness.md).
The gate, the grid and the scoring rule are defined there and fixed before any
arm runs. This file records what happened.

## Audit — archived grok matches vs the 2026-10-29 failure modes

**Corpus:** the three archived grok-4.6 matches (`archive/requests|responses.*.json`,
2026-09-08 and 2026-09-10), reasoning on, 42 calls in all. All three are
**early game only**: the longest ran 55 steps. They predate P64/P66 in part,
so this audit names failure *classes*. P79's `positions` tier re-checks them
under the current prompt.

**Headline: grok's failures are not the ones the playtest found.** The
playtest's seat B walked outward into weak bands, closed ground with no
spawners on it, and clustered next to a larger stack. None of the three grok
matches shows any of these. They are too short to show the late-game ones at
all, so absence is not evidence either way. Grok fails in two other ways, and
it fails in them repeatedly.

### 1. Interior paralysis: passing with nowhere "useful" to go (5 of 42 calls)

Match 2026-09-10T0657, calls 10–13: four consecutive turns of
`{"moves":[],"endTurn":true}`, with reasons like
*"all rows home mill, empty trail, no expansion"*. Match 2026-09-08, call 15:
the same.

Both of B's stacks sat **inside** B's own 13-arrow territory. Every legal step
was tagged `home_mill,onto_home` with `tipDist=0→0`, so no row could show that
it moved toward the edge. Three things then combine:

- `home_mill` is `fromHome && ontoHome` (`byokBot.ts` `annotateMove`). It fires
  on **every** interior step, including one that walks toward the frontier.
- The teaching says a mill with an empty trail *"is wasted tempo"*.
- `millOmit` suppresses the baseline suggestion when every row is a mill.

So the seat is told every move is waste, is shown no distance that would
contradict that, and is given no suggestion. It passes, and keeps passing for
as long as the stack is interior. That is a **permanent stall from a tag that
says something false**. No P74–P78 packet covered it. → **P80**.

### 2. Border-walk cycle: re-walking its own trail for shares (9 of 12 calls)

Match 2026-09-10T1442, calls 3–11: a 3-stack walks the same three arrows round
and round, `-4,7,1 → -5,8,0 → -4,8,2 → -4,7,1`. `trailLen` stays at 6 and it
never closes. Each row is tagged `borders_spawner`. Its plan reads *"walk
remaining borders of the open pinwheel for shares"*. Meanwhile C goes from 3
territory to 22.

`bordersOpenSpawner(exit)` is true whenever the exit borders a spawner with an
unclaimed arrow. It is true even when **the exit is already on the seat's own
trail**, so re-walking a trail arrow advances nothing. The seat reads the tag
as progress, and nothing in a one-step offer shows a cycle. → **P75**: its
`advances=` clause must not fire on an arrow the seat already holds as trail
or territory. Added as a scenario there. P74's "trail is not territory"
teaching and P76's delta also bear on this.

### What this changes

- **The playtest is a weak proxy for grok.** The packets built from it are
  hypotheses until P79 measures them. That was already the plan; this audit is
  the evidence that it was needed.
- **P80 and P75 have direct evidence. P74 has none yet.** P74's gradient and
  defensive-half material addresses failures grok has not yet been seen
  making. It stays an arm, but it is the one most likely to come back
  inconclusive.
- **Seat behaviour depends on tags far more than on prose.** In 42 calls,
  `why`/`plan` cites an offer tag in 37 (`mill`, `on_target`, `homeward`,
  `outward`, `border`, `leave home`, …). It names `force` in none, even though
  `force` is printed on every spawner row.

## Mirror (heuristic vs heuristic)

_Pending._

## Calibration and cost

_Pending._

## Baseline

_Pending._

## Arms

_None yet._
