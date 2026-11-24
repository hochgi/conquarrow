# conquarrow (OpenCode)

Shared conventions: [`AGENTS.md`](./AGENTS.md).

## Auth

```
/connect    # xAI → SuperGrok Subscription
```

Never commit `XAI_API_KEY`.

## GitHub

`gh` is authenticated by sourcing `~/.zshrc` (`zsh -lic 'gh …'`). Do not use
`security` to read a token. Push a feature branch over SSH
(`git@github.com:hochgi/conquarrow.git`). Never push `main`. Squash-merge with
`gh pr merge --squash` once CI is green. If `gh` is not logged in after sourcing
`~/.zshrc`, ask the user to auth the GitHub MCP or `gh`, and stop. Do not land
the change another way.

List what this login actually exposes:

```
opencode models xai
```

If `xai/grok-4.7` is missing and you only see older Grok ids, say so — that is the
SuperGrok catalog, not a typo in this repo.

## Model pin

| Surface | model | variant |
|---|---|---|
| Session | `xai/grok-4.7` | you pick |
| `/spec-to-ship` (phase 1, this thread) | `xai/grok-4.7` | `xhigh` |
| spec-author | `xai/grok-4.7` | `xhigh` |
| test-author | `xai/grok-4.7` | `high` |
| coder | `xai/grok-4.7` | `high` |
| verifier | `xai/grok-4.7` | `low` |
| reviewer | `xai/grok-4.7` | `xhigh` |

Write them as **two fields**. Do not use `xai/grok-4.7#xhigh` — OpenCode looks
that up as a single catalog key and fails with “Did you mean grok-4.20-…”.

Needs OpenCode ≥ 1.18.18 for xhigh on xAI (`opencode upgrade`).

## Pipeline

`/spec-to-ship P56` — `.opencode/command/spec-to-ship.md`
Five phases, no approval gates, no babysit, no pasted-report handoff.
Agents: `.opencode/agent/{spec-author,test-author,coder,verifier,reviewer}.md`
Skills: `.claude/skills/` (OpenCode discovers them natively)
Rules: `.claude/rules/*.md` via `instructions` in `opencode.json`. OpenCode has
no path scoping, so these load every session; each rule names its own scope.
