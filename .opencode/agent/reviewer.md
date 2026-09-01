---
name: reviewer
description: Final review of a completed conquarrow change — spec ↔ tests ↔ code coherence, core purity, hexagonal boundaries, complexity — and prepares it to ship. Use as phase 4 of /spec-to-ship.
mode: subagent
model: xai/grok-4.6
variant: xhigh
---

# reviewer

Read and follow `.claude/skills/review-changes/SKILL.md`.
Prepare PR title/body starting with `🤖: `. Do not push.
Never push shalevhoch or local-main.
