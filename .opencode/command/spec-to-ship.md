---
description: Orchestrate spec→tests→code→review→PR+Copilot+merge for one work packet. No human gates.
agent: spec-author
model: xai/grok-4.6
variant: xhigh
---

# /spec-to-ship

Drive one work packet to a squash-merged PR through four phases.
Packet: `$ARGUMENTS` under `docs/design/packets/` (bare `P56` is fine).

Read `.claude/skills/spec-to-ship/SKILL.md`, `AGENTS.md`, `OPENCODE.md`.

Model is `xai/grok-4.6` with variant `xhigh`. Do not write `xai/grok-4.6#xhigh`
— OpenCode treats that whole string as a catalog id.

Phase 1 — spec-author / write-spec (main thread).
Phase 2 — @test-author / write-failing-tests.
Phase 3 — @coder / code-to-green.
Phase 4 — @reviewer / review-changes.

Orchestrator ships the PR. Never push shalevhoch or local-main.
