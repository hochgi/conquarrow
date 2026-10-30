/**
 * P79 scoring, the round cap and cell validity — the predeclared numbers.
 *
 * **Round.** `round` is the number of *full* rounds completed when the match
 * ended (a round completes when the turn passes back to `players[0]`, the
 * full-round marker, SPEC §4 / P08). A win before the cap therefore has
 * `round ∈ [0, K)`, which is what puts `1 + (K − r) / K` in the packet's stated
 * range (1, 2]. A win decided by the very boundary that completes round K
 * scores exactly 1 — still above every non-win.
 */

export type Outcome =
  | { readonly kind: 'won'; readonly round: number }
  | { readonly kind: 'eliminated'; readonly round: number }
  | {
      readonly kind: 'capped';
      readonly round: number;
      readonly land: number;
      readonly totalLand: number;
    }
  /** The spend cap refused a call mid-match. Not a result: excluded from scoring. */
  | { readonly kind: 'aborted_budget'; readonly round: number };

const requireCap = (k: number): void => {
  if (!Number.isInteger(k) || k < 1) throw new Error(`round cap K must be a positive integer, got ${String(k)}`);
};

/**
 * Won: `1 + (K − r)/K`. Alive at the cap: land ÷ total claimed land. Eliminated: 0.
 * Aborted by the budget: no score (null), so it cannot enter a mean.
 */
export const scoreOutcome = (outcome: Outcome, k: number): number | null => {
  requireCap(k);
  switch (outcome.kind) {
    case 'won':
      return 1 + (k - outcome.round) / k;
    case 'eliminated':
      return 0;
    case 'capped':
      // Nobody has claimed anything: the seat holds none of nothing.
      return outcome.totalLand === 0 ? 0 : outcome.land / outcome.totalLand;
    case 'aborted_budget':
      return null;
  }
};

export const median = (values: readonly number[]): number => {
  if (values.length === 0) throw new Error('median of no values');
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  return ((sorted[mid - 1] ?? 0) + hi) / 2;
};

/** K = 2 × the median `mirror` match length, rounded up to a multiple of 10. */
export const roundCapFromLengths = (lengths: readonly number[]): number => {
  const k = Math.ceil((2 * median(lengths)) / 10) * 10;
  requireCap(k);
  return k;
};

/** Gate 4: a cell with more than 10% fallback turns is invalid. */
export const FALLBACK_INVALID_RATE = 0.1;

export const fallbackRate = (fallbacks: number, turns: number): number =>
  turns === 0 ? 0 : fallbacks / turns;

export const isInvalidCell = (fallbacks: number, turns: number): boolean =>
  fallbackRate(fallbacks, turns) > FALLBACK_INVALID_RATE;

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
