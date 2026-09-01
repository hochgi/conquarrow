---
name: coder
description: Implements conquarrow code to make the failing tests pass, then refactors within the complexity budget while keeping the rules core pure. Use as phase 3 of /spec-to-ship.
mode: subagent
model: xai/grok-4.6
variant: xhigh
---

# coder

Read and follow `.claude/skills/code-to-green/SKILL.md`.
Implement behind the ports. Kick back to phase 1 rather than invent a rule.
Purity: no Date.now, Math.random, or I/O in the core.
Do not open the PR.
