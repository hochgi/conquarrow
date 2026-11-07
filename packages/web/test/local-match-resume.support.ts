/**
 * Oracles for P90. The direct replay and the fixture parse use the bench
 * move parser, not the resume module — a red test must not be red because
 * the fixture itself does not apply.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  DEFAULT_MATCH_CONFIG,
  endTurn,
  mintArrowId,
  mintPlayerId,
  movesEqual,
  step,
} from '@conquarrow/contracts';
import type { GameState, MatchConfig, PlayerId } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { parseMove } from '../src/moves';
import {
  appendMoves,
  createMatchLog,
  emptyMatchSummary,
  withByokStats,
  withWinner,
} from '../src/matchLog';
import type { ByokRunStats, MatchLog, MatchSummary, SeatDriverLog } from '../src/matchLog';
import { stateDigest } from '../src/online-replay';
import type { SeatKind } from '../src/seatPlan';

const here = dirname(fileURLToPath(import.meta.url));

export const PLAYTEST_1106_PATH = join(
  here,
  '../../../docs/research/playtest-2026-11-06/match-log.json',
);

export const FIXTURE_1102_PATH = join(here, 'fixtures/playtest-2026-11-02.match-log.json');

export const FIXTURE_1103_PATH = join(here, 'fixtures/playtest-2026-11-03.match-log.json');

const rules = makeRules(makeTiling());

const A = mintPlayerId('A');
const B = mintPlayerId('B');
const C = mintPlayerId('C');

const SEAT_KINDS: readonly SeatKind[] = ['human', 'heuristic', 'byok'];

const BOT_MODES = ['human-hotseat', 'heuristic', 'byok', 'mixed'] as const;

export const readText = (path: string): string => readFileSync(path, 'utf8');

interface RawSeat {
  readonly player: string;
  readonly kind: string;
  readonly model?: string;
}

interface RawLog {
  readonly version: number;
  readonly config: MatchConfig;
  readonly startedAt: string;
  readonly vsBot: boolean;
  readonly botMode: string;
  readonly seats: readonly RawSeat[];
  readonly humanSeat: string;
  readonly botSeat?: string;
  readonly byokStats?: ByokRunStats;
  readonly byokStatsBySeat?: Readonly<Record<string, ByokRunStats>>;
  readonly moves: readonly unknown[];
  readonly winner?: string;
  readonly summary?: MatchSummary;
}

const isSeatKind = (kind: string): kind is SeatKind =>
  (SEAT_KINDS as readonly string[]).includes(kind);

const seatOf = (raw: RawSeat, where: string): SeatDriverLog => {
  if (!isSeatKind(raw.kind)) {
    throw new Error(`setup: ${where} seat kind ${raw.kind} is not in the fixture vocabulary`);
  }
  return {
    player: mintPlayerId(raw.player),
    kind: raw.kind,
    ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
  };
};

/** A MatchLog built without the resume parser, so replay tests have an independent log. */
export const oracleLog = (rawText: string, where: string): MatchLog => {
  const raw = JSON.parse(rawText) as RawLog;
  if (!(BOT_MODES as readonly string[]).includes(raw.botMode)) {
    throw new Error(`setup: ${where} botMode ${raw.botMode} is not a fixture mode`);
  }
  const botMode = raw.botMode as MatchLog['botMode'];
  return {
    version: 1,
    config: raw.config,
    startedAt: raw.startedAt,
    vsBot: raw.vsBot,
    botMode,
    seats: raw.seats.map((seat, i) => seatOf(seat, `${where} seat ${String(i)}`)),
    byokStats: raw.byokStats,
    byokStatsBySeat: raw.byokStatsBySeat,
    humanSeat: mintPlayerId(raw.humanSeat),
    botSeat: raw.botSeat === undefined ? undefined : mintPlayerId(raw.botSeat),
    moves: raw.moves.map((move, i) => parseMove(move, `${where} move ${String(i)}`)),
    winner: raw.winner === undefined ? undefined : mintPlayerId(raw.winner),
    summary: raw.summary ?? emptyMatchSummary(),
  };
};

/** 1-based round of the position after every state in `states` has been reached. */
export const roundOf = (states: readonly GameState[]): number => {
  let rounds = 1;
  for (let i = 1; i < states.length; i += 1) {
    const before = states[i - 1];
    const after = states[i];
    if (before === undefined || after === undefined) break;
    const first = after.players[0];
    if (before.activePlayer !== first && after.activePlayer === first) rounds += 1;
  }
  return rounds;
};

export interface DirectReplay {
  readonly state: GameState;
  readonly round: number;
}

/** Apply every move. A refusal is a setup error — the fixture was expected to replay. */
export const directReplay = (log: MatchLog, where: string): DirectReplay => {
  const states: GameState[] = [makeMatch(log.config)];
  let state = states[0];
  if (state === undefined) throw new Error(`setup: ${where} has no opening`);
  for (const [i, move] of log.moves.entries()) {
    try {
      state = rules.apply(state, move);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`setup: ${where} move ${String(i)} does not replay: ${detail}`);
    }
    states.push(state);
  }
  return { state, round: roundOf(states) };
};

/**
 * Index of the first move `rules.apply` refuses. Throws `setup:` when the
 * log replays in full — the caller asked for a refusal.
 */
export const firstRefusedMove = (log: MatchLog, where: string): number => {
  let state = makeMatch(log.config);
  for (const [i, move] of log.moves.entries()) {
    try {
      state = rules.apply(state, move);
    } catch {
      return i;
    }
  }
  throw new Error(`setup: ${where} replayed in full; expected a refused move`);
};

export const sliceLog = (log: MatchLog, count: number): MatchLog => ({
  ...log,
  moves: log.moves.slice(0, count),
  winner: undefined,
});

/** A step the board does not have, so `rules.apply` refuses it. */
export const withIllegalMove = (log: MatchLog): MatchLog => {
  const first = log.moves[0];
  if (first === undefined || first.kind !== 'step') {
    throw new Error('setup: expected a step to corrupt');
  }
  return {
    ...log,
    moves: [
      step(mintArrowId('tiling:a:not-a-real-arrow'), first.exit, first.count),
      ...log.moves.slice(1),
    ],
  };
};

export const assertSameLog = (actual: MatchLog, expected: MatchLog): void => {
  expect(actual.version).toBe(expected.version);
  expect(actual.config).toEqual(expected.config);
  expect(actual.startedAt).toBe(expected.startedAt);
  expect(actual.vsBot).toBe(expected.vsBot);
  expect(actual.botMode).toBe(expected.botMode);
  expect(actual.seats).toEqual(expected.seats);
  expect(actual.humanSeat).toBe(expected.humanSeat);
  expect(actual.botSeat).toBe(expected.botSeat);
  expect(actual.winner).toBe(expected.winner);
  expect(actual.byokStats).toEqual(expected.byokStats);
  expect(actual.byokStatsBySeat).toEqual(expected.byokStatsBySeat);
  expect(actual.summary).toEqual(expected.summary);
  expect(actual.moves).toHaveLength(expected.moves.length);
  for (const [i, move] of expected.moves.entries()) {
    const got = actual.moves[i];
    expect(got, `move ${String(i)}`).toBeDefined();
    if (got !== undefined) expect(movesEqual(got, move)).toBe(true);
  }
};

export const samePosition = (actual: GameState, expected: GameState): void => {
  expect(stateDigest(actual)).toBe(stateDigest(expected));
  expect(actual.activePlayer).toBe(expected.activePlayer);
  expect(actual.winner).toBe(expected.winner);
};

/** Every optional field populated, so a dropped key cannot hide in `undefined`. */
export const richLog = (): MatchLog => {
  const base = createMatchLog({
    config: { ...DEFAULT_MATCH_CONFIG, playerCount: 3 },
    vsBot: true,
    botMode: 'mixed',
    seats: [
      { player: A, kind: 'human' },
      { player: B, kind: 'byok', model: 'local-model' },
      { player: C, kind: 'heuristic' },
    ],
    humanSeat: A,
    botSeat: B,
    startedAt: '2026-11-07T12:00:00.000Z',
  });
  const moved = appendMoves(base, [
    step(mintArrowId('tiling:a:5,0,0'), mintArrowId('tiling:a:6,0,2'), 2),
    endTurn(),
  ]);
  const stats: ByokRunStats = {
    llmHits: 2,
    llmFallbacks: 1,
    lastError: 'http',
    promptTokens: 10,
    completionTokens: 4,
    lengthOuts: 1,
    salvageParses: 1,
    maxTokens: 64,
  };
  return {
    ...withWinner(withByokStats(moved, stats, B), B),
    summary: {
      steps: 1,
      endTurns: 1,
      closes: 0,
      cuts: 0,
      firstCloseAt: 0,
    },
  };
};

export const localLog = (startedAt: string): MatchLog =>
  createMatchLog({
    config: { ...DEFAULT_MATCH_CONFIG, playerCount: 3 },
    vsBot: true,
    botMode: 'heuristic',
    seats: [
      { player: A, kind: 'heuristic' },
      { player: B, kind: 'heuristic' },
      { player: C, kind: 'human' },
    ],
    humanSeat: C,
    botSeat: A,
    startedAt,
  });

export const playerA = (): PlayerId => A;
export const playerB = (): PlayerId => B;
export const playerC = (): PlayerId => C;
