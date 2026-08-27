/**
 * Library summary stamp on persist, and caller-relative `/my-games` listing (P45).
 *
 * GET never writes S3. Classification is `libraryStatusFor` in contracts;
 * `isLost` is only called here when stamping or hydrating unstamped meta.
 */

import type {
  GameState,
  LibraryGameStatus,
  LibrarySummary,
  StartedGameRow,
} from '@conquarrow/contracts';
import { libraryStatusFor } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { isLost } from '@conquarrow/rules-core';
import type { ObjectStore } from './api-types';
import { parsePersistedEnvelope } from './game-snapshot';
import { compareStrings } from './hashing';
import { asRecord, parseGameMeta, type GameMeta } from './invite-record';
import { gameMetaKey, gamesPrefix, gameStateKey, userGroupPrefix } from './s3-keys';
import { getObject, listObjects, putObject } from './store-io';

const geometry = makeTiling();
const GAME_META = /\/games\/(\d{6})\/meta\.json$/;

type GamePointer = {
  readonly groupHash: string;
  readonly gameNumber: string;
};

const lastSegment = (key: string, prefix: string): string | undefined => {
  if (!key.startsWith(prefix)) return undefined;
  const rest = key.slice(prefix.length);
  if (rest.length === 0 || rest.includes('/')) return undefined;
  return rest;
};

const statusRank = (status: LibraryGameStatus): number => {
  switch (status) {
    case 'your-turn':
      return 0;
    case 'waiting':
      return 1;
    case 'won':
      return 2;
    case 'lost':
      return 3;
  }
};

const compareLibraryRows = (left: StartedGameRow, right: StartedGameRow): number => {
  const byStatus = statusRank(left.status) - statusRank(right.status);
  if (byStatus !== 0) return byStatus;
  const byGroup = compareStrings(left.groupHash, right.groupHash);
  if (byGroup !== 0) return byGroup;
  return compareStrings(right.gameNumber, left.gameNumber);
};

const lostPlayerIdsOf = (game: GameState): readonly string[] =>
  game.players
    .filter((player) => isLost(game, player, geometry))
    .map(String)
    .toSorted(compareStrings);

const librarySummaryFromGame = (game: GameState): LibrarySummary => {
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

const librarySummaryFromMeta = (meta: GameMeta): LibrarySummary | undefined => {
  if (meta.players === undefined || meta.activePlayer === undefined || meta.lostPlayers === undefined) {
    return undefined;
  }
  const summary: {
    players: readonly string[];
    activePlayer: string;
    lostPlayers: readonly string[];
    winner?: string;
  } = {
    players: meta.players,
    activePlayer: meta.activePlayer,
    lostPlayers: meta.lostPlayers,
  };
  if (meta.winner !== undefined) {
    summary.winner = meta.winner;
  }
  return summary;
};

export const stampLibrarySummary = async (
  s3: ObjectStore,
  groupHash: string,
  gameNumber: string,
  game: GameState,
): Promise<void> => {
  const key = gameMetaKey(groupHash, gameNumber);
  const raw = await getObject(s3, key);
  if (raw === undefined) return;
  const rec = asRecord(JSON.parse(raw) as unknown) ?? {};
  const summary = librarySummaryFromGame(game);
  const body: Record<string, unknown> = {
    ...rec,
    players: summary.players,
    activePlayer: summary.activePlayer,
    lostPlayers: summary.lostPlayers,
  };
  if (summary.winner !== undefined) {
    body['winner'] = summary.winner;
  }
  await putObject(s3, key, JSON.stringify(body));
};

const statusFromState = async (
  s3: ObjectStore,
  userHash: string,
  seats: GameMeta['seats'],
  pointer: GamePointer,
): Promise<LibraryGameStatus> => {
  const raw = await getObject(s3, gameStateKey(pointer.groupHash, pointer.gameNumber));
  if (raw === undefined) return 'waiting';
  const persisted = parsePersistedEnvelope(raw);
  if (persisted === undefined) return 'waiting';
  return libraryStatusFor(userHash, seats, librarySummaryFromGame(persisted.game));
};

const statusOfListedGame = async (
  s3: ObjectStore,
  userHash: string,
  pointer: GamePointer,
): Promise<LibraryGameStatus> => {
  const rawMeta = await getObject(s3, gameMetaKey(pointer.groupHash, pointer.gameNumber));
  const meta = rawMeta === undefined ? undefined : parseGameMeta(rawMeta);
  const seats = meta?.seats ?? [];
  const fromMeta = meta === undefined ? undefined : librarySummaryFromMeta(meta);
  if (fromMeta !== undefined) {
    return libraryStatusFor(userHash, seats, fromMeta);
  }
  return statusFromState(s3, userHash, seats, pointer);
};

const listGamePointers = async (
  s3: ObjectStore,
  userHash: string,
): Promise<readonly GamePointer[]> => {
  const prefix = userGroupPrefix(userHash);
  const groupKeys = [...(await listObjects(s3, prefix))].sort(compareStrings);
  const games: GamePointer[] = [];
  for (const key of groupKeys) {
    const groupHash = lastSegment(key, prefix);
    if (groupHash === undefined) continue;
    const gameKeys = [...(await listObjects(s3, gamesPrefix(groupHash)))].sort(compareStrings);
    for (const gameKey of gameKeys) {
      const match = GAME_META.exec(gameKey);
      const gameNumber = match?.[1];
      if (gameNumber !== undefined) games.push({ groupHash, gameNumber });
    }
  }
  return games;
};

export const listLibraryGames = async (
  s3: ObjectStore,
  userHash: string,
): Promise<readonly StartedGameRow[]> => {
  const pointers = await listGamePointers(s3, userHash);
  const games: StartedGameRow[] = [];
  for (const pointer of pointers) {
    games.push({
      groupHash: pointer.groupHash,
      gameNumber: pointer.gameNumber,
      status: await statusOfListedGame(s3, userHash, pointer),
    });
  }
  return games.toSorted(compareLibraryRows);
};
