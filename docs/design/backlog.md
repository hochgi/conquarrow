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

1. **§6.3 conversion fix** (P86 conflict 1). A territory-grade raider is not
   converted by a closure that claims the arrow it stands on. Decided by the
   human 2026-11-04. Concrete case: playtest 2026-11-04 move #345.
   [P86](./packets/P86-spec-conflict-resolution.md). *In progress.*
2. **SPEC conflict audit and rewrite.** [P86](./packets/P86-spec-conflict-resolution.md):
   - register every conflict with a concrete case;
   - the human decides the rule conflicts;
   - rewrite SPEC.md with no history in the text;
   - align rules-core and its tests.

## Heuristic seat

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

Bot turn speed (about 1.5 s per turn since P85) is not a problem in play
(human, 2026-11-04). Nothing to do.

## UX

- **Post-P72 UX regressions.** Changes made when an agent played as the human
  seat through the Chrome extension suited the agent and cost a human more
  clicks. Research first: list the clicks and steps per turn today, find
  what changed after P72, and propose the shape of the turn UI before any
  code. The human decides the shape.

## Agent play (MCP)

- **Decide the direction.** The goal (human, 2026-11-04): play against any
  agentic tool (Claude Code, Cursor, OpenCode) on any model without the
  Chrome extension, and test BYOK logic without paying for API calls.
  `packages/mcp` (P67, 2026-09-24) does neither yet:
  - it has no human UI; the human plays through chat with an SVG picture;
  - its heuristic is a frozen copy of greedy-v1, and its observation is a
    P66-era copy of the findings. Both have drifted from web (no P53–P85);
  - it does not serve the BYOK offer, so it cannot test BYOK logic.

  Candidate shape, for the human to confirm:
  - move the pure bot and BYOK-offer code out of `packages/web` into a
    shared package that web and mcp both import (ends the drift);
  - add MCP tools that serve the exact BYOK offer and accept the exact BYOK
    reply, so an agent on a subscription plays the BYOK seat;
  - a local bridge so the human plays in the normal web UI against an agent
    seat.

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
