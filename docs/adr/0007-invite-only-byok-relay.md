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
