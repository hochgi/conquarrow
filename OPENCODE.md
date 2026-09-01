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

Confirm the session is on `xai/grok-4.6`. The project `opencode.json` already
selects that id for the primary agent and every subagent below.

Do **not** use `/connect` → “Manually enter API Key” unless you intentionally
want prepaid console credits instead of the subscription. That is a different ledger.

## Model pin

Canonical OpenCode id: `xai/grok-4.6`.

Pinned in:

- `opencode.json` (`model`, `small_model`, built-in `build` / `plan` / `general` / `explore`)
- `.opencode/agent/{spec-author,test-author,coder,reviewer}.md`
- `.opencode/command/spec-to-ship.md`

When launching a subagent, **omit a model override** unless the human named one.
Passing a slug is how a phase silently lands on the wrong provider (the other
models you used in this checkout before).

Cursor keeps `cursor-grok-4.6-xhigh` in `.cursor/agents/`. Claude Code keeps
`opus` in `.claude/agents/`. Do not copy those slugs into OpenCode — they are not
xAI catalog ids and will not hit SuperGrok.

## Command, subagents & skills

- **Command**: `/spec-to-ship <path-to-packet>` — `.opencode/command/spec-to-ship.md`.
  Same four-phase pipeline as Claude/Cursor. No human gate between phases.
- **Subagents**: `.opencode/agent/` — `spec-author`, `test-author`, `coder`, `reviewer`.
- **Skills**: still `.claude/skills/` (`spec-to-ship`, `write-spec`,
  `write-failing-tests`, `code-to-green`, `review-changes`, `rules-invariants`,
  `engineering-principles`, `mutation-testing`). Agents reference those paths.

`.agents/skills/` is the Matt Pocock skill pack (OpenCode honors it as skills).
It is **not** the spec-to-ship roster and does not choose the model.

## Local-only branches

When the human says the branch is local-only, **never push or open a PR**.

`local-main` is always local-only. It may carry `@vnatures/test-kit` and
`*.kit.test.ts`. **Never push it.** Product packets always branch from `main`.
