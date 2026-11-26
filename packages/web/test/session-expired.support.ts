/**
 * Host harness for the P98 Gherkin suite. Scripted fetch at `createOnlineHost`.
 * Diagram paths are the probed component tests in `session-expired.scenarios.test.ts`.
 * The clock is the injected `now`. GIS prompt counts are `gis.prompt`, never
 * `offerChooser`.
 *
 * @see docs/spec/session-expired/session-expired.md
 * @see docs/spec/session-expired/SCENARIOS.md
 */

import {
  GOOGLE_ID_TOKEN_SESSION_KEY,
  type InviteSeat,
  type MyGamesBody,
  type OnlinePagesHttpRequest,
  type PlannedSeatKind,
} from '@conquarrow/contracts';
import { REAUTH_LEAD_MS } from '../src/online-pages';
import { tokenExpiryMs } from '../src/online-session';
import {
  chooserSlotOffered,
  libraryNotice,
  sessionExpiredNote,
  type LibraryNotice,
} from '../src/online-shell-ui';
import { pass } from './online-move-log-replay.support';
import { makeHostHarness, type HostHarness } from './online-shell.support';
import {
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  aliceBobSeats,
  apiCalls,
  bearerOf,
  gameHash,
  getGameScript,
  inviteHash,
  openingBoard,
  parseJson,
  peekInviteScript,
  postMoveScript,
  tokenExpiringAt,
  withLibraryIdentity,
  type ScriptedFetch,
} from './online-web.support';

/** Divisible by 1000, so `tokenExpiryMs(tokenExpiringAt(now)) === now`. */
export const FROZEN_NOW = 1_700_000_000_000;

export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;

export const GAME_PATH = `/games/${GROUP_HASH}/${GAME_ONE}`;
export const MOVES_PATH = `${GAME_PATH}/moves`;
export const VERSION_PATH = `${GAME_PATH}/version`;
export const EXPORT_PATH = `${GAME_PATH}/export`;
export const DELETE_PATH = `${GAME_PATH}/delete`;
export const HIDE_PATH = `${GAME_PATH}/hide`;
export const NAME_PATH = `${GAME_PATH}/name`;
export const ACCEPT_PATH = `/invites/${INVITE_TOKEN}/accept`;
export const START_PATH = `/invites/${INVITE_TOKEN}/start`;
export const INVITE_GET = `/invites/${INVITE_TOKEN}`;

export const hourToken = (): string => tokenExpiringAt(FROZEN_NOW + HOUR_MS);
export const minuteToken = (): string => tokenExpiringAt(FROZEN_NOW + MINUTE_MS);
export const expiredToken = (): string => tokenExpiringAt(FROZEN_NOW - HOUR_MS);
export const credentialToken = (): string => tokenExpiringAt(FROZEN_NOW + 2 * HOUR_MS);

/** Unsigned JWT with an arbitrary payload — for `exp` that is not a number. */
export const tokenWithClaims = (claims: Readonly<Record<string, unknown>>): string => {
  const part = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
};

const expiryOf = (token: string): number => {
  const expiry = tokenExpiryMs(token);
  if (expiry === undefined) throw new Error('session-expired fixture token has no exp');
  return expiry;
};

const minuteLead = expiryOf(minuteToken()) - FROZEN_NOW;
const hourLead = expiryOf(hourToken()) - FROZEN_NOW;
if (minuteLead <= 0 || minuteLead > REAUTH_LEAD_MS) {
  throw new Error('minute token fixture is not inside the reauth lead');
}
if (hourLead <= REAUTH_LEAD_MS) {
  throw new Error('hour token fixture is inside the reauth lead');
}
if (expiryOf(tokenExpiringAt(FROZEN_NOW)) !== FROZEN_NOW) {
  throw new Error('exp-at-now fixture is not equal to the frozen clock');
}

export const frozenNow = (): number => FROZEN_NOW;

export const waitingSeats = (): readonly InviteSeat[] => [
  { kind: 'human' },
  { kind: 'human' },
  { kind: 'heuristic' },
];

export const TWO_PLAYERS: readonly PlannedSeatKind[] = ['creator', 'human', 'heuristic'];
export const PLAYER_AND_AGENT: readonly PlannedSeatKind[] = ['creator', 'agent', 'heuristic'];

export const storedToken = (h: HostHarness): string | null =>
  h.session.getItem(GOOGLE_ID_TOKEN_SESSION_KEY);

/**
 * Put a usable bearer back without `deliverGoogleCredential`. That path would
 * send or drop a held submit; a library 401 must be able to meet the hold.
 */
export const restoreToken = (h: HostHarness, token: string): void => {
  h.session.setItem(GOOGLE_ID_TOKEN_SESSION_KEY, token);
};

export const expiredNote = (h: HostHarness): string | undefined =>
  sessionExpiredNote(h.host.sessionExpired(), h.host.signedIn());

export const noticeOf = (h: HostHarness): LibraryNotice =>
  libraryNotice(h.host.signedIn(), h.host.adapter().myGames(), h.host.libraryFailed());

export const chooserOffered = (h: HostHarness): boolean =>
  chooserSlotOffered(h.host.signedIn());

/** A parsed library this read installed as zero rows. Unset is not that. */
export const isEmptySuccess = (library: MyGamesBody | undefined): boolean => {
  if (library === undefined) return false;
  const countsEmpty = (['your-turn', 'waiting', 'finished', 'hidden'] as const).every(
    (list) => library.counts[list] === 0,
  );
  return library.games.length === 0 && library.lobbies.length === 0 && countsEmpty;
};

export const heartbeatFrames = (h: HostHarness): number =>
  h.sockets.reduce((count, socket) => count + socket.sent.length, 0);

export const settlementOf = async (
  run: () => Promise<unknown>,
): Promise<'resolved' | 'rejected'> => {
  try {
    await run();
    return 'resolved';
  } catch {
    return 'rejected';
  }
};

/**
 * `GET /me` 200. P98 tokens are not ALICE/BOB/CAROL, so the harness default
 * would answer 401 and the door would clear the token before the scenario.
 */
export const meOk = (): ScriptedFetch =>
  scripted('GET', '/me', 200, { userHash: 'alice-user-hash' });

const hasMeScript = (script: readonly ScriptedFetch[]): boolean =>
  script.some((entry) => entry.method === 'GET' && entry.path === '/me');

/**
 * Two successful `/me` reads: one for boot (or hashchange) and one for a later
 * credential. A script that already names `/me` — the boot-401 example — is
 * left alone.
 */
const withMe = (script: readonly ScriptedFetch[]): readonly ScriptedFetch[] =>
  hasMeScript(script) ? script : [meOk(), meOk(), ...script];

export const frozenHost = (options: {
  readonly sessionToken?: string;
  readonly fetchScript?: readonly ScriptedFetch[];
  readonly hash?: string;
  readonly now?: () => number;
} = {}): HostHarness =>
  makeHostHarness({
    now: options.now ?? frozenNow,
    ...(options.hash === undefined ? {} : { hash: options.hash }),
    ...(options.sessionToken === undefined ? {} : { sessionToken: options.sessionToken }),
    fetchScript: withMe(options.fetchScript ?? []),
  });

/** Online, creatable plan, valid name — the only reason not to POST is the token. */
export const armCreate = (h: HostHarness, name = 'Friday'): void => {
  h.host.selectMode('online');
  h.host.setSeatPlan(TWO_PLAYERS);
  h.host.adapter().setInviteName(name);
};

export const scripted = (
  method: 'GET' | 'POST',
  path: string,
  status: number,
  body?: unknown,
  rawBody?: string,
): ScriptedFetch => ({
  method,
  path,
  status,
  ...(body === undefined ? {} : { body }),
  ...(rawBody === undefined ? {} : { rawBody }),
});

export const thrown = (method: 'GET' | 'POST', path: string): ScriptedFetch => ({
  method,
  path,
  status: 0,
  reject: new Error('network down'),
});

export const emptyLibrary = (): ScriptedFetch =>
  scripted('GET', '/my-games', 200, { lobbies: [], games: [] });

export const oneGameLibrary = (): ScriptedFetch =>
  scripted('GET', '/my-games', 200, {
    lobbies: [],
    games: [
      withLibraryIdentity({
        groupHash: GROUP_HASH,
        gameNumber: GAME_ONE,
        status: 'your-turn',
      }),
    ],
    counts: { 'your-turn': 1, waiting: 0, finished: 0, hidden: 0 },
  });

export const createdInvite = (token = INVITE_TOKEN): ScriptedFetch =>
  scripted('POST', '/invites', 201, { token, seats: aliceBobSeats() });

const requireSent = (requests: readonly OnlinePagesHttpRequest[], action: string): void => {
  if (requests.length === 0) {
    throw new Error(`arrange: ${action} did not send an authenticated request`);
  }
};

const added = (
  h: HostHarness,
  method: 'GET' | 'POST',
  path: string,
  before: number,
): readonly OnlinePagesHttpRequest[] => apiCalls(h, method, path).slice(before);

export type DoorResult = {
  readonly h: HostHarness;
  readonly prompts: number;
  readonly failure: string;
  readonly sent: number;
};

export type LeadResult = {
  readonly h: HostHarness;
  readonly prompts: number;
  readonly sent: readonly OnlinePagesHttpRequest[];
};

const around = async <T>(
  h: HostHarness,
  method: 'GET' | 'POST',
  path: string,
  action: string,
  run: () => Promise<T>,
): Promise<{ readonly prompts: number; readonly sent: readonly OnlinePagesHttpRequest[]; readonly value: T }> => {
  const promptsBefore = h.gis.promptCount;
  const callsBefore = apiCalls(h, method, path).length;
  const value = await run();
  const sent = added(h, method, path, callsBefore);
  requireSent(sent, action);
  return { prompts: h.gis.promptCount - promptsBefore, sent, value };
};

const asLead = (
  h: HostHarness,
  fired: { readonly prompts: number; readonly sent: readonly OnlinePagesHttpRequest[] },
): LeadResult => ({ h, prompts: fired.prompts, sent: fired.sent });

const authed = (token: string, hash: string | undefined, script: readonly ScriptedFetch[]): HostHarness =>
  frozenHost({
    sessionToken: token,
    fetchScript: script,
    ...(hash === undefined ? {} : { hash }),
  });

export const leadCreate = async (token: string): Promise<LeadResult> => {
  const h = authed(token, undefined, [createdInvite()]);
  armCreate(h);
  const fired = await around(h, 'POST', '/invites', 'creates an invite', () => h.host.createInvite());
  return asLead(h, fired);
};

export const leadAccept = async (token: string): Promise<LeadResult> => {
  const h = authed(token, inviteHash(INVITE_TOKEN), [
    peekInviteScript(INVITE_TOKEN, waitingSeats()),
    scripted('POST', ACCEPT_PATH, 200, { token: INVITE_TOKEN, seats: waitingSeats() }),
  ]);
  await h.host.boot();
  const fired = await around(h, 'POST', ACCEPT_PATH, 'accepts the invite', () => h.host.acceptInvite());
  return asLead(h, fired);
};

export const leadStart = async (token: string): Promise<LeadResult> => {
  const h = authed(token, inviteHash(INVITE_TOKEN), [
    peekInviteScript(INVITE_TOKEN, aliceBobSeats()),
    scripted('POST', START_PATH, 200, { groupHash: GROUP_HASH, gameNumber: GAME_ONE }),
    getGameScript(openingBoard('started')),
  ]);
  await h.host.boot();
  if (!h.host.startOffered()) throw new Error('arrange: start was not offered');
  const fired = await around(h, 'POST', START_PATH, 'starts the match', () => h.host.start());
  return asLead(h, fired);
};

export const leadLibrary = async (token: string): Promise<LeadResult> => {
  const h = authed(token, undefined, [emptyLibrary()]);
  const fired = await around(h, 'GET', '/my-games', 'refreshes My games', () => h.host.refreshLibrary());
  return asLead(h, fired);
};

export const leadOpen = async (token: string): Promise<LeadResult> => {
  const h = authed(token, undefined, [getGameScript(openingBoard('opened'))]);
  const fired = await around(h, 'GET', GAME_PATH, 'opens a listed game', () =>
    h.host.openMyGame(GROUP_HASH, GAME_ONE),
  );
  return asLead(h, fired);
};

export const leadSubmit = async (token: string): Promise<LeadResult> => {
  const h = authed(token, gameHash(GROUP_HASH, GAME_ONE), [
    getGameScript(openingBoard('submit')),
    postMoveScript(200, { version: 1 }),
  ]);
  await h.host.boot();
  const fired = await around(h, 'POST', MOVES_PATH, 'submits a move', () =>
    h.host.submitMoves([pass()]),
  );
  return asLead(h, fired);
};

export const leadExport = async (token: string): Promise<LeadResult> => {
  const h = authed(token, gameHash(GROUP_HASH, GAME_ONE), [
    scripted('GET', EXPORT_PATH, 200, undefined, '{}'),
  ]);
  const fired = await around(h, 'GET', EXPORT_PATH, 'exports the game', () =>
    h.host.adapter().exportGame(),
  );
  return asLead(h, fired);
};

export const leadDelete = async (token: string): Promise<LeadResult> => {
  // The 200 is followed by a library read. Script it 200 — an unscripted
  // /my-games 401 would prompt for the wrong reason.
  const h = authed(token, undefined, [
    scripted('POST', DELETE_PATH, 200, { deleted: true }),
    emptyLibrary(),
  ]);
  const fired = await around(h, 'POST', DELETE_PATH, 'deletes the game', () =>
    h.host.adapter().deleteGame(GROUP_HASH, GAME_ONE),
  );
  return asLead(h, fired);
};

export const leadHide = async (token: string): Promise<LeadResult> => {
  const h = authed(token, undefined, [
    scripted('POST', HIDE_PATH, 200, { hidden: true }),
    emptyLibrary(),
  ]);
  const fired = await around(h, 'POST', HIDE_PATH, 'hides the game', () =>
    h.host.adapter().hideGame(GROUP_HASH, GAME_ONE, true),
  );
  return asLead(h, fired);
};

export const leadRename = async (token: string): Promise<LeadResult> => {
  const h = authed(token, undefined, [scripted('POST', NAME_PATH, 200, {}), emptyLibrary()]);
  const fired = await around(h, 'POST', NAME_PATH, 'renames the game', () =>
    h.host.adapter().renameGame(GROUP_HASH, GAME_ONE, 'Rematch'),
  );
  return asLead(h, fired);
};

export const leadLoadMore = async (token: string): Promise<LeadResult> => {
  const expiry = tokenExpiryMs(token);
  if (expiry === undefined) throw new Error('arrange: load-more token has no exp');
  // Load the library outside the lead so that read does not set promptedFor.
  let now = expiry - REAUTH_LEAD_MS - 1;
  const h = frozenHost({
    sessionToken: token,
    fetchScript: [oneGameLibrary(), emptyLibrary()],
    now: () => now,
  });
  await h.host.refreshLibrary();
  if (h.gis.promptCount !== 0) {
    throw new Error('arrange: loading the library prompted before the lead window');
  }
  now = expiry - MINUTE_MS;
  const fired = await around(h, 'GET', '/my-games', 'loads more games', () =>
    h.host.adapter().loadMoreGames('your-turn'),
  );
  return asLead(h, fired);
};

const noBoundHuman = (h: HostHarness): boolean =>
  (h.host.adapter().inviteSeats() ?? []).every(
    (seat) => seat.kind !== 'human' || seat.userHash === undefined,
  );

export const doorAccept = async (token: string): Promise<DoorResult> => {
  const h = authed(token, inviteHash(INVITE_TOKEN), [
    peekInviteScript(INVITE_TOKEN, waitingSeats()),
    scripted('POST', ACCEPT_PATH, 401, { error: 'unauthorized' }),
  ]);
  await h.host.boot();
  const fired = await around(h, 'POST', ACCEPT_PATH, 'accepts the invite', () => h.host.acceptInvite());
  return {
    h,
    prompts: fired.prompts,
    sent: fired.sent.length,
    failure: noBoundHuman(h) ? 'no seat was bound' : 'a seat was bound',
  };
};

export const doorStart = async (token: string): Promise<DoorResult> => {
  const h = authed(token, inviteHash(INVITE_TOKEN), [
    peekInviteScript(INVITE_TOKEN, aliceBobSeats()),
    scripted('POST', START_PATH, 401, { error: 'unauthorized' }),
  ]);
  await h.host.boot();
  if (!h.host.startOffered()) throw new Error('arrange: start was not offered');
  const hash = h.location.hash;
  const fired = await around(h, 'POST', START_PATH, 'starts the match', () => h.host.start());
  return {
    h,
    prompts: fired.prompts,
    sent: fired.sent.length,
    failure: h.location.hash === hash ? 'the hash is unchanged' : 'the hash changed',
  };
};

export const doorRead = async (token: string): Promise<DoorResult> => {
  const board = openingBoard('before-401');
  const h = authed(token, gameHash(GROUP_HASH, GAME_ONE), [
    getGameScript(board),
    scripted('GET', GAME_PATH, 401, { error: 'unauthorized' }),
  ]);
  await h.host.boot();
  const before = h.host.board();
  const fired = await around(h, 'GET', GAME_PATH, 'reads the game', () =>
    h.host.openMyGame(GROUP_HASH, GAME_ONE),
  );
  const same = JSON.stringify(h.host.board()) === JSON.stringify(before);
  return {
    h,
    prompts: fired.prompts,
    sent: fired.sent.length,
    failure: same ? 'the board is unchanged' : 'the board changed',
  };
};

export const doorExport = async (token: string): Promise<DoorResult> => {
  const h = authed(token, gameHash(GROUP_HASH, GAME_ONE), [
    scripted('GET', EXPORT_PATH, 401, { error: 'unauthorized' }),
  ]);
  const fired = await around(h, 'GET', EXPORT_PATH, 'exports the game', () =>
    h.host.adapter().exportGame(),
  );
  return {
    h,
    prompts: fired.prompts,
    sent: fired.sent.length,
    failure: fired.value === undefined ? 'no export text' : 'export text',
  };
};

const doorManage = async (
  token: string,
  path: string,
  action: string,
  failure: string,
  run: (h: HostHarness) => Promise<boolean>,
): Promise<DoorResult> => {
  const h = authed(token, undefined, [scripted('POST', path, 401, { error: 'unauthorized' })]);
  const fired = await around(h, 'POST', path, action, () => run(h));
  return {
    h,
    prompts: fired.prompts,
    sent: fired.sent.length,
    failure: fired.value ? `${action} returned true` : failure,
  };
};

export const doorDelete = (token: string): Promise<DoorResult> =>
  doorManage(token, DELETE_PATH, 'deletes the game', 'delete returned false', (h) =>
    h.host.adapter().deleteGame(GROUP_HASH, GAME_ONE),
  );

export const doorHide = (token: string): Promise<DoorResult> =>
  doorManage(token, HIDE_PATH, 'hides the game', 'hide returned false', (h) =>
    h.host.adapter().hideGame(GROUP_HASH, GAME_ONE, true),
  );

export const doorRename = (token: string): Promise<DoorResult> =>
  doorManage(token, NAME_PATH, 'renames the game', 'rename returned false', (h) =>
    h.host.adapter().renameGame(GROUP_HASH, GAME_ONE, 'Rematch'),
  );

export const doorPoll = async (token: string): Promise<DoorResult> => {
  const h = authed(token, gameHash(GROUP_HASH, GAME_ONE), [
    scripted('GET', VERSION_PATH, 401, { error: 'unauthorized' }),
  ]);
  const board = h.host.board();
  const replays = h.host.adapter().pendingReplays().length;
  const fired = await around(h, 'GET', VERSION_PATH, 'polls the version', () => h.host.handlePoll());
  const quiet = h.host.adapter().pendingReplays().length === replays && h.host.board() === board;
  return {
    h,
    prompts: fired.prompts,
    sent: fired.sent.length,
    failure: quiet ? 'no wake was taken' : 'a wake was taken',
  };
};

export const doorLoadMore = async (token: string): Promise<DoorResult> => {
  const h = authed(token, undefined, [
    oneGameLibrary(),
    scripted('GET', '/my-games', 401, { error: 'unauthorized' }),
  ]);
  await h.host.refreshLibrary();
  const before = h.host.adapter().myGames()?.games.length ?? 0;
  if (before === 0) throw new Error('arrange: load-more had no row to keep');
  const fired = await around(h, 'GET', '/my-games', 'loads more games', () =>
    h.host.adapter().loadMoreGames('your-turn'),
  );
  const same = (h.host.adapter().myGames()?.games.length ?? 0) === before;
  return {
    h,
    prompts: fired.prompts,
    sent: fired.sent.length,
    failure: same ? 'no row was appended' : 'a row was appended',
  };
};

export const doorBoot = async (token: string): Promise<DoorResult> => {
  const h = authed(token, undefined, [scripted('GET', '/me', 401, { error: 'unauthorized' })]);
  const fired = await around(h, 'GET', '/me', 'boots and reads /me', () => h.host.boot());
  return {
    h,
    prompts: fired.prompts,
    sent: fired.sent.length,
    failure: h.host.adapter().userHash() === undefined ? 'the user hash is unset' : 'the user hash is set',
  };
};

export const DOOR_401 = {
  'accepts the invite': doorAccept,
  'starts the match': doorStart,
  'reads the game': doorRead,
  'exports the game': doorExport,
  'deletes the game': doorDelete,
  'hides the game': doorHide,
  'renames the game': doorRename,
  'polls the version': doorPoll,
  'loads more games': doorLoadMore,
  'boots and reads /me': doorBoot,
} as const;

export type DoorAction = keyof typeof DOOR_401;

export const LEAD_ACTIONS = {
  'creates an invite': leadCreate,
  'accepts the invite': leadAccept,
  'starts the match': leadStart,
  'refreshes My games': leadLibrary,
  'opens a listed game': leadOpen,
  'submits a move': leadSubmit,
  'exports the game': leadExport,
  'deletes the game': leadDelete,
  'hides the game': leadHide,
  'renames the game': leadRename,
  'loads more games': leadLoadMore,
} as const;

export type LeadAction = keyof typeof LEAD_ACTIONS;

/** A create that today's code does send, answered 401. Does not implement the hold. */
export const createAnswered401 = async (
  extra: readonly ScriptedFetch[] = [],
  token = hourToken(),
): Promise<HostHarness> => {
  const h = frozenHost({
    sessionToken: token,
    fetchScript: [scripted('POST', '/invites', 401, { error: 'unauthorized' }), ...extra],
  });
  armCreate(h);
  await h.host.createInvite();
  requireSent(apiCalls(h, 'POST', '/invites'), 'creates an invite');
  return h;
};

export const invitePostBody = (h: HostHarness, index: number): unknown => {
  const req = apiCalls(h, 'POST', '/invites')[index];
  return req === undefined ? undefined : parseJson(req.body);
};

export const submitIds = (h: HostHarness): readonly unknown[] =>
  apiCalls(h, 'POST', MOVES_PATH).map(
    (req) => (parseJson(req.body) as { readonly submitId?: unknown } | undefined)?.submitId,
  );

export const bears = (requests: readonly OnlinePagesHttpRequest[], token: string): boolean =>
  requests.length > 0 && requests.every((req) => bearerOf(req) === token);
