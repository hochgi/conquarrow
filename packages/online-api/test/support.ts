/**
 * Test doubles and HTTP helpers for the P17 auth-invites and P18 moves-ws suites.
 *
 * Expected hashes are computed here with `node:crypto` so assertions do not
 * import production hashing. Production hashing lives in `src/hashing.ts`.
 */

import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type {
  ArrowId,
  CreateInviteBody,
  GameState,
  MergeOverride,
  Move,
  OnlineHeaders,
  OnlineHttpResult,
  OnlinePort,
  OnlineWsPort,
  PlannedSeatKind,
  StateChangedPayload,
} from '@conquarrow/contracts';
import {
  DEFAULT_MATCH_CONFIG,
  endTurn,
  mintArrowId,
  step,
} from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules, replay } from '@conquarrow/rules-core';
import { createOnlineApi, createOnlineWs } from '../src/create-online-api';
import type {
  GoogleVerifier,
  HeuristicChooser,
  ObjectPutOptions,
  ObjectStore,
  PostToConnection,
} from '../src/create-online-api';
import { PreconditionFailed } from '../src/create-online-api';

export const GAME_ONE = '000001';
export const GAME_TWO = '000002';

export const TWO_HUMAN_HEURISTIC: readonly PlannedSeatKind[] = [
  'human',
  'human',
  'heuristic',
];

export const SIX_HUMAN: readonly PlannedSeatKind[] = [
  'human',
  'human',
  'human',
  'human',
  'human',
  'human',
];

export const THREE_HUMAN: readonly PlannedSeatKind[] = ['human', 'human', 'human'];

export const HEURISTIC_THEN_TWO_HUMANS: readonly PlannedSeatKind[] = [
  'heuristic',
  'human',
  'human',
];

export const HUMAN_THEN_FOUR_HEURISTIC_THEN_HUMAN: readonly PlannedSeatKind[] = [
  'human',
  'heuristic',
  'heuristic',
  'heuristic',
  'heuristic',
  'human',
];

export const ALICE_CONN = 'conn-alice-1';
export const BOB_CONN = 'conn-bob-1';
export const CAROL_CONN = 'conn-carol-1';

export interface TestUser {
  readonly bearer: string;
  readonly sub: string;
}

export const ALICE: TestUser = { bearer: 'alice-token', sub: 'alice-sub' };
export const BOB: TestUser = { bearer: 'bob-token', sub: 'bob-sub' };
export const CAROL: TestUser = { bearer: 'carol-token', sub: 'carol-sub' };
export const DAVE: TestUser = { bearer: 'dave-token', sub: 'dave-sub' };
export const ED: TestUser = { bearer: 'ed-token', sub: 'ed-sub' };
export const FAY: TestUser = { bearer: 'fay-token', sub: 'fay-sub' };
export const GINA: TestUser = { bearer: 'gina-token', sub: 'gina-sub' };

export const EXPIRED_BEARER = 'expired-token';
export const INVALID_BEARER = 'invalid-token';

const KNOWN_USERS: readonly TestUser[] = [ALICE, BOB, CAROL, DAVE, ED, FAY, GINA];

/** First 16 bytes of SHA-256, lowercase hex (32 characters). */
export const truncate16Sha256 = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 32);

export const userHashOf = (sub: string): string => truncate16Sha256(sub);

export const groupHashOfUserHashes = (userHashes: readonly string[]): string => {
  const sorted = [...userHashes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return truncate16Sha256(sorted.join('\n'));
};

export const aliceHash = (): string => userHashOf(ALICE.sub);
export const bobHash = (): string => userHashOf(BOB.sub);
export const carolHash = (): string => userHashOf(CAROL.sub);
export const daveHash = (): string => userHashOf(DAVE.sub);
export const fayHash = (): string => userHashOf(FAY.sub);
export const aliceBobGroupHash = (): string =>
  groupHashOfUserHashes([aliceHash(), bobHash()]);
export const aliceBobCarolGroupHash = (): string =>
  groupHashOfUserHashes([aliceHash(), bobHash(), carolHash()]);
export const aliceFayGroupHash = (): string =>
  groupHashOfUserHashes([aliceHash(), fayHash()]);

export const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export const sequentialBytes = (): ((size: number) => Uint8Array) => {
  let n = 0;
  return (size: number): Uint8Array => {
    n += 1;
    const bytes = new Uint8Array(size);
    if (bytes.length > 0) {
      bytes[0] = n & 0xff;
    }
    return bytes;
  };
};

export const fixedBytes =
  (bytes: Uint8Array): ((size: number) => Uint8Array) =>
  (size: number): Uint8Array => {
    const out = new Uint8Array(size);
    out.set(bytes.subarray(0, size));
    return out;
  };

export const fakeGoogle = (): GoogleVerifier => ({
  verify: (authorizationHeader) => {
    if (authorizationHeader === undefined || authorizationHeader === '') {
      return { ok: false, reason: 'missing' };
    }
    const match = /^Bearer\s+(\S+)$/.exec(authorizationHeader);
    const token = match?.[1];
    if (token === undefined) {
      return { ok: false, reason: 'invalid' };
    }
    if (token === EXPIRED_BEARER) {
      return { ok: false, reason: 'expired' };
    }
    if (token === INVALID_BEARER) {
      return { ok: false, reason: 'invalid' };
    }
    const user = KNOWN_USERS.find((u) => u.bearer === token);
    if (user === undefined) {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: true, sub: user.sub };
  },
});

export const mapStore = (data: Map<string, string>): ObjectStore => ({
  get: (key) => data.get(key),
  put: (key, body, options?: ObjectPutOptions) => {
    const current = data.get(key);
    if (options?.ifNoneMatch === '*' && current !== undefined) {
      throw new PreconditionFailed();
    }
    if (options?.ifMatch !== undefined && current !== options.ifMatch) {
      throw new PreconditionFailed();
    }
    data.set(key, body);
  },
  delete: (key) => {
    data.delete(key);
  },
  listPrefix: (prefix) =>
    [...data.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
});

/**
 * Two overlapping `get`s of matching keys both observe the pre-put value.
 * Used to express concurrent accept / ensure / Start without an HTTP If-Match
 * on accept (the server retries internally).
 */
export const overlappingGetStore = (
  data: Map<string, string>,
  shouldBarrier: (key: string) => boolean,
): ObjectStore & { arm: () => void } => {
  let armed = false;
  let arrivals = 0;
  const waiters: Array<() => void> = [];
  const releaseAll = (): void => {
    for (const waiter of waiters) waiter();
    waiters.length = 0;
  };
  const inner = mapStore(data);
  return {
    arm: () => {
      armed = true;
    },
    get: async (key) => {
      if (armed && shouldBarrier(key)) {
        arrivals += 1;
        if (arrivals < 2) {
          await new Promise<void>((resolve) => {
            waiters.push(resolve);
          });
        } else {
          releaseAll();
        }
      }
      return inner.get(key);
    },
    put: inner.put,
    delete: inner.delete,
    listPrefix: inner.listPrefix,
  };
};

export const countingPutStore = (
  data: Map<string, string>,
): ObjectStore & { readonly puts: string[] } => {
  const puts: string[] = [];
  const inner = mapStore(data);
  return {
    get: inner.get,
    delete: inner.delete,
    listPrefix: inner.listPrefix,
    put: async (key, body, options?) => {
      await Promise.resolve(inner.put(key, body, options));
      puts.push(key);
    },
    puts,
  };
};

export const throwingPutStore = (
  data: Map<string, string>,
  shouldThrow: (key: string) => boolean,
): ObjectStore => {
  const inner = mapStore(data);
  return {
    get: inner.get,
    delete: inner.delete,
    listPrefix: inner.listPrefix,
    put: (key, body, options?) => {
      if (shouldThrow(key)) throw new Error('persist interrupted');
      void inner.put(key, body, options);
    },
  };
};

export type NotifyRecord = {
  readonly connectionId: string;
  readonly payload: StateChangedPayload;
};

export const alwaysEndTurn: HeuristicChooser = (_state) => endTurn();

export const makeHarness = (overrides?: {
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly clock?: () => number;
  readonly heuristic?: HeuristicChooser;
  readonly postToConnection?: PostToConnection;
  readonly s3?: Map<string, string>;
  readonly store?: ObjectStore;
  readonly goneConnectionIds?: ReadonlySet<string>;
}): {
  api: OnlinePort;
  ws: OnlineWsPort;
  s3: Map<string, string>;
  notifies: NotifyRecord[];
  heuristicAsks: GameState[];
} => {
  const s3 = overrides?.s3 ?? new Map<string, string>();
  const notifies: NotifyRecord[] = [];
  const heuristicAsks: GameState[] = [];
  const innerHeuristic = overrides?.heuristic ?? alwaysEndTurn;
  const heuristic: HeuristicChooser = (state) => {
    heuristicAsks.push(state);
    return innerHeuristic(state);
  };
  const gone = overrides?.goneConnectionIds ?? new Set<string>();
  const postToConnection: PostToConnection = async (connectionId, payload) => {
    if (overrides?.postToConnection !== undefined) {
      const status = await Promise.resolve(
        overrides.postToConnection(connectionId, payload),
      );
      notifies.push({ connectionId, payload });
      return status;
    }
    notifies.push({ connectionId, payload });
    return gone.has(connectionId) ? 410 : 200;
  };
  const deps = {
    google: fakeGoogle(),
    s3: overrides?.store ?? mapStore(s3),
    clock: overrides?.clock ?? ((): number => 0),
    randomBytes: overrides?.randomBytes ?? sequentialBytes(),
    heuristic,
    postToConnection,
  };
  return {
    api: createOnlineApi(deps),
    ws: createOnlineWs(deps),
    s3,
    notifies,
    heuristicAsks,
  };
};

const authHeaders = (bearer: string): OnlineHeaders => ({
  authorization: `Bearer ${bearer}`,
});

export const getMe = (api: OnlinePort, bearer?: string): Promise<OnlineHttpResult> =>
  api.handle({
    method: 'GET',
    path: '/me',
    ...(bearer === undefined ? {} : { headers: authHeaders(bearer) }),
  });

export const getMyGames = (
  api: OnlinePort,
  bearer?: string,
): Promise<OnlineHttpResult> =>
  api.handle({
    method: 'GET',
    path: '/my-games',
    ...(bearer === undefined ? {} : { headers: authHeaders(bearer) }),
  });

export const getInvite = (
  api: OnlinePort,
  token: string,
  bearer?: string,
): Promise<OnlineHttpResult> =>
  api.handle({
    method: 'GET',
    path: `/invites/${token}`,
    ...(bearer === undefined ? {} : { headers: authHeaders(bearer) }),
  });

export const postJson = (
  api: OnlinePort,
  path: string,
  bearer: string | undefined,
  body?: unknown,
): Promise<OnlineHttpResult> =>
  api.handle({
    method: 'POST',
    path,
    ...(bearer === undefined ? {} : { headers: authHeaders(bearer) }),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const postInvites = (
  api: OnlinePort,
  bearer: string,
  body: CreateInviteBody,
): Promise<OnlineHttpResult> => postJson(api, '/invites', bearer, body);

export const postAccept = (
  api: OnlinePort,
  token: string,
  bearer: string | undefined,
): Promise<OnlineHttpResult> => postJson(api, `/invites/${token}/accept`, bearer);

export const postRevoke = (
  api: OnlinePort,
  token: string,
  bearer: string,
): Promise<OnlineHttpResult> => postJson(api, `/invites/${token}/revoke`, bearer);

export const postStart = (
  api: OnlinePort,
  token: string,
  bearer: string,
): Promise<OnlineHttpResult> => postJson(api, `/invites/${token}/start`, bearer);

export const parseBody = (res: OnlineHttpResult): unknown =>
  JSON.parse(res.body) as unknown;

export const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
};

export const tokenOf = (value: unknown): string => {
  const token = asRecord(value)['token'];
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error('expected body.token to be a non-empty string');
  }
  return token;
};

export const seatsOf = (value: unknown): readonly Record<string, unknown>[] => {
  const seats = asRecord(value)['seats'];
  if (!Array.isArray(seats)) {
    throw new Error('expected body.seats to be an array');
  }
  return seats.map((seat, i) => {
    if (typeof seat !== 'object' || seat === null || Array.isArray(seat)) {
      throw new Error(`expected seats[${String(i)}] to be an object`);
    }
    return seat as Record<string, unknown>;
  });
};

export type SeatSummary =
  | { readonly kind: 'human'; readonly userHash: string }
  | { readonly kind: 'human' }
  | { readonly kind: 'heuristic' };

export const boundUserHash = (seat: SeatSummary): string | undefined =>
  seat.kind === 'human' && 'userHash' in seat ? seat.userHash : undefined;

export const seatSummaries = (value: unknown): readonly SeatSummary[] =>
  seatsOf(value).map((seat, i) => {
    const kind = seat['kind'];
    if (kind === 'heuristic') {
      return { kind: 'heuristic' };
    }
    if (kind !== 'human') {
      throw new Error(`expected seats[${String(i)}].kind human|heuristic`);
    }
    const userHash = seat['userHash'];
    if (typeof userHash === 'string') {
      return { kind: 'human', userHash };
    }
    return { kind: 'human' };
  });

export const myGamesOf = (
  value: unknown,
): {
  readonly lobbies: readonly string[];
  readonly games: readonly { groupHash: string; gameNumber: string }[];
} => {
  const rec = asRecord(value);
  const lobbiesRaw = rec['lobbies'];
  const gamesRaw = rec['games'];
  if (!Array.isArray(lobbiesRaw) || !Array.isArray(gamesRaw)) {
    throw new Error('expected body.lobbies and body.games to be arrays');
  }
  const lobbies = lobbiesRaw.map((row, i) => {
    const token = asRecord(row)['token'];
    if (typeof token !== 'string') {
      throw new Error(`expected lobbies[${String(i)}].token`);
    }
    return token;
  });
  const games = gamesRaw.map((row, i) => {
    const recRow = asRecord(row);
    const groupHash = recRow['groupHash'];
    const gameNumber = recRow['gameNumber'];
    if (typeof groupHash !== 'string' || typeof gameNumber !== 'string') {
      throw new Error(`expected games[${String(i)}] groupHash and gameNumber strings`);
    }
    return { groupHash, gameNumber };
  });
  return { lobbies, games };
};

export const goneReason = (value: unknown): string => {
  const reason = asRecord(value)['reason'];
  if (typeof reason !== 'string') {
    throw new Error('expected body.reason to be a string');
  }
  return reason;
};

export const expectStatus = (
  res: OnlineHttpResult,
  status: number,
): OnlineHttpResult => {
  expect(res.statusCode).toBe(status);
  return res;
};

export const expectWsStatus = (
  res: { readonly statusCode: number },
  status: number,
): { readonly statusCode: number } => {
  expect(res.statusCode).toBe(status);
  return res;
};

export const expectNoSubLeak = (res: OnlineHttpResult, sub: string): void => {
  expect(res.body).not.toContain(sub);
  const parsed: unknown = parseBody(res);
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    expect(parsed).not.toHaveProperty('sub');
  }
};

export const inviteKey = (token: string): string =>
  `conquarrow/invites/${token}.json`;

export const lobbyKey = (userHash: string, token: string): string =>
  `conquarrow/users/${userHash}/lobbies/${token}`;

export const userGroupKey = (userHash: string, groupHash: string): string =>
  `conquarrow/users/${userHash}/groups/${groupHash}`;

export const groupMetaKey = (groupHash: string): string =>
  `conquarrow/groups/${groupHash}/meta.json`;

export const gameMetaKey = (groupHash: string, gameNumber: string): string =>
  `conquarrow/groups/${groupHash}/games/${gameNumber}/meta.json`;

export const groupAndGameKeys = (s3: ReadonlyMap<string, string>): readonly string[] =>
  [...s3.keys()]
    .filter((key) => key.includes('/groups/') || key.includes('/games/'))
    .sort();

export const playLogKeys = (s3: ReadonlyMap<string, string>): readonly string[] =>
  [...s3.keys()]
    .filter((key) => key.endsWith('/state.json') || key.endsWith('/log.jsonl'))
    .sort();

export const createOpenInvite = async (
  api: OnlinePort,
  creator: TestUser,
  seats: readonly PlannedSeatKind[] = TWO_HUMAN_HEURISTIC,
  hostSeatIndex?: number,
): Promise<string> => {
  const body: CreateInviteBody =
    hostSeatIndex === undefined ? { seats } : { seats, hostSeatIndex };
  const res = await postInvites(api, creator.bearer, body);
  expectStatus(res, 201);
  return tokenOf(parseBody(res));
};

export const bindAliceAndBob = async (api: OnlinePort): Promise<string> => {
  const token = await createOpenInvite(api, ALICE);
  expectStatus(await postAccept(api, token, BOB.bearer), 200);
  return token;
};

export const bindSixHumans = async (api: OnlinePort): Promise<string> => {
  const token = await createOpenInvite(api, ALICE, SIX_HUMAN);
  for (const user of [BOB, CAROL, DAVE, ED, FAY]) {
    expectStatus(await postAccept(api, token, user.bearer), 200);
  }
  return token;
};

export const startAliceBob = async (api: OnlinePort): Promise<string> => {
  const token = await bindAliceAndBob(api);
  expectStatus(await postStart(api, token, ALICE.bearer), 200);
  return token;
};

export const startAliceBobCarol = async (api: OnlinePort): Promise<string> => {
  const token = await createOpenInvite(api, ALICE, THREE_HUMAN);
  expectStatus(await postAccept(api, token, BOB.bearer), 200);
  expectStatus(await postAccept(api, token, CAROL.bearer), 200);
  expectStatus(await postStart(api, token, ALICE.bearer), 200);
  return token;
};

/** Seats heuristic, human, human — Alice at seat 1, Bob at seat 2. */
export const startHeuristicThenAliceBob = async (api: OnlinePort): Promise<string> => {
  const token = await createOpenInvite(api, ALICE, HEURISTIC_THEN_TWO_HUMANS, 1);
  expectStatus(await postAccept(api, token, BOB.bearer), 200);
  expectStatus(await postStart(api, token, ALICE.bearer), 200);
  return token;
};

/** Seats human, human, heuristic — Alice at seat 1, Bob at seat 0. */
export const startBobAliceHeuristic = async (api: OnlinePort): Promise<string> => {
  const token = await createOpenInvite(api, ALICE, TWO_HUMAN_HEURISTIC, 1);
  expectStatus(await postAccept(api, token, BOB.bearer), 200);
  expectStatus(await postStart(api, token, ALICE.bearer), 200);
  return token;
};

/** 6-seat: Alice, four heuristics, Fay. */
export const startAliceFayBurst = async (api: OnlinePort): Promise<string> => {
  const token = await createOpenInvite(api, ALICE, HUMAN_THEN_FOUR_HEURISTIC_THEN_HUMAN);
  expectStatus(await postAccept(api, token, FAY.bearer), 200);
  expectStatus(await postStart(api, token, ALICE.bearer), 200);
  return token;
};

export const quotedVersion = (version: number): string => `"${String(version)}"`;

export const gameHeaders = (bearer: string, version?: number): OnlineHeaders =>
  version === undefined
    ? { authorization: `Bearer ${bearer}` }
    : { authorization: `Bearer ${bearer}`, ifMatch: quotedVersion(version) };

export const getGame = (
  api: OnlinePort,
  groupHash: string,
  gameNumber: string,
  bearer?: string,
): Promise<OnlineHttpResult> =>
  api.handle({
    method: 'GET',
    path: `/games/${groupHash}/${gameNumber}`,
    ...(bearer === undefined ? {} : { headers: gameHeaders(bearer) }),
  });

export const postMove = (
  api: OnlinePort,
  groupHash: string,
  gameNumber: string,
  bearer: string | undefined,
  move: Move,
  version?: number,
): Promise<OnlineHttpResult> =>
  api.handle({
    method: 'POST',
    path: `/games/${groupHash}/${gameNumber}/moves`,
    ...(bearer === undefined
      ? version === undefined
        ? { body: JSON.stringify({ move }) }
        : { headers: { ifMatch: quotedVersion(version) }, body: JSON.stringify({ move }) }
      : {
          headers: gameHeaders(bearer, version),
          body: JSON.stringify({ move }),
        }),
  });

export const wsConnect = (
  ws: OnlineWsPort,
  connectionId: string,
  accessToken?: string,
): Promise<{ readonly statusCode: number }> =>
  ws.connect({
    connectionId,
    ...(accessToken === undefined ? {} : { accessToken }),
  });

export const wsDisconnect = (
  ws: OnlineWsPort,
  connectionId: string,
  userHash?: string,
): Promise<{ readonly statusCode: number }> =>
  ws.disconnect({
    connectionId,
    ...(userHash === undefined ? {} : { userHash }),
  });

export const gameStateKey = (groupHash: string, gameNumber: string): string =>
  `conquarrow/groups/${groupHash}/games/${gameNumber}/state.json`;

export const gameLogKey = (groupHash: string, gameNumber: string): string =>
  `conquarrow/groups/${groupHash}/games/${gameNumber}/log.jsonl`;

export const connectionKey = (userHash: string, connectionId: string): string =>
  `conquarrow/connections/${userHash}/${connectionId}`;

export const connectionIdKey = (connectionId: string): string =>
  `conquarrow/connection-ids/${connectionId}`;

export const connectionKeys = (s3: ReadonlyMap<string, string>): readonly string[] =>
  [...s3.keys()]
    .filter((key) => key.includes('/connections/'))
    .sort();

export const matchConfigForSeats = (playerCount: number) => ({
  ...DEFAULT_MATCH_CONFIG,
  playerCount,
});

export const openingMatch = (playerCount: number): GameState =>
  makeMatch(matchConfigForSeats(playerCount));

export const firstLegalStep = (state: GameState): Move => {
  const rules = makeRules(makeTiling());
  const found = rules.legalMoves(state).find((move) => move.kind === 'step');
  if (found === undefined) {
    throw new Error('setup: opening position has no legal step');
  }
  return found;
};

export const illegalStep = (): Move =>
  step(mintArrowId('no-such-from'), mintArrowId('no-such-exit'), 1);

export type StateSnapshot = {
  readonly players: readonly string[];
  readonly activePlayer: string;
  readonly groups: readonly {
    readonly arrow: string;
    readonly owner: string;
    readonly heads: number;
    readonly spent: number;
    readonly speedOverride?: MergeOverride;
  }[];
  readonly trails: readonly { readonly player: string; readonly arrows: readonly string[] }[];
  readonly territory: readonly { readonly arrow: string; readonly owner: string }[];
  readonly accumulators: readonly {
    readonly arrow: string;
    readonly num: number;
    readonly den: number;
  }[];
  readonly spawners: readonly {
    readonly vertex: string;
    readonly num: number;
    readonly den: number;
    readonly phase: number;
  }[];
  readonly starvationStreaks: readonly {
    readonly player: string;
    readonly streak: number;
  }[];
  readonly dominationN: number;
  readonly winner?: string;
};

/**
 * Total string order. `a < b ? -1 : 1` is not total (ADR 0001). Kept local
 * because this file's hashing assertions must not import production hashing.
 */
const byKey = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

export const snapshotState = (state: GameState): StateSnapshot => {
  const snap: {
    players: readonly string[];
    activePlayer: string;
    groups: StateSnapshot['groups'];
    trails: StateSnapshot['trails'];
    territory: StateSnapshot['territory'];
    accumulators: StateSnapshot['accumulators'];
    spawners: StateSnapshot['spawners'];
    starvationStreaks: StateSnapshot['starvationStreaks'];
    dominationN: number;
    winner?: string;
  } = {
    players: [...state.players].map(String),
    activePlayer: String(state.activePlayer),
    groups: [...state.groups.entries()]
      .map(([arrow, group]) =>
        group.speedOverride === undefined
          ? {
              arrow: String(arrow),
              owner: String(group.owner),
              heads: group.heads,
              spent: group.spent,
            }
          : {
              arrow: String(arrow),
              owner: String(group.owner),
              heads: group.heads,
              spent: group.spent,
              speedOverride: group.speedOverride,
            },
      )
      .toSorted((left, right) => byKey(left.arrow, right.arrow)),
    trails: [...state.trails.entries()]
      .map(([player, arrows]) => ({
        player: String(player),
        arrows: [...arrows].map(String).toSorted(),
      }))
      .toSorted((left, right) => byKey(left.player, right.player)),
    territory: [...state.territory.entries()]
      .map(([arrow, owner]) => ({ arrow: String(arrow), owner: String(owner) }))
      .toSorted((left, right) => byKey(left.arrow, right.arrow)),
    accumulators: [...state.accumulators.entries()]
      .map(([arrow, r]) => ({ arrow: String(arrow), num: r.num, den: r.den }))
      .toSorted((left, right) => byKey(left.arrow, right.arrow)),
    spawners: [...state.spawners.entries()]
      .map(([vertex, spawner]) => ({
        vertex: String(vertex),
        num: spawner.force.num,
        den: spawner.force.den,
        phase: spawner.phase,
      }))
      .toSorted((left, right) => byKey(left.vertex, right.vertex)),
    starvationStreaks: [...state.starvationStreaks.entries()]
      .map(([player, streak]) => ({ player: String(player), streak }))
      .toSorted((left, right) => byKey(left.player, right.player)),
    dominationN: state.dominationN,
  };
  if (state.winner !== undefined) {
    snap.winner = String(state.winner);
  }
  return snap;
};

export const persistEnvelope = (version: number, state: GameState): string =>
  JSON.stringify({ version, state: snapshotState(state) });

export const parsePersisted = (
  raw: string | undefined,
): { readonly version: number; readonly state: unknown } => {
  if (raw === undefined) {
    throw new Error('setup: expected state.json');
  }
  const rec = asRecord(JSON.parse(raw) as unknown);
  const version = rec['version'];
  if (typeof version !== 'number') {
    throw new Error('expected state.json.version to be a number');
  }
  return { version, state: rec['state'] };
};

export const parseLogJsonl = (raw: string | undefined): readonly Move[] => {
  if (raw === undefined || raw === '') return [];
  return raw
    .replace(/\n$/, '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Move);
};

export const foldLog = (playerCount: number, moves: readonly Move[]): GameState =>
  replay(makeRules(makeTiling()), openingMatch(playerCount), moves);

export const versionOf = (value: unknown): number => {
  const version = asRecord(value)['version'];
  if (typeof version !== 'number') {
    throw new Error('expected body.version to be a number');
  }
  return version;
};

export const stateOfBody = (value: unknown): unknown => asRecord(value)['state'];

export const winnerOf = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const winner = asRecord(value)['winner'];
  return typeof winner === 'string' ? winner : undefined;
};

export const activePlayerOf = (value: unknown): string => {
  const active = asRecord(value)['activePlayer'];
  if (typeof active !== 'string') {
    throw new Error('expected state.activePlayer to be a string');
  }
  return active;
};

export const playersOf = (value: unknown): readonly string[] => {
  const players = asRecord(value)['players'];
  if (!Array.isArray(players) || players.some((p) => typeof p !== 'string')) {
    throw new Error('expected state.players to be a string array');
  }
  return players as readonly string[];
};

export const storedVersion = (
  s3: ReadonlyMap<string, string>,
  groupHash: string,
  gameNumber: string,
): number | undefined => {
  const raw = s3.get(gameStateKey(groupHash, gameNumber));
  if (raw === undefined) return undefined;
  return parsePersisted(raw).version;
};

export const seedOpeningState = (
  s3: Map<string, string>,
  groupHash: string,
  gameNumber: string,
  playerCount: number,
): GameState => {
  const state = openingMatch(playerCount);
  s3.set(gameStateKey(groupHash, gameNumber), persistEnvelope(0, state));
  s3.set(gameLogKey(groupHash, gameNumber), '');
  return state;
};

export const seedFinishedState = (
  s3: Map<string, string>,
  groupHash: string,
  gameNumber: string,
  playerCount: number,
): { readonly winner: string; readonly version: number } => {
  const opening = openingMatch(playerCount);
  const winner = opening.players[0];
  if (winner === undefined) throw new Error('setup: makeMatch has no players');
  const finished: GameState = { ...opening, winner };
  s3.set(gameStateKey(groupHash, gameNumber), persistEnvelope(0, finished));
  s3.set(gameLogKey(groupHash, gameNumber), '');
  const metaKey = gameMetaKey(groupHash, gameNumber);
  const metaRaw = s3.get(metaKey);
  if (metaRaw === undefined) throw new Error('setup: expected game meta');
  const meta = asRecord(JSON.parse(metaRaw) as unknown);
  s3.set(metaKey, JSON.stringify({ ...meta, winner: String(winner) }));
  return { winner: String(winner), version: 0 };
};

/**
 * Arrows on the tiling that border no spawner of a three-seat opening — ground a
 * seat can hold without holding a share, which is what puts it on the clock.
 */
const shareFreeArrows = (howMany: number): readonly ArrowId[] => {
  const geometry = makeTiling();
  const opening = openingMatch(3);
  const shares = new Set<string>();
  for (const vertex of opening.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) shares.add(String(arrow));
  }
  const free = geometry
    .window(geometry.seedPoint(), 3)
    .arrows.filter((arrow) => !shares.has(String(arrow)) && !opening.territory.has(arrow))
    .toSorted((left, right) => byKey(String(left), String(right)));
  if (free.length < howMany) throw new Error('setup: not enough share-free arrows');
  return free.slice(0, howMany);
};

/**
 * A 3-player position where Alice (seat 1) `endTurn` leaves the last seat
 * (heuristic) active, and that seat's `endTurn` wraps the round and ends the
 * match — real `makeRules(makeTiling()).apply`, not a fake RulesPort.
 *
 * Seat plan: Bob at 0, Alice at 1, heuristic at 2 (`startBobAliceHeuristic`).
 *
 * **P36 rewrote how this position ends, and P37 rewrote it again.** P36's
 * version stripped territory from two of the three seats, so both were lost by
 * `T = 0`. That worked while loss resolved only at the round boundary; since P37
 * it resolves on the move that causes it, so the *human's* `endTurn` would end
 * the match and there would be no burst left to persist a winner during.
 *
 * So the two victims are put on the **starvation clock** instead: each keeps one
 * arrow of ordinary ground and its heads, owns no share, and carries a streak one
 * round short of the threshold. A streak still advances only at a full round
 * (P37 invariant 6), so Alice's `endTurn` resolves nothing and the heuristic
 * seat's `endTurn` wraps the round, ticks both clocks to the threshold, and
 * leaves Alice the last seat standing.
 */
export const authorWinningWrapState = (): {
  readonly state: GameState;
  readonly alicePlayer: string;
  readonly heuristicPlayer: string;
  readonly winner: string;
} => {
  const opening = openingMatch(3);
  const victim = opening.players[0];
  const alicePlayer = opening.players[1];
  const heuristicPlayer = opening.players[2];
  if (victim === undefined || alicePlayer === undefined || heuristicPlayer === undefined) {
    throw new Error('setup: expected 3 players');
  }
  const destitute = [victim, heuristicPlayer];
  const territory = new Map(
    [...opening.territory.entries()].filter(([, owner]) => !destitute.includes(owner)),
  );
  // One share-free arrow each: ground, so the seat is not lost outright, and no
  // spawner border, so it has no income and its clock runs.
  const shareFree = shareFreeArrows(destitute.length);
  destitute.forEach((seat, index) => {
    const arrow = shareFree[index];
    if (arrow === undefined) throw new Error('setup: no share-free arrow for a destitute seat');
    territory.set(arrow, seat);
  });
  const state: GameState = {
    ...opening,
    activePlayer: alicePlayer,
    territory,
    starvationStreaks: new Map(destitute.map((seat) => [seat, opening.dominationN - 1] as const)),
    winner: undefined,
  };
  const rules = makeRules(makeTiling());
  const afterHuman = rules.apply(state, endTurn());
  if (afterHuman.winner !== undefined) {
    throw new Error('setup: human endTurn already set a winner');
  }
  if (afterHuman.activePlayer !== heuristicPlayer) {
    throw new Error('setup: human endTurn did not hand the heuristic seat');
  }
  // The winner is *asserted*, not read back off the engine: reading it back
  // would turn a missing boundary into a setup error instead of a failed
  // expectation. Alice is the only seat that still owns a share.
  return {
    state,
    alicePlayer: String(alicePlayer),
    heuristicPlayer: String(heuristicPlayer),
    winner: String(alicePlayer),
  };
};

export const notifiesTo = (
  notifies: readonly NotifyRecord[],
  connectionId: string,
): readonly NotifyRecord[] => notifies.filter((row) => row.connectionId === connectionId);
