/**
 * Rig for the P92 remote-agent door.
 *
 * Probes the leaves SCENARIOS.md names: ObjectStore, PostToConnection,
 * GoogleVerifier, GoogleCodeExchange, metadata fetch. Clock, signer, and log
 * are injected, not probed. The handler is the component. Join, the burst,
 * and the offer check stay inside it — this file does not implement them.
 *
 * @see docs/spec/remote-agent-mcp/SCENARIOS.md
 */

import { createRig, type Rig } from '@hochgi/test-kit';
import { createProbedMock, type ProbedMock } from '@hochgi/test-kit-mock';
import type {
  GameState,
  InviteSeat,
  OnlinePort,
  OnlineWsPort,
  StateChangedPayload,
} from '@conquarrow/contracts';
import { DEFAULT_MATCH_CONFIG, endTurn } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { createOnlineApi, createOnlineWs } from '../src/create-online-api';
import type { GoogleVerifier, GoogleVerifyResult, ObjectPutOptions, ObjectStore } from '../src/api-types';
import { PreconditionFailed } from '../src/api-types';
import { persistEnvelope } from '../src/game-snapshot';
import {
  parseInvite,
  serializeInvite,
  type InviteRecord,
  type InviteStatus,
} from '../src/invite-record';
import {
  gameLogKey,
  gameMetaKey,
  gameStateKey,
  groupMetaKey,
  inviteKey,
  userGroupKey,
  userProfileKey,
} from '../src/s3-keys';
import {
  handleMcpHttp,
  MCP_AUDIENCE,
  MCP_ISSUER,
  type ClientMetadataFetch,
  type GoogleCodeExchange,
  type McpAccessClaims,
  type McpHttpDeps,
  type McpHttpRequest,
  type McpHttpResult,
  type McpLog,
  type McpSigner,
} from '../src/mcp-http';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  type FakeGoogleNames,
  fakeGoogle,
  sequentialBytes,
  type TestUser,
} from './support';

export const TOKEN = '11'.repeat(32);
export const CLOCK = 1_700_000_000_000;
export const ACCESS_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CODE_TTL_MS = 60 * 1000;
export const REPLY_INSTRUCTION =
  'Reply with only JSON: {"moves":[i,...],"endTurn":true|false,"why":"short","plan":"short"}';

export const geometry = makeTiling();
export const rules = makeRules(geometry);

export { ALICE, BOB, CAROL, DAVE, MCP_AUDIENCE, MCP_ISSUER };
export type { TestUser };

/** Promise-shaped store so createProbedMock can probe ObjectStore. */
export interface AsyncObjectStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, body: string, options?: ObjectPutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  listPrefix(prefix: string): Promise<readonly string[]>;
}

/** Promise-shaped verifier. The handler still receives GoogleVerifier. */
export interface AsyncGoogleVerifier {
  verify(authorizationHeader: string | undefined): Promise<GoogleVerifyResult>;
}

/** Promise-shaped ping, same seam as the P68 notifier. */
export interface ConnectionNotifier {
  post(connectionId: string, payload: StateChangedPayload): Promise<200 | 410>;
}

export interface TestSigner extends McpSigner {
  readonly signed: readonly McpAccessClaims[];
}

export interface RemoteRig {
  readonly rig: Rig;
  readonly data: Map<string, string>;
  readonly storeMock: ProbedMock<AsyncObjectStore>;
  readonly notifier: ProbedMock<ConnectionNotifier>;
  readonly googleMock: ProbedMock<AsyncGoogleVerifier>;
  readonly codeExchange: ProbedMock<GoogleCodeExchange>;
  readonly metadata: ProbedMock<ClientMetadataFetch>;
  readonly signer: TestSigner;
  readonly logLines: readonly string[];
  readonly chooserPlayers: readonly string[];
  readonly clock: () => number;
  readonly api: OnlinePort;
  readonly ws: OnlineWsPort;
  readonly mcp: (request: McpHttpRequest) => Promise<McpHttpResult>;
  readonly close: () => Promise<void>;
}

export interface RigOptions {
  readonly names?: FakeGoogleNames;
  readonly clock?: () => number;
}

const compareKeys = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const forwardStore = (data: Map<string, string>): AsyncObjectStore => ({
  get: (key) => Promise.resolve(data.get(key)),
  put: (key, body, options) => {
    const current = data.get(key);
    if (options?.ifNoneMatch === '*' && current !== undefined) {
      return Promise.reject(new PreconditionFailed());
    }
    if (options?.ifMatch !== undefined && current !== options.ifMatch) {
      return Promise.reject(new PreconditionFailed());
    }
    data.set(key, body);
    return Promise.resolve();
  },
  delete: (key) => {
    data.delete(key);
    return Promise.resolve();
  },
  listPrefix: (prefix) =>
    Promise.resolve([...data.keys()].filter((key) => key.startsWith(prefix)).sort(compareKeys)),
});

export const testSigner = (): TestSigner => {
  const signed: McpAccessClaims[] = [];
  const byToken = new Map<string, McpAccessClaims>();
  let n = 0;
  return {
    signed,
    sign: (claims) => {
      signed.push(claims);
      n += 1;
      const token = `mcp-access-${String(n)}`;
      byToken.set(token, claims);
      return token;
    },
    verify: (token) => byToken.get(token),
  };
};

export const createRemoteRig = (options: RigOptions = {}): RemoteRig => {
  const rig = createRig();
  const data = new Map<string, string>();
  const backing = forwardStore(data);
  const storeMock = rig.attach(
    createProbedMock<AsyncObjectStore>({
      harness: rig,
      methods: ['get', 'put', 'delete', 'listPrefix'],
    }),
  );
  storeMock.probe.on('get').always().answerWith((call) => backing.get(call.args[0]));
  storeMock.probe.on('put').always().answerWith((call) => backing.put(call.args[0], call.args[1], call.args[2]));
  storeMock.probe.on('delete').always().answerWith((call) => backing.delete(call.args[0]));
  storeMock.probe
    .on('listPrefix')
    .always()
    .answerWith((call) => backing.listPrefix(call.args[0]));

  const notifier = rig.attach(
    createProbedMock<ConnectionNotifier>({ harness: rig, methods: ['post'] }),
  );
  notifier.probe.on('post').always().answer(200);

  const googleMock = rig.attach(
    createProbedMock<AsyncGoogleVerifier>({ harness: rig, methods: ['verify'] }),
  );
  const google = fakeGoogle(options.names ?? {});
  googleMock.probe.on('verify').always().answerWith((call) => google.verify(call.args[0]));

  const codeExchange = rig.attach(
    createProbedMock<GoogleCodeExchange>({ harness: rig, methods: ['exchange'] }),
  );
  const metadata = rig.attach(
    createProbedMock<ClientMetadataFetch>({ harness: rig, methods: ['fetch'] }),
  );

  const clock = options.clock ?? (() => CLOCK);
  const signer = testSigner();
  const logLines: string[] = [];
  const log: McpLog = { write: (line) => { logLines.push(line); } };
  const chooserPlayers: string[] = [];
  const store: ObjectStore = {
    get: (key) => storeMock.adapter.get(key),
    put: (key, body, putOptions) => storeMock.adapter.put(key, body, putOptions),
    delete: (key) => storeMock.adapter.delete(key),
    listPrefix: (prefix) => storeMock.adapter.listPrefix(prefix),
  };
  const googlePort: GoogleVerifier = {
    verify: (header) => googleMock.adapter.verify(header),
  };
  const postToConnection = (connectionId: string, payload: StateChangedPayload) =>
    notifier.adapter.post(connectionId, payload);
  const heuristic = (state: GameState) => {
    chooserPlayers.push(String(state.activePlayer));
    return endTurn();
  };
  const deps: McpHttpDeps = {
    store,
    postToConnection,
    google: googlePort,
    googleCodeExchange: codeExchange.adapter,
    metadata: metadata.adapter,
    clock,
    signer,
    log,
    randomBytes: sequentialBytes(),
    heuristic,
  };
  const browser = {
    google: googlePort,
    s3: store,
    clock,
    randomBytes: sequentialBytes(),
    heuristic,
    postToConnection,
  };
  return {
    rig,
    data,
    storeMock,
    notifier,
    googleMock,
    codeExchange,
    metadata,
    signer,
    logLines,
    chooserPlayers,
    clock,
    api: createOnlineApi(browser),
    ws: createOnlineWs(browser),
    mcp: (request) => handleMcpHttp(deps, request),
    close: () => rig.close(),
  };
};

export const withRig = async (
  body: (rig: RemoteRig) => Promise<void>,
  options?: RigOptions,
): Promise<void> => {
  const rig = createRemoteRig(options);
  try {
    await body(rig);
  } finally {
    await rig.close();
  }
};

export const inviteHandle = (token: string = TOKEN): string =>
  `https://games.hochgi.com/#/invite/${token}`;

export const human = (userHash?: string): InviteSeat =>
  userHash === undefined ? { kind: 'human' } : { kind: 'human', userHash };

export const agent = (userHash?: string): InviteSeat =>
  userHash === undefined ? { kind: 'agent' } : { kind: 'agent', userHash };

export const heuristicSeat = (): InviteSeat => ({ kind: 'heuristic' });

export const openInvite = (
  seats: readonly InviteSeat[],
  creatorUserHash: string,
  status: InviteStatus = 'open',
  gameNumber?: string,
): InviteRecord => ({
  status,
  creatorUserHash,
  seats,
  ...(gameNumber === undefined ? {} : { gameNumber }),
});

export const seedInvite = (rig: RemoteRig, token: string, invite: InviteRecord): void => {
  rig.data.set(inviteKey(token), serializeInvite(invite));
};

export const inviteAt = (rig: RemoteRig, token: string): InviteRecord | undefined => {
  const raw = rig.data.get(inviteKey(token));
  if (raw === undefined) return undefined;
  return parseInvite(raw);
};

export const putRaw = (rig: RemoteRig, key: string, body: string): void => {
  rig.data.set(key, body);
};

export const opening = (playerCount: 3 | 6): GameState =>
  makeMatch({ ...DEFAULT_MATCH_CONFIG, playerCount });

export const playerIndex = (state: GameState): number => {
  const index = state.players.findIndex((player) => player === state.activePlayer);
  if (index < 0) throw new Error('setup: active player is not seated');
  return index;
};

export const atSeat = (state: GameState, index: number): GameState => {
  let at = state;
  for (let guard = 0; guard < state.players.length + 1; guard += 1) {
    if (playerIndex(at) === index) return at;
    at = rules.apply(at, endTurn());
  }
  throw new Error(`setup: seat ${String(index)} is not reachable by endTurn`);
};

/** Index 0 of the offer must be a step, or the fixture does not match the scenario. */
export const requireStepAt = (state: GameState, index: number): void => {
  const move = rules.legalMoves(state)[index];
  if (move === undefined || move.kind !== 'step') {
    throw new Error(`setup: offer index ${String(index)} is not a legal step`);
  }
};

export const withNoLegalStep = (state: GameState): GameState => {
  let at = state;
  const me = at.activePlayer;
  for (let guard = 0; guard < 64; guard += 1) {
    if (at.activePlayer !== me) {
      throw new Error('setup: the turn ended before the steps ran out');
    }
    const next = rules.legalMoves(at).find((move) => move.kind === 'step');
    if (next === undefined) return at;
    at = rules.apply(at, next);
  }
  throw new Error('setup: a legal step remained after 64 applies');
};

export interface StartedSeed {
  readonly token: string;
  readonly groupHash: string;
  readonly gameNumber: string;
  readonly seats: readonly InviteSeat[];
  readonly state: GameState;
  readonly version: number;
  readonly members: readonly string[];
  readonly log?: string;
}

export const seedStarted = (rig: RemoteRig, seed: StartedSeed): void => {
  const creator = seed.members[0];
  if (creator === undefined) throw new Error('setup: a started game needs a member');
  seedInvite(
    rig,
    seed.token,
    openInvite(seed.seats, creator, 'started', seed.gameNumber),
  );
  const meta: Record<string, unknown> = {
    seats: seed.seats,
    inviteToken: seed.token,
    startedAt: '2026-11-09T00:00:00.000Z',
    players: seed.state.players.map(String),
    activePlayer: String(seed.state.activePlayer),
    lostPlayers: [],
  };
  if (seed.state.winner !== undefined) meta['winner'] = String(seed.state.winner);
  putRaw(rig, gameMetaKey(seed.groupHash, seed.gameNumber), JSON.stringify(meta));
  putRaw(rig, gameStateKey(seed.groupHash, seed.gameNumber), persistEnvelope(seed.version, seed.state));
  if (seed.log !== undefined) putRaw(rig, gameLogKey(seed.groupHash, seed.gameNumber), seed.log);
  putRaw(rig, groupMetaKey(seed.groupHash), JSON.stringify({ nextGameNumber: 2 }));
  for (const hash of seed.members) {
    putRaw(rig, userGroupKey(hash, seed.groupHash), '{}');
  }
};

export const seedProfile = (rig: RemoteRig, userHash: string, displayName: string): void => {
  putRaw(rig, userProfileKey(userHash), JSON.stringify({ displayName }));
};

export const storedActive = (
  rig: RemoteRig,
  groupHash: string,
  gameNumber: string,
): string | undefined => {
  const raw = rig.data.get(gameStateKey(groupHash, gameNumber));
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const state = (parsed as { state?: { activePlayer?: unknown } }).state;
  return typeof state?.activePlayer === 'string' ? state.activePlayer : undefined;
};

export const storedVersion = (
  rig: RemoteRig,
  groupHash: string,
  gameNumber: string,
): number | undefined => {
  const raw = rig.data.get(gameStateKey(groupHash, gameNumber));
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const version = (parsed as { version?: unknown }).version;
  return typeof version === 'number' ? version : undefined;
};

export const logRaw = (
  rig: RemoteRig,
  groupHash: string,
  gameNumber: string,
): string | undefined => rig.data.get(gameLogKey(groupHash, gameNumber));

export const keysOf = (rig: RemoteRig): readonly string[] => [...rig.data.keys()].sort(compareKeys);

export const countStored = (
  rig: RemoteRig,
): { readonly invites: number; readonly lobbies: number; readonly groups: number } => {
  let invites = 0;
  let lobbies = 0;
  let groups = 0;
  for (const key of rig.data.keys()) {
    if (key.includes('/invites/')) invites += 1;
    if (key.includes('/lobbies/')) lobbies += 1;
    if (key.includes('/groups/')) groups += 1;
  }
  return { invites, lobbies, groups };
};

export const headerOf = (result: McpHttpResult, name: string): string | undefined => {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(result.headers)) {
    if (key.toLowerCase() === want) return value;
  }
  return undefined;
};

export const jsonOf = (result: McpHttpResult): unknown => {
  try {
    return JSON.parse(result.body) as unknown;
  } catch {
    return undefined;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

export const toolContent = (
  result: McpHttpResult,
): { readonly text: string; readonly isError: boolean } | undefined => {
  const rpc = asRecord(asRecord(jsonOf(result))?.['result']);
  if (rpc === undefined) return undefined;
  const content = rpc['content'];
  if (!Array.isArray(content)) return undefined;
  const first = asRecord(content[0]);
  const text = first?.['text'];
  if (typeof text !== 'string') return undefined;
  return { text, isError: rpc['isError'] === true };
};

export const toolJson = (result: McpHttpResult): Record<string, unknown> | undefined => {
  const content = toolContent(result);
  if (content === undefined) return undefined;
  try {
    return asRecord(JSON.parse(content.text) as unknown);
  } catch {
    return undefined;
  }
};

export const bearerOf = (token: string | undefined): McpHttpRequest['headers'] =>
  token === undefined ? {} : { authorization: `Bearer ${token}` };

export const postDoor = (
  rig: RemoteRig,
  body: unknown,
  token?: string,
  extraHeaders?: Readonly<Record<string, string>>,
): Promise<McpHttpResult> =>
  rig.mcp({
    method: 'POST',
    path: '/conquarrow',
    headers: { ...bearerOf(token), ...extraHeaders },
    body: JSON.stringify(body),
  });

export const toolsCall = (
  name: string,
  args: Readonly<Record<string, unknown>>,
): unknown => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
});

export const accessToken = (
  rig: RemoteRig,
  sub: string,
  exp: number = rig.clock() + ACCESS_TTL_MS,
  aud: string = MCP_AUDIENCE,
): string => {
  const iat = rig.clock();
  return rig.signer.sign({ iss: MCP_ISSUER, aud, sub, iat, exp });
};

export const failNextPut = (rig: RemoteRig, key: string): void => {
  rig.storeMock.probe
    .on('put')
    .filter((call) => call.args[0] === key, `key === '${key}'`)
    .once()
    .reject(new PreconditionFailed());
};
