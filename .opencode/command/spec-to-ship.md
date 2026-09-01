---
description: Orchestrate spec→tests→code→review→PR+Copilot+merge for one work packet. No human gates.
agent: spec-author
model: xai/grok-4.6#xhigh
---

# /spec-to-ship

Drive one work packet all the way to a squash-merged PR through four phases.
Delegate phases 2–4 to `@test-author`, `@coder`, `@reviewer`.
**Do not stop for human approval between phases.**

The packet: `$ARGUMENTS` under `docs/design/packets/`. Bare ids such as `P56`
resolve against the packet index.

Read `.claude/skills/spec-to-ship/SKILL.md` first. Also `AGENTS.md`, `OPENCODE.md`,
and the packet / SPEC.md.

- **The core is pure.** No `Date.now()`, no `Math.random()`, no I/O in the core.
- **Never invent a game rule.**
- **Model.** Pipeline phases use `xai/grok-4.6#xhigh` (needs OpenCode ≥ 1.18.18).
  Session chat may use other effort tiers.

Escalate only for unexpected cost, a big behavioral shift, or a SPEC.md game-rule gap.

Phase 1 — `spec-author` in the main thread (`write-spec`).
Phase 2 — `@test-author` (`write-failing-tests`), red for the right reason.
Phase 3 — `@coder` (`code-to-green`). Kick back rather than invent a rule.
Phase 4 — `@reviewer` (`review-changes`). Prepares PR body; does not push.

Orchestrator: commit, push `hochgi`, PR (`🤖: `), Copilot, triage, squash-merge
when CI is green. Never push `shalevhoch` or `local-main`.
