---
description: Orchestrate spec→tests→code→review→PR+Copilot+merge for one work packet. No human gates.
agent: spec-author
model: xai/grok-4.6#high
---

# /spec-to-ship

Drive one work packet all the way to a squash-merged PR through four phases.
Delegate phases 2–4 to the project subagents (`test-author`, `coder`, `reviewer`)
via OpenCode Task / `@agent`. **Do not stop for human approval between phases.**

The packet to work from: `$ARGUMENTS` — a path under `docs/design/packets/`.
Bare ids such as `P56` mean `docs/design/packets/P56-home-expedition.md` (resolve
against the packet index). If the argument is missing, list the packet index from
`docs/design/02-work-packets.md`, pick the next unblocked packet, and run.

Read `.claude/skills/spec-to-ship/SKILL.md` first. Do not collapse phases.

**Before anything else**, read `AGENTS.md` and the packet (game packets: the
relevant `SPEC.md` sections; online packets: ADR 0002). Also read `OPENCODE.md`.

- **The core is pure.** No `Date.now()`, no `Math.random()`, no I/O in the rules
  engine, ever.
- **Never invent a game rule.** SPEC.md silence is an escalate, not a default.
  Online/infra BSSN: decide, document, continue.
- **Model.** Pipeline phases use `xai/grok-4.6#high` (SuperGrok OAuth). Do not
  pass a different model when launching a subagent unless the human named one.
  Session chat may use other effort tiers; `#xhigh` is not sendable in OpenCode
  until @ai-sdk/xai accepts it.

**Escalate and wait** only for: a substantial unexpected cost, a big behavioral
shift versus SPEC.md / ADR 0002 / a shipped packet, or a SPEC.md game-rule gap.

**Who runs where.**

- **Phase 1** — adopt `spec-author` in the main thread (context quality). Do
  not ask the human on inferable BSSN.
- **Phases 2–4** — delegate to `@test-author`, then `@coder`, then `@reviewer`.
  On each result, launch the next phase immediately unless the agent kicked back
  to phase 1 or an escalate item appeared.

## Phase 1 — Specify (role: `spec-author`, skill: `write-spec`)

Turn the packet into Gherkin, mermaid (`#59;` for `;`), and EARS under
`docs/spec/<feature>/`. Encode decided prose. Record BSSN in the spec / ADR.

Then start phase 2. Do not present a gate.

## Phase 2 — Red (agent: `test-author`, skill: `write-failing-tests`)

One failing component test per scenario, property tests, skeletons. Confirm red
for the right reason. Then phase 3.

## Phase 3 — Green (agent: `coder`, skill: `code-to-green`)

Implement until green. Kick back to phase 1 rather than invent a rule. Then
phase 4.

## Phase 4 — Review (agent: `reviewer`, skill: `review-changes`)

Coherence, purity, boundaries. Reviewer prepares title/body; does not push.

## Ship

Orchestrator: commit, push `hochgi`, open PR (`🤖: `), request Copilot review,
wait, triage comments (fix / defer / reject, reply `🤖: `), squash-merge when
CI is green. Never push `shalevhoch` or `local-main`.
