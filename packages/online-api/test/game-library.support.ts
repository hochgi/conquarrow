/**
 * S3 planting and library-summary helpers for the P45 game-library suite.
 *
 * GET classification tests stamp meta (or leave it unstamped and write
 * `state.json`) so the Then is the `/my-games` body. Persist tests drive
 * `persistPosition` through GET / POST and then read `meta.json`.
 */

import { expect } from 'vitest';
import type { GameState, InviteSeat, LibrarySummary, PlayerId } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { isLost } from '@conquarrow/rules-core';
import {
  asRecord,
  GAME_ONE,
  aliceHash,
  bobHash,
  gameLogKey,
  gameMetaKey,
  gameStateKey,
  persistEnvelope,
  userGroupKey,
} from './support';

export const GAAA = 'a'.repeat(32);
export const GBBB = 'b'.repeat(32);

const tiling = makeTiling();

const byKey = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const aliceBobHeuristicSeats = (): readonly InviteSeat[] => [
  { kind: 'human', userHash: aliceHash() },
  { kind: 'human', userHash: bobHash() },
  { kind: 'heuristic' },
];

/** `lostPlayers` as persist must write them: `isLost` ids, sorted. */
export const lostPlayerIdsOf = (game: GameState): readonly string[] =>
  game.players
    .filter((player) => isLost(game, player, tiling))
    .map(String)
    .toSorted(byKey);

export const librarySummaryOf = (game: GameState): LibrarySummary => {
  const summary: {
    players: readonly string[];
    activePlayer: string;
    lostPlayers: readonly string[];
    winner?: string;
  } = {
    players: [...game.players].map(String),
    activePlayer: String(game.activePlayer),
    lostPlayers: lostPlayerIdsOf(game),
  };
  if (game.winner !== undefined) {
    summary.winner = String(game.winner);
  }
  return summary;
};

export const withoutTerritoryOf = (state: GameState, player: PlayerId): GameState => {
  const territory = new Map(
    [...state.territory.entries()].filter(([, owner]) => owner !== player),
  );
  const next: GameState = { ...state, territory, winner: undefined };
  if (!isLost(next, player, tiling)) {
    throw new Error(`setup: expected ${String(player)} to be lost after stripping territory`);
  }
  return next;
};

export const cloneS3 = (s3: ReadonlyMap<string, string>): Map<string, string> => new Map(s3);

export const expectS3Unchanged = (
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): void => {
  expect([...after.keys()].toSorted()).toEqual([...before.keys()].toSorted());
  for (const [key, value] of before) {
    expect(after.get(key), key).toBe(value);
  }
};

export const gameMetaRecord = (
  s3: ReadonlyMap<string, string>,
  groupHash: string,
  gameNumber: string,
): Record<string, unknown> => {
  const raw = s3.get(gameMetaKey(groupHash, gameNumber));
  if (raw === undefined) throw new Error('setup: expected game meta.json');
  return asRecord(JSON.parse(raw) as unknown);
};

export const mergeGameMeta = (
  s3: Map<string, string>,
  groupHash: string,
  gameNumber: string,
  extra: Record<string, unknown>,
): void => {
  const rec = gameMetaRecord(s3, groupHash, gameNumber);
  s3.set(gameMetaKey(groupHash, gameNumber), JSON.stringify({ ...rec, ...extra }));
};

export const stampLibrarySummary = (
  s3: Map<string, string>,
  groupHash: string,
  gameNumber: string,
  game: GameState,
): void => {
  const summary = librarySummaryOf(game);
  const extra: Record<string, unknown> = {
    players: summary.players,
    activePlayer: summary.activePlayer,
    lostPlayers: summary.lostPlayers,
  };
  if (summary.winner !== undefined) {
    extra['winner'] = summary.winner;
  }
  mergeGameMeta(s3, groupHash, gameNumber, extra);
};

export const writeStateEnvelope = (
  s3: Map<string, string>,
  groupHash: string,
  gameNumber: string,
  game: GameState,
  version = 0,
): void => {
  s3.set(gameStateKey(groupHash, gameNumber), persistEnvelope(version, game));
  s3.set(gameLogKey(groupHash, gameNumber), '');
};

export const plantGroupPointer = (
  s3: Map<string, string>,
  userHash: string,
  groupHash: string,
): void => {
  s3.set(userGroupKey(userHash, groupHash), '{}');
};

export const plantStampedGame = (
  s3: Map<string, string>,
  args: {
    readonly userHash: string;
    readonly groupHash: string;
    readonly gameNumber: string;
    readonly seats: readonly InviteSeat[];
    readonly summary: LibrarySummary;
  },
): void => {
  plantGroupPointer(s3, args.userHash, args.groupHash);
  const meta: Record<string, unknown> = {
    seats: args.seats,
    players: args.summary.players,
    activePlayer: args.summary.activePlayer,
    lostPlayers: args.summary.lostPlayers,
  };
  if (args.summary.winner !== undefined) {
    meta['winner'] = args.summary.winner;
  }
  s3.set(gameMetaKey(args.groupHash, args.gameNumber), JSON.stringify(meta));
};

export const libraryRowOf = (
  games: readonly {
    readonly groupHash: string;
    readonly gameNumber: string;
    readonly status: string | undefined;
  }[],
  groupHash: string,
  gameNumber: string = GAME_ONE,
): { readonly groupHash: string; readonly gameNumber: string; readonly status: string | undefined } => {
  const row = games.find((game) => game.groupHash === groupHash && game.gameNumber === gameNumber);
  expect(row, `${groupHash}/${gameNumber}`).toBeDefined();
  if (row === undefined) {
    throw new Error(`setup: expected listed game ${groupHash}/${gameNumber}`);
  }
  return row;
};
