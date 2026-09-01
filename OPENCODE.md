# conquarrow (OpenCode)

The shared, tool-agnostic conventions for this repo live in [`AGENTS.md`](./AGENTS.md)
— read them first; they are the base every tool follows.

---

The notes below are **OpenCode-specific** and layer on top of that shared base.
Claude Code’s parallel file is [`CLAUDE.md`](./CLAUDE.md). Cursor’s is [`CURSOR.md`](./CURSOR.md).

## Auth — SuperGrok subscription, not an API key

This project is pinned to **xAI Grok 4.6** billed against your **SuperGrok / X Premium**
subscription via OpenCode’s xAI OAuth.

On a fresh machine (once):

```
opencode
/connect
```

Pick **xAI** → **SuperGrok Subscription** (browser OAuth). Headless/VPS: the
headless xAI option. OpenCode stores and refreshes the token under
`~/.config/opencode/` — **never commit it, never put `XAI_API_KEY` in this repo.**

Then:

```
/models
```

Confirm the session is on `xai/grok-4.6`. Session effort (none / low / medium / high)
is yours to pick. Do **not** use `/connect` → “Manually enter API Key” unless you
intentionally want prepaid console credits instead of the subscription.

## Model pin

Canonical OpenCode id: `xai/grok-4.6`.

| Surface | Slug | Why |
|---|---|---|
| Session / `build` / `plan` / `general` / `explore` | `xai/grok-4.6` (no `#variant`) | You pick the effort tier |
| `spec-author`, `test-author`, `coder`, `reviewer`, `/spec-to-ship` | `xai/grok-4.6#high` | Highest effort OpenCode’s xAI SDK will actually send |

`cursor-grok-4.6-xhigh` is a **Cursor** slug. Do not paste it into OpenCode.
Claude Code keeps `opus` in `.claude/agents/`.

### Why `xhigh` blows up here

`invalid xai provider options` with `reasoningEffort: "xhigh"` is
[anomalyco/opencode#43226](https://github.com/anomalyco/opencode/issues/43226).

- xAI’s API **does** accept `reasoning_effort: "xhigh"` on grok-4.6.
- Cursor’s own backend **does** accept `xhigh` (that is what `.cursor/agents` pins).
- OpenCode’s picker advertises an `xhigh` variant.
- The bundled `@ai-sdk/xai` Zod schema only allows `none \| low \| medium \| high`,
  so the request dies **before** it leaves the machine.

Until that SDK/catalog split is fixed, `#high` is the ceiling in OpenCode.
`opencode.json` remaps the advertised `xhigh` variant to `high` so picking it in
the UI does not crash; it does **not** buy you Cursor’s xhigh budget.

## Command, subagents & skills

- **Command**: `/spec-to-ship <path-to-packet>` — `.opencode/command/spec-to-ship.md`.
- **Subagents**: `.opencode/agent/` — `spec-author`, `test-author`, `coder`, `reviewer`.
- **Skills**: `.claude/skills/`.

`.agents/skills/` is the Matt Pocock pack. It does not choose the model.

## Local-only branches

When the human says the branch is local-only, **never push or open a PR**.
`local-main` is always local-only. Never push it. Product packets branch from `main`.
