import { onlinePlanProblem, type InviteSeat, type PlannedSeatKind } from '@conquarrow/contracts';

/** `deleted`: the game it started was deleted by its owner (P96 D5). */
export type InviteStatus = 'open' | 'revoked' | 'started' | 'deleted';

export interface InviteRecord {
  readonly status: InviteStatus;
  readonly creatorUserHash: string;
  readonly seats: readonly InviteSeat[];
  readonly gameNumber?: string;
  /** P96 D6: normalised at create. */
  readonly name?: string;
}

export const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const PLANNED_KINDS: ReadonlySet<unknown> = new Set<PlannedSeatKind>([
  'creator',
  'human',
  'creator-agent',
  'agent',
  'heuristic',
  'byok',
]);

export const parseKinds = (seats: readonly unknown[]): PlannedSeatKind[] | undefined => {
  const kinds: PlannedSeatKind[] = [];
  for (const seat of seats) {
    if (!PLANNED_KINDS.has(seat)) return undefined;
    kinds.push(seat as PlannedSeatKind);
  }
  return kinds;
};

/** P106: the shared check; the creator's chair is wherever `creator` is. */
export const validatePlan = (kinds: readonly PlannedSeatKind[]): boolean => onlinePlanProblem(kinds) === undefined;

/** P106: `creator` binds the creator; `creator-agent` keeps an agent chair for them. */
export const seatsFromPlan = (kinds: readonly PlannedSeatKind[], userHash: string): InviteSeat[] =>
  kinds.map((kind): InviteSeat => {
    if (kind === 'creator') return { kind: 'human', userHash };
    if (kind === 'creator-agent') return { kind: 'agent', reservedFor: userHash };
    if (kind === 'agent') return { kind: 'agent' };
    if (kind === 'human') return { kind: 'human' };
    return { kind: 'heuristic' };
  });

const parseSeat = (value: unknown): InviteSeat | undefined => {
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  const kind = rec['kind'];
  if (kind === 'heuristic') return { kind: 'heuristic' };
  if (kind === 'agent') {
    const userHash = rec['userHash'];
    if (typeof userHash === 'string') return { kind: 'agent', userHash };
    const reservedFor = rec['reservedFor'];
    if (typeof reservedFor === 'string' && reservedFor !== '') return { kind: 'agent', reservedFor };
    return { kind: 'agent' };
  }
  if (kind !== 'human') return undefined;
  const userHash = rec['userHash'];
  if (typeof userHash === 'string') return { kind: 'human', userHash };
  return { kind: 'human' };
};

export const parseSeats = (seatsRaw: unknown): InviteSeat[] | undefined => {
  if (!Array.isArray(seatsRaw)) return undefined;
  const seats: InviteSeat[] = [];
  for (const item of seatsRaw) {
    const seat = parseSeat(item);
    if (seat === undefined) return undefined;
    seats.push(seat);
  }
  return seats;
};

export const parseInvite = (raw: string): InviteRecord | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(parsed);
  if (rec === undefined) return undefined;
  const status = rec['status'];
  if (status !== 'open' && status !== 'revoked' && status !== 'started' && status !== 'deleted') {
    return undefined;
  }
  const creatorUserHash = rec['creatorUserHash'];
  if (typeof creatorUserHash !== 'string') return undefined;
  const seats = parseSeats(rec['seats']);
  if (seats === undefined) return undefined;
  const gameNumber = rec['gameNumber'];
  const name = rec['name'];
  return {
    status,
    creatorUserHash,
    seats,
    ...(typeof gameNumber === 'string' ? { gameNumber } : {}),
    ...(typeof name === 'string' ? { name } : {}),
  };
};

/** A chair as written: `reservedFor` may be `undefined`, which JSON.stringify omits. */
type StoredSeat =
  | Exclude<InviteSeat, { readonly kind: 'agent' }>
  | { readonly kind: 'agent'; readonly userHash: string }
  | { readonly kind: 'agent'; readonly reservedFor: string | undefined };

export const serializeInvite = (invite: InviteRecord): string => {
  const body: {
    status: InviteStatus;
    creatorUserHash: string;
    seats: StoredSeat[];
    gameNumber?: string;
    name?: string;
  } = {
    status: invite.status,
    creatorUserHash: invite.creatorUserHash,
    seats: invite.seats.map((seat) => {
      if (seat.kind === 'heuristic') return { kind: 'heuristic' as const };
      if (seat.kind === 'agent') {
        const userHash = seat.userHash;
        if (userHash !== undefined) return { kind: 'agent' as const, userHash };
        // JSON.stringify drops an undefined field: an open chair stores `{ kind: 'agent' }`.
        return { kind: 'agent' as const, reservedFor: seat.reservedFor };
      }
      const userHash = seat.userHash;
      if (userHash === undefined) return { kind: 'human' as const };
      return { kind: 'human' as const, userHash };
    }),
  };
  if (invite.gameNumber !== undefined) {
    body.gameNumber = invite.gameNumber;
  }
  if (invite.name !== undefined) {
    body.name = invite.name;
  }
  return JSON.stringify(body);
};

export const boundUserHash = (seat: InviteSeat): string | undefined =>
  seat.kind === 'human' ? seat.userHash : undefined;

export const indexOfBoundUser = (
  seats: readonly InviteSeat[],
  userHash: string,
): number => {
  for (let i = 0; i < seats.length; i += 1) {
    const seat = seats[i];
    if (seat !== undefined && boundUserHash(seat) === userHash) return i;
  }
  return -1;
};

export const nextUnboundHumanIndex = (seats: readonly InviteSeat[]): number => {
  for (let i = 0; i < seats.length; i += 1) {
    const seat = seats[i];
    if (seat !== undefined && seat.kind === 'human' && seat.userHash === undefined) {
      return i;
    }
  }
  return -1;
};

export const allHumanSeatsBound = (seats: readonly InviteSeat[]): boolean => {
  for (const seat of seats) {
    if (seat.kind === 'human' && seat.userHash === undefined) return false;
  }
  return true;
};

export const boundHumanHashes = (seats: readonly InviteSeat[]): string[] => {
  const hashes: string[] = [];
  for (const seat of seats) {
    const hash = boundUserHash(seat);
    if (hash !== undefined) hashes.push(hash);
  }
  return hashes;
};

export const boundAgentUserHash = (seat: InviteSeat): string | undefined =>
  seat.kind === 'agent' ? seat.userHash : undefined;

export const indexOfBoundAgent = (seats: readonly InviteSeat[], userHash: string): number => {
  for (let i = 0; i < seats.length; i += 1) {
    const seat = seats[i];
    if (seat !== undefined && boundAgentUserHash(seat) === userHash) return i;
  }
  return -1;
};

/** The next open (unbound, unreserved) agent chair; a reserved chair is never offered to anyone. */
export const nextUnboundAgentIndex = (seats: readonly InviteSeat[]): number =>
  seats.findIndex((seat) => seat.kind === 'agent' && seat.userHash === undefined && seat.reservedFor === undefined);

/** P106: does `userHash`'s agent hold the chair at `index`? */
export const holdsAgentSeatAt = (seats: readonly InviteSeat[], userHash: string, index: number): boolean =>
  seats.some((seat, i) => i === index && boundAgentUserHash(seat) === userHash);

/**
 * P106: an unbound agent chair kept for `userHash`'s own agent. Only an
 * unbound agent chair ever carries `reservedFor` (create writes it; `parseSeat`
 * drops it on a bound or human chair; binding drops it), so one read answers.
 */
const reservedUnboundFor = (seat: InviteSeat, userHash: string): boolean =>
  (seat as { readonly reservedFor?: string }).reservedFor === userHash;

/** P106: every chair reserved for `userHash`, bound to them (reservation dropped); `undefined` when none. */
export const bindReservedAgents = (
  seats: readonly InviteSeat[],
  userHash: string,
): InviteSeat[] | undefined => {
  if (!seats.some((seat) => reservedUnboundFor(seat, userHash))) return undefined;
  return seats.map((seat) => (reservedUnboundFor(seat, userHash) ? { kind: 'agent', userHash } : seat));
};

export const allAgentSeatsBound = (seats: readonly InviteSeat[]): boolean => {
  for (const seat of seats) {
    if (seat.kind === 'agent' && seat.userHash === undefined) return false;
  }
  return true;
};

export const allBindableSeatsBound = (seats: readonly InviteSeat[]): boolean =>
  allHumanSeatsBound(seats) && allAgentSeatsBound(seats);

export const boundAgentHashes = (seats: readonly InviteSeat[]): string[] => {
  const hashes: string[] = [];
  for (const seat of seats) {
    const hash = boundAgentUserHash(seat);
    if (hash !== undefined) hashes.push(hash);
  }
  return hashes;
};

/** Human chair if the caller has one, otherwise the agent chair. */
export const indexOfCallerSeat = (seats: readonly InviteSeat[], userHash: string): number => {
  const human = indexOfBoundUser(seats, userHash);
  if (human >= 0) return human;
  return indexOfBoundAgent(seats, userHash);
};

export const isBoundMember = (seats: readonly InviteSeat[], userHash: string): boolean =>
  indexOfCallerSeat(seats, userHash) >= 0;

export const seatsEqual = (
  left: readonly InviteSeat[] | undefined,
  right: readonly InviteSeat[],
): boolean => {
  if (left === undefined || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === undefined || b === undefined) return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'human' && b.kind === 'human' && a.userHash !== b.userHash) return false;
    if (a.kind === 'agent' && b.kind === 'agent' && a.userHash !== b.userHash) return false;
  }
  return true;
};

export type GameMeta = {
  readonly seats: readonly InviteSeat[];
  readonly winner?: string;
  readonly inviteToken?: string;
  readonly players?: readonly string[];
  readonly activePlayer?: string;
  readonly lostPlayers?: readonly string[];
  /** ISO-8601 UTC written at Start; omitted on pre-P46 meta. */
  readonly startedAt?: string;
  /** P96 D4: the invite's creator, copied at Start; omitted on pre-P96 meta. */
  readonly ownerUserHash?: string;
  /** P96 D6. */
  readonly name?: string;
  /** P96 D7: ISO-8601 UTC of the last persisted version. */
  readonly lastActivityAt?: string;
  /** P96 D7: `endTurn` moves in the log at the last persist. */
  readonly turns?: number;
};

const parseStringList = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    items.push(item);
  }
  return items;
};

const libraryFieldsOf = (
  rec: Record<string, unknown>,
): Pick<GameMeta, 'players' | 'activePlayer' | 'lostPlayers'> => {
  const players = parseStringList(rec['players']);
  const lostPlayers = parseStringList(rec['lostPlayers']);
  const activePlayer = rec['activePlayer'];
  if (players === undefined || lostPlayers === undefined || typeof activePlayer !== 'string') {
    return {};
  }
  return { players, activePlayer, lostPlayers };
};

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const p96FieldsOf = (
  rec: Record<string, unknown>,
): Pick<GameMeta, 'ownerUserHash' | 'name' | 'lastActivityAt' | 'turns'> => {
  const ownerUserHash = nonEmpty(rec['ownerUserHash']);
  const name = nonEmpty(rec['name']);
  const lastActivityAt = nonEmpty(rec['lastActivityAt']);
  const turns = rec['turns'];
  return {
    ...(ownerUserHash === undefined ? {} : { ownerUserHash }),
    ...(name === undefined ? {} : { name }),
    ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
    ...(typeof turns === 'number' && Number.isInteger(turns) && turns >= 0 ? { turns } : {}),
  };
};

export const parseGameMeta = (raw: string): GameMeta | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(parsed);
  if (rec === undefined) return undefined;
  const seats = parseSeats(rec['seats']);
  if (seats === undefined) return undefined;
  const winner = rec['winner'];
  const inviteToken = rec['inviteToken'];
  const startedAt = rec['startedAt'];
  return {
    seats,
    ...(typeof winner === 'string' ? { winner } : {}),
    ...(typeof inviteToken === 'string' ? { inviteToken } : {}),
    ...libraryFieldsOf(rec),
    ...(typeof startedAt === 'string' && startedAt !== '' ? { startedAt } : {}),
    ...p96FieldsOf(rec),
  };
};
