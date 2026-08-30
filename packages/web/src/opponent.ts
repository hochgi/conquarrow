/**
 * Playtest opponent — adapter only, not P12.
 *
 * Lessons from logs (bot never closed, many idle turns with steps available):
 *   1. **Never pass while a legal step exists.** Close-urgency was making every
 *      extension look worse than `endTurn`, so the bot froze with open trail.
 *   2. **Steer by distance-to-territory** (BFS along the grain). Under urgency,
 *      prefer shrinking that distance — the deterministic stand-in for "U-turn
 *      and close".
 *   3. **Tempo / pairs** (§3): prefer `speed(2)` shapes; avoid freezing a lone tip.
 *   4. **Harass**: cut enemy trail, take favorable contact fights.
 *
 * 2026-08 heuristic pass:
 *   - Explicit closing / cutting detectors with large reliable bonuses so the
 *     bot stops wandering when a close or cut is available.
 *   - Stricter urgency: under high closeUrgency, distance-increasing steps are
 *     heavily penalized (almost vetoed) unless they cut.
 *   - Stronger pair bias (create / preserve size-2; punish lone tips on trail).
 *
 * Ties break on a stable move key — never insertion order. No RNG (replayable).
 */

import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { endTurn, speed } from '@conquarrow/contracts';
import { bestFindingMove } from './findings';
import { playLayout } from './playLayout';

const MAX_CANDIDATES = 64;
const MAX_MOVES_PER_TURN = 64;
const DIST_CAP = 16;

const moveKey = (move: Move): string => {
  switch (move.kind) {
    case 'step':
      return `step:${String(move.from)}>${String(move.exit)}:${String(move.count)}`;
    case 'endTurn':
      return 'endTurn';
  }
};

const compareMoves = (left: Move, right: Move): number => {
  const a = moveKey(left);
  const b = moveKey(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

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
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
  for (const vertex of vertices) {
    for (const arrow of [...geometry.borderArrows(vertex)].toSorted((a, b) =>
      String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
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
): number => {
  if (state.territory.get(start) === me) return 0;
  const seen = new Set<string>([String(start)]);
  let frontier: ArrowId[] = [start];
  for (let d = 1; d <= cap; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const exit of geometry.outArrows(geometry.target(arrow))) {
        const key = String(exit);
        if (seen.has(key)) continue;
        if (state.territory.get(exit) === me) return d;
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

  // Tip pressure: sum of distances for groups sitting on our open trail.
  let tipPressure = 0;
  for (const [arrow, group] of state.groups) {
    if (group.owner !== me) continue;
    if (!(state.trails.get(me)?.has(arrow) ?? false)) continue;
    tipPressure += distanceToTerritory(geometry, state, me, arrow);
  }
  const urgency = closeUrgency(trail);
  const tipTerm = -tipPressure * (5 + Math.floor(urgency / 16));

  const shape = rules === undefined ? 0 : stackShapeScore(state, me, rules);

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
    shape
  );
};

const strategicCounts = (maxCount: number): readonly number[] => {
  const counts = new Set<number>();
  if (maxCount >= 1) counts.add(maxCount);
  if (maxCount >= 2) {
    counts.add(maxCount - 1);
    counts.add(2);
  }
  if (maxCount >= 3) counts.add(1);
  return [...counts].toSorted((a, b) => a - b);
};

export const pruneCandidates = (moves: readonly Move[]): readonly Move[] => {
  const byExit = new Map<string, StepMove[]>();
  let end: Move | undefined;
  for (const move of moves) {
    if (move.kind === 'endTurn') {
      end = move;
      continue;
    }
    const key = `${String(move.from)}>${String(move.exit)}`;
    const list = byExit.get(key) ?? [];
    list.push(move);
    byExit.set(key, list);
  }

  const out: Move[] = [];
  for (const list of byExit.values()) {
    const max = list.reduce((m, s) => Math.max(m, s.count), 0);
    const wanted = new Set(strategicCounts(max));
    for (const move of list) {
      if (wanted.has(move.count)) out.push(move);
    }
  }
  if (end !== undefined) out.push(end);

  const sorted = out.toSorted(compareMoves);
  if (sorted.length <= MAX_CANDIDATES) return sorted;
  const steps = sorted.filter((m): m is StepMove => m.kind === 'step');
  const kept: Move[] = [...steps.slice(0, MAX_CANDIDATES - (end !== undefined ? 1 : 0))];
  if (end !== undefined) kept.push(end);
  return kept.toSorted(compareMoves);
};

/**
 * Playtest heuristic detector (not a rules predicate): tip on open trail lands
 * back on own territory, or territory grows after the step (close / land bridge).
 */
export const isClosingMove = (
  before: GameState,
  after: GameState,
  me: PlayerId,
  move: StepMove,
): boolean => {
  const wasOnTrail = before.trails.get(me)?.has(move.from) ?? false;
  if (!wasOnTrail) return false;
  const landedHome = before.territory.get(move.exit) === me;
  const gained = territoryOf(after, me) > territoryOf(before, me);
  return landedHome || gained;
};

/**
 * Playtest heuristic detector (not a rules predicate): any enemy trail shrinks
 * after the step (cut / evaporation progress).
 */
export const isCutMove = (before: GameState, after: GameState, me: PlayerId): boolean => {
  for (const [player, set] of before.trails) {
    if (player === me) continue;
    const afterSize = after.trails.get(player)?.size ?? 0;
    if (afterSize < set.size) return true;
  }
  return false;
};

const scoreStepExtras = (
  geometry: GeometryPort,
  before: GameState,
  after: GameState,
  move: StepMove,
  me: PlayerId,
): number => {
  let bonus = 0;
  const group = before.groups.get(move.from);
  if (group === undefined) return bonus;

  const leftBehind = group.heads - move.count;
  // Pair bias: taking a pair or leaving a pair is tempo-correct (§3).
  if (move.count === 2) bonus += 48;
  if (leftBehind === 2) bonus += 40;
  if (move.count === 1 && group.heads >= 3) bonus += 14;
  // Leaving a singleton on open trail is usually a blunder.
  if (leftBehind === 1 && move.count >= 2) {
    const onTrail = before.trails.get(me)?.has(move.from) ?? false;
    bonus -= onTrail ? 70 : 40;
  }

  const dest = before.groups.get(move.exit);
  if (dest !== undefined && dest.owner !== me) {
    bonus += 50 + (move.count - dest.heads) * 40;
    if (move.count < dest.heads) bonus -= 60;
  }

  // Landing on / reducing enemy trail.
  for (const [player, set] of before.trails) {
    if (player === me) continue;
    if (set.has(move.exit)) bonus += 110;
    const afterSize = after.trails.get(player)?.size ?? 0;
    if (afterSize < set.size) bonus += (set.size - afterSize) * 70;
  }

  const urgency = closeUrgency(trailOf(before, me));
  const onOwnLand = before.territory.get(move.exit) === me;
  const trailing = before.trails.get(me)?.has(move.from) ?? false;
  if (onOwnLand && trailing) bonus += 220 + urgency * 4;

  const gainedTerr = territoryOf(after, me) - territoryOf(before, me);
  if (gainedTerr > 0) bonus += 450 + urgency * 6 + gainedTerr * 35;

  // First-class close / cut: make these dominate ordinary scouting steps.
  if (isClosingMove(before, after, me, move)) {
    bonus += 700 + urgency * 8;
  }
  if (isCutMove(before, after, me)) {
    bonus += 420 + urgency * 3;
  }

  // Homeward bias along the grain.
  const d0 = distanceToTerritory(geometry, before, me, move.from);
  const d1 = distanceToTerritory(geometry, before, me, move.exit);
  if (d1 < d0) {
    bonus += (d0 - d1) * (28 + urgency);
  } else if (d1 > d0) {
    if (urgency >= 36) {
      // High urgency: extending is almost a veto unless we just cut.
      const cut = isCutMove(before, after, me);
      bonus -= (d1 - d0) * (urgency + (cut ? 4 : 22));
    } else if (urgency >= 20) {
      bonus -= (d1 - d0) * (urgency / 2);
    } else {
      bonus += 6; // early: allow scouting outward
    }
  }

  if (territoryOf(before, me) <= 6 && leftBehind === 0 && before.territory.get(move.from) === me) {
    bonus -= 25;
  }

  return bonus;
};

export const chooseMove = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
): Move => {
  const offered = rules.legalMoves(state);
  const pruned = pruneCandidates(offered);
  const steps = pruned.filter((m): m is StepMove => m.kind === 'step');
  // Hard rule from the idle-turn autopsy: never pass while a step is legal.
  const candidates: readonly Move[] =
    steps.length > 0 ? steps : pruned.length > 0 ? pruned : offered;

  if (steps.length > 0) {
    const guided = bestFindingMove(
      geometry,
      rules,
      state,
      me,
      undefined,
      playLayout,
    );
    if (guided !== undefined) {
      const ok = steps.some(
        (m) =>
          m.from === guided.from && m.exit === guided.exit && m.count === guided.count,
      );
      if (ok) return guided;
    }
  }

  const first = candidates[0];
  if (first === undefined) {
    const fallback = offered[offered.length - 1];
    if (fallback === undefined) throw new Error('opponent: no legal moves');
    return fallback;
  }

  let best: Move = first;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const move of candidates) {
    let next: GameState;
    try {
      next = rules.apply(state, move);
    } catch {
      continue;
    }
    let score = evaluate(geometry, next, me, rules);
    if (move.kind === 'step') {
      score += scoreStepExtras(geometry, state, next, move, me);
    }
    if (score > bestScore || (score === bestScore && compareMoves(move, best) < 0)) {
      bestScore = score;
      best = move;
    }
  }
  return best;
};

export interface BotTurn {
  readonly state: GameState;
  readonly moves: readonly Move[];
}

export const playBotTurn = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
): BotTurn => {
  if (state.activePlayer !== me || state.winner !== undefined) {
    return { state, moves: [] };
  }
  const moves: Move[] = [];
  let at = state;
  for (let i = 0; i < MAX_MOVES_PER_TURN; i += 1) {
    if (at.winner !== undefined || at.activePlayer !== me) break;
    const move = chooseMove(geometry, rules, at, me);
    at = rules.apply(at, move);
    moves.push(move);
  }
  if (at.winner === undefined && at.activePlayer === me) {
    const forced = endTurn();
    at = rules.apply(at, forced);
    moves.push(forced);
  }
  return { state: at, moves };
};
