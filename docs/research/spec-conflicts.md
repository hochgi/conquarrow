# SPEC conflict register

The register for [P86](../design/packets/P86-spec-conflict-resolution.md).
It lists every place where two live statements give different answers for
one position, or where the engine does something other than what SPEC.md says.

**Sources read** (inventory, 2026-11-05):
- SPEC.md in full, §1 to Appendix A;
- ADR 0001 and ADR 0005;
- the rules packet specs under `docs/spec/`: `birth-cut`, `chord-test`,
  `closure`, `combat`, `convert-spent`, `crossings`, `cuts`, `economy`,
  `encircled-path`, `encirclement`, `fill`, `geometry-port`,
  `immediate-loss`, `losing-conditions`, `mirrored-spawner-field`, `move`,
  `movement`, `raider-survives-claim`, `rational`, `refuse-self-convert`,
  `tiling`, `trails`, `trails-simple`, `won-is-over`;
- the web bot modules and test oracles that restate a rule.

SPEC line numbers are at `f25b0c4`.

**Kinds** (from the packet):
- **stale prose:** a later decision is recorded, and the sentence was not
  updated. Fixed BSSN in the SPEC rewrite.
- **rule conflict:** both sentences are live and nothing recorded settles
  them. The human decides.
- **code divergence:** SPEC is consistent and the engine does something else.
  It gets a failing test and a fix.
- **suspected:** no concrete case yet.

**Cases** were run on `p86-scratch` fixture tests against `rules-core` at
`f25b0c4`. The scratch file is not committed. Each case becomes a committed
test in the alignment step.

## Counts

| Kind | Rows |
|---|---|
| Rule conflict | 3 (R1–R3), all ruled 2026-11-05; 2 decided before this audit (C1, C2) |
| Code divergence | 3 (D1–D3), plus the code changes for C2 and R2 |
| Stale prose | 44 (S1–S44) |
| Suspected | 4 (U1–U4) |
| Gap (to §11) | 0 new |

## Status

C2, R2, R3, D1 and D2 are fixed in the engine by
[P88](../design/packets/P88-spec-alignment.md). R1 is pinned by a P88 test.

## Rulings (the human, 2026-11-05)

- **R1: (a).** A stack on its owner's land can be attacked. The attacker
  needs a lifeline: it steps from its own territory (a trail of length 0) or
  from a territory-grade trail. That is the existing self-convert gate (§6.3),
  so the engine needs no change. §5:346 and §4:260 are rewritten.
- **R2: taking the anchor land is a cut.** The human asked for a case first;
  it exists (see R2 below). The ruling, from the human's own words:
  - When a claim takes a trail's anchoring land (the last clean territory
    feeder into its root point), evaporation runs from the anchor up to the
    nearest firebreak, the owner's stack. This is §6.1's territory-root cut,
    triggered by a claim rather than a mark.
  - A stack the claim did not enclose converts only by the ordinary §6.3
    rule: "A stack standing on enemy land with no life line to its own
    territory is converted to the same seat as the land it stands on."
  - "If multiple firebreaks exist on that trail, evaporation should start
    from converted stack outwards until it reaches the next firebreak standing
    on a neutral tile." That is the existing convert wipe (§6.3:533), and the
    alignment step fixes D1 so the engine does it.
- **R3: (a).** "To cross a trail and cause evaporation the crossing must
  succeed. So if a smaller stack tries to attack a bigger enemy stack and
  fails, it did not cross. This should not cause evaporation." D3 is a code
  fix.

## Decided before this audit

### C1. A territory-grade raider survives a claim

- **Sentences:** §6.3 "You cannot capture a trail-connected raider by claim
  alone"; §7 "Closing grants the enclosed tiles **and everything standing on
  them**", against the P13 strip in `closure.commit`.
- **Case:** `docs/research/playtest-2026-11-04/match-log.json` #345 and
  #329 → #331.
- **Kind:** rule conflict.
- **Resolution:** the human, 2026-11-04: the raider is not converted, and its
  shielding stretch stays. Shipped by
  [P87](../design/packets/P87-raider-survives-claim.md) (`74e97ff`).

### C2. A claim does not demote an uncut trail

- **Sentences:**
  - §7:574 "Enemy trail on a claimed tile is removed, unless it belongs to a
    territory-grade stretch carrying one of its owner's stacks that stands on
    another player's territory."
  - §7:576 "the engine strips it today".
  - §11:1226, item 51.
  - Against these: §6.3:531 "A cut must first evaporate up to their anchor
    and drop the grade", and §11:1099 (item 40) "Territory-grade trail still
    prevents conversion until a cut demotes it".
- **Case:** `raider-survives-claim.edge-cases.feature`, "A raider on neutral
  ground loses the part of its trail the claim takes".
- **Today:** the claim strips `r`, and the raider drops to stack grade.
- **Kind:** rule conflict.
- **Resolution:** the human, 2026-11-05: spare it. "If the trail isn't cut,
  there shouldn't be any evaporation." A claim alone never demotes a
  territory-grade trail that carries the owner's stack, wherever the stack
  stands. SPEC §7 is rewritten and item 51 deleted in the SPEC rewrite; the
  pinned scenario flips in the alignment step.

## Rule conflicts for the human

### R1. Can a stack on its owner's territory be attacked?

- **Sentences:**
  - §5:346 "A head with **no open trail** … has **no attack surface at
    all**. It cannot be cut. It can only be taken by encirclement."
  - §4:260 "In your own territory it cannot be touched".
  - Against these:
    - §6.2:481 "An attack is an ordinary step whose destination arrow is
      occupied by an enemy group."
    - §6.3:529 and §7:610: a territory-grade raider may step onto enemy
      territory.
    - §6.2:513 (item 39) parks "territory combat modifiers", which assumes
      such combat exists.
  - `refuse-self-convert.edge-cases.feature:27-34` pins "Protected raid may
    still attack on enemy territory".
- **Case:** fixture board, B ×4 on B's territory `ourIn`, and A ×1 on A's
  territory `ourExit`. B steps 3 onto `ourExit`.
- **Today:** `legalMoves` offers the step. B wins, and B ×3 stands on A's
  arrow `ourExit`.
- **Readings in play:**
  - **(a) Combat on territory is legal (today).** A raider whose trail
    reaches home can fight its way into enemy land. A border garrison is
    only as safe as its size. §5:346 and §4:260 get rewritten to "cannot be
    cut"; heads on territory can still be fought.
  - **(b) Heads on their owner's territory cannot be attacked.** An arrow of
    enemy territory holding an enemy stack is not a legal destination. Land
    is fully safe from heads, and a raid can only carve ground by closure
    (§7:610). A turtle's garrison is unkillable until a closure takes its
    ground. This would be noticed in play: the bots attack border stacks
    today.

### R2. Does a claim that takes the raider's anchor territory convert it?

- **Sentences:**
  - §6.3:531 "Grade is read on the board the closure leaves (§7)", and §7:576
    "a stretch whose only anchor the claim itself carved out is not territory
    grade and is removed." P87 decision 3 is behind both
    (`raider-survives-claim.md:69-74`). That was decided in P87 by the agent
    (BSSN), not by the human.
  - Against these: §6.3:531 "You cannot capture a trail-connected raider by
    claim alone", and C2's principle, "If the trail isn't cut, there
    shouldn't be any evaporation."
- **Case:** `raider-survives-claim.edge-cases.feature:40-47`, "A closure that
  carves out the raider's anchoring territory converts it". B stands on `p`,
  which A's closure claims. B's trail is territory grade only through B's
  territory arrow `f`, and the closure also claims `f`.
- **Today:** `f` and `p` become A's, B's stack on `p` converts to A, and `p`
  leaves B's trail. No cut happens.
- **Readings in play:**
  - **(a) It converts (today).** Grade is read after the claim. Taking the
    feeder takes the anchor, so a big enough closure captures a raider
    outright, with no cut. A raider anchored through a thin neck of home
    ground is vulnerable to a closure that swallows the neck.
  - **(b) It survives.** Grade is read before the claim, as C2 reads it for
    the road home. The raider and its trail stay, on A's land, and it
    converts only after a cut. Taking land never captures a trail-connected
    raider by itself; only cuts do. This is the same as C1 and C2 applied to
    the anchor as well as the road.
  - **The case the human asked for** (generated tiling). A's ring is
    `tiling:a:` `0,0,0 → 1,0,0 → 2,0,1 → 1,1,1 → 0,2,2 → 0,1,2`. The first
    three arrows are A's land already and the last three are A's trail; A
    closes from `0,1,2` onto `0,0,0`. B's land `f` = `1,1,2` is inside the
    ring. B ×1 stands on `e` = `1,0,2`, which leaves `f`'s head point (a
    point of A's land) outward. B's trail is `{e}`, territory grade through
    `f`. A's closure does not cross B's trail.
    - `e` neutral: today B keeps the stack and its trail drops to stack grade.
    - `e` on A's land: today B's stack converts to A.
    So a claim can take the anchor with no cut and without enclosing the
    stack.
  - If (b): what anchors the surviving stretch afterwards? It reaches no B
    territory any more, so it would be stack grade after the move. That
    means it converts at the next state check: the same bug one move later
    (P87 decision 1). So (b) needs an extra rule, for example "a stretch
    keeps the grade it had until a cut". **That is a new rule,** so (b) is
    really "(b) plus a grade-memory rule". Without one, (a) is the only
    stable answer.

### R3. Does a repelled attack cut?

- **Sentences:**
  - §6.1:399 "An enemy head crosses your open trail at a **point**. If the
    crossing succeeds, the trail evaporates in both directions from the cut
    point".
  - §6.2:500 "A = 0: the attacker does not land and does not mark the
    destination".
  - Against these:
    - §6.2:512 "If the destination is enemy-occupied and the traversal
      crosses that player's trail (`chordsCross`), resolve combat first, then
      cut against the trail set". This puts no condition on the outcome.
    - §11:1076 (item 37) "combat first, then cut".
- **Case:** fixture board, interleaving point `P`. B's trail runs
  `trailIn → trailOut` through `P`, with `trailIn` as B's territory. B ×2
  stands on `ourExit`, its own trail. A ×2 on `ourIn` attacks with 1, and the
  step `ourIn → ourExit` interleaves B's chord.
- **Today:** A is repelled (A's 1 dies, B keeps 1 on `ourExit`, A does not
  mark `ourExit`). B's `trailOut` still evaporates. `movement.ts` `applyStep`
  calls `cuts.evaporate` whether or not the attacker landed.
- **Readings in play:**
  - **(a) A repelled attack does not cut.** The defender loses heads but keeps
    the trail. This matches C2's principle (no landing, no cut). An attack
    you lose costs you heads and buys nothing.
  - **(b) Any attack that crosses cuts, win or lose (today).** A suicide
    attack with 1 head burns every other arm through the point up to their
    garrisons. That makes a cheap one-head probe a cut, which §6.1 otherwise
    prices at a successful crossing.
  - A playtest would notice: the bots may use the cheap-probe cut.

## Code divergences

### D1. The convert wipe misses the trail beyond a claim

- **Sentences:**
  - §6.3:533 "The victim's trail evaporates from each converted arrow under
    the halt-at-first rule".
  - `encircled-path.md:57-58` "`evaporateFromArrow` must see the converted
    arrows **still in** the victim trail when it seeds — a prior strip … would
    no-op".
  - `encirclement.ts` header: "Do not pre-strip those arrows".
- **Case:** generated tiling, P87's `aClosing()`. B ×2 stands on an interior
  arrow `p`, with B trail `{p, road}`, where `road` leaves the pocket onto an
  unclaimed neutral arrow. No B territory feeds it, so it is stack grade.
- **Today:** B's stack on `p` converts to A (correct). `road` is **still B's
  trail**. `closure.commit` strips `p` from B's trail before
  `convertEncircled` runs. The wipe then seeds from an arrow that is no longer
  in the trail, and does nothing.
- **Should:** `road` evaporates. It is unoccupied and not territory.
- **Kind:** code divergence. The P87 order (strip, then convert) broke a P33
  invariant, and no test checks the trail off the claim.

### D2. An enemy-marked feeder still anchors territory grade

- **Sentences:**
  - §6.1:420 "A trail that first leaves point `P0` … is territory-anchored
    while at least one **in-arrow of `P0` that is the owner's territory** is
    **not** present in any enemy trail."
  - §6.1:434 "Take out the region touching the victim's territory and
    everything beyond survives … territory anchor gone — dropped to stack
    grade."
  - Against these: `trails.md:174-179` (any departure from own territory
    counts), and `stretch.ts` `stretchGrade`, which checks only
    `territory.get(feeder) === player`.
- **Case:** fixture board. B's trail is `{out}`, where `out` leaves `P0`, and
  B ×1 stands on `out`. B's only territory feeder into `P0` is `feeder`, and
  `feeder` is in A's trail. This is the board a territory-root cut leaves
  when its front halts at once on B's stack.
- **Today:** `anchorGrade(out, B)` is `territory`.
- **Should:** `stack`. The territory-root cut took the anchor. A territory-grade
  answer lets the stack resist conversion and step onto enemy land (§6.3:529).
- **Kind:** code divergence, with `trails.md` restating the code. A playtest
  could notice it in one shape: a raider cut at its root while standing on
  the first arrow out keeps raiding.

### D3. A repelled attack cuts

This is R3's code side. It is listed here so the alignment step does not lose
it if the human picks (a).

## Stale prose

Each row gives the stale sentence, the decision that supersedes it, and the
fix. The SPEC rewrite applies these. Packet-spec rows are fixed in the same PR
as the SPEC rewrite, or in the alignment packet that touches that spec.

### SPEC.md

| # | Stale sentence (line) | Superseded by | Fix |
|---|---|---|---|
| S1 | §11:982 item 24 "Each evaporation front carries one kill … a lone head is a toll and a pair is a wall"; §11:970 item 20, the pair is "the smallest garrison that actually halts a front" | P12, §6.1:403–407, 432 | Delete both with §11's resolved items |
| S2 | §3:204 "two is also the minimum sentry §5 allows" | P22, §5:373, item 27 | One head stops a front; the rules require none |
| S3 | §2:150 "Even-odd fill is correct as written"; §2:61 "Only an **interleave** inverts the enclosed lobes"; §6.1a:452 "(§7, even-odd)"; §6.1a:456 "Even-odd fill needs a boundary…" | Item 36, §7:556 (reachability) | State reachability; a self-crossing has no fill meaning |
| S4 | §2:33 "Points are where trails are crossed and where combat happens" | Item 37, §6.2:481 (combat is on the destination arrow) | Combat is per arrow |
| S5 | §2:40 "Crossing is defined as *traversing a point on the trail*"; §2:60 "an opponent traverses a point your trail passes through" | §2:46–48, the chord test (same section) | A crossing is a traversal whose chord interleaves or coincides |
| S6 | §4:288 "A 3-stack at 1.83" | Item 20, §3:190–197 | A 3-stack has 2 steps |
| S7 | §2:118 "two basis vectors and a modulus" | Item 4, §2:136 (the plane) | Drop "and a modulus" |
| S8 | §4:260 conveyor "one cut takes the whole region … the one place it can be taken away" | P12, §6.1:403 (a cut kills no heads) | A cut burns the bare links between parked heads |
| S9 | §3:220 "a constituent that already stepped this turn has therefore already used the merged stack's whole allowance" | §3:214, 233 (arrivals' `spent` is discarded) | The destination's own earlier step uses the speed-1 allowance |
| S10 | §1:21 "restricted fair seating to **3 or 6**"; §4:277 "MVP is 2 players"; §11:1141 "MVP is 2 players"; §8:789–795 two homes only | Item 11 (2–8 seats, homes per count), `MAX_PLAYERS = 8`; item 48 (fair for 2, 3, 6) | The engine takes 2–8 seats; the field is exactly fair for 2, 3, 6; the web lobby offers 3 or 6 (an adapter choice) |
| S11 | §2:116, §11:923 "{up, down-left, down-right}"; §4:294 "{N, SE, SW}" | §2:95, 113, 170: `OUT` at world 0°/120°/240° | One frame: 0°/120°/240° |
| S12 | §4:290 "or when no unit has a whole step left" | Item 19, §4:282 (ended explicitly); `movement.md:103-104` (only `endTurn` is offered) | The turn ends when the player ends it; with no step left, only `endTurn` is offered |
| S13 | §2:34 "costs 3 arrows and 3 heads" | §5:371 (linear trail carries no heads) | 3 arrows and 3 steps |
| S14 | §11:960 item 19 "A move is one unit, one step" | §4:284 (a move carries a count) | Delete with §11's resolved items |
| S15 | §6.1:416, §6.1a:469, §11:936 (item 8): dormant marks stand "until … re-attach, cut, or convert wipe" | The human, 2026-11-04 (C1): "Bare enemy trail inside a claim is still stripped, as P13 intended" | Add the claim strip to the list |
| S16 | §6.1:424 "Territory-grade trail can close"; §11:1004 item 28 | P42, §7:554, 562 (a stack-grade landing claims the same walk) | Grade governs conversion and entry onto enemy land, not closing |
| S17 | §6.1:412, 462 gloss "*Never against it*", a phrase no live rule states | P47 rewrite | Keep the meaning ("a front does not reverse along the arrow it just destroyed") without the quote |
| S18 | §7:553, 604, 606 "Land bridges remain available, but only between holdings you *already own*"; "A path can never terminate in open ground" | P42, §7:554, 567, 570 (salvage claims the whole fragment; a dead-end walk claims a strip) | Closure still requires landing; the claimed walk may begin at a fragment's stack in open ground |
| S19 | §7:610 "drive a chain into your territory and close a loop inside it" | §7:548–552 (depart and land on your own territory) | A raider departing its own ground and landing back carves what it rings |
| S20 | §7:596 "when the first arm lands, the whole drawn path becomes territory, stem included" | §7:566 (the other arm is downstream and stays trail) | "the walk to the landing becomes territory, stem included" |
| S21 | §7:566 "A fork's other arm … stays an open trail" | Trails invariant: an arrow is never both its owner's territory and trail (`closure.core.feature:169-170`); `closure.commit` clears the closer's own marks on all claimed ground | "…stays an open trail, except where fill claims it" |
| S22 | §7:632 "(both players have taken a turn)" | Item 41, §7:633 (`players[0]` boundary) | "every seat has taken a turn" |
| S23 | §7:659, 669, 671, 754, 761–765: rates in "turns" | Item 41 (accrual is once per full round) | Rates in rounds |
| S24 | §7:692 "Domination *N* = 5 full rounds" | Item 32, §9:827 (starvation) | "Starvation *N*" |
| S25 | §7:755 "Heads only actually die in two places" | P36 seat vanish, §9:819 | Combat kills; conversion transfers; a vanished seat's heads are removed |
| S26 | §7:600 "the stem being a single point of failure" | P47, §6.1:412 (a cut on one arm floods every arm) | The stem is where one cut demotes every arm; it is not the only such place |
| S27 | §7:633–636 and item 13 do not say whether an unowned share arrow accrues | P08 (`economy.edge-cases.feature:23-34`; `birth-cut.edge-cases.feature:34-38`): an unowned arrow accrues nothing and spawns nothing | State it in §7 |
| S28 | §9:814, 827, 943 vs §9:836, §11:900, 1040: starvation counted in "turns" | §9:819 "its streak counts *rounds*" | Rounds everywhere |
| S29 | §9:829, 869 "It ends a match"; §7:763 "elimination is mop-up" | P36, §9:827 (the seat is removed, not the match) | A starved seat leaves; the match ends at one seat |
| S30 | §9:816 "passed over until a spawner yields a head" | P37, §11:1116; `movement.ts` `nextPlayer` (nobody is skipped; a lost or headless seat is offered only the pass) | "offered only the pass" |
| S31 | §10:883 "Big stacks are slow" | §3:186 (a stack moves faster than a head) | "throughput-negative" only |
| S32 | §8:803 "deliberately deferred"; App. A:1237 "shelved until there's a real game" | App. A:1232 "Sunset" | Sunset |
| S33 | §8:797 "Those three numbers are the whole map" | Item 48 / P41 (`spawnerSeed`), item 11 (seat count) | List the seed and the seat count |
| S34 | §2:60 "Enemy cut — an opponent traverses a point your trail passes through" reads as the only kind of cut | §6.1:401 (territory-root cut, birth-cut and wipes reuse the fronts) | §2 points to §6.1 for every cut kind |
| S35 | §11:892 "Every structural item is resolved"; §11:916 "§11 has no remaining open rules question" | Item 51 (now decided) | §11 lists open items only |
| S36 | §6.3:533 "A remaining victim stack that did not convert (stack-grade on neutral ground)" | P87 (a territory-grade raider on enemy land also does not convert) | Drop the parenthesis |
| S37 | ADR 0001:12–13, 88 "a positional bonus", "defender wins ties", "nearest stack takes the hit" | Items 10, 37; §6.2:489–506 | Amend the ADR in place: no bonus, threat-weighted floor rule, equals favour the attacker |
| S38 | ADR 0001:46 "Accumulators **and movement banking** use exact rational arithmetic" | Item 20, §3:197 (integer allowance) | Accumulators only |
| S39 | ADR 0001:18 items 1, 5, 16 "outstanding measurements" | §2 (all three measured) | Amend the Context note |

### Packet specs

| # | Stale sentence (file:line) | Superseded by | Fix |
|---|---|---|---|
| S40 | Every packet spec below. Each restates a rule a later decision changed, and each is fixed in the SPEC rewrite PR as a one-line correction or an "(superseded by …)" pointer at the top of the file:<br>- `closure.md:36-37, 140, 141-142, 154-158`; `closure.core.feature:144-160`: unqualified strip, "leave every other trail unchanged", enemy head "keeps standing", "no accumulators yet". Superseded by P07, P08, P87<br>- `closure.edge-cases.feature:91-98`: branch-anchor refusal. Superseded by P22<br>- `cuts.core.feature:113`: "they keep standing here". Superseded by P07<br>- `chord-test.md:69-74`; `chord-test.edge-cases.feature:104-130`: combat and fill read chords. Superseded by items 36, 37<br>- `crossings.md:83, 132-133`; `crossings.core.feature:120-121`: lobe inversion; 1:1 at the point. Superseded by items 36, 37<br>- `move.md:32, 96-97`; `move.edge-cases.feature:99-102`: branch toll; pair garrison. Superseded by P12, P22<br>- `movement.md:27-28, 100, 113-114`; `movement.edge-cases.feature:41-47`: a step onto an enemy is refused. Superseded by P06<br>- `rational.core.feature:3, 65-68`; `rational.edge-cases.feature:72-82`: harmonic banking. Superseded by item 20<br>- `geometry-port.md:141-142, 160-161`; `geometry-port.core.feature:21-22, 104`: even-odd; combat at points; the self-trap reason. Superseded by items 36, 37, and §6.1a:473<br>- `immediate-loss.md:215-222`; `immediate-loss.core.feature:24-28`: item 46 "open". Superseded by P38<br>- `losing-conditions.md:148-153`: loss evaluated only at the boundary. Superseded by P37<br>- `losing-conditions.core.feature:93-97`; `losing-conditions.md:233-234`: "no legal move". Superseded by P37 (the pass is offered)<br>- `won-is-over.md:162-173`: "no cut can move any seat into a losing row". Superseded by §6.3:529 (a cut that demotes a raider inside enemy land converts it) | — | — |
| S41 | `mirrored-spawner-field.md:43, 99`: "{N, SE, SW}", "MVP is 2 seats" | S10, S11 | As S10, S11 |

### Found during the SPEC rewrite

| # | Stale sentence | Superseded by | Fix |
|---|---|---|---|
| S42 | AGENTS.md vocabulary, **anchor**: "Territory grade: can close and claim … Stack grade: … pays only a land bridge" | P42, §6.1 (grade does not govern closing) | Rewritten in the SPEC rewrite PR |
| S43 | S10's own fix said the field is "exactly fair for 2, 3, 6" | `geometry-tiling/src/setup.ts` thins at the reflection-orbit representative only, so the field is exact for 2 seats | §7 states the 2-seat mirror; 3 and 6 stay open in §11 |
| S44 | §1, §5, §9 "You can only be hurt while you are growing" | R1 (a home stack can be attacked) | "cut" instead of "hurt" |

## Suspected

- **U1.** `birth-cut.edge-cases.feature:26-32` pins "a friendly birth onto
  its own trail merges and does not cut" on a Given that cannot happen. The
  feed arrow is both A's territory and A's trail, which the trails invariant
  forbids. The rule (a friendly birth does not cut) is not in doubt; the
  fixture is. Re-author it on a reachable board in the alignment step.
- **U2.** `losing-conditions.edge-cases.feature:161-166` says no winner in an
  every-seat-lost state. `immediate-loss.md:160-161` (invariant 11) says
  `winner` is never unset there. Both agree the state is unreachable. Check
  which assertion the committed tests make, and keep one.
- **U3.** `closure.edge-cases.feature:82-89` pins "A closure onto an arrow
  the enemy occupies is refused", calling contact "P06" and the arrow
  unenterable. After R1 a stack on its owner's land can be attacked, so the
  Given may only be refused by the stay-behind rule. Check the test's
  reason in the alignment step.
- **U4.** Leftovers in packet specs, not in S40: `move.md:56` (the turn
  "ends" when no step is left, S12); `crossings.md:78` (a heading that
  assumes a narrower §7 predicate); P87's `raider-survives-claim.md` restates
  decision 4 in its terms and invariants (P88 flips the tests).

## Removing trail without a cut or a wipe

The C2 lens: every path that removes trail other than a cut (§6.1), a combat
wipe, a convert wipe or a birth-cut.

| Path | Status |
|---|---|
| Claim strip of a stretch that shields a raider on enemy land | C1, shipped |
| Claim strip of a territory-grade road home whose stack stands on neutral ground | C2, decided; to build |
| Claim strip of the raider's anchor territory (the feeder) | R2 |
| Repelled attack evaporating the defender's other arms | R3 / D3 |
| Claim strip of bare and dormant enemy trail | Decided (C1 ruling); S15 |
| The closer's own marks on claimed ground | Not a removal: they become territory (S21) |
| Seat vanish clears a lost seat's marks | Decided (item 45, P39); not a cut |

## Bot modules and test oracles that restate a rule

These read a rule without going through `RulesPort`. They follow SPEC only as
long as someone keeps them in step. Listed for the alignment step; none is in
P86's scope to change.

| Module | What it restates | Today |
|---|---|---|
| `packages/web/src/findings.ts:502-532` `claimedForClose` / `overlayClaimed` | the claim walk | Claims every own trail arrow and clears the whole own trail. That is wrong for a downstream fork arm, and fill is not modelled |
| `packages/web/src/botClose.ts:199-216` `estimateCloseLoot` | the claim walk | Same estimate as above |
| `packages/web/src/botFinish.ts:211-226` `scoreLanding` | which arrows the walk claims | Fill goes through the port; the walk is restated |
| `packages/web/test/heuristic-finishes.support.ts:290-307` `claimEstimate` | the same, as a test oracle | — |
| `packages/web/src/refusedConvert.ts:16-31` | `isSelfConvertStep` | Copied by design (D10). It matches today |
| `packages/web/src/byokBot.ts:293-304` `cutOrNearTrailTags` | what a cut is | Tags coincide only. It misses interleave crossings and territory-root cuts |
| `packages/web/src/byokBot.ts:389-396` `portionSlot` | allowance | Matches §3 |
| `packages/web/src/findings.ts:437-444` `isCutMove` | what a cut is | Any enemy trail that shrank. A claim strip counts as a cut |
| `packages/web/src/fx/events.ts:403-446` `groundEvents` | what a cut is | A claim strip is drawn as a cut. Item 45 called this reading wrong for seat vanish |
| `packages/web/test/victory-fx.support.ts:103-138` | loss conditions | Authored boards use pre-P36 elimination and starvation |
| `packages/mcp/src` | everything | The parked greedy-v1 copy (known drift; out of scope) |

## History in SPEC.md

The inventory found 95 strikethroughs and about 24 history notes. The SPEC
rewrite removes them all. These notes carry a *why* that still matters, and
the rewrite keeps each as present-tense reasoning or moves it to an ADR:
- all-to-all rather than a pairing convention (§6.1a:465);
- why a halt is per arrow and not per point (§6.1a:517);
- why fill is reachability and not parity (§7:556);
- the band-shape rationale, 729:1 versus 4:1 (§7:709–722);
- the integer speed curve, chosen for readability (§3:199);
- why the merge override rides with the heads (§3:218);
- why naming a destination was the wrong move model (§5:387);
- why the turtle is a losing position (§9:848);
- why seat vanish clears and does not evaporate (§9:819, item 45);
- why no no-survivor state is reachable (item 44);
- the birth-cut order (item 47 at §11:1122), which is a **rule** and moves to
  §6.1;
- the P02 fixture floor and the finiteness argument (item 29).

## The fresh reading (step 3's closing check, 2026-11-05)

A fresh `reviewer` agent read only the rewritten SPEC.md. It found 7
rule-level items, 11 wording items, 5 cross-references and 4 history
leftovers. All were fixed in the same PR, except two gaps that no recorded
decision settles. Those are open in §11 for the human:

| # | Gap | Engine today |
|---|---|---|
| G1 | **Both sides wiped in one battle** (§11 item 5). 2 v 3: weights 9∶10, the defender loses 3, the attacker 2.7 capped at 2. "*D* = 0: lands" and "*A* = 0: does not land" both apply | Treated as a landing: it marks, both stacks are wiped, and the crossing cuts |
| G2 | **Conversion after a birth-cut at the round boundary** (§11 item 6). A birth on seat Y's own `endTurn` cuts Y's trail and demotes a Y raider on X's land. "Conversion triggers on state" against "a turn in which nothing stepped converts nothing" (P51) | Nothing converts at the boundary; the raider converts after the next step anyone takes |

The other rule-level items were stated more than one way and settled by
existing packets or the engine:
- the entry test for enemy land is the P28 predicate;
- a winning attack onto your own territory marks nothing (§5) and closes from
  a trail (§7);
- a stub coincide is a crossing (P05 crossings);
- a runner keeps its shares until carved;
- a repelled step cuts no trail, a third player's included (R3).
