/**
 * Constructed positions and replay helpers for P53 bot-turn-search tests.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endTurn, mintArrowId, movesEqual, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Group,
  MatchConfig,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { exposure } from '../src/botClose';
import { hypothesiseChair, reachableEnemySeats } from '../src/botReply';
import { evaluate } from '../src/opponent';

export const geometry: GeometryPort = makeTiling();
export const rules: RulesPort = makeRules(geometry);

export const SMALL_MATCH = {
  playerCount: 2,
  R: 7,
  homeOffset: 5,
  dominationN: 5,
  spawnerSeed: 1,
} as const;

export const THREE_MATCH = {
  playerCount: 3,
  R: 7,
  homeOffset: 5,
  dominationN: 5,
  spawnerSeed: 1,
} as const;

const here = dirname(fileURLToPath(import.meta.url));

export const botSearchSource = (): string =>
  readFileSync(join(here, '../src/botSearch.ts'), 'utf8');

export const botEvaluateSource = (): string =>
  readFileSync(join(here, '../src/botEvaluate.ts'), 'utf8');

export const botReportSource = (): string =>
  readFileSync(join(here, '../src/botReport.ts'), 'utf8');

export const opponentSource = (): string =>
  readFileSync(join(here, '../src/opponent.ts'), 'utf8');

export const pagesHeuristicSource = (): string =>
  readFileSync(join(here, '../../online-api/src/pages-heuristic.ts'), 'utf8');

export const outsOf = (arrow: ArrowId): readonly ArrowId[] =>
  geometry.outArrows(geometry.target(arrow));

export const legalSteps = (state: GameState): StepMove[] =>
  rules.legalMoves(state).filter((m): m is StepMove => m.kind === 'step');

export const distinctExits = (state: GameState, from: ArrowId): readonly ArrowId[] => {
  const seen = new Set<string>();
  const out: ArrowId[] = [];
  for (const move of legalSteps(state)) {
    if (move.from !== from) continue;
    const key = String(move.exit);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(move.exit);
  }
  return out;
};

export const foldPlan = (state: GameState, moves: readonly Move[]): GameState => {
  let at = state;
  for (const move of moves) at = rules.apply(at, move);
  return at;
};

/** True if some step lands on an arrow that is not `me`'s territory at that moment. */
export const planDepartsTerritory = (
  start: GameState,
  moves: readonly Move[],
  me: PlayerId,
): boolean => {
  let at = start;
  for (const move of moves) {
    if (move.kind === 'step' && at.territory.get(move.exit) !== me) return true;
    at = rules.apply(at, move);
  }
  return false;
};

export const planIsLegalSequence = (
  start: GameState,
  moves: readonly Move[],
): boolean => {
  let at = start;
  for (const move of moves) {
    const offered = rules.legalMoves(at);
    if (!offered.some((m) => movesEqual(m, move))) return false;
    at = rules.apply(at, move);
  }
  return true;
};

export const planTerminates = (start: GameState, moves: readonly Move[]): boolean => {
  if (moves.length === 0) return false;
  const last = moves[moves.length - 1];
  if (last === undefined) return false;
  const after = foldPlan(start, moves);
  if (after.winner !== undefined) return true;
  if (last.kind === 'endTurn') return after.activePlayer !== start.activePlayer;
  return after.activePlayer !== start.activePlayer;
};

export const countingRules = (
  inner: RulesPort,
): { readonly rules: RulesPort; readonly count: () => number } => {
  let n = 0;
  const wrapped: RulesPort = {
    ...inner,
    apply(state, move) {
      const next = inner.apply(state, move);
      n += 1;
      return next;
    },
  };
  return { rules: wrapped, count: () => n };
};

const requireSeat = (state: GameState, index: number, label: string): PlayerId => {
  const id = state.players[index];
  if (id === undefined) throw new Error(`setup: missing seat ${label}`);
  return id;
};

export const botAndEnemy = (
  opening: GameState,
): { readonly Bot: PlayerId; readonly E: PlayerId } => ({
  E: requireSeat(opening, 0, 'E'),
  Bot: requireSeat(opening, 1, 'Bot'),
});

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

export type StridePosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly from: ArrowId;
  readonly first: ArrowId;
  readonly second: ArrowId;
};

/** Fresh 2-stack on own trail; two-arrow homeward close (BSSN 11). */
export const strideTwoStackPosition = (): StridePosition => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const homes = [...opening.territory.entries()]
    .filter(([, owner]) => owner === Bot)
    .map(([arrow]) => arrow);
  for (const second of homes) {
    const near = geometry.window(geometry.origin(second), 4).arrows;
    for (const first of near) {
      if (first === second) continue;
      if (!outsOf(first).includes(second)) continue;
      if (opening.groups.has(first)) continue;
      if (opening.territory.get(first) === Bot) continue;
      for (const from of near) {
        if (from === first || from === second) continue;
        if (!outsOf(from).includes(first)) continue;
        if (opening.groups.has(from)) continue;
        if (opening.territory.get(from) === Bot) continue;
        const territory = new Map(opening.territory);
        territory.delete(from);
        territory.delete(first);
        territory.set(second, Bot);
        const state: GameState = {
          ...replaceBotGroups(
            opening,
            Bot,
            new Map([[from, { owner: Bot, heads: 2, spent: 0 }]]),
          ),
          activePlayer: Bot,
          territory,
          trails: new Map([[Bot, new Set([from, first])]]),
        };
        const firstMove = legalSteps(state).find(
          (m) => m.from === from && m.exit === first && m.count === 2,
        );
        if (firstMove === undefined) continue;
        let mid: GameState;
        try {
          mid = rules.apply(state, firstMove);
        } catch {
          continue;
        }
        const secondMove = legalSteps(mid).find(
          (m) => m.from === first && m.exit === second && m.count === 2,
        );
        if (secondMove === undefined) continue;
        let deep: GameState;
        try {
          deep = rules.apply(mid, secondMove);
        } catch {
          continue;
        }
        const shuttle = foldPlan(state, [step(from, first, 1), step(from, first, 1)]);
        const passed = rules.apply(state, endTurn());
        const deepEv = evaluate(geometry, deep, Bot, rules);
        if (deepEv <= evaluate(geometry, mid, Bot, rules)) continue;
        if (deepEv <= evaluate(geometry, shuttle, Bot, rules)) continue;
        if (deepEv <= evaluate(geometry, passed, Bot, rules)) continue;
        if (territoryOf(deep, Bot) <= territoryOf(state, Bot)) continue;
        return { state, Bot, from, first, second };
      }
    }
  }
  throw new Error('setup: no 2-stack two-arrow homeward close');
};

export const territoryOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === player) n += 1;
  return n;
};

export const sharesOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) {
      if (state.territory.get(arrow) === player) n += 1;
    }
  }
  return n;
};

export const trailSizeOf = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

export const everyOwnGroupOnOwnTerritory = (state: GameState, me: PlayerId): boolean => {
  for (const [arrow, group] of state.groups) {
    if (group.owner === me && state.territory.get(arrow) !== me) return false;
  }
  return true;
};

/** P56 expedition: share gained, a group off home, or trail grew and is still down. */
export const isExpeditionTerminal = (
  origin: GameState,
  terminal: GameState,
  me: PlayerId,
): boolean => {
  if (sharesOf(terminal, me) > sharesOf(origin, me)) return true;
  if (!everyOwnGroupOnOwnTerritory(terminal, me)) return true;
  const originTrail = trailSizeOf(origin, me);
  const terminalTrail = trailSizeOf(terminal, me);
  return terminalTrail > originTrail && terminalTrail > 0;
};

/** P56 home mill close: no share gained, groups on home, trail empty at the terminal. */
export const isHomeMillCloseTerminal = (
  origin: GameState,
  terminal: GameState,
  me: PlayerId,
): boolean => {
  if (sharesOf(terminal, me) > sharesOf(origin, me)) return false;
  if (!everyOwnGroupOnOwnTerritory(terminal, me)) return false;
  return trailSizeOf(terminal, me) === 0;
};

export const passToSeat = (state: GameState, me: PlayerId): GameState => {
  let at = state;
  let guard = 0;
  while (at.activePlayer !== me) {
    at = rules.apply(at, endTurn());
    guard += 1;
    if (guard > 16) throw new Error('setup: passToSeat did not reach seat');
  }
  return at;
};

export type FourStackRun = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly run: readonly ArrowId[];
};

/** Fresh 4-stack; three-arrow pinwheel run whose close makes the deepest terminal highest. */
export const fourStackThreeArrowPosition = (): FourStackRun => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  for (const vertex of opening.spawners.keys()) {
    const borders = geometry.borderArrows(vertex);
    if (borders.length !== 3) continue;
    if (borders.some((a) => opening.groups.has(a))) continue;
    const start = borders[0];
    if (start === undefined) continue;
    const path: ArrowId[] = [start];
    let cursor = start;
    for (let i = 0; i < 3; i += 1) {
      const nxt = outsOf(cursor).find((o) => borders.includes(o) && o !== cursor);
      if (nxt === undefined) break;
      path.push(nxt);
      cursor = nxt;
    }
    if (path.length !== 4) continue;
    if (path[3] !== start) continue;
    const a1 = path[1];
    const a2 = path[2];
    if (a1 === undefined || a2 === undefined) continue;
    if (opening.territory.get(a1) !== undefined || opening.territory.get(a2) !== undefined) {
      continue;
    }
    const territory = new Map(opening.territory);
    territory.set(start, Bot);
    const state: GameState = {
      ...replaceBotGroups(
        opening,
        Bot,
        new Map([[start, { owner: Bot, heads: 4, spent: 0 }]]),
      ),
      activePlayer: Bot,
      territory,
    };
    const evs: number[] = [evaluate(geometry, state, Bot, rules)];
    let walk = state;
    const hops: readonly (readonly [ArrowId, ArrowId])[] = [
      [start, a1],
      [a1, a2],
      [a2, start],
    ];
    let legal = true;
    for (const [from, exit] of hops) {
      const move = legalSteps(walk).find((m) => m.from === from && m.exit === exit && m.count === 4);
      if (move === undefined) {
        legal = false;
        break;
      }
      walk = rules.apply(walk, move);
      evs.push(evaluate(geometry, walk, Bot, rules));
    }
    if (!legal) continue;
    const deepest = evs[3];
    const mid2 = evs[2];
    const mid1 = evs[1];
    const startEv = evs[0];
    if (
      deepest !== undefined &&
      mid2 !== undefined &&
      mid1 !== undefined &&
      startEv !== undefined &&
      deepest > mid2 &&
      deepest > mid1 &&
      deepest > startEv
    ) {
      return { state, Bot, run: path };
    }
  }
  throw new Error('setup: no 4-stack three-arrow run whose deepest terminal evaluates highest');
};

export type SplitPosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly from: ArrowId;
  readonly opens: readonly [ArrowId, ArrowId];
};

/** Fresh 4-stack; splitting 2+2 beats keeping a 4-stack (pair is the atom, §3). */
export const splitSharePosition = (): SplitPosition => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot } = botAndEnemy(opening);
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no home group');
  const window = geometry.window(geometry.origin(home), 5);
  for (const from of window.arrows) {
    if (opening.groups.has(from)) continue;
    const pair = outsOf(from).filter((o) => o !== from && !opening.groups.has(o));
    if (pair.length < 2) continue;
    const o1 = pair[0];
    const o2 = pair[1];
    if (o1 === undefined || o2 === undefined) continue;
    const territory = new Map(opening.territory);
    territory.set(from, Bot);
    territory.set(o1, Bot);
    territory.set(o2, Bot);
    const state: GameState = {
      ...replaceBotGroups(
        opening,
        Bot,
        new Map([[from, { owner: Bot, heads: 4, spent: 0 }]]),
      ),
      activePlayer: Bot,
      territory,
      trails: new Map(),
    };
    const twos = legalSteps(state).filter(
      (m) => m.from === from && m.count === 2 && (m.exit === o1 || m.exit === o2),
    );
    if (twos.length < 2) continue;
    const first = twos.find((m) => m.exit === o1);
    const secondMove = twos.find((m) => m.exit === o2);
    if (first === undefined || secondMove === undefined) continue;
    let mid: GameState;
    try {
      mid = rules.apply(state, first);
    } catch {
      continue;
    }
    const second = legalSteps(mid).find(
      (m) => m.from === from && m.count === 2 && m.exit === o2,
    );
    if (second === undefined) continue;
    let deep: GameState;
    try {
      deep = rules.apply(mid, second);
    } catch {
      continue;
    }
    const passed = rules.apply(state, endTurn());
    const count4 = legalSteps(state).find(
      (m) => m.from === from && m.exit === o1 && m.count === 4,
    );
    if (count4 === undefined) continue;
    let oneWay: GameState;
    try {
      oneWay = rules.apply(state, count4);
    } catch {
      continue;
    }
    const deepEv = evaluate(geometry, deep, Bot, rules);
    if (deepEv <= evaluate(geometry, passed, Bot, rules)) continue;
    if (deepEv <= evaluate(geometry, oneWay, Bot, rules)) continue;
    return { state, Bot, from, opens: [o1, o2] };
  }
  throw new Error('setup: no 4-stack that should split 2+2');
};

export type BoxPosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
  readonly E: PlayerId;
  readonly openExit: ArrowId;
  readonly botFrom: ArrowId;
};

/** Enemy 1-stack; two exits Bot territory; one open O; Bot can step onto O. */
export const boxOpenExitPosition = (): BoxPosition => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot, E } = botAndEnemy(opening);
  const eArrow = mintArrowId('tiling:a:5,-4,0');
  const openExit = mintArrowId('tiling:a:6,-4,0');
  const blocked = [mintArrowId('tiling:a:6,-4,1'), mintArrowId('tiling:a:6,-4,2')] as const;
  const botFrom = mintArrowId('tiling:a:7,-5,1');
  const territory = new Map(opening.territory);
  for (const [arrow, owner] of opening.territory) {
    if (owner === Bot) territory.delete(arrow);
  }
  territory.set(botFrom, Bot);
  territory.set(blocked[0], Bot);
  territory.set(blocked[1], Bot);
  const state: GameState = {
    ...opening,
    activePlayer: Bot,
    territory,
    groups: new Map([
      [botFrom, { owner: Bot, heads: 2, spent: 0 }],
      [eArrow, { owner: E, heads: 1, spent: 0 }],
    ]),
    trails: new Map(),
  };
  const ontoO = legalSteps(state).filter((m) => m.from === botFrom && m.exit === openExit);
  if (ontoO.length === 0) throw new Error('setup: Bot cannot step onto the open exit');
  const enemyView: GameState = { ...state, activePlayer: E };
  const enemyExits = new Set(
    legalSteps(enemyView)
      .filter((m) => m.from === eArrow)
      .map((m) => String(m.exit)),
  );
  if (!enemyExits.has(String(openExit))) {
    throw new Error('setup: open exit is not a legal enemy exit');
  }
  if (enemyExits.has(String(blocked[0])) || enemyExits.has(String(blocked[1]))) {
    throw new Error('setup: blocked exits are still legal for the enemy');
  }
  return { state, Bot, E, openExit, botFrom };
};

export type PassPosition = {
  readonly state: GameState;
  readonly Bot: PlayerId;
};

const isolateHome = (opening: GameState, Bot: PlayerId, home: ArrowId, heads: number): GameState => {
  const territory = new Map(
    [...opening.territory.entries()].filter(([arrow, owner]) => owner !== Bot || arrow === home),
  );
  return {
    ...replaceBotGroups(opening, Bot, new Map([[home, { owner: Bot, heads, spent: 0 }]])),
    activePlayer: Bot,
    territory,
  };
};

/** Every one-step terminal evaluates strictly worse than endTurn. */
export const passIsBestPosition = (): PassPosition => {
  const opening = makeMatch(THREE_MATCH);
  const Bot = requireSeat(opening, 1, 'Bot');
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no home group');
  // A lone home 1-stack: walking onto trail is worse than waiting. A 2-stack
  // here is the P55 playtest freeze (leaving must beat passing).
  const state = isolateHome(opening, Bot, home, 1);
  const passEv = evaluate(geometry, rules.apply(state, endTurn()), Bot, rules);
  const steps = legalSteps(state);
  if (steps.length === 0) throw new Error('setup: pass position has no legal step');
  for (const move of steps) {
    const ev = evaluate(geometry, rules.apply(state, move), Bot, rules);
    if (ev >= passEv) throw new Error('setup: a one-step terminal is not strictly worse than passing');
  }
  return { state, Bot };
};

/** Pass is best, and there are more than BRANCH legal steps. */
export const passWithManyStepsPosition = (): PassPosition => {
  const opening = makeMatch(THREE_MATCH);
  const Bot = requireSeat(opening, 1, 'Bot');
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no home group');
  const extras: ArrowId[] = [];
  const blocked = new Set<string>([String(home)]);
  for (const a of geometry.window(geometry.origin(home), 4).arrows) {
    if (blocked.has(String(a))) continue;
    if (opening.territory.get(a) !== undefined) continue;
    if (opening.groups.has(a)) continue;
    if (outsOf(home).includes(a) || outsOf(a).includes(home)) continue;
    if (extras.some((e) => outsOf(e).includes(a) || outsOf(a).includes(e))) continue;
    extras.push(a);
    blocked.add(String(a));
    if (extras.length === 2) break;
  }
  if (extras.length < 2) throw new Error('setup: need two extra 1-stack sites');
  const territory = new Map(
    [...opening.territory.entries()].filter(([arrow, owner]) => owner !== Bot || arrow === home),
  );
  territory.set(home, Bot);
  for (const extra of extras) territory.set(extra, Bot);
  const botGroups = new Map<ArrowId, Group>([
    [home, { owner: Bot, heads: 1, spent: 0 }],
    ...extras.map((arrow) => [arrow, { owner: Bot, heads: 1, spent: 0 }] as const),
  ]);
  const state: GameState = {
    ...opening,
    activePlayer: Bot,
    territory,
    groups: new Map([
      ...botGroups,
      ...[...opening.groups.entries()].filter(([, g]) => g.owner !== Bot),
    ]),
  };
  const steps = legalSteps(state);
  if (steps.length <= 6) {
    throw new Error(`setup: expected more than BRANCH legal steps, got ${String(steps.length)}`);
  }
  const passEv = evaluate(geometry, rules.apply(state, endTurn()), Bot, rules);
  for (const move of steps) {
    const ev = evaluate(geometry, rules.apply(state, move), Bot, rules);
    if (ev >= passEv) {
      throw new Error('setup: a one-step terminal is not strictly worse than passing');
    }
  }
  return { state, Bot };
};

/** Eight 1-stacks so greedy-v1 emits more than MAX_PLAN minus 1 steps. */
export const manyOneStackPosition = (): PassPosition => {
  const opening = makeMatch(THREE_MATCH);
  const Bot = requireSeat(opening, 1, 'Bot');
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (home === undefined) throw new Error('setup: Bot has no home group');
  const window = geometry.window(geometry.origin(home), 5);
  const sites: ArrowId[] = [];
  for (const arrow of window.arrows) {
    if (opening.groups.has(arrow)) continue;
    if (outsOf(arrow).every((o) => opening.groups.has(o))) continue;
    sites.push(arrow);
    if (sites.length === 8) break;
  }
  if (sites.length < 8) throw new Error('setup: could not place eight 1-stacks');
  const territory = new Map(opening.territory);
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of opening.groups) {
    if (group.owner !== Bot) groups.set(arrow, group);
  }
  for (const arrow of sites) {
    territory.set(arrow, Bot);
    groups.set(arrow, { owner: Bot, heads: 1, spent: 0 });
  }
  const state: GameState = { ...opening, activePlayer: Bot, territory, groups };
  if (legalSteps(state).length < 8) throw new Error('setup: eight 1-stacks have too few steps');
  return { state, Bot };
};

export type MobilityPair = {
  readonly open: GameState;
  readonly boxed: GameState;
  readonly Bot: PlayerId;
  readonly heads: number;
  readonly exitsLost: number;
};

/** Enemy 3-stack: 3 legal exits vs 0, same territory map (P28 wrap). */
export const enemyBoxMobilityPair = (): MobilityPair => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot, E } = botAndEnemy(opening);
  const eHome = mintArrowId('tiling:a:0,5,0');
  const boxedAt = mintArrowId('tiling:a:2,4,1');
  const eOuts = outsOf(eHome);
  const territory = new Map(opening.territory);
  for (const o of eOuts) territory.set(o, Bot);
  const botHome = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (botHome === undefined) throw new Error('setup: Bot has no home');
  const open: GameState = {
    ...opening,
    activePlayer: Bot,
    territory,
    groups: new Map([
      [botHome, { owner: Bot, heads: 3, spent: 0 }],
      [eHome, { owner: E, heads: 3, spent: 0 }],
    ]),
    trails: new Map(),
  };
  const boxed: GameState = {
    ...open,
    groups: new Map([
      [botHome, { owner: Bot, heads: 3, spent: 0 }],
      [boxedAt, { owner: E, heads: 3, spent: 0 }],
    ]),
  };
  const openExits = distinctExits({ ...open, activePlayer: E }, eHome);
  const boxedExits = distinctExits({ ...boxed, activePlayer: E }, boxedAt);
  if (openExits.length !== 3) {
    throw new Error(`setup: expected 3 open enemy exits, got ${String(openExits.length)}`);
  }
  if (boxedExits.length !== 0) {
    throw new Error(`setup: expected 0 boxed enemy exits, got ${String(boxedExits.length)}`);
  }
  return { open, boxed, Bot, heads: 3, exitsLost: 3 };
};

/** Bot 3-stack: 3 legal exits vs 0, same territory map. */
export const selfBoxMobilityPair = (): MobilityPair => {
  const opening = makeMatch(SMALL_MATCH);
  const { Bot, E } = botAndEnemy(opening);
  const eHome = mintArrowId('tiling:a:0,5,0');
  const boxedAt = mintArrowId('tiling:a:2,4,1');
  const wrapOuts = outsOf(boxedAt);
  const territory = new Map(opening.territory);
  for (const o of wrapOuts) territory.set(o, E);
  const botHome = [...opening.groups.entries()].find(([, g]) => g.owner === Bot)?.[0];
  if (botHome === undefined) throw new Error('setup: Bot has no home');
  const open: GameState = {
    ...opening,
    activePlayer: Bot,
    territory,
    groups: new Map([
      [botHome, { owner: Bot, heads: 3, spent: 0 }],
      [eHome, { owner: E, heads: 1, spent: 0 }],
    ]),
    trails: new Map(),
  };
  const boxed: GameState = {
    ...open,
    groups: new Map([
      [boxedAt, { owner: Bot, heads: 3, spent: 0 }],
      [eHome, { owner: E, heads: 1, spent: 0 }],
    ]),
  };
  const openExits = distinctExits(open, botHome);
  const boxedExits = distinctExits(boxed, boxedAt);
  if (openExits.length !== 3) {
    throw new Error(`setup: expected 3 open Bot exits, got ${String(openExits.length)}`);
  }
  if (boxedExits.length !== 0) {
    throw new Error(`setup: expected 0 boxed-self exits, got ${String(boxedExits.length)}`);
  }
  return { open, boxed, Bot, heads: 3, exitsLost: 3 };
};

export const shuffleMaps = (state: GameState): GameState => {
  const groups = [...state.groups.entries()];
  const territory = [...state.territory.entries()];
  const rotatedGroups = new Map([...groups.slice(1), ...groups.slice(0, 1)]);
  const reversedTerritory = new Map(territory.toReversed());
  return { ...state, groups: rotatedGroups, territory: reversedTerritory };
};

export const withWinner = (state: GameState, winner: PlayerId): GameState => ({
  ...state,
  winner,
});

export const withWrongSeat = (state: GameState, Bot: PlayerId): GameState => {
  const other = state.players.find((p) => p !== Bot);
  if (other === undefined) throw new Error('setup: need another seat');
  return { ...state, activePlayer: other };
};

type BaselineJson = {
  readonly config: MatchConfig;
  readonly seats: readonly { readonly player: string; readonly kind: string }[];
  readonly moves: readonly (
    | { readonly kind: 'endTurn' }
    | { readonly kind: 'step'; readonly from: string; readonly exit: string; readonly count: number }
  )[];
};

export const loadBaselineLog = (): BaselineJson => {
  const raw = readFileSync(
    join(here, '../../../docs/design/packets/data/P53-baseline-match-2026-08-31.json'),
    'utf8',
  );
  return JSON.parse(raw) as BaselineJson;
};

export const baselineMoves = (log: BaselineJson): Move[] =>
  log.moves.map((m) => {
    if (m.kind === 'endTurn') return endTurn();
    return step(mintArrowId(m.from), mintArrowId(m.exit), m.count);
  });

export const heuristicTurnStarts = (
  log: BaselineJson,
): readonly { readonly state: GameState; readonly me: PlayerId }[] => {
  const opening = makeMatch(log.config);
  const human = new Set(
    log.seats.filter((s) => s.kind === 'human').map((s) => s.player),
  );
  const moves = baselineMoves(log);
  const starts: { readonly state: GameState; readonly me: PlayerId }[] = [];
  let state = opening;
  let recorded = false;
  for (const move of moves) {
    const me = state.activePlayer;
    if (!recorded && state.winner === undefined && !human.has(String(me))) {
      starts.push({ state, me });
      recorded = true;
    }
    state = rules.apply(state, move);
    if (move.kind === 'endTurn') recorded = false;
  }
  return starts;
};

export const openingBotState = (): { readonly state: GameState; readonly Bot: PlayerId } => {
  const opening = makeMatch();
  const Bot = requireSeat(opening, 1, 'Bot');
  return { state: { ...opening, activePlayer: Bot }, Bot };
};

/** Config of the 2026-08-31 first playtest after P53–P55. */
export const PLAYTEST_P55_CONFIG = {
  dominationN: 5,
  R: 7,
  homeOffset: 5,
  playerCount: 6,
  spawnerSeed: 1,
} as const;

/**
 * First round of that playtest, through the human's endTurn. Heuristic seats
 * milled a 2-stack onto a sibling home arrow; the human left home.
 */
export const playtestP55OpeningMoves = (): Move[] => [
  step(mintArrowId('tiling:a:5,0,0'), mintArrowId('tiling:a:6,0,1'), 2),
  endTurn(),
  step(mintArrowId('tiling:a:0,5,0'), mintArrowId('tiling:a:1,5,1'), 2),
  endTurn(),
  step(mintArrowId('tiling:a:-4,5,1'), mintArrowId('tiling:a:-5,6,2'), 2),
  endTurn(),
  step(mintArrowId('tiling:a:-4,0,1'), mintArrowId('tiling:a:-5,1,2'), 2),
  endTurn(),
  step(mintArrowId('tiling:a:0,-4,2'), mintArrowId('tiling:a:0,-5,0'), 2),
  endTurn(),
  step(mintArrowId('tiling:a:5,-4,2'), mintArrowId('tiling:a:5,-5,2'), 1),
  step(mintArrowId('tiling:a:5,-4,2'), mintArrowId('tiling:a:5,-5,1'), 2),
  step(mintArrowId('tiling:a:5,-5,1'), mintArrowId('tiling:a:4,-4,1'), 2),
  endTurn(),
];

export const afterPlaytestP55HumanTurn = (): {
  readonly state: GameState;
  readonly me: PlayerId;
} => {
  const opening = makeMatch(PLAYTEST_P55_CONFIG);
  const me = requireSeat(opening, 0, 'A');
  const state = foldPlan(opening, playtestP55OpeningMoves());
  if (state.activePlayer !== me) {
    throw new Error('setup: expected seat A after the playtest first round');
  }
  return { state, me };
};

/** Generated 6-seat opening: active seat still has the home 3-stack. */
export const openingSixSeatHome = (): {
  readonly state: GameState;
  readonly me: PlayerId;
} => {
  const state = makeMatch(PLAYTEST_P55_CONFIG);
  const me = state.activePlayer;
  const home = [...state.groups.entries()].find(([, g]) => g.owner === me);
  if (home === undefined || home[1].heads !== 3) {
    throw new Error('setup: expected a home 3-stack for the active seat');
  }
  if (state.territory.get(home[0]) !== me) {
    throw new Error('setup: home 3-stack is not on own territory');
  }
  return { state, me };
};

const walkOffHomePinwheel = (): Move[] => [
  step(mintArrowId('tiling:a:5,0,0'), mintArrowId('tiling:a:6,0,1'), 3),
  step(mintArrowId('tiling:a:6,0,1'), mintArrowId('tiling:a:5,1,0'), 3),
  endTurn(),
];

const knownZeroShareLandBridge = (): Move[] => [
  step(mintArrowId('tiling:a:5,1,0'), mintArrowId('tiling:a:6,1,2'), 3),
  step(mintArrowId('tiling:a:6,1,2'), mintArrowId('tiling:a:6,0,1'), 3),
  endTurn(),
];

const discoverZeroShareLandBridge = (
  origin: GameState,
  me: PlayerId,
  originShares: number,
  originTerr: number,
): Move[] => {
  for (const first of legalSteps(origin)) {
    let mid: GameState;
    try {
      mid = rules.apply(origin, first);
    } catch {
      continue;
    }
    if (mid.activePlayer !== me) continue;
    for (const second of legalSteps(mid)) {
      let landed: GameState;
      try {
        landed = rules.apply(mid, second);
      } catch {
        continue;
      }
      if (landed.activePlayer !== me) continue;
      let closed: GameState;
      try {
        closed = passToSeat(rules.apply(landed, endTurn()), me);
      } catch {
        continue;
      }
      if (trailSizeOf(closed, me) !== 0) continue;
      if (territoryOf(closed, me) <= 3) continue;
      if (territoryOf(closed, me) <= originTerr) continue;
      if (sharesOf(closed, me) !== originShares) continue;
      if (!everyOwnGroupOnOwnTerritory(closed, me)) continue;
      return [first, second, endTurn()];
    }
  }
  return knownZeroShareLandBridge();
};

const assertPostPaintHome = (state: GameState, me: PlayerId, originShares: number): void => {
  if (state.activePlayer !== me) {
    throw new Error('setup: expected the painted seat to be active');
  }
  if (territoryOf(state, me) <= 3) {
    throw new Error(
      `setup: expected more than 3 territory arrows after the home mill close (got ${String(territoryOf(state, me))})`,
    );
  }
  if (trailSizeOf(state, me) !== 0) {
    throw new Error('setup: expected an empty trail after the home mill close');
  }
  if (!everyOwnGroupOnOwnTerritory(state, me)) {
    throw new Error('setup: expected every own group on own territory after the home mill close');
  }
  if (sharesOf(state, me) !== originShares) {
    throw new Error('setup: home mill close was not 0-share');
  }
};

/**
 * Generated 6-seat opening after one legal 0-share home mill close and a pass back.
 * The opening pinwheel is already 3 owned arrows, so the close is two of Bot's
 * turns applied through `rules.apply`: walk off, pass around, land-bridge home.
 */
export const afterFirstHomeMillClose = (): {
  readonly state: GameState;
  readonly me: PlayerId;
} => {
  const { state: opening, me } = openingSixSeatHome();
  const originShares = sharesOf(opening, me);
  const originTerr = territoryOf(opening, me);
  const walked = passToSeat(foldPlan(opening, walkOffHomePinwheel()), me);
  const closed = foldPlan(walked, discoverZeroShareLandBridge(walked, me, originShares, originTerr));
  const state = passToSeat(closed, me);
  assertPostPaintHome(state, me, originShares);
  return { state, me };
};

/** Opening 3-stack walked two arrows out; trail still down after the pass back. */
export const afterOpeningOpenTrail = (): {
  readonly state: GameState;
  readonly me: PlayerId;
} => {
  const { state: opening, me } = openingSixSeatHome();
  const left = foldPlan(opening, [
    step(mintArrowId('tiling:a:5,0,0'), mintArrowId('tiling:a:6,0,0'), 3),
    step(mintArrowId('tiling:a:6,0,0'), mintArrowId('tiling:a:7,0,2'), 3),
    endTurn(),
  ]);
  const state = passToSeat(left, me);
  if (trailSizeOf(state, me) === 0) {
    throw new Error('setup: expected a non-empty trail after the opening expedition');
  }
  return { state, me };
};

/**
 * Same open trail as {@link afterOpeningOpenTrail}, with an enemy relocated onto
 * a feeder so P55 exposure is strictly positive (P57 under-fire land-bridge).
 */
export const afterOpeningOpenTrailUnderFire = (): {
  readonly state: GameState;
  readonly me: PlayerId;
} => {
  const { state, me } = afterOpeningOpenTrail();
  const enemy = state.players.find((p) => p !== me);
  if (enemy === undefined) throw new Error('setup: need an enemy seat');
  const trail = [...(state.trails.get(me) ?? [])];
  if (trail.length === 0) throw new Error('setup: open trail empty');
  const tip = [...state.groups.entries()].find(([, g]) => g.owner === me)?.[0];
  if (tip === undefined) throw new Error('setup: no group on the open trail');
  const near = [...geometry.window(geometry.origin(tip), 5).arrows, ...trail];
  let grainReachable: GameState | undefined;
  for (const at of near) {
    if (state.groups.has(at) && state.groups.get(at)?.owner === me) continue;
    const next = relocatePlayer(state, enemy, at, 2);
    if (trailSizeOf(next, me) === 0) continue;
    if (reachableEnemySeats(geometry, next, me, 12).length === 0) continue;
    grainReachable ??= next;
    if (exposure(geometry, rules, next, me) > 0) return { state: next, me };
  }
  if (grainReachable !== undefined) return { state: grainReachable, me };
  throw new Error('setup: no enemy feeder grain-reachable to the open trail');
};

const predecessorsOf = (arrow: ArrowId): readonly ArrowId[] =>
  geometry.inArrows(geometry.origin(arrow));

const relocatePlayer = (
  state: GameState,
  player: PlayerId,
  at: ArrowId,
  heads: number,
): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of state.groups) {
    if (group.owner !== player) groups.set(arrow, group);
  }
  groups.set(at, { owner: player, heads, spent: 0 });
  return { ...state, groups };
};

const isSpawnerBorder = (state: GameState, arrow: ArrowId): boolean => {
  for (const vertex of state.spawners.keys()) {
    if (geometry.borderArrows(vertex).includes(arrow)) return true;
  }
  return false;
};

/**
 * Post-paint home, plus an enemy relocated onto a feeder of a departing exit.
 * Returns undefined when no such legal relocation exists (caller should skip).
 */
export const threatenedDepartingExitAfterPaint = ():
  | {
      readonly state: GameState;
      readonly me: PlayerId;
      readonly threatenedExit: ArrowId;
    }
  | undefined => {
  const { state: home, me } = afterFirstHomeMillClose();
  const enemy = home.players.find((p) => p !== me);
  if (enemy === undefined) return undefined;
  const uniqueExits: ArrowId[] = [];
  const seen = new Set<string>();
  for (const move of legalSteps(home)) {
    if (home.territory.get(move.exit) === me) continue;
    const key = String(move.exit);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueExits.push(move.exit);
  }
  if (uniqueExits.length === 0) return undefined;
  let fallback:
    | { readonly state: GameState; readonly me: PlayerId; readonly threatenedExit: ArrowId }
    | undefined;
  for (const exit of uniqueExits) {
    for (const feed of predecessorsOf(exit)) {
      if (home.groups.has(feed)) continue;
      const state = relocatePlayer(home, enemy, feed, 2);
      if (trailSizeOf(state, me) !== 0) continue;
      if (!everyOwnGroupOnOwnTerritory(state, me)) continue;
      if (territoryOf(state, me) <= 3) continue;
      const canStep = legalSteps(hypothesiseChair(state, enemy)).some((m) => m.exit === exit);
      if (!canStep) continue;
      const homeSteps = legalSteps(state).filter((m) => state.territory.get(m.exit) === me);
      if (homeSteps.length === 0) continue;
      const departingKeys = new Set(
        legalSteps(state)
          .filter((m) => state.territory.get(m.exit) !== me)
          .map((m) => String(m.exit)),
      );
      const candidate = { state, me, threatenedExit: exit };
      if (departingKeys.size === 1 && departingKeys.has(String(exit))) return candidate;
      fallback ??= candidate;
    }
  }
  return fallback;
};

/** Two terminals that differ by one own-territory arrow and nothing evaluate should price. */
export const terminalsDifferByOneOwnTerritory = (): {
  readonly smaller: GameState;
  readonly larger: GameState;
  readonly me: PlayerId;
} => {
  const { state, me } = afterFirstHomeMillClose();
  const forbidden = new Set<string>();
  for (const [arrow] of state.territory) forbidden.add(String(arrow));
  for (const [arrow] of state.groups) {
    forbidden.add(String(arrow));
    for (const o of outsOf(arrow)) forbidden.add(String(o));
  }
  const home = [...state.groups.entries()].find(([, g]) => g.owner === me)?.[0];
  if (home === undefined) throw new Error('setup: no home group after paint');
  for (const arrow of geometry.window(geometry.origin(home), 8).arrows) {
    if (forbidden.has(String(arrow))) continue;
    if (isSpawnerBorder(state, arrow)) continue;
    const territory = new Map(state.territory);
    territory.set(arrow, me);
    const larger: GameState = { ...state, territory };
    if (territoryOf(larger, me) !== territoryOf(state, me) + 1) continue;
    if (sharesOf(larger, me) !== sharesOf(state, me)) continue;
    return { smaller: state, larger, me };
  }
  throw new Error('setup: no otherwise-identical extra own-territory arrow');
};
