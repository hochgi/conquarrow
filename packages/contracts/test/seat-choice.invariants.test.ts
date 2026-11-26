/**
 * docs/spec/seat-choice — EARS 2: the one plan check, over every plan.
 * @see docs/spec/seat-choice/seat-choice.md
 */

import { describe, expect, it } from 'vitest';
import { onlinePlanProblem, usableSeatName, type PlannedSeatKind } from '../src/index';

const TOKENS: readonly PlannedSeatKind[] = ['creator', 'human', 'creator-agent', 'agent', 'heuristic', 'byok'];

const plans = (length: number): PlannedSeatKind[][] => {
  let out: PlannedSeatKind[][] = [[]];
  for (let i = 0; i < length; i += 1) out = out.flatMap((plan) => TOKENS.map((token) => [...plan, token]));
  return out;
};

/** The spec's rule, written independently. */
const expected = (kinds: readonly PlannedSeatKind[]): ReturnType<typeof onlinePlanProblem> => {
  if (kinds.length !== 3 && kinds.length !== 6) return 'size';
  if (kinds.includes('byok')) return 'byok';
  const creators = kinds.filter((kind) => kind === 'creator').length;
  if (creators === 0) return 'pick-your-seat';
  if (creators > 1) return 'one-seat';
  if (kinds.filter((kind) => kind !== 'heuristic').length < 2) return 'needs-another';
  return undefined;
};

describe('onlinePlanProblem matches the spec for every plan', () => {
  it.each([1, 2, 3, 4, 6])('length %i', (length) => {
    for (const plan of plans(length)) expect([plan, onlinePlanProblem(plan)]).toEqual([plan, expected(plan)]);
  });
});

describe('"your agent (waiting)" is a reserved word', () => {
  it('is never a name', () => {
    expect(usableSeatName('your agent (waiting)')).toBeUndefined();
    expect(usableSeatName(' Your Agent (Waiting) ')).toBeUndefined();
  });
});
