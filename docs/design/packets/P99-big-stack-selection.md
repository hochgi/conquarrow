# P99 — Big-stack selection lag

> **Not a game-rule change.** Web adapter only (`packages/web/src/reach.ts`,
> `packages/web/src/route.ts`). No `online-api` change. No SPEC.md edit. No new
> AWS. The reach wash's set is unchanged; only the cost of computing it moves.

**Status:** shipped 2026-11-19. **Depends on:** P34, P35. **Issue:** [#121](https://github.com/hochgi/conquarrow/issues/121).
**Spec:** [big-stack-selection](../../spec/big-stack-selection/big-stack-selection.md).

Issue #121 named the next packet P98. P98 is already
[session-expired](./P98-session-expired.md) (#118). This packet is P99.

## Symptom

With a 16+ stack, selecting it takes a long time before the move markers
appear, on a phone and on a desktop. Still open at `086da51`: `route.ts` and
`reach.ts` are unchanged since P93.

Published bench (P93 review, desktop vite-node, opening board): `buildRouteOffer`
takes 64 ms at 8 heads, 240 ms at 16 and 674 ms at 32. `reachFrom` alone takes
186 ms at 16. Phones and mid-game boards are several times slower.

## Cause

`reachWashOf` calls `reachFrom`, which depth-first walks real `rules.apply`
calls for every portion size 1..N. The wash reads only `entry.plans.has(carry)`.
Production (`enterRoute`) passes `carry = tipHeads`, so the walk that matters
is the one portion, and the other N − 1 walks are discarded.

## Decisions (adapter BSSN — normative detail is the spec)

1. **Walk the carry.** `reachFrom` gains an optional `{ portion }`. The wash
   passes the carry. The wash set stays the P34 set: arrows that portion can
   reach, minus the tip, the clickable set and the walked arrows.
2. **The no-portion call stays the 1..heads walk.** It is the golden and the
   cost baseline. Production stops calling it.
3. **Do not cache previews.** At 16 heads the published bench is 186 ms of
   `reachFrom` inside a 240 ms offer, so the wash is 77 % and the remainder
   (rays + previews) is 54 ms. Memoising previews per (state, tip, carry) does
   not shorten the first selection: each preview is a different tip on a
   different scratch state, and no state version exists to key a cross-call
   cache. Hover stays a lookup (P34). This environment could not re-run the
   bench; the decision uses the issue's numbers.
4. **The guard is a count, not a time.** Web is not added to Stryker. The live
   pipeline does not mutate `packages/web`, and this packet does not add it.
5. **No rule is re-derived.** The portion only changes which counts the existing
   walk tries. Every hop is still `rules.apply`.

## Out of scope

- Rendering cost and animation frame cost.
- Deferring hover previews, or caching them.
- A phone check as a gate. The wash set is unchanged, and the web package has
  no DOM. The PR body asks for a feel-check; CI is the count guard.
- SPEC.md. `online-api`. Game rules.
