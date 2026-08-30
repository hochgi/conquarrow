/**
 * The "Next stack" selection cursor — P50, web adapter only.
 *
 * docs/spec/next-stack-cursor/next-stack-cursor.md
 *
 * A pure module so the advance rule and the per-seat recency stack are testable
 * without React. Nothing here reads or writes `GameState`: the cursor is a view
 * concern, it never enters the core, and pressing the button emits no move.
 */

import { compareArrows } from '@conquarrow/rules-core';
import type { ArrowId, GameState, PlayerId, RulesPort } from '@conquarrow/contracts';
import type { Viewport } from '../viewport';
import { centerOn, toScreen } from '../viewport';

/** The adapter's current selection: one arrow, or nothing. */
export type Cursor = ArrowId | undefined;

/** The margin fraction the camera guard uses — unchanged from the old picker. */
export const SELECTION_MARGIN_FRACTION = 0.16;

/**
 * The arrows that are the `from` of at least one `kind === 'step'` legal move.
 *
 * Derived at the port boundary, deduplicated, sorted by `compareArrows` — the
 * baseline order. A stack with allowance left but no legal step is *not*
 * movable, so the cursor can never land on it. The sort is what makes the
 * answer independent of the port's listing order (invariant 9).
 */
export const movableArrows = (rules: RulesPort, state: GameState): readonly ArrowId[] => {
  const seen = new Set<string>();
  const froms: ArrowId[] = [];
  for (const move of rules.legalMoves(state)) {
    if (move.kind !== 'step') continue;
    const key = String(move.from);
    if (seen.has(key)) continue;
    seen.add(key);
    froms.push(move.from);
  }
  return froms.toSorted(compareArrows);
};

/** The source and destination of a step that has just been committed. */
export interface CommittedStep {
  readonly from: ArrowId;
  readonly exit: ArrowId;
}

const holds = (movable: readonly ArrowId[], arrow: ArrowId): boolean =>
  movable.some((candidate) => compareArrows(candidate, arrow) === 0);

/**
 * Baseline order, imposed here rather than trusted from the caller: every
 * position the cursor takes is then a function of the *set* of movable arrows,
 * never of the order they happened to arrive in (invariant 9).
 */
const inBaselineOrder = (movable: readonly ArrowId[]): readonly ArrowId[] =>
  movable.toSorted(compareArrows);

/** The first movable arrow strictly after `cursor` in baseline order, wrapping. */
const successor = (cursor: Cursor, movable: readonly ArrowId[]): Cursor => {
  const baseline = inBaselineOrder(movable);
  const after =
    cursor === undefined
      ? undefined
      : baseline.find((candidate) => compareArrows(candidate, cursor) > 0);
  return after ?? baseline[0];
};

/**
 * Advance the cursor once.
 *
 * Precedence: the committed step's destination, then a movable remainder at its
 * source, then the next arrow strictly after the cursor in baseline order,
 * wrapping. Pressing the button passes no `committed`, so it always takes the
 * baseline branch. A preemption *moves* the cursor — no resume point is kept,
 * so a preempted arrow is not offered again later in the same lap.
 */
export const advanceCursor = (
  cursor: Cursor,
  movable: readonly ArrowId[],
  committed?: CommittedStep,
): Cursor => {
  if (movable.length === 0) return undefined;
  if (committed !== undefined) {
    if (holds(movable, committed.exit)) return committed.exit;
    if (holds(movable, committed.from)) return committed.from;
  }
  return successor(cursor, movable);
};

/**
 * Per-seat recency: the arrows a seat acted on this turn, most recent first, at
 * most one entry per arrow. In memory only — never persisted, so a reload or an
 * online rejoin is exactly the first-turn case.
 */
export type RecencyStacks = ReadonlyMap<PlayerId, readonly ArrowId[]>;

export const emptyRecency = (): RecencyStacks => new Map<PlayerId, readonly ArrowId[]>();

const withSeat = (
  stacks: RecencyStacks,
  seat: PlayerId,
  entries: readonly ArrowId[],
): RecencyStacks => {
  const next = new Map<PlayerId, readonly ArrowId[]>(stacks);
  next.set(seat, entries);
  return next;
};

/** Push an acted-upon arrow for a seat; most recent wins, one entry per arrow. */
export const pushRecency = (
  stacks: RecencyStacks,
  seat: PlayerId,
  arrow: ArrowId,
): RecencyStacks => {
  const kept = (stacks.get(seat) ?? []).filter((a) => compareArrows(a, arrow) !== 0);
  return withSeat(stacks, seat, [arrow, ...kept]);
};

/**
 * Turn start: read the seat's recency stack for the most recently acted arrow
 * that is still movable (the *turn anchor*), fall back to the first movable
 * arrow in baseline order, **then** clear that seat's stack. Read before clear —
 * clearing first would discard the entry that chooses the anchor.
 */
export const turnAnchor = (
  stacks: RecencyStacks,
  seat: PlayerId,
  movable: readonly ArrowId[],
): { readonly cursor: Cursor; readonly recency: RecencyStacks } => {
  const anchor = (stacks.get(seat) ?? []).find((arrow) => holds(movable, arrow));
  return {
    cursor: anchor ?? inBaselineOrder(movable)[0],
    recency: withSeat(stacks, seat, []),
  };
};

/**
 * Camera guard, unchanged from the old picker: pan only when the selection sits
 * outside the viewport margin. A camera that jumps after every trip destroys the
 * spatial orientation the capture effect depends on.
 */
export const panForSelection = (
  viewport: Viewport,
  focus: { readonly x: number; readonly y: number },
): Viewport => {
  const at = toScreen(viewport, focus.x, focus.y);
  const margin = Math.min(viewport.width, viewport.height) * SELECTION_MARGIN_FRACTION;
  const visible =
    at.x > margin &&
    at.x < viewport.width - margin &&
    at.y > margin &&
    at.y < viewport.height - margin;
  return visible ? viewport : centerOn(viewport, focus.x, focus.y);
};
