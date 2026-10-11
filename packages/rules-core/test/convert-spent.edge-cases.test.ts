/**
 * docs/spec/convert-spent/convert-spent.edge-cases.feature — rules scenarios.
 *
 * @see docs/spec/convert-spent/convert-spent.md
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, speed, step } from '@conquarrow/contracts';
import type { Move, StepMove } from '@conquarrow/contracts';
import {
  A,
  B,
  anArrow,
  anExitFrom,
  exitsFrom,
  headsOn,
  isTrail,
  onBoard,
  ownerOf,
  pick,
  spentOn,
  stateOf,
  stepsFrom,
  totalHeads,
} from './support';
import type { ArrowId } from './support';
import {
  aLandConvert,
  anArrivalOnto,
  anArrowAwayFrom,
  applyConvert,
} from './convert-spent.support';

const stepsOnto = (moves: readonly Move[], from: ArrowId, exit: ArrowId): readonly StepMove[] =>
  moves.filter((m): m is StepMove => m.kind === 'step' && m.from === from && m.exit === exit);

describe('prior spending does not carry, and neither does a fresh allowance', () => {
  it("A victim's spent and merge override are discarded", () => {
    const table = onBoard();
    const { converted, mover, exit, before } = aLandConvert(table, 3, {
      spent: 1,
      speedOverride: 0,
    });

    const after = applyConvert(table, before, mover, exit);

    expect(ownerOf(after, converted)).toBe(A);
    expect(spentOn(after, converted)).toBe(speed(3));
    expect(after.groups.get(converted)?.speedOverride).toBeUndefined();
    expect(stepsFrom(table, after, converted)).toEqual([]);
  });

  it('A larger friendly arrival does not wake the converted stack', () => {
    const table = onBoard();
    const { converted, mover, exit } = aLandConvert(table, 1);
    const mergeFrom = anArrivalOnto(table, converted, [converted, mover, exit]);
    const before = stateOf(
      [
        { arrow: converted, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
        { arrow: mergeFrom, owner: A, heads: 2 },
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
    expect(spentOn(convertedState, converted)).toBe(speed(1));

    const after = table.rules.apply(convertedState, step(mergeFrom, converted, 2));

    expect(headsOn(after, converted)).toBe(3);
    expect(stepsFrom(table, after, converted)).toEqual([]);
  });

  it('An equal friendly arrival does not wake the converted 1-stack', () => {
    const table = onBoard();
    const { converted, mover, exit } = aLandConvert(table, 1);
    const mergeFrom = anArrivalOnto(table, converted, [converted, mover, exit]);
    const before = stateOf(
      [
        { arrow: converted, owner: B, heads: 1 },
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
    const after = table.rules.apply(convertedState, step(mergeFrom, converted, 1));

    expect(spentOn(after, converted)).toBe(speed(1));
    expect(stepsFrom(table, after, converted)).toEqual([]);
  });

  it('Joining a converted 3-stack keeps the spent', () => {
    const table = onBoard();
    const { converted, mover, exit } = aLandConvert(table, 3);
    const mergeFrom = anArrivalOnto(table, converted, [converted, mover, exit]);
    const before = stateOf(
      [
        { arrow: converted, owner: B, heads: 3 },
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
    expect(spentOn(convertedState, converted)).toBe(speed(3));

    const after = table.rules.apply(convertedState, step(mergeFrom, converted, 1));

    expect(spentOn(after, converted)).toBe(speed(3));
    expect(stepsFrom(table, after, converted)).toEqual([]);
  });

  it('A group that does not convert keeps its spent', () => {
    const table = onBoard();
    const { converted, mover, exit } = aLandConvert(table, 1);
    const bHome = anArrowAwayFrom(table, [converted, mover, exit]);
    const bystander = anArrowAwayFrom(table, [converted, mover, exit, bHome]);
    const before = stateOf(
      [
        { arrow: converted, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
        { arrow: bystander, owner: B, heads: 1, spent: 1 },
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
    expect(before.territory.get(bystander)).toBeUndefined();

    const after = applyConvert(table, before, mover, exit);

    expect(ownerOf(after, bystander)).toBe(B);
    expect(spentOn(after, bystander)).toBe(1);
  });

  it('Stepping the converted stack is refused', () => {
    const table = onBoard();
    const { converted, mover, exit, before } = aLandConvert(table, 1);
    const after = applyConvert(table, before, mover, exit);
    const onward = pick(
      exitsFrom(table.geometry, converted).filter((arrow) => arrow !== mover && arrow !== exit),
      0,
    );
    const illegal = step(converted, onward, 1);

    expect(stepsFrom(table, after, converted)).toEqual([]);
    expect(() => table.rules.apply(after, illegal)).toThrow(ContractViolation);
  });
});

describe('capture bookkeeping that P70 does not reopen', () => {
  it('Conversion conserves heads', () => {
    const table = onBoard();
    const { converted, mover, exit, before } = aLandConvert(table, 4);
    const sum = totalHeads(before);

    const after = applyConvert(table, before, mover, exit);

    expect(ownerOf(after, converted)).toBe(A);
    expect(totalHeads(after)).toBe(sum);
  });

  it('Convert wipe still clears the victim trail on the converted arrow', () => {
    const table = onBoard();
    const tip = anArrow(table.geometry);
    const distal = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, distal);
    const exit = pick(
      exitsFrom(table.geometry, mover).filter((arrow) => arrow !== tip && arrow !== distal),
      0,
    );
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: [tip, distal] },
        territory: [
          { arrow: tip, owner: A },
          { arrow: distal, owner: A },
          { arrow: mover, owner: A },
          { arrow: exit, owner: A },
        ],
      },
    );

    const after = applyConvert(table, before, mover, exit);

    expect(ownerOf(after, tip)).toBe(A);
    expect(isTrail(after, B, tip)).toBe(false);
  });

  it('A self-convert step stays illegal', () => {
    // Feature names B as the raider; the background's "A's turn" does not apply
    // — self-convert is the active seat stepping onto foreign land.
    const table = onBoard();
    const from = anArrow(table.geometry);
    const exit = anExitFrom(table.geometry, from);
    const state = stateOf([{ arrow: from, owner: B, heads: 1 }], B, {
      trail: { B: [from] },
      territory: [{ arrow: exit, owner: A }],
    });
    expect(table.rules.anchorGrade(state, from, B)).toBe('stack');

    expect(stepsOnto(table.rules.legalMoves(state), from, exit)).toEqual([]);
  });
});
