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

1. **P86 leftovers.** Bot modules and test oracles that restate a rule
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

- **The loop of doom.** Playtest 2026-11-06: from move 209 to 529 (about
  rounds 17–43) A's ×4 stack walked the same 3-arrow ring of its own trail
  every turn, at the tip of a 12-arrow sortie, and never drove home to close.
  A's land sat at 30 for twenty rounds. The walk ends where it starts, so it
  is a pass that P84's never-idle seam lets through; `isShuttle` only catches
  two `count = 1` steps. Diagnose why the beam never prefers the close home,
  and score a plan whose end state equals its start as a pass. Replay
  fixture: the log, moves 209–529. Source:
  [findings](../research/playtest-2026-11-06/FINDINGS.md).
- **Income, not land, is the gap.** Playtest 2026-11-04: at r30 the human's
  income was 10.92 against the bots' 2.56; P85 missed its income gate
  (1.23×). The seat should value spawner shares, and close again after its
  opening sortie (9–10 closes in 42 rounds against the human's 38).
  Source: [findings](../research/playtest-2026-11-04/FINDINGS.md). Do after
  P86, then playtest.
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

- **Bot turns freeze a phone.** Playtest 2026-11-06: the page froze at move
  580 and the log could not be saved. A late turn of the 11-06 log takes
  6.5 s on a desktop Mac, and the planner runs on the main thread. Run the
  heuristic seat in a Web Worker so the page stays responsive, then bound the
  per-turn time on a phone-class budget (P85 missed its ≤ 0.89 s gate).
  This replaces the 2026-11-04 note that speed was no problem: that was on a
  desktop. Source: [findings](../research/playtest-2026-11-06/FINDINGS.md).

## UX

- **A back swipe or a refresh loses a local game.** Playtest 2026-11-06: an
  edge swipe on a phone navigated back, and the match was gone. Autosave the
  match (config and moves) to browser storage after every move and offer
  Resume in the lobby; catch the back gesture inside the page and ask before
  leaving; add a `beforeunload` prompt. Source:
  [findings](../research/playtest-2026-11-06/FINDINGS.md).
- **Post-P72 UX regressions.** Changes made when an agent played as the human
  seat through the Chrome extension suited the agent and cost a human more
  clicks. Research first: list the clicks and steps per turn today, find
  what changed after P72, and propose the shape of the turn UI before any
  code. The human decides the shape.

## Agent play (MCP)

- **A remote MCP seat. Grill it before any packet or ADR.** The goal
  (human, 2026-11-04): play against any agentic tool (Claude Code, Cursor,
  OpenCode) on any model without the Chrome extension, and test BYOK logic
  without paying for API calls. The human wants a grilling session on the
  shape below first ("lots of open questions"); the packets and ADRs come
  out of it.

  Shape agreed so far (human, 2026-11-04):
  - a **remote** MCP server served by Lambda, usable by anyone after a
    Google login, not only the operator;
  - a new seat kind, `agent`, next to `human` and `heuristic`. The agent
    joins through the ordinary invite link (`join(invite_link)`), bound to
    its Google user, like a browser accepting into a human seat;
  - **at least one human** in every game. An agent cannot create an invite
    or press Start, so there is no agent-only online play;
  - the human plays in the normal web UI and gets the usual WebSocket
    update after the agent moves.

  Leanings from the discussion, for the grilling to test:
  - login: MCP clients use OAuth and expect to register themselves, which
    Google does not allow. So a small OAuth server of our own on Lambda
    delegates sign-in to Google and issues short-lived signed JWTs.
    Cognito is out (ADR 0002 cost floor);
  - host `mcp.games.hochgi.com/conquarrow`: a hostname of its own because
    OAuth discovery lives at the host root, and under `*.games.hochgi.com`
    per ADR 0002;
  - stateless Streamable HTTP, one Lambda call per tool call;
  - tools `join`, `observe` (exactly what the BYOK seat is shown), `move`
    (a reply in the BYOK reply format), and `wait_for_turn` (returns "call
    again" after about 25 s, under API Gateway's 30 s);
  - the cost ceiling of ADR 0007: reserved concurrency, a throttle, a
    Budgets alert;
  - move the pure bot and BYOK-offer code out of `packages/web` into a
    shared package first, so the agent sees the real offer and not a copy;
  - delete `packages/mcp` (P67: a local stdio server with a frozen
    greedy-v1 and a P66-era observation) once the remote server ships.

  Open questions to grill (not exhaustive):
  - ADR 0002 creates online games only with at least two human seats. What
    replaces that rule, and does an agent seat enter `groupHash`, the
    library, `my-games`?
  - One Google user holding both a human seat and an agent seat: how accept
    tells them apart, and how the seats are labelled;
  - the OAuth server's details: client registration (dynamic or client ID
    metadata documents), token lifetime, refresh, revocation;
  - what each client (Claude Code, Cursor, OpenCode) supports today, and
    how a 30 s cap meets their tool timeouts. Check current docs first;
  - what happens when the agent stalls: a turn timeout, the host swapping
    the seat to `heuristic`, or nothing;
  - whether the agent's replies are logged, so a game against an agent
    becomes a BYOK benchmark sample;
  - the online ADR's "the browser is untrusted" applied to the agent: every
    move checked by `apply`, the reply format validated server-side.

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
