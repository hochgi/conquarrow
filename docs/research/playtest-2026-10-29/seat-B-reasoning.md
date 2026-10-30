# Seat B reasoning log — playtest 2026-10-29

Match on games.hochgi.com/conquarrow (deployed build, tab the user opened). A = heuristic AI (gold, top),
B = Claude (blue, bottom right), C = user (orange, left).

How I read the board: screenshots + zoom, hover tooltips on spawners, and — because I cannot trace
thin arrow outlines by eye at this zoom — the `data-arrow` ids on the SVG tiles plus a geometry-only
script (`geo.proto.test.ts`, `outs.proto.test.ts`: `outArrows`, `flankVertices`, `borderArrows`).
That is the information a human gets by tracing arrows with their eyes. No rules engine, no legal-move
offer, no tags.

---

## Turn 1 (B's first turn; A had already moved: 4 moves logged)

**Board as read.**
- Me: 3 heads stacked on `-4,5,1`; home = 3 arrows (`-4,5,1`, `-5,5,0`, `-5,6,2`) around vertex
  `-5,5,up`. Tooltip on that spawner: force 1/12, 3/3 mine.
- Every home arrow also flanks one *outer* vertex. Each outer vertex: I hold 1/3; the other two
  borders are unowned. Tooltip on one of them: force 1/12, 1/3 Player B.
- A (gold) is far north and has walked a 2-arrow trail out of home. C (orange) is far west, unmoved.
  Nobody can reach me for several turns.

**What matters.** Production comes only from shares held as territory. Holding 3/3 on a spawner is
what makes heads ("one head every 12 rounds if you hold all three"). The cheapest new 3/3: an outer
pinwheel whose two missing borders form a 2-arrow loop from home and back.

**Candidates** (geometry search for home → out → home loops, ≤ 3 arrows):
1. `-4,5,1 > -5,6,0 > -4,6,2 > -4,5,1`: two arrows, both missing borders of `-5,5,down`. Starts at
   the stack's own arrow. **3 steps total (2 out + 1 landing).**
2. `-5,6,2 > -5,5,1 > -6,6,0 > -5,6,2`: the same shape for `-6,5,down`, but it starts from a different
   home arrow (one extra step to get there).
3. `-5,5,0 > -4,5,2 > -4,4,1 > -5,5,0`: the same for `-5,4,down`, likewise one step away.
4. Longer 3-arrow loops: they take fewer shares per arrow walked.

**Tempo.** speed(3) = 2, so the whole lump walks 2. speed(2) = 2 and speed(1) = 1. The lump of 3 gains
nothing over a pair, so split 2 + 1.

**Choice.**
- Pair: `-5,6,0 → -4,6,2` (both missing borders of `-5,5,down`). It ends one step from home, so
  next turn it lands on `-4,5,1` and closes, for 3/3 on a second spawner.
- Single: step onto home arrow `-5,6,2` (inside territory, so it adds no exposure). That stages the
  same pinwheel loop for `-6,5,down` (candidate 2).

**Risk.** The open trail is 2 arrows long, and no enemy head is within reach for many steps, so a cut
is impossible this round.

**Expect.** Next turn: the pair closes (Land 3 → 5, plus 2 shares on `-5,5,down`, making it 3/3, and
the shares on `-5,6,up` / `-4,5,up` that those arrows flank). The single starts the `-6,5,down` loop.

**UI friction.**
- At default zoom I could not tell the arrow grain from the picture. The rays and the gold outline
  help, but which tiles *border which spawner* is not readable by eye.
- The spawner tooltip says "1/3 Player B" but not *which* arrows are the missing shares.

**What actually happened.**
- I drafted `-5,6,0 → -4,6,2`, lowered the count to 2 ("1 stays"), and sent.
- The app applied it as two steps: all 3 heads onto `-5,6,0`, then 2 of them onto `-4,6,2`. So
  the count applied only to the last leg, and the single was left on `-5,6,0` as a sentry on my own
  trail, already spent.
- With nothing left able to step, the turn passed on its own (moves logged 4 → 7).
- Result: pair on `-4,6,2`, single on `-5,6,0`, trail = those two arrows. The close is still on for
  next turn. I lost the single's staging step onto `-5,6,2`.

**Lesson / friction.**
- "Route first, count second" means the count picks how many heads *finish* the route. It does not
  say how many *leave*. To split before walking, I would have to draft a 1-arrow route with count 1
  first, and only then draft the pair's route.
- The strip's "1 stays" reads like "stays home". It actually meant "stays at the start of the last
  leg".
- The BYOK offer has the same trap: "On a split, both parts inherit spent".

---

## Turn 2 (moves logged 13)

**Board as read.**
- Me: territory `-5,5,0`, `-5,6,2`, `-4,5,1` (3 arrows round spawner `-5,5,up`, which is 3/3 mine).
  Open trail `-5,6,0` (1 head, the stranded sentry) and `-4,6,2` (2 heads, the live front).
  Heads 3, Land 3.
- A (gold, north): now 5 solid arrows and no open trail — it closed its loop. Heads 2 + 1.
- C (orange, west): 3 solid arrows, open trail `0,-5,1` + `-1,-4,1`, heads 1 (home) + 2 (out).
  C split 1/2 — it kept a head home and walked a pair, which is what I failed to do last turn.
- Distance from my trail to the nearest enemy head: roughly 16 tiles. With speed(2) = 2 tiles a turn,
  nobody can reach my trail for many turns. A cut is not a live threat this turn.

**The choice: close now, or walk two more and close next turn?**

Geometry (verified, not eyeballed). `-5,5,down` borders `-5,6,0`, `-4,6,2`, `-4,5,1` — all three are
already mine or trail, so landing on `-4,5,1` right now closes and makes it 3/3.

But from `-4,6,2` the grain also offers `-4,5,2`, and from there `-4,4,1`, and from there `-5,5,0`,
which is home. And `-5,4,down` borders `-5,5,0`, `-4,5,2`, `-4,4,1`. So the longer loop claims a
*second* new spawner on the same closure.

- **Close now:** turn 2 closes → 2 spawners at 3/3. The third would then need its own loop:
  2 steps on turn 3, 1 step on turn 4 → 3 spawners at the end of turn 4.
- **Extend:** turn 2 walks 2 (speed(2) = 2), turn 3 lands → 3 spawners at the end of turn 3.

Extending is a full turn faster to the same place, and the only thing it costs is one more round with
an open trail that nothing can reach. The accrual I give up by delaying the second spawner by one
round is 1/12 of a head.

**Choice.** Walk the pair `-4,6,2 → -4,5,2 → -4,4,1`. Leave the single on `-5,6,0` — its only exits
are `-4,6,0`, `-4,6,1`, `-4,6,2`, none of which is home, so it cannot stage anything useful, and
branching off it would cost an anchor for no gain. It stays as a sentry. End the turn by hand.

**Expect.** Trail becomes 4 arrows, front on `-4,4,1`, one step from home. Next turn: land on
`-5,5,0`, Land 3 → 7, spawners 1 → 3.

**Watch for.** Whether the count strip again applies to the last leg only — this time both heads walk
the whole route, so 2/2 should mean exactly that.

**What actually happened — a click I meant as "select" was taken as a move.**
- I clicked `-4,6,2` intending to *select* the 2-head stack there. But the app had already auto-selected
  the lone sentry on `-5,6,0`, and `-4,6,2` is that head's only legal destination. Per the help text,
  "a click with one legal count and nowhere further to go applies at once" — so it applied: the
  sentry walked and merged into the pair. Moves logged 13 → 14. No confirmation, no undo.
- So I was looking at a 3-stack, not the pair I planned around. The merged head had already spent its
  step, and the stack had 1 step left instead of 2 ("This run can go no further" after one click).
- I re-checked the plan rather than the move: speed(3) = 2 as well, so the front now walks
  `-4,5,2` this turn and `-4,4,1` + `-5,5,0` next turn. Same close on turn 3, same 3 spawners.
  The merge cost nothing here. It would have cost a turn if the stack had landed on 4 heads, or if
  I had needed the sentry where it stood.
- I verified the drafted leg before sending by reading the tile's stroke in the DOM
  (`stroke:#b8e4ff, stroke-width:3` on `-4,5,2`) rather than trusting the picture, because at this
  zoom the drafted chord and the selected-stack halo look alike.
- Sent 3/3. Trail is now `-5,6,0` + `-4,6,2` + `-4,5,2`, front one step from `-4,4,1`.
  The turn passed on its own again (moves 14 → 16).

**Friction worth recording.**
- **Auto-select plus auto-apply makes a selecting click dangerous.** The two features are each
  reasonable; together they mean there is no safe way to say "I want to look at that other stack".
  A human loses a move to this exactly once and then learns to click Next stack instead. A BYOK seat
  never sees this, because it names an offer index — which is a point in favour of the prompt being
  the thing to fix, not the model.
- The drafted route is not readable from the rendering at default zoom; I had to read the DOM twice
  now to be sure which tile I had drafted.

---

## Turn 3 (moves logged 24) — the close

**Board as read.**
- Me: territory `-5,5,0`, `-5,6,2`, `-4,5,1`; trail `-5,6,0`, `-4,6,2`, `-4,5,2`; 3 heads on the
  trail tip `-4,5,2`. Heads 3, Land 3.
- C (orange): grew to 4 territory + a 4-arrow trail, heads 2 and 1, pushing roughly east — its
  nearest head is about 13 tiles from my trail.
- A (gold): 5 territory, opened a new 1-arrow trail eastward, heads 1 and 2, about 15 tiles away.
- Neither can reach my trail this turn, so the close is uncontested.

**Move.** `-4,5,2 → -4,4,1 → -5,5,0`. speed(3) = 2, which is exactly the two steps needed, and
`-5,5,0` is my own territory, so the second step closes.

**What it claims.** Trail arrows become territory, so my territory becomes `-5,5,0`, `-5,6,2`,
`-4,5,1`, `-5,6,0`, `-4,6,2`, `-4,5,2`, `-4,4,1`. Checking every vertex those touch:
`-5,5,up` 3/3 (held), `-5,5,down` 3/3 (new), `-5,4,down` 3/3 (new). Three spawners at full force,
up from one. Land 3 → 7.

**All three heads walk.** A sentry on `-4,5,2` would protect a trail that is about to stop existing,
and nothing is near enough to cut. Landing the full stack also keeps speed 2 for the next loop.

**Expect.** Land 7, three spawners at 3/3, no open trail, 3 heads on `-5,5,0`. Next job: the loop
for `-4,5,up` (`-4,5,0` + `-3,5,1`) or `-5,4,up` (`-5,5,2` + `-5,4,0`), both two arrows from home.

**On reading the board.** I take current state from the page's own tile ids rather than from the
match log: the log is move history and would need replaying to tell me where things are now, while
the ids give me the position in one read. The log gets downloaded at the end, for the replay that
the prompt comparison needs.

**Result — as predicted.**
- Both legs drafted cleanly this time (I checked both tiles carried the drafted stroke before
  sending, rather than reading the picture). Sent 3/3.
- Closure landed. All seven arrows are now solid territory, no open trail, 3 heads on `-5,5,0`.
- Verified by hovering `-5,4,down`: "3/3 Player B", and one share already shows "1/12 of a head
  banked". `-5,5,down` is 3/3 by construction (all three of its borders are in my territory list).
- So: 1 spawner → 3, Land 3 → 7, in three turns, with no fighting and no exposure.

**Note on the close.** This was a land bridge in the SPEC's sense — the loop enclosed nothing, so the
path itself became thin territory. That was the whole point: the value was never the enclosed ground,
it was the six arrows *becoming* shares. A seat that scores `closes` by area captured would have rated
this move at zero.

**That is the sharpest prompt-side observation so far.** Every decision I have made in this match came
from one question — *which vertices do I end up owning all three borders of?* — and answering it needs
`borderArrows(vertex)`, which the offer does not give. The BYOK offer tags a row `share+N` and
`borders_spawner`, which say what a row touches, but not which *other* arrows would complete a vertex
I partly hold, and not whether a two-step detour completes two vertices instead of one. The teaching
prompt even states the idea ("A share is a factory", the 1-share vs 3-share pinwheel example) — but
states it as a maxim, while the offer gives no data to act on it with. A model told "prefer shares"
and handed rows it cannot evaluate for shares will look like it is ignoring the advice.

---

## Turn 4 (moves logged 34) — picking the next loop

**Board as read.** Heads 3, Land 7, three spawners at 3/3, no open trail, stack on `-5,5,0`.
- C (orange) closed a large loop: 12 territory arrows, plus a 2-arrow trail heading north with a
  lone head, and 2 heads at home. C is now ahead of me on land.
- A (gold) is on 5 territory with a 3-arrow trail pushing east, heads 1 and 2.
- Nearest enemy head to where I am about to walk is ~14 tiles. Nothing can reach a new trail of mine
  for several turns.

**How I chose.** I enumerated every loop out of my territory and back (up to 6 steps, transit through
my own ground allowed) and scored each by *how many vertices end up with all three borders mine*.
That is the only number I care about; captured area is not.

| Loop | New arrows | Spawners gained | Steps |
|---|---|---|---|
| `-4,5,0 > -3,5,1` → land `-4,6,2` | 2 | **+1** | 3 |
| `-4,5,0 > -3,5,1 > -4,6,1 > -5,7,2` → land `-5,6,0` | 4 | **+2** | 5 |
| several others | 4–5 | +2 | 6 |

Reading it in turns rather than steps (speed(3) = 2 per turn):
- the +1 loop finishes on turn 5, then a second +1 loop finishes on turn 7 → 5 spawners at turn 7;
- the +2 loop finishes on turn 6 → **5 spawners at turn 6**.

**Choice.** The 5-step `+2` loop: `-4,5,0 > -3,5,1 > -4,6,1 > -5,7,2 > -5,6,0`. It completes
`-4,5,up` and `-5,6,up`.

**Why this one over the other +2s.** They all cost 5–6 steps, but this one passes through `-3,5,1`,
and from `-3,5,1` a single step onto `-4,6,2` closes for +1. So after this turn I am standing on a
fork: continue for +2, or take +1 immediately if the board turns against me. The other +2 loops have
no such bail-out. That optionality is free, and it is not something any tag on an offer row would
tell me.

**All three heads walk** — nothing is near enough to need a sentry, and the lump keeps speed 2.
I am deliberately *not* splitting 2+1 for the extra tile of throughput: I do not know how two
simultaneous open excursions interact for closure, and SPEC/AGENTS say an unknown rule is a question,
not a default.

**This turn:** 2 steps, `-4,5,0` then `-3,5,1`.
**Expect:** trail 2 arrows, front on `-3,5,1`, with both the +1 close and the +2 continuation live.

**Result.** Both legs drafted and sent cleanly (verified the drafted stroke on both tiles first).
Trail is `-4,5,0` + `-3,5,1`, 3 heads on `-3,5,1`, as planned. Turn passed on its own.
C's land is 11 to my 7, so C is ahead on ground — but ground is not the race I am running; I have
3 spawners and C's big closure was mostly enclosed area.

**Method note for the comparison.** Turn 4 is the clearest case yet of a decision that is a *search*,
not a judgement: enumerate the loops, score each by spawners completed, read the result in turns
rather than steps. Nothing about that is subtle reasoning — it is three lines of graph code. The
BYOK seat cannot run it, because the offer gives it one step's worth of rows with no way to ask
"what does this row lead to in three more steps, and which vertices would that complete?"

---

## Turn 5 (moves logged 43) — adopting the human's stated strategy

The human (seat C) stated their strategy between turns, so from here my play is tested against it
rather than against my own invented objective. Their phases:

1. Close the nearest spawners first; prefer an arrow with a spawner on *both* sides so shares fill
   faster. Goal: **be first to 4 heads** — which is either two stacks of 2, or one stack of 4 at
   speed 3.
2. Then close as much land as possible, without letting anyone reach the trail.
3. Then fight, from a position of more spawners than anyone else.
   A closure with no shares is still worth it if it is a leaping-off point for a later conquest.

**"A spawner on both sides" is exact, not a metaphor.** `GeometryPort.flankVertices(arrow)` returns
**always exactly 2** — every arrow borders two vertices. So the heuristic is: walk arrows whose *both*
flanked vertices are ones you are advancing. That is what my scorer already measures, by counting
vertices completed and vertices left one arrow short. Good convergence — the human's instinct and the
port's shape are the same fact.

**Board.** Heads 3, Land 7, 3 spawners, 2-arrow trail, stack on `-3,5,1`.
- A (gold) closed its loop: 8 territory, no trail, heads 2 and 1. Still ~16 tiles off.
- C (orange) 12 territory, a 3-arrow trail running north-west, heads 2 and 1. Moving *away* from me.
- Both enemies are west / north-west. My ground is the eastern side of the board.

**Search from here** (trail already out; 2 steps per turn at speed(3)):

| line | steps | spawners | left one short | closes on |
|---|---|---|---|---|
| close now-ish | 3 | +2 | +0 | turn 6 |
| four-step variants | 4 | +2 | +1 | turn 6 |
| five-step | 5 | +3 | +1 | turn 7 |
| **six-step** | 6 | **+3** | **+2** | turn 7 |
| seven-step | 7 | +4 | +0 | turn 8 |

The six-step line closes on the *same turn* as the five-step one — 6 steps and 5 steps are both three
turns at 2 steps a turn — while completing the same 3 spawners and leaving two more one arrow short.
It strictly dominates. The seven-step +4 buys one more spawner for one more turn and a 9-arrow trail;
with no sentries out, one cut would evaporate a lot, so I am not taking it.

**Choice.** `-4,6,1 > -5,7,2 > -5,6,1 > -6,7,2 > -6,6,0` → land `-5,6,0`. +3 spawners (6 total),
+2 left one short, and it runs **south-east, directly away from both opponents**, which is phase 1/2
work rather than contesting anything.

Of the two six-step +3 lines I took this one because its first two steps are also the first two steps
of the three-step `+2` close. So after this turn I am again on a fork: close next turn for +2, or
carry on for +3. Same reason as turn 4 — keep the cheap exit live for free.

**This turn:** `-4,6,1`, `-5,7,2`. All three heads; nothing is near enough to need a sentry.
**Expect:** trail 4 arrows, 6 spawners by turn 7, and 4 heads around then too — 3 spawners bank
9 shares at 1/36 a round, which is a head roughly every 4 rounds.

**Result.** Sent 3/3. Trail is now `-4,5,0`, `-3,5,1`, `-4,6,1`, `-5,7,2`; 3 heads on `-5,7,2`.
Both the +2 close (one step, next turn) and the +3 continuation are live. Turn passed on its own.

**Prompt-side note from this turn.** The human's strategy decomposes into three things the BYOK offer
cannot express:
- *"spawner on both sides"* — needs `flankVertices(arrow)` per row, and the knowledge that it is
  always exactly 2.
- *"first to 4 heads"* — a resource target several rounds out, scored from shares held, not from
  anything visible in a single offer.
- *"leaping-off point"* — the value of ground that pays nothing now but shortens a later loop.
  My scorer approximates it as "vertices left one arrow short"; the offer has no such notion, and
  `closes` with no `share+N` is explicitly written off in the teaching prompt as "painted dirt".
  On the human's strategy that write-off is wrong, or at least too strong.

---

## Turn 6 (moves logged 53) — holding the line against a tempting +4

**Board.** Heads 3, Land 7, 3 spawners. Trail 4 arrows, stack on `-5,7,2`. Still no 4th head.
- A (gold) closed its eastern loop (10 territory) and has opened a **new trail running south**,
  2 heads at the tip. It is the first enemy movement pointed at my half of the board. Still ~16 tiles
  from my trail, so not a threat this turn or next, but the direction has changed.
- C (orange) continues north-west with a 5-arrow trail, heads 2 and 1, moving away from me.

**Re-ran the search from the new position.** A line I could not see two turns ago has appeared:

| line | steps left | spawners | left one short | closes on |
|---|---|---|---|---|
| **planned** `-5,6,1 > -6,7,2 > -6,6,0` → `-5,6,0` | 4 | +3 | +2 | turn 7 |
| new | `-5,6,1 > -6,7,0 > -5,7,0 > -4,7,2` → `-4,6,2` | 5 | **+4** | +0 | turn 8 |
| bail out now | 1 | +2 | +0 | turn 6 |

Both start with the same step, `-5,6,1`, so this turn's first move is free of the choice — but the
second move commits, and spending a step to defer is strictly worse than deciding.

**Staying with the +3.** Three reasons, in the human's own terms:
1. *First to 4 heads.* 6 spawners from turn 7 banks 18 shares at 1/36 a round = half a head a round.
   The +4 line has me on 3 spawners for one extra round first. Arithmetic over the next six rounds
   makes them near-identical in total heads, but the +3 banks **earlier**, and the goal is a race.
2. *Exposure.* The +4 line keeps a 9-arrow trail open one turn longer, with no sentries, just as A
   turns south. One cut evaporates both ways from the cut point; a longer region loses more.
3. *The +2 left one arrow short.* Each is a vertex needing a single new arrow, so each is a 2–3 step
   follow-up loop. The +4 line leaves none. Counting what comes after, the +3 line reaches 7–8
   spawners by about turn 9; the +4 line reaches 7 at turn 8 with nothing teed up.

**This turn:** `-5,6,1`, `-6,7,2`. **Next turn:** `-6,6,0`, land `-5,6,0` → 6 spawners, Land 13.

**Result.** Sent 3/3. Trail is 6 arrows, stack on `-6,7,2`, two steps from the close.

**Prompt-side note.** This turn's whole decision was *declining* a row that scores better on the
obvious metric. A `+4 spawners` line existed and I passed on it for banking tempo, trail exposure and
what it leaves set up afterwards. The BYOK offer's tags (`share+N`, `closes`, `borders_spawner`)
would have pointed straight at the greedier line, and the teaching prompt's advice — "A share is a
factory", prefer `share+N` — reinforces it. Nothing in either tells a seat when the smaller gain is
the better move. That is not a model failure; a seat given only "more shares is better" is being
*instructed* into the greedy pick.

---

## Turn 7 (moves logged 63) — the close landed, and the human caught a real error

**The move.** `-6,6,0` → `-5,6,0`. Closure landed: 14 territory arrows, no open trail, 3 heads home.

**Then seat C asked why I was walking away from the centre. They were right, and the damage is
bigger than a direction preference.**

`SPAWNER_BANDS` in `packages/contracts/src/match-config.ts` is a radial gradient, and this match runs
the default config (confirmed from the downloaded log: `R:7, homeOffset:5, playerCount:3,
spawnerSeed:1`):

| radius | force | density |
|---|---|---|
| ≤ 1 | **1/3** | **1/2** |
| ≤ 3 | 1/9 | 1/3 |
| ≤ 5 | 1/12 | 1/6 |
| > 5 | 1/12 | **1/12** |

Homes sit at r = 5. My turn-5 and turn-6 arrows (`-5,6,1`, `-6,7,2`, `-6,6,0`) are at **r = 6** —
outward, into the band where only one vertex in twelve carries a spawner at all.

**And that is exactly what went wrong.** I had been scoring loops by *vertices whose three borders I
own*. Density means most vertices carry **no spawner**. Audit of my 14 arrows:

```
3/3  SPAWNER 1/12  -5,5,up      <- real, verified by hover on turn 1
3/3  SPAWNER 1/12  -5,4,down    <- real, verified by hover on turn 3
3/3  no spawner    -5,5,down    <- I asserted "3/3 by construction" and never checked
3/3  no spawner    -4,5,up      <- the turn-4/5 target
3/3  no spawner    -5,6,up      <- the turn-5/6 target
3/3  no spawner    -6,6,up      <- the turn-6 target
vertices fully held = 6,  of which carry a spawner = 2
```

**Turns 4, 5, 6 and 7 produced no income at all.** Four turns, ten arrows of ground, zero shares.
Every "+1 / +2 / +3 spawners" figure I reported was a count of *vertices*, not of spawners. I checked
the first two by hovering and then replaced the check with a proxy that silently dropped the
condition "does this vertex actually have a spawner on it".

**What the board is actually worth** (forward+backward BFS from my territory, income in 1/36 of a
head per round, loop cost in steps):

| arrow | income | fed by | loop cost |
|---|---|---|---|
| `-1,1,0` | **24/36** | two 1/3 spawners (centre) | 12 |
| `-2,4,2` | **8/36** | two 1/9 spawners | 6 |
| `-3,2,0` | 8/36 | two 1/9 spawners | 7 |
| `-3,4,0` | 4/36 | one 1/9 | 4 |
| *my entire territory today* | **6/36** | two 1/12 | — |

One arrow at `-2,4,2` is worth more than everything I have built in seven turns, and it is six steps
away. One arrow at the centre is worth four times my whole position.

**Corrected plan.** Drive inward along decreasing radius: `-3,5,1` (my innermost arrow, r=5) toward
`-3,4,0` / `-2,4,2` / `-2,3,1`, which completes `-3,3,down` (1/9) and leaves `-2,3,up` (1/9) one
arrow short. Then on toward the 1/3 band. Scoring from here is `loops3.proto.test.ts`, which weights
by actual spawner force, not vertex count.

**Prompt-side note — and this one indicts my own method, not just the offer.**
The radial gradient is the single biggest strategic fact in the game, and it appears **nowhere** in
`docs/byok-teaching.md`. The teaching prompt says "A share is a factory" and tells the seat to prefer
`share+N` — with no mention that a share's value varies 4:1 by radius, that spawner *density* varies
6:1, or that an arrow can be double-fed. A seat following that prompt perfectly would do exactly what
I did: chase share counts outward and bank nothing.

The failure mode is also instructive on its own. I replaced a verified observation (hover says
"spawner, force 1/12") with a cheaper computed proxy (vertex fully held), and the proxy was wrong in
a way that never surfaced, because nothing in my loop ever re-checked it against the board. The
`borders_spawner` tag in the offer is the real signal; "completes a vertex" was my invention.

---

## Turn 8 (moves logged 74) — turning inward, scoring by income this time

**Board.** Land 14, 3 heads, income **6/36 of a head per round** (two 1/12 spawners). Still 3 heads.
- A closed again (11 territory) and has a 1-arrow trail; heads back near its home.
- C has sprawled east with a long open trail; nearest head ~11 tiles from where I am headed.

**Re-scored every loop by income, with `loops3.proto.test.ts`** — which reads the real spawner map
from `makeMatch` with the logged config and weights each completed vertex by its actual force,
in 1/36 of a head per round. The vertex-counting scorer is retired.

| line | steps | income gained |
|---|---|---|
| **chosen** `-4,6,2 > -4,5,2 > -4,4,0 > -3,4,0 > -2,4,2 > -2,3,1 > -3,4,1` → `-4,5,0` | 8 | **+7/36** |
| alt | 8 | +6/36 |
| alt (more set up afterwards) | 8 | +4/36, +3/36 one short |
| best short loop | 5 | +3/36 |

The chosen loop completes **`-3,3,down` (force 1/9 — the first 1/9 spawner I will own)** and
**`-4,4,up` (1/12)**. Income goes 6/36 → **13/36**, better than doubling. The first two steps are
transit across my own ground (`-4,6,2`, `-4,5,2`), which lay no trail and risk nothing; the five
new arrows then run inward from r=5 to r=3.

**A tempo fact I had been missing.** `speed(N) = 1 + floor(log₂ N)`, so **speed(2) = speed(3) = 2**.
Walking 2 of my 3 heads is exactly as fast as walking all 3. From the moment this trail is in open
ground, leaving one head behind as a sentry is **free** — it costs no tiles at all. I will set the
count to 2 from next turn onward. I have been sending 3/3 every turn for no reason.

**This turn:** `-4,6,2`, `-4,5,2` — repositioning inside my own territory, so no trail yet and
all 3 heads move together.

**Expect:** stack on `-4,5,2`, ready to step out to `-4,4,0` next turn with a sentry left behind.

**Result.** Stack repositioned to `-4,5,2`, no trail laid, nothing exposed. Next turn steps out to
`-4,4,0` and `-3,4,0` with a sentry left behind.

**Prompt-side note.** Two of the three things that decided this turn are absent from the BYOK prompt
entirely: the radial gradient (so the seat cannot tell a 1/9 spawner from a 1/12 one), and the fact
that `speed(2) = speed(3)` makes a sentry free at 3 heads. The teaching prompt does state
`speed(N) = 1 + floor(log₂ N)` and works an example about lumping — but it draws the *offensive*
conclusion ("a 4-stack is 3 tiles this turn") and never the defensive one, that between powers of two
the spare head rides along for nothing.

---

## Turn 9 (moves logged 84) — stepping out, first sentry of the match

**Board.** Land 14, 3 heads, income 6/36. Stack on `-4,5,2`.
- **C is racing for the centre.** Its open trail now reaches `2,-2,1` and `1,-1,1` — that is r≈1–2,
  the **1/3 force, 1/2 density** band. C's lead head is ~7 tiles from the deepest point of my loop.
  C will get there first; I am 6–7 tiles out with a speed-2 stack and cannot win that race.
- A closed again and is sitting near home.

**Re-checked the plan from here rather than assuming it.**

| line | steps | income |
|---|---|---|
| **planned** `-4,4,0 > -3,4,0 > -2,4,2 > -2,3,1 > -3,4,1` → `-4,5,0` | 6 | **+7/36** |
| alt | 6 | +6/36 |
| short, safe | 4 | +3/36 |

The short line pays less than half and never leaves the 1/12 band, so it does not advance the
position at all. Staying with the +7: three turns, closing on turn 11.

**Threat.** C needs ~4 turns to reach my trail and would have to abandon its own centre push to do
it. I need 3. Acceptable — and this is the first turn where "acceptable" is a judgement rather than
an observation, because the distance is now inside the horizon rather than outside it.

**Sentry, for the first time.** Count 2 of 3. The other head stays on `-4,4,0`, the trail arrow
nearest home, where it is a firebreak for an evaporation running homeward from a cut further out.
`speed(2) = speed(3) = 2`, so the front walks exactly as far as it would have with all three.
This costs nothing and I should have been doing it since turn 4.

**Not doing:** cutting C's trail. It is long and open and tempting, but it is 7 tiles away and
chasing it abandons the only economy plan I have. Noting it as a phase-3 option.

**This turn:** `-4,4,0`, `-3,4,0`, count 2.

**Result.** Front of 2 on `-3,4,0`, sentry of 1 on `-4,4,0`, trail 2 arrows. Exactly as drafted —
the count did what I expected this time, now that I understand it applies to the last leg.
C closed again meanwhile and is on **20 land to my 14**, while also holding the inside track to the
centre. I am behind on ground and behind on position; my only edge is that my ground is about to
start paying 1/9 instead of 1/12.

**Prompt-side note.** The sentry decision needed two facts at once: `speed(2) = speed(3)`, so the
head is free, and *where* on the trail a firebreak does the most good (nearest home, so a homeward
evaporation stops before it reaches territory). The offer has no row for "leave a head here" — the
count is part of the move shape, not a tagged option — and the teaching prompt never mentions
sentries or firebreaks at all, though SPEC's vocabulary defines both.

---

## Turn 10 (moves logged 94) — checking the human's claim, and conceding it

C said they will close around the high-value centre next turn, and that a more central position would
have let me attack their trail. **Both halves check out.**

C's open trail is 9 arrows and now includes `0,0,2` and `0,-1,2` — **radius 0**. Together with
`1,-1,1` it holds two of the three borders of `0,-1,up`, a **force 1/3** spawner (12/36 a round, four
times anything I own). C's land is **29**, A's 14, mine 14.

**Can I cut it?** Measured rather than guessed — forward BFS along the grain from both my stacks to
the nearest arrow of C's trail:

```
from -3,4,0 (front, 2 heads): cut in 7 steps
from -4,4,0 (sentry, 1 head): cut in 8 steps
```

At speed 2 that is **4 turns**. C closes in **1**. There is no interference available, this turn or
any turn. Conceded.

**Where that was lost.** Not here — on turns 4 through 7, walking outward to r=6 for six arrows of
ground carrying two spawners between them, while C spent the same turns walking inward. The distance
I would need to cover now is almost exactly the distance I spent those turns travelling the wrong
way.

**So: no heroics.** Finish the loop. `-2,4,2`, `-2,3,1` this turn; `-3,4,1` and land `-4,5,0` next
turn, closing on turn 11 for +7/36, taking me from 6/36 to 13/36 a round and giving me my first 1/9
spawner. That is the only move that improves anything I control.

The front walks as a pair (speed 2; splitting it would be speed 1 each). The sentry stays on
`-4,4,0`.

**Result.** Trail is 4 arrows; front of 2 on `-2,3,1`, sentry of 1 on `-4,4,0`. Closes next turn.
Hovering the target vertex confirmed it on the board, not just in my model:
*"Spawner · force 1/9 · one head every 9 rounds if you hold all three · held by nobody."*

**Two more UI findings, both from the sentry.**
1. **The auto-select trap, in its damaging form.** My first two clicks were rejected with
   *"Too far this turn"*. The app had auto-selected the **sentry** (1 head, speed 1), not the front
   (2 heads, speed 2), so my destination was out of range for the selected stack. Nothing told me
   *which* stack was selected — the message explains the symptom, not the cause. Having a sentry
   means there are now two movable stacks and no way to tell by eye which one the app is pointing at.
   The fix was `Next stack`, then clicking the front to select it.
2. **A turn with a sentry no longer ends itself.** Every previous turn auto-passed once nothing could
   step. With a deliberately-parked head still able to move, the turn stays open, and I had to press
   `End turn` explicitly. That is correct behaviour, but it is a different interaction model that
   arrives unannounced the first time you leave a sentry.

---

## Turn 11 (moves logged 104) — the inward loop closes

**Move.** `-3,4,1` → `-4,5,0`. Closure landed. Land 14 → **19**.

**Verified on the board, not just in the model** (the turn-7 lesson): hovered `-3,3,down` —
*"Spawner · force 1/9 · one head every 9 rounds if you hold all three · 3/3 Player B."*

Audit of all 19 arrows:

```
3/3  SPAWNER 1/9   -3,3,down    <- new, the first high-band spawner
3/3  SPAWNER 1/12  -4,4,up      <- new
3/3  SPAWNER 1/12  -5,4,down
3/3  SPAWNER 1/12  -5,5,up
3/3  no spawner    -4,5,up, -5,5,down, -5,6,up, -6,6,up
vertices fully held = 8, of which carry a spawner = 4
income = 13/36 a head per round  (was 6/36)
```

**Standing.** C **50 land**, A 15, me 19. C closed its centre loop and is now more than twice my size
with the 1/3 band inside it. I am not in contention on the human's own three-phase plan: they have
won phase 1 and phase 2 outright.

**What is still worth playing for.** My income more than doubled and the next loop is +4/36 in 6
steps (another 1/9 at `-2,3,up`), so the gap closes slowly if left alone — but C's centre holding
will out-produce that. From here the only lever that matters is phase 3: C's territory is large,
which means its *border* is large, and large borders are what closures and cuts feed on.

**Sentry left in place; ended the turn by hand again.**

---

## Turn 12 (moves logged 114) — the centre is still open

**Board.** C 50 territory + 2 trail arrows, A 14 + 1 trail and now a **3-stack** (A reached 4 heads
before me, so A moves at speed 3 — wait, 3 heads is still speed 2; A has 4 heads total split 3+1).
Me: 19 territory, no trail, income 13/36.

**Checked the phase-3 option first, and it is not there.** Cut distance to C's open trail:
9 steps from my front, 8 from my sentry — 4–5 turns, and C's trail will have closed long before.
No contest available again.

**But the reach scan found something I assumed was gone.** C closed *around* the centre without
claiming the arrows I need. Checked each one against the board: `-1,1,0`, `0,1,2`, `0,0,1`,
`0,1,1`, `-1,2,2` are **all still unclaimed**. Those five arrows hold two **force 1/3** spawners
(`-1,0,down`, `-1,1,up`), worth **24/36 a round together** — nearly twice my entire current income,
and `-1,1,0` alone is double-fed by both.

Loop cost to touch `-1,1,0` is now **7 steps**, down from 12 at turn 7, purely because the last loop
moved my frontier inward. No single loop within 8 steps completes them yet.

**So: the same loop is both the best income now and the stepping stone.**
`-3,5,2 > -3,4,2 > -3,3,0 > -2,3,0 > -1,3,1` → land `-2,4,2`. Six steps, three turns, **+4/36**
(completes `-2,3,up`, a second 1/9), taking income to 17/36. It also plants my frontier on `-1,3,1`,
about three tiles from `-1,1,0`. That is the human's "leaping-off point" idea arriving as the
arithmetically best move rather than as a separate consideration.

**Sentry handling.** The lone head on `-4,4,0` is interior now and guarding nothing. From there its
exits include `-3,4,2`, which is on the new loop — so next turn, once the front has passed through,
it steps onto the trail and becomes a firebreak again. This turn it holds.

**Threats.** C's nearest head ~9 tiles, A's 3-stack ~11. Both ~4–5 turns out; the loop needs 3.

**This turn:** front walks `-3,5,2`, `-3,4,2`.

**Result.** Trail 2 arrows (`-3,5,2`, `-3,4,2`), front of 2 on `-3,4,2`, sentry still on `-4,4,0`.
Closes in two more turns.

**Prompt-side note.** The reason I even looked at the centre again was a *standing* scan — "what is
every arrow on the board worth, and what does a loop to it cost from where I am now" — re-run each
turn. The answer changed from "12 steps, forget it" at turn 7 to "7 steps, and the arrows are still
free" now, without my doing anything except move my frontier. Nothing in the BYOK loop re-evaluates
a target that was out of reach earlier: the offer is regenerated per position, but it only ever
describes one step, so a goal that becomes viable three steps later is invisible until the seat
happens to be standing next to it.

---

## Turn 13 (moves logged 124) — pressing on, sentry forward

**Board.** C 50 territory + 4 trail arrows, A 14 + 3 trail with a 3-stack, me 19 + 2 trail.
All five centre arrows still unclaimed. A's 3-stack is heading south-west toward the centre, not at
me; C's nearest head is ~9 tiles from my front. The loop needs 2 more turns and has room.

**Moves.** Front `-3,3,0`, `-2,3,0`. Then the sentry steps `-4,4,0 → -3,4,2`, onto the trail arrow
closest to home, where it is a firebreak for a homeward evaporation — the same job it did last loop,
and again free, since the front is a pair either way.

**Expect.** Trail 4 arrows, front on `-2,3,0`, one turn from landing. Income to 17/36 on close, and
my frontier ends ~3 tiles from the double-fed 1/3 arrow.

**Result.** Front of 2 on `-2,3,0`; trail 4 arrows (`-3,5,2`, `-3,4,2`, `-3,3,0`, `-2,3,0`); sentry
of 1 moved up onto `-3,4,2`. The sentry's move applied on the click (one legal count, nowhere further
to go) and the turn then ended itself — the same auto-apply that cost me a move on turn 2, this time
doing exactly what I wanted. It is not the behaviour that is wrong, it is that nothing distinguishes
"this click selects" from "this click commits" until after the fact.

**Selection friction, third time.** Each stack needed **two** clicks to select: the first click
deselected whatever the app had auto-selected and printed *"Your turn — gold-outlined stacks can
still move"*, the second actually selected the one I clicked. With two stacks on the board that is
now a reliable two-click ritual, and I only know it worked by reading the tile's stroke colour from
the DOM.

---

## Turn 14 (moves logged 135) — second loop closes; the centre is reachable in one loop

**Move.** `-1,3,1` → `-2,4,2`. Closed. **Land 19 → 24.**

```
3/3  SPAWNER 1/9   -2,3,up     <- new
3/3  SPAWNER 1/9   -3,3,down
3/3  SPAWNER 1/12  -4,4,up
3/3  SPAWNER 1/12  -5,4,down
3/3  SPAWNER 1/12  -5,5,up
vertices fully held = 11, of which carry a spawner = 5
income = 17/36 a round  (was 13/36, was 6/36 four turns ago)
```

**And the next search changes the game.** From `-2,4,2` there is now a **7-step loop worth +16/36**:

`-2,3,2 > -2,2,0 > -1,2,2 > -1,1,0 > 0,1,1 > -1,2,1` → land `-2,3,0`

It completes **`-1,1,up`, a force 1/3 spawner (12/36 on its own)** plus a 1/9. Income would go
17/36 → **33/36**, almost a head a round, from 6/36 eight turns ago.

**The risk is real this time.** Six arrows of trail, four turns at speed 2, through ground where C's
nearest head is ~5 tiles from the deepest point and A's are ~8. C can reach my trail in about 3
turns if it wants to. If it cuts, I lose the trail and four turns of tempo, keeping 24 land and
17/36.

**Taking it anyway.** C is on 58 arrows with the centre band inside its perimeter. A safe 17/36
loses slowly and certainly; this is the only line that changes the shape of the game. Down-side is
bounded (tempo, not territory), up-side nearly doubles production.

**Sentry.** It cannot reach the new trail directly — from `-3,4,2` its exits are all `-3,3,*`. But
`-3,3,0` (my own ground) leads to `-2,3,*`, which includes the new loop's first arrow. So it steps
there now and can drop onto the trail behind the front next turn. Two stacks also move 3 tiles a
turn between them against a lump's 2.

**Result.** Land 24, income 17/36, no open trail. Front of 2 on `-2,4,2`, sentry of 1 moved to
`-3,3,0`. Turn ended itself once both stacks were spent. C is on 55 territory + trail.

**Prompt-side note — the shape of this decision.** Taking the centre loop is a bet: bounded downside
(four turns of tempo), large upside (income nearly doubles), chosen *because* I am behind and a safe
line loses slowly. That reasoning needs three things the offer has none of — a read of the other
seats' totals, a model of what my position is worth if nothing changes, and a notion of variance
being good when trailing. The teaching prompt's threat line gives "share lead, longest enemy trail,
whether any legal row is cut / closes / borders_spawner": enough to pick a row, never enough to
decide whether to gamble.

---

## Turn 15 (moves logged 147) — committing to the centre loop

**Board.** C 55 territory + a 5-arrow trail that has run **east, away from me**, toward A's side.
A is on 21. All six arrows of my planned loop are still free. My 24 land, income 17/36.

**Threat re-read.** One enemy head sits at roughly 4 tiles from the deepest point of my loop — the
closest anything has been to my line all match. C's main effort is pointed the other way, which is
what makes the gamble survivable rather than reckless, but a single head is enough to cut.

**Playing it.** Front `-2,3,2`, `-2,2,0`. Then the sentry steps `-3,3,0 → -2,3,2`, onto the trail
arrow the front has just vacated — a firebreak at the home end from the very first turn of this
loop, rather than three turns in. Both stacks move in the same turn: 2 tiles for the pair, 1 for the
single, 3 in total against a lump's 2.

**Result.** Trail `-2,3,2`, `-2,2,0`. Front of 2 on `-2,2,0`, sentry of 1 on `-2,3,2` directly
behind it. Four steps and three turns to go. The enemy head sits ~4 tiles off my line.

**Prompt-side note.** Both stacks moved this turn, in a deliberate order — front first, so the
arrow it vacated became trail, then the sentry onto it. The order mattered: the reverse would have
put the sentry on ground that was still territory and wasted the step. An offer is a flat list of
legal single steps with no way to express "this move is only correct after that one", and the JSON
contract takes `moves` as an ordered array of indices from *one* offer, so a seat can sequence within
a batch but cannot reason about a second stack's move depending on the first stack's result.

---

## Turn 16 (moves logged 158) — into the 1/3 band

**Board.** C 55 + 7 trail arrows (one of them back at the centre, `0,-1,1`), A 22 and no trail.
All four remaining arrows of my loop still free. The nearest enemy head is still ~4 tiles off my
trail and has not closed the distance — it is doing something else.

**Moves.** Front `-1,2,2`, `-1,1,0` — the second of those is the **double-fed centre arrow**, bordered
by two force 1/3 spawners. Sentry follows onto `-2,2,0`, staying one arrow behind the front.

After this turn: trail 4 arrows, front standing on the best single arrow on the board, three steps
from home. Two turns to close.

**What actually happened — the turn-2 trap, second time, and this one cost a turn.**

My click on the front's tile was consumed as a *move for the auto-selected sentry*: from `-2,3,2`
the sentry's only reachable arrow at speed 1 was `-2,2,0`, which is where the front stood, so the
click had one legal count and nowhere further to go and **applied at once**. The sentry walked and
merged; I was suddenly looking at a 3-stack with the merged head's step already spent, so it had
**1 step left instead of 2**, and the second leg came back *"Too far this turn"*.

I recovered by sending 1 of the 2 available steps with count 2, which re-split the sentry back onto
`-2,2,0`. Net cost: **one turn** — the loop now closes on turn 19 instead of 18, with a 6-arrow
trail open one turn longer while an enemy head sits 4 tiles away.

**Why I walked into it again, having written it up on turn 2.** On turn 2 the lesson I recorded was
"a selecting click can be a move". The guard I actually adopted was weaker: *click the tile twice,
check the stroke colour*. That guard only detects the case where the click toggles selection — it
does nothing when the click is consumed as a move, because by then the move has already applied.
The correct guard is to **never click a tile to change selection while another stack is selected**:
use `Next stack`, which cannot be interpreted as a destination.

**This is the single most useful UX finding of the match**, because it bit a careful player twice
in fifteen turns, the second time after writing the warning down. Auto-select + apply-on-unambiguous
-click + no visible selection state means *there is no safe click* on a board with two stacks.
A `Next stack`-only selection model, or requiring a modifier/second click to commit a single-count
move, removes it entirely.

---

## Turn 17 (moves logged 170) — four steps to the centre, new selection discipline

**Board.** C 65, A 24, me 24 + a 3-arrow trail. All four remaining loop arrows still free.
Enemy heads are thickening around the middle; the nearest is ~4 tiles from my front and ~3.5 from
where my front is about to stand. This is now genuinely contested ground.

**Recount of the remaining line:** `-1,1,0`, `0,1,1`, `-1,2,1`, land `-2,3,0` — **4 steps, 2 turns**
at speed 2. So the close lands on **turn 18**, not 19; the turn I lost was partly absorbed by the
route being shorter from here than I had assumed.

**Moves.** Front `-1,1,0` then `0,1,1`. `-1,1,0` is the double-fed arrow — the two force 1/3
spawners `-1,0,down` and `-1,1,up` both border it. Sentry follows to `-1,2,2`.

**New discipline after last turn's loss: selection changes only via `Next stack`.** A click on a
tile is never used to change which stack is active, because a click on an occupied tile can be read
as a destination and committed before I see it.

**Result.** Front of 2 now stands on `0,1,1`, having walked **`-1,1,0`** — the double-fed centre
arrow — on the way. Trail is 5 arrows. **Two steps from closing**: `-1,2,1`, then land `-2,3,0`.

**Sentry deliberately not moved.** I had planned to walk it up behind the front, then reconsidered:
a firebreak's job is to stop an evaporation *before it reaches home*, so it belongs between the deep
end and my territory, not next to the front. Leaving it on `-2,2,0` protects the two arrows closest
to home if the deep end is cut. Moving it forward would have protected less. The plan was wrong and
the right move was to do nothing with that stack.

**Two more interface findings.**
1. **I hit `Pause` while aiming for `Next stack`.** The control strip reflows as the status text
   above it changes length, so the same screen position is a different button from turn to turn.
   Everything afterwards in this match uses element references rather than coordinates. A human
   gets the same hazard in the form of buttons that move under the cursor between turns.
2. **`Next stack` does not reach every stack.** Pressing it repeatedly alternated between the sentry
   and *nothing selected* — it never offered the front, even though the front was gold-outlined and
   movable. So the discipline I adopted last turn ("never click a tile to select; use `Next stack`")
   is **not sufficient**: sometimes the only way to reach a stack is to click it. The safe rule is
   narrower — click a tile to select **only when nothing is currently selected**, which is the state
   `Next stack` leaves behind on its empty step. That is a strange thing to have to know.

---

## Turn 18 (moves logged 182) — the centre loop closes

**Move.** `-1,2,1` → `-2,3,0`. Closed, uncut. **Land 24 → 30.**

Verified by hover: *"Spawner · force 1/3 · one head every 3 rounds if you hold all three ·
any one share fills in 9 · 3/3 Player B."*

```
3/3  SPAWNER 1/3   -1,1,up     <- the centre spawner
3/3  SPAWNER 1/9   -2,2,up     <- a bonus; the loop completed it in passing
3/3  SPAWNER 1/9   -2,3,up
3/3  SPAWNER 1/9   -3,3,down
3/3  SPAWNER 1/12  -4,4,up
3/3  SPAWNER 1/12  -5,4,down
3/3  SPAWNER 1/12  -5,5,up
vertices fully held = 13, of which carry a spawner = 7
income = 33/36 a round   (6/36 at turn 7, 17/36 at turn 14)
```

The gamble paid in full: four turns of exposure, three enemy heads within five tiles of the deep
end, and nobody cut. **Income has gone up 5.5× in eleven turns.**

**Next.** `-1,0,down` is the *other* force 1/3 spawner, and it borders `-1,1,0`, which I now own.
It needs only `0,1,2` and `0,0,1`. The search finds a 7-step loop through both, worth **+12/36**,
which would put me at 45/36 — over a head a round.

**Standing.** C 80 land and 5 heads, A 24, me 30 and 3 heads. On ground I am still far behind, and
C is still growing faster than me. But production is now the thing I am winning on a per-arrow
basis, and that is the only axis that compounds.

**Selection, again.** Opening the turn, the app had the **sentry** auto-selected with the front's
next arrow lit as its destination — one click from repeating the turn-16 mistake exactly. `Next
stack` happened to move selection to the front this time, where last turn it refused to. The
behaviour is not predictable from the outside, which is the real complaint.

---

## Turn 19 (moves logged 196) — 4 heads at last, and one target lost

**Board.** C **87**, A 26, me 30. **Heads: 4** — the economy finally produced one, in three stacks
(front 2, sentry 1, new head 1 back home).

**The follow-up I named last turn is gone.** `-1,0,down`, the other centre 1/3, needed `0,1,2` and
`0,0,1`. **C has taken `0,0,1`.** That vertex can never be mine now. This is the first time a target
has been removed by an opponent rather than by distance, and it is a direct consequence of C having
heads parked around the middle while I only visit it.

**Re-scored with enemy-held arrows excluded** (new `loops4.proto.test.ts` — the old scorer would
happily have planned a walk through C's territory):

| line | steps | income |
|---|---|---|
| **`-1,3,0 > 0,3,2 > 0,2,0 > 1,2,2 > 1,1,1 > 0,2,1` → land `-1,3,1`** | 7 | **+12/36** |
| next best | 7 | +4/36 |

That completes `0,1,down` — **a third force 1/3 spawner** — taking income to **45/36**, over a head
a round.

**Speed.** 4 heads would be speed 3, but they are in three stacks and cannot merge quickly: the
sentry's exits do not include the front's arrow. So the front walks as a pair at speed 2 and the
loop takes 4 turns, not 3. Assembling a 4-stack would cost more turns than it saves on this loop.

**The real risk now is not a cut.** Territory cannot be cut — only enclosed. C has four heads loose
around the middle and 87 arrows; it can close *around* my centre holdings and take them outright.
I cannot prevent that directly. The answer is to keep compounding and hope the board gets decided
on production before it gets decided on encirclement.

**This turn:** front `-1,3,0`, `0,3,2`.

**Result.** Trail `-1,3,0`, `0,3,2`; front of 2 out, sentry and the new head held. C is on 85 land
and **6 heads** to my 4.

**Prompt-side note — a scoring bug I would have shipped.** Until this turn my search could plan a
walk straight through another seat's territory, because nothing in it knew who owned what; it only
knew which arrows *I* owned. It never mattered while I was expanding into empty board. The moment a
target's third border changed hands it mattered a lot, and the fix was a one-line exclusion set.
The BYOK offer does not have this bug — `legalMoves` is generated by the engine, so an illegal walk
is simply not in the list. That is worth stating plainly: **the offer's narrowness is also a
correctness guarantee.** The gap is not that the offer is wrong, it is that it is shallow; a seat
that could see further would also have to learn what I just had to.

---

## Turn 20 (moves logged 209) — walking into a contested square on purpose

**Board.** C **91** and 6 heads, A 27, me 30 + a 2-arrow trail, 4 heads.
**C has a 2-stack sitting one tile from `1,2,2` and `1,1,1`** — two of the three arrows I need for
the `0,1,down` spawner. It is parked exactly on my route. Five other C heads are scattered around
the middle.

**Checked the bail-out first.** Closing now would claim the two trail arrows and complete
**nothing** — audit with those arrows added: still 13 vertices, still 7 spawners. So retreating buys
zero. The choice is "press on and risk a cut" against "throw the trail away".

**Pressing on.** The downside of a cut is four arrows and ~4 turns of tempo; the trail is already
sunk and bailing recovers none of it. The upside is a third force 1/3 spawner and 45/36 a round.
And the three arrows I need are *all* beside C's stack, so there is no detour that avoids it —
either I contest that square or I give up the vertex.

**No sentry available to cover it.** The front is a pair; splitting it would drop the walking stack
to speed 1 and double the time I spend exposed, which makes the cut *more* likely, not less. The
old sentry is five tiles back and the new head is still at home. So this trail runs uncovered, and
that is a consequence of my heads being spread across three stacks instead of two.

**This turn:** `0,2,0`, `1,2,2`.

**Result.** Trail is 4 arrows, front of 2 on `1,2,2`, directly alongside C's 2-stack. Two steps and
one more turn of exposure before the close: `1,1,1`, `0,2,1`, then land `-1,3,1`. Three steps —
**two turns**, not one.

**Prompt-side note.** The decision to push was made by comparing a *bail-out* against a *gamble*,
and the bail-out had to be priced before the gamble could be judged: I ran the audit on "what if I
close right now" and it returned zero new spawners, which is what made pressing on obviously right
rather than merely brave. The BYOK offer tags a row `closes` and the teaching prompt pushes the
seat towards taking it. There is no way, from the offer, to ask "what is this close actually worth
if I take it", and no concept of a close being worth nothing — yet `closes` with no `share+N` is
exactly that case, and the prompt's own advice calls it "painted dirt" while still ranking it above
rows that lead somewhere.

---

## Turn 21 (moves logged 221) — the trail survived; one step from the third 1/3

**The cut did not come.** C had a 2-stack adjacent to my trail tip for a whole round and did not
take it. Trail intact at 4 arrows, and I am now on **5 heads** (two of them idle at home).

**Moves.** `1,1,1`, `0,2,1`. That is all three borders of `0,1,down` walked —
`0,2,0`, `1,2,2`, `1,1,1` — so the vertex completes the moment I land. Trail is now 6 arrows and
**one step from home**: `-1,3,1` next turn closes it for **+12/36 → 45/36 a round**.

**Standing.** C **90 land, 7 heads**; me 30 land, 5 heads, and about to be on a head and a quarter
per round. C is still winning on every absolute measure and is growing faster in land; my only
claim is that per-arrow I now produce several times what anyone else does.

**On the gamble.** Two rounds of a 2-stack sitting beside an uncovered trail and no cut. I do not
read that as C missing it — C's heads were busy expanding, which is the same choice I keep making.
Worth noting for the experiment: *neither human seat has ever actually attacked*, in 21 turns. All
three seats have played pure economy. The combat half of the rules has not been exercised once.

---

## Turn 22 (moves logged 236) — the first attack of the match, and it hurt

**Damage.** C cut the trail and took ground:
- Trail **6 arrows → 1**. `1,1,1`, `1,2,2`, `0,2,0`, `0,3,2`, `-1,3,0` all evaporated, and `1,1,1`
  is now C's trail.
- **`-1,1,0` is now C's territory.** That was one of the three borders of `-1,1,up`, my force 1/3
  spawner. The vertex is down to 2/3 and pays nothing.
- Income **33/36 → 21/36**. Plus the +12/36 I was one step from taking is gone with the trail.
  Total swing against me ≈ 24/36 a round.

I had no firebreak anywhere near the cut, exactly as I noted when I chose to walk uncovered. The
cost of that choice arrived in one turn.

**The counter-attack is not there.** Cutting C's trail is 4–5 steps away — two to three turns, and
C closes before that.

**But the conversion is.** The help text says a refused grain is one that *"would convert with no
trail home"* — so stepping onto enemy ground **converts it** when you do have a trail home.
`-1,1,0` is one step from `-1,2,2`, **which is my own territory**. So the spawner C just took off me
is two moves from being taken back.

**Plan.**
- *This turn:* front of 2 walks `0,2,1 → -1,3,2 → -1,2,2`. `-1,3,2` is free ground; `-1,2,2` is
  mine, so landing there **closes**, salvaging the last trail arrow and claiming `-1,3,2` as well.
  Land 29 → 31, and the pair ends standing on the launch pad.
- *Next turn:* `-1,2,2 → -1,1,0`, converting C's arrow back and restoring `-1,1,up` to 3/3 —
  **+12/36**, back to 33/36.

I am sending the **pair**, not the sentry, precisely because stack size is lives: a lone head
converting an arrow next to four enemy heads dies to the first thing that touches it.

**Result.** Salvaged and consolidated. Land 29 → **31** (the close claimed `0,2,1` and `-1,3,2`),
no open trail, and the loose heads are gathered: **a 3-stack on `-1,2,2`**, one step from the arrow
C took, and **a pair at home** instead of two singletons.

Both merges were free in tempo — `speed(1)=1`, `speed(2)=speed(3)=2` — and both bought lives
instead of tiles, which is the right trade now that the board has combat in it. I had five heads in
four stacks doing nothing for several turns; that was slack I did not notice while the game was
peaceful.

**Prompt-side note — the whole conflict vocabulary just went live at once.** This turn needed:
evaporation running both ways from a cut (to read the damage), stack size *being* lives (to choose
the 3-stack over the sentry for the counter), conversion requiring a trail home (to see that the
lost arrow is recoverable at all), and merge-without-penalty between powers of two (to consolidate
for free). Three of those four are in SPEC's vocabulary table and **none of them is in
`docs/byok-teaching.md`** — which covers closes, shares, tempo and plans, and treats `cut` purely as
a tag that may appear on a row. A BYOK seat that had just been cut like this would have no way to
know that converting the lost arrow back is even legal.

---

## Turn 23 (moves logged 253) — taking it back

**`-1,1,0` is still C's and still undefended** — nearest enemy head ~2 tiles, nothing standing on it.

**The whole recovery fits in one turn.** `-1,1,0`'s out-arrows include **`0,1,1`, which is my own
territory**. So:

`-1,2,2` (mine) → `-1,1,0` (**convert**, becomes my trail) → `0,1,1` (mine, **closes**)

Two steps, exactly speed(3). The conversion alone would not have paid — *a share only pays as
territory*, and a converted arrow is trail until something closes it — so being able to close in the
same turn is what makes this work rather than leaving a 1-arrow trail parked in C's face.

Restores `-1,1,up` to 3/3: **+12/36, income back to 33/36**, one turn after losing it.

Sending all 3 heads: this is a conversion next to four enemy heads, and stack size is lives.

**Result — taken back in one turn.** `-1,1,0` is my territory again, Land **32**, and the audit
confirms **7 spawners, income 33/36**, including `-1,1,up` at 1/3. Net of C's attack and my reply:
I am down the 12/36 I never got to collect from `0,1,down`, and *up* two arrows of land, with the
same income I had before the cut.

Also marched the home pair two tiles forward through my own territory. They are reserves now rather
than furniture.

**Prompt-side note — the counter was a two-step combination, and that is the shape the contract
cannot express.** Converting alone loses: a converted arrow is trail, and *a share only pays as
territory*. Closing alone was impossible: there was nothing to close. The move only works because
`-1,1,0`'s out-arrows happen to include a tile I already own, so convert-then-close fits inside one
turn at speed 3. Evaluating it required looking **two steps ahead through a tile I did not own**,
which is precisely the lookahead the one-step offer cannot provide — and the ordering within the
batch mattered, which the JSON contract *can* express (`moves` is an ordered array) but has nothing
in the prompt telling a seat to look for.

---

## Turn 24 (moves logged 264) — consolidating into a speed-3 stack

**I mis-tracked the turn order.** After my last `End turn` the seat went to A, then C, then back to
me, and I reported as if I had already played this turn. Seat C had to tell me. Worth logging: with
three seats and an auto-passing turn, "whose turn is it" is not obvious from the transcript of what
I did — I was reading my own intent rather than the board.

**Board.** Me 32 land, 6 heads, income 33/36. C **100 land, 9 heads**. A is third.
Best loop available anywhere is only **+4/36 over 5–6 steps** — the cheap ground near me is used up,
and the remaining high-force vertices are inside or behind C's territory.

**So this turn is about tempo, not ground.** `speed(N) = 1 + floor(log₂ N)`:
- 3 heads = speed 2, 1 head = speed 1 → 3 tiles a turn across two stacks
- **4 heads in one stack = speed 3**

I walked the 3-stack two tiles through my own territory to `-2,3,2`, then stepped the loose head
onto it. Order mattered and the rule is explicit: *"Arrive as majority and the joined group is barred
at speed 0."* The single arriving at a 3-stack is the minority, so the merge is free; doing it the
other way round would have frozen the whole group for the turn.

Result: a **4-stack at speed 3**, plus a 2-stack reserve one tile behind it. 5 tiles a turn across
two stacks, and the big stack has four lives in a board that now has combat in it.

**Prompt-side note.** The merge-order rule is in `docs/byok-teaching.md` — one clause, *"Arrive as
majority and the joined group is barred at speed 0"* — and it is the only place in the prompt that
mentions merging at all. It states the penalty without ever saying the useful thing: that merging
*into* a larger stack is free, and that crossing a power of two buys a whole extra tile per turn
forever. A seat reading that clause learns a hazard to avoid, not a move to look for.

---

## Turn 25 (moves logged 283) — my first attack of the match

**Board.** Me 32 land, **7 heads** (4-stack, 2-stack, and a new single); income 33/36.
C has pushed an open trail right along my northern edge: `-1,3,0`, `0,3,0`, `1,3,2` are all **C
trail**, and `-1,3,0` is an arrow that used to be mine before the cut.

**The counter is available, and it is cheap.**

```
from -2,4,2 (2-stack): cut in 2 steps  -2,4,2 > -2,3,0 > -1,3,0
from 0,1,1  (1 head):  cut in 3 steps
from -2,3,2 (4-stack): cut in 4 steps
```

`-2,4,2` and `-2,3,0` are both **my own territory**, so the pair transits safely and only the final
step is exposed. speed(2) = 2 — exactly the two steps needed. **The cut lands this turn.**

Evaporation runs both ways from the cut point, each front carrying one kill and halting at the
second head it meets, so cutting at `-1,3,0` threatens the whole northern trail — `0,3,0` and
`1,3,2` sit beyond it.

**Plan.** 2-stack cuts. The 4-stack (speed 3) then plays the best economy loop still available
(+4/36), because the cut does not need it and the cheap ground is nearly gone.

This is the first aggressive move I have made in 25 turns, and it is only on the board because C
over-extended a trail past my border — exactly the mistake that cost me 24/36 three turns ago.

**Result — the cut landed.** C's northern trail `-1,3,0` and `0,3,0` **both evaporated**; only
`1,3,2` survives beyond the cut point, and my pair now stands on the cut arrow. Two arrows of C's
trail destroyed for two steps of mine, one of which was inside my own territory.

The 4-stack meanwhile walked three tiles (`-2,2,2`, `-2,1,1`, `-3,2,0`) on the best remaining
economy loop (+4/36, closing next turn). **Speed 3 paid for itself immediately** — that is a tile
the same four heads would not have had as 3+1.

**Standing.** C 100 land, 11 heads. Me 32 land, 7 heads, 33/36 income, two open trails and the
initiative for the first time.

**Prompt-side note — the asymmetry of the cut.** My cut cost two steps and destroyed two enemy
arrows; C's cut three turns ago cost it a few steps and destroyed five of mine plus a 1/3 spawner.
The difference was entirely *where* the trails ran: C's ran along my border where I could reach it
from inside my own ground, mine ran through open country with no firebreak. Nothing in the offer
describes that asymmetry — `cut` is a boolean tag on a row. The decision that matters is the one
made several turns earlier, about where a trail is allowed to run, and the offer has no vocabulary
for it at all.

---

## Turn 26 (moves logged 306) — two closes in one turn

Both trails survived C's reply, so both closed.

1. **The cut arrow.** The pair on `-1,3,0` stepped to `0,2,1`, my own territory — one step, and the
   arrow I took off C by cutting is now mine as ground. Land 32 → **34** (the closure picked up a
   second arrow with it).
2. **The economy loop.** The 4-stack walked `-2,2,1` and landed on `-3,3,0`. Land → **38**.

```
3/3  SPAWNER 1/3   -1,1,up
3/3  SPAWNER 1/9   -2,2,up, -2,3,up, -3,1,down (new), -3,3,down
2/3  SPAWNER 1/9   -3,2,up      <- one arrow short, cheap next target
3/3  SPAWNER 1/12  ×3
vertices fully held = 17, of which carry a spawner = 8
income = 37/36 a head per round
```

**Over a head per round for the first time**, and `-3,2,up` sits one arrow from being a ninth.

**Standing.** C **104 land, 13 heads**; me 38 land, 7 heads, 37/36 income. C is still growing far
faster in absolute terms — 13 heads against my 7 is the number that decides a fight — but my ground
is denser in production than anything else on the board.

**Prompt-side note — two independent closes in one turn.** Each stack had its own trail, its own
anchor and its own close, and they shared nothing except the turn. The JSON contract's `moves` is a
single ordered array of indices from one offer, which *can* express this — but the prompt's `plan`
field is a single clause naming "the job this seat is still on", and every worked example assumes
one job. There is no shape in the contract for "two fronts, two jobs, both live", which is the
normal state of a seat with more than one stack.

---

## Turn 27 (moves logged 327) — a one-arrow loop

**Board.** Me 38 land, 8 heads, income 37/36, no open trails. C **119 land, 15 heads**.
C has three open trails near my border (`-3,1,0`, `-2,0,1`, `1,2,0`) but all are **4 steps away**
from either of my stacks — the cheap cut I had last turn was a one-off caused by C running a trail
along my edge, and C is not repeating it.

**So: economy, and the cheapest gain on the board.** `-3,2,up` has been sitting at 2/3 since the
last close, needing exactly one arrow — `-3,3,2`. The search finds it in a 4-step loop of which
**three steps are transit across my own ground**:

`-3,3,0 > -2,3,1 > -3,4,2 > -3,3,2` → land `-3,2,0`

Walked three at speed 3; the landing is next turn. One new arrow, **+4/36**, a ninth spawner.

**This is the cheapest loop of the match** and it only exists because an earlier loop left that
vertex one short — the "leaping-off point" idea again, paying off four turns later. A scorer that
counted only completed spawners would have rated the earlier loop lower and might not have taken it.

**Standing.** C is now growing by roughly 15 land a turn to my 4, and has **15 heads to my 8**.
On any absolute measure this is over; what is left is to keep the production lead intact and see
whether C converts its mass before the game's domination condition triggers.

---

## Turn 28 (moves logged 351) — ninth spawner

**Closed.** Land **39**, and the audit confirms **9 spawners** — one 1/3, five 1/9, three 1/12 —
**income 41/36 a head per round**. From 6/36 at turn 7, that is just under 7× in twenty-one turns.

```
3/3  1/3   -1,1,up
3/3  1/9   -2,2,up  -2,3,up  -3,1,down  -3,2,up(new)  -3,3,down
3/3  1/12  -4,4,up  -5,4,down  -5,5,up
```

**Standing.** C **124 land, 18 heads**. Me 39 land, 8 heads. C added ~18 heads in the time I added
one; its land is growing ~15 a turn against my ~4. The production lead per arrow is mine and it is
large, but C's absolute production now dwarfs it: 124 arrows of ground, however thin, plus whatever
spawners sit inside it.

**Selection cost me a click again.** The close was refused with *"Too far this turn"* on the first
attempt because the app had a different stack selected; `Next stack` fixed it. That is the fourth
distinct turn where selection state alone caused a wasted or wrong action.

**Where the playtest stands.** The economic game has been explored thoroughly and the conflict
phase has now produced: C cutting me (−5 arrows, −12/36), my recovery by conversion, my own cut
(−2 arrows for C), and the closes that followed. What has *not* happened is a real fight —
no combat at a point, no head has died to another head, no evaporation front has met a firebreak.
With 18 heads against 8, C can force that whenever it wants to.

---

## Turn 29 (moves logged 374) — invaded

**C has come inside.** Land 39 → **37**: C took `0,1,1` and `0,3,2` as territory, by closure, not
by cutting — I had no trail to cut. `0,1,1` is a border of `-1,1,up`, so my **force 1/3 spawner is
dark again** (2/3), second time it has gone.

**And the force is real.** C now has a **4-stack on `-2,1,0`** and a **3-stack on `-1,2,0`**, both
directly against my centre, plus singles all around. 19 heads against my 8.

**My heads were scattered again** — 1 on `-1,1,0`, 1 on `-1,2,2`, 2 on `0,2,1`, 4 on `-3,2,0` —
which is the same slack that cost me earlier, and it matters far more now that stacks are lives.

**Moves, both consolidation:**
1. The single on `-1,2,2` stepped onto `-1,1,0`, making a **pair** on the arrow that still holds my
   side of the 1/3 vertex. Next turn that pair can convert `0,1,1` back and close in the same two
   steps — the identical two-step combination that recovered it last time.
2. The **4-stack marched three tiles** through my own ground to `-1,2,2`, arriving beside the
   centre. Two stacks of 4 and 2 now sit on the contested vertex instead of four singletons spread
   over the board.

**Assessment.** C is at 131 land and 19 heads and is now taking my ground directly rather than
racing me for empty board. I cannot stop that with 8 heads. What I can do is keep the dense centre
paying and make every arrow C takes cost it a turn.

**Prompt-side note.** Losing territory to an *enclosure* is a different event from losing a trail to
a cut, and nothing announces it: no tag, no message, just two arrows that changed colour between
turns. I only noticed because I diff the arrow list every turn. A BYOK seat sees a fresh offer each
position with no memory of the previous one, so a slow territorial bleed is invisible to it by
construction — it would keep optimising local rows while its board shrank.

---

## Turn 30 (moves logged 400) — encircled; the worst move of the match was last turn's

**C closed a loop around my whole centre cluster.** The result:

- **Heads 8 → 2.** The 4-stack on `-1,2,2` and the pair on `-1,1,0` were both **inside the
  enclosure and were captured outright** — *"Closing claims enclosed ground, including enemy heads."*
  Six heads in one move, without a single combat exchange.
- Land 37 → **34** (`-1,1,0`, `-1,2,2`, `-2,2,0` gone).
- Income 41/36 → **25/36**: the 1/3 vertex is C's, and `-2,2,up` has dropped to 2/3.

**This was my mistake, made last turn, and I argued myself into it.** I consolidated two stacks onto
adjacent arrows *directly against a 4-stack and a 3-stack*, reasoning that stack size is lives and
scattered heads are slack. Both halves of that are true in a fight. Neither applies to an
**enclosure**, which does not fight at all — it takes everything inside the loop regardless of how
many lives are standing on it. Concentration is protection against combat and a *liability* against
closure, and I applied the first rule in a position that was about the second.

The tell was there: C had **two large stacks adjacent to a salient of mine**, and a salient is
exactly what is cheap to encircle. I read those stacks as an attack force to be matched, not as the
two ends of a loop.

**Where that leaves it.** 2 heads, 34 land, 7 spawners, 25/36 a round — still comfortably clear of
the starvation condition, which needs a seat to hold *no* share at all for `dominationN` = 5 rounds.
C is on 131 land and ~19 heads. The match is decided; what remains is whether I can keep producing
and make 34 arrows expensive to take.

**Plan.** Retreat the surviving pair from `0,2,1` — my most exposed arrow, adjacent to C's ground —
two tiles into the interior at `-2,4,2`, and rebuild head count off the spawners I still hold. Keep
future stacks **apart** and **off salients**.

**Prompt-side note — the prompt states the rule and never draws the defensive conclusion.**
`docs/byok-teaching.md` says plainly: *"Closing claims enclosed ground, including enemy heads."*
It is written entirely as an *offensive* fact, in a section about what your own close wins you.
Nothing anywhere tells a seat that the same sentence read backwards is the single most dangerous
thing that can happen to it, or that massing stacks near an opponent's two large groups is how you
get read backwards. That is the same failure shape as the sentry and the merge rules: **the prompt
teaches each mechanic from the attacker's side only.** Three independent instances is a pattern
worth fixing wholesale rather than clause by clause.

**Result.** The pair retreated to `-2,4,2` in the interior; the click applied at once and the turn
passed. C is now on **138 land and 28 heads** against my 34 and 2.

---

## Turn 31 (moves logged 429) — nothing lost, and a deliberate risk with the last two heads

**No further losses.** Land still 34, 7 spawners, 25/36. C is on 138+ land, ~28 heads, with a
**4-stack adjacent to my pair** on `-2,4,1` and an 8-stack in the middle of the board.

**Reasoning about what 2 heads are actually for.** Standing still protects nothing: territory is
lost to *enclosure*, and where my heads stand does not change whether C can draw a loop. Meanwhile
heads **regenerate** — 25/36 a round is a new head about every 1.4 rounds — and the losing
conditions are no territory, or no spawner share for `dominationN` = 5 rounds. **Having zero heads
is survivable; having zero shares is not.** So hoarding the last pair has almost no defensive value,
and spending it on income has a bounded downside.

**The move.** `-2,2,up` has been at 2/3 since the encirclement, one arrow short — and that arrow,
`-2,2,0`, is **two steps away and reachable**: `-2,4,2 → -2,3,0` (my own ground) `→ -2,2,0`
(C's, **convert**). The close has to wait for next turn, so the pair will sit exposed for one round
next to a 4-stack.

Taking it: +4/36 permanently if it survives, two replaceable heads if it does not.

**Prompt-side note.** This is the first decision of the match driven by the *losing conditions*
rather than by gain — "what actually kills me" turns out to be shares, not heads, and that inverts
how the last pair should be used. `docs/byok-teaching.md` does state the win/lose rules up front
("A seat with no territory is lost… starvation"), but every other line of guidance is about
maximising gain, and nothing connects the two. A seat that reasoned from the loss condition
backwards would play its endgame very differently from one following the offer's tags.

**The conversion was not actually available — I misread the highlight.** `-2,2,0` showed in the
**palest wash** (`#6cc0ff`), which the help text defines as *"still reachable but not a single run
away"* — reachable eventually, **not** reachable this turn. The brighter `#8fd6ff` is the set you
can actually draft. I had been treating both as "reachable in my remaining steps" for several turns
and got away with it because the targets happened to be on one run; here the draft was refused with
*"Too far this turn"* after the first leg.

So the pair took the one legal leg to `-2,3,0`, and from there every option is my own territory —
`-2,2,0` is not reachable from that side at all. The plan was built on a misreading of three shades
of blue.

**Worth recording as a UI finding in its own right:** the three run-highlight colours encode
*drafted / one-run-away / reachable-some-day*, and nothing distinguishes the second from the third
except brightness, at a stroke width of 2 to 3 pixels. I have been reading them out of the DOM all
match and still conflated them. A human is reading them by eye.

C ended the turn on **144 land and 29 heads** to my 34 and 2.

---

## Turn 32 (moves logged ~431) — no gaining move exists, so play a denying one

**Nothing lost again.** 34 land, 7 spawners, 25/36, 2 heads on `-2,3,0`.

**Checked every conversion within one run** (`-1,2,2`, `0,3,0`, `-2,4,1` — all C's) against my own
income: **none of them adds a spawner.** For the first time in the match there is no move that
improves my position at all.

**So score the other direction instead.** `-1,1,up` — the force **1/3** vertex C took off me — is
bordered by `-1,1,0`, `0,1,1` and `-1,2,2`, and C now holds all three. **`-1,2,2` is one run away.**
Converting it drops C's best spawner to 2/3 and **costs C 12/36 a head per round**, which is half
my entire remaining income and far more than anything I can gain.

The pair will sit on an open one-arrow trail afterwards — `-1,2,2`'s exits are all C's, so there is
no close — next to several large stacks, and will probably die. By the reasoning from last turn
that is the right price: heads regenerate from shares, shares do not regenerate from heads.

**Prompt-side note.** Every scorer I have written this match, and every tag in the BYOK offer,
measures *my* gain. Neither has any notion of **denial** — reducing an opponent's production rather
than raising mine — even though at this point denial is worth three times more per step than
anything else on the board. `share+N` marks what a row wins me; nothing marks what a row costs
someone else. In a position where you are behind, that is exactly backwards.

**Result — the attack failed, and it was a blunder, not bad luck.**

`-1,2,2` was not an empty enemy arrow. **C had a 4-stack standing on it.** Combat is a deterministic
1:1 exchange and stack size is lives, so walking 2 heads into 4 trades my entire army for half of
one of C's stacks. No conversion happened; the arrow is still C's, there is no trail, and I am left
with **1 head** (on `-2,2,2`, from this round's production).

**What I actually did wrong.** I evaluated `-1,2,2` on exactly two axes — *who owns it* and *what
spawner it feeds* — and never asked **who is standing on it**. I had the data: my own head-position
scan, run at the start of this very turn, listed `4×-1,2,2/C`. The board also shows it directly
("bold tile edge = occupied"). I read the ownership colour off the DOM, computed the denial value,
and never cross-referenced the two tables I had side by side.

This is the same failure as turn 7's: substituting a cheaper computed proxy ("is this arrow C's, and
does it feed a spawner I want to break") for the fuller question, and never re-checking the proxy
against the board. Twice in one match, on the two most consequential moves I made.

**Prompt-side note — and this one is in the BYOK seat's favour.** A seat playing from
`legalMoves` cannot make this mistake *silently*: the engine generates the row, and a move into an
occupied arrow is a combat row with the exchange known to the rules. My advantage all match has been
seeing further than one step; my disadvantage has been that I had to **reconstruct the current state
myself**, from colours and label positions, and nothing checked my reconstruction. The offer is
shallow but it is *correct by construction* — the second time that trade-off has decided a move.

---

## Turn 33 (moves logged 488) — collapse

**Land 34 → 29.** C took `-2,1,1`, `-2,2,1`, `-2,2,2`, `-3,2,0`, `-3,3,2` — five arrows in one
turn, which cost me **two more spawners** (`-3,1,down`, `-3,2,up`). Income **25/36 → 17/36**:
two 1/9 and three 1/12 left, with `-2,2,up` at 2/3.

**And I had misread my own position again.** My pair was not where I thought: last turn's move *did*
put them onto `-1,2,2`, but the arrow **did not convert** — they are simply standing on C's
territory. Converting needs a trail home (SPEC's refused grain), and they stepped out of my ground
onto enemy ground with no anchor, so they occupy without owning. Two heads parked uselessly inside
C's territory, five tiles from anything of mine.

So the "blunder" I logged last turn was not a lost combat at all — it was a **refused conversion
that I read as a lost fight**, because I inferred the outcome from head counts instead of checking
the arrow's owner. Third time this match that I have substituted an inference for a check.

**Move.** Walked them back toward my own ground. There is nothing else: every arrow within reach is
C's, converting any of them is refused without an anchor, and attacking into stacks of 4 and 8 with
2 heads is arithmetic I have already done the expensive way.

**Standing.** C **164 land, 33 heads**. Me 29 land, 2 heads, 17/36. C is taking ~5 arrows a turn;
on that curve I have about six turns of territory left, and the starvation clock only starts when
the last share goes.

**The honest summary of my play.** I won the economic game decisively — 6/36 to 41/36, the best
production per arrow on the board — and lost the match in four turns once C turned up, to three
errors of the same kind: a proxy trusted instead of the board (turn 7), stacks massed into an
encirclement (turn 29), and a conversion attempted without an anchor (turn 32). Every one of them
was *available* to check. None of them was checked.

---

## Turn 34 (moves logged ~500) — recovering an anchor

**No losses this turn.** 29 land, 5 spawners, 17/36, 2 heads.

**Found my pair was still stranded.** They were standing on `-2,2,1` — C's ground, no trail, no
anchor — which is *also* the exact arrow `-2,2,up` needs to go from 2/3 back to 3/3. Standing on it
does nothing: ownership only changes by conversion, and conversion is refused without a trail home.

**So the move was to go home and get the anchor back.** Stepped onto `-3,3,0`, my own territory.
From there, next turn, a step back out onto an adjacent enemy arrow *would* convert, because the
trail would be anchored to the ground I left.

That is the whole lesson of the last three turns in one line: **a head on enemy ground is worth
nothing unless there is a trail behind it.** I spent four turns and my entire army learning it,
having read the sentence that says so — *"refused (not-allowed) grain = would convert with no trail
home"* — in the app's own help text on turn 1.

**Standing.** C **166 land, 36 heads**. Me 29 land, 2 heads, 17/36 a round.

**Prompt-side note.** The anchor rule is the clearest case in the match of a mechanic that is
*stated* in the help text and in SPEC's vocabulary (`anchor`: "what holds a trail live"), is absent
from `docs/byok-teaching.md` entirely, and is invisible in the offer — because the offer only ever
shows **legal** moves, a seat never learns that a move is refused or why. It cannot discover the
rule by trying; the row simply is not there. Every rule the engine enforces by omission is a rule
the BYOK seat can never learn from play.

---

## Turn 35 (moves logged 549) — the end

**Land 29 → 25, and the pair is gone.** I am on **1 head, 25 arrows**. C is on **281 land and 41
heads**; A is third and further behind than me.

**The last move was also a stale-coordinate error.** I computed the correct target — a denial scan
showed `-2,2,2` was the one arrow in reach worth taking, costing C **4/36** a round, and it was
unoccupied — then clicked a screen position captured *before* the board panned. The click landed
somewhere else, the pair moved and was lost, and `-2,2,2` is still C's.

That is the fourth error of the same family in this match, and they are all one thing: **I was
reconstructing the board from pixel positions, and the board moves.** Every analytical advantage I
had — the loop search, the income scorer, the denial scan — was correct every time. Every failure
came from the step where I turned a computed answer back into a click.

### Final standing

| seat | land | heads | notes |
|---|---|---|---|
| C (human) | 281 | 41 | won |
| B (Claude) | 25 | 1 | peaked at 39 land, 41/36 income, best production per arrow |
| A (heuristic) | — | — | third |

### Verdict on the match

I won the economic game outright and lost the actual game. Production went 6/36 → 41/36 in
twenty-one turns, and at its peak my 39 arrows out-produced C's ~130 per arrow by a wide margin.
Then C arrived, and economy stopped being the thing being scored.

---

## Turn 36 — a new finding: territory is "free movement" but still grain-bound

**Nothing lost.** 25 land, 3 heads, but **only one stack could move at all**, and every arrow it
could reach was my own back-country. Its exits all run *away* from the frontier with C.

**This is a real rule interaction I had not hit before.** SPEC calls territory *"free, trail-less,
safe movement"*, and I had been reading "free" as *unconstrained*. It is not: **movement follows
the grain everywhere, including inside your own ground.** A head that ends up in the wrong part of
your territory cannot simply walk back to the front — it can only go where the arrows point, and on
this tiling that can mean a long loop or no route at all.

Consequence for play: **where a head is produced matters**, and reinforcements are not fungible.
Two of my three heads were effectively out of the game, not because of an enemy, but because the
grain in my south-east corner runs away from the fighting. I spent the whole match treating my
territory as a place I could reposition through at will; it is a one-way road network.

**Prompt-side note.** This is invisible in the offer *and* misleading in the prompt.
`docs/byok-teaching.md` says "territory: free, trail-less, safe movement" with no mention that the
grain still binds, and the offer shows only the current stack's legal steps — so a seat can never
see that a head is *stranded*, only that this turn's rows are few. "Few rows" and "no route home"
look identical from inside a single offer.

C ended on **282 land, 47 heads**.

---

## Turn 37 — two heads permanently stranded, and a lit ray that is not a legal move

**Nothing lost; heads up to 5** (the five spawners keep paying). But cycling every stack showed:

- Two stacks sit in my own **back-country**, all of whose exits lead further away from C.
- One stack of **2 heads is inside C's territory** on `-2,2,2` — where my misclick left it two
  turns ago. Every arrow it can reach is C's, **none is occupied**, and it has no trail.

That stack can do **nothing, ever**:
- it cannot **convert**, because conversion needs a trail home and it has no anchor;
- it cannot **fight**, because no adjacent arrow has an enemy head on it;
- it cannot **go home**, because the grain from there does not lead back to my ground.

**And then the sharper finding.** I tried to walk it onto `-1,1,0` — a border of C's 1/3 spawner.
That arrow was **lit as a one-run ray** (`#8fd6ff`), exactly like a legal destination. The click
did **nothing at all**: no move, no draft, no error, no message. The run highlight shows *geometric*
reachability along the grain; it does **not** mean the move is legal. The legality test — *would
this convert with no trail home?* — is applied only when you click, and its failure is silent.

So the UI has three highlight colours for reachability, two of which I have already conflated, and
**at least one of them can mean "you cannot actually do this"**. A player learns the difference by
clicking and watching nothing happen.

**Prompt-side note — and this one is squarely in the BYOK seat's favour again.** `legalMoves` would
simply not contain that row. The seat cannot attempt an illegal move, cannot be silently refused,
and cannot strand itself the way I did, because the engine answers the legality question *before*
the model ever sees the position. Everything I have found about the prompt being too shallow has to
be weighed against this: the offer is the only part of the system that is never wrong.

C ended on **338 land and 57 heads**.

---

## Turn 38 — the stranded pair is gone, and the economy is back to where it started

**C enclosed the stranded stack and nine more arrows.** Land 25 → **16**; the 2 heads on `-2,2,2`
were captured. The audit:

```
3/3  SPAWNER 1/12  -5,4,down,  -5,5,up
2/3  SPAWNER 1/12  -4,4,up
income = 6/36 a head per round
```

**6/36 — exactly what I had at turn 7**, before any of the inward campaign. The entire economic
arc of the match has been undone, in six turns, by about forty heads.

**4 heads left, all singletons, all in the back-country**, and the grain there runs away from C.
Every stack's reachable set is my own ground plus two unclaimed arrows. I walked one onto `-5,5,1`
— free ground, no income, but it is the only move on the board that changes anything at all.

**Observation for the balance pile, not the prompt pile.** The collapse from 39 land / 41-per-36 to
16 land / 6-per-36 took six turns and was never contestable once it started. The attacker needed
no combat: **every one of my losses came from enclosure**, not from heads killing heads. In 38 turns
of this match, across three seats, I believe **not one head has ever been killed in combat** — every
head that died was captured inside a closure. If that is representative, the 1:1 combat exchange is
close to vestigial at this board size, and enclosure is the whole game.

C: **347 land, 63 heads**.

---

## Turn 39 — I finally read the rule, and I had it backwards all match

**Land 16 → 14, down to one spawner, income 3/36.** `-5,4,down` is at 2/3, one arrow short:
`-4,5,2`, which C took last turn.

I tried to take it back from `-5,5,0` — my own territory, one run away — and the step did nothing,
twice, silently. So I read the engine instead of guessing, and the rule is not what I have been
assuming since turn 23.

`packages/rules-core/src/selfConvert.ts`:

> *A grain step onto another player's territory **converts the mover** unless they are
> territory-grade protected from `from`.*
> `SELF_CONVERT_MESSAGE = 'step onto enemy territory without a territory-grade trail would convert'`

**The conversion is of the head, not of the land.** Stepping onto enemy territory does not take
that arrow — it risks **your own head defecting to the owner**, and the step is omitted from
`legalMoves` entirely unless you are protected (standing on your own territory, or on your own trail
at territory grade).

So what actually happened on turn 23, when I "converted `-1,1,0` back"? I was protected, the step
was legal, it laid **my trail across their arrow**, and the *closure* two steps later is what
claimed it. Enemy ground is taken by **closing around it**, never by walking onto it. I have been
calling that manoeuvre "conversion" for sixteen turns and describing the mechanism wrongly every
time, while getting the right answer by accident because I always closed in the same turn.

**That makes it the fourth and worst instance of the same habit:** a model inferred from one
successful outcome, never checked against the source, and carried for the rest of the match.
The information was in the repo the whole time — one file, forty lines, with the rule in its
docstring.

**The UI cost me the turn as well.** My first click was consumed as a selection change rather than
a move; by the time I had cycled back, `Next stack` would no longer offer that stack, because its
step had been spent. Fifth turn lost to selection ambiguity.

**Prompt-side note.** `docs/byok-teaching.md` has no mention of self-conversion, of territory-grade
protection, or of the fact that enemy territory is taken only by closure. A BYOK seat is protected
from the *consequence* — `legalMoves` omits the step — but is never told the *rule*, so it cannot
plan around it: it cannot know that walking a head toward enemy ground is safe only while a
territory-grade anchor holds behind it, and it will read the missing rows as "fewer options here"
rather than "I am unprotected".

C: **349 land, 69 heads**. Me: 14 land, 3 heads, 3/36.
