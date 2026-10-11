/**
 * Replay fixture for P70 — convert, the capturing turn ends, then the stack walks.
 *
 * @see docs/spec/convert-spent/convert-spent.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, speed, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { replay, replayIsDeterministic } from '../src/replay';
import { A, headsOn, onBoard, ownerOf, snapshot, spentOn, stepsFrom } from './support';
import { aLandConvert, applyConvert } from './convert-spent.support';

describe('P70 convert-spent replay', () => {
  it('a converted stack is spent on the capturing turn and walks after that turn ends', () => {
    const table = onBoard();
    const { converted, mover, exit, before } = aLandConvert(table, 1);
    const converting: Move = step(mover, exit, 1);

    const afterConvert = replay(table.rules, before, [converting]);
    expect(ownerOf(afterConvert, converted)).toBe(A);
    expect(headsOn(afterConvert, converted)).toBe(1);
    expect(spentOn(afterConvert, converted)).toBe(speed(1));
    expect(stepsFrom(table, afterConvert, converted)).toEqual([]);

    const afterAEnds = replay(table.rules, afterConvert, [endTurn()]);
    expect(spentOn(afterAEnds, converted)).toBe(0);

    const afterBEnds = replay(table.rules, afterAEnds, [endTurn()]);
    const walking: Move = step(converted, mover, 1);
    const final = replay(table.rules, afterBEnds, [walking]);

    expect(ownerOf(final, mover)).toBe(A);
    expect(headsOn(final, mover)).toBe(1);
    expect(
      replayIsDeterministic(table.rules, before, [converting, endTurn(), endTurn(), walking], snapshot),
    ).toBe(true);
  });

  it('apply of the converting step is a pure function of the record', () => {
    const table = onBoard();
    const { mover, exit, before } = aLandConvert(table, 2);
    const pictured = snapshot(before);
    const once = applyConvert(table, before, mover, exit);
    const twice = applyConvert(table, before, mover, exit);
    expect(snapshot(once)).toEqual(snapshot(twice));
    expect(snapshot(before)).toEqual(pictured);
  });
});
