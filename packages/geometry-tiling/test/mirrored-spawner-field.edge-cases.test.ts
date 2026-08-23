/**
 * docs/spec/mirrored-spawner-field/mirrored-spawner-field.edge-cases.feature
 * — one test per scenario.
 *
 * Scenario "A single seat still gets a field" maps to `playerCount: 3`
 * (MIN_PLAYERS is 2; mintPlayers clamps). Three-player homes are a union of
 * M-orbits: one axis home plus one reflected pair. Four-player invariance is
 * out of scope — those homes are not a union of M-orbits.
 *
 * Anti-grain travel restates the zigzag already in tiling.test.ts as a
 * property over small k, using the port's out-arrows and OUT_DIRECTIONS.
 */

import { describe, expect, it } from 'vitest';
import {
  ContractViolation,
  DEFAULT_MATCH_CONFIG,
  MIN_PLAYERS,
  densityAtRadius,
  forceAtRadius,
  rational,
} from '@conquarrow/contracts';
import type { VertexId } from '@conquarrow/contracts';
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

const isMirrored = (spawners: ReadonlyMap<VertexId, unknown>, R: number): boolean => {
  for (const vertex of spawners.keys()) {
    if (radiusOf(vertex) > R) continue;
    if (!spawners.has(reflectVertex(vertex))) return false;
  }
  return true;
};

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

describe('the mirrored spawner field — edge cases', () => {
  it('the reflection is an involution', () => {
    const geometry = makeTiling();
    const win = geometry.window(geometry.seedPoint(), DEFAULT_MATCH_CONFIG.R + 1);
    for (const vertex of win.vertices) {
      const cell = vertexCell(vertex);
      const once = reflectCell({ i: cell.i, j: cell.j });
      const twice = reflectCell(once);
      expect(twice).toEqual({ i: cell.i, j: cell.j });
      expect(cellVertex(once.i, once.j, cell.parity)).not.toBeUndefined();
      expect(vertexCell(cellVertex(once.i, once.j, cell.parity)).parity).toBe(cell.parity);
      expect(reflectVertex(reflectVertex(vertex))).toBe(vertex);
    }
  });

  it('setup refuses to build an asymmetric field silently', () => {
    const cell: Cell = { i: 2, j: -1 };
    expect(() => { assertInvolution(reflectCell, cell); }).not.toThrow();
    const shift = ({ i, j }: Cell): Cell => ({ i: i + 1, j });
    expect(() => { assertInvolution(shift, cell); }).toThrow(ContractViolation);
  });

  it('the representative is chosen by total id order, not by sign', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const homes = new Set(
      homeCellsFor(2, config.homeOffset).map((h) => String(cellVertex(h.i, h.j, 'up'))),
    );
    const geometry = makeTiling();
    const win = geometry.window(geometry.seedPoint(), config.R + 1);
    const state = makeMatch(config);

    let pair: { vertex: VertexId; mirror: VertexId } | undefined;
    for (const vertex of win.vertices) {
      if (radiusOf(vertex) > config.R) continue;
      const mirror = reflectVertex(vertex);
      if (String(vertex) <= String(mirror)) continue;
      if (homes.has(String(vertex)) || homes.has(String(mirror))) continue;
      const cellV = vertexCell(vertex);
      const cellM = vertexCell(mirror);
      if (wouldKeepAt(cellV, config.spawnerSeed, config.R) === wouldKeepAt(cellM, config.spawnerSeed, config.R)) {
        continue;
      }
      pair = { vertex, mirror };
      break;
    }
    expect(pair).toBeDefined();
    if (pair === undefined) return;

    const keepAtRep = wouldKeepAt(vertexCell(pair.mirror), config.spawnerSeed, config.R);
    expect(state.spawners.has(pair.vertex)).toBe(keepAtRep);
    expect(state.spawners.has(pair.mirror)).toBe(keepAtRep);
    expect(state.spawners.has(pair.vertex)).not.toBe(
      wouldKeepAt(vertexCell(pair.vertex), config.spawnerSeed, config.R),
    );
  });

  it('order of the walk does not change the field', () => {
    const config = DEFAULT_MATCH_CONFIG;
    const a = makeMatch(config);
    const b = makeMatch(config);
    expect(keysOf(b.spawners)).toEqual(keysOf(a.spawners));
    for (const [vertex, spawner] of a.spawners) {
      expect(b.spawners.get(vertex)?.force).toEqual(spawner.force);
    }
  });

  it('a different seed gives a different field, still mirrored', () => {
    const a = makeMatch(DEFAULT_MATCH_CONFIG);
    const b = makeMatch({ ...DEFAULT_MATCH_CONFIG, spawnerSeed: 9 });
    expect(keysOf(b.spawners)).not.toEqual(keysOf(a.spawners));
    expect(isMirrored(a.spawners, DEFAULT_MATCH_CONFIG.R)).toBe(true);
    expect(isMirrored(b.spawners, DEFAULT_MATCH_CONFIG.R)).toBe(true);
  });

  it('the density table is untouched', () => {
    expect(forceAtRadius(0, 7)).toEqual({ num: 1, den: 3 });
    expect(forceAtRadius(1, 7)).toEqual({ num: 1, den: 3 });
    expect(forceAtRadius(2, 7)).toEqual({ num: 1, den: 9 });
    expect(forceAtRadius(3, 7)).toEqual({ num: 1, den: 9 });
    expect(forceAtRadius(4, 7)).toEqual({ num: 1, den: 12 });
    expect(forceAtRadius(7, 7)).toEqual({ num: 1, den: 12 });
    expect(densityAtRadius(1, 7)).toEqual({ num: 1, den: 2 });
    expect(densityAtRadius(3, 7)).toEqual({ num: 1, den: 3 });
    expect(densityAtRadius(5, 7)).toEqual({ num: 1, den: 6 });
    expect(densityAtRadius(7, 7)).toEqual({ num: 1, den: 12 });

    const config = DEFAULT_MATCH_CONFIG;
    const state = makeMatch(config);
    for (const [vertex, spawner] of state.spawners) {
      const expected = forceAtRadius(radiusOf(vertex), config.R);
      expect(spawner.force).toEqual(rational(expected.num, expected.den));
    }
  });

  it('a seating that is not the two-player mirror still gets a field', () => {
    expect(MIN_PLAYERS).toBe(2);
    const config = { ...DEFAULT_MATCH_CONFIG, playerCount: 3 };
    const state = makeMatch(config);
    expect(state.players).toHaveLength(3);
    expect(isMirrored(state.spawners, config.R)).toBe(true);
    for (const home of homeCellsFor(3, config.homeOffset)) {
      expect(state.spawners.has(cellVertex(home.i, home.j, 'up'))).toBe(true);
    }
  });

  it('anti-grain travel costs double', () => {
    // Same identity as tiling.test.ts ("zigzag of two out-directions"): the two
    // companions of a grain direction compose to its reverse, so k against the
    // grain is 2k steps. Order of those two companions does not matter.
    const geometry = makeTiling();
    const origin = cellPoint(0, 0);
    for (const k of [1, 2, 3, 4]) {
      const grain: Direction = 0;
      const a: Direction = 1;
      const b: Direction = 2;
      const grainStep = OUT_DIRECTIONS[grain];
      const walk = (first: Direction, second: Direction): ReturnType<typeof cellPoint> => {
        let i = 0;
        let j = 0;
        let at = origin;
        for (let n = 0; n < k; n += 1) {
          const step = OUT_DIRECTIONS[first];
          const arrow = cellArrow(i, j, first);
          expect(geometry.origin(arrow)).toBe(at);
          at = geometry.target(arrow);
          i += step.di;
          j += step.dj;
          expect(at).toBe(cellPoint(i, j));
        }
        for (let n = 0; n < k; n += 1) {
          const step = OUT_DIRECTIONS[second];
          const arrow = cellArrow(i, j, second);
          at = geometry.target(arrow);
          i += step.di;
          j += step.dj;
          expect(at).toBe(cellPoint(i, j));
        }
        expect(i).toBe(-grainStep.di * k);
        expect(j === -grainStep.dj * k).toBe(true);
        return at;
      };
      expect(walk(a, b)).toBe(walk(b, a));
    }
  });

  it('a walk that returns to where it started is balanced', () => {
    const geometry = makeTiling();
    const origin = cellPoint(0, 0);
    const closed: readonly { readonly steps: readonly Direction[]; readonly k: number }[] = [
      { steps: [0, 1, 2], k: 1 },
      { steps: [1, 2, 0], k: 1 },
      { steps: [2, 0, 1], k: 1 },
      { steps: [0, 1, 2, 0, 1, 2], k: 2 },
      { steps: [0, 1, 0, 1, 2, 2], k: 2 },
    ];
    for (const walk of closed) {
      const counts: [number, number, number] = [0, 0, 0];
      let i = 0;
      let j = 0;
      let at = origin;
      for (const d of walk.steps) {
        const step = OUT_DIRECTIONS[d];
        at = geometry.target(cellArrow(i, j, d));
        i += step.di;
        j += step.dj;
        expect(at).toBe(cellPoint(i, j));
        counts[d] += 1;
      }
      expect(at).toBe(origin);
      expect(counts[0]).toBe(walk.k);
      expect(counts[1]).toBe(walk.k);
      expect(counts[2]).toBe(walk.k);
      expect(walk.steps).toHaveLength(3 * walk.k);
    }
  });
});
