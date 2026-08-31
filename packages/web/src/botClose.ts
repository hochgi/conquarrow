/**
 * Close-value arithmetic for the local heuristic (P54). Adapter only — not a
 * game rule. P55 replaces {@link exposure}; {@link survival} stays.
 *
 * Pure: no clocks, no RNG, no I/O.
 */

import { speed } from '@conquarrow/contracts';
import type { ArrowId, GameState, GeometryPort, PlayerId } from '@conquarrow/contracts';
import { grainDistance, homewardPath } from './botEvaluate';

export const SHARE_VALUE_S = 100;
export const ARROW_VALUE_A = 25;

/** Same default as findings `DEFAULT_FINDINGS_CAPS.distCap` — not imported (cycle). */
const DEFAULT_EXPOSURE_CAP = 12;

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export type CloseCandidate = {
  readonly shares: number;
  readonly arrows: number;
  readonly turnsToClose: number;
  readonly exposure: number;
  readonly goal?: string;
};

export const shareTerm = (shares: number): number =>
  (SHARE_VALUE_S * shares * (shares + 1)) / 2;

export const loot = (shares: number, arrows: number): number =>
  shareTerm(shares) + arrows * ARROW_VALUE_A;

export const turnsToClose = (grainDist: number, heads: number): number =>
  Math.max(1, Math.ceil(grainDist / speed(heads)));

export const survival = (exposure: number, turnsToClose: number): number =>
  (1 + exposure) ** -Math.max(0, turnsToClose - 1);

export const closeValue = (
  shares: number,
  arrows: number,
  turnsToClose: number,
  exposure: number,
): number => {
  const T = Math.max(1, turnsToClose);
  return (loot(shares, arrows) / T) * survival(exposure, T);
};

const bordersSpawner = (
  geometry: GeometryPort,
  state: GameState,
  arrow: ArrowId,
): boolean => geometry.flankVertices(arrow).some((vertex) => state.spawners.has(vertex));

const minGrainToTrail = (
  geometry: GeometryPort,
  trailArrows: readonly ArrowId[],
  start: ArrowId,
  cap: number,
): number => {
  let best = cap + 1;
  for (const arrow of trailArrows) {
    const d = grainDistance(geometry, start, arrow, cap);
    if (d < best) best = d;
  }
  return best;
};

export const exposure = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  distCap?: number,
): number => {
  const cap = distCap ?? DEFAULT_EXPOSURE_CAP;
  const trail = state.trails.get(me);
  if (trail === undefined || trail.size === 0) return 0;
  const trailLen = trail.size;
  const trailArrows = [...trail].toSorted((a, b) => compareIds(String(a), String(b)));
  const enemies = [...state.groups.entries()]
    .filter(([, group]) => group.owner !== me)
    .map(([arrow]) => arrow)
    .toSorted((a, b) => compareIds(String(a), String(b)));
  let sumProximity = 0;
  for (const enemyArrow of enemies) {
    const d = minGrainToTrail(geometry, trailArrows, enemyArrow, cap);
    sumProximity += Math.max(0, cap + 1 - d);
  }
  return (trailLen * sumProximity) / cap;
};

export const estimateCloseLoot = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  tip: ArrowId,
): { readonly shares: number; readonly arrows: number } => {
  const claimed = new Set<ArrowId>();
  const trail = state.trails.get(me);
  if (trail !== undefined) {
    for (const arrow of trail) {
      if (state.territory.get(arrow) !== me) claimed.add(arrow);
    }
  }
  const home = homewardPath(geometry, state, me, tip);
  for (const arrow of home.path) claimed.add(arrow);
  if (state.territory.get(tip) !== me) claimed.add(tip);
  let shares = 0;
  for (const arrow of claimed) {
    if (bordersSpawner(geometry, state, arrow)) shares += 1;
  }
  return { shares, arrows: claimed.size };
};

export const preferClose = (a: CloseCandidate, b: CloseCandidate): number => {
  const va = closeValue(a.shares, a.arrows, a.turnsToClose, a.exposure);
  const vb = closeValue(b.shares, b.arrows, b.turnsToClose, b.exposure);
  if (va !== vb) return vb - va;
  if (a.turnsToClose !== b.turnsToClose) return a.turnsToClose - b.turnsToClose;
  if (a.arrows !== b.arrows) return b.arrows - a.arrows;
  if (a.shares !== b.shares) return b.shares - a.shares;
  return compareIds(a.goal ?? '', b.goal ?? '');
};
