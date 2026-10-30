# Research: is TypeSafe's jev a fit for conquarrow BYOK seats?

_Researched 2026-10-27. Research note only; it decides nothing. SPEC.md, ADRs, CONTEXT.md and code are untouched._

## Question

TypeSafe announced **jev** in [Introducing System One models and Jev][blog]. Should conquarrow's **BYOK** LLM seats treat it as
(a) an **alternative** that replaces or supersedes the current path in [ADR 0003][adr3], or
(b) an **optional complementary** ability alongside that path?

## TL;DR

- **jev is not a chat LLM.** It is a hosted, closed-weights "System One" decision model. It takes a `state` plus named, typed questions (`choice` / `score` / `noul` / `box`) on its own endpoint, `POST https://api.typesafe.ai/v1/systemone`, and returns one typed answer per question with calibrated probabilities. It does not generate text, and the vendor says it is not a drop-in for a chat or coding LLM ([coding-agents][coding], [openapi][api]).
- **It does not fit the current BYOK path without code, and it cannot be called from Pages today.** The request is not OpenAI `chat/completions`. It has no free-text reply, so `why` and `plan` are lost, and no ordered batch. On 2026-10-27 the API's CORS rejected `https://hochgi.github.io` (and localhost). The only origin it allowed was `https://console.typesafe.ai`. That is the same failure ADR 0003 already records for `api.openai.com` (§3 below).
- **The evidence supports (b) optional complementary, not (a) alternative.** jev could be a second **API shape** that picks *one* offer index per call, or it could sit beside the heuristic bot as a fast, cheap policy prior. Either way it runs alongside chat-LLM BYOK and does not supersede it. It also conflicts with CONTEXT.md's current definition of **API shape**, which is "a JSON batch … _Avoid_: a single move index" (CONTEXT.md:59-61).
- **Cost is negligible and speed is plausible, but neither is verified here.** The vendor lists $0.042 per million input tokens and free output tokens ([models][models]). That works out to about $0.0002 per call at today's 3–4k-token prompts (estimate). Vendor latency claims are 70–500 ms. I could not measure either without a key.
- **Measured 2026-10-28: advice does not help.** jev's top pick matches grok's move 59–70% of the time. But at 39 replayed human steps, grok matched the human 16/39 both plain and with jev's probabilities in the prompt, and the advised seat followed jev's top pick 37/39 times. jev alone matched the human about as often as the heuristic bot did (16/39). See [Human-move A/B](#human-move-ab-2026-10-28).
- **The model's own documented weak spots overlap conquarrow's prompt**: numbers and ids, multi-hop indirection, a large distracting state, and a bias toward the first Choice option ([jaggedness][jag]). Whether it plays well is an empirical question only a keyed playtest answers.

## Findings

### 1. What jev is

- **Who makes it and what it is.** TypeSafe AI makes it. jev is "the first public model of a new class" of "System One" models, built for "fast, structured decisions that software can use directly" ([blog]). It is a hosted model behind an HTTP API, plus official SDKs. It is not a local engine, not WASM, and not a protocol: the docs describe only the hosted endpoint and the SDKs ([system-one][s1], [models]).
- **Where the name comes from.** It comes from Kahneman's System 1 ("fast and intuitive") versus System 2 ("slower and more deliberate") ([system-one][s1]). The vendor states that it does not "write replies, produce code, or generate explanations of their reasoning" ([system-one][s1]).
- **Versions.** The current versions are `jev-1.14.0`, released 2026-10-14, and `jev-1.13.0`. The aliases `jev-latest` and `jev-preview` both point to 1.14 today ([models]).
- **Status.** It is in early access. The homepage says "Try … Jev, in early access", and the blog mentions bringing developers "off the waitlist" ([home], [blog]). There is no GA statement. The blog shows two dates, Sep 15 and Oct 19, 2026 (unverified which is correct).
- **Licence.** The model is proprietary: there are no weights, and the same weights serve every account ([models]). The SDKs are MIT: `typesafe-ai/typesafe-sdk-js` and `typesafe-ai/typesafe-sdk-python`, both created 2026-09-04 (GitHub API, `license.spdx_id`). The npm package `@typesafe-ai/sdk` is at 0.7.0, MIT, with `engines.node >=22` (npm registry).
- **Related repo.** `typesafe-ai/system-one-adapter-python` (MIT) goes the *other* way. It emulates the jev API on top of OpenAI, Anthropic or Gemini LLMs "for comparing TypeSafe against an LLM" (repo README).

### 2. API shape

- **Endpoint and auth.** The single endpoint is `POST /v1/systemone` on `https://api.typesafe.ai`, with `Authorization: Bearer <API_KEY>`. A second endpoint, `GET /v1/models`, lists models ([api], [models]).
- **Request body.** `{model, state, questions, assets?}`. `state` may be a string, an object or an array. `questions` is a map from your own names to a typed question ([api] schema `SystemOneRequest`). **The schema has no temperature, seed, max_tokens or messages field** ([api]).
- **Choice questions.** `criteria` maps option names to descriptions, with `minProperties: 1` and `maxProperties: 255`. The answer is `{choice, probabilities{…}, confidence}`, and it picks **exactly one** option ([api] `ChoiceQuestion`, [choice]).
- **Many questions per call.** One call can carry many questions, evaluated "in parallel and in isolation against the same state" ([intro]). There is no limit on the number of questions beyond the context limits ([models]).
- **Context limits.** 64k tokens per request and 32k per question. A `TypeSafe-Danger-Zone-Long-Context: true` header raises both to 262k, at the cost of being slower and less accurate ([models]).
- **Not OpenAI-compatible.** Calling `POST /v1/chat/completions` without a key returned **404**, while `/v1/systemone` without a key returned 403 "Must supply an API key". That suggests the route does not exist. This is inferred from status codes only, observed 2026-10-27. The docs never mention chat/completions, and they say "There is no `model: "jev-latest"` setting that turns your coding agent into a Jev-powered agent" ([coding]).
- **Streaming and tool calling.** No streaming and no tool calling are documented. "Function calling" appears only as a cookbook that maps function names onto Choice questions ([llms.txt][llms]).
- **Errors.** 401, 422, `429` (rate limit, per-org tokens/s and requests/s), and `529` (overloaded). Back off and retry ([errors], [models]).

### 3. Can a GitHub Pages tab call it? (observed directly, 2026-10-27, no key sent)

Preflight `OPTIONS https://api.typesafe.ai/v1/systemone` with `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers: authorization,content-type`:

| `Origin` | Result |
|---|---|
| `https://hochgi.github.io` | `400` "Disallowed CORS origin", no `access-control-allow-origin` |
| `http://localhost:5173`, `http://localhost:3000`, `https://example.com`, `https://docs.typesafe.ai`, `null` | `400`, no ACAO |
| `https://console.typesafe.ai` | `200`, `access-control-allow-origin: https://console.typesafe.ai` |
| control: `api.x.ai/v1/chat/completions` from `https://hochgi.github.io` | `200`, `access-control-allow-origin: *` |

`/v1/models` behaved the same. In other words, the API runs an origin allowlist that today contains only TypeSafe's own console.

The JS SDK refuses to run in a browser unless you pass `dangerouslyAllowBrowser: true` ("would expose your API key to anyone using the page") (`typesafe-sdk-js@v0.7.0` `src/client.ts:67-70,314`). The SDK's documented runtime is Node ≥22 ([sdk-js], npm). Nothing in the docs mentions in-browser or WASM inference. The Playground "runs Jev in the browser" only in the sense of a hosted UI behind login ([quickstart]).

In repo terms: Pages-direct jev fails exactly the way ADR 0003 says `api.openai.com` does (`docs/adr/0003-pages-direct-byok.md:23`). It would need the Vite `/__byok` dev relay or a personal proxy. Both currently forward only to hosts in `BYOK_UPSTREAM_ALLOWLIST`, which does not list `api.typesafe.ai` (`packages/web/src/byokConfig.ts:17-36`; relay check in `packages/web/vite.byok-proxy.ts`).

### 4. Auth and billing

- **Keys.** You get an API key from the console ([quickstart]). Keys are per organization, and rate limits are per organization ([models]). That pattern suits BYOK: each person pastes their own key. Getting a key may still require leaving the waitlist ([blog]; unverified whether sign-up is open).
- **Price.** $42 per billion input tokens ($0.042 per million). Output tokens are free. The price is the same for 1.13 and 1.14 and for long context ([models]). No free tier or credits are mentioned ([home], [blog]). The homepage FAQ asks whether prices are "temporary or subsidized" but gives no visible answer ([home]).
- **Estimate (analysis).** Archived local playtest responses show 2.9k–4.0k `prompt_tokens` per completion (`archive/responses.*.json`, untracked, Sept 2026, earlier prompt format). At that size one jev call costs about $0.00013–0.00017.

### 5. Speed and "System One" for a game bot

- **Vendor claims, all unverified.** End-to-end 70–500 ms versus 3–329 s for frontier LLMs, and "40x–200x faster". These were measured from West Coast laptops, against non-reasoning LLM modes in one demo ([blog]). The homepage claims "193.6x Faster, 444.6x Cheaper" ([home]). A Doom demo ran at 10 queries/s for about $7/h ([blog]).
- **Vendor-documented weaknesses** that matter here ([jaggedness 1.13][jag], reviewed 2026-10-02):
  - literal reading
  - numbers and counting ("Keep the arithmetic in code")
  - multi-hop indirection
  - accuracy falling as irrelevant state grows
  - Choice option order, which "leans toward the option that comes first"
  - generation

  No equivalent page exists for 1.14 (unverified whether these were fixed).
- **Analysis.** The conquarrow prompt is built from numeric arrow ids, head counts, speed/spent arithmetic and outcome tags (`packages/web/src/byokBot.ts:720-735`). A good move often rests on multi-hop reasoning: closure, cuts, fronts. That is close to the vendor's own "System Two" warning list. The offer is in engine `legalMoves` order (`docs/spec/byok-batch-turn/byok-batch-turn.md:75-79`), so first-option bias would skew toward engine order.

### 6. Determinism

- **No determinism controls.** There is no seed or temperature parameter ([api] schema). The blog claims only that it "returns similar answers for similar inputs" ([blog]; unverified).
- **Aliases move.** "its answers can change without any change to your code". Each response returns the versioned `model` that answered ([models]).
- **Analysis.** This does not threaten replay. Match logs hold decided moves, not prompts (CONTEXT.md:51-53), and BYOK already sends `temperature: 0` without depending on it (`packages/web/src/byokBot.ts:871`).

## What a BYOK seat requires today (repo baseline)

- **Configuration.** Base URL, API key and model are pasted per browser profile (CONTEXT.md:27-29; `byokConfig.ts:58-82`).
- **Endpoint.** The URL is always `${baseUrl}/chat/completions` (`byokConfig.ts:139-142`).
- **Request body.** OpenAI body with `temperature: 0`, `max_tokens` (4096 reasoning / 64 fast), `response_format: {type: 'json_object'}` and `chat_template_kwargs` (`byokBot.ts:861-877`).
- **Reply.** One completion returns `{"moves":[i,…],"endTurn":bool,"why","plan"}`, an **ordered batch** of offer indices (`byokBot.ts:734`, `asUsableBatch` at `:762-769`).
- **Turn loop.** The loop re-prompts from the new offer and is capped at 64 completions per seat-turn. It warns at the 8th. On any HTTP or parse failure it falls back to one `greedy-v1` remainder (`byokBot.ts:42,1277-1302`; spec `byok-batch-turn.md:81-92`).
- **No API-shape interface yet.** The only seam is the `fetchImpl` leaf (`byokBot.ts:955-976`) plus the body builder. ADR 0003's "small port" (`0003-pages-direct-byok.md:9`) has no named interface under `packages/web/src` (grep for `ApiShape|dialect|LlmPort`: no hits).

## Fit analysis (analysis, not fact)

**Not a provider or gateway row.** CONTEXT.md's **gateway** is "a keyring row, not a new HTTP dialect" (CONTEXT.md:55-57). The brief said "aggregator"; the glossary term is **gateway**. jev *is* a new HTTP dialect: a different path, body and answer. The three BYOK fields carry over (`https://api.typesafe.ai`, key, `jev-latest`), but zero-code use is impossible because the URL builder appends `/chat/completions`.

**A new API shape, but one that bends the definition.** ADR 0003 anticipated adding Anthropic or Gemini as further API shapes. Those still produce JSON text, so they keep the batch contract. jev cannot produce an ordered index array or the `why`/`plan` strings. Natural mappings:

1. **One step per call.** A single Choice over the offer, named by index (≤255 options), with an extra `endTurn` option or a Noul. Re-ask after each applied step. That is a different seat-turn contract from `byok-batch-turn`. It runs into the 64-completion cap (8+ calls per turn is normal for a high-speed stack), and it contradicts CONTEXT.md's "_Avoid_: … a single move index". This needs a spec, a glossary change and a decision about the loop. It is not an adapter-only swap.
2. **Speculative fan-out.** Several Choice questions per call, one per stack or "from" group ([fan-out pattern][llms]). This still cannot express ordered dependence between steps, because each question sees the same pre-move state.

Offer size versus the 255 cap: three archived early-game prompts show offer indices only up to `[8]` (`archive/requests.*.json`, untracked). Late-game offer sizes are unmeasured.

**Or a heuristic helper, not an LLM seat.** Choice returns calibrated `probabilities` over every option. That is a natural policy prior for the existing search/greedy bot (`packages/web/src/botSearch.ts`): it could order or prune candidates while the engine stays authoritative. Whether this is a new seat kind, a mode of the heuristic seat or a BYOK API shape is a product and vocabulary call, not a game rule.

**Why not (a) alternative.** jev can't do what chat-LLM BYOK does: free-text reasoning, `plan` carry-over, the teaching prompt's multi-hop guidance. The vendor positions it as a component *inside* LLM-driven systems ([coding], [s1] "Fast judgments inside a larger workflow"). It is early access, and Pages can't reach it, which ADR 0003 makes the hard requirement for v1. Nothing about it reopens ADR 0002's heuristic-only online play or the parked **hosted LLM** / **operator keyring**. Using it would still be per-player keys, which is BYOK and not hosted.

**Verdict.** The evidence supports **(b) optional complementary**. The open question is whether the complement is an LLM-seat API shape (option 1) or a prior for the heuristic seat. Purity is unaffected either way: every option lives in `packages/web`, and `packages/rules-core` / `packages/contracts` are not touched.

## Other decision APIs

_Added 2026-10-27. **Decision API** here means a hosted, per-key API that takes a state plus typed questions over caller-supplied options and returns typed answers with probabilities, not text. Facts come from vendor docs, API references and official SDKs. "Observed" means a probe sent with no key from `Origin: https://hochgi.github.io`. "Analysis" marks my own reasoning._

### OpenAI Decisions API

- **Endpoint and status.** `POST https://api.openai.com/v1/decisions` with `Authorization: Bearer`. The only model is `gpt-6-luna`, "the only currently supported model". The guide says the API "is now generally available" and lists what changed since the public beta ([oai-dec]).
- **Request.** The body is `model`, `input` and `questions`. `input` is a string or an ordered array of messages, function/custom tool calls and their outputs. User content parts are `input_text`, `input_image` and `input_json`. `questions` holds **1–400** entries, up from 200 in the beta. Each entry is `{type, name?, instructions}`. Optional fields: `prompt_cache_key`, `prompt_cache_options` and `safety_identifier`. **There is no seed, temperature or max_tokens field** ([oai-dec]; [oai-node] `DecisionCreateParams`).
- **Question types.**
  - `predicate`
  - `choice`, with `choices: [{value, description?}]`
  - `score`, with 2–10 `levels: [{label, description?}]`
- **Max `choice` options: 2–255, and they must be unique.** The SDK's doc comment says "Provide between 2 and 255 choices" ([oai-node]). The guide gives no maximum. `value` is `string | boolean`, and "a string and a boolean with the same text are distinct", so offer indices would be sent as strings.
- **Response.** The body is `{answers[], model, usage}`. Answers come "in question order" and each echoes its `name`.
  - A choice answer is `{type: "choice", name, choice, probabilities: [{value, probability}], confidence}`.
  - A predicate answer returns `probability`.
  - A score answer returns `score`, `probabilities: [{value, label, probability}]` and `confidence`.
  - Any single question can come back as `{type: "refusal", name}` while the others are answered.
  - `usage` reports `input_tokens`, `input_tokens_details.{cached_tokens, cache_write_tokens}` and output/reasoning tokens ([oai-dec], [oai-node]).
- **No ordered batch.** "For decisions that depend on an earlier answer, send separate requests" ([oai-dec]). That is the same limitation as jev's.
- **Price.**
  - Uncached input costs **$0.10 per 1M tokens**, and "Output tokens are not charged" ([oai-dec]).
  - Cache reads and writes are billed at gpt-6-luna's caching rates: $0.01 per 1M for cached input and $0.125 per 1M for writes ([luna]).
  - Long-context and regional multipliers apply. Prompts over 272K tokens cost 2× for input, and regional processing adds 10% ([luna]).
  - The general pricing page lists gpt-6-luna but has no Decisions line ([oai-pricing]).
- **Rate limits.** No limits specific to Decisions are documented. gpt-6-luna's limits are Build 5,000 RPM / 2M TPM, Launch 10,000 / 10M and Grow 30,000 / 180M ([luna], [oai-rl]). Whether `/v1/decisions` draws on those limits is unverified.
- **Browser use.** The Decisions guide never mentions browsers or CORS. The official `openai` JS SDK disables browsers by default unless you pass `dangerouslyAllowBrowser: true` ([oai-node-readme]).
- **CORS: observed, not verified.** I re-ran the probes on 2026-10-27 and got the same results the brief reported:
  - The preflight returned `200` with `access-control-allow-origin: *` and allowed `authorization,content-type`.
  - An unauthenticated POST returned `401` **without** an ACAO header. `/v1/chat/completions`' 401 carried `*`.

  A browser cannot read an error response that has no ACAO header, so the page would see a network failure, not a 401 it could handle. Whether a keyed `200` carries ACAO can only be shown by a keyed call.
- **Through a gateway.** It is also offered as `openai/gpt-6-luna-decisions` on OpenRouter ([or-jev]).

### Other members confirmed by primary sources

The category is bigger than jev plus OpenAI. OpenRouter counts "22 decision models from 13 makers" as of 2026-10-16, all behind one Decisions API ([or-jev]). Most members copy jev's **System One** wire shape:

- **Request:** a `state` plus a `questions` map keyed by name.
- **Choice options:** `criteria` maps each option name to a description.
- **Yes/no:** the question type is `noul`.
- **Answers:** keyed by question name, with `probabilities` as an object.

- **OpenRouter (gateway).**
  - **Endpoints.** `POST https://openrouter.ai/api/alpha/decisions` (the path says alpha), plus `POST /api/v1/systemone` for the TypeSafe SDKs.
  - **Access.** One OpenRouter key covers it. Jev is available "to anyone with an OpenRouter API key", with "no waitlist or separate TypeSafe account".
  - **Request.** `{model, state, questions, provider?, session_id?, trace?, user?}`.
  - **Choice answer.** `{choice, probabilities{option: p}, confidence}`. `usage.cost` is reported in USD.
  - **Not stated.** The schema states no cap on options or questions, and prices are per model page ([or-jev], [or-dec]).
- **Perplexity.**
  - **Endpoint.** `POST https://api.perplexity.ai/v1/decisions`.
  - **Models and price.** `pplx-decider-v1.2` (27B) costs $0.02 per 1M input tokens and `pplx-decider-flash-v1.2` (4B) costs $0.01. Output is free.
  - **Limits.** 1–128 questions per request, 1–255 choice options, and up to 10 score levels. Each organization gets 10 requests/s by default, and 429 responses carry `Retry-After`.
  - **How Flash differs.** Flash answers each question on its own.
  - **A warning that applies to fan-out.** The docs say "Grouping can hurt when the questions are independent candidates competing for the same judgement".
  - **Status.** I found no beta label ([pplx-qs], [pplx-api]).
- **Liquid AI d1.**
  - **Endpoint and models.** `POST https://api.liquid.ai/decisions/v1/systemone`, with models `d1.1` (the default) and `d1-ultra`.
  - **Questions.** It supports noul, choice and score, and several questions per call. "Each question is billed as its own prompt."
  - **Price.** The pricing page lists `d1` at $0.02 and `d1-ultra` at $0.042 per 1M input tokens. Output costs $0. New organizations get $2 of credit. `d1.1` is not on the pricing page.
  - **Not stated.** No maximum number of options and no status are given.
  - **Open weights.** Open-weight d1-3B and d1-omni-600M also exist. They run locally and are out of scope here ([liquid-dm], [liquid-d1], [liquid-price]).
- **Inception Mercury Decide.**
  - **Endpoint.** `POST https://api.inceptionlabs.ai/v1/decisions`, model `mercury-decide`.
  - **Questions.** noul, choice and score. At least one question is required, and no maximum is stated.
  - **Limits.** Choice `criteria` takes 1–255 options, and score takes up to 10 levels. Streaming is not supported.
  - **Price.** $0.02 per 1M input tokens, labelled "50% off the regular $0.04 price". Output is free ([incep-api], [incep-cap]).
- **Upstage Solar Decide.**
  - **Endpoint.** `POST /systemone` on the Upstage API base `https://api.upstage.ai/v1`. The base URL comes from the chat quickstart, and joining the two is my inference.
  - **Shape.** Upstage says it "uses the same /v1/systemone schema as Jev".
  - **Option cap.** **Choice takes only 2–26 options.** It reads the logits of the single-token labels A–Z, so a 27th option returns `422`.
  - **Status and price.** It is in beta. Input costs $0.10 per 1M tokens, output is free, and the context is 512K ([up-s1], [up-model], [up-qs]).
- **Cloudflare Workers AI Clef.**
  - **Endpoint and models.** `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`. There are also `clef-flash` and `clef-omni`.
  - **Shape.** The request is jev-shaped, plus an `images[]` extension.
  - **Limits.** 1–64 questions, 2–255 choice options and 2–10 score levels.
  - **Price and context.** Clef costs $0.24 per 1M input tokens, and output is free. The context window is 65,536 tokens.
  - **Credentials.** It needs both an account id and an API token ([cf-clef], [cf-clef-schema]).
- **Cohere Rerank: a borderline member.**
  - **Endpoint.** `POST https://api.cohere.com/v2/rerank` takes a `query` plus caller-supplied `documents`. The docs recommend no more than 1,000 documents.
  - **Response.** It returns `results[{index, relevance_score}]` with scores in [0, 1]. The docs say "It is not accurate to assume" the scores are proportional to each other. They are independent relevance scores, not a distribution over the candidates.
  - **Shape and price.** Each call carries one query. Billing is per search unit: one query with up to 100 documents. The pricing page lists no per-unit price, only dedicated hosting ([co-rr], [co-price]).
- **Excluded: Cohere Classify.** `POST /v1/classify` defines its labels through `examples` (at least 2 per label) or a fine-tuned model, not through option descriptions ([co-cl]).
- **Listed only by OpenRouter, not checked first-party:** Microsoft (`microsoft/microsoft-decision-1`), Nace.AI, Respan, ScaleDown, Together and Jared Palmer ([or-jev]).

**Non-members, checked 2026-10-27.**

- **No decision endpoint found.** The docs indexes for Anthropic, Google Gemini, Mistral, Groq and xAI show no decision endpoint and no endpoint that classifies over caller options. I checked each `llms.txt`, so this is an absence of evidence, not a vendor statement.
- **Mistral.** Its Classifier Factory is marked "deprecated" ([mistral-idx]). Its rerankers are client-side Search Toolkit classes, not a hosted endpoint ([mistral-rr]).
- **Groq.** It hosts safety classifiers that have fixed taxonomies.

**Logprob baseline (not a member).** A chat API can imitate a choice: ask for a one-token label, then read that token's logprobs.

- **OpenAI** chat completions take `logprobs: true` plus `top_logprobs` from 0 to 20 ([oai-node-cc]).
- **Gemini** takes `responseLogprobs` plus `logprobs` in [0, 20]. `responseMimeType: "text/x.enum"` limits the output to an enum ([gem-gc]).
- **Anthropic's** docs index does not mention logprobs.
- **Limits.** This tops out at 20 alternatives per position, labels longer than one token need their probabilities combined, and the result is the chat model's token distribution rather than a trained decision head. Upstage's 26-option cap is this same trick turned into a product.

### Comparison

| Vendor | Endpoint | Question types | Max `choice` options | Multi-question per call | Probabilities returned | Price (input / output) | Status | Browser CORS from `https://hochgi.github.io` |
|---|---|---|---|---|---|---|---|---|
| TypeSafe jev | `api.typesafe.ai/v1/systemone` | choice, score, noul, box | 255 | yes, capped only by context | per-option map + confidence | $0.042/1M / free | early access | observed: preflight `400`, origin not allowlisted (§3) |
| OpenAI | `api.openai.com/v1/decisions` | predicate, choice, score | 2–255 (SDK) | 1–400 | per-option array + confidence; per-question refusal | $0.10/1M / free | GA | observed: preflight `200` `*`; no-key `401` has no ACAO; keyed call unverified |
| OpenRouter (gateway) | `openrouter.ai/api/alpha/decisions` (+ `/api/v1/systemone`) | noul, choice, score, box (per model) | not stated (the model's own cap) | yes, cap not stated | per-option map + confidence; `usage.cost` | per model page / free | alpha path | observed: preflight `204` `*`; no-key `401` with `*` |
| Perplexity | `api.perplexity.ai/v1/decisions` | noul, choice, score | 1–255 | 1–128 | per-option + confidence | $0.02 or $0.01/1M / free | no beta label found | observed: preflight `204` `*`; no-key `401` with `*` |
| Liquid AI | `api.liquid.ai/decisions/v1/systemone` | noul, choice, score | not stated | yes | per-option + confidence | $0.02 (d1), $0.042 (d1-ultra) / free | not stated | observed: preflight `204` with **no ACAO**, so blocked |
| Inception | `api.inceptionlabs.ai/v1/decisions` | noul, choice, score | 1–255 | yes, no max stated | per-option + confidence | $0.02/1M promo ($0.04 list) / free | not stated | observed: preflight `200` echoes origin; no-key `422` with ACAO |
| Upstage | `api.upstage.ai/v1/systemone` | noul, choice, score | **2–26** | yes, cap not stated | per-option + confidence | $0.10/1M / free | beta | observed: preflight `204` `*`; no-key `401` with `*` |
| Cloudflare | `api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/cloudflare/clef` | noul, choice, score | 2–255 | 1–64 | per-option + confidence | $0.24/1M (clef) / free | not stated | observed: preflight `405`, no ACAO, so blocked |
| Cohere Rerank (borderline) | `api.cohere.com/v2/rerank` | rank only | ≤1,000 docs recommended | no (one query per call) | independent relevance scores, not a distribution | per search unit; price not listed | not stated | observed: preflight `200` `*`; no-key `401` with `*` |

Every CORS cell comes from a single no-key probe on 2026-10-27. For each endpoint, a keyed `200` is unverified.

### Common denominator (analysis)

**What every member shares.** Every decision member has the same core: one state blob, N named questions, and a `choice` question made of instructions plus a set of option ids, each with an optional description. The answer is the chosen id, a probability per option and, almost always, a confidence. The wire comes in only **two dialects**:

- **System One:** maps keyed by name, a `criteria` object and a `probabilities` object. Used by TypeSafe, OpenRouter, Perplexity, Liquid, Inception, Upstage and Cloudflare.
- **OpenAI:** arrays, `choices[{value}]`, `probabilities[{value, probability}]`, plus `predicate` and `refusal`.

The minimal shape conquarrow needs is `decide({state, instructions, options: [{id: "0".."n-1", description}]}) → {choice: id, probabilities: Record<id, number>} | refused`. That is one choice question over the current legal-move offer, with a probability for each option.

**Can one adapter front them all? Yes.** A single thin leaf with two codecs (System One and OpenAI) plus a base URL and path per vendor covers every decision member. Cohere Rerank fits only in a degraded way: send each offer as a document and take the argmax. Its scores are not a distribution.

**What the adapter cannot hide:**

- **Option caps.** Upstage stops at 26 and everyone else at 255 or less, so a large offer must be narrowed or split.
- **Typed values.** OpenAI's `choice` values are typed, so indices go as strings.
- **Refusals.** OpenAI's `refusal` must fall back to the heuristic.
- **Thresholds.** Probabilities are not comparable across models. OpenRouter itself says to re-pick thresholds per model.
- **Position bias.** jev's documented first-option bias is untested for the others.
- **No ordered batch.** No member does ordered multi-step decisions, so the one-step-per-call problem in the fit analysis above applies to the whole category, not just jev.

**Reachability.**

- **Likely reachable.** OpenRouter, Perplexity, Upstage, Inception and Cohere answered a Pages-origin preflight, and their no-key errors carried ACAO.
- **Partly reachable.** OpenAI's preflight passes, but its no-key errors have no ACAO.
- **Blocked.** TypeSafe direct, Liquid and Cloudflare would be blocked.

**OpenRouter covers most of the category.** It fronts jev, OpenAI, Liquid, Perplexity, Upstage, Cloudflare and Inception decision models behind one key and one endpoint that answered the probe with `*`. `openrouter.ai` is already in `BYOK_UPSTREAM_ALLOWLIST`, and `BYOK_CORS_HINT` already names it as CORS-ok (`packages/web/src/byokConfig.ts:13-20`). So a single System One codec pointed at OpenRouter would cover most of the category. That is an option, not a decision.

**What this changes in the sections above.** §3's "cannot be called from Pages today" and §1/§4's early-access/waitlist points hold for **TypeSafe's own endpoint only**. Through OpenRouter, jev has no waitlist and passed the no-key CORS probe. Open questions 3 and 4 below should be read with that in mind. The earlier text is left unchanged on purpose.

**Not verified here:**

- Any keyed call, so no real `200` CORS headers, latency or playing strength.
- Whether OpenAI Decisions has rate limits of its own.
- Liquid's option cap.
- Perplexity's, Liquid's, Inception's and Cloudflare's GA status.
- The prices OpenRouter charges per decision model.
- Microsoft and the other models listed only by OpenRouter.
- Upstage's full URL, which joins a documented base URL to a documented path.

## Prototype result (2026-10-28)

Throwaway script on branch `prototype/jev-advisor` (`tools/prototype-jev-advisor/run.mjs`). It replays 37 archived BYOK requests (3 matches from September 2026, `archive/`, untracked) through `jev-1.14.0`. Each request is sent twice: once with the options in engine order, once shuffled. The state is the teaching prompt plus the board; the options are the offer lines, with the one-ply baseline hint removed. The comparison target is the first index grok-4.6 played.

| Metric | Engine order | Shuffled order |
|---|---|---|
| jev's top pick matches grok's move | 59% | 70% |
| grok's move is in jev's top 3 | 95% | 97% |
| mean probability on grok's move | 0.43 | 0.44 |
| latency p50 / p90 | 197 / 226 ms | 205 / 232 ms |

- **Baselines.** Picking at random matches 11% of the time (mean 1/N). The one-ply baseline suggestion matches grok's move 30% of the time.
- **Position bias.** jev never picked index 0 in engine order, and picked the first-shown option only 5% of the time when shuffled. The documented first-option lean did not show up. A **last-option** lean did: in engine order jev picked the last option 18/37 times, against 9/37 for grok. Only 57% of picks were the same in both orders.
- **Cost.** 74 calls, 219,564 input tokens, about $0.009.

**Verdict (analysis).** jev clears P72's original gate (better than chance) comfortably. The stricter human-move test below does not pass: it does far better than chance and better than the one-ply baseline, at about 200 ms per call. Caveats:
- The sample is small, opening-only (N ≤ 9, one stack), and on an older prompt.
- grok's move is a proxy for good play, not the truth.
- The teaching prompt's own heuristics make whole-stack moves predictable.

Whether advice actually makes the seat play better can only be shown by advised versus unadvised playtests (the ADR 0006 toggle).

**Implementation hint for P72.** Probabilities depend on option order. A System One request can carry several questions, so the advisor can ask the same choice in two fixed orders in one call and average the two. That cancels the order bias for no extra round trip. The prompt the seat's model sees stays in engine order.

## Human-move A/B (2026-10-28)

Agreement with grok shows jev can rank an offer. It does not show that advice improves play. This second test uses the human's moves as the standard. In both 2026-09-10 matches the human (seat C) beat the heuristic and grok seats comfortably.

**Method.** `tools/prototype-jev-advisor/human-ab.proto.test.ts` on the same branch.
- Each match log is replayed into the exact state at every human step: 39 steps, plus 13 end-turns skipped because the offer has no end-turn row. Every human step was in the offer.
- At each step the offer and user prompt are rebuilt with the production `buildUserPrompt`.
- jev gets one call with two questions, the offer in engine order and reversed. The two probability sets are averaged, as the P72 hint proposes.
- grok-4.6 (reasoning on, the archived settings) is asked twice: once with the plain prompt, and once with `advisor=p` appended to every offer row, plus one line explaining the field.
- Each arm is scored on whether its first pick equals the human's step.

| Picker | Matches the human's step |
|---|---|
| chance (mean 1/N) | 16% |
| greedy-v1 (BYOK fallback) | 11/39, 28% |
| beam (the heuristic seat) | 16/39, 41% |
| jev, two orders averaged | 16/39, 41% |
| jev, engine order only | 19/39, 49% |
| **grok, plain** | **16/39, 41%** |
| **grok, advised** | **16/39, 41%** |

- **Advice changed nothing.** Advised grok picked a different move from plain grok 12 times. In 3 of those it moved onto the human's move, in 3 it moved off it, and in 6 it went from one wrong move to another.
- **Advice replaces grok's judgement.** Advised grok's pick matched jev's top pick in 37 of 39 steps, against 26 of 39 for plain grok. With these annotations an advised seat is effectively jev with a chat model's latency.
- **jev is as human-like as the heuristic bot, not more.** Where the beam bot missed the human's move (23 steps), jev hit it 5 times.
- **The last-row lean survives averaging.** jev picked the last row 16 of 39 times, against 8 of 39 for the human. Averaging both orders did not cancel it, so the last rows themselves probably attract it, not their position.
- **jev reruns differ slightly.** The averaged arm scored 15/39 in the jev-only run and 16/39 in this one.
- **Speed and cost.** jev: p50 212 ms, p90 260 ms, about 151k input tokens per pass (under a cent). grok: about 71 s per completion, which is why the run needed a resume after vitest's 60-minute limit.

**Verdict (analysis).** The advisor as ADR 0006 designs it does not improve play on this evidence, so P72 does not start. Caveats:
- 39 steps from one player in two openings-to-midgame matches is small. It rules out a large effect, not a small one.
- One annotation format was tried. A softer format, such as showing only the top two, might be weighed rather than obeyed.
- One human's moves are a strong standard here, not ground truth.

What would reopen it: more human match logs (each match adds about 20 steps), or a decision model that beats the beam bot on this test by itself. The script reruns on new logs unchanged.

## Open questions for a human

1. **Role.** Should jev be a BYOK **API shape** (a seat the player configures), an optional prior inside the heuristic bot, or neither until it leaves early access?
2. **Seat-turn contract.** Is a one-step-per-call loop acceptable, or must a jev seat keep the ordered-batch contract? That decides whether `byok-batch-turn` and the CONTEXT.md **API shape** entry need revising (a phase-1 spec job).
3. **Reaching it from Pages.** Ask TypeSafe to allowlist `https://hochgi.github.io`, accept dev-relay / personal-proxy only (ADR 0003's `api.openai.com` posture), or add `api.typesafe.ai` to `BYOK_UPSTREAM_ALLOWLIST`?
4. **Access.** Does the user already have an early-access key? Without one, latency, playing strength and 1.14's behaviour on numeric ids cannot be measured.
5. **Offer size.** How large do step offers get in late game or on large boards, relative to the 255-option Choice cap?
6. **Losing the explanations.** Is it acceptable to lose `why` and `plan`? Plan echo feeds the next prompt (`byokBot.ts:715-716`).

## Unverified or unreachable

- Real latency, accuracy and playing strength: no key, and no account was created.
- Whether sign-up is open or waitlist-gated.
- Whether jev 1.14 fixes the 1.13 weaknesses.
- The blog's publication date (two dates on the page).
- Whether the homepage's "193.6x / 444.6x" multipliers reconcile with its raw figures (they do not by simple division).
- Absence of `/v1/chat/completions`, which is inferred from an unauthenticated 404.
- CORS was observed on a single day and may change.

## Sources

- [blog]: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- [home]: https://typesafe.ai/
- [intro]: https://docs.typesafe.ai/introduction
- [llms]: https://docs.typesafe.ai/llms.txt
- [s1]: https://docs.typesafe.ai/concepts/system-one.md
- [coding]: https://docs.typesafe.ai/introduction/coding-agents.md
- [api]: https://docs.typesafe.ai/api/system-one.md (OpenAPI 0.2.0, `https://api.typesafe.ai/openapi.json`)
- [errors]: https://docs.typesafe.ai/api/errors.md
- [models]: https://docs.typesafe.ai/models.md
- [choice]: https://docs.typesafe.ai/primitives/choice.md
- [jag]: https://docs.typesafe.ai/model-jaggedness/jev-1.13.md
- [quickstart]: https://docs.typesafe.ai/introduction/quickstart.md
- [sdk-js]: https://docs.typesafe.ai/sdk/javascript.md
- GitHub: https://github.com/typesafe-ai/typesafe-sdk-js (`v0.7.0/src/client.ts`), https://github.com/typesafe-ai/typesafe-sdk-python, https://github.com/typesafe-ai/system-one-adapter-python
- npm: https://registry.npmjs.org/@typesafe-ai/sdk
- Direct HTTP probes: `curl -X OPTIONS` / unauthenticated `POST` against `api.typesafe.ai` and `api.x.ai`, 2026-10-27
- Other decision APIs (all fetched 2026-10-27):
  - [oai-dec]: https://developers.openai.com/api/docs/guides/decisions (Markdown twin: `decisions.md`)
  - [oai-node]: https://github.com/openai/openai-node/blob/main/src/resources/decisions.ts (openai-node v7.45.0)
  - [oai-node-readme]: https://github.com/openai/openai-node/blob/main/README.md (`dangerouslyAllowBrowser`)
  - [oai-node-cc]: https://github.com/openai/openai-node/blob/main/src/resources/chat/completions/completions.ts (`top_logprobs`)
  - [luna]: https://developers.openai.com/api/docs/models/gpt-6-luna
  - [oai-rl]: https://developers.openai.com/api/docs/guides/rate-limits
  - [oai-pricing]: https://developers.openai.com/api/docs/pricing
  - [or-jev]: https://openrouter.ai/docs/guides/community/jev
  - [or-dec]: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request
  - [pplx-qs]: https://docs.perplexity.ai/docs/decisions/quickstart
  - [pplx-api]: https://docs.perplexity.ai/api-reference/decisions-post
  - [liquid-dm]: https://docs.liquid.ai/lfm/models/decision-models
  - [liquid-d1]: https://docs.liquid.ai/lfm/models/d1
  - [liquid-price]: https://www.liquid.ai/pricing
  - [incep-api]: https://docs.inceptionlabs.ai/api-reference/decisions/create-a-decision
  - [incep-cap]: https://docs.inceptionlabs.ai/capabilities/decisions
  - [up-s1]: https://console.upstage.ai/api/systemone
  - [up-model]: https://console.upstage.ai/docs/models/solar-decide
  - [up-qs]: https://console.upstage.ai/docs/capabilities/generate/chat
  - [cf-clef]: https://developers.cloudflare.com/workers-ai/models/clef/
  - [cf-clef-schema]: https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json
  - [co-rr]: https://docs.cohere.com/v2/reference/rerank
  - [co-cl]: https://docs.cohere.com/reference/classify
  - [co-price]: https://cohere.com/pricing
  - [gem-gc]: https://ai.google.dev/api/generate-content (`GenerationConfig.responseLogprobs`, `logprobs`, `text/x.enum`)
  - [mistral-idx]: https://docs.mistral.ai/llms.txt (Classifier Factory marked deprecated)
  - [mistral-rr]: https://docs.mistral.ai/studio/search/search-toolkit/retrieval/rerankers
  - Docs indexes checked for absence: https://docs.claude.com/llms.txt, https://platform.claude.com/llms.txt, https://ai.google.dev/gemini-api/docs/llms.txt, https://docs.mistral.ai/llms.txt, https://console.groq.com/llms.txt, https://docs.x.ai/llms.txt
  - Direct HTTP probes (`OPTIONS` preflight and unauthenticated `POST {}`, `Origin: https://hochgi.github.io`, no key) against the OpenAI, OpenRouter, Perplexity, Liquid, Inception, Upstage, Cloudflare and Cohere endpoints in the comparison table
- Repo: `docs/adr/0003-pages-direct-byok.md`, `CONTEXT.md`, `packages/web/src/byokBot.ts`, `packages/web/src/byokConfig.ts`, `packages/web/vite.byok-proxy.ts`, `docs/spec/byok-batch-turn/byok-batch-turn.md`, `archive/` (untracked playtest logs)

[blog]: https://typesafe.ai/blog/introducing-system-one-models-and-jev
[home]: https://typesafe.ai/
[intro]: https://docs.typesafe.ai/introduction
[llms]: https://docs.typesafe.ai/llms.txt
[s1]: https://docs.typesafe.ai/concepts/system-one.md
[coding]: https://docs.typesafe.ai/introduction/coding-agents.md
[api]: https://docs.typesafe.ai/api/system-one.md
[errors]: https://docs.typesafe.ai/api/errors.md
[models]: https://docs.typesafe.ai/models.md
[choice]: https://docs.typesafe.ai/primitives/choice.md
[jag]: https://docs.typesafe.ai/model-jaggedness/jev-1.13.md
[quickstart]: https://docs.typesafe.ai/introduction/quickstart.md
[sdk-js]: https://docs.typesafe.ai/sdk/javascript.md
[adr3]: ../adr/0003-pages-direct-byok.md
[oai-dec]: https://developers.openai.com/api/docs/guides/decisions
[oai-node]: https://github.com/openai/openai-node/blob/main/src/resources/decisions.ts
[oai-node-readme]: https://github.com/openai/openai-node/blob/main/README.md
[oai-node-cc]: https://github.com/openai/openai-node/blob/main/src/resources/chat/completions/completions.ts
[luna]: https://developers.openai.com/api/docs/models/gpt-6-luna
[oai-rl]: https://developers.openai.com/api/docs/guides/rate-limits
[oai-pricing]: https://developers.openai.com/api/docs/pricing
[or-jev]: https://openrouter.ai/docs/guides/community/jev
[or-dec]: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request
[pplx-qs]: https://docs.perplexity.ai/docs/decisions/quickstart
[pplx-api]: https://docs.perplexity.ai/api-reference/decisions-post
[liquid-dm]: https://docs.liquid.ai/lfm/models/decision-models
[liquid-d1]: https://docs.liquid.ai/lfm/models/d1
[liquid-price]: https://www.liquid.ai/pricing
[incep-api]: https://docs.inceptionlabs.ai/api-reference/decisions/create-a-decision
[incep-cap]: https://docs.inceptionlabs.ai/capabilities/decisions
[up-s1]: https://console.upstage.ai/api/systemone
[up-model]: https://console.upstage.ai/docs/models/solar-decide
[up-qs]: https://console.upstage.ai/docs/capabilities/generate/chat
[cf-clef]: https://developers.cloudflare.com/workers-ai/models/clef/
[cf-clef-schema]: https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json
[co-rr]: https://docs.cohere.com/v2/reference/rerank
[co-cl]: https://docs.cohere.com/reference/classify
[co-price]: https://cohere.com/pricing
[gem-gc]: https://ai.google.dev/api/generate-content
[mistral-idx]: https://docs.mistral.ai/llms.txt
[mistral-rr]: https://docs.mistral.ai/studio/search/search-toolkit/retrieval/rerankers
