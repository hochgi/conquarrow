/**
 * EARS invariants from docs/spec/birth-cut/birth-cut.md.
 */

import { describe, expect, it } from 'vitest';
import { endTurn, rational } from '@conquarrow/contracts';
import type { ArrowId, GameState, VertexId } from '@conquarrow/contracts';
import { replay, replayIsDeterministic } from '../src/replay';
import { orderedBorders } from '../src/economy';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  anArrow,
  anExitFrom,
  headsOn,
  isTrail,
  onBoard,
  owned,
  ownerOf,
  snapshot,
  stateOf,
  twoDisjointPaths,
} from './support';

const aSpawnerOn = (
  geometry: ReturnType<typeof onBoard>['geometry'],
  arrow: ArrowId,
): { vertex: VertexId; borders: readonly ArrowId[] } => {
  const vertex = geometry.flankVertices(arrow)[0];
  if (vertex === undefined) throw new Error('setup: arrow has no flank vertex');
  return { vertex, borders: orderedBorders(geometry, vertex) };
};

const totalHeads = (state: GameState): number =>
  [...state.groups.values()].reduce((sum, group) => sum + group.heads, 0);

describe('birth-cut invariants', () => {
  it('never reduces heads when a birth-cut resolves', () => {
    const table = onBoard();
    const seed = anArrow(table.geometry);
    const { vertex, borders } = aSpawnerOn(table.geometry, seed);
    const feed = borders[0];
    const bHome = borders[1];
    const aShare = borders[2];
    if (feed === undefined || bHome === undefined || aShare === undefined) {
      throw new Error('setup: vertex does not border three arrows');
    }
    const continuation = anExitFrom(table.geometry, feed);
    const before = stateOf([], A, {
      trail: { A: [feed, continuation] },
      territory: [...owned([feed], B), ...owned([bHome], B), ...owned([aShare], A)],
      accumulators: [[feed, rational(2, 3)]],
      spawners: [[vertex, { force: rational(1, 3), phase: 0 }]],
    });
    const headsBefore = totalHeads(before);

    const after = table.rules.apply(table.rules.apply(before, endTurn()), endTurn());

    expect(totalHeads(after)).toBe(headsBefore + 1);
    expect(headsOn(after, feed)).toBe(1);
  });

  it('replays a birth-cut round to the same snapshot', () => {
    const table = onBoard();
    const seed = anArrow(table.geometry);
    const { vertex, borders } = aSpawnerOn(table.geometry, seed);
    const feed = borders[0];
    const bHome = borders[1];
    const aShare = borders[2];
    if (feed === undefined || bHome === undefined || aShare === undefined) {
      throw new Error('setup: vertex does not border three arrows');
    }
    const continuation = anExitFrom(table.geometry, feed);
    const initial = stateOf([], A, {
      trail: { A: [feed, continuation] },
      territory: [...owned([feed], B), ...owned([bHome], B), ...owned([aShare], A)],
      accumulators: [[feed, rational(2, 3)]],
      spawners: [[vertex, { force: rational(1, 3), phase: 0 }]],
    });
    const moves = [endTurn(), endTurn()] as const;

    const final = replay(table.rules, initial, [...moves]);
    expect(ownerOf(final, feed)).toBe(B);
    expect(isTrail(final, A, feed)).toBe(false);
    expect(snapshot(replay(table.rules, initial, [...moves]))).toEqual(snapshot(final));
    expect(replayIsDeterministic(table.rules, initial, [...moves], snapshot)).toBe(true);
  });

  it('cuts each disconnected birth arrow when two spawners emit in one tick', () => {
    const table = onBoard();
    const [path0, path1] = twoDisjointPaths(table.geometry, [1, 1], MINIMAL_DIAMETER);
    const feed0 = path0[0];
    const feed1 = path1[0];
    if (feed0 === undefined || feed1 === undefined) {
      throw new Error('setup: disjoint paths did not yield two arrows');
    }

    const feedOf = (arrow: ArrowId, avoid?: VertexId) => {
      const vertex = table.geometry.flankVertices(arrow).find((candidate) => candidate !== avoid);
      if (vertex === undefined) throw new Error('setup: arrow has no usable flank vertex');
      const borders = orderedBorders(table.geometry, vertex);
      const phase = borders.indexOf(arrow);
      if (phase < 0) throw new Error('setup: flank vertex does not border the feed');
      return { vertex, phase, borders };
    };

    const first = feedOf(feed0);
    const second = feedOf(feed1, first.vertex);
    const aShare = first.borders.find((arrow) => arrow !== feed0 && arrow !== feed1);
    if (aShare === undefined) throw new Error('setup: need an A share on the first vertex');

    const before = stateOf([], A, {
      trail: { A: [feed0, feed1] },
      territory: [...owned([feed0, feed1], B), ...owned([aShare], A)],
      accumulators: [
        [feed0, rational(2, 3)],
        [feed1, rational(2, 3)],
      ],
      spawners: [
        [first.vertex, { force: rational(1, 3), phase: first.phase }],
        [second.vertex, { force: rational(1, 3), phase: second.phase }],
      ],
    });
    const headsBefore = totalHeads(before);

    const after = table.rules.apply(table.rules.apply(before, endTurn()), endTurn());

    expect(isTrail(after, A, feed0)).toBe(false);
    expect(isTrail(after, A, feed1)).toBe(false);
    expect(ownerOf(after, feed0)).toBe(B);
    expect(ownerOf(after, feed1)).toBe(B);
    expect(headsOn(after, feed0)).toBe(1);
    expect(headsOn(after, feed1)).toBe(1);
    expect(totalHeads(after)).toBe(headsBefore + 2);
  });
});
