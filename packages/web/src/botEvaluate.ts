/**
 * Heuristic evaluate + mobility (P53). Adapter only — not a game rule.
 *
 * Lives here so search can score terminals without importing `evaluate` from
 * `opponent`. That import would cycle through evaluate once `playBotTurn`
 * calls `chooseTurnBeam`. A remaining cycle (`botSearch` → `chooseMove` in
 * `opponent`) is greedy-only and ESM-stable.
 * Search talks to the engine only through `RulesPort`.
 */

import { speed } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  PlayerId,
  RulesPort,
} from '@conquarrow/contracts';

export const MOBILITY_SCALE = 16;

const DIST_CAP = 16;

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const headsOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const group of state.groups.values()) if (group.owner === player) n += group.heads;
  return n;
};

const territoryOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === player) n += 1;
  return n;
};

const trailOf = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

const sharesOf = (
  geometry: GeometryPort,
  state: GameState,
  player: PlayerId,
): number => {
  let n = 0;
  const vertices = [...state.spawners.keys()].toSorted((a, b) =>
    compareIds(String(a), String(b)),
  );
  for (const vertex of vertices) {
    for (const arrow of [...geometry.borderArrows(vertex)].toSorted((a, b) =>
      compareIds(String(a), String(b)),
    )) {
      if (state.territory.get(arrow) === player) n += 1;
    }
  }
  return n;
};

/** Rises with trail length — bias toward returning / claiming, not toward passing. */
export const closeUrgency = (trailLen: number): number => {
  if (trailLen <= 2) return 0;
  return Math.min(100, (trailLen - 2) * 12);
};

export type HomewardPath = {
  readonly distance: number;
  readonly landing: ArrowId | undefined;
  readonly path: readonly ArrowId[];
};

const reconstructHomeward = (
  cameFrom: ReadonlyMap<string, ArrowId>,
  start: ArrowId,
  last: ArrowId,
): ArrowId[] => {
  const rev: ArrowId[] = [last];
  let cur = last;
  while (cur !== start) {
    const prev = cameFrom.get(String(cur));
    if (prev === undefined) break;
    rev.push(prev);
    cur = prev;
  }
  return rev.toReversed();
};

/**
 * Grain BFS from `start` to the first own-territory arrow.
 * `path` is start through the predecessor (excludes the landing).
 * {@link distanceToTerritory} is this search's distance.
 */
export const homewardPath = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  start: ArrowId,
  cap = DIST_CAP,
): HomewardPath => {
  if (state.territory.get(start) === me) {
    return { distance: 0, landing: start, path: [] };
  }
  const seen = new Set<string>([String(start)]);
  const cameFrom = new Map<string, ArrowId>();
  let frontier: ArrowId[] = [start];
  for (let d = 1; d <= cap; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const exit of geometry.outArrows(geometry.target(arrow))) {
        const key = String(exit);
        if (seen.has(key)) continue;
        if (state.territory.get(exit) === me) {
          return {
            distance: d,
            landing: exit,
            path: reconstructHomeward(cameFrom, start, arrow),
          };
        }
        seen.add(key);
        cameFrom.set(key, arrow);
        next.push(exit);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return { distance: cap + 1, landing: undefined, path: [start] };
};

/**
 * Shortest path length along out-arrows to an arrow of `me`'s territory.
 * Movement must follow the grain, so this is the real "how far to a close".
 */
export const distanceToTerritory = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  start: ArrowId,
  cap = DIST_CAP,
): number => homewardPath(geometry, state, me, start, cap).distance;

/** Grain BFS distance from start to goal (out-arrows only). */
export const grainDistance = (
  geometry: GeometryPort,
  start: ArrowId,
  goal: ArrowId,
  cap: number,
): number => {
  if (start === goal) return 0;
  const seen = new Set<string>([String(start)]);
  let frontier: ArrowId[] = [start];
  for (let d = 1; d <= cap; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const exit of geometry.outArrows(geometry.target(arrow))) {
        const key = String(exit);
        if (seen.has(key)) continue;
        if (exit === goal) return d;
        seen.add(key);
        next.push(exit);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return cap + 1;
};

const stackShapeScore = (state: GameState, me: PlayerId, rules: RulesPort): number => {
  let score = 0;
  const steppable = new Set<ArrowId>();
  for (const m of rules.legalMoves(state)) {
    if (m.kind === 'step') steppable.add(m.from);
  }
  for (const [arrow, group] of state.groups) {
    if (group.owner !== me) continue;
    if (group.heads === 2) score += 45;
    else if (group.heads === 1) {
      score -= 18;
      const canAct = group.spent < speed(1) && steppable.has(arrow);
      const onTrail = state.trails.get(me)?.has(arrow) ?? false;
      if (!canAct && onTrail) score -= 90;
      else if (onTrail) score -= 35;
    } else if (group.heads === 3) score += 6;
    else if (group.heads >= 4) score += 18;
  }
  return score;
};

const seated = (state: GameState, owner: PlayerId): GameState =>
  state.activePlayer === owner ? state : { ...state, activePlayer: owner };

/**
 * Distinct legal step exits from each occupied arrow, as if that group's owner
 * were to move. `legalMoves` is the active seat's list, so boxing an enemy is
 * invisible unless we reseat. The sum is commutative — Map iteration is only
 * a bag of counts.
 */
const mobilityScore = (state: GameState, me: PlayerId, rules: RulesPort): number => {
  const exitsByFrom = new Map<string, number>();
  for (const owner of state.players) {
    let ownsGroup = false;
    for (const group of state.groups.values()) {
      if (group.owner === owner) {
        ownsGroup = true;
        break;
      }
    }
    if (!ownsGroup) continue;
    const fromExits = new Map<string, Set<string>>();
    for (const move of rules.legalMoves(seated(state, owner))) {
      if (move.kind !== 'step') continue;
      const from = String(move.from);
      const bucket = fromExits.get(from) ?? new Set<string>();
      bucket.add(String(move.exit));
      fromExits.set(from, bucket);
    }
    for (const [from, exits] of fromExits) {
      exitsByFrom.set(from, exits.size);
    }
  }
  let mobility = 0;
  for (const [arrow, group] of state.groups) {
    const sign = group.owner === me ? 1 : -1;
    const exits = exitsByFrom.get(String(arrow)) ?? 0;
    mobility += sign * group.heads * exits;
  }
  return MOBILITY_SCALE * mobility;
};

export const evaluate = (
  geometry: GeometryPort,
  state: GameState,
  me: PlayerId,
  rules?: RulesPort,
): number => {
  if (state.winner === me) return 1_000_000;
  if (state.winner !== undefined) return -1_000_000;

  let enemyHeads = 0;
  for (const group of state.groups.values()) {
    if (group.owner !== me) enemyHeads += group.heads;
  }

  const territory = territoryOf(state, me);
  let enemyTerritory = 0;
  for (const owner of state.territory.values()) {
    if (owner !== me) enemyTerritory += 1;
  }

  const trail = trailOf(state, me);
  let enemyTrail = 0;
  for (const [player, set] of state.trails) {
    if (player !== me) enemyTrail += set.size;
  }

  const shares = sharesOf(geometry, state, me);
  let enemyShares = 0;
  for (const player of state.players) {
    if (player !== me) enemyShares += sharesOf(geometry, state, player);
  }

  // P36: starvation is per seat. Every enemy clock is good for us, ours is bad.
  // Read through `players`, never the map's own key order.
  let domination = 0;
  for (const player of state.players) {
    const streak = state.starvationStreaks.get(player) ?? 0;
    domination += player === me ? -streak * 200 : streak * 200;
  }

  let tipPressure = 0;
  for (const [arrow, group] of state.groups) {
    if (group.owner !== me) continue;
    if (!(state.trails.get(me)?.has(arrow) ?? false)) continue;
    tipPressure += distanceToTerritory(geometry, state, me, arrow);
  }
  const urgency = closeUrgency(trail);
  const tipTerm = -tipPressure * (5 + Math.floor(urgency / 16));

  const shape = rules === undefined ? 0 : stackShapeScore(state, me, rules);
  const mobility = rules === undefined ? 0 : mobilityScore(state, me, rules);

  return (
    headsOf(state, me) * 120 -
    enemyHeads * 120 +
    territory * 25 -
    enemyTerritory * 18 +
    shares * 100 -
    enemyShares * 90 +
    // Open trail is a cut surface once long — but never so toxic we prefer idling.
    trail * 1 -
    enemyTrail * 8 +
    tipTerm +
    domination +
    shape +
    mobility
  );
};
