/**
 * Fixtures for P61 BYOK batch-turn tests.
 * Adapter only — tiling boards via makeMatch / makeTiling / makeRules.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endTurn, mintArrowId, speed, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Group,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { vi } from 'vitest';
import type { ByokConfig } from '../src/byokConfig';
import { DEFAULT_BYOK } from '../src/byokConfig';
import type { FetchLike } from '../src/byokBot';

export const geometry: GeometryPort = makeTiling();
export const rules: RulesPort = makeRules(geometry);

export const THREE_MATCH = {
  dominationN: 5,
  R: 7,
  homeOffset: 5,
  playerCount: 3,
  spawnerSeed: 1,
} as const;

export const TWO_MATCH = { ...THREE_MATCH, playerCount: 2 } as const;

const here = dirname(fileURLToPath(import.meta.url));

export const byokBotSource = (): string =>
  readFileSync(join(here, '../src/byokBot.ts'), 'utf8');

export const pagesHeuristicSource = (): string =>
  readFileSync(join(here, '../../online-api/src/pages-heuristic.ts'), 'utf8');

export const botTurnSearchSpec = (): string =>
  readFileSync(join(here, '../../../docs/spec/bot-turn-search/bot-turn-search.md'), 'utf8');

export const botTurnSearchCoreFeature = (): string =>
  readFileSync(
    join(here, '../../../docs/spec/bot-turn-search/bot-turn-search.core.feature'),
    'utf8',
  );

export const botTurnSearchCoreTest = (): string =>
  readFileSync(join(here, 'bot-turn-search.core.test.ts'), 'utf8');

export const arrow = (id: string): ArrowId => mintArrowId(id);

export const T2_FROM = arrow('tiling:a:-5,6,0');
export const T2_EXIT = arrow('tiling:a:-4,6,0');
export const T2_HOME = arrow('tiling:a:-4,5,1');

export const readyConfig = (over: Partial<ByokConfig> = {}): ByokConfig => ({
  ...DEFAULT_BYOK,
  enabled: true,
  apiKey: 'sk-test',
  model: 'test-model',
  ...over,
});

export const jsonResponse = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

export const batchJson = (moves: readonly number[], endTurnFlag: boolean): string =>
  JSON.stringify({ moves, endTurn: endTurnFlag });

export const mockChat = (replies: readonly string[]): ReturnType<typeof vi.fn<FetchLike>> => {
  let i = 0;
  return vi.fn<FetchLike>((_url, _init) => {
    const content = replies[i] ?? replies[replies.length - 1] ?? '';
    if (i < replies.length) i += 1;
    return Promise.resolve(jsonResponse(content));
  });
};

export const postedBody = (
  spy: ReturnType<typeof vi.fn<FetchLike>>,
  call = 0,
): Record<string, unknown> => {
  const raw: unknown = spy.mock.calls[call]?.[1]?.body;
  if (typeof raw !== 'string') return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) return {};
  return parsed as Record<string, unknown>;
};

export const postedMessage = (
  spy: ReturnType<typeof vi.fn<FetchLike>>,
  role: 'system' | 'user',
  call = 0,
): string => {
  const body = postedBody(spy, call);
  const messages = body['messages'];
  if (!Array.isArray(messages)) return '';
  for (const item of messages) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    if (row['role'] === role && typeof row['content'] === 'string') return row['content'];
  }
  return '';
};

export const fetchUrls = (spy: ReturnType<typeof vi.fn<FetchLike>>): string[] =>
  spy.mock.calls.map((c) => c[0]);

export const requireSeat = (state: GameState, index: number): PlayerId => {
  const id = state.players[index];
  if (id === undefined) throw new Error(`setup: missing seat ${String(index)}`);
  return id;
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

export const offerSteps = (state: GameState): StepMove[] =>
  rules.legalMoves(state).filter((m): m is StepMove => m.kind === 'step');

export const indexOfStep = (
  state: GameState,
  pred: (move: StepMove) => boolean,
): number => {
  const i = offerSteps(state).findIndex(pred);
  if (i < 0) throw new Error('setup: step not in offer');
  return i;
};

export const replaceOwnerGroups = (
  state: GameState,
  owner: PlayerId,
  next: ReadonlyMap<ArrowId, Group>,
): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const [id, group] of state.groups) {
    if (group.owner !== owner) groups.set(id, group);
  }
  for (const [id, group] of next) groups.set(id, group);
  return { ...state, groups };
};

export const openingThree = (): { readonly state: GameState; readonly me: PlayerId } => {
  const state = makeMatch(THREE_MATCH);
  return { state, me: state.activePlayer };
};

/** Playtest T2: B's 3-stack on -5,6,0; count=3 onto -4,6,0 is legal. */
export const t2Board = (): {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly from: ArrowId;
  readonly exit: ArrowId;
} => {
  const opening = makeMatch(THREE_MATCH);
  const me = requireSeat(opening, 1);
  let at = passToSeat(opening, me);
  at = rules.apply(at, step(T2_HOME, T2_FROM, 1));
  at = rules.apply(at, step(T2_HOME, T2_FROM, 2));
  at = rules.apply(at, endTurn());
  at = passToSeat(at, me);
  const group = at.groups.get(T2_FROM);
  if (group === undefined || group.owner !== me || group.heads !== 3) {
    throw new Error('setup: T2 3-stack missing on -5,6,0');
  }
  const lump = offerSteps(at).find(
    (m) => m.from === T2_FROM && m.exit === T2_EXIT && m.count === 3,
  );
  if (lump === undefined) throw new Error('setup: T2 count=3 onto -4,6,0 is not in the offer');
  return { state: at, me, from: T2_FROM, exit: T2_EXIT };
};

export const spentOutBoard = (): { readonly state: GameState; readonly me: PlayerId } => {
  const { state, me } = openingThree();
  const home = [...state.groups.entries()].find(([, g]) => g.owner === me)?.[0];
  if (home === undefined) throw new Error('setup: opening 3-stack missing');
  const group = state.groups.get(home);
  if (group === undefined) throw new Error('setup: opening group missing');
  const next = replaceOwnerGroups(
    state,
    me,
    new Map([[home, { owner: me, heads: group.heads, spent: speed(group.heads) }]]),
  );
  if (offerSteps(next).length !== 0) throw new Error('setup: expected no legal step');
  return { state: next, me };
};

export const lastStepBoard = (): {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly lumpIndex: number;
} => {
  const { state, me } = openingThree();
  const home = [...state.groups.entries()].find(([, g]) => g.owner === me)?.[0];
  if (home === undefined) throw new Error('setup: opening 3-stack missing');
  const group = state.groups.get(home);
  if (group === undefined) throw new Error('setup: opening group missing');
  const next = replaceOwnerGroups(
    state,
    me,
    new Map([[home, { owner: me, heads: group.heads, spent: speed(group.heads) - 1 }]]),
  );
  const lumpIndex = indexOfStep(next, (m) => m.from === home && m.count === group.heads);
  const after = rules.apply(next, offerSteps(next)[lumpIndex] ?? endTurn());
  if (offerSteps(after).length !== 0) throw new Error('setup: lump did not exhaust steps');
  return { state: next, me, lumpIndex };
};

export const twoFromsBoard = (): {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly firstFrom: ArrowId;
  readonly otherFrom: ArrowId;
} => {
  const { state, me } = openingThree();
  const home = [...state.groups.entries()].find(([, g]) => g.owner === me)?.[0];
  if (home === undefined) throw new Error('setup: opening 3-stack missing');
  const other = [...state.territory.entries()].find(
    ([id, owner]) => owner === me && id !== home && !state.groups.has(id),
  )?.[0];
  if (other === undefined) throw new Error('setup: no second home arrow');
  const groups = new Map(state.groups);
  groups.set(other, { owner: me, heads: 1, spent: 0 });
  const next = { ...state, groups };
  const froms = new Set(offerSteps(next).map((m) => m.from));
  if (froms.size < 2) throw new Error('setup: expected steps from two froms');
  return { state: next, me, firstFrom: home, otherFrom: other };
};

const bordersSpawner = (id: ArrowId, state: GameState): boolean => {
  for (const vertex of state.spawners.keys()) {
    for (const border of geometry.borderArrows(vertex)) {
      if (border === id) return true;
    }
  }
  return false;
};

/** One legal offer step that sets winner (combat wipe of the last living enemy). */
export const winningStepBoard = (): {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly winIndex: number;
  readonly extraIndex: number;
  readonly winning: StepMove;
} => {
  const opening = makeMatch(TWO_MATCH);
  const me = requireSeat(opening, 0);
  const other = requireSeat(opening, 1);
  const home = [...opening.groups.entries()].find(([, g]) => g.owner === me)?.[0];
  if (home === undefined) throw new Error('setup: A home stack missing');
  const victim = geometry.outArrows(geometry.target(home))[0];
  if (victim === undefined) throw new Error('setup: no exit off A home');
  const bare = [...geometry.window(geometry.origin(home), 6).arrows].find(
    (id) =>
      id !== home &&
      id !== victim &&
      !opening.groups.has(id) &&
      opening.territory.get(id) === undefined &&
      !bordersSpawner(id, opening),
  );
  if (bare === undefined) throw new Error('setup: no bare arrow for victim land');
  const territory = new Map(opening.territory);
  for (const [id, owner] of opening.territory) {
    if (owner === other) territory.delete(id);
  }
  territory.set(bare, other);
  const next = replaceOwnerGroups(opening, other, new Map([[victim, { owner: other, heads: 1, spent: 0 }]]));
  const state = { ...next, territory, activePlayer: me };
  const winning = offerSteps(state).find((m) => m.from === home && m.exit === victim && m.count === 1);
  if (winning === undefined) throw new Error('setup: winning step not in offer');
  const after = rules.apply(state, winning);
  if (after.winner !== me) throw new Error('setup: expected that step to set winner');
  const winIndex = indexOfStep(state, (m) => m.from === home && m.exit === victim && m.count === 1);
  const extraIndex = offerSteps(state).findIndex(
    (m, i) => i !== winIndex && m.from === home && m.exit !== victim,
  );
  if (extraIndex < 0) throw new Error('setup: no extra origin step');
  return { state, me, winIndex, extraIndex, winning };
};

export const manyStacksBoard = (): { readonly state: GameState; readonly me: PlayerId } => {
  const { state, me } = openingThree();
  const home = [...state.groups.entries()].find(([, g]) => g.owner === me)?.[0];
  if (home === undefined) throw new Error('setup: opening 3-stack missing');
  const nearby = [...geometry.window(geometry.origin(home), 4).arrows];
  const groups = new Map<ArrowId, Group>();
  for (const id of nearby) {
    if (groups.size >= 10) break;
    if (state.groups.has(id) && state.groups.get(id)?.owner !== me) continue;
    groups.set(id, { owner: me, heads: 1, spent: 0 });
  }
  if (groups.size < 10) throw new Error('setup: could not place 10 one-stacks');
  const next = replaceOwnerGroups(state, me, groups);
  let at = next;
  for (let i = 0; i < 8; i += 1) {
    const first = offerSteps(at)[0];
    if (first === undefined) throw new Error('setup: many-stacks dried up before 8 steps');
    at = rules.apply(at, first);
  }
  return { state: next, me };
};

export const fromBlocks = (prompt: string): string[] => {
  const froms: string[] = [];
  for (const line of prompt.split('\n')) {
    const match = /^\[(\d+)\]\s+step from=(\S+)/.exec(line.trim());
    if (match?.[2] !== undefined) froms.push(match[2]);
  }
  return froms;
};

export const fromsAreGrouped = (froms: readonly string[]): boolean => {
  const seen = new Set<string>();
  let prev: string | undefined;
  for (const from of froms) {
    if (from === prev) continue;
    if (seen.has(from)) return false;
    seen.add(from);
    prev = from;
  }
  return true;
};
