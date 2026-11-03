# Free-tier providers for the BYOK seat and the P79 bench

Research note, 2026-11-03. The xAI balance is about $6.71. This note asks whether
two free tiers can take over BYOK work and [P79](../design/packets/P79-byok-benchmark-harness.md)
bench runs:

- **Google Gemini API**, free tier, through its OpenAI-compatible endpoint
  `https://generativelanguage.googleapis.com/v1beta/openai/`;
- **NVIDIA NIM hosted API** (build.nvidia.com), `https://integrate.api.nvidia.com/v1`.

The research was done from docs only. **No call was made to either provider and
no account was created**, so every "breaks" below is predicted from docs, not
observed. Claims are tagged **[P]** for a primary source (the provider's own docs,
pricing page or terms) and **[S]** for a secondary one (a forum post or a
third-party page). Where only [S] exists, the note says so.

The starting lead was a Google AI-mode answer the human shared. It is a chat
about AI Studio versus Vertex AI and Gemini 4 Argon, and it says nothing about
NVIDIA. Its checkable claims are below:

| lead claim | finding |
|---|---|
| AI Studio has a free tier | confirmed [P-pricing] |
| free-tier data may be read by human reviewers and used for training | confirmed [P-terms] |
| Gemini 4 Argon is fully public | Argon is listed with **no free tier** [P-pricing] |

## Verdict

- **Gemini: worth a key for the grid proxy, and for Pages play. Not for positions.**
  Flash-Lite models are free at about 10 RPM and 500 RPD [S]. That is one K = 20
  grid per Pacific day, and a 150-round long grid in about 3 days. The free
  reasoning-class models (Gemini 3.8 / 3.6 Flash) fail the positions role on two
  counts:
  - they **ignore `temperature`** [P], so the temperature-0 determinism P79
    relies on is gone;
  - they allow **about 20 requests per day** [S], and one positions run is 26 calls.
- **NVIDIA NIM: worth a key for bench work in both roles, pending calibration.**
  It has about 40 RPM per model and no documented daily cap [S], and it serves
  large reasoning models (Nemotron 3 Ultra, Mistral Large 4, GLM-5.3 Flash) and
  small ones. Three things count against it:
  - it does **not** send CORS headers to arbitrary origins [S], so Pages-direct
    play needs a relay;
  - its terms limit use to **internal testing and evaluation** [P];
  - determinism on shared hosted serving is unmeasured.
- **Neither one replaces grok-4.7 as the model the human plays.** The positions
  gate is meaningful because it measures that model. A free model can only
  become a new proxy, with **fresh baselines**: grok's 0.326 proxy mean, its
  4,632 prompt tokens and its positions rows do not carry over to another model
  or tokenizer.

## Comparison

| | Gemini free tier | NVIDIA NIM hosted trial |
|---|---|---|
| OpenAI chat-completions | yes, beta; `Authorization: Bearer` [P-openai] | yes; `Authorization: Bearer` [P-nim-model] |
| current body unchanged | **at risk**: `chat_template_kwargs` is not a Gemini field (see deltas) | likely; `chat_template_kwargs` is NIM's own thinking switch [P-nim-model] |
| `temperature: 0` honoured | 2.5 / 3.1 / 3.5 models: yes. **3.6 Flash and newer: "silently ignored"** [P-api] | not documented. NVIDIA's examples use 1.0 for reasoning models [P-nim-model] |
| `seed` | native `generationConfig.seed` [P-api]. Passing it through the compat layer is undocumented by Google | listed in a NIM chat-completions schema, for one model [P-nim-seed] |
| `max_tokens` includes thinking | yes, per Google staff [S-gem-maxtok] | yes, for Nemotron (P63 saw `length` at 512) |
| limits that matter | per **project**, RPD resets at midnight Pacific [P-rl]. Numbers are visible only inside AI Studio: Flash 5 RPM / 20 RPD, Flash-Lite 10 RPM / 500 RPD, 250k TPM [S-rl] | ~40 RPM, varies per model and with load. Shown in the account menu. No increase on the trial tier [P-faq], [S-rpm] |
| free models (role-relevant) | 3.8 Flash, 3.6 Flash, 3 Flash Preview, 3.5 Flash-Lite, 3.1 Flash-Lite, 2.5 Pro (deprecated), 2.5 Flash (deprecated), 2.5 Flash-Lite, Gemma 4 [P-pricing] | the hosted catalog: Nemotron 3 Ultra 550B, Nemotron 3.5 Super / Lightning / Bolt, DeepSeek V4.1 Flash, Mistral Large 4, GLM-5.3 Flash, gpt-oss-20b, Gemma 4 31B [P-catalog]. Pages do not label which are free; check each model's page |
| prompts used for training | **yes** on unpaid services, and human reviewers may read them [P-terms] | §3.3(iv) allows use "to improve NVIDIA products and services, including AI models" [P-nim-tos]. §2.3 says content is not stored after the session. The two read in tension |
| age / region | 18+. Israel is an available region [P-regions]. EEA/UK/CH apps must use paid services | "adult of legal age of majority" [P-nim-tos] |
| automated benchmarking | not addressed. Bars only models that compete with Gemini [P-terms] | not addressed. "Internal testing and evaluation purposes, not in production" (§1.4) [P-nim-tos] |
| browser CORS | likely OK for our headers. Unverified on the compat path (see below) | **blocked** for non-NVIDIA origins [S-cors] |
| roles | grid proxy: **yes** (Flash-Lite). positions: **no** | positions: **candidate**. grid proxy: **candidate** |

## How the seat calls a model today

The relevant facts from `packages/web/src/byokBot.ts` and `packages/web/bench/`:

- **One body for every host.** `byokCompletionBody` sends:
  - `model`;
  - `temperature: 0`;
  - `max_tokens`: 4096 in reasoning mode, 64 in fast mode;
  - `messages`;
  - `response_format: {type: "json_object"}`;
  - `chat_template_kwargs: {enable_thinking, force_nonempty_content}`, both at the top level and inside a literal `extra_body` key.
- **The request.** `postChatCompletions` sends only `Content-Type` and `Authorization: Bearer <key>`. No `x-stainless-*` headers.
- **The reply.**
  - `extractReplyText` reads `choices[0].message.content`, falling back to `reasoning_content`.
  - `completionUsage` reads `prompt_tokens`, `completion_tokens` and `finish_reason`.
- **The bench meter.** `budget.ts` `readUsage` adds `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens`.
  - Cost is (prompt − cached) × in + cached × cached-price + billable output × out.
  - Any prices can be passed: `nonNegative` accepts 0.
- **Retries.** `transport.ts` `retryingFetch` retries 429 and 5xx up to `--retries` times (default 5).
  - The backoff doubles from 2 s, is capped at 60 s, and honours `Retry-After` in seconds.
  - Once retries run out, the 429 reaches `playLlmBotTurn` as `HTTP 429`, and the turn falls back to the heuristic. That turn is scored as a fallback.
- **Concurrency.** `--concurrency` sets the number of worker processes. The default is 4, or 1 when `--max-usd` < 3. The workers do not share a rate limiter.

**Run sizes**, from the local bench result files (gitignored), counting calls:

| run | calls | mean prompt tokens | xAI wall at concurrency |
|---|---:|---:|---|
| positions, 12 positions (grok-4.7, reasoning) | 25–26 | 4,740 | 35 min at 1 (~80 s per call) |
| K = 20, 6 cells, 2 seats (proxy) | 197–230 | 3,320–3,390 | 4.1 min at 1; 1.4 min at 4 |
| K = 20, 9 cells, 3 seats (proxy) | 338 | 3,450 | 8.3 min at 1 |
| long, 150-round cap, 6 cells (proxy) | ~1,180–1,210 (incl. one cell rerun) | 4,300–4,470 | 29–34 min at 3–4 |

The xAI proxy ran at about 1 s per call at concurrency 1. So any limit under
about 60 RPM is what sets the wall time, not latency.

## Wall-clock floors on the free tiers

These are lower bounds from the limits alone. Hosted latency on a free tier will
often be slower. The RPM is per project (Gemini) or per model (NIM), so
`--concurrency 3` does **not** raise the floor. It only adds 429s that the
retry layer absorbs.

| run | Gemini 3.x Flash (5 RPM, 20 RPD) | Gemini Flash-Lite (10 RPM, 500 RPD) | NVIDIA (40 RPM, no daily cap known) |
|---|---|---|---|
| positions (26) | **2 Pacific days** (20 + 6) | ≥ 2.6 min; latency-bound | ≥ 0.7 min; latency-bound. grok-class reasoning took 35 min at concurrency 1, and about a third of that at 3 |
| K = 20 grid (230) | **12 days** | **≥ 23 min**, same at concurrency 1 and 3 | **≥ 6 min**, same at concurrency 1 and 3 |
| 3-seat K = 20 (338) | 17 days | ≥ 34 min | ≥ 8.5 min |
| long grid (~1,200) | 60 days | **3 Pacific days** (500 per day) | ≥ 30 min |

TPM never binds. Flash-Lite at 10 RPM × 4.4k tokens is 44k TPM, against a 250k
cap.

Two unknowns change these numbers:

- whether a rejected 429 counts against Gemini's RPD;
- whether NVIDIA's ~40 RPM drops under load. Its FAQ says the rate "may vary
  based on the number of concurrent users" [P-faq].

## Determinism

P79's method assumes a single run per arm. That holds because grok-4.7 and the
proxy each reproduced **identically** across two baseline runs (noise floor 0).
Neither free provider documents reproducibility.

- **Gemini 3.6 Flash and newer: not deterministic by construction.** Google says
  `temperature` "is no longer supported and is silently ignored on Gemini 3.6
  Flash and newer models" [P-api]. The Gemini 3 guide also tells callers to keep
  1.0, because lower values "may lead to unexpected behavior" [P-gem3]. A native
  `seed` exists [P-api]. Whether a fixed seed reproduces output, and whether the
  compat layer forwards `seed` at all, is undocumented. Google's compat page only
  says some unlisted parameters are "silently ignored".
- **Gemini 2.5 / 3.1 / 3.5 Flash-Lite:** `temperature: 0` is still a supported
  field. Reproducibility is not promised.
- **NVIDIA:** `temperature: 0` is greedy decoding on the usual servers. Whether
  the shared hosted trial batches requests in a way that breaks bit-for-bit
  repeats is undocumented. `seed` is in at least one NIM chat schema [P-nim-seed].

**What it costs to adapt.** P79 already runs every baseline twice and takes the
largest per-cell difference as the noise floor. That is the adaptation:

- **If two free baselines match exactly**, the single-run method carries over
  unchanged.
- **If they differ**, the gate must move to repeats. A sensible shape is 3 runs
  per arm and 3 per baseline, with a pass needing the arm's mean to beat the
  baseline's mean by more than the observed spread. That is 3× the calls:
  - **NVIDIA:** time only;
  - **Gemini Flash-Lite:** a K = 20 grid goes from one day to three;
  - **Gemini Flash:** the positions tier goes from 2 days to 6. That is why it is ruled out.

The gate rewrite itself is a ledger change, predeclared before any arm runs, as
P72's was.

## Code delta (not implemented)

### Shared

1. **Rate pacing in the bench.** Add a `--rpm N` pacer shared across workers, or
   document "use `--concurrency 1`" for free tiers. Today each worker retries
   blindly, and a 429 that outlives `--retries` is scored as a **fallback**. That
   inflates the fallback rate and can mark a cell invalid (> 10%) for a reason
   that has nothing to do with the model.
2. **Daily-cap stop.** A 429 from an exhausted RPD should abort the run, as
   `BUDGET_REFUSAL` does, not degrade to fallbacks.
   - Multi-day runs already work by hand: run a subset of cells with `--cells`
     and a subset of positions with `--positions`, on different days.
   - What is missing is a way to merge the per-day result files into one ledger
     row.
3. **Free pricing needs no code.** Pass `--price-in 0 --price-cached 0
   --price-out 0`, plus any `--max-usd` (the flag is still required), and an
   explicit `--concurrency`.
   - With prices at 0 the meter never refuses a call, so the cap stops being a
     brake.
   - `--max-usd` below 3 also forces concurrency 1 by default.
4. **Per-provider body.** `byokCompletionBody` assumes one dialect.
   - Both providers want **different thinking controls** from xAI.
   - Both count **thinking inside `max_tokens`**. xAI does not: grok spent about
     5.8k reasoning tokens per call under a 4,096 cap.
   - So the 4,096 reasoning budget can end in `finish_reason: length` and a
     fallback.
   - The smallest change is a per-provider (or per-model) thinking and
     token-cap table, keyed by base URL.

### Gemini

5. **Drop `chat_template_kwargs`** for Gemini hosts. The evidence on unknown fields conflicts:
   - one third-party report says Gemini returns **HTTP 400** for any unrecognised field [S-ibm];
   - Google's compat page says unlisted image parameters are silently ignored [P-openai].

   The lobby's Test connection probe sends the same body, so the first probe settles it.
6. **Thinking.** Use `reasoning_effort`:
   - `"none"` turns thinking off on 2.5 Flash and Flash-Lite only. It "cannot be
     turned off for Gemini 2.5 Pro or 3 models" [P-openai];
   - on 3.x, `minimal` "does not guarantee that thinking is off" [P-gem3].

   The alternative is a literal `extra_body: {google: {thinking_config: …}}`,
   which Google's REST example uses [P-openai]. The two "can't be used at the same
   time".
7. **`max_tokens`.** Gemini 3's default thinking level is `high` [P-gem3], so 4,096
   must cover both thoughts and the JSON. Raise it, or set a thinking level.
8. **`temperature`.** Nothing to change. It is simply ignored on 3.6+. Add `seed`
   only after a probe shows the compat layer forwards it.
9. **Usage.** Google documents compat `usage` only as an SDK dump [P-openai]. If
   `completion_tokens_details.reasoning_tokens` and
   `prompt_tokens_details.cached_tokens` are absent, they read as 0. That is
   harmless at $0 prices, but the ledger's reasoning-token column would be wrong.
   The prompt-size gates (`meanPromptTokensPerCall`) still work, but count
   Gemini tokens, so they need a fresh baseline.
10. **Nothing else.** The base URL with its trailing slash works (`chatCompletionsUrl`
    strips it), and the host is already on `BYOK_UPSTREAM_ALLOWLIST`.
11. **CORS hint.** `BYOK_CORS_HINT` lists x.ai, Groq and OpenRouter as CORS-OK.
    Add Gemini only after a Pages probe passes.

### NVIDIA

12. **Thinking: probably no change.** `chat_template_kwargs.enable_thinking` is
    NVIDIA's documented switch for Nemotron [P-nim-model]. The literal
    `extra_body` key is an unknown field there. vLLM-style servers ignore unknown
    fields, but that is unverified for the hosted service.
13. **`max_tokens`.** NVIDIA's Nemotron example uses 16,000 [P-nim-model], and P63
    already saw Nemotron truncate at 512. 4,096 is likely too small for Ultra with
    thinking on.
14. **`response_format: json_object`.** Not confirmed in any NIM page reached. The
    first probe settles it.
15. **`temperature: 0`.** NVIDIA's reasoning examples use 1.0 / `top_p` 0.95
    [P-nim-model]. Whether greedy decoding hurts Nemotron's play is a calibration
    question, not a code one.
16. **Usage.** OpenAI-shaped `usage` is expected. `cached_tokens` is probably absent,
    which is harmless at $0.

## Browser use (flagged, not designed)

- **Gemini: probably works Pages-direct.**
  - Google's own JS SDK documents browser use with the same setup as on a server
    [P-genai]. It warns: "Avoid exposing API keys in client-side code".
  - That warning is aimed at apps that ship a key. BYOK pastes the player's own
    key, which is ADR 0003's model.
  - The one public CORS failure on the compat path was the OpenAI SDK's
    `x-stainless-*` headers. Removing them fixed it [S-gem-cors]. Our fetch sends
    none.
  - Unverified until a probe from `games.hochgi.com`.
  - One wart: a 503 is reported to arrive **without** CORS headers
    [S-gem-cors-503]. The tab then sees a CORS error, and the CORS hint misleads.
- **NVIDIA: needs a relay.**
  - A 2026-10-26 preflight test echoed `Access-Control-Allow-Origin` only for
    NVIDIA's own origins (build.nvidia.com, docs.api.nvidia.com, www.nvidia.com),
    not for localhost [S-cors].
  - A forum user hit the same block from Chrome [S-cors-forum].
  - So on Pages it needs ADR 0007's relay; locally it needs Vite `/__byok`. Both
    already allowlist `integrate.api.nvidia.com`.
  - The bench is unaffected: Node has no CORS.

## Terms that bear on this

- **Gemini:**
  - unpaid prompts and responses are used "to provide, improve, and develop"
    Google products, and human reviewers may read them [P-terms]. The prompts are
    game state and teaching text, nothing personal;
  - 18+;
  - EEA/UK/Swiss *apps* must use paid services. A player there pasting their own
    free key into Pages is the edge case;
  - nothing bars automated benchmarking.
  - Rate limits are per project [P-rl]. Creating extra projects to multiply quota
    is not addressed in the terms, and this note does not recommend it.
- **NVIDIA:**
  - trial use only, "internal testing and evaluation purposes, not in production"
    (§1.2, §1.4) [P-nim-tos];
  - no competing products (§4.12);
  - no distributing Generated Content to others (§4.2);
  - content may be used to improve NVIDIA models (§3.3(iv)).
  - The bench fits "testing and evaluation".
  - Whether a public hobby game counts as "production" when a player uses
    their own trial key is **the human's call**. The NIM FAQ defines production as
    any use "other than development, testing, research or evaluation" [P-faq].

## What the human must do to get a key

**Gemini**
1. Sign in at aistudio.google.com with a Google account (18+; Israel is
   supported [P-regions]).
2. Click "Create API key". It binds the key to a Google Cloud project.
   - A project's tier sets its limits: Free is an "active project or free trial"
     [P-rl].
   - To stay on the free tier, a project **without billing** is the safe choice,
     so prefer a new one over an existing Cloud project that has billing.
3. Open AI Studio's rate-limit page (aistudio.google.com/rate-limit) and record
   the **actual** per-model RPM / RPD / TPM. The figures in this note for those
   are secondary [S-rl].
4. For the bench, export `BYOK_BASE_URL`, `BYOK_MODEL` and `BYOK_API_KEY`:
   - `BYOK_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`;
   - `BYOK_MODEL`, e.g. `gemini-3.5-flash-lite`;
   - `BYOK_API_KEY` from the shell only, never committed.

**NVIDIA**
1. Sign in at build.nvidia.com. That enrols you in the NVIDIA Developer Program
   [P-nim-quick].
2. Generate an API key from any model page's API tab. Keys start `nvapi-`.
3. Read your per-model limits in the account menu at the top right [P-faq]. The
   ~40 RPM figure is community-reported [S-rpm].
4. Use `BYOK_BASE_URL=https://integrate.api.nvidia.com/v1`. The model id is
   `publisher/name`, e.g. `nvidia/nemotron-3-ultra-550b-a55b` (as on the model's
   page).

**First calls, once keys exist:**
- one lobby Test connection per provider: does the body pass, and does CORS?
- then a **two-run** baseline: positions plus one K = 20 grid on the chosen
  model. This measures determinism before anything is gated on it.

## Sources

Primary (fetched 2026-11-03):

- [P-openai] Gemini OpenAI compatibility — https://aistudio.google.com/docs/openai (was ai.google.dev/gemini-api/docs/openai)
- [P-rl] Gemini rate limits — https://aistudio.google.com/docs/rate-limits
- [P-pricing] Gemini pricing (free-tier columns, "Used to improve our products") — https://aistudio.google.com/docs/pricing
- [P-terms] Gemini API Additional Terms — https://aistudio.google.com/docs/terms
- [P-regions] Gemini available regions — https://aistudio.google.com/docs/available-regions
- [P-api] Gemini API reference, GenerationConfig (`seed`, `temperature`, `maxOutputTokens`) — https://aistudio.google.com/api-reference/generate-content
- [P-gem3] Gemini 3 developer guide — https://ai.google.dev/gemini-api/docs/interactions/gemini-3.md.txt
- [P-genai] Google Gen AI JS SDK README — https://github.com/googleapis/js-genai
- [P-nim-tos] NVIDIA API Trial Terms of Service (PDF dated 2025-10-07) — https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf
- [P-faq] NVIDIA NIM FAQ (NVIDIA staff, forum) — https://forums.developer.nvidia.com/t/nvidia-nim-faq/300317
- [P-nim-model] Nemotron 3 Super model page (request example, governing terms) — https://build.nvidia.com/nvidia/nemotron-3-super-120b-a12b
- [P-catalog] NVIDIA model catalog — https://build.nvidia.com/models
- [P-nim-quick] NIM API quickstart — https://docs.api.nvidia.com/nim/docs/api-quickstart
- [P-nim-seed] NIM chat-completions schema listing `seed` (Alpamayo NIM) — https://docs.nvidia.com/nim/alpamayo/api-reference/chat-completions-v-1-chat-completions-post.md

Secondary:

- [S-rl] Gemini free-tier per-model numbers, as read from AI Studio — https://www.scriptbyai.com/gemini-api-free-tier-limits/
- [S-gem-maxtok] "does maxOutputTokens include thinking tokens?" (Google staff reply) — https://discuss.ai.google.dev/t/gemini-3-8-flash-high-does-maxoutputtokens-include-thinking-tokens/181077
- [S-ibm] Gemini rejects unknown fields with HTTP 400 — https://ibm.github.io/AI-SQL-Toolkit-IBMi/openai/usage/
- [S-gem-cors] Gemini CORS error with OpenAI compatibility — https://discuss.ai.google.dev/t/gemini-api-cors-error-with-openai-compatability/58619
- [S-gem-cors-503] 503 without CORS headers — https://discuss.ai.google.dev/t/frequent-503-service-unavailable-cors-error-with-gemini-2-5-flash-api-in-frontend-js-paid-tier/141903
- [S-rpm] ~40 RPM reports and the moderator line "no official way … to receive a rate limit increase on that same tier" — https://forums.developer.nvidia.com/t/api-rate-limit-increase-for-nvidia-nim/383197, https://forums.developer.nvidia.com/t/request-for-guidance-on-nvidia-nim-rate-limits-for-multi-agent-testing/373380
- [S-cors] NIM preflight test, 2026-10-26 — https://github.com/SyberLabs/RISE/wiki/LIVE-NVIDIA
- [S-cors-forum] NIM CORS error from the browser — https://forums.developer.nvidia.com/t/cors-errorn/310112
