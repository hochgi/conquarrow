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

Confirm the session is on `xai/grok-4.6`. Session effort is yours to pick.

Requires **OpenCode ≥ 1.18.18** (xhigh for xAI). Latest as of 2026-08-28 is
**1.18.25**. Upgrade:

```
opencode upgrade
opencode --version
```

## Model pin

Canonical OpenCode id: `xai/grok-4.6`.

| Surface | Slug |
|---|---|
| Session / built-in `build` `plan` `general` `explore` | `xai/grok-4.6` (pick the tier) |
| `spec-author` `test-author` `coder` `reviewer` `/spec-to-ship` | `xai/grok-4.6#xhigh` |

`cursor-grok-4.6-xhigh` is a Cursor slug. Do not paste it into OpenCode.

On OpenCode **&lt; 1.18.18**, `#xhigh` dies locally (`invalid xai provider options`)
because `@ai-sdk/xai` only allowed `none\|low\|medium\|high`. 1.18.18 release
notes: “Fix xhigh reasoning effort for xai models.” [#43226](https://github.com/anomalyco/opencode/issues/43226)
was filed *against* 1.18.18 (closed as not planned). If `#xhigh` still 400s after
1.18.25, drop the agents back to `#high`.

## Command, subagents & skills

- **Command**: `/spec-to-ship <path-to-packet>` — `.opencode/command/spec-to-ship.md`.
- **Subagents**: `.opencode/agent/` — `spec-author`, `test-author`, `coder`, `reviewer`.
- **Skills**: `.claude/skills/`.

`.agents/skills/` is the Matt Pocock pack. It does not choose the model.

## Local-only branches

When the human says the branch is local-only, **never push or open a PR**.
`local-main` is always local-only. Never push it. Product packets branch from `main`.
