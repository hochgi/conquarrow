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
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { closeUrgency, distanceToTerritory, evaluate } from './botEvaluate';
import { chooseTurnBeam } from './botSearch';
import { bestFindingMove } from './findings';
import { playLayout } from './playLayout';

export { closeUrgency, distanceToTerritory, evaluate };

const MAX_CANDIDATES = 64;

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

const territoryOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === player) n += 1;
  return n;
};

const trailOf = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

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
  const moves = chooseTurnBeam(geometry, rules, state, me);
  let at = state;
  for (const move of moves) at = rules.apply(at, move);
  return { state: at, moves };
};
