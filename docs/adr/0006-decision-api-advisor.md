# ADR 0006 — A decision API advises a BYOK seat; it never plays one

**Status:** Accepted
**Date:** 2026-10-28
**Context:** [ADR 0003](./0003-pages-direct-byok.md), [ADR 0007](./0007-invite-only-byok-relay.md), [research note](../research/jev-byok.md), [`CONTEXT.md`](../../CONTEXT.md)

## Context

**Decision APIs** (TypeSafe jev, OpenAI Decisions, about 22 models behind OpenRouter) take a state plus typed questions and return a typed answer with probabilities. They return no text. A `choice` question picks one of up to about 255 options, in 70–500 ms (vendor claim, unmeasured), for cents per thousand calls. None of them can return the ordered batch of legal-move indices plus `why`/`plan` that a BYOK seat's **API shape** asks for. jev's own documentation lists numbers and ids, multi-hop reasoning, large distracting state, and a lean toward the first option as weak spots. A conquarrow prompt has all of them.

There are two decision-API wire formats. Most vendors, OpenRouter included, copy TypeSafe's **System One format**. OpenAI uses its own.

## Decision

A decision API is an **advisor** on a BYOK seat. It is not a seat and not an API shape. The advisor is optional and configured per browser profile with its own base URL, key and model, like BYOK.

- Before each completion, the advisor gets the same board state and one choice question whose options are the current legal-move offer. The prompt then shows each option's advisor probability. The engine order is kept, and the seat's model still chooses.
- A failed advisor call leaves that completion unadvised. It never blocks a turn and never falls back to `greedy-v1` on its own.
- Each advised completion appends an **advisor record** to the match log: the advisor's top pick and its probabilities. The match summary line counts agreement ("advisor agreed 14/22"). Replay ignores both. They are not keys or prompts.
- A toggle turns advice off without clearing the configuration, so the same seat can play advised and unadvised.
- v1 speaks the System One format against TypeSafe (`api.typesafe.ai`). The settings carry a base URL so OpenRouter, and later the OpenAI format, plug in without a settings change.
- It is local only, like BYOK. Online stays heuristic-only (ADR 0002). Everything lives in `packages/web`. `rules-core` and `contracts` do not change.

Reaching TypeSafe: its CORS policy allows only its own console, so the advisor uses a **relay**. That is Vite `/__byok` under `pnpm dev` (with `api.typesafe.ai` added to the dev allowlist), and the Lambda relay on Pages ([ADR 0007](./0007-invite-only-byok-relay.md)).

A throwaway prototype comes first. It replays archived BYOK prompts through jev and measures how often jev's top pick matches the move the model played, and how long each call takes. The advisor packet starts only if that looks better than chance.

## Considered options

- **Alternative: jev replaces chat-LLM BYOK.** Rejected. It loses `why`/`plan`, the teaching prompt and the ordered batch. It supersedes ADR 0003 for a model in early access.
- **A decision API as a second API shape (one step per call).** Parked. It contradicts the API shape's batch contract, and the 64-completion cap turns into a cap on steps. It plays straight into the documented weak spots.
- **A new local seat kind: decision probabilities plus code search.** Parked. It fits a decision API's strengths, but it is a new seat kind, a lobby change and a search integration, all built before anyone knows whether the probabilities are any good. Advisor records are the evidence that would unpark it.
- **A prior inside the heuristic seat.** Rejected. **Heuristic** means deterministic, and it also runs in the online move Lambda, which holds no key.
- **Reorder or trim the offer by probability.** Deferred. Reordering confounds the measurement with jev's first-option lean, and trimming can hide the best move. Annotation and logging come first.

## Consequences

- CONTEXT.md gains **decision API**, **System One format**, **advisor** and **relay**. **Match log** may carry advisor records.
- A decision-only seat stays parked until advisor records show the decision API agrees with good play on its own.
- Probabilities are not comparable across models, so any threshold is per model.
- The OpenAI Decisions format is parked until someone wants to call `api.openai.com` directly. OpenRouter already fronts `gpt-6-luna`.
