/**
 * Fake GIS, fetch, WebSocket, and sessionStorage for the P19 Pages adapter suite.
 *
 * Tests never call live Google, AWS, or API Gateway.
 */

import {
  GOOGLE_ID_TOKEN_SESSION_KEY,
  type InviteSeat,
  type LibraryGameStatus,
  type OnlineGameBoard,
  type OnlinePagesDeps,
  type OnlinePagesEnv,
  type OnlinePagesFetch,
  type OnlinePagesGis,
  type OnlinePagesHttpRequest,
  type OnlinePagesHttpResponse,
  type OnlinePagesLocation,
  type OnlinePagesOpenSocket,
  type OnlinePagesPort,
  type OnlinePagesSession,
  type OnlinePagesSocket,
  type PlannedSeatKind,
} from '@conquarrow/contracts';
import type { BrowserGisId, GisPromptNotification } from '../src/online-gis';
import { createOnlinePages } from '../src/online-pages';

export const PAGES_ORIGIN = 'https://games.hochgi.com';
export const PAGES_PATHNAME = '/conquarrow/';

export const DEFAULT_ENV: OnlinePagesEnv = {
  VITE_API_BASE: 'https://api.games.hochgi.com/conquarrow',
  VITE_WS_URL: 'wss://ws.games.hochgi.com/conquarrow',
  VITE_GOOGLE_CLIENT_ID: 'pages-client.apps.googleusercontent.com',
};

export const GROUP_HASH = 'abababababababababababababababab';
export const OTHER_GROUP_HASH = 'cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd';
export const GAME_ONE = '000001';
export const INVITE_TOKEN = 'a'.repeat(64);

export const ALICE = {
  bearer: 'alice-id-token',
  sub: 'alice-google-sub',
  userHash: 'alice-user-hash',
} as const;

export const BOB = {
  bearer: 'bob-id-token',
  sub: 'bob-google-sub',
  userHash: 'bob-user-hash',
} as const;

export const CAROL = {
  bearer: 'carol-id-token',
  sub: 'carol-google-sub',
  userHash: 'carol-user-hash',
} as const;

export const TWO_HUMAN_HEURISTIC: readonly PlannedSeatKind[] = [
  'human',
  'human',
  'heuristic',
];

export const ONE_HUMAN_TWO_HEURISTIC: readonly PlannedSeatKind[] = [
  'human',
  'heuristic',
  'heuristic',
];

export const THREE_HEURISTIC: readonly PlannedSeatKind[] = [
  'heuristic',
  'heuristic',
  'heuristic',
];

export const inviteHash = (token: string): string => `#/invite/${token}`;

export const gameHash = (groupHash: string, gameNumber: string): string =>
  `#/g/${groupHash}/${gameNumber}`;

export type JsonState = {
  readonly players: readonly string[];
  readonly activePlayer: string;
  readonly winner?: string;
  readonly tag?: string;
};

export const jsonState = (overrides?: {
  readonly activePlayer?: string;
  readonly winner?: string;
  readonly tag?: string;
}): JsonState => {
  const state: {
    players: readonly string[];
    activePlayer: string;
    winner?: string;
    tag?: string;
  } = {
    players: ['A', 'B', 'C'],
    activePlayer: overrides?.activePlayer ?? 'A',
  };
  if (overrides?.winner !== undefined) state.winner = overrides.winner;
  if (overrides?.tag !== undefined) state.tag = overrides.tag;
  return state;
};

export const openingBoard = (tag = 'opening'): OnlineGameBoard => ({
  version: 0,
  state: jsonState({ tag }),
});

export const boardAt = (
  version: number,
  overrides?: {
    readonly activePlayer?: string;
    readonly winner?: string;
    readonly tag?: string;
  },
): OnlineGameBoard => ({
  version,
  state: jsonState(overrides),
});

export type ScriptedFetch = {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly status: number;
  readonly body?: unknown;
  /** When set, returned as the HTTP body as-is (empty 410, non-JSON, …). */
  readonly rawBody?: string;
  /** When set, the harness waits on this instead of resolving immediately (P27). */
  readonly deferred?: Promise<OnlinePagesHttpResponse>;
};

export type HarnessSocket = OnlinePagesSocket & { closed: boolean };

export type HarnessGis = OnlinePagesGis & {
  readonly prompted: boolean;
  readonly promptCount: number;
  readonly offerChooserCount: number;
};

export type HarnessSession = OnlinePagesSession & {
  keys(): readonly string[];
};

export type FetchSpy = {
  readonly env: OnlinePagesEnv;
  readonly fetchLog: OnlinePagesHttpRequest[];
};

export type PagesFakes = FetchSpy & {
  readonly session: HarnessSession;
  readonly location: OnlinePagesLocation;
  readonly gis: HarnessGis;
  readonly sockets: HarnessSocket[];
  readonly deps: OnlinePagesDeps;
};

export type PagesHarness = PagesFakes & {
  readonly adapter: OnlinePagesPort;
};

const USER_BY_BEARER: Readonly<Record<string, { readonly userHash: string }>> = {
  [ALICE.bearer]: ALICE,
  [BOB.bearer]: BOB,
  [CAROL.bearer]: CAROL,
};

export const memorySession = (token?: string): HarnessSession => {
  const data = new Map<string, string>();
  if (token !== undefined) data.set(GOOGLE_ID_TOKEN_SESSION_KEY, token);
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    keys: () => [...data.keys()].toSorted(),
  };
};

export const memoryLocation = (hash = ''): OnlinePagesLocation => ({
  origin: PAGES_ORIGIN,
  pathname: PAGES_PATHNAME,
  hash,
});

export const fakeGis = (): HarnessGis => {
  let promptCount = 0;
  let offerChooserCount = 0;
  return {
    prompt: () => {
      promptCount += 1;
    },
    offerChooser: () => {
      offerChooserCount += 1;
    },
    get prompted() {
      return promptCount > 0;
    },
    get promptCount() {
      return promptCount;
    },
    get offerChooserCount() {
      return offerChooserCount;
    },
  };
};

export type GisMomentKind = 'displayed' | 'not-displayed' | 'skipped' | 'dismissed';

export const gisNotification = (kind: GisMomentKind): GisPromptNotification => ({
  isNotDisplayed: () => kind === 'not-displayed',
  isSkippedMoment: () => kind === 'skipped',
  isDismissedMoment: () => kind === 'dismissed',
});

export type InjectedGisId = BrowserGisId & {
  readonly renderButtonCount: number;
};

/** Injected `google.accounts.id`: `prompt` fires the moment listener; `renderButton` is counted. */
export const injectedGisId = (moment: GisPromptNotification): InjectedGisId => {
  let renderButtonCount = 0;
  return {
    initialize: () => {},
    prompt: (listener) => {
      listener?.(moment);
    },
    renderButton: () => {
      renderButtonCount += 1;
    },
    get renderButtonCount() {
      return renderButtonCount;
    },
  };
};

export const pathOf = (url: string, apiBase: string): string => {
  const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
  const stripped = url.split('?')[0] ?? url;
  if (stripped.startsWith(base)) {
    const rest = stripped.slice(base.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  try {
    return new URL(stripped).pathname;
  } catch {
    return stripped;
  }
};

export const headerOf = (
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined => {
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle) return value;
  }
  return undefined;
};

export const bearerOf = (req: OnlinePagesHttpRequest): string | undefined => {
  const raw = headerOf(req.headers, 'authorization');
  if (raw === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/.exec(raw);
  return match?.[1];
};

export const ifMatchOf = (req: OnlinePagesHttpRequest): string | undefined =>
  headerOf(req.headers, 'if-match');

export const accessTokenOf = (wsUrl: string): string | undefined => {
  try {
    return new URL(wsUrl).searchParams.get('access_token') ?? undefined;
  } catch {
    return undefined;
  }
};

export const parseJson = (raw: string | undefined): unknown => {
  if (raw === undefined || raw === '') return undefined;
  return JSON.parse(raw) as unknown;
};

export const apiCalls = (
  h: FetchSpy,
  method: 'GET' | 'POST',
  path: string,
): readonly OnlinePagesHttpRequest[] =>
  h.fetchLog.filter(
    (req) => req.method === method && pathOf(req.url, h.env.VITE_API_BASE) === path,
  );

export const apiCalled = (h: FetchSpy): boolean =>
  h.fetchLog.some((req) => req.url.startsWith(h.env.VITE_API_BASE));

const defaultGetMe = (
  req: OnlinePagesHttpRequest,
  apiBase: string,
): OnlinePagesHttpResponse | undefined => {
  const path = pathOf(req.url, apiBase);
  if (req.method !== 'GET' || path !== '/me') return undefined;
  const token = bearerOf(req);
  const user = token === undefined ? undefined : USER_BY_BEARER[token];
  if (user === undefined) {
    return { status: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  return { status: 200, body: JSON.stringify({ userHash: user.userHash }) };
};

const defaultGetMyGames = (
  req: OnlinePagesHttpRequest,
  apiBase: string,
): OnlinePagesHttpResponse | undefined => {
  const path = pathOf(req.url, apiBase);
  if (req.method !== 'GET' || path !== '/my-games') return undefined;
  const token = bearerOf(req);
  if (token === undefined || USER_BY_BEARER[token] === undefined) {
    return { status: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  return { status: 200, body: JSON.stringify({ lobbies: [], games: [] }) };
};

export const makePagesFakes = (overrides?: {
  readonly env?: Partial<OnlinePagesEnv>;
  readonly hash?: string;
  readonly sessionToken?: string;
  readonly fetchScript?: readonly ScriptedFetch[];
}): PagesFakes => {
  const env: OnlinePagesEnv = { ...DEFAULT_ENV, ...overrides?.env };
  const session = memorySession(overrides?.sessionToken);
  const location = memoryLocation(overrides?.hash);
  const gis = fakeGis();
  const fetchLog: OnlinePagesHttpRequest[] = [];
  const sockets: HarnessSocket[] = [];
  const queue = [...(overrides?.fetchScript ?? [])];

  const fetch: OnlinePagesFetch = (request) => {
    fetchLog.push(request);
    const path = pathOf(request.url, env.VITE_API_BASE);
    const scriptedIndex = queue.findIndex(
      (entry) => entry.method === request.method && entry.path === path,
    );
    if (scriptedIndex >= 0) {
      const entry = queue[scriptedIndex];
      queue.splice(scriptedIndex, 1);
      if (entry === undefined) {
        return Promise.resolve({ status: 599, body: JSON.stringify({ error: 'unscripted' }) });
      }
      if (entry.deferred !== undefined) return entry.deferred;
      const raw =
        entry.rawBody !== undefined
          ? entry.rawBody
          : entry.body === undefined
            ? ''
            : JSON.stringify(entry.body);
      return Promise.resolve({
        status: entry.status,
        body: raw,
      });
    }
    const me = defaultGetMe(request, env.VITE_API_BASE);
    if (me !== undefined) return Promise.resolve(me);
    const myGames = defaultGetMyGames(request, env.VITE_API_BASE);
    if (myGames !== undefined) return Promise.resolve(myGames);
    return Promise.resolve({ status: 599, body: JSON.stringify({ error: 'unscripted' }) });
  };

  const openSocket: OnlinePagesOpenSocket = (url) => {
    const socket: HarnessSocket = {
      url,
      closed: false,
      close: () => {
        socket.closed = true;
      },
    };
    sockets.push(socket);
    return socket;
  };

  const deps: OnlinePagesDeps = { env, session, location, fetch, openSocket, gis };
  return { env, session, location, gis, fetchLog, sockets, deps };
};

export const makePagesHarness = (overrides?: {
  readonly env?: Partial<OnlinePagesEnv>;
  readonly hash?: string;
  readonly sessionToken?: string;
  readonly fetchScript?: readonly ScriptedFetch[];
}): PagesHarness => {
  const fakes = makePagesFakes(overrides);
  return { ...fakes, adapter: createOnlinePages(fakes.deps) };
};

export const peekInviteScript = (
  token: string,
  seats: readonly InviteSeat[],
): ScriptedFetch => ({
  method: 'GET',
  path: `/invites/${token}`,
  status: 200,
  body: { token, seats },
});

export const aliceHostSeats = (): readonly InviteSeat[] => [
  { kind: 'human', userHash: ALICE.userHash },
  { kind: 'human' },
  { kind: 'heuristic' },
];

export const aliceBobSeats = (): readonly InviteSeat[] => [
  { kind: 'human', userHash: ALICE.userHash },
  { kind: 'human', userHash: BOB.userHash },
  { kind: 'heuristic' },
];

export const fullHumanSeats = (): readonly InviteSeat[] => [
  { kind: 'human', userHash: ALICE.userHash },
  { kind: 'human', userHash: BOB.userHash },
  { kind: 'heuristic' },
];

export const createInviteScript = (token: string): ScriptedFetch => ({
  method: 'POST',
  path: '/invites',
  status: 201,
  body: { token, seats: aliceHostSeats() },
});

/** POST `/invites` that stays in flight until `settle` (P27 create-pending tests). */
export const hungCreateInvite = (): {
  readonly script: ScriptedFetch;
  readonly settle: (status: number, body?: unknown) => void;
} => {
  const box: { resolve: ((res: OnlinePagesHttpResponse) => void) | undefined } = {
    resolve: undefined,
  };
  const deferred = new Promise<OnlinePagesHttpResponse>((resolve) => {
    box.resolve = resolve;
  });
  return {
    script: {
      method: 'POST',
      path: '/invites',
      status: 599,
      deferred,
    },
    settle: (status, body) => {
      const resolve = box.resolve;
      if (resolve === undefined) return;
      box.resolve = undefined;
      resolve({
        status,
        body: body === undefined ? '' : JSON.stringify(body),
      });
    },
  };
};

export const createdInviteBody = (
  token: string,
): { readonly token: string; readonly seats: readonly InviteSeat[] } => ({
  token,
  seats: aliceHostSeats(),
});

export const acceptInviteScript = (
  token: string,
  seats: readonly InviteSeat[],
  status = 200,
  body?: unknown,
): ScriptedFetch => ({
  method: 'POST',
  path: `/invites/${token}/accept`,
  status,
  body: body ?? { token, seats },
});

export const startGameScript = (
  token: string,
  groupHash = GROUP_HASH,
  gameNumber = GAME_ONE,
): ScriptedFetch => ({
  method: 'POST',
  path: `/invites/${token}/start`,
  status: 200,
  body: { groupHash, gameNumber },
});

export const getGameScript = (
  board: OnlineGameBoard,
  groupHash = GROUP_HASH,
  gameNumber = GAME_ONE,
): ScriptedFetch => ({
  method: 'GET',
  path: `/games/${groupHash}/${gameNumber}`,
  status: 200,
  body: board,
});

export const postMoveScript = (
  status: number,
  body: unknown,
  groupHash = GROUP_HASH,
  gameNumber = GAME_ONE,
): ScriptedFetch => ({
  method: 'POST',
  path: `/games/${groupHash}/${gameNumber}/moves`,
  status,
  body,
});

export const myGamesScript = (
  games: readonly {
    readonly groupHash: string;
    readonly gameNumber: string;
    readonly status: LibraryGameStatus;
  }[],
): ScriptedFetch => ({
  method: 'GET',
  path: '/my-games',
  status: 200,
  body: { lobbies: [], games },
});

export const goneInviteEmptyBodyScript = (token: string): ScriptedFetch => ({
  method: 'GET',
  path: `/invites/${token}`,
  status: 410,
  rawBody: '',
});

export const goneInviteStartedScript = (
  token: string,
  ids?: { readonly groupHash: string; readonly gameNumber: string },
): ScriptedFetch => ({
  method: 'GET',
  path: `/invites/${token}`,
  status: 410,
  body:
    ids === undefined
      ? { reason: 'started' }
      : { reason: 'started', groupHash: ids.groupHash, gameNumber: ids.gameNumber },
});

export const acceptInviteEmpty410Script = (token: string): ScriptedFetch => ({
  method: 'POST',
  path: `/invites/${token}/accept`,
  status: 410,
  rawBody: '',
});

export const quotedVersion = (version: number): string => `"${String(version)}"`;

export const humanBoundCount = (seats: readonly InviteSeat[] | undefined): number => {
  if (seats === undefined) return 0;
  return seats.filter((seat) => seat.kind === 'human' && seat.userHash !== undefined).length;
};
