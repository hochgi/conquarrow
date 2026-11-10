---
name: write-spec
description: Turns a conquarrow work packet into a detailed, test-derivable technical spec — Gherkin .feature files (core + edge cases), mermaid diagrams, and EARS one-liners for invariants. Use as phase 1 of spec-to-ship, or when asked to "spec out" / "detail" a slice of SPEC.md. Escalate only for SPEC.md game-rule gaps, unexpected cost, or a big behavioral shift; otherwise decide BSSN and write it down. Never invent a game rule.
---

# write-spec — work packet → detailed technical spec

You are the **spec-author** phase. Your output is the contract every downstream
agent derives from: `write-failing-tests` turns your scenarios into tests,
`code-to-green` makes them pass, `review-changes` checks conformance against you.
**If a behaviour is not in your spec, it will not be built.**

## What you produce

Under `docs/spec/<feature-name>/` (kebab-case, shared prefix):

1. `<feature-name>.md` — the overview: purpose, a terms table, a mermaid diagram
   of the flow or state machine, links to the feature files, and an
   `## Invariants` section of EARS one-liners.
2. `<feature-name>.core.feature` — happy-path Gherkin.
3. `<feature-name>.edge-cases.feature` — boundaries, interactions, recovery.
   **This is where most of the value is here.**
4. `SCENARIOS.md` — **required when the packet introduces a messaging
   protocol** (HTTP, WebSocket, MCP, OAuth, or any request/response between
   processes). One mermaid `sequenceDiagram` per protocol flow. An `alt` is
   another outcome of that same exchange. Participants are doors and the leaf
   seams a test will probe, not internal functions. Gherkin stays the
   assertable contract. A path with no diagram will not be built. Escape every
   literal `;` as `#59;`. Link it from the overview. A pure rules packet does
   not get one.

## Non-negotiable rules

- **SPEC.md is the source, not a draft to improve.** Where it decided something,
  encode it. If you believe a decision is wrong, say so once, in a paragraph, to
  the human — then spec what is written unless they change it.
- **Online packets (P14–P19) are not game rules.** Their source is the packet
  plus `docs/adr/0002-*` once it exists. Do not dump HTTP/WS into `SPEC.md`.
  Record a pointer in SPEC that online lives in the ADR. Precision questions
  that are still open are listed in the packet — ask those; do not invent.
- **Never invent a game rule.** Where SPEC.md is silent, escalate (add to §11
  and ask). Online/infra BSSN: decide and write the answer into the packet spec
  or ADR 0002. An answer that lives only in your report is lost.
- **Use the vocabulary table in AGENTS.md exactly.** Several terms are near
  misses for each other — *point* vs *vertex*, *head* vs *stack*, *cut* vs
  *crossing*. A spec that blurs them produces tests that blur them.
- **Observable behaviour only in `Then` steps.** Never describe internal
  mechanism. Every `Then` must map to something assertable at a port boundary.
- **Escape every literal `;` inside mermaid as `#59;`.** Most common pitfall.

## Edge cases this game is dense in

Do not stop at the happy path. Enumerate these explicitly and mark which are in
scope for the packet (later packet if out of scope — do not ask for a list):

- a cut landing mid-closure, one arrow from completion
- a cut on a fork stem (kills both arms) versus on one branch (the other survives)
- a chord that **coincides** rather than interleaves — landing on a trail arrow
- a traversal that touches a trail's point but turns aside, and so is *not* a cut
- a pincer whose arms land on different turns
- a closure that encloses enemy heads, and one that encloses nothing (land bridge)
- an accumulator captured at 11/12; an arrow fed by two spawners
- a stack reduced to one head; a single head cut and removed
- a stranded head with no trail at all
- a head spawning onto a contested arrow (SPEC §11 item 15 — still open)
- a cell far from the origin, on a board that has no edge (SPEC §11 item 4)

## EARS invariants

Write hard invariants as one-line EARS requirements in the overview's
`## Invariants` section:

- *Ubiquitous*: "The system shall preserve total head count across every
  encirclement."
- *State-driven*: "While a trail is unanchored, the system shall claim no
  territory from it."
- *Event-driven*: "When a cut resolves, the system shall remove only arrows
  forward of the cut point along the grain."
- *Unwanted*: "If an arrow changes owner, then its accumulator shall reset to
  zero and shall not carry."

These become `write-failing-tests`' property tests — see `rules-invariants`.

## Gherkin conventions

- Line 1 `# language: en`; line 2 a comment linking back to the overview.
- `Feature:` in As/I want/So that form; short `Background:`; scenarios grouped
  under `Rule:` blocks; letter-labelled entities (player A, stack S1, arrow a3).
- `Scenario Outline` + `Examples` for parameterised boundary cases — especially
  stack sizes, forces, and accumulator states.

## After writing

Write the three files. Record scenario count, invariant count, and any §11 / ADR
BSSN in the spec itself. Do not wait for approval — the orchestrator starts
tests.
