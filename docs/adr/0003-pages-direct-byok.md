# ADR 0003 — Pages-direct BYOK; Lambda LLM only if CORS fails

**Status:** Accepted
**Date:** 2026-08-28
**Context:** [P15](../design/packets/P15-byok-llm-bot.md), [ADR 0002](./0002-cheap-async-online.md), [P20+](../design/packets/P20-deferred-online-followons.md), [`CONTEXT.md`](../../CONTEXT.md)

Local LLM seats should work from GitHub Pages (phone, tablet, another laptop) without `pnpm` or `pnpm byok-turn`. Hosting operator keys in Lambda/SSM would make those seats accessible without a paste, but it puts prepaid quota on the operator, fights ADR 0002’s cheap-async floor, and needs a 30s HTTP API workaround. Some OpenAI-shaped hosts already send browser CORS (x.ai, Groq, OpenRouter on sampled POSTs); `api.openai.com` often does not.

**Decision:** v1 LLM seats stay **BYOK in the tab**. Each browser profile pastes **base URL + API key + model**. Empty Proxy URL on Pages calls the host directly. Vite `/__byok` remains a **dev** relay, not a requirement to play. Online stays **heuristic-only** (ADR 0002). A server-held keyring and a move-Lambda model pump stay **parked** until Pages-direct BYOK is shown not to work for the hosts we care about. Completions stay OpenAI `chat/completions` behind a small port so Anthropic/Gemini can be added later without a rewrite.

All-bot matches: a pause control, and **idle pause while the tab is not focused**, so an unattended tab cannot burn quota overnight. A human chair is the other quota brake: LLMs play their turns, then the match waits for a click.

## Considered options

- **Operator keyring + Lambda pump** (SSM/Secrets Manager, async ack + WebSocket). Needed only if CORS-ok BYOK fails, or for online LLM chairs that must move after every phone is locked. Rejected for v1.
- **Bedrock Agents / LangGraph / Strands.** Orchestration around a `legalMoves` index the engine already enumerated. Rejected.
- **Household provision** of one key onto every family device. Rejected: every new device pastes credentials.
- **1-human online games** so vs-LLM persists in S3. Rejected: ADR 0002’s ≥2 humans floor stays; local match logs already download.

## Consequences

- Lobby and fetch-error copy must not imply that Pages play requires `pnpm`.
- `api.openai.com` from Pages may still fail until a personal origin-allowlisted relay exists; use a CORS-ok host or Vite `/__byok`.
- Idle-pause-on-blur for all-bot local matches, plus a Pause control on any local vs-bot match (CONTEXT.md). Spec: [bot-pause](../spec/bot-pause/bot-pause.md).
- P20 “Online BYOK” remains parked. If it is ever unparked, Lambda applies LLM moves (browser untrusted); not a tab-held key.
