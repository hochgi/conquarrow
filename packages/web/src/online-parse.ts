/**
 * JSON bodies the Pages adapter reads from the injected fetch fake.
 *
 * @see docs/spec/online-web/online-web.md
 */

import type {
  InviteSeat,
  LibraryGameStatus,
  LibrarySeat,
  MyGamesBody,
  OnlineGameBoard,
  OpenLobbyRow,
  StartedGameRow,
  StateChangedPayload,
  UserHash,
} from '@conquarrow/contracts';

export const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

export const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

const parseSeat = (raw: unknown): InviteSeat | undefined => {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const kind = rec['kind'];
  if (kind === 'heuristic') return { kind: 'heuristic' };
  if (kind !== 'human') return undefined;
  const userHash = rec['userHash'];
  if (typeof userHash === 'string') return { kind: 'human', userHash };
  return { kind: 'human' };
};

export const parseSeats = (raw: unknown): readonly InviteSeat[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const seats: InviteSeat[] = [];
  for (const entry of raw) {
    const seat = parseSeat(entry);
    if (seat === undefined) return undefined;
    seats.push(seat);
  }
  return seats;
};

export const parseInviteToken = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw !== '' ? raw : undefined;

export const parseUserHash = (raw: unknown): UserHash | undefined =>
  typeof raw === 'string' && raw !== '' ? raw : undefined;

export const parseGoneReason = (raw: unknown): 'revoked' | 'started' | undefined => {
  const rec = asRecord(raw);
  const reason = rec?.['reason'];
  if (reason === 'revoked' || reason === 'started') return reason;
  return undefined;
};

export const parseStartIds = (
  raw: unknown,
): { readonly groupHash: string; readonly gameNumber: string } | undefined => {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const groupHash = rec['groupHash'];
  const gameNumber = rec['gameNumber'];
  if (typeof groupHash !== 'string' || groupHash === '') return undefined;
  if (typeof gameNumber !== 'string' || gameNumber === '') return undefined;
  return { groupHash, gameNumber };
};

export const parseBoard = (raw: unknown): OnlineGameBoard | undefined => {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const version = rec['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return undefined;
  }
  const rawSeats = rec['seats'];
  if (rawSeats === undefined) return { version, state: rec['state'] };
  const seats = parseSeats(rawSeats);
  if (seats === undefined) return undefined;
  return { version, state: rec['state'], seats };
};

const parseLobbyRow = (raw: unknown): OpenLobbyRow | undefined => {
  const rec = asRecord(raw);
  const token = rec?.['token'];
  if (typeof token !== 'string' || token === '') return undefined;
  return { token };
};

const isLibraryStatus = (value: unknown): value is LibraryGameStatus =>
  value === 'your-turn' || value === 'waiting' || value === 'won' || value === 'lost';

const parseLibrarySeat = (raw: unknown): LibrarySeat | undefined => {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const kind = rec['kind'];
  if (kind !== 'human' && kind !== 'heuristic') return undefined;
  const label = rec['label'];
  const you = rec['you'];
  if (typeof label !== 'string' || typeof you !== 'boolean') return undefined;
  return { kind, label, you };
};

const parseLibrarySeats = (raw: unknown): readonly LibrarySeat[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const seats: LibrarySeat[] = [];
  for (const entry of raw) {
    const seat = parseLibrarySeat(entry);
    if (seat === undefined) return undefined;
    seats.push(seat);
  }
  return seats;
};

const parseGameRow = (raw: unknown): StartedGameRow | undefined => {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const groupHash = rec['groupHash'];
  const gameNumber = rec['gameNumber'];
  const status = rec['status'];
  if (typeof groupHash !== 'string' || groupHash === '') return undefined;
  if (typeof gameNumber !== 'string' || gameNumber === '') return undefined;
  if (!isLibraryStatus(status)) return undefined;
  const seats = parseLibrarySeats(rec['seats']);
  if (seats === undefined) return undefined;
  const seatIndexRaw = rec['seatIndex'];
  if (typeof seatIndexRaw !== 'number' || !Number.isInteger(seatIndexRaw) || seatIndexRaw < 0) {
    return undefined;
  }
  const row: StartedGameRow = { groupHash, gameNumber, status, seats, seatIndex: seatIndexRaw };
  const startedAt = rec['startedAt'];
  if (typeof startedAt === 'string' && startedAt !== '') {
    return { ...row, startedAt };
  }
  return row;
};

export const parseMyGames = (raw: unknown): MyGamesBody | undefined => {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const lobbiesRaw = rec['lobbies'];
  const gamesRaw = rec['games'];
  if (!Array.isArray(lobbiesRaw) || !Array.isArray(gamesRaw)) return undefined;
  const lobbies: OpenLobbyRow[] = [];
  for (const row of lobbiesRaw) {
    const parsed = parseLobbyRow(row);
    if (parsed === undefined) return undefined;
    lobbies.push(parsed);
  }
  const games: StartedGameRow[] = [];
  for (const row of gamesRaw) {
    const parsed = parseGameRow(row);
    if (parsed === undefined) return undefined;
    games.push(parsed);
  }
  return { lobbies, games };
};

export const winnerOf = (state: unknown): string | undefined => {
  const rec = asRecord(state);
  const winner = rec?.['winner'];
  return typeof winner === 'string' ? winner : undefined;
};

export const activePlayerOf = (state: unknown): string | undefined => {
  const rec = asRecord(state);
  const active = rec?.['activePlayer'];
  return typeof active === 'string' ? active : undefined;
};

export const playersOf = (state: unknown): readonly string[] | undefined => {
  const rec = asRecord(state);
  const players = rec?.['players'];
  if (!Array.isArray(players)) return undefined;
  if (!players.every((id): id is string => typeof id === 'string')) return undefined;
  return players;
};

export const quotedVersion = (version: number): string => `"${String(version)}"`;

/** WS `onmessage` text — only a complete `stateChanged` object is forwarded. */
export const parseStateChanged = (raw: string): StateChangedPayload | undefined => {
  const rec = asRecord(parseJson(raw));
  if (rec === undefined) return undefined;
  if (rec['type'] !== 'stateChanged') return undefined;
  const version = rec['version'];
  const groupHash = rec['groupHash'];
  const gameNumber = rec['gameNumber'];
  if (typeof version !== 'number' || !Number.isInteger(version)) return undefined;
  if (typeof groupHash !== 'string' || groupHash === '') return undefined;
  if (typeof gameNumber !== 'string' || gameNumber === '') return undefined;
  return { type: 'stateChanged', version, groupHash, gameNumber };
};
