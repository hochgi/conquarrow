/**
 * Close-value arithmetic for the local heuristic (P54 / P55). Adapter only — not a
 * game rule. {@link exposure} is trail damage under the worst enemy reply.
 *
 * Pure: no clocks, no RNG, no I/O.
 */

import { speed } from '@conquarrow/contracts';
import type { ArrowId, GameState, GeometryPort, PlayerId, RulesPort } from '@conquarrow/contracts';
import { evaluate, homewardPath } from './botEvaluate';
import { exposureForBot } from './botReply';

export const SHARE_VALUE_S = 100;
export const ARROW_VALUE_A = 25;

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

export const exposure = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  distCap?: number,
): number =>
  exposureForBot(
    geometry,
    rules,
    state,
    me,
    distCap,
    (s) => evaluate(geometry, s, me, rules),
  );

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
