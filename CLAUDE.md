# conquarrow (Claude Code)

The shared, tool-agnostic conventions for this repo live in AGENTS.md — read them
first; they are the base every tool follows.

@AGENTS.md

---

The notes below are **Claude-Code-specific** and layer on top of the shared
conventions above.

## Pipeline

The live `/spec-to-ship` pipeline is the OpenCode command
[`.opencode/command/spec-to-ship.md`](.opencode/command/spec-to-ship.md).
The orchestrator runs the phases. There is no second pipeline here, no babysit
step, and no handoff that waits for a pasted report.

Skills in `.claude/skills/` are shared. OpenCode loads them. Rules in
`.claude/rules/` stay path-scoped; each Cursor copy in `.cursor/rules/` keeps
`paths` and `globs` in step.

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

Spec edits belong to phase 1. Phases 2 and 3 kick back rather than edit the
spec. The reviewer is read-only; a spec fix it finds is the same kickback.
