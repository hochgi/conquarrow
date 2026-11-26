/**
 * P106 — the one online plan check, shared by the lobby's Create gate and
 * the server's create (so the two never disagree). Pure.
 *
 * @see docs/spec/seat-choice/seat-choice.md
 */

import type { PlannedSeatKind } from './online-port';

/** Why an online plan cannot be created; `undefined` when it can. */
export type OnlinePlanProblem = 'size' | 'byok' | 'pick-your-seat' | 'one-seat' | 'needs-another';

const count = (kinds: readonly PlannedSeatKind[], kind: PlannedSeatKind): number =>
  kinds.filter((each) => each === kind).length;

/** First match wins (spec, "A valid online plan"). */
export const onlinePlanProblem = (kinds: readonly PlannedSeatKind[]): OnlinePlanProblem | undefined => {
  if (kinds.length !== 3 && kinds.length !== 6) return 'size';
  if (kinds.includes('byok')) return 'byok';
  const creators = count(kinds, 'creator');
  if (creators === 0) return 'pick-your-seat';
  if (creators > 1) return 'one-seat';
  if (kinds.length - count(kinds, 'heuristic') < 2) return 'needs-another';
  return undefined;
};
