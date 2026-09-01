# conquarrow (OpenCode)

Shared conventions: [`AGENTS.md`](./AGENTS.md).

## Auth

```
/connect    # xAI → SuperGrok Subscription
```

Never commit `XAI_API_KEY`.

List what this login actually exposes:

```
opencode models xai
```

If `xai/grok-4.6` is missing and you only see `grok-4.20-*`, say so — that is the
SuperGrok catalog, not a typo in this repo.

## Model pin

| Surface | model | variant |
|---|---|---|
| Session | `xai/grok-4.6` | you pick |
| spec-to-ship agents + command | `xai/grok-4.6` | `xhigh` |

Write them as **two fields**. Do not use `xai/grok-4.6#xhigh` — OpenCode looks
that up as a single catalog key and fails with “Did you mean grok-4.20-…”.

Needs OpenCode ≥ 1.18.18 for xhigh on xAI (`opencode upgrade`).

## Pipeline

`/spec-to-ship P56` — `.opencode/command/spec-to-ship.md`
Agents: `.opencode/agent/{spec-author,test-author,coder,reviewer}.md`
Skills: `.claude/skills/`
