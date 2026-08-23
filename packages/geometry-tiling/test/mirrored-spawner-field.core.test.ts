/**
 * docs/spec/mirrored-spawner-field/mirrored-spawner-field.core.feature
 * — one test per scenario.
 *
 * Directed distance (scenario 4) is BFS on `makeTiling()` following out-arrows
 * only, from the home cell's lattice point to the spawner vertex cell's lattice
 * point. That is the grain-directed graph distance those two points see; it is
 * not cube/hex distance.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_CONFIG,
  densityAtRadius,
  forceAtRadius,
  rational,
} from '@conquarrow/contracts';
import type { PointId, Spawner, VertexId } from '@conquarrow/contracts';
import { homeCellsFor, makeMatch, makeTiling, reflectCell } from '../src/index';
import { thinningSample } from '../src/setup';
import { cellPoint, cellVertex, vertexCell } from '../src/cells';
import type { Cell } from '../src/cells';

type Tiling = ReturnType<typeof makeTiling>;

const radiusOf = (vertex: VertexId): number => {
  const { i, j } = vertexCell(vertex);
  return Math.round((Math.abs(i) + Math.abs(j) + Math.abs(-i - j)) / 2);
};

const reflectVertex = (vertex: VertexId): VertexId => {
  const { i, j, parity } = vertexCell(vertex);
  const mirrored = reflectCell({ i, j });
  return cellVertex(mirrored.i, mirrored.j, parity);
};

const homeVertexOf = (home: Cell): VertexId => cellVertex(home.i, home.j, 'up');

const wouldThin = (cell: Cell & { parity: 'up' | 'down' }, seed: number, R: number): boolean => {
  const r = Math.round((Math.abs(cell.i) + Math.abs(cell.j) + Math.abs(-cell.i - cell.j)) / 2);
  if (r > R) return true;
  const density = densityAtRadius(r, R);
  return thinningSample({ i: cell.i, j: cell.j, parity: cell.parity }, seed) * density.den >= density.num;
};

const forceKey = (spawner: Spawner): string =>
  `${String(spawner.force.num)}/${String(spawner.force.den)}`;

/** Grain-following BFS distances from `start`, capped so the unbounded board stays finite. */
const directedDistancesFrom = (
  geometry: Tiling,
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
  const maxSteps = 4 * (R + DEFAULT_MATCH_CONFIG.homeOffset);
  const dist = directedDistancesFrom(geometry, cellPoint(home.i, home.j), maxSteps);
  const pairs: string[] = [];
  for (const [vertex, spawner] of spawners) {
    if (radiusOf(vertex) > R) continue;
    const { i, j } = vertexCell(vertex);
    const d = dist.get(String(cellPoint(i, j)));
    if (d === undefined) {
      throw new Error(`no directed path from home (${String(home.i)},${String(home.j)}) to ${String(vertex)}`);
    }
    pairs.push(`${String(d)}:${forceKey(spawner)}`);
  }
  return pairs.toSorted();
};

describe('the spawner field is mirrored', () => {
  it('a spawner and its mirror both exist', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const state = makeMatch(config);
    for (const vertex of state.spawners.keys()) {
      if (radiusOf(vertex) > config.R) continue;
      expect(state.spawners.has(reflectVertex(vertex))).toBe(true);
    }
  });

  it('mirrored spawners carry the same force', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const state = makeMatch(config);
    for (const [vertex, spawner] of state.spawners) {
      const r = radiusOf(vertex);
      const expected = forceAtRadius(r, config.R);
      expect(spawner.force).toEqual(rational(expected.num, expected.den));
      const mirror = state.spawners.get(reflectVertex(vertex));
      expect(mirror).toBeDefined();
      expect(mirror?.force).toEqual(spawner.force);
    }
  });

  it('a vertex on the axis is its own representative', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const state = makeMatch(config);
    const homes = new Set(homeCellsFor(2, config.homeOffset).map((h) => String(homeVertexOf(h))));
    const geometry = makeTiling();
    const win = geometry.window(geometry.seedPoint(), config.R + 1);
    let axisVertices = 0;
    for (const vertex of win.vertices) {
      const cell = vertexCell(vertex);
      if (cell.j !== 0) continue;
      const mirrored = reflectCell({ i: cell.i, j: cell.j });
      // `j === 0` is true for both +0 and -0; toEqual is not (IEEE −0).
      expect(mirrored.i).toBe(cell.i);
      expect(mirrored.j === 0).toBe(true);
      const r = radiusOf(vertex);
      if (r > config.R) continue;
      if (homes.has(String(vertex))) continue;
      axisVertices += 1;
      const kept = !wouldThin(cell, config.spawnerSeed, config.R);
      expect(state.spawners.has(vertex)).toBe(kept);
    }
    expect(axisVertices).toBeGreaterThan(0);
  });

  it('the two seats face equal fields', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const homes = homeCellsFor(2, config.homeOffset);
    const a = homes[0];
    const b = homes[1];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (a === undefined || b === undefined) return;
    expect(b).toEqual(reflectCell(a));

    const state = makeMatch(config);
    expect(fieldPairsFrom(a, state.spawners, config.R)).toEqual(
      fieldPairsFrom(b, state.spawners, config.R),
    );
  });

  it('home vertices still carry a spawner regardless of thinning', () => {
    const R = DEFAULT_MATCH_CONFIG.R;
    const D = DEFAULT_MATCH_CONFIG.homeOffset;
    const homes = homeCellsFor(2, D);
    let seed = DEFAULT_MATCH_CONFIG.spawnerSeed;
    let skipped = false;
    for (let s = 1; s <= 200 && !skipped; s += 1) {
      skipped = homes.some((home) => wouldThin({ ...home, parity: 'up' }, s, R));
      if (skipped) seed = s;
    }
    expect(skipped).toBe(true);

    const state = makeMatch({ ...DEFAULT_MATCH_CONFIG, spawnerSeed: seed });
    for (const home of homes) {
      expect(state.spawners.has(homeVertexOf(home))).toBe(true);
    }
    const first = homes[0];
    const second = homes[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(homeVertexOf(second)).toBe(reflectVertex(homeVertexOf(first)));
  });

  it('the radius cutoff is unchanged', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const state = makeMatch(config);
    for (const vertex of state.spawners.keys()) {
      expect(radiusOf(vertex)).toBeLessThanOrEqual(config.R);
    }
  });

  it('setup is a pure function of its config', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const a = makeMatch(config);
    const b = makeMatch(config);
    const keysA = [...a.spawners.keys()].map(String).toSorted();
    const keysB = [...b.spawners.keys()].map(String).toSorted();
    expect(keysB).toEqual(keysA);
    for (const vertex of a.spawners.keys()) {
      expect(b.spawners.get(vertex)?.force).toEqual(a.spawners.get(vertex)?.force);
    }
  });
});
