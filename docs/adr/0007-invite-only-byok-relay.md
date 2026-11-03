# ADR 0007 — An invite-only Lambda relay for hosts that refuse the browser

**Status:** Accepted
**Date:** 2026-10-28
**Context:** [ADR 0002](./0002-cheap-async-online.md), [ADR 0003](./0003-pages-direct-byok.md), [ADR 0006](./0006-decision-api-advisor.md), [research note](../research/jev-byok.md), [`CONTEXT.md`](../../CONTEXT.md)

## Context

ADR 0003 has Pages call a provider directly and expected that `api.openai.com` "may still fail until a personal origin-allowlisted relay exists". `api.openai.com` refuses most browsers, and TypeSafe's `api.typesafe.ai` only accepts its own console: on 2026-10-27 the preflight from `https://games.hochgi.com` returned 400. Today the only way through is Vite `/__byok` under `pnpm dev`.

The operator already runs an HTTP API at `api.games.hochgi.com/conquarrow`. Its CORS allows `games.hochgi.com`, and it checks a Google ID token in `Authorization: Bearer`.

## Decision

Add a stateless **relay** route to the existing HTTP API. The browser POSTs the upstream URL and body. The relay forwards them and returns the upstream's status and body.

- **Who.** Google sign-in is required, and the token's verified email must be on an invite list. While the relay is in beta, the list holds only the operator, and users are added explicitly. The list lives in a GitHub Actions **secret**, passed as a SAM parameter into a Lambda environment variable. It is never committed: the repo is public. A signed-in user who is not on the list gets 403 with the wording "relay is invite-only during beta".
- **Where.** Any `https:` URL, except loopback, private and link-local addresses. Inside a Lambda, `127.0.0.1:9001` is the runtime API. There is no host allowlist: the invite list is the abuse control, and new vendors need no change.
- **The key.** TLS only. Payload encryption adds nothing, because the relay must decrypt the key to forward it. The vendor key travels in its own header (`X-Upstream-Authorization`), because `Authorization` already carries the Google token. The relay copies that header into the upstream `Authorization` and nowhere else. No header or body is logged, and there is no tracing. Logs hold only the upstream host, the status and the latency. A committed `@hochgi/test-kit` test proves the key never reaches a log.
- **Cost ceiling.** Reserved concurrency of about 5, a throttle on the route, and an AWS Budgets alert at a small amount. A rejected caller is still a billed Lambda call, so the ceiling matters even with the invite list.
- **Limits.** The Lambda timeout is 29 s, under the HTTP API's 30 s. A reasoning model that runs longer fails like any other HTTP failure and falls back to `greedy-v1`. A Lambda Function URL (15 min) is the escape hatch if that ever matters.
- **Opt-in.** The relay is a one-click preset in the existing Proxy URL field. Direct calls stay the default, and a key is never rerouted through the operator's account without the player choosing it. The settings say: "Relay keys pass through the operator's AWS in transit and are never stored."

## Considered options

- **A host allowlist (the dev relay's `BYOK_UPSTREAM_ALLOWLIST`).** Rejected for the Lambda relay. It limits where requests go, not who sends them. Every new vendor would be a code change and a deploy.
- **Open to any signed-in user.** Rejected. A Google account proves nothing about trust, and an open relay is a proxy, an abuse-complaint risk and a slow-host cost attack on the operator's account.
- **Encrypting the payload.** Rejected. The relay must decrypt to forward, so it protects against nothing TLS does not.
- **Asking TypeSafe to allowlist `games.hochgi.com`.** Not needed: the relay covers it, and it would cover only one vendor.
- **Operator keyring / Lambda pump (ADR 0003).** Still parked. The relay holds no key and chooses nothing.

## Consequences

- ADR 0003's direct-call default stands. This ADR adds the relay that ADR 0003 anticipated.
- ADR 0002's cost floor holds: the relay is one short Lambda call per completion, with no S3 and no state.
- Local play that uses the relay needs Google sign-in. Direct calls do not.
- Opening the relay beyond the invite list is a trigger to revisit host restriction, per-user quotas, and whether API Gateway's JWT authorizer can reject callers before the Lambda bills. That is parked as a follow-up packet.

## Addendum (2026-11-03): long completions, parked

**Status:** open, parked until the relay (P71) is implemented. Nothing below is decided. It records what was found so the choice can be made then.

**The problem.** The 29 s limit above is tighter than it looked:
- grok-4.7 with reasoning averaged about 80 s per call on the P79 bench ([ledger](../research/byok-benchmark.md));
- NVIDIA NIM's hosted trial sends no CORS headers to other origins, so it needs this relay to be played from Pages at all ([research note](../research/byok-free-providers.md)). Its reasoning models are likely to run past 29 s.

A relayed reasoning call would therefore often time out and fall back to `greedy-v1`.

**Async modes that providers already offer** (from their own docs, 2026-11-03):

| provider | async mode | result delivery |
|---|---|---|
| OpenAI | Responses API, `background: true` | a signed `response.completed` webhook (Standard Webhooks), then `responses.retrieve` — [guide](https://developers.openai.com/api/docs/guides/webhooks) |
| xAI | chat completions with `deferred: true` → `request_id` | poll `GET /v1/chat/deferred-completion/{request_id}`: 202 while pending, 200 with the body, readable once within 24 h — [guide](https://docs.x.ai/developers/advanced-api-usage/deferred-chat-completions) |
| NVIDIA | the function layer can answer 202 with a request id | poll `GET https://integrate.api.nvidia.com/v1/status/{requestId}` — [reference](https://docs.api.nvidia.com/nim/reference/google-gemma-3n-e4b-it-statuspolling). Documented per model; unverified for chat LLMs on the free trial |
| Gemini | Batch API only | minutes to hours; not usable for a live turn |

Only OpenAI calls back. The others are submit-then-poll.

**Options, for when this is decided:**
1. **A Lambda Function URL instead of the HTTP API route.** It allows 15 min, and response streaming keeps the connection open. The relay stays stateless with one transport change. This is the escape hatch named under Limits.
2. **Browser-driven polling through the relay.**
   - For hosts with a deferred or 202 mode, the browser submits through the relay and gets an id.
   - It then polls the status URL through the relay. Every relay call stays short.
   - The provider holds the job, so the relay keeps no state.
   - It needs a per-host dialect in the BYOK adapter.
3. **Webhook plus push.** The provider calls a second Lambda, which pushes the answer to the tab over the existing WebSocket API (or the tab polls a store).
   - This is the only zero-polling design.
   - It needs a provider that calls back (OpenAI today), a public signed webhook route, job state, and WebSocket plumbing.
   - That breaks this ADR's "no state" property and ADR 0002's cost floor. It is the most moving parts for the least gain.

The P79 bench is unaffected: Node has no request timeout to work around.
