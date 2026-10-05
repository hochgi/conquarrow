---
name: spec-to-ship
description: >-
  Orchestrator overview of the 4-phase delivery pipeline for conquarrow:
  spec-author → test-author → coder → reviewer → PR + Copilot + merge. No
  human gate between phases. Escalate only for unexpected cost, a big
  behavioral shift, or a SPEC.md game-rule gap.
---

# Spec-to-Ship (multi-agent pipeline)

The delivery workflow for every non-trivial change in conquarrow. It exists
because plausible-looking-but-wrong code is the dominant failure mode in
agent-driven development. The loop kills it by forcing the design conversation
before tests, tests before code, and a coherence check after.

There is **no human gate** between phases. The human is reached only for a
**substantial unexpected cost**, a **big behavioral shift** versus SPEC.md / ADR
0002 / a shipped packet, or a **SPEC.md game-rule gap**. Online/infra BSSN:
decide, write it down, continue.

## The particular failure mode this repo has

Most repos risk an agent writing *bad* code. This one risks an agent writing
**good code implementing a rule nobody chose.**

`SPEC.md` is unusually complete — every structural mechanic was argued to a
conclusion, and many of those conclusions are counter-intuitive: forward-only
evaporation, unanchored trails claiming nothing, closure requiring departure
*and* landing, an accumulator that carries a remainder but resets on capture.
Each has a plausible alternative that an agent will reach for naturally, and each
alternative produces a game that compiles, passes hand-written tests, and is
quietly the wrong game.

So the **phases** are not ceremony. A wrong *game* rule is still expensive if it
lands in tests. **Do not invent a game rule.** If SPEC.md §11 is silent, escalate.
Online packets live in ADR 0002; reason those yourself.

## The four phases

```
  PHASE 1 — SPEC             spec-author (main thread)
    packet → Gherkin .feature + mermaid + EARS
    skill: write-spec
  PHASE 2 — FAILING TESTS    test-author
    one component test per scenario, property tests, skeletons — red
  PHASE 3 — CODE TO GREEN    coder
    implement behind the ports, refactor within budget, keep the core pure
  PHASE 4 — REVIEW           reviewer
    spec↔tests↔code, purity, boundaries
  SHIP — orchestrator
    PR on hochgi/conquarrow → Copilot review → triage → squash-merge
```

Do not collapse phases. Do not wait for a thumbs-up between them.

## Context is handed off through artifacts, not chat

Each phase's output — the spec files, the red suite, the diff, the review — is
the durable interface to the next phase. Write for an agent that does not share
your context window. A phase that resolved an ambiguity must write the
resolution into `SPEC.md` (game) or the packet spec / ADR (online), not just
into its report.

## Where phase 1 differs from a normal spec phase

`SPEC.md` already says what to build. Phase 1 **translates** decided prose into
executable scenarios and **interrogates** §11. Precision questions you can
answer from the packet, ADR, or BSSN: answer them and record the answer. Do not
ask the human those.

## Escalate (only)

- Substantial unexpected cost (new always-on AWS, paid Google beyond GIS, …).
- Big behavioral shift versus SPEC.md, ADR 0002, or a shipped packet.
- SPEC.md game-rule gap — add to §11 and ask; do not pick a default.

## Ship loop

1. Push to `hochgi/conquarrow` only (never `shalevhoch`).
2. Open the PR; body starts with `🤖: `.
3. Request Copilot review. Wait for comments.
4. Fix / defer / reject each comment; reply `🤖: `.
5. Squash-merge when CI is green, unless an escalate item appeared.

## When NOT to run the full pipeline

Typo fixes, doc-only changes, mechanical refactors with no observable delta,
dependency bumps, and **tooling/harness packets** skip the four-phase Gherkin
loop — ship with a one-line scope note. Everything that touches the rules
engine, or an online adapter's observable behaviour, runs the pipeline.

**Committed tests are the pipeline.** Phase 2 writes Vitest against ports. At an
I/O edge (`packages/online-api`) those tests may use `@hochgi/test-kit*` — see
`component-testing`. Never in `contracts`, `rules-core` or `geometry-*`.

## References

- Command: `.claude/commands/spec-to-ship.md`
- Phase skills: `write-spec`, `write-failing-tests`, `code-to-green`, `review-changes`
- Support skills: `rules-invariants`, `engineering-principles`, `mutation-testing`, `component-testing`
- Design source of truth: `SPEC.md` (game); `docs/adr/0002-cheap-async-online.md` (online)
- Packet index: `docs/design/02-work-packets.md`
