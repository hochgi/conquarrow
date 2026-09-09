/**
 * Fixtures for P64 BYOK hint-and-threat tests.
 * Adapter only — recorded rows + helpers. No tiling reconstructed from STATE_JSON.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameState, PlayerId, StepMove } from '@conquarrow/contracts';
import type { OfferTagRow, ThreatLineInput } from '../src/byokBot';
import {
  byokBotSource,
  geometry,
  offerSteps,
  openingThree,
  pagesHeuristicSource,
  rules,
  t2Board,
} from './byok-batch-turn.support';
import { opponentSource, readTeachingFile, specSection1 } from './byok-teaching-prompt.support';

export {
  byokBotSource,
  geometry,
  offerSteps,
  openingThree,
  opponentSource,
  pagesHeuristicSource,
  readTeachingFile,
  rules,
  specSection1,
  t2Board,
};

const here = dirname(fileURLToPath(import.meta.url));

export const P64_FIXTURE_PATH = join(
  here,
  '../../../docs/design/fixtures/P64-hit12-hit15.json',
);

export const JSON_REPLY_WITH_PLAN =
  'Reply with only JSON: {"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}';

export const PREFER_ORDER_RE = /prefer (split|closes|don’t close|don't close)/i;

export type P64ExpectedReply = {
  readonly moves: readonly number[];
  readonly endTurn: boolean;
  readonly why?: string;
  readonly plan?: string;
};

export type P64Hit = {
  readonly hit: number;
  readonly legalRows: readonly string[];
  readonly baselineRecorded: string;
  readonly recordedReply: P64ExpectedReply;
  readonly expectedReply: P64ExpectedReply;
  readonly shareCounts: Readonly<Record<string, number>>;
  readonly territoryCounts: Readonly<Record<string, number>>;
  readonly trails: Readonly<Record<string, { readonly count: number }>>;
};

export type P64Fixture = {
  readonly seat: string;
  readonly hit12: P64Hit;
  readonly hit15: P64Hit;
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`setup: ${label} is not an object`);
  }
  return value as Record<string, unknown>;
};

const asStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`setup: ${label} is not a string array`);
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error(`setup: ${label} is not a string array`);
    out.push(entry);
  }
  return out;
};

const asHit = (value: unknown, label: string): P64Hit => {
  const rec = asRecord(value, label);
  const expected = asRecord(rec['expectedReply'], `${label}.expectedReply`);
  const recorded = asRecord(rec['recordedReply'], `${label}.recordedReply`);
  const movesOf = (batch: Record<string, unknown>, batchLabel: string): number[] => {
    const moves = batch['moves'];
    if (!Array.isArray(moves)) throw new Error(`setup: ${batchLabel}.moves is not a number array`);
    const out: number[] = [];
    for (const entry of moves) {
      if (typeof entry !== 'number') {
        throw new Error(`setup: ${batchLabel}.moves is not a number array`);
      }
      out.push(entry);
    }
    return out;
  };
  const trailsRec = asRecord(rec['trails'], `${label}.trails`);
  const trails: Record<string, { readonly count: number }> = {};
  for (const [seat, trail] of Object.entries(trailsRec)) {
    const row = asRecord(trail, `${label}.trails.${seat}`);
    const count = row['count'];
    if (typeof count !== 'number') throw new Error(`setup: ${label}.trails.${seat}.count`);
    trails[seat] = { count };
  }
  const shareCounts = asRecord(rec['shareCounts'], `${label}.shareCounts`) as Record<
    string,
    number
  >;
  const territoryCounts = asRecord(rec['territoryCounts'], `${label}.territoryCounts`) as Record<
    string,
    number
  >;
  const expectedPlan = expected['plan'];
  const recordedWhy = recorded['why'];
  const expectedWhy = expected['why'];
  return {
    hit: typeof rec['hit'] === 'number' ? rec['hit'] : Number.NaN,
    legalRows: asStringArray(rec['legalRows'], `${label}.legalRows`),
    baselineRecorded:
      typeof rec['baselineRecorded'] === 'string' ? rec['baselineRecorded'] : '',
    recordedReply: {
      moves: movesOf(recorded, `${label}.recordedReply`),
      endTurn: recorded['endTurn'] === true,
      ...(typeof recordedWhy === 'string' ? { why: recordedWhy } : {}),
    },
    expectedReply: {
      moves: movesOf(expected, `${label}.expectedReply`),
      endTurn: expected['endTurn'] === true,
      ...(typeof expectedWhy === 'string' ? { why: expectedWhy } : {}),
      ...(typeof expectedPlan === 'string' ? { plan: expectedPlan } : {}),
    },
    shareCounts,
    territoryCounts,
    trails,
  };
};

export const p64Fixture = (): P64Fixture => {
  const raw: unknown = JSON.parse(readFileSync(P64_FIXTURE_PATH, 'utf8'));
  const rec = asRecord(raw, 'P64 fixture');
  return {
    seat: typeof rec['seat'] === 'string' ? rec['seat'] : '',
    hit12: asHit(rec['hit12'], 'hit12'),
    hit15: asHit(rec['hit15'], 'hit15'),
  };
};

export const parseOfferTagRow = (line: string): OfferTagRow => {
  const indexMatch = /^\[(\d+)\]/.exec(line);
  const countMatch = /\bcount=(\d+)/.exec(line);
  if (indexMatch?.[1] === undefined || countMatch?.[1] === undefined) {
    throw new Error(`setup: cannot parse LEGAL_MOVES row: ${line}`);
  }
  const tagsMatch = /\btags=(\S+)/.exec(line);
  const tags = tagsMatch?.[1] === undefined ? [] : tagsMatch[1].split(',');
  return { index: Number(indexMatch[1]), count: Number(countMatch[1]), tags };
};

export const parseOfferTagRows = (lines: readonly string[]): OfferTagRow[] =>
  lines.map(parseOfferTagRow);

export const hit12Rows = (): OfferTagRow[] => parseOfferTagRows(p64Fixture().hit12.legalRows);

export const hit15Rows = (): OfferTagRow[] => parseOfferTagRows(p64Fixture().hit15.legalRows);

export const namedOfferTags = (rows: readonly OfferTagRow[]): string[] => {
  const present = new Set(rows.flatMap((row) => row.tags));
  return ['cut', 'closes', 'borders_spawner'].filter((tag) => present.has(tag));
};

export const isNonExpandingMillRow = (row: OfferTagRow): boolean => {
  const mill = row.tags.includes('home_mill') || row.tags.includes('onto_home');
  const expanding =
    row.tags.includes('closes') || row.tags.includes('cut') || row.tags.includes('leave_home');
  return mill && !expanding;
};

export const hit12ThreatInput = (): ThreatLineInput => {
  const hit = p64Fixture().hit12;
  const trailOf = (seat: string): number => hit.trails[seat]?.count ?? 0;
  return {
    me: 'B',
    players: ['A', 'B', 'C'],
    shares: hit.shareCounts,
    territory: hit.territoryCounts,
    trailLen: { A: trailOf('A'), B: trailOf('B'), C: trailOf('C') },
    offerTags: namedOfferTags(hit12Rows()),
    nearTrail: false,
  };
};

export const leadLine = (prompt: string): string | undefined =>
  prompt.split('\n').find((line) => line.startsWith('Lead:'));

export const planLine = (prompt: string): string | undefined =>
  prompt.split('\n').find((line) => line.startsWith('Plan: '));

export const echoedPlanText = (prompt: string): string | undefined => {
  const line = planLine(prompt);
  return line === undefined ? undefined : line.slice('Plan: '.length);
};

export const lineIndex = (prompt: string, prefix: string): number =>
  prompt.split('\n').findIndex((line) => line.startsWith(prefix));

export const closeCutMillSection = (teaching: string): string => {
  const start = teaching.indexOf('## Close, cut, mill');
  if (start < 0) return '';
  const next = teaching.indexOf('\n## ', start + 1);
  return next < 0 ? teaching.slice(start) : teaching.slice(start, next);
};

export const jsonContractSection = (teaching: string): string => {
  const start = teaching.indexOf('## JSON contract');
  if (start < 0) return '';
  const next = teaching.indexOf('\n## ', start + 1);
  return next < 0 ? teaching.slice(start) : teaching.slice(start, next);
};

export const appSource = (): string => readFileSync(join(here, '../src/App.tsx'), 'utf8');

export const startMatchSource = (): string => {
  const src = appSource();
  const start = src.indexOf('const startMatch =');
  if (start < 0) throw new Error('setup: startMatch missing');
  const end = src.indexOf('if (state === undefined || log === undefined)', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
};

export const botSearchSource = (): string =>
  readFileSync(join(here, '../src/botSearch.ts'), 'utf8');

export const matchLogSource = (): string =>
  readFileSync(join(here, '../src/matchLog.ts'), 'utf8');

export const annotateMoveSource = (): string => {
  const src = byokBotSource();
  const start = src.indexOf('export const annotateMove =');
  if (start < 0) throw new Error('setup: annotateMove missing');
  const end = src.indexOf('export const formatLegalMoves', start);
  return end < 0 ? src.slice(start) : src.slice(start, end);
};

export type PromptSnap = {
  readonly spawnersShown: number;
  readonly spawners: readonly { readonly vertex: string }[];
};

export const asPromptSnap = (value: unknown): PromptSnap => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('setup: snapshotForPrompt did not return an object');
  }
  const rec = value as Record<string, unknown>;
  const shown = rec['spawnersShown'];
  const spawners = rec['spawners'];
  if (typeof shown !== 'number' || !Array.isArray(spawners)) {
    throw new Error('setup: snapshot missing spawnersShown / spawners');
  }
  const rows: { readonly vertex: string }[] = [];
  for (const entry of spawners) {
    if (typeof entry !== 'object' || entry === null) continue;
    const vertex = (entry as Record<string, unknown>)['vertex'];
    if (typeof vertex === 'string') rows.push({ vertex });
  }
  return { spawnersShown: shown, spawners: rows };
};

export const interestingSpawnerCount = (state: GameState, me: PlayerId): number => {
  let n = 0;
  for (const vertex of state.spawners.keys()) {
    const held = new Set<string>();
    let unclaimed = 0;
    for (const arrow of geometry.borderArrows(vertex)) {
      const owner = state.territory.get(arrow);
      if (owner === undefined) unclaimed += 1;
      else held.add(String(owner));
    }
    const mine = held.has(String(me));
    const contested = held.size > 1 || (unclaimed > 0 && held.size > 0);
    if (mine || contested || unclaimed === 3) n += 1;
  }
  return n;
};

export const incidentVertices = (
  state: GameState,
  me: PlayerId,
  offer: readonly StepMove[],
): Set<string> => {
  const incident = new Set<string>();
  const consider = (arrow: Parameters<typeof geometry.flankVertices>[0]): void => {
    for (const vertex of geometry.flankVertices(arrow)) {
      if (state.spawners.has(vertex)) incident.add(String(vertex));
    }
  };
  for (const [arrow, group] of state.groups) {
    if (group.owner === me) consider(arrow);
  }
  for (const move of offer) consider(move.exit);
  return incident;
};

export const nearTrailState = (): {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly enemy: PlayerId;
  readonly move: StepMove;
} => {
  const { state, me } = openingThree();
  const enemy = state.players.find((player) => player !== me);
  if (enemy === undefined) throw new Error('setup: need an enemy seat');
  const move = offerSteps(state)[0];
  if (move === undefined) throw new Error('setup: no legal step');
  const origin = geometry.origin(move.exit);
  const neighbor = [...geometry.outArrows(origin), ...geometry.inArrows(origin)].find(
    (arrow) => arrow !== move.exit,
  );
  if (neighbor === undefined) throw new Error('setup: no neighbor arrow at exit origin');
  const trails = new Map(state.trails);
  trails.set(enemy, new Set([neighbor]));
  return { state: { ...state, trails }, me, enemy, move };
};

export const requireSeatB = (): {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly offer: StepMove[];
} => {
  const { state, me } = t2Board();
  if (String(me) !== 'B') throw new Error('setup: t2Board is not seat B');
  if (state.players.length < 3) throw new Error('setup: need seats A, B, C');
  return { state, me, offer: offerSteps(state) };
};
