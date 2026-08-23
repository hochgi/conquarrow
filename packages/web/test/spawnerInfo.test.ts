import { describe, expect, it } from 'vitest';
import { endTurn, rational } from '@conquarrow/contracts';
import type { ArrowId, GameState, PlayerId, VertexId } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { compareArrows, compareVertices, makeRules } from '@conquarrow/rules-core';
import { spawnerInfoAt, spawnerProminence, yieldSoonByArrow } from '../src/spawnerInfo';

const geometry = makeTiling();
const rules = makeRules(geometry);

/** Any spawner on the opening board, with its three shares. */
const aSpawner = (
  state: GameState,
): { vertex: VertexId; shares: readonly ArrowId[] } => {
  const vertex = [...state.spawners.keys()].toSorted(compareVertices)[0];
  if (vertex === undefined) throw new Error('setup: the opening placed no spawners');
  return {
    vertex,
    shares: [...geometry.borderArrows(vertex)].toSorted(compareArrows),
  };
};

const seats = (state: GameState): { a: PlayerId; b: PlayerId } => {
  const [a, b] = state.players;
  if (a === undefined || b === undefined) throw new Error('setup: need two seats');
  return { a, b };
};

describe('spawner read-out', () => {
  it('reports an untouched spawner as paying nobody', () => {
    // The most surprising rule in §7's economy and the one the board cannot express: a
    // spawner in open ground is worth exactly zero until somebody closes ground around it.
    const state = makeMatch();
    const { vertex } = aSpawner(state);
    const info = spawnerInfoAt(geometry, state, vertex);
    expect(info).toBeDefined();
    if (info === undefined) return;

    expect(info.shares).toHaveLength(3);
    expect(info.shares.every((s) => s.status === 'unclaimed')).toBe(true);
    expect(info.shares.every((s) => s.owner === undefined)).toBe(true);
    expect(info.held).toEqual([]);
    expect(info.yielding).toBe(0);
    // …and it stays background on the board while that is true.
    expect(spawnerProminence(info)).toBeLessThan(1);
  });

  it('reports ownership in thirds, and brightens once held', () => {
    const opening = makeMatch();
    const { a, b } = seats(opening);
    const { vertex, shares } = aSpawner(opening);
    const [one, two, three] = shares;
    if (one === undefined || two === undefined || three === undefined) return;

    const territory = new Map(opening.territory);
    territory.set(one, a);
    territory.set(two, a);
    territory.set(three, b);
    const info = spawnerInfoAt(geometry, { ...opening, territory }, vertex);
    expect(info).toBeDefined();
    if (info === undefined) return;

    // Descending by thirds — shaving one arrow off a rival is a third of their income, so
    // the split is the number worth reading first.
    expect(info.held.map((h) => [String(h.player), h.thirds])).toEqual([
      [String(a), 2],
      [String(b), 1],
    ]);
    expect(info.yielding).toBe(1);
    expect(spawnerProminence(info)).toBe(1);
  });

  it('separates a blockaded share from an unclaimed one', () => {
    // Both earn nothing this round and they are nothing alike: §7 says the round-robin
    // still lands on a blockaded arrow and the fraction is *lost*, so a blockade is an
    // attack with a cost, while unclaimed ground is simply not yet an asset.
    const opening = makeMatch();
    const { a, b } = seats(opening);
    const { vertex, shares } = aSpawner(opening);
    const [held, blocked] = shares;
    if (held === undefined || blocked === undefined) return;

    const territory = new Map(opening.territory);
    territory.set(held, a);
    territory.set(blocked, a);
    const groups = new Map(opening.groups);
    groups.set(blocked, { owner: b, heads: 1, spent: 0 });

    const info = spawnerInfoAt(geometry, { ...opening, territory, groups }, vertex);
    expect(info).toBeDefined();
    if (info === undefined) return;

    const byArrow = new Map(info.shares.map((s) => [String(s.arrow), s]));
    expect(byArrow.get(String(held))?.status).toBe('earning');
    expect(byArrow.get(String(blocked))?.status).toBe('blockaded');
    expect(info.yielding).toBeCloseTo(1 / 3);
  });

  it('reads the banked fraction and the rounds a head costs', () => {
    const opening = makeMatch();
    const { a } = seats(opening);
    const { vertex, shares } = aSpawner(opening);
    const one = shares[0];
    if (one === undefined) return;

    const territory = new Map(opening.territory);
    territory.set(one, a);
    const accumulators = new Map(opening.accumulators);
    accumulators.set(one, rational(2, 3));
    const spawners = new Map(opening.spawners);
    spawners.set(vertex, { force: rational(1, 9), phase: 0 });

    const info = spawnerInfoAt(geometry, { ...opening, territory, accumulators, spawners }, vertex);
    expect(info).toBeDefined();
    if (info === undefined) return;

    expect(info.shares[0]?.loaded).toBeCloseTo(2 / 3);
    expect(info.shares[0]?.banked).toEqual(rational(2, 3));
    // Total output is *f* per full round, so the spawner pays a head every 1/f rounds — but
    // the round-robin gives each share a third of the ticks, so one arrow takes 3/f. Both
    // are shown: the first is what it is worth, the second is how long a raid must hold.
    expect(info.roundsPerHead).toBe(9);
    expect(info.roundsPerShare).toBe(27);
  });

  it('flags the share the engine will actually feed next', () => {
    // The load-bearing one. The read-out orders shares by arrow id because that is what
    // `Spawner.phase` indexes; if it ever disagreed with the engine's round-robin the
    // tooltip would be teaching players the wrong rhythm, which is worse than silence.
    const opening = makeMatch();
    const { a } = seats(opening);
    const { vertex, shares } = aSpawner(opening);

    const territory = new Map(opening.territory);
    for (const arrow of shares) territory.set(arrow, a);
    let state: GameState = { ...opening, territory };

    for (let round = 0; round < 3; round += 1) {
      const info = spawnerInfoAt(geometry, state, vertex);
      expect(info).toBeDefined();
      if (info === undefined) return;
      const promised = info.shares.find((s) => s.next)?.arrow;
      expect(promised).toBeDefined();

      // One full round: end every seat's turn so accrual ticks (§7, item 41).
      let next = state;
      for (let seat = 0; seat < state.players.length; seat += 1) {
        next = rules.apply(next, endTurn());
      }

      const advanced = shares.filter((arrow) => {
        const before = state.accumulators.get(arrow)?.num ?? 0;
        const after = next.accumulators.get(arrow)?.num ?? 0;
        return after !== before;
      });
      expect(advanced.map(String)).toEqual([String(promised)]);
      state = next;
    }
  });

  it('flags shares that birth a head on the next one or two accruals', () => {
    const opening = makeMatch();
    const { a } = seats(opening);
    const { vertex, shares } = aSpawner(opening);
    const [one, two] = shares;
    if (one === undefined || two === undefined) return;

    // Phase 0 feeds `one`. Bank it at 8/9 with force 1/9 so the next feed emits.
    const territory = new Map(opening.territory);
    territory.set(one, a);
    territory.set(two, a);
    const accumulators = new Map(opening.accumulators);
    accumulators.set(one, rational(8, 9));
    accumulators.set(two, rational(8, 9));
    const spawners = new Map(opening.spawners);
    spawners.set(vertex, { force: rational(1, 9), phase: 0 });
    const state = { ...opening, territory, accumulators, spawners };

    const soon = yieldSoonByArrow(geometry, state);
    expect(soon.get(one)).toBe(1);
    expect(soon.get(two)).toBe(2);
  });

  it('returns nothing for a vertex that carries no spawner', () => {
    const state = makeMatch();
    const bare = [...state.spawners.keys()][0];
    if (bare === undefined) return;
    const spawners = new Map(state.spawners);
    spawners.delete(bare);
    expect(spawnerInfoAt(geometry, { ...state, spawners }, bare)).toBeUndefined();
  });
});
