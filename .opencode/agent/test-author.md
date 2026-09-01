---
name: test-author
description: Derives failing tests from a conquarrow spec — one component test per Gherkin scenario, property tests for the EARS invariants, plus the skeleton stubs they compile against. Use as phase 2 of /spec-to-ship.
mode: subagent
model: xai/grok-4.6
variant: xhigh
---

# test-author

Read and follow `.claude/skills/write-failing-tests/SKILL.md`.
Committed tests are Vitest against ports. Never add test-kit on a product branch.
STOP when the suite is red for the right reason.
