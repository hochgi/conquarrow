/**
 * The `positions` corpus: committed match logs, replayed through `rules.apply`.
 *
 * A log is `{version, config, seats, moves, summary}` (`matchLog.ts`). Replay
 * folds `foldMatchSummary` once per move — the app's bot path logs one move per
 * apply — and must land on the log's own `summary` exactly; if it does not, the
 * loader is wrong (or the log predates a rules change), and the test says so.
 *
 * A **position** is the state before a seat's first step of a turn: the opening,
 * and the state after every `endTurn`, while nobody has won and the seat to move
 * has a legal step. A turn the logged seat passed is still a position — the
 * audit's paralysis is exactly such a turn.
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameState, MatchConfig, Move, PlayerId } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { hasLegalStep } from '../../src/autoEndTurn';
import { emptyMatchSummary, foldMatchSummary, type MatchSummary } from '../../src/matchLog';
import { rules } from './board';
import { parseMove } from './moves';

const benchDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(benchDir, '../../..');

const CORPUS_FILES = [
  {
    name: 'grok-2026-09-10T0657',
    path: join(benchDir, 'corpus/log.conquarrow-match-2026-09-10T065710-109Z.json'),
  },
  {
    name: 'grok-2026-09-10T1442',
    path: join(benchDir, 'corpus/log.conquarrow-match-2026-09-10T144203-886Z.json'),
  },
  {
    // By reference: the playtest log stays where its findings cite it.
    name: 'playtest-2026-10-29',
    path: join(repoRoot, 'docs/research/playtest-2026-10-29/final-match-log.json'),
  },
] as const;

export type CorpusName = (typeof CORPUS_FILES)[number]['name'];

export const CORPUS_NAMES: readonly CorpusName[] = CORPUS_FILES.map((file) => file.name);

export interface CorpusLog {
  readonly name: string;
  readonly config: MatchConfig;
  readonly moves: readonly Move[];
  readonly summary: MatchSummary;
}

export interface CorpusPosition {
  readonly log: string;
  /** Index into the log's `moves` of the next move: the turn starts here. */
  readonly moveIndex: number;
  readonly seat: PlayerId;
  readonly state: GameState;
}

const asRecord = (value: unknown, where: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected an object`);
  }
  return value as Record<string, unknown>;
};

const int = (rec: Record<string, unknown>, key: string, where: string): number => {
  const value = rec[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${where}.${key}: expected an integer`);
  return value;
};

const parseConfig = (raw: unknown, where: string): MatchConfig => {
  const rec = asRecord(raw, where);
  return {
    dominationN: int(rec, 'dominationN', where),
    R: int(rec, 'R', where),
    homeOffset: int(rec, 'homeOffset', where),
    playerCount: int(rec, 'playerCount', where),
    spawnerSeed: int(rec, 'spawnerSeed', where),
  };
};

const parseSummary = (raw: unknown, where: string): MatchSummary => {
  const rec = asRecord(raw, where);
  const first = rec['firstCloseAt'];
  return {
    steps: int(rec, 'steps', where),
    endTurns: int(rec, 'endTurns', where),
    closes: int(rec, 'closes', where),
    cuts: int(rec, 'cuts', where),
    firstCloseAt: first === undefined || first === null ? undefined : int(rec, 'firstCloseAt', where),
  };
};

export const parseMatchLog = (name: string, raw: unknown): CorpusLog => {
  const rec = asRecord(raw, name);
  if (rec['version'] !== 1) throw new Error(`${name}: unsupported log version`);
  const moves = rec['moves'];
  if (!Array.isArray(moves)) throw new Error(`${name}.moves: expected an array`);
  return {
    name,
    config: parseConfig(rec['config'], `${name}.config`),
    moves: moves.map((move: unknown, i) => parseMove(move, `${name}.moves[${String(i)}]`)),
    summary: parseSummary(rec['summary'], `${name}.summary`),
  };
};

const logs = new Map<string, CorpusLog>();

export const corpusLog = (name: string): CorpusLog => {
  const cached = logs.get(name);
  if (cached !== undefined) return cached;
  const file = CORPUS_FILES.find((f) => f.name === name);
  if (file === undefined) throw new Error(`unknown corpus log ${name}; have ${CORPUS_NAMES.join(', ')}`);
  const log = parseMatchLog(name, JSON.parse(readFileSync(file.path, 'utf8')));
  logs.set(name, log);
  return log;
};

/** Fold every move; `visit` sees each turn start (before move `index`). */
const walk = (log: CorpusLog, visit: (state: GameState, index: number) => void): MatchSummary => {
  let state = makeMatch(log.config);
  let summary = emptyMatchSummary();
  visit(state, 0);
  for (const [index, move] of log.moves.entries()) {
    const after = rules.apply(state, move);
    summary = foldMatchSummary(summary, [move], state, after, index);
    state = after;
    if (move.kind === 'endTurn') visit(state, index + 1);
  }
  return summary;
};

export const replaySummary = (log: CorpusLog): MatchSummary => walk(log, () => undefined);

const positionsByLog = new Map<string, readonly CorpusPosition[]>();

export const corpusPositions = (log: CorpusLog): readonly CorpusPosition[] => {
  const cached = positionsByLog.get(log.name);
  if (cached !== undefined) return cached;
  const out: CorpusPosition[] = [];
  walk(log, (state, moveIndex) => {
    if (state.winner !== undefined || !hasLegalStep(rules, state)) return;
    out.push({ log: log.name, moveIndex, seat: state.activePlayer, state });
  });
  positionsByLog.set(log.name, out);
  return out;
};

/**
 * `<log-stem>#<move-index>`, e.g. `playtest-2026-10-29#212`. The stem is the
 * corpus name; the log file's own stem (`final-match-log`) is accepted too.
 */
export const positionId = (log: string, moveIndex: number): string => `${log}#${String(moveIndex)}`;

const corpusNameFor = (stem: string): string | undefined =>
  CORPUS_FILES.find((f) => f.name === stem || basename(f.path, '.json') === stem)?.name;

export const parsePositionId = (id: string): { readonly log: string; readonly moveIndex: number } => {
  const match = /^(.+)#(\d+)$/.exec(id.trim());
  const log = match?.[1] === undefined ? undefined : corpusNameFor(match[1]);
  if (match?.[2] === undefined || log === undefined) {
    throw new Error(`bad position id ${id}: expected <log>#<move-index>, log one of ${CORPUS_NAMES.join(', ')}`);
  }
  return { log, moveIndex: Number(match[2]) };
};

export const corpusPosition = (name: string, moveIndex: number): CorpusPosition => {
  const hit = corpusPositions(corpusLog(name)).find((p) => p.moveIndex === moveIndex);
  if (hit === undefined) throw new Error(`${name}: no position at move ${String(moveIndex)}`);
  return hit;
};
