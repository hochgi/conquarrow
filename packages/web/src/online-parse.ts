/**
 * JSON bodies the Pages adapter reads from the injected fetch fake.
 *
 * @see docs/spec/online-web/online-web.md
 */

import type {
  InviteSeat,
  LibraryChangedPayload,
  LibraryCounts,
  LibraryGameStatus,
  LibraryList,
  LibraryPageBody,
  LibrarySeat,
  LibrarySection,
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

/** Any string, including empty. Missing or non-string is absent. */
const hashField = (raw: unknown): string | undefined =>
  typeof raw === 'string' ? raw : undefined;

/** A label the GET already sent. Empty and non-strings are dropped. */
const agentLabel = (raw: unknown): string | undefined =>
  typeof raw === 'string' && raw !== '' ? raw : undefined;

const humanSeat = (userHash: unknown): InviteSeat => {
  const hash = hashField(userHash);
  return hash === undefined ? { kind: 'human' } : { kind: 'human', userHash: hash };
};

/**
 * Keeps a non-empty string `label` on an agent only. A label on a human or a
 * heuristic is not read. `userHash` keeps today's rule: any string, or absent.
 */
const agentSeat = (userHash: unknown, label: unknown): InviteSeat => {
  const hash = hashField(userHash);
  const name = agentLabel(label);
  if (hash !== undefined && name !== undefined) return { kind: 'agent', userHash: hash, label: name };
  if (hash !== undefined) return { kind: 'agent', userHash: hash };
  if (name !== undefined) return { kind: 'agent', label: name };
  return { kind: 'agent' };
};

const parseSeat = (raw: unknown): InviteSeat | undefined => {
  const rec = asRecord(raw);
  if (rec === undefined) return undefined;
  const kind = rec['kind'];
  if (kind === 'heuristic') return { kind: 'heuristic' };
  if (kind === 'human') return humanSeat(rec['userHash']);
  if (kind === 'agent') return agentSeat(rec['userHash'], rec['label']);
  return undefined;
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

export const parseGoneReason = (raw: unknown): 'revoked' | 'started' | 'deleted' | undefined => {
  const rec = asRecord(raw);
  const reason = rec?.['reason'];
  if (reason === 'revoked' || reason === 'started' || reason === 'deleted') return reason;
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
  const name = rec['name'];
  const owner = rec['owner'];
  // P96 D6, D4: the name and whether the caller owns the game.
  const extra = {
    ...(typeof name === 'string' && name !== '' ? { name } : {}),
    ...(typeof owner === 'boolean' ? { owner } : {}),
  };
  const rawSeats = rec['seats'];
  if (rawSeats === undefined) return { version, state: rec['state'], ...extra };
  const seats = parseSeats(rawSeats);
  if (seats === undefined) return undefined;
  return { version, state: rec['state'], seats, ...extra };
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
  if (kind !== 'human' && kind !== 'heuristic' && kind !== 'agent') return undefined;
  const label = rec['label'];
  const you = rec['you'];
  if (typeof label !== 'string' || typeof you !== 'boolean') return undefined;
  return { kind, label, you };
};

const parseLibrarySeats = (raw: unknown): readonly LibrarySeat[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length < 1 || raw.length > 6) return undefined;
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
  if (
    typeof seatIndexRaw !== 'number' ||
    !Number.isInteger(seatIndexRaw) ||
    seatIndexRaw < 0 ||
    seatIndexRaw >= seats.length
  ) {
    return undefined;
  }
  const row: StartedGameRow = {
    groupHash,
    gameNumber,
    status,
    seats,
    seatIndex: seatIndexRaw,
    section: isLibrarySection(rec['section']) ? rec['section'] : sectionOfStatus(status),
    ...optionalRowFields(rec, seats.length),
    owner: rec['owner'] === true,
    hidden: rec['hidden'] === true,
  };
  return row;
};

const isLibrarySection = (value: unknown): value is LibrarySection =>
  value === 'your-turn' || value === 'waiting' || value === 'finished';

/** P96 D8: a row from before P96 carries no section; its status names it. */
const sectionOfStatus = (status: LibraryGameStatus): LibrarySection =>
  status === 'won' || status === 'lost' ? 'finished' : status;

const seatIndexIn = (value: unknown, seatCount: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < seatCount;

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** The optional P46/P96 row fields; a malformed one is dropped, not fatal. */
const optionalRowFields = (
  rec: Record<string, unknown>,
  seatCount: number,
): Pick<StartedGameRow, 'startedAt' | 'name' | 'lastActivityAt' | 'turns' | 'activeSeat' | 'winner'> => {
  const { startedAt, name, lastActivityAt, turns, activeSeat } = rec;
  const winner = asRecord(rec['winner']);
  const winnerSeat = winner?.['seat'];
  const winnerLabel = winner?.['label'];
  return {
    ...(nonEmptyString(startedAt) ? { startedAt } : {}),
    ...(nonEmptyString(name) ? { name } : {}),
    ...(nonEmptyString(lastActivityAt) ? { lastActivityAt } : {}),
    ...(typeof turns === 'number' && Number.isInteger(turns) && turns >= 0 ? { turns } : {}),
    ...(seatIndexIn(activeSeat, seatCount) ? { activeSeat } : {}),
    ...(seatIndexIn(winnerSeat, seatCount) && typeof winnerLabel === 'string'
      ? { winner: { seat: winnerSeat, label: winnerLabel } }
      : {}),
  };
};

const LISTS: readonly LibraryList[] = ['your-turn', 'waiting', 'finished', 'hidden'];

const countOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

/** P96 D8: the server's counts; a body without them (pre-P96) counts its own rows. */
const parseCounts = (raw: unknown, games: readonly StartedGameRow[]): LibraryCounts => {
  const rec = asRecord(raw);
  const counted = (list: LibraryList): number =>
    countOf(rec?.[list]) ??
    games.filter((row) => (list === 'hidden' ? row.hidden : !row.hidden && row.section === list)).length;
  return {
    'your-turn': counted('your-turn'),
    waiting: counted('waiting'),
    finished: counted('finished'),
    hidden: counted('hidden'),
  };
};

const parseRows = (raw: unknown): readonly StartedGameRow[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const games: StartedGameRow[] = [];
  for (const row of raw) {
    const parsed = parseGameRow(row);
    if (parsed === undefined) return undefined;
    games.push(parsed);
  }
  return games;
};

/** P96 D8: one page of one list. */
export const parseLibraryPage = (raw: unknown): LibraryPageBody | undefined => {
  const rec = asRecord(raw);
  const section = rec?.['section'];
  if (rec === undefined || !LISTS.some((list) => list === section)) return undefined;
  const offset = countOf(rec['offset']);
  const limit = countOf(rec['limit']);
  const total = countOf(rec['total']);
  const games = parseRows(rec['games']);
  if (offset === undefined || limit === undefined || total === undefined || games === undefined) {
    return undefined;
  }
  return { section: section as LibraryList, offset, limit, total, games };
};

/** WS text — a complete `libraryChanged` object (P96 D5, D6). */
export const parseLibraryChanged = (raw: string): LibraryChangedPayload | undefined => {
  const rec = asRecord(parseJson(raw));
  if (rec?.['type'] !== 'libraryChanged') return undefined;
  const { groupHash, gameNumber, change } = rec;
  if (!nonEmptyString(groupHash) || !nonEmptyString(gameNumber)) return undefined;
  if (change !== 'deleted' && change !== 'renamed') return undefined;
  return { type: 'libraryChanged', groupHash, gameNumber, change };
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
  const games = parseRows(gamesRaw);
  if (games === undefined) return undefined;
  return { lobbies, games, counts: parseCounts(rec['counts'], games) };
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
