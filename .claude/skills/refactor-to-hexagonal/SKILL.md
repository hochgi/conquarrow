---
name: refactor-to-hexagonal
description: Deliberate layer cleanup in conquarrow — move logic to its rightful hexagonal home (port, pure core, geometry impl, adapter composite, I/O leaf) without changing behaviour. Use when asked to improve architecture, layering, injection or boundaries, to deduplicate code across packages, or to move logic from web / mcp / online-api into the core.
---

# refactor-to-hexagonal

A refactor changes *where* behaviour lives, never *what* it is. BSSN and the
ratchet (AGENTS.md) set the bar for every touched slice; this is the workflow
for when cleanup *is* the task.

## The homes

| Home | Holds |
|---|---|
| `contracts` | ports, domain DTOs, value helpers every side needs (`speed` in `move.ts`) |
| `rules-core` | the pure game — `apply`, legal moves, closure, fill, economy; imports only `contracts` |
| `geometry-*` | `GeometryPort` implementations, passing its conformance suite |
| adapter composite | orchestration: `online-api` handlers (which own HTTP status via `json-result.ts`), `mcp` tools, `web` controllers and bots |
| leaf | one kind of I/O, DTO in / DTO out — `.claude/rules/adapter-leaf-dependencies.md` |
| pure helper | one-caller in-process logic, a plain function |

## Moving logic inward promotes it to a rule

Game-shaped logic in `web/` or `mcp/` — a legality check, a scoring shortcut, a
fill estimate — is a UI or bot heuristic. Moved into `rules-core`, it becomes a
rule. Before it crosses, find the SPEC.md **sentence** that requires the
behaviour:

- Found → move it; the core suite becomes its contract.
- Absent → it stays in the adapter. Add the gap to SPEC §11 and report it.

Collapsing duplicates follows the same rule. Two copies that differ are two
behaviours; name the difference and ask which one is intended.

## Workflow

1. **Read the slice end to end** — entry point (route in `create-online-api.ts`,
   MCP tool, React component) → composite → leaves → core calls → the tests over
   each. Done when you can name every file the behaviour passes through.
2. **Classify** every touched unit into one home from the table.
3. **List violations before editing**, one line each:
   `file:line — unit — what is misplaced — rightful home`.
4. **Decide each violation** against this checklist; drop the ones that fail it.
   - An existing port, handler, leaf or helper is the natural home → move it there.
   - It crosses a real external boundary → thin injected leaf with an interface.
   - It is in-process logic → private function or pure helper.
   - The move removes logic from an entry point, isolates I/O, removes a
     duplicate, or makes a test possible now.
   - It stays inside the slice you read.
5. **Pin behaviour first.** Code with no test at its current home gets a
   characterization test there (or at the port) before it moves. Refactor
   commits keep every assertion as it was.
6. **Move in small steps** — `git mv` where a file moves whole — with
   `pnpm verify` green after each.
7. **Diff the behaviour.** Run `regression-dog` over the refactor range. Each
   listed delta is a bug you introduced or a deliberate fix you name in the PR.

## Done when

- `rules-core` imports only `contracts`; no adapter type crosses into either.
- Composites receive every leaf injected; SDK clients and `fetch` are built in
  leaf factories or the composition root.
- Status codes and HTTP envelopes stay at the `online-api` handler layer.
- Every listed violation is fixed, or named in the PR as still wrong with its
  rightful home.
- `pnpm verify` is green, replay fixtures are byte-identical, and the
  `regression-dog` delta is empty or explained.
