/**
 * EARS invariants for docs/spec/mirrored-spawner-field/mirrored-spawner-field.md.
 *
 * Table-driven over a window of vertices and a handful of seeds. No replay
 * fixture — this packet does not touch turn flow. No pinned spawner counts.
 */

import { describe, expect, it } from 'vitest';
import {
  ContractViolation,
  DEFAULT_MATCH_CONFIG,
  densityAtRadius,
  forceAtRadius,
  rational,
} from '@conquarrow/contracts';
import type { PointId, Spawner, VertexId } from '@conquarrow/contracts';
import {
  OUT_DIRECTIONS,
  cellArrow,
  cellPoint,
  cellVertex,
  homeCellsFor,
  makeMatch,
  makeTiling,
  reflectCell,
} from '../src/index';
import type { Direction } from '../src/index';
import { assertInvolution, thinningSample } from '../src/setup';
import { vertexCell } from '../src/cells';
import type { Cell } from '../src/cells';

const SEEDS = [1, 2, 9] as const;

const radiusOf = (vertex: VertexId): number => {
  const { i, j } = vertexCell(vertex);
  return Math.round((Math.abs(i) + Math.abs(j) + Math.abs(-i - j)) / 2);
};

const reflectVertex = (vertex: VertexId): VertexId => {
  const { i, j, parity } = vertexCell(vertex);
  const mirrored = reflectCell({ i, j });
  return cellVertex(mirrored.i, mirrored.j, parity);
};

const keysOf = (spawners: ReadonlyMap<VertexId, unknown>): readonly string[] =>
  [...spawners.keys()].map(String).toSorted();

const wouldKeepAt = (
  cell: Cell & { parity: 'up' | 'down' },
  seed: number,
  R: number,
): boolean => {
  const r = Math.round((Math.abs(cell.i) + Math.abs(cell.j) + Math.abs(-cell.i - cell.j)) / 2);
  if (r > R) return false;
  const density = densityAtRadius(r, R);
  return thinningSample({ i: cell.i, j: cell.j, parity: cell.parity }, seed) * density.den < density.num;
};

const forceKey = (spawner: Spawner): string =>
  `${String(spawner.force.num)}/${String(spawner.force.den)}`;

const directedDistancesFrom = (
  geometry: ReturnType<typeof makeTiling>,
  start: PointId,
  maxSteps: number,
): ReadonlyMap<string, number> => {
  const dist = new Map<string, number>([[String(start), 0]]);
  const queue: PointId[] = [start];
  for (let q = 0; q < queue.length; q += 1) {
    const at = queue[q];
    if (at === undefined) continue;
    const d = dist.get(String(at)) ?? 0;
    if (d >= maxSteps) continue;
    for (const arrow of geometry.outArrows(at)) {
      const next = geometry.target(arrow);
      const key = String(next);
      if (dist.has(key)) continue;
      dist.set(key, d + 1);
      queue.push(next);
    }
  }
  return dist;
};

const fieldPairsFrom = (
  home: Cell,
  spawners: ReadonlyMap<VertexId, Spawner>,
  R: number,
): readonly string[] => {
  const geometry = makeTiling();
  const dist = directedDistancesFrom(
    geometry,
    cellPoint(home.i, home.j),
    4 * (R + DEFAULT_MATCH_CONFIG.homeOffset),
  );
  const pairs: string[] = [];
  for (const [vertex, spawner] of spawners) {
    if (radiusOf(vertex) > R) continue;
    const { i, j } = vertexCell(vertex);
    const d = dist.get(String(cellPoint(i, j)));
    if (d === undefined) {
      throw new Error(`no directed path from home to ${String(vertex)}`);
    }
    pairs.push(`${String(d)}:${forceKey(spawner)}`);
  }
  return pairs.toSorted();
};

describe('mirrored spawner field invariants', () => {
  it('the spawner map is invariant under M', () => {
    for (const seed of SEEDS) {
      const config = { ...DEFAULT_MATCH_CONFIG, spawnerSeed: seed };
      const state = makeMatch(config);
      for (const vertex of state.spawners.keys()) {
        if (radiusOf(vertex) > config.R) continue;
        expect(state.spawners.has(reflectVertex(vertex))).toBe(true);
      }
    }
  });

  it('mirrored pairs carry equal force', () => {
    for (const seed of SEEDS) {
      const config = { ...DEFAULT_MATCH_CONFIG, spawnerSeed: seed };
      const state = makeMatch(config);
      for (const [vertex, spawner] of state.spawners) {
        const mirror = state.spawners.get(reflectVertex(vertex));
        expect(mirror?.force).toEqual(spawner.force);
      }
    }
  });

  it('an axis vertex uses itself as representative', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const state = makeMatch(config);
    const homes = new Set(
      homeCellsFor(2, config.homeOffset).map((h) => String(cellVertex(h.i, h.j, 'up'))),
    );
    const geometry = makeTiling();
    const win = geometry.window(geometry.seedPoint(), config.R + 1);
    for (const vertex of win.vertices) {
      const cell = vertexCell(vertex);
      if (cell.j !== 0 || radiusOf(vertex) > config.R) continue;
      if (homes.has(String(vertex))) continue;
      expect(state.spawners.has(vertex)).toBe(wouldKeepAt(cell, config.spawnerSeed, config.R));
    }
  });

  it('M is an involution and preserves parity', () => {
    const geometry = makeTiling();
    const win = geometry.window(geometry.seedPoint(), DEFAULT_MATCH_CONFIG.R + 1);
    for (const vertex of win.vertices) {
      const cell = vertexCell(vertex);
      expect(reflectCell(reflectCell({ i: cell.i, j: cell.j }))).toEqual({ i: cell.i, j: cell.j });
      expect(vertexCell(reflectVertex(vertex)).parity).toBe(cell.parity);
      expect(reflectVertex(reflectVertex(vertex))).toBe(vertex);
    }
  });

  it('makeMatch is a pure function of its config', () => {
    for (const seed of SEEDS) {
      const config = { ...DEFAULT_MATCH_CONFIG, spawnerSeed: seed };
      const a = makeMatch(config);
      const b = makeMatch(config);
      expect(keysOf(b.spawners)).toEqual(keysOf(a.spawners));
    }
  });

  it('two builds from the same seed agree, whatever the walk looks like', () => {
    const a = makeMatch();
    const b = makeMatch();
    expect(keysOf(b.spawners)).toEqual(keysOf(a.spawners));
  });

  it('every home vertex carries a spawner', () => {
    for (const seed of SEEDS) {
      const config = { ...DEFAULT_MATCH_CONFIG, spawnerSeed: seed };
      const state = makeMatch(config);
      for (const home of homeCellsFor(2, config.homeOffset)) {
        expect(state.spawners.has(cellVertex(home.i, home.j, 'up'))).toBe(true);
      }
    }
  });

  it('no spawner sits outside R', () => {
    for (const seed of SEEDS) {
      const config = { ...DEFAULT_MATCH_CONFIG, spawnerSeed: seed };
      const state = makeMatch(config);
      for (const vertex of state.spawners.keys()) {
        expect(radiusOf(vertex)).toBeLessThanOrEqual(config.R);
      }
    }
  });

  it('each force is forceAtRadius(r) and the tables are unchanged', () => {
    expect(forceAtRadius(0, 7)).toEqual({ num: 1, den: 3 });
    expect(forceAtRadius(2, 7)).toEqual({ num: 1, den: 9 });
    expect(forceAtRadius(4, 7)).toEqual({ num: 1, den: 12 });
    expect(densityAtRadius(1, 7)).toEqual({ num: 1, den: 2 });
    expect(densityAtRadius(7, 7)).toEqual({ num: 1, den: 12 });
    const state = makeMatch();
    for (const [vertex, spawner] of state.spawners) {
      const expected = forceAtRadius(radiusOf(vertex), DEFAULT_MATCH_CONFIG.R);
      expect(spawner.force).toEqual(rational(expected.num, expected.den));
    }
  });

  it('the two seats see equal (directed distance, force) multisets', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const homes = homeCellsFor(2, config.homeOffset);
    const a = homes[0];
    const b = homes[1];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    const state = makeMatch(config);
    expect(fieldPairsFrom(a, state.spawners, config.R)).toEqual(
      fieldPairsFrom(b, state.spawners, config.R),
    );
  });

  it('a closed directed walk has equal grain counts and length 3k', () => {
    const geometry = makeTiling();
    const origin = cellPoint(0, 0);
    const walks: readonly (readonly Direction[])[] = [
      [0, 1, 2],
      [0, 1, 2, 0, 1, 2],
    ];
    for (const steps of walks) {
      const counts: [number, number, number] = [0, 0, 0];
      let i = 0;
      let j = 0;
      let at = origin;
      for (const d of steps) {
        const step = OUT_DIRECTIONS[d];
        at = geometry.target(cellArrow(i, j, d));
        i += step.di;
        j += step.dj;
        counts[d] += 1;
      }
      expect(at).toBe(origin);
      expect(counts[0]).toBe(counts[1]);
      expect(counts[1]).toBe(counts[2]);
      expect(steps).toHaveLength(3 * counts[0]);
    }
  });

  it('a net displacement of k against the grain costs 2k steps', () => {
    const geometry = makeTiling();
    for (const k of [1, 2, 3]) {
      let i = 0;
      let j = 0;
      let at = cellPoint(0, 0);
      const se = OUT_DIRECTIONS[1];
      const sw = OUT_DIRECTIONS[2];
      for (let n = 0; n < k; n += 1) {
        at = geometry.target(cellArrow(i, j, 1));
        i += se.di;
        j += se.dj;
      }
      for (let n = 0; n < k; n += 1) {
        at = geometry.target(cellArrow(i, j, 2));
        i += sw.di;
        j += sw.dj;
      }
      expect(at).toBe(cellPoint(-k, 0));
      expect(i).toBe(-k);
      expect(j).toBe(0);
    }
  });

  it('a non-involution map is rejected loudly', () => {
    const cell: Cell = { i: 1, j: 1 };
    expect(() => { assertInvolution(reflectCell, cell); }).not.toThrow();
    expect(() => { assertInvolution(({ i, j }) => ({ i, j: j + 1 }), cell); }).toThrow(ContractViolation);
  });
});
