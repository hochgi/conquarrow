/**
 * docs/spec/economy/economy.core.feature — one test per scenario.
 *
 * @see docs/spec/economy/economy.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, rational } from '@conquarrow/contracts';
import type { ArrowId, VertexId } from '@conquarrow/contracts';
import { orderedBorders } from '../src/economy';
import {
  A,
  B,
  anArrow,
  headsOn,
  onBoard,
  owned,
  ownerOf,
  stateOf,
} from './support';

const aSpawnerOn = (
  geometry: ReturnType<typeof onBoard>['geometry'],
  arrow: ArrowId,
): { vertex: VertexId; borders: readonly ArrowId[] } => {
  const vertex = geometry.flankVertices(arrow)[0];
  if (vertex === undefined) throw new Error('setup: arrow has no flank vertex');
  const borders = orderedBorders(geometry, vertex);
  return { vertex, borders };
};

const fullRound = (rules: ReturnType<typeof onBoard>['rules'], state: ReturnType<typeof stateOf>) => {
  const afterA = rules.apply(state, endTurn());
  return rules.apply(afterA, endTurn());
};

describe('accrual ticks once per full round', () => {
  it('does not accrue when only the first player ends the turn', () => {
    const table = onBoard();
    const seed = anArrow(table.geometry);
    const { vertex, borders } = aSpawnerOn(table.geometry, seed);
    const feed = borders[0];
    if (feed === undefined) throw new Error("setup: empty borders");
    const before = stateOf([], A, {
      territory: owned([feed], A),
      spawners: [[vertex, { force: rational(1, 3), phase: 0 }]],
    });

    const after = table.rules.apply(before, endTurn());

    expect(after.accumulators.size).toBe(0);
    expect(after.spawners.get(vertex)?.phase).toBe(0);
    expect(after.activePlayer).toBe(B);
  });

  it('advances every spawner once when a full round completes', () => {
    const table = onBoard();
    const seed = anArrow(table.geometry);
    const { vertex, borders } = aSpawnerOn(table.geometry, seed);
    const feed = borders[0];
    if (feed === undefined) throw new Error("setup: empty borders");
    const bLand = borders[1];
    if (bLand === undefined) throw new Error('setup: the vertex borders one arrow only');
    const before = stateOf([], A, {
      // B holds a share of the same spawner, so the round boundary does not vanish
      // B and win the match for A — a won match refuses the rest of the round
      // (P38). Phase 0 points at `feed`, so B's share accrues nothing here.
      territory: [...owned([feed], A), ...owned([bLand], B)],
      spawners: [[vertex, { force: rational(1, 3), phase: 0 }]],
    });

    const after = fullRound(table.rules, before);

    expect(after.accumulators.get(feed)).toEqual(rational(1, 3));
    expect(after.spawners.get(vertex)?.phase).toBe(1);
    expect(after.activePlayer).toBe(A);
  });
});

describe('carry remainder and spawn', () => {
  it('emits a head and carries the fractional remainder', () => {
    const table = onBoard();
    const seed = anArrow(table.geometry);
    const { vertex, borders } = aSpawnerOn(table.geometry, seed);
    const feed = borders[0];
    if (feed === undefined) throw new Error("setup: empty borders");
    const bLand = borders[1];
    if (bLand === undefined) throw new Error('setup: the vertex borders one arrow only');
    // 2/3 + 1/3 = 1 → birth 1, remainder 0.
    const before = stateOf([], A, {
      // B holds a share of the same spawner, so the round boundary does not vanish
      // B and win the match for A — a won match refuses the rest of the round
      // (P38). Phase 0 points at `feed`, so B's share accrues nothing here.
      territory: [...owned([feed], A), ...owned([bLand], B)],
      accumulators: [[feed, rational(2, 3)]],
      spawners: [[vertex, { force: rational(1, 3), phase: 0 }]],
    });

    const after = fullRound(table.rules, before);

    expect(ownerOf(after, feed)).toBe(A);
    expect(headsOn(after, feed)).toBe(1);
    expect(after.accumulators.has(feed)).toBe(false);
  });

  it('merges a spawn into a friendly stack without speedOverride', () => {
    const table = onBoard();
    const seed = anArrow(table.geometry);
    const { vertex, borders } = aSpawnerOn(table.geometry, seed);
    const feed = borders[0];
    if (feed === undefined) throw new Error("setup: empty borders");
    const bLand = borders[1];
    if (bLand === undefined) throw new Error('setup: the vertex borders one arrow only');
    const before = stateOf([{ arrow: feed, owner: A, heads: 2, spent: 0 }], A, {
      // B holds a share of the same spawner, so the round boundary does not vanish
      // B and win the match for A — a won match refuses the rest of the round
      // (P38). Phase 0 points at `feed`, so B's share accrues nothing here.
      territory: [...owned([feed], A), ...owned([bLand], B)],
      accumulators: [[feed, rational(2, 3)]],
      spawners: [[vertex, { force: rational(1, 3), phase: 0 }]],
    });

    const after = fullRound(table.rules, before);

    expect(headsOn(after, feed)).toBe(3);
    expect(after.groups.get(feed)?.speedOverride).toBeUndefined();
    expect(after.groups.get(feed)?.spent).toBe(0);
  });
});

describe('enemy blockade', () => {
  it('loses the share force when an enemy occupies the feed arrow', () => {
    const table = onBoard();
    const seed = anArrow(table.geometry);
    const { vertex, borders } = aSpawnerOn(table.geometry, seed);
    const feed = borders[0];
    if (feed === undefined) throw new Error("setup: empty borders");
    // The blockader needs a life line or it converts at the round boundary (§6.3,
    // P89): B's land feeds the point its trail leaves. That land is also B's share,
    // or the boundary vanishes the blockade (P36). This case is about halt.
    const bLand = borders.find((b) => table.geometry.target(b) === table.geometry.origin(feed));
    if (bLand === undefined) throw new Error('setup: no border feeds the feed arrow');
    const before = stateOf([{ arrow: feed, owner: B, heads: 1 }], A, {
      trail: { B: [feed] },
      territory: [...owned([feed], A), ...owned([bLand], B)],
      accumulators: [[feed, rational(1, 3)]],
      spawners: [[vertex, { force: rational(1, 3), phase: 0 }]],
    });

    const after = fullRound(table.rules, before);

    expect(after.accumulators.get(feed)).toEqual(rational(1, 3));
    expect(headsOn(after, feed)).toBe(1);
    expect(ownerOf(after, feed)).toBe(B);
    expect(after.spawners.get(vertex)?.phase).toBe(1);
  });
});
