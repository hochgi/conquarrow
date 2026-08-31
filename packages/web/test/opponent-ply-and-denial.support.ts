/**
 * Constructed positions for P55 opponent-ply-and-denial tests.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArrowId, GameState, Group, Move, PlayerId, RulesPort } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { grainDistance } from '../src/botEvaluate';
import {
  boxOpenExitPosition,
  geometry,
  legalSteps,
  rules,
  SMALL_MATCH,
} from './bot-turn-search.support';
import {
  DIST_CAP,
  exposurePair,
  millPosition,
  shuffleCloseMaps,
} from './close-and-spawner-value.support';

const here = dirname(fileURLToPath(import.meta.url));

export { DIST_CAP, exposurePair, millPosition, shuffleCloseMaps };

export const SIX_MATCH = {
  playerCount: 6,
  R: 7,
  homeOffset: 6,
  dominationN: 50,
  spawnerSeed: 1,
} as const;

export const hypothesiseChair = (state: GameState, seat: PlayerId): GameState => ({
  ...state,
  activePlayer: seat,
  winner: undefined,
});

export const trailSize = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

export const recordingRules = (
  inner: RulesPort,
): {
  readonly rules: RulesPort;
  readonly log: () => readonly { readonly seat: PlayerId; readonly kind: Move['kind'] }[];
} => {
  const entries: { readonly seat: PlayerId; readonly kind: Move['kind'] }[] = [];
  const wrapped: RulesPort = {
    ...inner,
    apply(state, move) {
      entries.push({ seat: state.activePlayer, kind: move.kind });
      return inner.apply(state, move);
    },
  };
  return { rules: wrapped, log: () => entries };
};

const mineArrows = (state: GameState, me: PlayerId): ArrowId[] => {
  const out: ArrowId[] = [];
  const seen = new Set<string>();
  const add = (arrow: ArrowId): void => {
    const key = String(arrow);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(arrow);
  };
  for (const [arrow, group] of state.groups) {
    if (group.owner === me) add(arrow);
  }
  for (const [arrow, owner] of state.territory) {
    if (owner === me) add(arrow);
  }
  const trail = state.trails.get(me);
  if (trail !== undefined) {
    for (const arrow of trail) add(arrow);
  }
  return out;
};

export const grainReachToMine = (
  state: GameState,
  me: PlayerId,
  from: ArrowId,
  cap: number,
): number => {
  let best = cap + 1;
  for (const goal of mineArrows(state, me)) {
    const d = grainDistance(geometry, from, goal, cap);
    if (d < best) best = d;
  }
  return best;
};

const grainToTrail = (state: GameState, me: PlayerId, from: ArrowId, cap: number): number => {
  const trail = state.trails.get(me);
  if (trail === undefined || trail.size === 0) return cap + 1;
  let best = cap + 1;
  for (const arrow of trail) {
    const d = grainDistance(geometry, from, arrow, cap);
    if (d < best) best = d;
  }
  return best;
};

const predecessors = (arrow: ArrowId): readonly ArrowId[] =>
  geometry.inArrows(geometry.origin(arrow));

const reverseAtDistance = (seeds: readonly ArrowId[], dist: number): ArrowId[] => {
  const seen = new Set(seeds.map(String));
  let frontier: ArrowId[] = [...seeds];
  for (let d = 1; d <= dist; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const pred of predecessors(arrow)) {
        const key = String(pred);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(pred);
      }
    }
    frontier = next;
    if (frontier.length === 0) return [];
  }
  return frontier;
};

const relocatePlayer = (
  state: GameState,
  player: PlayerId,
  at: ArrowId,
  heads: number,
): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of state.groups) {
    if (group.owner === player) continue;
    groups.set(arrow, group);
  }
  groups.set(at, { owner: player, heads, spent: 0 });
  return { ...state, groups };
};

export type TakeablePair = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly E: PlayerId;
  readonly unsafeExit: ArrowId;
  readonly safeExit: ArrowId;
  readonly from: ArrowId;
};

/** 2-stack with a landing next to an enemy 2-stack that can attack, and a landing that is not. */
export const takeableStackPosition = (): TakeablePair => {
  const opening = makeMatch(SMALL_MATCH);
  const Bot = opening.players[1];
  const E = opening.players[0];
  if (Bot === undefined || E === undefined) throw new Error('setup: need two seats');
  const from = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (from === undefined) throw new Error('setup: Bot has no home group');
  const state0: GameState = { ...opening, activePlayer: Bot };
  const botSteps = legalSteps(state0).filter((m) => m.from === from);
  for (const unsafe of botSteps) {
    const unsafeExit = unsafe.exit;
    for (const eFrom of predecessors(unsafeExit)) {
      if (eFrom === from || state0.groups.has(eFrom)) continue;
      const groups = new Map(state0.groups);
      for (const [arrow, group] of state0.groups) {
        if (group.owner === E) groups.delete(arrow);
      }
      groups.set(eFrom, { owner: E, heads: 2, spent: 0 });
      const state: GameState = { ...state0, groups };
      const stillUnsafe = legalSteps(state).find(
        (m) => m.from === from && m.exit === unsafeExit && m.count === unsafe.count,
      );
      if (stillUnsafe === undefined) continue;
      const safe = legalSteps(state).find(
        (m) => m.from === from && m.exit !== unsafeExit,
      );
      if (safe === undefined) continue;
      let afterUnsafe: GameState;
      let afterSafe: GameState;
      try {
        afterUnsafe = rules.apply(state, stillUnsafe);
        afterSafe = rules.apply(state, safe);
      } catch {
        continue;
      }
      const canTake = legalSteps(hypothesiseChair(afterUnsafe, E)).some(
        (m) => m.from === eFrom && m.exit === unsafeExit,
      );
      const cannotTake = !legalSteps(hypothesiseChair(afterSafe, E)).some(
        (m) => m.from === eFrom && m.exit === safe.exit,
      );
      if (canTake && cannotTake) {
        return { state, Bot, E, unsafeExit, safeExit: safe.exit, from };
      }
    }
  }
  throw new Error('setup: no takeable-stack pair');
};

export type SixSeatReach = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly B: PlayerId;
  readonly C: PlayerId;
};

/** Next chair after Bot is B (unreachable); C is grain-reachable to Bot's trail. */
export const sixSeatThreatIsCPosition = (): SixSeatReach => {
  const opening = makeMatch(SIX_MATCH);
  const Bot = opening.players[0];
  const B = opening.players[1];
  const C = opening.players[2];
  if (Bot === undefined || B === undefined || C === undefined) {
    throw new Error('setup: 6-seat match missing Bot/B/C');
  }
  const mill = millPosition();
  const trail = mill.state.trails.get(mill.Bot);
  if (trail === undefined || trail.size === 0) throw new Error('setup: mill trail empty');
  const botGroup = [...mill.state.groups.entries()].find(([, g]) => g.owner === mill.Bot);
  if (botGroup === undefined) throw new Error('setup: mill Bot group missing');
  const cAt = reverseAtDistance([...trail], 2).find((arrow) => {
    if (mill.state.groups.has(arrow)) return false;
    const probe = relocatePlayer(mill.state, mill.Bot, botGroup[0], botGroup[1].heads);
    const withC = relocatePlayer(probe, mill.state.players.find((p) => p !== mill.Bot) ?? mill.Bot, arrow, 2);
    return grainToTrail(withC, mill.Bot, arrow, DIST_CAP) === 2;
  });
  if (cAt === undefined) throw new Error('setup: no C arrow at grain 2 from trail');
  const bAt = reverseAtDistance([...trail], DIST_CAP + 1).find((arrow) => {
    if (arrow === cAt) return false;
    if (mill.state.groups.has(arrow)) return false;
    return true;
  });
  if (bAt === undefined) throw new Error('setup: no far arrow for seat B');
  const groups = new Map<ArrowId, Group>();
  groups.set(botGroup[0], { owner: Bot, heads: botGroup[1].heads, spent: 0 });
  groups.set(cAt, { owner: C, heads: 2, spent: 0 });
  groups.set(bAt, { owner: B, heads: 1, spent: 0 });
  const territory = new Map<ArrowId, PlayerId>();
  for (const [arrow, owner] of mill.state.territory) {
    if (owner === mill.Bot) territory.set(arrow, Bot);
  }
  const trails = new Map<PlayerId, Set<ArrowId>>();
  trails.set(Bot, new Set(trail));
  const state: GameState = {
    ...opening,
    activePlayer: Bot,
    groups,
    territory,
    trails,
    spawners: mill.state.spawners,
    accumulators: mill.state.accumulators,
  };
  if (grainReachToMine(state, Bot, cAt, DIST_CAP) > DIST_CAP) {
    throw new Error('setup: C is not grain-reachable');
  }
  if (grainReachToMine(state, Bot, bAt, DIST_CAP) <= DIST_CAP) {
    throw new Error('setup: B is still within distCap');
  }
  return { state, Bot, B, C };
};

export const boxedAfterOccupy = (): {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly E: PlayerId;
  readonly openExit: ArrowId;
} => {
  const { state, Bot, E, openExit, botFrom } = boxOpenExitPosition();
  const onto = legalSteps(state).find((m) => m.from === botFrom && m.exit === openExit);
  if (onto === undefined) throw new Error('setup: cannot occupy open exit');
  return { state: rules.apply(state, onto), Bot, E, openExit };
};

export const unreachableEnemyPosition = (): {
  readonly quiet: GameState;
  readonly Bot: PlayerId;
  readonly E: PlayerId;
} => {
  const { quiet, Bot, E } = exposurePair();
  return { quiet, Bot, E };
};

export const botSearchSource = (): string =>
  readFileSync(join(here, '../src/botSearch.ts'), 'utf8');

export const botCloseSource = (): string =>
  readFileSync(join(here, '../src/botClose.ts'), 'utf8');

export const botEvaluateSource = (): string =>
  readFileSync(join(here, '../src/botEvaluate.ts'), 'utf8');

export const findingsSource = (): string =>
  readFileSync(join(here, '../src/findings.ts'), 'utf8');

export const botReplySource = (): string =>
  readFileSync(join(here, '../src/botReply.ts'), 'utf8');
