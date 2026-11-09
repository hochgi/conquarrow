# Backlog

The one list of work that is known but not finished. Every session reads it
from the checkout. A packet in the [packet index](./02-work-packets.md) is the
detailed form of an item; this file is the short list and the order.

**How to keep it:**
- When work ships, delete its item in the same PR. Git keeps the history.
- When something new turns up (a playtest, a review note, a measurement),
  add an item with its source.
- When an item gets a packet, link it.
- Game-rule questions are the human's. Everything else, decide and record.

## Next

1. **P86 leftovers.** (Also check playtest 2026-11-07 move 333: A landed on
   C's empty trail arrow, a clean cut, but the human read the screen as a
   repelled attack; see whether `fx/events.ts` showed a battle.) Bot modules
   and test oracles that restate a rule
   (register, last table): the claim estimate in `findings.ts` /
   `botClose.ts`, "any trail drop is a cut" in `findings.ts` and
   `fx/events.ts`, and coincide-only cut tags in `byokBot.ts`. Suspected
   rows U1–U4.
2. **P88 shifted the bot games.** Mirror median 85 → 104 rounds; three
   3-player reach winners changed; encirclement losses +46 %
   ([ledger](../research/byok-benchmark.md)). Expected from the rulings. Worth
   a look when the heuristic seat's income work starts.
3. **Root-cut corners from the P88 review.**
   - **A re-mark of a dirty feeder.** `cuts.territoryRootCuts` cuts again
     when an enemy step re-marks a feeder that was already dirty, with no
     clean feeder left. This predates P88: the post-mark state cannot tell
     whether the feeder was clean before.
   - **A third seat's root cut can restore a grade.** With 3 or more seats,
     a claim root cut on seat C, which runs before conversion, can re-clean a
     feeder of seat B. B's group then keeps a mark on the closer's land that
     was not territory grade on the post-claim board (SPEC §7).
   - Both need a fixture first.
4. **P89 review: the boundary order has one untested step.** Nothing pins
   conversion running before the starvation tick at the round boundary
   (SPEC §7); swapping the two calls in `endRound` would likely pass. Needs a
   fixture where the tick and a conversion touch the same seat.

## Combat

- **No battle should wipe both sides.** The human, 2026-11-05: "not allow
  mutual destruction battles". Today 2 v 3, 3 v 4, 4 v 6, 5 v 7, … wipe both
  sides, and P89 treats that as the A = 0 outcome (the defender is still wiped). Revisit the §6.2 loss
  rule, for example the magnitude or cap step, so that one side always
  survives. This is a rules decision for the human.

## Heuristic seat

- **P91's mirror games got shorter; the playtest did not show a new loop.**
  Median 104 → 71, not tuned
  ([ledger](../research/byok-benchmark.md#p91-2026-11-08-the-live-sortie-credit-pays-only-a-sortie-that-grew)).
  [Playtest 2026-11-08](../research/playtest-2026-11-08/FINDINGS.md): the
  human (seat A) won at r39, sorties grew and closed, and the seat did not
  close too soon. No follow-up unless a later game rings.
- **The sortie credit can outweigh the close it prices.** P85 credits an
  open sortie at half its projected loot, on the premise that a pending
  close is worth less than a banked one. In the loop fixtures it is worth
  more: L1's credit is 3475 while the close adds 1696 to `evaluate`. P91
  stops it trapping the seat; resize it (or price it from the close's real
  gain), then re-run `mirror` and `reach` against the P91 ledger, not P89.
  Source:
  [P91 spec](../spec/heuristic-loop-of-doom/heuristic-loop-of-doom.md#diagnosis).
- **Income, not land, is the gap.** Playtest 2026-11-04: at r30 the human's
  income was 10.92 against the bots' 2.56; P85 missed its income gate
  (1.23×). The seat should value spawner shares, and close again after its
  opening sortie (9–10 closes in 42 rounds against the human's 38).
  Confirmed 2026-11-08, human as A: r20 income 7.81 against 3.50 and 2.67;
  bots closed on 8 and 6 turns against 22. No pass while a step was legal.
  Source: [11-04](../research/playtest-2026-11-04/FINDINGS.md),
  [11-08](../research/playtest-2026-11-08/FINDINGS.md). Do after P86, then
  playtest.
- **Cut-legal misses.** A P81-dominant seat sometimes ignores a cut that is
  legal this turn (5 races in mirror s2, seat B with 34–143 heads). Source:
  [P85 diagnosis](../spec/heuristic-tempo-horizon/heuristic-tempo-horizon.md).
- **A cut counts as "quiet"**, so for a dominant seat a staging walk can
  replace a cut. Source: P81 follow-ups.
- **Test and code hygiene from the P85 review:**
  - the restated P84 invariant 5 (`heuristic-never-idle.support.ts`
    `guardChangedSteppedTurns`) now only exercises `neverIdle`'s first line;
    restore a live-seat check over the playtest turns;
  - `onMissionStep` (`botMission.ts`) is at cyclomatic 14 (budget 12);
  - dead branch `if (heads < 1) continue;` in `botTempo.ts`;
  - the P85 spec's Module table says "nothing else is public" but
    `botTempo.ts` also exports the types `Sortie` and `Intercept`.

- **A bot turn hung the page.** Playtest 2026-11-06: at move 580 a bot turn
  did not finish in several hours, though the turn before took seconds, so
  it is likely a non-terminating loop, not only slowness. The log was lost.
  Autosave (UX) keeps the next one; then reproduce it, bound every part of
  the turn, and run the heuristic seat in a Web Worker so the page stays
  usable. Late turns are also slow (6.5 s on a desktop Mac), which replaces
  the 2026-11-04 note that speed was no problem: that was on a desktop. Source: [findings](../research/playtest-2026-11-06/FINDINGS.md).

## UX

- **Check P90 on a phone.** Resume after a back swipe, a refresh and a
  frozen tab; Back from the lobby leaves the app at once. The web package has
  no jsdom, so the history and unload hook is untested in CI.
- **P90 review tidy-ups.** `guardingLeave` and `lobbyResume` belong in
  `resume.ts`, not `App.tsx`; `resumeSaved` repeats `startMatch`'s seat setup
  (share `seatRuntimeFromPlan`); `downloadRawText` copies
  `downloadMatchLog`'s body; `ResumeMode.spectated` / `.replayed` are never
  set in production, so drop them; the doc comment at `App.tsx` ~331 sits
  above the wrong function.
- **Post-P72 UX regressions.** Changes made when an agent played as the human
  seat through the Chrome extension suited the agent and cost a human more
  clicks. Research first: list the clicks and steps per turn today, find
  what changed after P72, and propose the shape of the turn UI before any
  code. The human decides the shape.

## Agent play (MCP)

- **Score logged agent replies.** [P92](packets/P92-remote-agent-mcp.md)
  records the reply on the match log. A harness that treats those records
  as free BYOK samples, and gates a prompt change on them, is not written.

## BYOK seat

- **Stale proxy baselines.** `pbase81` (K = 20, mean 0.326) and P82's
  `long150` predate P84 and P85. Do not spend now. Re-measure them only when
  the next BYOK arm needs a gate (about $0.50 for K = 20 and about $5 for
  `long150`), or for free if the agent-play route above lands.
- **The BYOK opening loses on production** (P82). P83 (offer rows) is parked
  on a positions regression; unparking P76 is the other route. The human's
  call.
- **P74 retry** as tags or row fields rather than prose (grok acts on tags).
  Needs a new packet; do not merge `parked/p74-byok-defensive-half`.
- **`plan` as a list** (one job per stack): a JSON-contract change; needs a
  packet and an ADR.
- **A non-grok model check** of the final combination. Needs another
  provider's key.
- **Bench hygiene:**
  - `matches` results do not record the model's `plan`/`why` (P83 added it,
    but P83 is parked);
  - a cell can abort on its worker's spend share (`maxUsd ÷ workers`) well
    before the run's cap.

## Docs

- **`02-work-packets.md` carries history in its text.** Its "Open items this
  plan inherits" section narrates long-closed §11 items, and older rows use
  strikethroughs. Clean it to the AGENTS.md rule, alongside or after P86.
