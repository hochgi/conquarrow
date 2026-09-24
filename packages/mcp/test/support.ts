/**
 * Adapter-only helpers for P67 MCP tests. Not a game rule.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractViolation } from '@conquarrow/contracts';
import type { GameState, StepMove } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { createMcpTools, stampLiveWinner, type McpTools, type StepArgs } from '../src/tools';
import type { Observation } from '../src/observe';

export const THREE_MATCH = {
  dominationN: 5,
  R: 7,
  homeOffset: 5,
  playerCount: 3,
  spawnerSeed: 1,
} as const;

export const THREE_SEATS = ['human', 'human', 'heuristic'] as const;
export const SIX_SEATS = [
  'human',
  'heuristic',
  'human',
  'heuristic',
  'human',
  'heuristic',
] as const;

export const TOOL_NAMES = [
  'new_match',
  'observe',
  'legal_moves',
  'apply_steps',
  'end_turn',
  'play_heuristic_turn',
  'see_board',
] as const;

export const DIRT_CLAUSE = 'closes without share+N (dirt)';

export const geometry = makeTiling();
export const rules = makeRules(geometry);

export const openingMatch = (spawnerSeed = 1, playerCount = 3): GameState =>
  makeMatch({ ...THREE_MATCH, spawnerSeed, playerCount });

export const createTools = (): McpTools => createMcpTools();

export { stampLiveWinner };

export const openThree = (
  tools: McpTools,
  seats: readonly string[] = THREE_SEATS,
  spawnerSeed = 1,
): ReturnType<McpTools['new_match']> =>
  tools.new_match({
    playerCount: 3,
    seats,
    R: 7,
    homeOffset: 5,
    dominationN: 5,
    spawnerSeed,
  });

export type ParsedRow = {
  readonly index: number;
  readonly from: string;
  readonly exit: string;
  readonly count: number;
  readonly leave: number | undefined;
  readonly tags: readonly string[];
  readonly body: string;
};

export const parseLegalMoveRows = (text: string): ParsedRow[] => {
  const rows: ParsedRow[] = [];
  for (const line of text.split('\n')) {
    const match = /^\[(\d+)\] step from=(\S+) exit=(\S+) count=(\d+)(.*)$/.exec(line.trim());
    if (
      match?.[1] === undefined ||
      match[2] === undefined ||
      match[3] === undefined ||
      match[4] === undefined
    ) {
      continue;
    }
    const rest = match[5] ?? '';
    const leaveMatch = /\bleave=(\d+)/.exec(rest);
    const tagsMatch = /\btags=(\S+)/.exec(rest);
    rows.push({
      index: Number(match[1]),
      from: match[2],
      exit: match[3],
      count: Number(match[4]),
      leave: leaveMatch?.[1] === undefined ? undefined : Number(leaveMatch[1]),
      tags: tagsMatch?.[1] === undefined ? [] : tagsMatch[1].split(','),
      body: line,
    });
  }
  return rows;
};

export const openingLeaveHomeIndex = (state: GameState = openingMatch()): number => {
  const me = state.activePlayer;
  const moves = rules.legalMoves(state);
  const index = moves.findIndex(
    (move) =>
      move.kind === 'step' &&
      state.territory.get(move.from) === me &&
      state.territory.get(move.exit) !== me,
  );
  if (index < 0) throw new Error('setup: no leave_home step on the opening offer');
  return index;
};

export const openingStepMoves = (state: GameState = openingMatch()): readonly StepMove[] =>
  rules.legalMoves(state).filter((move): move is StepMove => move.kind === 'step');

export const catchError = (run: () => unknown): unknown => {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
};

export const isNamedError = (error: unknown, name: string): boolean =>
  error instanceof Error && error.name === name;

export const wrapsContractViolation = (error: unknown): boolean => {
  if (error instanceof ContractViolation) return true;
  if (error instanceof Error && error.cause instanceof ContractViolation) return true;
  return false;
};

export const payloadHasFullSpawnerDump = (payload: unknown): boolean => {
  if (typeof payload !== 'object' || payload === null) return false;
  const rec = payload as Record<string, unknown>;
  const spawners = rec['spawners'];
  return Array.isArray(spawners) && spawners.length === 58;
};

export const hasLeadLineKey = (payload: unknown): boolean =>
  typeof payload === 'object' && payload !== null && 'leadLine' in payload;

export type ThreatLineInput = {
  readonly me: string;
  readonly players: readonly string[];
  readonly shares: Readonly<Record<string, number>>;
  readonly territory: Readonly<Record<string, number>>;
  readonly trailLen: Readonly<Record<string, number>>;
  readonly offerTags: readonly string[];
  readonly nearTrail: boolean;
  readonly dirtCloses?: boolean;
};

const NAMED_OFFER_TAGS = ['cut', 'closes', 'borders_spawner'] as const;

const leadClause = (input: ThreatLineInput): string => {
  const seats = [...input.players].sort((a, b) => {
    const shareDiff = (input.shares[b] ?? 0) - (input.shares[a] ?? 0);
    if (shareDiff !== 0) return shareDiff;
    const terrDiff = (input.territory[b] ?? 0) - (input.territory[a] ?? 0);
    if (terrDiff !== 0) return terrDiff;
    return input.players.indexOf(a) - input.players.indexOf(b);
  });
  const parts = seats.map((id, i) => {
    const shares = input.shares[id] ?? 0;
    const terr = input.territory[id] ?? 0;
    return i === 0
      ? `${id} ${String(shares)} shares / ${String(terr)} terr`
      : `${id} ${String(shares)} / ${String(terr)}`;
  });
  return `Lead: ${parts.join('; ')}`;
};

const longestEnemyTrailClause = (input: ThreatLineInput): string => {
  let owner: string | undefined;
  let longest = 0;
  for (const id of input.players) {
    if (id === input.me) continue;
    const len = input.trailLen[id] ?? 0;
    if (owner === undefined || len > longest) {
      owner = id;
      longest = len;
    }
  }
  if (owner === undefined || longest === 0) return 'Longest enemy trail: none';
  return `Longest enemy trail: ${owner} ${String(longest)}`;
};

/** P64 wording — test oracle, not the product helper. */
export const threatLineFromCounts = (input: ThreatLineInput): string => {
  const clauses: string[] = [leadClause(input), longestEnemyTrailClause(input)];
  const named = NAMED_OFFER_TAGS.filter((tag) => input.offerTags.includes(tag));
  if (named.length > 0) clauses.push(`Offer tags: ${named.join(', ')}`);
  if (!input.offerTags.includes('cut') && !input.offerTags.includes('closes')) {
    clauses.push('No cut/contest/deny row');
  }
  if (input.dirtCloses === true) clauses.push(DIRT_CLAUSE);
  if (!input.nearTrail) clauses.push('no enemy trail on a legal vertex');
  return clauses.join('. ');
};

export const threatLineFromObservation = (obs: Observation): string => {
  const players = Object.keys(obs.shareCounts);
  const trailLen: Record<string, number> = {};
  for (const id of players) trailLen[id] = 0;
  if (obs.longestEnemyTrail !== null) {
    trailLen[obs.longestEnemyTrail.seat] = obs.longestEnemyTrail.length;
  }
  return threatLineFromCounts({
    me: obs.me,
    players,
    shares: obs.shareCounts,
    territory: obs.territoryCounts,
    trailLen,
    offerTags: NAMED_OFFER_TAGS.filter((tag) => obs.offerTags.includes(tag)),
    nearTrail:
      obs.offerTags.includes('cut') ||
      obs.offerTags.some((tag) => tag.startsWith('near_trail:')),
    dirtCloses: obs.offerTags.includes('dirt-closes'),
  });
};

export type ReplayAction =
  | { readonly kind: 'endTurn'; readonly seat: string }
  | { readonly kind: 'step'; readonly seat: string; readonly step: StepArgs };

/**
 * Frozen reconstruction of a 3-seat seed-1 dirt close (gainedTerr 2, gainedShare 0).
 * Two passed rounds accrue spawners, then A walks onto home without a new share.
 */
export const DIRT_CLOSE_WALK: {
  readonly prefix: readonly ReplayAction[];
  readonly close: StepArgs;
  readonly seat: string;
} = {
  seat: 'A',
  prefix: [
    { kind: 'endTurn', seat: 'A' },
    { kind: 'endTurn', seat: 'B' },
    { kind: 'endTurn', seat: 'C' },
    { kind: 'endTurn', seat: 'A' },
    { kind: 'endTurn', seat: 'B' },
    { kind: 'endTurn', seat: 'C' },
    {
      kind: 'step',
      seat: 'A',
      step: { from: 'tiling:a:5,0,0', exit: 'tiling:a:6,0,1', count: 3 },
    },
    {
      kind: 'step',
      seat: 'A',
      step: { from: 'tiling:a:6,0,1', exit: 'tiling:a:5,1,0', count: 3 },
    },
    { kind: 'endTurn', seat: 'A' },
    { kind: 'endTurn', seat: 'B' },
    { kind: 'endTurn', seat: 'C' },
    {
      kind: 'step',
      seat: 'A',
      step: { from: 'tiling:a:5,1,0', exit: 'tiling:a:6,1,2', count: 3 },
    },
  ],
  close: { from: 'tiling:a:6,1,2', exit: 'tiling:a:6,0,1', count: 1 },
};

export const replayActions = (tools: McpTools, actions: readonly ReplayAction[]): void => {
  for (const action of actions) {
    if (action.kind === 'endTurn') {
      tools.end_turn({ seat: action.seat });
    } else {
      tools.apply_steps({ seat: action.seat, steps: [action.step] });
    }
  }
};

export const svgViewBox = (svg: string): string | undefined =>
  /viewBox="([^"]+)"/.exec(svg)?.[1];

export const svgAttrSet = (svg: string, attr: string): ReadonlySet<string> =>
  new Set(
    [...svg.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined),
  );

export const svgGroupHighlights = (
  svg: string,
): readonly { readonly owner: string; readonly highlight: boolean }[] => {
  const out: { owner: string; highlight: boolean }[] = [];
  for (const tag of svg.matchAll(/<[^>]*data-group="[^"]+"[^>]*>/g)) {
    const el = tag[0];
    const owner = /data-owner="([^"]+)"/.exec(el)?.[1];
    if (owner === undefined) continue;
    out.push({ owner, highlight: /data-highlight="1"/.test(el) });
  }
  return out;
};

const here = dirname(fileURLToPath(import.meta.url));

export const mcpSrc = (): string => {
  const dir = join(here, '../src');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
};

export const mcpPackageJson = (): string => readFileSync(join(here, '../package.json'), 'utf8');

export const engineStepKey = (move: StepMove): string =>
  `${String(move.from)}|${String(move.exit)}|${String(move.count)}`;
