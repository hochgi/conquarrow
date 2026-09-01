# conquarrow — shared conventions

Tool-agnostic conventions for this repo. Every developer and every AI coding tool
(Claude Code, Cursor, OpenCode, Codex, …) follows these regardless of IDE. Tool-specific
notes live in each tool's own file (`CLAUDE.md`, `CURSOR.md`, `OPENCODE.md`, …) and import this
one as the shared base.

## What this repo is

A turn-based territorial conquest game played on an arrow tiling — Volfied's
carve-and-enclose loop rebuilt as a deterministic skirmish game. Players advance
**heads** along arrows, leaving **trails**; closing a shape claims everything
inside it, including enemy units and spawner shares.

- **Design source of truth: [`SPEC.md`](./SPEC.md)** at the repo root. It is
  complete for MVP — every structural mechanic is decided. §11 lists the
  remaining tuning constants and the one geometry measurement.
- Architecture decisions: `docs/adr/`.
- Work packets (the unit of delivery): `docs/design/02-work-packets.md`.

## The blinker that matters most: the core is pure

The rules engine is a pure function.

```
apply(state, move) -> state
```

**No `Date.now()`, no `Math.random()`, no I/O, no input mutation — anywhere in
the core.** Not in a helper, not "just for a tiebreak", not behind a flag.

This is not a testing convenience, it is a **product property**. SPEC.md has zero
randomness by design: combat is a deterministic 1:1 exchange (§6.2), spawner timing is
deterministic irregularity (§7), and the whole appeal of the multi-prong bonus and
the accumulator rhythm is that an attentive player can compute them. Determinism
is also what makes replays exact, what lets an AI search, and what makes a
desync impossible in netplay.

Accidental nondeterminism is the single easiest thing for an agent to introduce
here — iteration order over a `Set`, a timestamp in a tiebreak, a shuffled spawn
order. Treat any of it as a defect, not a style issue.

## Never invent a rule

**If a behaviour is not in SPEC.md, it is an open question, not a default.**

SPEC.md §11 is the live list of known gaps. When you hit an undecided behaviour:
add it to §11 and surface it to the human. Do not pick something reasonable and
move on — a plausible invented rule is far more expensive to find later than an
explicit gap, because it looks like it was designed.

This applies to every phase, including the coder. "The test needed it" is a
reason to ask, not a licence to decide.

## Layout — hexagonal, dependencies pointing inward

- **`packages/contracts`** — ports (interfaces) and domain DTOs. The core depends
  on *only* this.
  - `GeometryPort` — the arrow graph: 3-in/3-out adjacency, arrow direction,
    the point lattice, the spawner-vertex lattice, the chord test, and
    `window(centre, radius)` — **the board is unbounded** (SPEC §11 item 4), so
    bounded enumeration is the only kind there is.
  - `RulesPort` — legal moves, `apply`, closure and fill resolution.
  - `EconomyPort` — spawner accrual, carry, reset-on-capture.
- **`packages/rules-core`** — the pure engine behind those ports.
- **`packages/geometry-*`** — pluggable tiling implementations.
- **Adapters at the edges** — renderer, input, AI, persistence, netcode. Never
  referenced from the core. Online handlers will live in `packages/online-api/`
  (P16+) and still depend inward on contracts + rules-core.

**Why geometry is pluggable and not just a constant table:** every rule
downstream must be testable against small hand-authored fixture boards with known
adjacency, where a failure is readable, *as well as* against the generated tiling
— same port, two implementations, one set of tests. Any impl that satisfies
`GeometryPort`'s conformance suite is interchangeable.

The port was introduced because SPEC §11 items 1, 5 and 16 were unmeasured
properties of the real tiling. **All three are now resolved** (§2: alternating,
girth 3, one spawner vertex per minimal cycle) and P03 *generates* a board rather
than extracting one. The port stays regardless — readable fixtures earn it on
their own.

## Commands

TypeScript (strict) + Vitest + pnpm workspaces. Landed in P01.

```bash
pnpm verify                      # typecheck && lint && test — before saying you are done
pnpm crap                        # coverage + CRAP report (advisory, not a gate)
pnpm test:mutation               # Stryker on rules-core (local; advisory)
pnpm test:mutation:incremental   # Stryker, changed mutants only
```

Also `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:watch`.

Complexity budget is **warn** on `contracts` / `rules-core` / `geometry-*`
(cyclomatic ≤ 12, depth ≤ 4, 80 lines, 5 params). `pnpm verify` still passes.
Boy-scout functions you touch; we will flip to error as hotspots shrink.
CRAP is a hint for under-tested complexity — coverage can hide a god function,
so the eventual gate is raw complexity, not CRAP.

`tsconfig.base.json` is deliberately strict beyond `"strict": true` —
`noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` in particular. Both
are irritating and both are the right trade in a rules engine where an
off-by-one in an adjacency lookup is a silent wrong answer rather than a crash.

**`eslint.config.js` carries the purity guard**: `Date`, `Math.random`,
`performance.now`, `fetch`, `process` and `crypto` are banned inside
`packages/contracts` and `packages/rules-core`. Adapters are exempt — the impure
world is supposed to live there.

That guard catches the loud violations only. It does **not** catch the realistic
ones: iteration over an unordered collection feeding an ordered decision, or a
`sort` whose ties break on identity. Both pass every unit test and surface only
as replay drift, which is why P10 lands early.

## Testing posture

Three layers, each catching a different class of defect:

1. **Component tests, one per Gherkin scenario**, written against the *ports* so
   any implementation satisfies them. This is the default and the bulk.
2. **Property tests for the invariants SPEC.md already states.** The design
   conversation produced an unusual number of hard, checkable invariants — graph
   balance, girth, strong connectivity, head conservation, even-odd fill
   correctness, accumulator conservation under carry. See the
   `rules-invariants` skill; these are cheap to write and catch whole categories
   of rule bug at once.
3. **Replay fixtures.** A match is an initial state plus an ordered list of moves.
   Because the core is pure, a replay reproduces the final state exactly. A
   golden replay covers an enormous rules surface per line of test code, and any
   accidental nondeterminism shows up immediately as a replay mismatch.

Those three layers are **committed Vitest**, written against ports. They are the
spec-to-ship contract.

A fourth layer is **local-only**: `@vnatures/test-kit` component tests on a
never-pushed `local-main` branch, rebased onto `main`. They must not appear in
`package.json`, `pnpm-lock.yaml`, or tracked `*.kit.test.ts` on any branch that
is pushed. The pre-push hook enforces that. Do not implement a packet against
kit tests — implement against the committed suite.

Stryker (`pnpm test:mutation`) is the mutation layer on `rules-core`. Advisory
(`break: null`); triage new survivors. See the `mutation-testing` skill.

### `local-main` overlay

```bash
git branch local-main main          # once
git checkout local-main && git rebase main   # after main moves
```

On `local-main` only: add `@vnatures/test-kit` as a file: or private registry
dep, write `*.kit.test.ts`. Never merge that branch. Never push it. Product
packets always branch from `main`. After a packet lands on `main`, rebase
`local-main` and re-add any kit tests that still apply.

## The spec→ship workflow

Take one work packet all the way to a merged PR through **four phases**. Do not
stop for a human thumbs-up between them. In Claude Code / Cursor / OpenCode:
`/spec-to-ship <path-to-packet>`.

OpenCode pins every phase to `xai/grok-4.6` and bills the **SuperGrok**
subscription via `/connect` → xAI → SuperGrok Subscription. See `OPENCODE.md`.
Do not put an `XAI_API_KEY` in the repo.

1. **spec-author** drives `write-spec` → Gherkin `.feature` + mermaid (escape `;`
   as `#59;`) + EARS invariants. Escalate only for a SPEC.md game-rule gap, a
   substantial unexpected cost, or a big behavioral shift; otherwise decide BSSN
   and write it into the spec / ADR.
2. **test-author** drives `write-failing-tests` → one failing test per scenario
   plus compiling skeletons, red for the right reason.
3. **coder** drives `code-to-green` → red → green → refactor within budget,
   incremental Stryker, CRAP glance on touched files.
4. **reviewer** drives `review-changes` → spec ↔ tests ↔ code coherence,
   boundaries, purity. Then **open the PR**, request a **Copilot** review, wait,
   triage (fix / defer / reject), squash-merge to `hochgi/conquarrow`.

Do not collapse phases. Do not invent a game rule. Online/infra BSSN is in-bounds
when documented. Never push `shalevhoch` or `local-main`.

**How this differs from cycle-processing:** there, phase 1's input was a
high-level spec living outside the repo. Here **SPEC.md is already that document**
and it is unusually complete. Phase 1's input is therefore a *work packet* — a
scoped slice of SPEC.md — and the spec-author's job is narrower and sharper:
turn decided prose into executable scenarios, and interrogate the packet for the
gaps SPEC §11 admits to. Fewer product questions, more precision questions.

## Vocabulary — use these words exactly

The spec's terms are load-bearing; synonyms cause real confusion because several
of these are near-misses for each other.

| Term | Means |
|---|---|
| **arrow** | one tile; a node in the movement graph |
| **grain** | the direction an arrow points; movement always follows it |
| **point** | a movement junction, 3 arrows in and 3 out; where crossings and combat resolve |
| **vertex** | a pinwheel centre bordered by 3 arrows; where specials live; *never occupied* |
| **head** | one unit; also one life |
| **stack** | merged heads on one arrow; stack size **is** lives |
| **sentry** | heads a player *chose* to leave on a trail; discretionary — one only bleeds a front, two halt it |
| **trail** | the path a head leaves; a **set** of arrows — no order, no memory, not a tree |
| **anchor** | what holds a trail live. **Territory grade**: can close and claim, and its heads resist conversion. **Stack grade**: live and drivable, but pays only a land bridge. Also the one head a branch is *required* to leave |
| **cut** | an enemy crossing your trail |
| **evaporation** | the destruction a cut causes, running **both** ways from the cut point |
| **front** | one advancing edge of an evaporation; carries exactly one kill; halts **per arrow**, never per point |
| **firebreak** | the head a front halts at — the *second* one it meets, since the first is killed |
| **region** | trail between two firebreaks, or a firebreak and territory; what one cut destroys |
| **crossover** | a point one trail runs through more than once; a join followed by a split, **all ins feeding all outs**. Costs an anchor either side |
| **crossing** | traversing a point another trail passes through |
| **chord test** | the interleave-or-coincide rule that decides whether a traversal is a crossing; a point presents `i × o` chords |
| **closure** | departing your territory and landing back on it; claims the enclosed region |
| **land bridge** | a closure that encloses nothing, so the path itself becomes thin territory |
| **pincer** | a forked trail whose two arms both land, taking the ground between |
| **territory** | closed ground; free, trail-less, safe movement |
| **spawner** | the only special in MVP; sits on a vertex |
| **force** | a spawner's rate *f*, a fraction ≤ 1/3 |
| **share** | one of the 3 arrows bordering a spawner |
| **accumulator** | per-arrow production counter; carries remainder, resets on capture |

Reserved but **not** MVP: *island* (setup-only concept, Appendix A), *forge*,
*armory*, *gate*, *anvil*.
