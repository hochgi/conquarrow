---
description: Drive one work packet through spec, red tests, green, a read-only verify, and a read-only review, then open the PR. No approval gates.
model: xai/grok-4.7
variant: xhigh
---

# /spec-to-ship

Drive `$ARGUMENTS` (a path under `docs/design/packets/`, or a bare `Pnn`) to a
squash-merged PR. You are the orchestrator. You run every phase. There is no
babysit step and no handoff that waits for a pasted report.

**No approval gates.** Do not pause between phases and do not present finished
work for sign-off. Halt only for a SPEC.md game-rule gap, a substantial
unexpected cost, or a big behavioural shift versus SPEC.md, ADR 0002, or a
shipped packet. Online/infra BSSN: decide, write it down, continue.

Read `.claude/skills/spec-to-ship/SKILL.md` and `AGENTS.md` first. Do not
collapse phases. Context moves through artifacts, not chat history.

**A subagent's "green" is a hypothesis.** Re-run the gate yourself after every
phase. Omit the `model` argument when launching a subagent — frontmatter is the
pin. Model and variant are two fields. Never write `xai/grok-4.7#xhigh`.

| Phase | Who | Variant |
|---|---|---|
| 1 spec | you, in this thread, following `spec-author` / `write-spec` | `xhigh` |
| 2 red | `@test-author` | `high` |
| 3 green | `@coder` | `high` |
| 4 verify | `@verifier`, read-only | `low` |
| 5 review | `@reviewer`, read-only | `xhigh` |

## Repo facts

```bash
pnpm verify                         # typecheck && lint && test — the gate
pnpm test:mutation:changed          # Stryker on the changed lines, any package — mandatory
pnpm test:mutation:incremental      # whole rules-core baseline; never the gate
pnpm test:mutation:online-api       # whole online-api baseline; never the gate
```

- Remote `hochgi` (`github.com:hochgi/conquarrow.git`). Base `main`. Never push
  `shalevhoch`. Never push `main`. PR title and body start with `🤖: `.
- The core is pure. Never invent a game rule. SPEC.md silence goes to §11.
- A protocol delivery (HTTP, WebSocket, MCP, OAuth, or any request/response
  between processes) has `docs/spec/<feature>/SCENARIOS.md`. Each `alt`, `opt`,
  and `par` is its own `@hochgi/test-kit` component test. A scripted fetch is
  not that test. Confirm the file and the tests yourself before phase 3. The
  example is `docs/spec/session-expired/SCENARIOS.md` probed in
  `packages/web/test/session-expired.scenarios.test.ts`.

## Phase 1 — Specify (this thread)

Follow `.opencode/agent/spec-author.md` and `write-spec`. Write the spec under
`docs/spec/<feature>/`. Do not launch a subagent for this phase.

## Phase 2 — Red (`@test-author`)

Delegate with the spec paths. Then run the new tests yourself and read every
failure. Red for a missing behaviour, not a compile error. A protocol packet
with only scripted-fetch tests is not red for the diagram — send it back.

## Phase 3 — Green (`@coder`)

Delegate. Then run `pnpm verify` yourself. Do not accept a survivor
classification from the coder.

## Phase 4 — Verify (`@verifier`)

Delegate. It cannot edit files. It re-runs `pnpm verify` and
`pnpm test:mutation:changed` — **Stryker on every change, in every package**,
mutating only the changed lines and running only the tests that reach them.
It does not run CRAP as a gate or decide that a mutant is equivalent.

Both exit codes are the gate. `test:mutation:changed` exit 2 (a survivor or a
no-coverage mutant) goes back to `@test-author` (kill it, or suppress it with
the invariant). Exit 1 — nothing to mutate, no test reaches the change, zero
mutants — is a **failure, not a pass**: you extend or scope
`scripts/stryker-changed.mjs` / `stryker.changed.config.json` to the changed
files and re-run. Never skip it and never substitute a whole-package run. A
red `pnpm verify` goes back to `@coder`. Then verify again, until both exit 0.
Put the `stryker-changed: score` line in the PR body.

## Phase 5 — Review (`@reviewer`)

Delegate, read-only, with the verifier's suppression list. It judges spec ↔
tests ↔ code, including every diagram path, and every suppression. It does not
fix. Route a must-fix to the phase that owns it. Any change re-runs phase 4,
then phase 5.

## Ship

Push the feature branch to `hochgi` only. SSH is fine
(`git@github.com:hochgi/conquarrow.git`). Never push `main`. Never push
`shalevhoch`. Open the PR with `gh`. Body starts with `🤖: ` and links the
packet and the spec, including `SCENARIOS.md` when the packet has a protocol.
Squash-merge with `gh pr merge --squash` once CI is green, unless an escalate
item appeared. A local squash pushed to `main` is not that merge. The same PR
updates `docs/design/backlog.md`: delete the shipped item, add what the run
turned up.

Authenticate `gh` by sourcing `~/.zshrc` (`zsh -lic 'gh …'`). Do not use
`security` to read a token. If that does not log `gh` in, ask the user to auth
the GitHub MCP or `gh`, and stop. Do not land the change another way.

## Skip the pipeline

Typo fixes, doc-only changes, mechanical refactors with no observable delta,
dependency bumps, and tooling/harness packets. Ship a small PR with a one-line
scope note.
