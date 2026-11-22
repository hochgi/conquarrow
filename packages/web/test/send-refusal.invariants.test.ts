/**
 * P100 invariants — `submitRefusal` is D1's ordered table, exhaustively.
 *
 * @see docs/spec/send-refusal/send-refusal.md
 */

import { SUBMIT_REFUSALS } from '@conquarrow/contracts';
import { describe, expect, it } from 'vitest';
import { submitRefusal, type SubmitGuardInput } from '../src/online-pages';
import { GUARD_ORDER, passing } from './send-refusal.support';

/** All 2^9 combinations of the guards, failing or passing. */
const allInputs = (): SubmitGuardInput[] => {
  const out: SubmitGuardInput[] = [];
  for (let mask = 0; mask < 1 << GUARD_ORDER.length; mask += 1) {
    let input = passing();
    GUARD_ORDER.forEach((row, i) => {
      if ((mask & (1 << i)) !== 0) input = { ...input, ...row.fail };
    });
    out.push(input);
  }
  return out;
};

describe('submitRefusal is the ordered guard table', () => {
  it('The table lists every refusal exactly once, in the contract order', () => {
    expect(GUARD_ORDER.map((row) => row.reason)).toEqual([...SUBMIT_REFUSALS]);
  });

  it('Each guard alone returns its reason', () => {
    for (const row of GUARD_ORDER) {
      expect(submitRefusal({ ...passing(), ...row.fail }), row.reason).toBe(row.reason);
    }
  });

  it('Any combination returns the first failing guard', () => {
    for (const input of allInputs()) {
      const first = GUARD_ORDER.find((row) =>
        Object.entries(row.fail).every(([k, v]) => input[k as keyof SubmitGuardInput] === v),
      );
      expect(submitRefusal(input)).toBe(first?.reason);
    }
  });

  it('A move count above one passes the no-moves guard', () => {
    expect(submitRefusal({ ...passing(), moveCount: 3 })).toBeUndefined();
  });
});
