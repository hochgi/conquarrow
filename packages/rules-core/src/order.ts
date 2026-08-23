/**
 * The total orders the engine sorts on.
 *
 * ADR 0001 names **iteration order**, not randomness, as the realistic
 * determinism failure here, and both places it hides in this package — the group
 * map that `legalMoves` reads and the trail `Set` that chord extraction and
 * marking read — need the same comparator. One copy, so the two cannot drift.
 *
 * The comparator is **total**: it orders on the identifier's string form and
 * never on object identity or insertion luck, which is the tie-break the skill
 * warns about. Identifiers are opaque (P01 D1) — this compares them, it does not
 * parse them. Equal ids return **0**; `a < b ? -1 : 1` is not an order, and a
 * sort that used it would be free to shuffle ties — the shape that passes every
 * unit test and shows up as replay drift.
 *
 * Adapters that must agree with the engine (HUD round-robin, persisted
 * snapshots) import these from `@conquarrow/rules-core` rather than restating
 * them.
 */

import type { ArrowId, PlayerId, VertexId } from '@conquarrow/contracts';

/**
 * Opaque ids compared as strings. Returns exactly -1, 0, or 1 so a mutant that
 * still "sorts" by returning any negative cannot hide.
 */
const compareOpaque = (left: unknown, right: unknown): number => {
  const a = String(left);
  const b = String(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

/** A total order on arrows, so an ordered answer never rests on map or set order. */
export const compareArrows = (left: ArrowId, right: ArrowId): number =>
  compareOpaque(left, right);

/** Same total order for seats (P40 birth-cut victim order). */
export const comparePlayers = (left: PlayerId, right: PlayerId): number =>
  compareOpaque(left, right);

/** Same total order for spawner vertices (P08 round-robin / tick order). */
export const compareVertices = (left: VertexId, right: VertexId): number =>
  compareOpaque(left, right);
