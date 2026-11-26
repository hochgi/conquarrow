/**
 * docs/spec/seat-choice — EARS 2: the one plan check, over every plan.
 * @see docs/spec/seat-choice/seat-choice.md
 */

import { describe, expect, it } from 'vitest';
import { onlinePlanProblem } from '../src/seat-plan';
import type { PlannedSeatKind } from '../src/online-port';
import { labelInviteChair, seatLabel, usableSeatName } from '../src/seat-label';

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

describe('SCENARIOS.md 7 — a reserved chair, through the one table', () => {
  const reserved = { kind: 'agent', reservedFor: 'alice' } as const;
  it('reads "your agent (waiting)" for its owner only', () => {
    expect(labelInviteChair({ letter: 'B', chair: reserved, userHash: 'alice' })).toBe('your agent (waiting)');
    expect(labelInviteChair({ letter: 'B', chair: reserved, userHash: 'bob' })).toBe('waiting');
    expect(labelInviteChair({ letter: 'B', chair: reserved, userHash: undefined })).toBe('waiting');
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'agent' }, userHash: undefined })).toBe('waiting');
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'human' }, userHash: undefined })).toBe('waiting');
  });
  it('seatLabel: the row needs reservedForCaller true and an unbound chair', () => {
    const base = { letter: 'B', kind: 'agent', relation: 'other' } as const;
    expect(seatLabel({ ...base, bound: false, reservedForCaller: true })).toBe('your agent (waiting)');
    expect(seatLabel({ ...base, bound: false, reservedForCaller: false })).toBe('waiting');
    expect(seatLabel({ ...base, bound: false })).toBe('waiting');
    expect(seatLabel({ ...base, reservedForCaller: true })).toBe('Agent');
  });
});
