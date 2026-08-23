/**
 * Match setup for the generated tiling — hexagon homes, radial spawners, PoC
 * defaults (P09 / §7 / §8).
 *
 * Lives here rather than in rules-core because placement needs lattice
 * coordinates; the core must not import them.
 */

import {
  ContractViolation,
  DEFAULT_MATCH_CONFIG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  densityAtRadius,
  forceAtRadius,
  mintPlayerId,
  rational,
} from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  Group,
  MatchConfig,
  PlayerId,
  Spawner,
  VertexId,
} from '@conquarrow/contracts';
import {
  cellArrow,
  cellPoint,
  cellVertex,
  pointCell,
  vertexBorders,
  vertexCell,
} from './cells';
import type { Cell, VertexCell } from './cells';
import { makeTiling } from './tiling';

/** Grain-preserving reflection `(i,j) ↦ (i+j, −j)` (§2). Homes and thinning both use it. */
export const reflectCell = ({ i, j }: Cell): Cell => ({ i: i + j, j: -j });

/**
 * Loud check that `map` is an involution at `cell` (P41, EARS 13).
 *
 * @throws ContractViolation iff `map(map(cell))` is not `cell`.
 */
export const assertInvolution = (map: (cell: Cell) => Cell, cell: Cell): void => {
  const twice = map(map(cell));
  if (twice.i !== cell.i || twice.j !== cell.j) {
    throw new ContractViolation(
      `map is not an involution at (${String(cell.i)},${String(cell.j)})`,
    );
  }
};

const compareIds = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

/**
 * The orbit representative of a vertex cell under grain-preserving reflection M
 * `(i,j) ↦ (i+j, −j)` with **parity kept**. Thinning is sampled here so a
 * vertex and its mirror always keep-or-drop together (P41).
 *
 * Total id order, not sign of `j`: `rep(v)` is whichever of `v` and `M(v)`
 * sorts first. On the axis `M(v) = v`, so the representative is itself.
 */
const orbitRepresentative = (cell: VertexCell): VertexCell => {
  const mirroredCell: VertexCell = { ...reflectCell(cell), parity: cell.parity };
  const vertex = cellVertex(cell.i, cell.j, cell.parity);
  const mirroredVertex = cellVertex(mirroredCell.i, mirroredCell.j, mirroredCell.parity);
  return compareIds(String(vertex), String(mirroredVertex)) <= 0 ? cell : mirroredCell;
};

/** Cube/hex distance on the triangular lattice from the origin. */
const cellDistance = ({ i, j }: Cell): number => {
  const k = -i - j;
  return (Math.abs(i) + Math.abs(j) + Math.abs(k)) / 2;
};

/**
 * The six corners of a hexagon at cube distance *D* from the origin, in
 * counter-clockwise order starting east.
 */
export const hexCorners = (D: number): readonly Cell[] => {
  const d = Math.max(1, Math.trunc(D));
  return [
    { i: d, j: 0 },
    { i: 0, j: d },
    { i: -d, j: d },
    { i: -d, j: 0 },
    { i: 0, j: -d },
    { i: d, j: -d },
  ];
};

const ROOT3_OVER_2 = Math.sqrt(3) / 2;

/** Nearest lattice cell to a world point (basis u=(1,0), v=(½,√3/2)). */
const nearestCell = (x: number, y: number): Cell => {
  const j = Math.round(y / ROOT3_OVER_2);
  const i = Math.round(x - j / 2);
  return { i, j };
};

/**
 * Equal angular span on a circle of Euclidean radius ≈ *D*, snapped to the
 * lattice. Used when player count is not 2/3/4/6.
 */
const equalSpanHomes = (n: number, D: number): Cell[] => {
  const out: Cell[] = [];
  const seen = new Set<string>();
  for (let k = 0; k < n; k += 1) {
    const theta = (2 * Math.PI * k) / n;
    let cell = nearestCell(D * Math.cos(theta), D * Math.sin(theta));
    // Prefer exact distance *D* when the snap landed inside — project on cube axes.
    const dist = cellDistance(cell);
    if (dist > 0 && dist !== D) {
      const scale = D / dist;
      cell = {
        i: Math.round(cell.i * scale),
        j: Math.round(cell.j * scale),
      };
    }
    let key = `${String(cell.i)},${String(cell.j)}`;
    // Collision: walk around the ring until free.
    let guard = 0;
    while (seen.has(key) && guard < 36) {
      cell = { i: cell.i + (guard % 2 === 0 ? 1 : 0), j: cell.j + (guard % 2 === 1 ? 1 : -1) };
      key = `${String(cell.i)},${String(cell.j)}`;
      guard += 1;
    }
    seen.add(key);
    out.push(cell);
  }
  return out;
};

/**
 * Home cells for *n* players at hexagon radius *D*.
 *
 * | n | placement |
 * |---|---|
 * | 2 | reflected corner pair (grain-preserving; §2 / §8) |
 * | 3 | every alternating corner |
 * | 4 | four corners; one opposite pair left free |
 * | 6 | all six corners |
 * | else | equal angular span (best-effort) |
 *
 * Two-player must **not** use opposite corners: `(i,j) ↦ (−i,−j)` reverses the
 * grain, so one seat would face a board running backwards. Corners 1 and 5 are
 * mirrors under `(i,j) ↦ (i+j, −j)`. After layout's 90° turn that pair sits
 * left and right of centre with matching orientation toward the middle.
 */
export const homeCellsFor = (n: number, D: number): readonly Cell[] => {
  const corners = hexCorners(D);
  const at = (index: number): Cell => {
    const cell = corners[index];
    if (cell === undefined) throw new Error(`hex corner ${String(index)} missing`);
    return cell;
  };
  if (n === 2) {
    const home = at(1);
    return [home, reflectCell(home)];
  }
  if (n === 3) return [at(0), at(2), at(4)];
  if (n === 4) return [at(0), at(1), at(3), at(4)];
  if (n === 6) return corners;
  return equalSpanHomes(n, D);
};

const PLAYER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export const mintPlayers = (count: number): readonly PlayerId[] => {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.trunc(count)));
  return PLAYER_LABELS.slice(0, n).map((label) => mintPlayerId(label));
};

const orderedBordersOf = (vertex: VertexId): readonly ArrowId[] =>
  vertexBorders(vertexCell(vertex))
    .map((c) => cellArrow(c.i, c.j, c.d))
    .toSorted((a, b) => compareIds(String(a), String(b)));

const garrison = (owner: PlayerId, arrow: ArrowId): readonly [ArrowId, Group] => [
  arrow,
  { owner, heads: 3, spent: 0 },
];

const placeHomes = (
  players: readonly PlayerId[],
  homes: readonly Cell[],
): {
  readonly territory: Map<ArrowId, PlayerId>;
  readonly groups: Map<ArrowId, Group>;
  readonly homeVertices: VertexId[];
} => {
  const territory = new Map<ArrowId, PlayerId>();
  const groups = new Map<ArrowId, Group>();
  const homeVertices: VertexId[] = [];
  for (let i = 0; i < players.length; i += 1) {
    const player = players[i];
    const home = homes[i];
    if (player === undefined || home === undefined) {
      throw new Error('setup: missing player or home');
    }
    const vertex = cellVertex(home.i, home.j, 'up');
    homeVertices.push(vertex);
    const borders = orderedBordersOf(vertex);
    const tip = borders[0];
    if (tip === undefined) throw new Error('setup: home pinwheel has no border arrows');
    for (const arrow of borders) territory.set(arrow, player);
    groups.set(tip, garrison(player, tip)[1]);
  }
  return { territory, groups, homeVertices };
};

const forceOn = (r: number, R: number): Spawner => {
  const { num, den } = forceAtRadius(r, R);
  return { force: rational(num, den), phase: 0 };
};

/**
 * Thin inside *R*, sampling at the orbit representative so *v* and *M(v)*
 * keep or drop together. Home vertices are then forced on, thinning or not.
 */
const placeSpawners = (
  vertices: readonly VertexId[],
  homeVertices: readonly VertexId[],
  homes: readonly Cell[],
  config: MatchConfig,
): Map<VertexId, Spawner> => {
  // Origin, axis, and two off-axis cells: a map that is an involution at only
  // one of them still fails the spec's "fail loudly" guard (EARS 13).
  for (const cell of [
    { i: 0, j: 0 },
    { i: 2, j: 0 },
    { i: 1, j: 1 },
    { i: 0, j: 3 },
  ] as const) {
    assertInvolution(reflectCell, cell);
  }
  const spawners = new Map<VertexId, Spawner>();
  for (const vertex of vertices) {
    const cell = vertexCell(vertex);
    const r = Math.round(cellDistance(cell));
    if (r > config.R) continue;
    const density = densityAtRadius(r, config.R);
    // Exact rational comparison rather than a float ratio: `sample * den < num`.
    if (thinningSample(orbitRepresentative(cell), config.spawnerSeed) * density.den >= density.num) {
      continue;
    }
    spawners.set(vertex, forceOn(r, config.R));
  }
  for (let i = 0; i < homeVertices.length; i += 1) {
    const vertex = homeVertices[i];
    const home = homes[i];
    if (vertex === undefined || home === undefined) continue;
    const r = Math.min(config.R, Math.round(cellDistance(home)));
    spawners.set(vertex, forceOn(r, config.R));
  }
  return spawners;
};

/**
 * A vertex's place in `[0, 1)` — the deterministic thinning sample.
 *
 * §7 allows spawner density below 1 but constrains *how*: it "must be a **pure function
 * of the vertex and a setup seed**, never a draw from an RNG, or it takes determinism
 * (ADR 0001) with it." So this is an integer avalanche over the vertex's own lattice
 * coordinates. Two calls on the same vertex agree forever; two vertices one cell apart
 * do not, which is what makes the surviving spawners cluster irregularly instead of
 * landing on a sublattice — the *deterministic irregularity* §7 asks for, arrived at
 * without authoring a single per-vertex datum.
 */
export const thinningSample = ({ i, j, parity }: VertexCell, seed: number): number => {
  let h = Math.imul(Math.trunc(seed) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ Math.trunc(i), 0xc2b2ae35);
  h = Math.imul(h ^ Math.trunc(j), 0x27d4eb2f);
  h = Math.imul(h ^ (parity === 'up' ? 0x165667b1 : 0x9e3779b1), 0x85ebca77);
  h ^= h >>> 15;
  return (h >>> 0) / 0x1_0000_0000;
};

/**
 * Build the opening position on the generated tiling.
 *
 * - Homes on a hexagon of radius `homeOffset` (see {@link homeCellsFor}).
 * - Each home: 3-arrow pinwheel + 3-stack (§8).
 * - Spawners inside graph distance *R*, thinned and paced by the radial bands
 *   (`SPAWNER_BANDS`) — full density and 1/3 at the centre, an eighth and 1/12 at
 *   the rim. Which vertices survive the thinning is {@link thinningSample} at
 *   the reflection-orbit representative (parity kept), so the field is invariant
 *   under M.
 *
 * **A home vertex always carries one, thinning or not.** A seat that opened with no
 * income at all is not a harder start, it is a different game, and the thinning is a
 * density target rather than a rule — nothing downstream may read the count (§7,
 * *placement and force are setup data*).
 */
export const makeMatch = (config: MatchConfig = DEFAULT_MATCH_CONFIG): GameState => {
  const geometry = makeTiling();
  const players = mintPlayers(config.playerCount);
  const homes = homeCellsFor(players.length, config.homeOffset);
  if (homes.length !== players.length) {
    throw new Error('setup: home count does not match player count');
  }

  const { territory, groups, homeVertices } = placeHomes(players, homes);
  const win = geometry.window(geometry.seedPoint(), config.R + 1);
  const spawners = placeSpawners(
    [...win.vertices].toSorted((a, b) => compareIds(String(a), String(b))),
    homeVertices,
    homes,
    config,
  );

  const first = players[0];
  if (first === undefined) throw new Error('setup: no players');

  return {
    players,
    activePlayer: first,
    groups,
    trails: new Map(),
    territory,
    accumulators: new Map(),
    spawners,
    starvationStreaks: new Map(),
    dominationN: config.dominationN,
    winner: undefined,
  };
};

/** Re-export for callers that only need the reflection helpers. */
export { cellPoint, pointCell };
