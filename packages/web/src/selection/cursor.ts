/**
 * The "Next stack" selection cursor — P50, web adapter only.
 *
 * docs/spec/next-stack-cursor/next-stack-cursor.md
 *
 * A pure module so the advance rule and the per-seat recency stack are testable
 * without React. Nothing here reads or writes `GameState`: the cursor is a view
 * concern, it never enters the core, and pressing the button emits no move.
 *
 * SKELETON — signatures and types only (P50 phase 2). No logic yet.
 */

import type { ArrowId, GameState, PlayerId, RulesPort } from '@conquarrow/contracts';
import type { Viewport } from '../viewport';

/** The adapter's current selection: one arrow, or nothing. */
export type Cursor = ArrowId | undefined;

/** The margin fraction the camera guard uses — unchanged from the old picker. */
export const SELECTION_MARGIN_FRACTION = 0.16;

/**
 * The arrows that are the `from` of at least one `kind === 'step'` legal move.
 *
 * Derived at the port boundary, deduplicated, sorted by `compareArrows` — the
 * baseline order. A stack with allowance left but no legal step is *not*
 * movable, so the cursor can never land on it.
 */
export const movableArrows = (_rules: RulesPort, _state: GameState): readonly ArrowId[] => [];

/** The source and destination of a step that has just been committed. */
export interface CommittedStep {
  readonly from: ArrowId;
  readonly exit: ArrowId;
}

/**
 * Advance the cursor once.
 *
 * Precedence: the committed step's destination, then a movable remainder at its
 * source, then the next arrow strictly after the cursor in baseline order,
 * wrapping. Pressing the button passes no `committed`, so it always takes the
 * baseline branch. A preemption *moves* the cursor — no resume point is kept.
 */
export const advanceCursor = (
  _cursor: Cursor,
  _movable: readonly ArrowId[],
  _committed?: CommittedStep,
): Cursor => undefined;

/**
 * Per-seat recency: the arrows a seat acted on this turn, most recent first, at
 * most one entry per arrow. In memory only — never persisted.
 */
export type RecencyStacks = ReadonlyMap<PlayerId, readonly ArrowId[]>;

export const emptyRecency = (): RecencyStacks => new Map<PlayerId, readonly ArrowId[]>();

/** Push an acted-upon arrow for a seat; most recent wins, one entry per arrow. */
export const pushRecency = (
  _stacks: RecencyStacks,
  _seat: PlayerId,
  _arrow: ArrowId,
): RecencyStacks => new Map<PlayerId, readonly ArrowId[]>();

/**
 * Turn start: read the seat's recency stack for the most recently acted arrow
 * that is still movable (the *turn anchor*), fall back to the first movable
 * arrow in baseline order, **then** clear that seat's stack. Read before clear.
 */
export const turnAnchor = (
  _stacks: RecencyStacks,
  _seat: PlayerId,
  _movable: readonly ArrowId[],
): { readonly cursor: Cursor; readonly recency: RecencyStacks } => ({
  cursor: undefined,
  recency: new Map<PlayerId, readonly ArrowId[]>(),
});

/**
 * Camera guard, unchanged from the old picker: pan only when the selection sits
 * outside the viewport margin.
 */
export const panForSelection = (
  viewport: Viewport,
  _focus: { readonly x: number; readonly y: number },
): Viewport => viewport;
