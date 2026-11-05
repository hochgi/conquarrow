---
description: Orchestrate spec→tests→code→review→PR→merge for one work packet. Phase 3 is handed to OpenCode/grok.
argument-hint: <path-to-work-packet>
---

# /spec-to-ship

Drive one work packet all the way to a squash-merged PR through four phases,
delegating each phase to its dedicated subagent via the **Agent** tool.
**Do not stop for human approval between phases.**

The packet to work from: `$ARGUMENTS` — a path under
`docs/design/packets/`. If it is missing, list the packet index from
`docs/design/02-work-packets.md`, pick the next unblocked packet, and run.

Read the `spec-to-ship` skill first. Do not collapse phases.

**Before anything else**, read `AGENTS.md` and the packet (game packets: the
relevant `SPEC.md` sections; online packets: ADR 0002).

- **The core is pure.** No `Date.now()`, no `Math.random()`, no I/O in the rules
  engine, ever.
- **Never invent a game rule.** SPEC.md silence is an escalate, not a default.
  Online/infra BSSN: decide, document, continue.

**Escalate and wait** only for: a substantial unexpected cost, a big behavioral
shift versus SPEC.md / ADR 0002 / a shipped packet, or a SPEC.md game-rule gap.

**Who runs where.**

- **Phase 1** — adopt `spec-author` in the main thread (context quality). Do
  not AskUserQuestion on inferable BSSN.
- **Phases 2 and 4** — delegate via the Agent tool. On each result, go on
  immediately unless the agent kicked back to phase 1 or an escalate item
  appeared.
- **Phase 3** — handed to OpenCode on `xai/grok-4.7`, to save Claude tokens.
  Write the handoff prompt, stop, and wait for the human to paste back grok's
  report. Run it in a `coder` subagent instead only if the human asks.

**Model selection.** Omit the `model` argument when launching a subagent unless
the human explicitly named one.

## Phase 1 — Specify (role: `spec-author`, skill: `write-spec`)

Turn the packet into Gherkin, mermaid (`#59;` for `;`), and EARS under
`docs/spec/<feature>/`. Encode decided prose. Record BSSN in the spec / ADR.

Then start phase 2. Do not present a gate.

## Phase 2 — Red (agent: `test-author`, skill: `write-failing-tests`)

One failing component test per scenario, property tests, skeletons. Confirm red
for the right reason. Then phase 3.

## Phase 3 — Green (handoff to OpenCode/grok, skill: `code-to-green`)

Do not code phase 3 in Claude. Commit and push phases 1–2 on the packet branch,
then write `archive/handoffs/<Pnn>-phase3-prompt.md` in the main checkout
(never committed). Show the human the whole prompt and its path. Then **stop
and wait**: the human runs it in OpenCode and pastes grok's report back.

Write the prompt for an agent with no context but the repo. It must stand on
its own, with these sections:

1. **Where and how to start.** The folder (the worktree path), branch, the
   expected `git log --oneline -1` SHA, the `git pull --ff-only` and
   `pnpm install --frozen-lockfile` commands. Start `opencode` there on
   `xai/grok-4.7` with variant `xhigh`, as the `coder` agent (`@coder`).
   Follow `.claude/skills/code-to-green/SKILL.md` and `AGENTS.md`.
2. **The goal and the decided design.** What the packet changes, the spec
   files under `docs/spec/<feature>/`, and every decision phase 1 made that
   the code must follow. Quote the SPEC rule when it is a rules change.
3. **Exact paths.** The files it may edit, the files it must not touch (tests,
   specs, SPEC.md, unrelated constants), and where the logic belongs.
4. **The loop.** The exact `pnpm vitest run …` command for the red suite and
   the expected red/green counts; hotspot-expansion-review before extending a
   large function; the complexity budget; `pnpm verify` before done.
5. **Kickback rule.** If a test or the spec looks wrong, or passing needs a
   behaviour the spec does not state: stop and report. Never edit tests or the
   spec, never invent a rule. List the tempting shortcuts for this packet as
   forbidden (retuned constants, raised budgets, caches, randomness, clocks,
   unordered iteration feeding a decision).
6. **Measurement**, when the packet has a gate: the exact free bench commands
   (never `--yes`), on a clean tree, and the numbers to report.
7. **Commit rules.** Messages start with `🤖: `; stage paths explicitly; never
   stage `archive/` or bench results; push to `hochgi` only; the pre-push hook
   must pass; check `git ls-remote` equals `HEAD`. No PR, no merge, no `main`.
8. **What to report back.** Final SHA and the ls-remote check, the `pnpm verify`
   summary, measurements, every file changed, kickbacks or "none", and the
   hotspot outcome.

When the report arrives, check it against the branch (`git fetch`, the SHA, the
diff) before trusting it. A kickback goes to phase 1 or 2 here, then a short
follow-up prompt in `archive/handoffs/` for grok. Then phase 4.

## Phase 4 — Review (agent: `reviewer`, skill: `review-changes`)

Coherence, purity, boundaries. Reviewer prepares title/body; does not push.

## Ship

Orchestrator: commit, push `hochgi`, open PR (`🤖: `), squash-merge when CI is green.
The reviewer phase is the review gate. Never push `shalevhoch`.
