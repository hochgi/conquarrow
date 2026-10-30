/**
 * P35 replay — the click-then-count gesture produces one exact move list.
 *
 * P35 reorders the two questions a route asks, and the ordering is a turn-flow
 * change: the same final list is now reached by *clicking first and counting
 * after*, and a rewrite of the last run has to leave the earlier moves alone
 * byte for byte. A golden list plus a golden occupancy is the cheapest detector
 * of both a rewrite that reaches too far back and any accidental nondeterminism
 * in the offer that feeds it.
 *
 * The goldens are written out by hand. One read back from the implementation
 * would prove only that it is self-consistent.
 *
 * The first fixture is deliberately **the same golden P34's replay asserts** —
 * `8, 8, 4` down one ray — reached with the carry set *after* each click instead
 * of before it. That the two gestures land on the same list is the whole claim of
 * the inversion: nothing about what a route may legally be has changed.
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import type { GameState, Move } from '@conquarrow/contracts';
import { replay, replayIsDeterministic } from '@conquarrow/rules-core';
import {
  arrowAlong,
  clickArrow,
  clickRuns,
  geometry,
  headsOn,
  openField,
  pendingOf,
  rules,
  selectRoute,
  sourceArrow,
} from './count-after-route.support';

const board = { geometry, rules };
const from = sourceArrow(geometry);
const first = arrowAlong(geometry, from, 0, 1);
const second = arrowAlong(geometry, from, 0, 2);
const third = arrowAlong(geometry, from, 0, 3);

/** Occupancy as a sorted, printable list — the shape a golden can be read in. */
const occupancy = (state: GameState): readonly string[] =>
  [...state.groups.entries()]
    .map(([arrow, group]) => `${String(arrow)} ${String(group.owner)}×${String(group.heads)}`)
    .toSorted();

describe('P35 replay — counting after the click lands on one exact list', () => {
  /** Twelve heads: two steps rewritten to 8, then one more rewritten to 4. */
  const clickThenCount = () => {
    const state = openField(from, 12);
    const selected = selectRoute(board, state, from);
    clickRuns(selected, [
      { arrow: second, count: 8 },
      { arrow: third, count: 4 },
    ]);
    return { state, sent: pendingOf(selected.mode.send()) };
  };

  it('the sent moves are the run the clicks named, at the counts chosen after them', () => {
    const { sent } = clickThenCount();
    const expected: readonly Move[] = [
      step(from, first, 8),
      step(first, second, 8),
      step(second, third, 4),
    ];
    expect(sent).toEqual(expected);
  });

  it('replaying them reproduces one exact occupancy', () => {
    const { state, sent } = clickThenCount();
    const final = replay(rules, state, sent);
    expect(occupancy(final)).toEqual([
      `${String(from)} A×4`,
      `${String(second)} A×4`,
      `${String(third)} A×4`,
    ]);
    expect(headsOn(final, from) + headsOn(final, second) + headsOn(final, third)).toBe(12);
    expect(final.groups.has(first)).toBe(false);
  });

  it('the same gestures draft the same list twice, and the replay does not drift', () => {
    const left = clickThenCount();
    const right = clickThenCount();
    expect(left.sent).toEqual(right.sent);
    expect(replayIsDeterministic(rules, left.state, left.sent, occupancy)).toBe(true);
    expect(occupancy(replay(rules, left.state, left.sent))).toEqual(
      occupancy(replay(rules, right.state, right.sent)),
    );
  });

  // P77 inverts this: the forced-count click drafts, and Send sends the one move.
  it('a forced-count click then Send replays as the one move it sent', () => {
    const state = openField(from, 1);
    const selected = selectRoute(board, state, from);
    expect(pendingOf(clickArrow(selected, first))).toHaveLength(0);
    const sent = pendingOf(selected.mode.send());
    expect(sent).toEqual([step(from, first, 1)]);
    const final = replay(rules, state, sent);
    expect(occupancy(final)).toEqual([`${String(first)} A×1`]);
    expect(replayIsDeterministic(rules, state, sent, occupancy)).toBe(true);
  });

  it('a pop, a rewrite and a send land on the shorter list exactly', () => {
    const state = openField(from, 16);
    const selected = selectRoute(board, state, from);
    // Two runs of two, then back to the first run and down to six heads.
    const onward = arrowAlong(geometry, second, 1, 2);
    clickRuns(selected, [{ arrow: second }, { arrow: onward }]);
    clickArrow(selected, second);
    selected.mode.setCarry(6);
    const sent = pendingOf(selected.mode.send());
    expect(sent).toEqual([step(from, first, 6), step(first, second, 6)]);
    const final = replay(rules, state, sent);
    expect(occupancy(final)).toEqual([`${String(from)} A×10`, `${String(second)} A×6`]);
  });
});
