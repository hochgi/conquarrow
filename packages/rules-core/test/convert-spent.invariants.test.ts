/**
 * The EARS invariants of docs/spec/convert-spent/convert-spent.md, as properties.
 *
 * @see docs/spec/convert-spent/convert-spent.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { endTurn, speed, step } from '@conquarrow/contracts';
import type { MergeOverride } from '@conquarrow/contracts';
import {
  A,
  B,
  onBoard,
  ownerOf,
  spentOn,
  stateOf,
  stepsFrom,
  totalHeads,
} from './support';
import {
  aLandConvert,
  anArrivalOnto,
  anArrowAwayFrom,
  applyConvert,
} from './convert-spent.support';

const HEADS = [1, 2, 3, 4, 5, 8] as const;
const SPENT = [0, 1] as const;
const OVERRIDES: readonly (MergeOverride | undefined)[] = [undefined, 0, 1];

describe('P70 — convert spends the stack at speed(heads)', () => {
  it('1. When a group converts, spent is speed of its heads and any merge override is dropped', () => {
    const table = onBoard();
    for (const heads of HEADS) {
      for (const spent of SPENT) {
        if (spent > speed(heads)) continue;
        for (const speedOverride of OVERRIDES) {
          const { converted, mover, exit, before } = aLandConvert(table, heads, {
            spent,
            ...(speedOverride === undefined ? {} : { speedOverride }),
          });
          const after = applyConvert(table, before, mover, exit);
          expect(ownerOf(after, converted), `heads=${String(heads)}`).toBe(A);
          expect(spentOn(after, converted), `heads=${String(heads)}`).toBe(speed(heads));
          expect(after.groups.get(converted)?.speedOverride, `heads=${String(heads)}`).toBeUndefined();
        }
      }
    }
  });

  it('2. While the capturing turn has not ended, no step is offered from a converted group', () => {
    const table = onBoard();
    for (const heads of HEADS) {
      const { converted, mover, exit, before } = aLandConvert(table, heads);
      const after = applyConvert(table, before, mover, exit);
      expect(stepsFrom(table, after, converted), `heads=${String(heads)}`).toEqual([]);
    }
  });

  it("3. When the capturing turn ends, that group's spent is cleared with every other group's", () => {
    const table = onBoard();
    for (const heads of HEADS) {
      const { converted, mover, exit, before } = aLandConvert(table, heads);
      const convertedState = applyConvert(table, before, mover, exit);
      const after = table.rules.apply(convertedState, endTurn());
      for (const group of after.groups.values()) {
        expect(group.spent, `heads=${String(heads)}`).toBe(0);
        expect(group.speedOverride, `heads=${String(heads)}`).toBeUndefined();
      }
      expect(spentOn(after, converted)).toBe(0);
    }
  });

  it("4. A friendly merge onto a converted group keeps the destination's spent", () => {
    const table = onBoard();
    for (const heads of [1, 2, 3] as const) {
      const { converted, mover, exit } = aLandConvert(table, heads);
      const mergeFrom = anArrivalOnto(table, converted, [converted, mover, exit]);
      const before = stateOf(
        [
          { arrow: converted, owner: B, heads },
          { arrow: mover, owner: A, heads: 1 },
          { arrow: mergeFrom, owner: A, heads: 1 },
        ],
        A,
        {
          territory: [
            { arrow: converted, owner: A },
            { arrow: mover, owner: A },
            { arrow: exit, owner: A },
            { arrow: mergeFrom, owner: A },
          ],
        },
      );
      const convertedState = applyConvert(table, before, mover, exit);
      const destSpent = spentOn(convertedState, converted);
      expect(destSpent, `heads=${String(heads)}`).toBe(speed(heads));
      const after = table.rules.apply(convertedState, step(mergeFrom, converted, 1));
      expect(spentOn(after, converted), `heads=${String(heads)}`).toBe(destSpent);
    }
  });

  it('5. A group that did not convert keeps its spent', () => {
    const table = onBoard();
    for (const spent of [0, 1] as const) {
      const { converted, mover, exit } = aLandConvert(table, 2);
      const bHome = anArrowAwayFrom(table, [converted, mover, exit]);
      const bystander = anArrowAwayFrom(table, [converted, mover, exit, bHome]);
      const before = stateOf(
        [
          { arrow: converted, owner: B, heads: 2 },
          { arrow: mover, owner: A, heads: 1 },
          { arrow: bystander, owner: B, heads: 2, spent },
        ],
        A,
        {
          territory: [
            { arrow: converted, owner: A },
            { arrow: mover, owner: A },
            { arrow: exit, owner: A },
            { arrow: bHome, owner: B },
          ],
        },
      );
      const after = applyConvert(table, before, mover, exit);
      expect(ownerOf(after, bystander), `spent=${String(spent)}`).toBe(B);
      expect(spentOn(after, bystander), `spent=${String(spent)}`).toBe(spent);
    }
  });

  it('6. Conversion conserves the total head count', () => {
    const table = onBoard();
    for (const heads of HEADS) {
      const { mover, exit, before } = aLandConvert(table, heads);
      const after = applyConvert(table, before, mover, exit);
      expect(totalHeads(after), `heads=${String(heads)}`).toBe(totalHeads(before));
    }
  });
});
