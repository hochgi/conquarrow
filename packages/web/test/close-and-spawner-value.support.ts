/**
 * Constructed positions for P54 close-and-spawner-value tests.
 * New boards live here; P53 helpers are reused from bot-turn-search.support.ts.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArrowId,
  GameState,
  Group,
  PlayerId,
  VertexId,
} from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { DEFAULT_FINDINGS_CAPS, grainDistance } from '../src/findings';
import { distanceToTerritory } from '../src/botEvaluate';
import { estimateCloseLoot, exposure, turnsToClose } from '../src/botClose';
import {
  botAndEnemy,
  geometry,
  legalSteps,
  outsOf,
  rules,
  sharesOf,
  SMALL_MATCH,
  strideTwoStackPosition,
  trailSizeOf,
} from './bot-turn-search.support';

const here = dirname(fileURLToPath(import.meta.url));

export const DIST_CAP = DEFAULT_FINDINGS_CAPS.distCap;

export const botCloseSource = (): string =>
  readFileSync(join(here, '../src/botClose.ts'), 'utf8');

export const gameStateSource = (): string =>
  readFileSync(join(here, '../../contracts/src/game-state.ts'), 'utf8');

export const findingsSource = (): string =>
  readFileSync(join(here, '../src/findings.ts'), 'utf8');

export const sourceWithoutComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

export const webTestSourcesExcluding = (skip: readonly string[]): string => {
  const names = readdirSync(here).filter(
    (name) => name.endsWith('.test.ts') && !skip.includes(name),
  );
  return names.map((name) => readFileSync(join(here, name), 'utf8')).join('\n');
};

export const bordersSpawner = (state: GameState, arrow: ArrowId): boolean =>
  geometry.flankVertices(arrow).some((vertex) => state.spawners.has(vertex));

const replaceBotGroups = (
  opening: GameState,
  Bot: PlayerId,
  botGroups: ReadonlyMap<ArrowId, Group>,
): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of opening.groups) {
    if (group.owner !== Bot) groups.set(arrow, group);
  }
  for (const [arrow, group] of botGroups) groups.set(arrow, group);
  return { ...opening, groups };
};

const isolateTerritory = (
  opening: GameState,
  Bot: PlayerId,
  home: ArrowId,
): Map<ArrowId, PlayerId> => {
  const territory = new Map(
    [...opening.territory.entries()].filter(([, owner]) => owner !== Bot),
  );
  territory.set(home, Bot);
  return territory;
};

const occupied = (state: GameState, arrow: ArrowId): boolean => state.groups.has(arrow);

export const shuffleCloseMaps = (state: GameState): GameState => {
  const groups = [...state.groups.entries()];
  const territory = [...state.territory.entries()];
  const trails = [...state.trails.entries()];
  const spawners = [...state.spawners.entries()];
  const rotatedGroups = new Map([...groups.slice(1), ...groups.slice(0, 1)]);
  const reversedTerritory = new Map(territory.toReversed());
  const shuffledTrails = new Map(
    [...trails.slice(1), ...trails.slice(0, 1)].map(([player, set]) => {
      const arrows = [...set];
      return [player, new Set([...arrows.slice(1), ...arrows.slice(0, 1)])] as const;
    }),
  );
  const rotatedSpawners = new Map([...spawners.slice(1), ...spawners.slice(0, 1)]);
  return {
    ...state,
    groups: rotatedGroups,
    territory: reversedTerritory,
    trails: shuffledTrails,
    spawners: rotatedSpawners,
  };
};

export type HomewardClosePosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly from: ArrowId;
  readonly first: ArrowId;
  readonly landing: ArrowId;
  readonly dist: number;
};

/** Trail tip two grain steps from territory; a legal step strictly reduces that distance. */
export const homewardClosePathPosition = (): HomewardClosePosition => {
  const { state, Bot, from, first, second } = strideTwoStackPosition();
  const dist = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
  if (dist < 1 || dist > DIST_CAP) {
    throw new Error(`setup: stride tip dist ${String(dist)} is outside 1..${String(DIST_CAP)}`);
  }
  const reducing = legalSteps(state).find((m) => {
    if (m.from !== from) return false;
    return distanceToTerritory(geometry, state, Bot, m.exit, DIST_CAP) < dist;
  });
  if (reducing === undefined) throw new Error('setup: no distance-reducing legal step');
  return { state, Bot, from, first, landing: second, dist };
};

export type TwoStackStrideClose = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly from: ArrowId;
  readonly exit: ArrowId;
};

/** 2-stack whose homeward exit is legal at count 1 and count 2. */
export const twoStackStrideClosePosition = (): TwoStackStrideClose => {
  const { state, Bot, from, first } = homewardClosePathPosition();
  const d0 = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
  const ones = legalSteps(state).filter(
    (m) =>
      m.from === from &&
      m.exit === first &&
      m.count === 1 &&
      distanceToTerritory(geometry, state, Bot, m.exit, DIST_CAP) < d0,
  );
  const twos = legalSteps(state).filter(
    (m) =>
      m.from === from &&
      m.exit === first &&
      m.count === 2 &&
      distanceToTerritory(geometry, state, Bot, m.exit, DIST_CAP) < d0,
  );
  if (ones.length === 0 || twos.length === 0) {
    throw new Error('setup: homeward exit is not legal at both count 1 and count 2');
  }
  return { state, Bot, from, exit: first };
};

export type MillPosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly from: ArrowId;
  readonly sibling: ArrowId;
  readonly homeward: ArrowId;
  readonly mid: ArrowId;
  readonly home: ArrowId;
  readonly vertex: VertexId;
};

const millCandidate = (
  opening: GameState,
  Bot: PlayerId,
  vertex: VertexId,
  from: ArrowId,
  mid: ArrowId,
  home: ArrowId,
  sibling: ArrowId,
  heads: number,
): MillPosition | undefined => {
  if (from === mid || mid === home || from === home) return undefined;
  if (opening.groups.has(from) || opening.groups.has(mid) || opening.groups.has(home)) {
    return undefined;
  }
  if (opening.groups.has(sibling)) return undefined;
  const territory = isolateTerritory(opening, Bot, home);
  territory.delete(from);
  territory.delete(mid);
  territory.delete(sibling);
  const state: GameState = {
    ...replaceBotGroups(opening, Bot, new Map([[from, { owner: Bot, heads, spent: 0 }]])),
    activePlayer: Bot,
    territory,
    trails: new Map([[Bot, new Set([from, mid])]]),
  };
  if (occupied(state, sibling) || occupied(state, mid) || occupied(state, home)) return undefined;
  const d0 = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
  if (d0 < 2 || d0 > DIST_CAP) return undefined;
  const dMid = distanceToTerritory(geometry, state, Bot, mid, DIST_CAP);
  if (dMid >= d0) return undefined;
  const dSib = distanceToTerritory(geometry, state, Bot, sibling, DIST_CAP);
  if (dSib < d0) return undefined;
  const steps = legalSteps(state).filter((m) => m.from === from);
  const siblingStep = steps.find((m) => m.exit === sibling);
  const homewardStep = steps.find(
    (m) =>
      m.exit === mid && distanceToTerritory(geometry, state, Bot, m.exit, DIST_CAP) < d0,
  );
  if (siblingStep === undefined || homewardStep === undefined) return undefined;
  return { state, Bot, from, sibling, homeward: mid, mid, home, vertex };
};

/** Group standing on an open share; sibling mill hop and a distinct homeward exit are both legal. */
export const millPosition = (): MillPosition => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  for (const vertex of opening.spawners.keys()) {
    const borders = [...geometry.borderArrows(vertex)];
    if (borders.length !== 3) continue;
    for (const from of borders) {
      if (opening.territory.get(from) !== undefined) continue;
      if (opening.groups.has(from)) continue;
      const siblings = borders.filter((b) => b !== from && opening.territory.get(b) === undefined);
      const fromOuts = outsOf(from);
      const siblingExits = siblings.filter((s) => fromOuts.includes(s) && !opening.groups.has(s));
      if (siblingExits.length === 0) continue;
      const nonSiblingOuts = fromOuts.filter(
        (o) => o !== from && !borders.includes(o) && !opening.groups.has(o),
      );
      for (const mid of nonSiblingOuts) {
        if (opening.territory.get(mid) !== undefined) continue;
        for (const home of outsOf(mid)) {
          if (home === from || home === mid || borders.includes(home)) continue;
          if (opening.groups.has(home)) continue;
          for (const sibling of siblingExits) {
            const hit = millCandidate(opening, Bot, vertex, from, mid, home, sibling, 1);
            if (hit !== undefined) return hit;
          }
        }
      }
    }
  }
  throw new Error('setup: no mill position (open share + sibling hop + homeward exit)');
};

export type LootEstimatorPosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly tip: ArrowId;
  readonly pathExtra: ArrowId;
  readonly landing: ArrowId;
  readonly interiorBorder: ArrowId;
  readonly expectedShares: number;
  readonly expectedArrows: number;
};

/** Trail has one open share; homeward path adds one non-share; an extra border is off the path. */
export const lootEstimatorPosition = (): LootEstimatorPosition => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  for (const vertex of opening.spawners.keys()) {
    const borders = [...geometry.borderArrows(vertex)];
    if (borders.length !== 3) continue;
    for (const from of borders) {
      if (opening.territory.get(from) !== undefined) continue;
      if (opening.groups.has(from)) continue;
      const siblings = borders.filter((b) => b !== from && opening.territory.get(b) === undefined);
      const fromOuts = outsOf(from);
      const nonSiblingOuts = fromOuts.filter(
        (o) => o !== from && !borders.includes(o) && !opening.groups.has(o),
      );
      for (const mid of nonSiblingOuts) {
        if (opening.territory.get(mid) !== undefined) continue;
        if (bordersSpawner(opening, mid)) continue;
        for (const home of outsOf(mid)) {
          if (home === from || home === mid || borders.includes(home)) continue;
          if (opening.groups.has(home)) continue;
          const interior = siblings.find(
            (s) => s !== from && s !== mid && s !== home && !opening.groups.has(s),
          );
          if (interior === undefined) continue;
          const siblingHop = siblings.find((s) => fromOuts.includes(s));
          if (siblingHop === undefined) continue;
          const hit = millCandidate(opening, Bot, vertex, from, mid, home, siblingHop, 1);
          if (hit === undefined) continue;
          const trail = hit.state.trails.get(Bot);
          if (trail === undefined) continue;
          const claimed = new Set<ArrowId>();
          for (const arrow of trail) {
            if (hit.state.territory.get(arrow) !== Bot) claimed.add(arrow);
          }
          claimed.add(from);
          claimed.add(mid);
          claimed.delete(home);
          if (claimed.has(interior)) continue;
          if ([...claimed].filter((a) => bordersSpawner(hit.state, a)).length !== 1) {
            continue;
          }
          return {
            state: hit.state,
            Bot,
            tip: from,
            pathExtra: mid,
            landing: home,
            interiorBorder: interior,
            expectedShares: 1,
            expectedArrows: claimed.size,
          };
        }
      }
    }
  }
  throw new Error('setup: no loot-estimator position');
};

const grainToNearestTrail = (
  state: GameState,
  me: PlayerId,
  start: ArrowId,
  cap: number,
): number => {
  const trail = state.trails.get(me);
  if (trail === undefined || trail.size === 0) return cap + 1;
  let best = cap + 1;
  for (const arrow of [...trail].toSorted((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0))) {
    const d = grainDistance(geometry, start, arrow, cap);
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

export type ExposurePair = {
  readonly quiet: GameState;
  readonly threatened: GameState;
  readonly Bot: PlayerId;
  readonly E: PlayerId;
};

/** Two states that differ only by one enemy group's arrow: threatened at grain dist 2 vs none in cap. */
export const exposurePair = (): ExposurePair => {
  const mill = millPosition();
  const { Bot } = mill;
  const E = mill.state.players.find((p) => p !== Bot);
  if (E === undefined) throw new Error('setup: need an enemy seat');
  const trail = [...(mill.state.trails.get(Bot) ?? [])];
  if (trail.length === 0) throw new Error('setup: mill trail empty');
  const threatenedAt = reverseAtDistance(trail, 2).find((arrow) => {
    if (mill.state.groups.has(arrow)) return false;
    if (trail.some((t) => t === arrow)) return false;
    if (mill.state.territory.get(arrow) === Bot) return false;
    const probe = relocateEnemy(mill.state, Bot, E, arrow);
    return grainToNearestTrail(probe, Bot, arrow, DIST_CAP) === 2;
  });
  if (threatenedAt === undefined) throw new Error('setup: no enemy arrow at grain distance 2 from trail');
  const quietAt = reverseAtDistance(trail, DIST_CAP + 1).find((arrow) => {
    if (arrow === threatenedAt) return false;
    if (mill.state.groups.has(arrow)) return false;
    if (trail.some((t) => t === arrow)) return false;
    const probe = relocateEnemy(mill.state, Bot, E, arrow);
    return grainToNearestTrail(probe, Bot, arrow, DIST_CAP) > DIST_CAP;
  });
  if (quietAt === undefined) throw new Error('setup: no enemy arrow beyond distCap of trail');
  const threatened = relocateEnemy(mill.state, Bot, E, threatenedAt);
  const quiet = relocateEnemy(mill.state, Bot, E, quietAt);
  return { quiet, threatened, Bot, E };
};

const relocateEnemy = (
  state: GameState,
  Bot: PlayerId,
  E: PlayerId,
  at: ArrowId,
  heads = 1,
): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of state.groups) {
    if (group.owner === E) continue;
    groups.set(arrow, group);
  }
  groups.set(at, { owner: E, heads, spent: 0 });
  const botGroup = [...state.groups.entries()].find(([, g]) => g.owner === Bot);
  if (botGroup !== undefined && !groups.has(botGroup[0])) {
    groups.set(botGroup[0], botGroup[1]);
  }
  return { ...state, groups };
};

export type BeyondCapPosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly tip: ArrowId;
};

/** Trail tip whose distanceToTerritory exceeds distCap. */
export const beyondDistCapPosition = (): BeyondCapPosition => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const home = [...opening.territory.entries()].find(([, owner]) => owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no home');
  const far = reverseAtDistance([home], DIST_CAP + 1).find(
    (arrow) =>
      arrow !== home &&
      !opening.groups.has(arrow) &&
      opening.territory.get(arrow) !== Bot,
  );
  if (far === undefined) throw new Error('setup: no arrow at distCap+1 from home');
  const territory = isolateTerritory(opening, Bot, home);
  const state: GameState = {
    ...replaceBotGroups(opening, Bot, new Map([[far, { owner: Bot, heads: 1, spent: 0 }]])),
    activePlayer: Bot,
    territory,
    trails: new Map([[Bot, new Set([far])]]),
  };
  const dist = distanceToTerritory(geometry, state, Bot, far, DIST_CAP);
  if (dist <= DIST_CAP) {
    throw new Error(`setup: expected dist > ${String(DIST_CAP)}, got ${String(dist)}`);
  }
  return { state, Bot, tip: far };
};

export type ImmediateAndPathPosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly closeFrom: ArrowId;
  readonly closeExit: ArrowId;
  readonly pathFrom: ArrowId;
};

/** One group can one-step close; another has a multi-step homeward walk. */
export const immediateCloseAndPathPosition = (): ImmediateAndPathPosition => {
  const homeward = homewardClosePathPosition();
  const { state, Bot, from, first, landing } = homeward;
  const preds = predecessors(landing);
  for (const closeFrom of preds) {
    if (closeFrom === from || closeFrom === first || closeFrom === landing) continue;
    if (state.groups.has(closeFrom)) continue;
    if (!outsOf(closeFrom).includes(landing)) continue;
    const groups = new Map(state.groups);
    groups.set(closeFrom, { owner: Bot, heads: 1, spent: 0 });
    const trail = new Set(state.trails.get(Bot) ?? []);
    trail.add(closeFrom);
    const trails = new Map(state.trails);
    trails.set(Bot, trail);
    const next: GameState = { ...state, groups, trails };
    const closeStep = legalSteps(next).find((m) => m.from === closeFrom && m.exit === landing);
    if (closeStep === undefined) continue;
    const dPath = distanceToTerritory(geometry, next, Bot, from, DIST_CAP);
    if (dPath < 2 || dPath > DIST_CAP) continue;
    const reducing = legalSteps(next).find((m) => {
      if (m.from !== from) return false;
      return distanceToTerritory(geometry, next, Bot, m.exit, DIST_CAP) < dPath;
    });
    if (reducing === undefined) continue;
    let after: GameState;
    try {
      after = rules.apply(next, closeStep);
    } catch {
      continue;
    }
    const gained =
      [...after.territory.values()].filter((o) => o === Bot).length >
      [...next.territory.values()].filter((o) => o === Bot).length;
    const landedHome = next.territory.get(closeStep.exit) === Bot;
    if (!landedHome && !gained) continue;
    return { state: next, Bot, closeFrom, closeExit: landing, pathFrom: from };
  }
  throw new Error('setup: no dual immediate-close + close_path position');
};

export const bestFindingPrioritySource = (): readonly string[] => {
  const src = findingsSource();
  const match = /const priority: readonly FindingKind\[\] = \[([\s\S]*?)\];/.exec(src);
  if (match?.[1] === undefined) throw new Error('setup: bestFindingMove priority array not found');
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => {
    const kind = m[1];
    if (kind === undefined) throw new Error('setup: empty kind in priority array');
    return kind;
  });
};

export const p53ShuttleAssertionsSource = (): string => {
  const core = readFileSync(join(here, 'bot-turn-search.core.test.ts'), 'utf8');
  const edge = readFileSync(join(here, 'bot-turn-search.edge-cases.test.ts'), 'utf8');
  return `${core}\n${edge}`;
};

export const visitUnclaimedBorderPosition = (): {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly moveFrom: ArrowId;
  readonly moveExit: ArrowId;
} => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const state: GameState = { ...opening, activePlayer: Bot };
  const beforeShares = shareCount(state, Bot);
  for (const move of legalSteps(state)) {
    const destOwned = state.territory.get(move.exit) !== undefined;
    if (destOwned) continue;
    if (!bordersSpawner(state, move.exit)) continue;
    let after: GameState;
    try {
      after = rules.apply(state, move);
    } catch {
      continue;
    }
    if (shareCount(after, Bot) !== beforeShares) continue;
    return { state, Bot, moveFrom: move.from, moveExit: move.exit };
  }
  throw new Error('setup: no legal step onto an unclaimed border that does not raise shares');
};

const shareCount = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) {
      if (state.territory.get(arrow) === player) n += 1;
    }
  }
  return n;
};

const compareVertexIds = (a: VertexId, b: VertexId): number =>
  String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

export const ownSharesOf = (state: GameState, vertex: VertexId, me: PlayerId): number => {
  let n = 0;
  for (const arrow of geometry.borderArrows(vertex)) {
    if (state.territory.get(arrow) === me) n += 1;
  }
  return n;
};

export const grainDistToVertex = (
  from: ArrowId,
  vertex: VertexId,
  cap = DIST_CAP,
): number => {
  let best = cap + 1;
  for (const border of geometry.borderArrows(vertex)) {
    const d = grainDistance(geometry, from, border, cap);
    if (d < best) best = d;
  }
  return best;
};

export const nearestOwnGroupDistToVertex = (
  state: GameState,
  me: PlayerId,
  vertex: VertexId,
  cap = DIST_CAP,
): number => {
  let best = cap + 1;
  let any = false;
  for (const [arrow, group] of state.groups) {
    if (group.owner !== me) continue;
    any = true;
    const d = grainDistToVertex(arrow, vertex, cap);
    if (d < best) best = d;
  }
  return any ? best : cap + 1;
};

/** Test-side BSSN 16 oracle. Production {@link campaignTarget} must match this. */
export const specCampaignTarget = (
  state: GameState,
  me: PlayerId,
  cap = DIST_CAP,
): VertexId | undefined => {
  let hasGroup = false;
  for (const group of state.groups.values()) {
    if (group.owner === me) {
      hasGroup = true;
      break;
    }
  }
  if (!hasGroup) return undefined;
  let best: VertexId | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  const vertices = [...state.spawners.keys()].toSorted(compareVertexIds);
  for (const vertex of vertices) {
    const own = ownSharesOf(state, vertex, me);
    if (own >= 3) continue;
    const spawner = state.spawners.get(vertex);
    if (spawner === undefined) continue;
    const dist = Math.max(1, nearestOwnGroupDistToVertex(state, me, vertex, cap));
    const score = ((spawner.force.num / spawner.force.den) * (3 - own)) / dist;
    if (
      best === undefined ||
      score > bestScore ||
      (score === bestScore && String(vertex) < String(best))
    ) {
      best = vertex;
      bestScore = score;
    }
  }
  return best;
};

const restrictSpawners = (
  state: GameState,
  vertices: readonly VertexId[],
): GameState => {
  const spawners = new Map(state.spawners);
  const keep = new Set(vertices.map(String));
  for (const vertex of state.spawners.keys()) {
    if (!keep.has(String(vertex))) spawners.delete(vertex);
  }
  return { ...state, spawners };
};

export const stepTowardVertex = (
  from: ArrowId,
  exit: ArrowId,
  vertex: VertexId,
): boolean => {
  const d0 = grainDistToVertex(from, vertex);
  const d1 = grainDistToVertex(exit, vertex);
  if (d1 < d0) return true;
  const stepD = grainDistance(geometry, from, exit, DIST_CAP);
  return stepD + d1 === d0;
};

export const isQuietDirtCloseComplete = (
  origin: GameState,
  terminal: GameState,
  me: PlayerId,
  campaign: VertexId | undefined,
): boolean => {
  if (exposure(geometry, rules, origin, me) !== 0) return false;
  if (sharesOf(terminal, me) > sharesOf(origin, me)) return false;
  if (trailSizeOf(terminal, me) !== 0) return false;
  if (campaign === undefined) return true;
  return (
    nearestOwnGroupDistToVertex(terminal, me, campaign) >=
    nearestOwnGroupDistToVertex(origin, me, campaign)
  );
};

export type ContestedVsMonopolised = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly monopolised: VertexId;
  readonly contested: VertexId;
};

/** Nearer home vertex monopolised; one farther unowned spawner remains. */
export const contestedVsMonopolisedPosition = (): ContestedVsMonopolised => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no group');
  const monopolised = [...opening.spawners.keys()].find(
    (vertex) => ownSharesOf(opening, vertex, Bot) === 3,
  );
  if (monopolised === undefined) throw new Error('setup: no monopolised home spawner');
  const nearDist = grainDistToVertex(home, monopolised);
  const contested = [...opening.spawners.keys()]
    .filter(
      (vertex) =>
        vertex !== monopolised &&
        ownSharesOf(opening, vertex, Bot) < 3 &&
        grainDistToVertex(home, vertex) > nearDist,
    )
    .toSorted((a, b) => grainDistToVertex(home, a) - grainDistToVertex(home, b))[0];
  if (contested === undefined) throw new Error('setup: no farther unowned spawner');
  const state = restrictSpawners(
    { ...opening, activePlayer: Bot },
    [monopolised, contested],
  );
  return { state, Bot, monopolised, contested };
};

export type CampaignTie = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly lesser: VertexId;
  readonly greater: VertexId;
};

export const campaignTieBreakPosition = (): CampaignTie => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no group');
  const verts = [...opening.spawners.keys()];
  for (let i = 0; i < verts.length; i += 1) {
    const a = verts[i];
    if (a === undefined) continue;
    if (ownSharesOf(opening, a, Bot) >= 3) continue;
    for (let j = i + 1; j < verts.length; j += 1) {
      const b = verts[j];
      if (b === undefined) continue;
      if (ownSharesOf(opening, b, Bot) >= 3) continue;
      const da = grainDistToVertex(home, a);
      const db = grainDistToVertex(home, b);
      if (da !== db || da > DIST_CAP) continue;
      const forceA = opening.spawners.get(a);
      const prevB = opening.spawners.get(b);
      if (forceA === undefined || prevB === undefined) continue;
      const spawners = new Map<VertexId, NonNullable<typeof forceA>>();
      spawners.set(a, forceA);
      spawners.set(b, { force: forceA.force, phase: prevB.phase });
      const state: GameState = { ...opening, spawners, activePlayer: Bot };
      const lesser = compareVertexIds(a, b) < 0 ? a : b;
      const greater = lesser === a ? b : a;
      return { state, Bot, lesser, greater };
    }
  }
  throw new Error('setup: no equal-distance unmonopolised spawner pair');
};

export const allSpawnersMonopolisedPosition = (): {
  readonly state: GameState;
  readonly Bot: PlayerId;
} => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const territory = new Map(opening.territory);
  for (const vertex of opening.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) territory.set(arrow, Bot);
  }
  return { state: { ...opening, territory, activePlayer: Bot }, Bot };
};

export type QuietDirtVsCampaign = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly campaign: VertexId;
  readonly from: ArrowId;
  readonly home: ArrowId;
  readonly dirtArrows: number;
  readonly campaignTurns: number;
};

const tryQuietDirtBoard = (
  opening: GameState,
  Bot: PlayerId,
  from: ArrowId,
  first: ArrowId,
  home: ArrowId,
  heads: number,
): QuietDirtVsCampaign | undefined => {
  if (from === first || first === home || from === home) return undefined;
  if (opening.groups.has(from) || opening.groups.has(first) || opening.groups.has(home)) {
    return undefined;
  }
  const territory = new Map(opening.territory);
  territory.delete(from);
  territory.delete(first);
  territory.set(home, Bot);
  const state: GameState = {
    ...replaceBotGroups(opening, Bot, new Map([[from, { owner: Bot, heads, spent: 0 }]])),
    activePlayer: Bot,
    territory,
    trails: new Map([[Bot, new Set([from, first])]]),
  };
  const estimated = estimateCloseLoot(geometry, state, Bot, from);
  if (estimated.shares !== 0 || estimated.arrows < 2) return undefined;
  const d0 = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
  if (d0 < 1 || turnsToClose(d0, heads) !== 1) return undefined;
  const homeward = legalSteps(state).find(
    (m) =>
      m.from === from &&
      m.exit === first &&
      distanceToTerritory(geometry, state, Bot, m.exit, DIST_CAP) < d0,
  );
  if (homeward === undefined) return undefined;
  if (exposure(geometry, rules, state, Bot) !== 0) return undefined;
  for (const vertex of state.spawners.keys()) {
    if (ownSharesOf(state, vertex, Bot) >= 3) continue;
    const dist = grainDistToVertex(from, vertex);
    const campaignTurns = turnsToClose(dist, heads);
    if (campaignTurns !== 3) continue;
    if (grainDistToVertex(home, vertex) < dist) continue;
    const toward = legalSteps(state).find(
      (m) => m.from === from && m.exit !== first && stepTowardVertex(from, m.exit, vertex),
    );
    if (toward === undefined) continue;
    const next = restrictSpawners(state, [vertex]);
    if (specCampaignTarget(next, Bot) !== vertex) continue;
    if (exposure(geometry, rules, next, Bot) !== 0) continue;
    return {
      state: next,
      Bot,
      campaign: vertex,
      from,
      home,
      dirtArrows: estimated.arrows,
      campaignTurns,
    };
  }
  return undefined;
};

/** Quiet 1-turn 0-share homeward loop vs a 3-turn walk to an unowned campaign share. */
export const quietDirtVsCampaignWalkPosition = (): QuietDirtVsCampaign => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const homes = [...opening.territory.entries()]
    .filter(([, owner]) => owner === Bot)
    .map(([arrow]) => arrow);
  for (const home of homes) {
    const near = geometry.window(geometry.origin(home), 5).arrows;
    for (const first of near) {
      if (first === home) continue;
      if (!outsOf(first).includes(home)) continue;
      if (opening.territory.get(first) === Bot) continue;
      for (const from of near) {
        if (from === first || from === home) continue;
        if (!outsOf(from).includes(first)) continue;
        if (opening.territory.get(from) === Bot) continue;
        const hit = tryQuietDirtBoard(opening, Bot, from, first, home, 2);
        if (hit !== undefined) return hit;
      }
    }
  }
  throw new Error('setup: no quiet 1-turn dirt close vs 3-turn campaign walk');
};

export type ApproachCampaignPosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly campaign: VertexId;
  readonly nearer: VertexId;
  readonly towardCampaign: ArrowId;
  readonly towardNearer: ArrowId;
};

export const approachCampaignVsNearerSpawnerPosition = (): ApproachCampaignPosition => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no group');
  const oneStack = replaceBotGroups(
    opening,
    Bot,
    new Map([[home, { owner: Bot, heads: 1, spent: 0 }]]),
  );
  const verts = [...opening.spawners.keys()];
  for (const nearer of verts) {
    if (ownSharesOf(oneStack, nearer, Bot) >= 3) continue;
    const nearBorders = [...geometry.borderArrows(nearer)].filter(
      (arrow) => !oneStack.groups.has(arrow),
    );
    if (nearBorders.length < 3) continue;
    const byDist = nearBorders.toSorted(
      (a, b) =>
        grainDistance(geometry, home, a, DIST_CAP) - grainDistance(geometry, home, b, DIST_CAP),
    );
    const territory = new Map(oneStack.territory);
    for (const arrow of byDist.slice(1)) territory.set(arrow, Bot);
    if (ownSharesOf({ ...oneStack, territory }, nearer, Bot) !== 2) continue;
    for (const campaign of verts) {
      if (campaign === nearer) continue;
      if (ownSharesOf({ ...oneStack, territory }, campaign, Bot) >= 3) continue;
      const state: GameState = restrictSpawners(
        { ...oneStack, territory, activePlayer: Bot },
        [nearer, campaign],
      );
      if (specCampaignTarget(state, Bot) !== campaign) continue;
      let towardCampaign: ArrowId | undefined;
      let towardNearer: ArrowId | undefined;
      for (const move of legalSteps(state)) {
        if (state.territory.get(move.exit) === Bot) continue;
        const near0 = grainDistToVertex(move.from, nearer);
        const near1 = grainDistToVertex(move.exit, nearer);
        const far0 = grainDistToVertex(move.from, campaign);
        const far1 = grainDistToVertex(move.exit, campaign);
        if (far1 < far0) towardCampaign = move.exit;
        if (near1 < near0 && far1 > far0) towardNearer = move.exit;
      }
      if (towardCampaign === undefined || towardNearer === undefined) continue;
      const openNear = [...geometry.borderArrows(nearer)].find(
        (arrow) => state.territory.get(arrow) === undefined,
      );
      if (openNear === undefined) continue;
      const dNear = grainDistance(geometry, home, openNear, DIST_CAP);
      let dCamp = DIST_CAP + 1;
      for (const border of geometry.borderArrows(campaign)) {
        if (state.territory.get(border) !== undefined) continue;
        const d = grainDistance(geometry, home, border, DIST_CAP);
        if (d < dCamp) dCamp = d;
      }
      if (!(dNear < dCamp)) continue;
      return { state, Bot, campaign, nearer, towardCampaign, towardNearer };
    }
  }
  throw new Error('setup: no approach ranking board (campaign farther than another open share)');
};
