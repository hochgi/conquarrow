/**
 * docs/spec/convert-spent/convert-spent.core.feature — rules scenarios.
 *
 * @see docs/spec/convert-spent/convert-spent.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, speed, step } from '@conquarrow/contracts';
import {
  A,
  B,
  exitsFrom,
  headsOn,
  onBoard,
  ownerOf,
  pick,
  spentOn,
  stateOf,
  stepsFrom,
} from './support';
import { aClosureConvert, aLandConvert, anArrowAwayFrom, closeAround } from './convert-spent.support';

describe('conversion spends the stack', () => {
  it('A converted 1-stack offers no step', () => {
    const setup = aClosureConvert(1);
    const after = closeAround(setup);

    expect(ownerOf(after, setup.occupied)).toBe(A);
    expect(headsOn(after, setup.occupied)).toBe(1);
    expect(spentOn(after, setup.occupied)).toBe(speed(1));
    expect(after.groups.get(setup.occupied)?.speedOverride).toBeUndefined();
    expect(stepsFrom(setup.table, after, setup.occupied)).toEqual([]);
  });

  it.each([1, 2, 3, 4] as const)('Stacks of every speed are spent out (%i heads)', (heads) => {
    const setup = aClosureConvert(heads);
    const after = closeAround(setup);

    expect(ownerOf(after, setup.occupied)).toBe(A);
    expect(headsOn(after, setup.occupied)).toBe(heads);
    expect(spentOn(after, setup.occupied)).toBe(speed(heads));
    expect(stepsFrom(setup.table, after, setup.occupied)).toEqual([]);
  });

  it("The capturer's other stack can still step", () => {
    const table = onBoard();
    const { converted, mover, exit } = aLandConvert(table, 1);
    const other = anArrowAwayFrom(table, [converted, mover, exit]);
    const otherExit = pick(
      exitsFrom(table.geometry, other).filter(
        (arrow) => arrow !== converted && arrow !== mover && arrow !== exit,
      ),
      0,
    );
    const before = stateOf(
      [
        { arrow: converted, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
        { arrow: other, owner: A, heads: 1 },
      ],
      A,
      {
        territory: [
          { arrow: converted, owner: A },
          { arrow: mover, owner: A },
          { arrow: exit, owner: A },
          { arrow: other, owner: A },
          { arrow: otherExit, owner: A },
        ],
      },
    );

    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(ownerOf(after, converted)).toBe(A);
    expect(stepsFrom(table, after, other).length).toBeGreaterThan(0);
  });

  it('Ending the capturing turn clears the spent', () => {
    const setup = aClosureConvert(2);
    const converted = closeAround(setup);
    expect(spentOn(converted, setup.occupied)).toBe(speed(2));

    const after = setup.table.rules.apply(converted, endTurn());

    expect(spentOn(after, setup.occupied)).toBe(0);
    expect(after.groups.get(setup.occupied)?.speedOverride).toBeUndefined();
  });
});
