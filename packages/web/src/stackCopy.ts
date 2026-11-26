/**
 * The words player-facing copy uses for a stack (P103, web adapter only).
 *
 * docs/spec/id-free-copy/id-free-copy.md. A stack is named by its size and,
 * for a merge target, by the screen direction from the selected stack — never
 * by its arrow id, which means nothing to a player.
 *
 * Pure: equal inputs give equal text. No clock, no layout reads — App passes
 * centres in, so this module never learns what an arrow is.
 */

/** `1 head`, otherwise `N heads`. */
export const headsPhrase = (heads: number): string =>
  heads === 1 ? '1 head' : `${String(heads)} heads`;

/** `3-stack`. */
export const nStack = (heads: number): string => `${String(heads)}-stack`;

/** Screen directions, y grows downward, clockwise from `right` (atan2 order). */
export const COMPASS_WORDS = [
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
  'up',
  'up-right',
] as const;

export type CompassWord = (typeof COMPASS_WORDS)[number];

export interface Pt {
  readonly x: number;
  readonly y: number;
}

const EIGHTH_TURN = Math.PI / 4;

/**
 * The nearest of eight screen directions from `from` to `to`, or `undefined`
 * when the points coincide. No distance threshold: distinct tiles have distinct
 * centroids, and a threshold would be a magic number.
 */
export const compassWord = (from: Pt, to: Pt): CompassWord | undefined => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return undefined;
  const k = Math.round(Math.atan2(dy, dx) / EIGHTH_TURN);
  return COMPASS_WORDS[(k + COMPASS_WORDS.length) % COMPASS_WORDS.length];
};

/** `Merge into your 3-stack, up-left`, or without the direction when there is none. */
export const mergeLabel = (heads: number, direction: CompassWord | undefined): string => {
  const base = `Merge into your ${nStack(heads)}`;
  return direction === undefined ? base : `${base}, ${direction}`;
};
