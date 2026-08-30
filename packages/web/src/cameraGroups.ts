/**
 * P52 — the combinatorics behind a camera plan, with no geometry in it.
 *
 * Pure and total: no clock, no rAF, no DOM, no random source. The caller
 * supplies a feasibility predicate and a display-scale function over index
 * ranges; this module decides *how many* groups a run costs and *where* the
 * splits go. Keeping it geometry-free keeps `spectate.ts` inside the
 * complexity budget and lets the DP be read on its own terms.
 *
 * @see docs/spec/spectated-camera-grouping/spectated-camera-grouping.md
 */

/** Ranges are `[from, to)` over the beat indices of one turn. */
export type RangeFn<T> = (from: number, to: number) => T;

/** Score comparisons tolerate the last bit of floating point, as the spec's oracle does. */
const SCORE_EPS = 1e-9;

/**
 * Pass 1 (normative): the greedy prefix count at the floor. The fit predicate
 * is monotone, so no contiguous partition beats it on count (D7). The first
 * beat of a run is always admitted, so a group is never empty and `k <= n`.
 */
export const greedyGroupCount = (n: number, feasible: RangeFn<boolean>): number => {
  let i = 0;
  let k = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && feasible(i, j + 1)) j += 1;
    k += 1;
    i = j;
  }
  return k;
};

/** Lexicographic comparison of two ascending score vectors: larger wins. */
const compareAscending = (a: readonly number[], b: readonly number[]): number => {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] ?? -Infinity;
    const y = b[i] ?? -Infinity;
    if (x < y - SCORE_EPS) return -1;
    if (x > y + SCORE_EPS) return 1;
  }
  return 0;
};

/** Insert into a sorted-ascending vector, keeping it sorted. */
const insertAscending = (vec: readonly number[], value: number): readonly number[] => {
  const at = vec.findIndex((x) => x > value);
  const i = at < 0 ? vec.length : at;
  return [...vec.slice(0, i), value, ...vec.slice(i)];
};

interface Cell {
  /** The partition's display scales, sorted ascending — the leximaxmin score. */
  readonly score: readonly number[];
  /** Where the last group of this prefix starts. */
  readonly split: number;
}

/**
 * The best cell for 'beats `[0, to)` in exactly `m` groups', given the row for
 * `m - 1`. Candidate splits are scanned ascending, and a tie keeps the first —
 * which is D10's earliest split, because the top-level call fixes the *last*
 * split first and recursion fixes the earlier ones in turn.
 */
const bestCell = (
  prevRow: readonly (Cell | undefined)[],
  to: number,
  m: number,
  display: RangeFn<number>,
): Cell | undefined => {
  let best: Cell | undefined;
  for (let from = m - 1; from < to; from += 1) {
    const prev = prevRow[from];
    if (prev === undefined) continue;
    const score = insertAscending(prev.score, display(from, to));
    if (best === undefined || compareAscending(score, best.score) > 0) {
      best = { score, split: from };
    }
  }
  return best;
};

/**
 * Pass 2 (normative): partition `n` beats into exactly `k` contiguous non-empty
 * groups maximising lexicographic maximin on display scale, ties to the
 * earliest split (D10). Returns the `k + 1` edges, `[0, …, n]`.
 *
 * A prefix DP, not a suffix one, precisely so the tie-break falls out: the top
 * level chooses the last split and prefers the smallest, and each state below
 * does the same for the split before it. Merging one common group scale into
 * two sorted vectors preserves their order, so the score-optimal prefix is the
 * only prefix that can reach a score-optimal whole — which is what makes the
 * greedy-per-state choice exact rather than heuristic.
 */
export const bestPartition = (
  n: number,
  k: number,
  display: RangeFn<number>,
): readonly number[] => {
  if (n <= 0 || k <= 0 || k > n) return [];
  let row: readonly (Cell | undefined)[] = Array.from({ length: n + 1 }, (_, to) =>
    to >= 1 ? { score: [display(0, to)], split: 0 } : undefined,
  );
  const rows: (readonly (Cell | undefined)[])[] = [row];
  for (let m = 2; m <= k; m += 1) {
    const prev = row;
    row = Array.from({ length: n + 1 }, (_, to) =>
      to >= m ? bestCell(prev, to, m, display) : undefined,
    );
    rows.push(row);
  }
  const edges: number[] = [n];
  let at = n;
  for (let m = k; m >= 1; m -= 1) {
    at = rows[m - 1]?.[at]?.split ?? 0;
    edges.unshift(at);
  }
  return edges;
};
