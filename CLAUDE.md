# conquarrow (Claude Code)

The shared, tool-agnostic conventions for this repo live in AGENTS.md — read them
first; they are the base every tool follows.

@AGENTS.md

---

The notes below are **Claude-Code-specific** and layer on top of the shared
conventions above.

## Command, subagents & skills available here

- **Command**: `/spec-to-ship <path-to-packet>` orchestrates the four-phase
  pipeline, then opens a PR and squash-merges once CI is green. **No human
  gate between phases.** Escalate only for unexpected cost, a big behavioral
  shift, or a SPEC.md game-rule gap. Phase 1 runs in the main thread; phases
  2 and 4 are delegated via the Agent tool; phase 3 is a handoff prompt the
  human runs in OpenCode on grok (see below).
- **Subagents** (`.claude/agents/`): `spec-author`, `test-author`, `coder`,
  `reviewer`.
- **Skills** (`.claude/skills/`): `spec-to-ship`, `write-spec`,
  `write-failing-tests`, `code-to-green`, `review-changes`, `rules-invariants`,
  `engineering-principles`, `mutation-testing`, `component-testing`,
  `refactor-to-hexagonal`, `hotspot-expansion-review`, `regression-dog`.
- **Rules** (`.claude/rules/`): path-scoped, loaded when a matching file is
  read or edited. Each is also Cursor's rule via a symlink in `.cursor/rules/`,
  so its frontmatter carries both `paths` (Claude) and `globs` (Cursor) — keep
  the two lists in step.

## Model selection

Agent frontmatter is authoritative. **When launching a subagent via the Agent
tool, omit the `model` argument** unless the human explicitly named one —
passing a slug overrides the frontmatter, which is how a phase silently ends up
on the wrong tier.

No phase here is a cheap-tier phase. In particular phase 3 is not: in this
codebase "make the test pass" routinely conceals a design call — whether a
crossing interleaves, whether an accumulator carries, whether a fragment
re-attaches — and those are exactly the decisions AGENTS.md forbids inventing.

## Save Claude tokens: hand mechanical work to OpenCode

The human keeps Claude (Opus) for reasoning: specs, design calls, test
derivation, review. Work that is execution rather than judgement goes to
OpenCode on `xai/grok-4.7` (SuperGrok subscription, see `OPENCODE.md`) as a
fully detailed handoff prompt:

- **Phase 3 of `/spec-to-ship`, always** (unless the human says otherwise).
  The prompt's sections are in `.claude/commands/spec-to-ship.md`.
- Other long mechanical runs when they would cost many Claude tokens, such as a
  large rename or a bulk fixture rewrite. Ask the human first.

Write the prompt to `archive/handoffs/` (never committed), show it in full,
then stop. The human pastes back grok's report. Check it against the branch
before trusting it. grok gets the same rules: no invented game rule, kick back
instead.

## Reading order for a cold start

1. `AGENTS.md` — conventions, the purity blinker, the vocabulary table.
2. `SPEC.md` — the design. It is long but it is the whole product; §11 is the
   live list of what is *not* decided.
3. `docs/design/02-work-packets.md` — what is being built, in what order.
   `docs/design/backlog.md` is the short list of what is open and next.
4. The packet doc for whatever you are working on.

Do not start from the code. There is very little of it yet, and the spec is
denser than anything the code will tell you.

## Working with SPEC.md

SPEC.md states the current design only, once per rule: no strikethroughs or
"resolved" notes, history in git, reasoning in ADRs. See "SPEC.md states the
current design, once" in AGENTS.md.

Spec edits are a normal part of phases 1 and 4, and are out of bounds in phases
2 and 3 — a test or an implementation that wants the spec changed is a signal to
kick back to phase 1, not to edit around it.
