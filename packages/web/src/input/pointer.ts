/**
 * The board's pointer-up decision (P77), as a pure function.
 *
 * docs/spec/board-selection-model/board-selection-model.md — *The click, decided*
 * (the first three diamonds). What happens to an arrow click after this is the
 * input mode's business.
 */

import type { ArrowId } from '@conquarrow/contracts';

/** What a pointer-up on the board amounts to. */
export type PointerUpIntent =
  /** A drag, a pinch, no pointer down, or a background click while locked. */
  | { readonly kind: 'nothing' }
  /** A click on the background: deselect, discard the draft. */
  | { readonly kind: 'background' }
  /** A click on an arrow, for the input mode to read. */
  | { readonly kind: 'arrow'; readonly arrow: ArrowId }
  /** A click on an arrow while input is locked. */
  | { readonly kind: 'refuse'; readonly arrow: ArrowId; readonly reason: 'board-busy' };

export interface PointerUp {
  /** Was there a matching pointer-down on the board? */
  readonly hadPointer: boolean;
  /** Did the pointer travel past the pan slop (more than 3 px) before release? */
  readonly dragged: boolean;
  /** Did a two-finger pinch move the camera during this gesture? */
  readonly pinched: boolean;
  /** Is the board refusing input (a seat thinking, a replay, match over, a lesson card)? */
  readonly inputLocked: boolean;
  /** The arrow under the release point, if any. */
  readonly hit: ArrowId | undefined;
}

export const pointerUpIntent = (up: PointerUp): PointerUpIntent => {
  // A pan or a pinch moved the camera, and a release with no press behind it is
  // not a click: none of them touches the input snapshot (invariant 13).
  if (!up.hadPointer || up.dragged || up.pinched) return { kind: 'nothing' };
  if (up.inputLocked) {
    // A refused click like any other — but a background click refuses nothing.
    return up.hit === undefined
      ? { kind: 'nothing' }
      : { kind: 'refuse', arrow: up.hit, reason: 'board-busy' };
  }
  return up.hit === undefined ? { kind: 'background' } : { kind: 'arrow', arrow: up.hit };
};
