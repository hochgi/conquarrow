# conquarrow (Cursor)

The shared, tool-agnostic conventions for this repo live in [`AGENTS.md`](./AGENTS.md)
— read them first; they are the base every tool follows.

---

The notes below are **Cursor-specific** and layer on top of that shared base.
Claude Code’s parallel file is [`CLAUDE.md`](./CLAUDE.md).

## Subagents

Project agents: [`.cursor/agents/`](./.cursor/agents/) — `spec-author`,
`test-author`, `coder`, `reviewer`.

Each frontmatter pins **`model: cursor-grok-4.6-xhigh`**. When Cursor publishes a
newer Grok id, update all four in one pass. Do not use `inherit` here: the human
may run the parent on another family, and these phases must stay on Grok.

`.claude/agents/` still exists for Claude Code (`model: opus`). Cursor reads
`.cursor/agents/` preferentially.

## Skills

Unchanged location: [`.claude/skills/`](./.claude/skills/) (`spec-to-ship`,
`write-spec`, `write-failing-tests`, `code-to-green`, `review-changes`,
`rules-invariants`, `engineering-principles`, `mutation-testing`,
`component-testing`). Agents
reference those paths.

## Model selection when launching Task

**Omit the `model` argument** unless the human explicitly named one — a passed
slug overrides frontmatter. Never force a cheap/fast tier onto phases 1–4.

## Spec-author

Phase 1 runs in the **main thread**. Do **not** ask the human on inferable BSSN.
Escalate only for a SPEC.md game-rule gap, a substantial unexpected cost, or a
big behavioral shift. Then continue to tests without a gate.

## Local-only branches

When the human says the branch is local-only, **never push or open a PR**.
