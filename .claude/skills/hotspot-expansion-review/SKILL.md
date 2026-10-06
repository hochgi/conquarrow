---
name: hotspot-expansion-review
description: Extract-before-extend pre-pass for conquarrow hotspots. Use before adding behaviour to a function at or over the complexity budget, a file over ~400 lines, or an orchestrator gaining a new branch — in code-to-green or any adapter work.
---

# hotspot-expansion-review

Run this **before** writing new behaviour into existing code. Extraction first
keeps the diff you are about to write small, and keeps the ratchet (AGENTS.md)
turning the right way.

## 1. Measure — after your planned change

For the function you will extend, and the file it lives in:

- **Function** against the ESLint budget: cyclomatic ≤ 12, depth ≤ 4,
  ≤ 80 lines, ≤ 5 params. `pnpm lint` lists the ones already over.
- **File**: over ~400 lines is a hotspot file.
- **Responsibilities**: count distinct jobs — collect, resolve, filter, map,
  aggregate, I/O. More than two in one function is a hotspot at any size.

If the function and file stay inside every threshold **with your change added**,
stop here and proceed normally.

## 2. Pick one seam

The one extraction that buys the most readability:

| Smell | Extraction |
|---|---|
| Deep nesting (`for > if > for`) | the inner body becomes a named helper |
| Long sequential phases | an orchestrator plus one named function per phase |
| One loop feeding several collectors | one helper per collector, assembled by the orchestrator |
| Long parameter list | a typed object of the related params |
| Repeated `switch` / type-guard chains | a lookup table keyed by the discriminant |

Name helpers from the AGENTS.md vocabulary — `frontHaltsAt`, `sharesOf` — so the
orchestrator reads as the rule it implements. In `rules-core` every extracted
helper stays pure, and ordered decisions keep their total comparator.

## 3. Extract, then extend

1. Land the extraction as its own **refactor-only commit**: no behaviour change,
   `pnpm verify` green, replay fixtures untouched.
2. Add the new behaviour to the now-smaller function.
3. Code too tangled to extract safely gets named in your handoff or PR as a
   hotspot instead of growing further.

## Done when

- The function you extended reads as orchestration of named steps and sits
  inside the budget with your change in it.
- The extraction is a separate commit, green on its own.
