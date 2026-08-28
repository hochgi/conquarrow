# P15 — Local BYOK LLM bot

> **Status:** landed (adapter). Can ship before any online work.
>
> **Layer:** web adapter only. **Depends on:** P11. **Does not touch:** rules-core.

## Intent

Optional OpenAI-compatible opponent for local vs-bot playtest. The player
supplies `base_url` + `api_key` + `model`. Calls run **only in the browser**;
the key never leaves the session and is never written into match logs.

Motivation: a stronger seat surfaces rules/UX issues before backend contracts
harden.

## Behaviour

1. Lobby: when "Play against bot" is on, optional BYOK fields.
2. Each bot decision: build a prompt with a short rules summary, a compact state
   snapshot, and an **exhaustive numbered** `legalMoves` list.
3. Model replies with a move **index**; client accepts only if ∈ that list.
4. Illegal / network / parse failure → fall back to the heuristic `chooseMove`
   for that step (never invent a move).
5. Config lives in `localStorage` (browser profile). Match logs record
   `botMode` + `byokStats` (hits/fallbacks/lastError) — never the API key.
6. Incomplete BYOK (checkbox on, missing fields) **blocks Start** so the
   heuristic cannot run silently under an “LLM” label. Live failures surface in
   the HUD.
7. **CORS:** The tab POSTs OpenAI-shaped `chat/completions`. Some hosts allow
   browser origins from Pages (x.ai, Groq, OpenRouter in ADR 0003’s samples);
   `api.openai.com` often does not. Empty Proxy URL on Pages calls the host
   directly — **no `pnpm` required** when CORS works. Local `pnpm --filter
   @conquarrow/web dev` still auto-uses same-origin `/__byok`. A Proxy URL is a
   **personal** relay for hosts that refuse the browser — **never
   employer/Versatile AWS**. See [ADR 0003](../../adr/0003-pages-direct-byok.md).

## Out of scope

- Server-side proxies we host on employer cloud
- Key storage, conversation memory across turns beyond the
  current decision
- Changing `Move` / `GameState` contracts
- Online multiplayer (P14+)
