# ADR 0009 — An agent seat may join an online game that has one human

**Status:** Accepted
**Date:** 2026-11-09
**Context:** [ADR 0002](./0002-cheap-async-online.md), [ADR 0007](./0007-invite-only-byok-relay.md), [P92](../design/packets/P92-remote-agent-mcp.md)

## Context

ADR 0002 creates AWS game objects only when a lobby has at least two bound human seats, so that one human against heuristic AI stays in the browser and costs nothing. The human wants to play, from Claude Code, Cursor, or OpenCode, against a live online game, without a Chrome extension and without this server calling a model.

MCP clients do not run a downloaded script. A remote tool call is one HTTP POST. The implementation runs in that request and returns JSON. The match is already authoritative in S3. A tool body on the laptop would still have to ask the server to apply the move, and would be a second copy of the offer.

## Decision

A new seat kind, `agent`, may sit on an online invite next to `human` and `heuristic`.

- An online game needs **at least one human seat**. An agent cannot create an invite or press Start. One human plus heuristics and **no** agent stays in the browser. All-heuristic stays in the browser.
- The agent joins through the ordinary invite link, bound to its Google `userHash`, the same identity the browser already uses. Browser accept still takes the next unbound **human** seat. MCP `join` takes the next unbound **agent** seat. One Google user may hold one of each. A second agent seat for the same user is refused.
- Agent user hashes do **not** enter `groupHash`. The library labels the chair `Agent (given_name)`, not as a human player. `your-turn` in My games is the caller's human seat, never the agent seat.
- Start stays on the browser, and only once every human seat and every agent seat is bound. After Start the invite token is 410, so an agent that has not joined cannot bind later.
- The agent is untrusted exactly as the browser is. The MCP Lambda loads S3, checks the reply, calls the same `apply`, writes the same objects, and pings the browser with the same `PostToConnection`. It does not call `POST /moves`, and it does not invoke the WebSocket Lambda.
- No poll and no push to the IDE. The person at the IDE resumes by sending a chat message. While they are away, nothing is invoked.
- Cost ceiling is ADR 0007: reserved concurrency, a route throttle, a Budgets alert. Cognito stays out.

The door, the tools, and the OAuth server are [P92](../design/packets/P92-remote-agent-mcp.md). No game rule changes.

## Considered options

- **A downloaded skill script, run in the IDE.** Rejected. The script cannot be the authority, and every client would carry a copy of the offer.
- **MCP Lambda calls `api.games`, which calls `ws.games`.** Rejected. Today's move route accepts one `Move` from the active human seat. An agent batch would be 403, and the chain adds failure points the persist does not need.
- **`wait_for_turn` long-poll or a model retry loop.** Rejected. A human may be away for days. API Gateway cuts a held request at 30 seconds, and a retry loop invokes a Lambda on each lap.
- **MCP elicitation as the resume button.** Rejected. The dialog holds the tool call open and does not survive a closed laptop. The next chat message does.
- **Dynamic client registration.** Rejected for new work. MCP revision 2026-07-28 deprecates it. Clients identify themselves with a client-id metadata document.
- **Path `/mcp`.** Rejected. The host is the shared MCP door, as `api.games` is the shared HTTP door. The path is the game: `/conquarrow`.

## Consequences

- One human against an agent now creates S3 objects and Lambda calls. One human against heuristics only still does not.
- A group folder keyed by one human collects every game that human plays against any agents. Rematch number still increments. Agent identity is on the seat, not in the hash.
- `notifyOthers` must not skip the acting user when the move came from the agent door. The same person may have the browser open.
- ADR 0002's "at least two human seats" rule is amended by this ADR.
