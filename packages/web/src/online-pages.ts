/**
 * Pages online adapter — GIS session, hash routes, REST, and WS wake-up.
 * Tests inject fake GIS, fetch, WebSocket, storage, ids, timers, and a clock.
 *
 * @see docs/spec/online-web/online-web.md
 */

import type {
  GameNumber,
  GroupHash,
  InviteSeat,
  InviteToken,
  LibraryChangedPayload,
  LibraryList,
  Move,
  MyGamesBody,
  OnlineGameBoard,
  OnlinePagesDeps,
  OnlinePagesHttpRequest,
  OnlinePagesHttpResponse,
  OnlinePagesPort,
  OnlinePagesSocket,
  PagesLobbyMode,
  ReplayBatch,
  PlannedSeatKind,
  StartedGameRow,
  StateChangedPayload,
  SubmitOutcome,
  SubmitRefusal,
  UserHash,
} from '@conquarrow/contracts';
import { DELETE_GAME_CONFIRM, FINISHED_PAGE, normalizeGameName } from '@conquarrow/contracts';
import { isOnlineEnvReady } from './online-env';
import { copiedInviteUrl, formatGameHash, parsePagesHash } from './online-hash';
import { CREATE_FAILED_COPY, createRefusedNote } from './online-shell-ui';
import {
  asRecord,
  parseBoard,
  parseGoneReason,
  parseInviteToken,
  parseJson,
  parseLibraryPage,
  parseMyGames,
  parseSeats,
  parseStartIds,
  parseUserHash,
  playersOf,
  quotedVersion,
  winnerOf,
  activePlayerOf,
} from './online-parse';
import { afterRecheck, healedOutcome, heldPlan, REPLAY_STALL_MS, replayStalled } from './online-heal';
import { logPath, parseLogWindow, planFromWake } from './online-replay';
import {
  clearSessionToken,
  readUsableSessionToken,
  tokenExpiryMs,
  writeSessionToken,
} from './online-session';

/** P95 D9: one POST is tried at most this many times. */
export const SUBMIT_ATTEMPTS = 3;
/** P95 D9: the wait before retry n is `SUBMIT_RETRY_MS × n`. */
export const SUBMIT_RETRY_MS = 1000;
/** P95 D12: a token this close to its `exp` is refreshed before it fails. */
export const REAUTH_LEAD_MS = 5 * 60 * 1000;
/** P95 D11: the message the heartbeat sends (the WS `$default` route answers it). */
export const HEARTBEAT_MESSAGE = '{"action":"ping"}';

/** P95 D9: statuses a gateway or a cold Lambda answers; the same id makes a retry safe. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504]);

/** P95 D10: a submit stopped by a 401, waiting for the next sign-in. */
interface HeldSubmit {
  readonly groupHash: GroupHash;
  readonly gameNumber: GameNumber;
  readonly moves: readonly Move[];
  readonly ids: readonly string[];
  readonly version: number;
  /** P104 D1: who the hold was made for; a different `/me` drops it. */
  readonly userHash: UserHash | undefined;
}

const defaultNewId = (): string => crypto.randomUUID();
const immediately = (): Promise<void> => Promise.resolve();

const LOCAL_SEAT_KINDS: readonly PlannedSeatKind[] = ['human', 'heuristic', 'byok'];
const ONLINE_SEAT_KINDS: readonly PlannedSeatKind[] = ['human', 'heuristic', 'agent'];

interface AdapterState {
  mode: PagesLobbyMode;
  seatPlan: readonly PlannedSeatKind[];
  localStarted: boolean;
  copiedUrl: string | undefined;
  board: OnlineGameBoard | undefined;
  lobbyIsFull: boolean;
  /** HTTP 410 on peek/accept — blocks another POST even when `reason` is absent. */
  inviteGone: boolean;
  goneReason: 'revoked' | 'started' | 'deleted' | undefined;
  seats: readonly InviteSeat[] | undefined;
  inviteToken: InviteToken | undefined;
  library: MyGamesBody | undefined;
  userHash: UserHash | undefined;
  socket: OnlinePagesSocket | undefined;
  /** P49 D4: the version this client is *showing*, not the one the server holds. */
  displayed: number | undefined;
  /** P49: batches awaiting App's drain loop, in arrival order. Never dropped. */
  replays: ReplayBatch[];
  /**
   * P49: the batch handed to App and not yet finished. A dequeued batch is still
   * *in flight* — it has left the queue but its moves are only now reaching the
   * board — so it still owns the baseline and still refuses local input.
   * Cleared by `noteDisplayed`, which is exactly App reporting it finished.
   */
  inFlight: ReplayBatch | undefined;
  /** P104 D2: when a batch was last queued, taken or finished; the watchdog reads it. */
  replayProgressAt: number | undefined;
  /** P104 D4: a heal outcome from a poll or a resume, until App reads it. */
  healOutcome: SubmitOutcome | undefined;
  /** P94 D4: a `submitMoves` call has not settled yet. */
  submitting: boolean;
  /** P95 D10: the unsent rest of a submit a 401 stopped. */
  held: HeldSubmit | undefined;
  /** P95 D12: the token a refresh was already asked for, so it is asked once. */
  promptedFor: string | undefined;
  /** P98 D2: an authenticated 401 cleared the token. A usable credential or sign-out clears it. */
  sessionExpired: boolean;
  /** P98 D4: the sentence after a create that settled and did not succeed and was not a 401. */
  createNote: string | undefined;
  /** P98 D5: the last library read failed and was not a 401. */
  libraryFailed: boolean;
  /** P98 D3: a POST /invites 401, waiting for one lobby retry. Not the body — that is read at credential time. */
  heldCreate: boolean;
  /** P96 D6: the invite name as typed. */
  inviteName: string;
  /** P96 D9: hidden rows loaded so far, in listing order. */
  hidden: readonly StartedGameRow[];
  /** P96 D12: the game the hash named was deleted. */
  deleted: boolean;
}

const emptyState = (): AdapterState => ({
  mode: 'local',
  seatPlan: [],
  localStarted: false,
  copiedUrl: undefined,
  board: undefined,
  lobbyIsFull: false,
  inviteGone: false,
  goneReason: undefined,
  seats: undefined,
  inviteToken: undefined,
  library: undefined,
  userHash: undefined,
  socket: undefined,
  displayed: undefined,
  replays: [],
  inFlight: undefined,
  replayProgressAt: undefined,
  healOutcome: undefined,
  submitting: false,
  held: undefined,
  promptedFor: undefined,
  sessionExpired: false,
  createNote: undefined,
  libraryFailed: false,
  heldCreate: false,
  inviteName: '',
  hidden: [],
  deleted: false,
});

const humanCount = (plan: readonly PlannedSeatKind[]): number =>
  plan.filter((kind) => kind === 'human').length;

const agentCount = (plan: readonly PlannedSeatKind[]): number =>
  plan.filter((kind) => kind === 'agent').length;

/** Two Players, or a Player and an Agent. The lobby sentence uses this; do not copy it. */
export const onlinePlanCreatable = (plan: readonly PlannedSeatKind[]): boolean => {
  const humans = humanCount(plan);
  return humans >= 2 || (humans >= 1 && agentCount(plan) >= 1);
};

const joinApi = (apiBase: string, path: string): string => {
  const base = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;
  return `${base}${path}`;
};

const ownSeatIndex = (seats: readonly InviteSeat[], userHash: UserHash): number => {
  for (let i = 0; i < seats.length; i += 1) {
    const seat = seats[i];
    if (seat?.kind === 'human' && seat.userHash === userHash) return i;
  }
  return -1;
};

export const occupiesHumanChair = (
  seats: readonly InviteSeat[] | undefined,
  userHash: UserHash | undefined,
): boolean => {
  if (seats === undefined || userHash === undefined) return false;
  return ownSeatIndex(seats, userHash) >= 0;
};

/**
 * When seats and `/me` are known, seat i is `players[i]` (P18). Unknown → allow
 * POST. Used by submitMove and by online auto-pass (P26: only the caller's turn).
 */
export const isCallerToMove = (
  seats: readonly InviteSeat[] | undefined,
  userHash: UserHash | undefined,
  players: readonly string[] | undefined,
  active: string | undefined,
): boolean => {
  if (seats === undefined || userHash === undefined) return true;
  const index = ownSeatIndex(seats, userHash);
  if (index < 0) return false;
  const mine = players?.[index];
  if (mine === undefined || active === undefined) return true;
  return mine === active;
};

/** P100 D1: the facts the submit guards read. */
export interface SubmitGuardInput {
  readonly onlineReady: boolean;
  readonly signedIn: boolean;
  /** On a game route with a board loaded. */
  readonly onGame: boolean;
  readonly moveCount: number;
  readonly submitting: boolean;
  readonly held: boolean;
  readonly replaying: boolean;
  readonly gameOver: boolean;
  readonly callerToMove: boolean;
}

/**
 * P100 D1. The first failing guard, in `SUBMIT_REFUSALS` order, or
 * `undefined` when the submit may be sent.
 */
export const submitRefusal = (input: SubmitGuardInput): SubmitRefusal | undefined => {
  if (!input.onlineReady) return 'not-ready';
  if (input.submitting) return 'sending';
  // P95 D10: a 401 holds the rest and clears the token, so held outranks signed out.
  if (input.held) return 'held';
  if (!input.signedIn) return 'signed-out';
  if (!input.onGame) return 'no-game';
  if (input.moveCount === 0) return 'no-moves';
  // P49 D7: the board is showing a superseded position while a batch plays.
  if (input.replaying) return 'replaying';
  if (input.gameOver) return 'game-over';
  if (!input.callerToMove) return 'not-your-turn';
  return undefined;
};

const callerIsToMove = (state: AdapterState): boolean => {
  const board = state.board;
  if (board === undefined) return true;
  return isCallerToMove(
    state.seats,
    state.userHash,
    playersOf(board.state),
    activePlayerOf(board.state),
  );
};

export const createOnlinePages = (deps: OnlinePagesDeps): OnlinePagesPort => {
  const { env, session, location, fetch: fetchHttp, openSocket, gis } = deps;
  const newId = deps.newId ?? defaultNewId;
  const wait = deps.wait ?? immediately;
  const now = deps.now ?? Date.now;
  const replayStallMs = deps.replayStallMs ?? REPLAY_STALL_MS;
  /** P104: a heal's reads may reject (fetch down); the decision then stands on what was read. */
  const swallow = async (work: Promise<unknown>): Promise<void> => {
    try {
      await work;
    } catch {
      // The guards re-read state; a failed read leaves it as it was.
    }
  };
  const state = emptyState();

  const onlineReady = (): boolean => isOnlineEnvReady(env);

  const token = (): string | undefined => readUsableSessionToken(session, now);

  const closeSocket = (): void => {
    state.socket?.close();
    state.socket = undefined;
  };

  /** Invite chairs belong to one lobby. Library resume must not reuse them. */
  const clearInviteScope = (): void => {
    state.copiedUrl = undefined;
    state.lobbyIsFull = false;
    state.inviteGone = false;
    state.goneReason = undefined;
    state.seats = undefined;
    state.inviteToken = undefined;
  };

  const clearIdentityScope = (): void => {
    state.userHash = undefined;
    state.board = undefined;
    state.displayed = undefined;
    state.replays = [];
    state.inFlight = undefined;
    state.replayProgressAt = undefined;
    state.healOutcome = undefined;
    state.library = undefined;
    state.held = undefined;
    state.promptedFor = undefined;
    state.sessionExpired = false;
    state.createNote = undefined;
    state.libraryFailed = false;
    state.heldCreate = false;
    state.hidden = [];
    state.deleted = false;
    clearInviteScope();
  };

  /** P96 D12: the game on screen is gone — back to the lobby, saying so. */
  const clearDeletedGame = (): void => {
    state.board = undefined;
    state.displayed = undefined;
    state.replays = [];
    state.inFlight = undefined;
    state.replayProgressAt = undefined;
    state.held = undefined;
    state.deleted = true;
    location.hash = '';
  };

  const onScreen = (groupHash: GroupHash, gameNumber: GameNumber): boolean => {
    const route = parsePagesHash(location.hash);
    return route.kind === 'game' && route.groupHash === groupHash && route.gameNumber === gameNumber;
  };

  const openSessionSocket = (): void => {
    closeSocket();
    const access = token();
    if (!onlineReady() || access === undefined) return;
    const opened: OnlinePagesSocket = openSocket(
      `${env.VITE_WS_URL}?access_token=${encodeURIComponent(access)}`,
      {
        // P95 D11: a closed socket is forgotten, so the next poll or resume reopens it.
        onClose: () => {
          if (state.socket === opened) state.socket = undefined;
        },
      },
    );
    state.socket = opened;
  };

  /** P95 D12: ask GIS once per token for a fresh one before this one expires. */
  const refreshTokenIfStale = (): void => {
    const access = token();
    if (access === undefined || state.promptedFor === access) return;
    const expiry = tokenExpiryMs(access);
    if (expiry === undefined || expiry - now() > REAUTH_LEAD_MS) return;
    state.promptedFor = access;
    gis.prompt();
  };

  /**
   * P98 D2. The one door for an authenticated 401. Removes the token, forgets
   * the socket, sets session expired, and prompts even when `promptedFor`
   * already named that token. Does not drop a held submit. The invite peek
   * (`auth: false`) never reaches this.
   */
  const expireSession = (): void => {
    clearSessionToken(session);
    state.promptedFor = undefined;
    closeSocket();
    state.sessionExpired = true;
    gis.prompt();
  };

  const request = async (
    method: 'GET' | 'POST',
    path: string,
    options?: {
      readonly auth?: boolean;
      readonly body?: unknown;
      readonly headers?: Readonly<Record<string, string>>;
    },
  ): Promise<OnlinePagesHttpResponse> => {
    const headers: Record<string, string> = { ...options?.headers };
    if (options?.auth !== false) {
      const bearer = token();
      if (bearer !== undefined) headers['Authorization'] = `Bearer ${bearer}`;
    }
    const req: OnlinePagesHttpRequest = {
      url: joinApi(env.VITE_API_BASE, path),
      method,
      headers,
    };
    const sent: OnlinePagesHttpRequest =
      options?.body === undefined
        ? req
        : {
            ...req,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(options.body),
          };
    const res = await fetchHttp(sent);
    if (options?.auth !== false && res.status === 401) expireSession();
    return res;
  };

  /** True when the door already ran for this authenticated response. */
  const onUnauthorized = (status: number): boolean => status === 401;

  /** P104 D1: true only for a 200 — the session the heal may act on. */
  const loadMe = async (): Promise<boolean> => {
    // Every caller is online-ready already; the token is the heal's signed-out door.
    if (token() === undefined) return false;
    const res = await request('GET', '/me');
    if (res.status !== 200) return false;
    const hash = parseUserHash(asRecord(parseJson(res.body))?.['userHash']);
    if (hash !== undefined) state.userHash = hash;
    return true;
  };

  const markInviteGone = (raw: unknown): void => {
    state.inviteGone = true;
    state.goneReason = parseGoneReason(raw);
  };

  const applyInviteBody = (raw: unknown): void => {
    const rec = asRecord(raw);
    const inviteToken = parseInviteToken(rec?.['token']);
    const seats = parseSeats(rec?.['seats']);
    if (inviteToken !== undefined) state.inviteToken = inviteToken;
    if (seats !== undefined) state.seats = seats;
    state.inviteGone = false;
    state.goneReason = undefined;
    state.lobbyIsFull = false;
  };

  const getGame = async (groupHash: GroupHash, gameNumber: GameNumber): Promise<void> => {
    if (!onlineReady() || token() === undefined) return;
    const res = await request('GET', `/games/${groupHash}/${gameNumber}`);
    if (onUnauthorized(res.status)) return;
    if (res.status === 404 && onScreen(groupHash, gameNumber)) {
      clearDeletedGame();
      return;
    }
    if (res.status !== 200) return;
    const board = parseBoard(parseJson(res.body));
    if (board === undefined) return;
    state.board = board;
    state.deleted = false;
    if (board.seats !== undefined) state.seats = board.seats;
  };

  const openStartedFromGone = async (body: unknown): Promise<void> => {
    if (parseGoneReason(body) !== 'started') return;
    const ids = parseStartIds(body);
    if (ids === undefined) return;
    location.hash = formatGameHash(ids.groupHash, ids.gameNumber);
    await getGame(ids.groupHash, ids.gameNumber);
  };

  const peekHeldInvite = async (options: {
    readonly promptIfUnsigned: boolean;
    readonly followStarted: boolean;
  }): Promise<void> => {
    const inviteToken = state.inviteToken;
    if (!onlineReady() || inviteToken === undefined) return;
    const res = await request('GET', `/invites/${inviteToken}`, { auth: false });
    if (res.status === 410) {
      const body = parseJson(res.body);
      markInviteGone(body);
      if (options.followStarted) await openStartedFromGone(body);
      return;
    }
    if (res.status !== 200) return;
    applyInviteBody(parseJson(res.body));
    if (options.promptIfUnsigned && token() === undefined) gis.prompt();
  };

  const peekInvite = async (inviteToken: InviteToken): Promise<void> => {
    if (!onlineReady()) return;
    state.inviteToken = inviteToken;
    await peekHeldInvite({ promptIfUnsigned: true, followStarted: false });
  };

  const routeFromHash = async (): Promise<void> => {
    const route = parsePagesHash(location.hash);
    if (route.kind === 'invite') {
      await peekInvite(route.token);
      return;
    }
    if (route.kind === 'game') {
      await getGame(route.groupHash, route.gameNumber);
    }
  };

  const acceptInvite = async (): Promise<void> => {
    refreshTokenIfStale();
    if (!onlineReady() || token() === undefined) return;
    const inviteToken = state.inviteToken;
    if (inviteToken === undefined || state.inviteGone) return;
    const res = await request('POST', `/invites/${inviteToken}/accept`, { body: {} });
    if (onUnauthorized(res.status)) return;
    if (res.status === 409) {
      state.lobbyIsFull = true;
      state.board = undefined;
      return;
    }
    if (res.status === 410) {
      markInviteGone(parseJson(res.body));
      return;
    }
    if (res.status === 200) applyInviteBody(parseJson(res.body));
  };

  const inviteRequestBody = (): { readonly seats: readonly PlannedSeatKind[]; readonly name?: string } => {
    const named = normalizeGameName(state.inviteName);
    if (!named.ok || named.name === undefined) return { seats: state.seatPlan };
    return { seats: state.seatPlan, name: named.name };
  };

  /** Online, a creatable plan, a valid name, and a usable token. */
  const createGatesPass = (): boolean =>
    onlineReady() &&
    state.mode === 'online' &&
    onlinePlanCreatable(state.seatPlan) &&
    normalizeGameName(state.inviteName).ok &&
    token() !== undefined;

  const refusedReason = (body: string): string | undefined => {
    const reason = asRecord(parseJson(body))?.['reason'];
    return typeof reason === 'string' && reason !== '' ? reason : undefined;
  };

  const installCreatedInvite = (body: string): void => {
    state.createNote = undefined;
    applyInviteBody(parseJson(body));
    const inviteToken = state.inviteToken;
    if (inviteToken === undefined) return;
    state.copiedUrl = copiedInviteUrl(location.origin, location.pathname, inviteToken);
  };

  const noteCreateFailure = (status: number, body: string): void => {
    state.copiedUrl = undefined;
    state.createNote =
      status === 422 ? createRefusedNote(refusedReason(body)) : CREATE_FAILED_COPY;
  };

  /**
   * P98 D3/D4. `armHold` is true only for the player's create. The credential
   * retry passes false so a second 401 does not post a third time.
   */
  const applyCreateResponse = (res: OnlinePagesHttpResponse, armHold: boolean): void => {
    if (res.status === 401) {
      state.copiedUrl = undefined;
      state.createNote = undefined;
      if (armHold) state.heldCreate = true;
      return;
    }
    if (res.status === 200 || res.status === 201) {
      installCreatedInvite(res.body);
      return;
    }
    noteCreateFailure(res.status, res.body);
  };

  const postInvite = async (armHold: boolean): Promise<OnlinePagesHttpResponse | 'thrown'> => {
    try {
      const res = await request('POST', '/invites', { body: inviteRequestBody() });
      applyCreateResponse(res, armHold);
      return res;
    } catch {
      state.copiedUrl = undefined;
      state.createNote = CREATE_FAILED_COPY;
      return 'thrown';
    }
  };

  const createInvite = async (): Promise<void> => {
    refreshTokenIfStale();
    state.createNote = undefined;
    if (!createGatesPass()) return;
    state.heldCreate = false;
    await postInvite(true);
  };

  const startOnlineMatch = async (): Promise<void> => {
    refreshTokenIfStale();
    if (!onlineReady() || token() === undefined) return;
    const inviteToken = state.inviteToken;
    if (inviteToken === undefined) return;
    const res = await request('POST', `/invites/${inviteToken}/start`);
    if (onUnauthorized(res.status)) return;
    if (res.status !== 200) return;
    const ids = parseStartIds(parseJson(res.body));
    if (ids === undefined) return;
    location.hash = formatGameHash(ids.groupHash, ids.gameNumber);
    await getGame(ids.groupHash, ids.gameNumber);
  };

  /** P98 D5. A 401 is not a failure and does not install an empty success. */
  const applyLibraryResponse = (res: OnlinePagesHttpResponse): void => {
    if (res.status === 401) {
      state.libraryFailed = false;
      return;
    }
    if (res.status !== 200) {
      state.libraryFailed = true;
      return;
    }
    const library = parseMyGames(parseJson(res.body));
    if (library === undefined) {
      state.libraryFailed = true;
      return;
    }
    state.library = library;
    state.libraryFailed = false;
  };

  const refreshLibrary = async (): Promise<void> => {
    refreshTokenIfStale();
    if (!onlineReady() || token() === undefined) return;
    try {
      applyLibraryResponse(await request('GET', '/my-games'));
    } catch {
      state.libraryFailed = true;
    }
  };

  const refreshLobby = async (): Promise<void> => {
    if (!onlineReady()) return;
    if (state.inviteToken !== undefined && state.board === undefined) {
      await peekHeldInvite({ promptIfUnsigned: false, followStarted: true });
    }
    if (token() !== undefined) await refreshLibrary();
  };

  const openMyGame = async (groupHash: GroupHash, gameNumber: GameNumber): Promise<void> => {
    refreshTokenIfStale();
    clearInviteScope();
    // P95 D10: a held submit belongs to the game it was made in.
    if (state.held?.groupHash !== groupHash || state.held.gameNumber !== gameNumber) {
      state.held = undefined;
    }
    location.hash = formatGameHash(groupHash, gameNumber);
    await getGame(groupHash, gameNumber);
  };

  /**
   * EARS 11 / D7. A replay is in flight from the moment a batch is queued until
   * App reports the last one finished — dequeuing hands it to the drain loop, it
   * does not end it.
   */
  const replayInFlight = (): boolean =>
    state.replays.length > 0 || state.inFlight !== undefined;

  /**
   * The version the next replay must start from: the last batch already spoken
   * for — queued, or dequeued and still playing — and only then what App last
   * reported displaying.
   *
   * The displayed baseline lags a batch by design: App reports it when the batch
   * *finishes*. Reading it here would re-fetch and re-apply moves that are on
   * screen right now, and the duplicate would then be reported as a D5
   * divergence against the very snapshot it came from.
   */
  const replayBaseline = (): number | undefined =>
    state.replays[state.replays.length - 1]?.to ?? state.inFlight?.to ?? state.displayed;

  const fetchLogWindow = async (
    groupHash: GroupHash,
    gameNumber: GameNumber,
    since: number,
  ): Promise<ReturnType<typeof parseLogWindow>> => {
    const res = await request('GET', logPath(groupHash, gameNumber, since));
    if (res.status !== 200) return undefined;
    return parseLogWindow(parseJson(res.body));
  };

  /**
   * D4. The snapshot is fetched either way; what the wake decides is whether App
   * plays the moves that reach it or simply shows it.
   */
  const planWake = async (groupHash: GroupHash, gameNumber: GameNumber): Promise<void> => {
    await getGame(groupHash, gameNumber);
    const to = state.board?.version;
    if (to === undefined) return;
    const baseline = replayBaseline();
    const window =
      baseline === undefined || baseline >= to
        ? undefined
        : await fetchLogWindow(groupHash, gameNumber, baseline);
    const plan = planFromWake({ baseline, to, window });
    if (plan.kind === 'replay') {
      state.replays.push(plan.batch);
      state.replayProgressAt = now();
    }
  };

  /** P94 D5: the outcome a non-200 answer to a POST stops the submit with. */
  const outcomeOfStatus = (status: number): SubmitOutcome => {
    if (status === 422) return 'illegal';
    if (status === 403) return 'forbidden';
    if (status === 409 || status === 412) return 'stale';
    return 'failed';
  };

  /**
   * P94 D2 / P95 D9. One attempt at one POST: the version it produced, the
   * outcome that stops the submit, or `retry` for a lost request or a gateway
   * answer. A 200 with no integer `version` stops it as `sent` — what was
   * posted landed, and the reconcile catches the board up.
   */
  const attemptPost = async (
    path: string,
    move: Move,
    version: number,
    submitId: string,
  ): Promise<{ readonly next: number } | { readonly stop: SubmitOutcome } | 'retry'> => {
    let res: OnlinePagesHttpResponse;
    try {
      res = await request('POST', path, {
        body: { move, submitId },
        headers: { 'If-Match': quotedVersion(version) },
      });
    } catch {
      return 'retry';
    }
    if (onUnauthorized(res.status)) return { stop: 'unauthorized' };
    if (RETRYABLE_STATUSES.has(res.status)) return 'retry';
    if (res.status !== 200) return { stop: outcomeOfStatus(res.status) };
    const next = asRecord(parseJson(res.body))?.['version'];
    return typeof next === 'number' && Number.isInteger(next) ? { next } : { stop: 'sent' };
  };

  /** P95 D9: the same body and `If-Match` up to SUBMIT_ATTEMPTS times; a 4xx is final. */
  const postOne = async (
    path: string,
    move: Move,
    version: number,
    submitId: string,
  ): Promise<{ readonly next: number } | { readonly stop: SubmitOutcome }> => {
    for (let attempt = 1; ; attempt += 1) {
      const answer = await attemptPost(path, move, version, submitId);
      if (answer !== 'retry') return answer;
      if (attempt >= SUBMIT_ATTEMPTS) return { stop: 'failed' };
      await wait(SUBMIT_RETRY_MS * attempt);
    }
  };

  /**
   * P94 D2. POST in order, each `If-Match` the previous version; the first stop
   * ends it. P95 D10: `rest` is the index and version a stop left off at.
   */
  const postAll = async (
    path: string,
    moves: readonly Move[],
    ids: readonly string[],
    version: number,
  ): Promise<{ readonly outcome: SubmitOutcome; readonly rest: number; readonly at: number }> => {
    let at = version;
    for (let i = 0; i < moves.length; i += 1) {
      const move = moves[i] as Move;
      const posted = await postOne(path, move, at, ids[i] as string);
      if ('stop' in posted) return { outcome: posted.stop, rest: i, at };
      at = posted.next;
    }
    return { outcome: 'sent', rest: moves.length, at };
  };

  /** P95 D10: keep what a 401 left unsent; the next sign-in sends it. */
  const sendAndHold = async (
    groupHash: GroupHash,
    gameNumber: GameNumber,
    moves: readonly Move[],
    ids: readonly string[],
    version: number,
  ): Promise<SubmitOutcome> => {
    const path = `/games/${groupHash}/${gameNumber}/moves`;
    const posted = await postAll(path, moves, ids, version);
    if (posted.outcome === 'unauthorized') {
      state.held = {
        groupHash,
        gameNumber,
        moves: moves.slice(posted.rest),
        ids: ids.slice(posted.rest),
        version: posted.at,
        userHash: state.userHash,
      };
      return posted.outcome;
    }
    state.held = undefined;
    await reconcile(groupHash, gameNumber);
    return posted.outcome;
  };

  /** P94 D3. The wake path; a failed read leaves the board for the next wake. */
  const reconcile = async (groupHash: GroupHash, gameNumber: GameNumber): Promise<void> => {
    try {
      await planWake(groupHash, gameNumber);
    } catch {
      // The board stays as it was; the next wake or visibility change catches up.
    }
  };

  /** P95 D10: a submit is in flight or held for the next sign-in. */
  const submitPending = (): boolean => state.submitting || state.held !== undefined;

  /** P94 D4 / P100 D1: the guards as they stand now, with the target they guard. */
  const guardsFor = (moves: readonly Move[]) => {
    const route = parsePagesHash(location.hash);
    const board = state.board;
    const target = route.kind === 'game' && board !== undefined ? { route, board } : undefined;
    // P98 D6: reading the token removes an already-unusable one.
    const refusal = submitRefusal({
      onlineReady: onlineReady(),
      signedIn: token() !== undefined,
      onGame: target !== undefined,
      moveCount: moves.length,
      submitting: state.submitting,
      held: state.held !== undefined,
      replaying: replayInFlight(),
      gameOver: board !== undefined && winnerOf(board.state) !== undefined,
      callerToMove: callerIsToMove(state),
    });
    return { target, refusal };
  };

  /**
   * P104 D2: a batch nobody finished for `replayStallMs` is dropped with the
   * baseline it owned, and the board is read fresh. It is never replayed
   * again — App may have applied part of it — so the snapshot is installed.
   */
  const replayIsStalled = (): boolean =>
    replayStalled({
      pending: replayInFlight(),
      progressAt: state.replayProgressAt,
      now: now(),
      stallMs: replayStallMs,
    });

  /** Synchronous when nothing is stalled, so a Send still marks itself pending at once (P94 D4). */
  const flushStalled = async (): Promise<void> => {
    state.replays = [];
    state.inFlight = undefined;
    state.displayed = undefined;
    state.replayProgressAt = undefined;
    const route = parsePagesHash(location.hash);
    if (route.kind === 'game') await swallow(getGame(route.groupHash, route.gameNumber));
  };

  /**
   * P104 D1: settle a hold with what the server says now. `undefined` when
   * there is no hold to heal or it still waits; `'cleared'` when it was for
   * another game (silently dropped); `'no-game'` when a 404 already dropped
   * the hold (P96); otherwise the heal's outcome.
   */
  const healHeld = async (): Promise<SubmitOutcome | 'cleared' | undefined> => {
    const held = state.held;
    // Signed out, `loadMe` answers false and the hold waits for the sign-in.
    if (held === undefined || state.submitting) return undefined;
    state.submitting = true;
    try {
      const meOk = await loadMe();
      const route = parsePagesHash(location.hash);
      const gameRoute =
        // Stryker disable next-line ConditionalExpression -- a non-game PagesHash has no groupHash, so forcing this branch still compares undefined to the held hash, which is false for every hash, and the check narrows the type, but Stryker cannot disable one replacement of this mutator, so this also ignores the paired `false ? route : undefined`, which is not equivalent (a hold on its own game would be dropped).
        route.kind === 'game' ? route : undefined;
      const onHeldGame =
        gameRoute !== undefined &&
        gameRoute.groupHash === held.groupHash &&
        gameRoute.gameNumber === held.gameNumber;
      if (meOk && onHeldGame) await getGame(held.groupHash, held.gameNumber);
      // P96 already dropped the hold on a 404. Missing version is still a wait
      // when the hold remains — do not fold this into heldPlan.
      if (state.held === undefined) return 'no-game';
      const plan = heldPlan({
        held,
        onHeldGame,
        meOk,
        me: state.userHash,
        boardVersion: state.board?.version,
      });
      if (plan === 'wait') return undefined;
      if (plan === 'send') {
        const posted = await sendAndHold(held.groupHash, held.gameNumber, held.moves, held.ids, held.version);
        return healedOutcome(posted);
      }
      state.held = undefined;
      return plan === 'drop-other' ? 'cleared' : 'held-dropped';
    }
    // Stryker disable next-line BlockStatement -- equivalent: an empty catch also answers undefined (the hold waits); the return says so.
    catch {
      return undefined;
    } finally {
      state.submitting = false;
    }
  };

  /** P104 D4: a heal outside a Send keeps its outcome for App, once. */
  const healInBackground = async (): Promise<void> => {
    const healed = await healHeld();
    // An earlier outcome App has not read yet is not erased by a heal that did nothing.
    // A 404's no-game is not stored: the lobby already says the game was deleted.
    if (healed === undefined || healed === 'cleared' || healed === 'no-game') return;
    state.healOutcome = healed;
  };

  const submitMoves = async (moves: readonly Move[]): Promise<SubmitOutcome> => {
    refreshTokenIfStale();
    if (replayIsStalled()) {
      await flushStalled();
      return 'stale';
    }
    let check = guardsFor(moves);
    if (check.refusal === 'held') {
      const healed = await healHeld();
      // P104 D1: a heal answers for this Send; its own moves are not posted.
      if (healed !== 'cleared') return healed ?? 'held';
      check = guardsFor(moves);
    }
    if (
      check.refusal === 'not-your-turn' &&
      // Stryker disable next-line ConditionalExpression -- `not-your-turn` is only reached past `onGame`, so the target is defined.
      check.target !== undefined
    ) {
      // P104 D3: one re-read before the refusal is final.
      const before = check.target.board.version;
      const { groupHash, gameNumber } = check.target.route;
      await swallow(loadMe().then(() => getGame(groupHash, gameNumber)));
      check = guardsFor(moves);
      const decided = afterRecheck({ refusal: check.refusal, before, after: state.board?.version });
      if (decided !== undefined) return decided;
    }
    if (check.refusal !== undefined) return check.refusal;
    const target = check.target;
    // `onGame` already refused a missing target; this only narrows it. A throw,
    // not a second `no-game`, so the guard above is the one that answers.
    // Stryker disable next-line ConditionalExpression -- unreachable: submitRefusal returned 'no-game' for an undefined target.
    if (target === undefined) throw new Error('submitMoves: no game target past the guards');
    state.submitting = true;
    try {
      const ids = moves.map(() => newId());
      const { groupHash, gameNumber } = target.route;
      return await sendAndHold(groupHash, gameNumber, moves, ids, target.board.version);
    } finally {
      state.submitting = false;
    }
  };

  /** P95 D10: after a sign-in, send the held rest of a submit for the game on screen. */
  const sendHeld = async (): Promise<void> => {
    const held = state.held;
    if (held === undefined) return;
    const route = parsePagesHash(location.hash);
    if (
      route.kind !== 'game' ||
      route.groupHash !== held.groupHash ||
      route.gameNumber !== held.gameNumber
    ) {
      state.held = undefined;
      return;
    }
    state.submitting = true;
    try {
      await sendAndHold(held.groupHash, held.gameNumber, held.moves, held.ids, held.version);
    } finally {
      state.submitting = false;
    }
  };

  const receiveStateChanged = async (payload: StateChangedPayload): Promise<void> => {
    if (!onlineReady()) return;
    // P95 D11: the submit's own reconcile reads the game when it settles.
    if (state.submitting) return;
    const route = parsePagesHash(location.hash);
    if (
      route.kind === 'game' &&
      route.groupHash === payload.groupHash &&
      route.gameNumber === payload.gameNumber
    ) {
      await planWake(route.groupHash, route.gameNumber);
      return;
    }
    await refreshLibrary();
  };

  /** P95 D11: reopen a lost socket, then catch up if the server moved on. */
  const poll = async (): Promise<void> => {
    if (!onlineReady() || token() === undefined) return;
    refreshTokenIfStale();
    if (state.socket === undefined) openSessionSocket();
    if (replayIsStalled()) await flushStalled();
    // P104 D1: a hold heals here too; the heal already read the game.
    if (state.held !== undefined) {
      await healInBackground();
      return;
    }
    const route = parsePagesHash(location.hash);
    if (route.kind !== 'game' || submitPending()) return;
    const res = await request('GET', `/games/${route.groupHash}/${route.gameNumber}/version`);
    if (res.status !== 200) return;
    const version = asRecord(parseJson(res.body))?.['version'];
    if (typeof version !== 'number') return;
    const shown = replayBaseline() ?? state.board?.version;
    if (shown !== undefined && version <= shown) return;
    await planWake(route.groupHash, route.gameNumber);
  };

  /** P95 D11: keep the socket out of the gateway's idle timeout. */
  const heartbeat = (): void => {
    state.socket?.send(HEARTBEAT_MESSAGE);
  };

  const becomeVisible = async (): Promise<void> => {
    if (!onlineReady()) return;
    // P95 D12: the page may have slept past the socket and the token.
    refreshTokenIfStale();
    if (token() !== undefined && state.socket === undefined) openSessionSocket();
    if (replayIsStalled()) await flushStalled();
    // P104 D1: a resume heals a hold before it reads the page.
    await healInBackground();
    const route = parsePagesHash(location.hash);
    if (route.kind === 'game') {
      await getGame(route.groupHash, route.gameNumber);
    }
    await refreshLobby();
  };

  const boot = async (): Promise<void> => {
    if (!onlineReady()) return;
    if (token() !== undefined) {
      openSessionSocket();
      await loadMe();
    }
    await routeFromHash();
  };

  /**
   * P98 D3. Lobby credential: retry a held create once, or list as P97 does.
   * The hold is cleared before the post, so a retry 401 cannot arm another.
   */
  const lobbyAfterCredential = async (): Promise<void> => {
    if (state.heldCreate && createGatesPass()) {
      state.heldCreate = false;
      const posted = await postInvite(false);
      if (posted !== 'thrown' && posted.status === 401) return;
      if (token() !== undefined) await refreshLibrary();
      return;
    }
    state.heldCreate = false;
    await refreshLibrary();
  };

  const deliverGoogleCredential = async (idToken: string): Promise<void> => {
    writeSessionToken(session, idToken);
    if (token() !== undefined) state.sessionExpired = false;
    if (!onlineReady()) return;
    openSessionSocket();
    await loadMe();
    await sendHeld();
    const route = parsePagesHash(location.hash);
    if (route.kind === 'invite' || route.kind === 'game') state.heldCreate = false;
    if (route.kind === 'invite' && !state.inviteGone) {
      await acceptInvite();
      return;
    }
    if (route.kind === 'game') {
      await getGame(route.groupHash, route.gameNumber);
      return;
    }
    await lobbyAfterCredential();
  };

  const signOut = (): void => {
    closeSocket();
    clearSessionToken(session);
    clearIdentityScope();
    location.hash = '';
  };

  /** P96 D12: the server's export of the game on screen, as its text. */
  const exportGame = async (): Promise<string | undefined> => {
    refreshTokenIfStale();
    const route = parsePagesHash(location.hash);
    if (!onlineReady() || route.kind !== 'game' || token() === undefined) return undefined;
    try {
      const res = await request('GET', `/games/${route.groupHash}/${route.gameNumber}/export`);
      if (onUnauthorized(res.status)) return undefined;
      return res.status === 200 ? res.body : undefined;
    } catch {
      return undefined;
    }
  };

  /** One P96 management POST; true on 200, false on any other answer or a lost request. */
  const manage = async (
    groupHash: GroupHash,
    gameNumber: GameNumber,
    action: 'delete' | 'name' | 'hide',
    body: unknown,
  ): Promise<boolean> => {
    refreshTokenIfStale();
    if (!onlineReady() || token() === undefined) return false;
    try {
      const res = await request('POST', `/games/${groupHash}/${gameNumber}/${action}`, { body });
      if (onUnauthorized(res.status)) return false;
      return res.status === 200;
    } catch {
      return false;
    }
  };

  const deleteGame = async (groupHash: GroupHash, gameNumber: GameNumber): Promise<boolean> => {
    const done = await manage(groupHash, gameNumber, 'delete', { confirm: DELETE_GAME_CONFIRM });
    if (!done) return false;
    if (onScreen(groupHash, gameNumber)) clearDeletedGame();
    state.hidden = state.hidden.filter((row) => row.groupHash !== groupHash || row.gameNumber !== gameNumber);
    await refreshLibrary();
    return true;
  };

  const hideGame = async (groupHash: GroupHash, gameNumber: GameNumber, hidden: boolean): Promise<boolean> => {
    const done = await manage(groupHash, gameNumber, 'hide', { hidden });
    if (!done) return false;
    const reloadHidden = state.hidden.length > 0 || hidden;
    state.hidden = [];
    await refreshLibrary();
    if (reloadHidden && (state.library?.counts.hidden ?? 0) > 0) await loadMoreGames('hidden');
    return true;
  };

  const renameGame = async (groupHash: GroupHash, gameNumber: GameNumber, name: string): Promise<boolean> => {
    const named = normalizeGameName(name);
    if (!named.ok) return false;
    const done = await manage(groupHash, gameNumber, 'name', { name: named.name ?? '' });
    if (!done) return false;
    await refreshLibrary();
    if (onScreen(groupHash, gameNumber)) await getGame(groupHash, gameNumber);
    return true;
  };

  const sameRow = (a: StartedGameRow, b: StartedGameRow): boolean =>
    a.groupHash === b.groupHash && a.gameNumber === b.gameNumber;

  /** P96 D8: the next page of one list, appended to the rows already held. */
  const loadMoreGames = async (list: LibraryList): Promise<void> => {
    refreshTokenIfStale();
    if (!onlineReady() || token() === undefined) return;
    const library = state.library;
    const held =
      list === 'hidden' ? state.hidden : (library?.games ?? []).filter((row) => row.section === list);
    const query = `section=${list}&offset=${String(held.length)}&limit=${String(FINISHED_PAGE)}`;
    const res = await request('GET', `/my-games?${query}`);
    if (onUnauthorized(res.status) || res.status !== 200) return;
    const page = parseLibraryPage(parseJson(res.body));
    if (page === undefined || page.section !== list) return;
    const fresh = (rows: readonly StartedGameRow[]): readonly StartedGameRow[] =>
      page.games.filter((row) => !rows.some((have) => sameRow(have, row)));
    if (list === 'hidden') {
      state.hidden = [...state.hidden, ...fresh(state.hidden)];
      if (library !== undefined) state.library = { ...library, counts: { ...library.counts, hidden: page.total } };
      return;
    }
    if (library === undefined) return;
    state.library = {
      ...library,
      games: [...library.games, ...fresh(library.games)],
      counts: { ...library.counts, [list]: page.total },
    };
  };

  const receiveLibraryChanged = async (payload: LibraryChangedPayload): Promise<void> => {
    if (!onlineReady()) return;
    const { groupHash, gameNumber } = payload;
    if (payload.change === 'deleted') {
      if (onScreen(groupHash, gameNumber)) clearDeletedGame();
      state.hidden = state.hidden.filter((row) => row.groupHash !== groupHash || row.gameNumber !== gameNumber);
    } else if (onScreen(groupHash, gameNumber) && !state.submitting) {
      await getGame(groupHash, gameNumber);
    }
    await refreshLibrary();
  };

  return {
    boot,
    setInviteName: (name) => {
      state.inviteName = name;
    },
    inviteNameValid: () => normalizeGameName(state.inviteName).ok,
    exportGame,
    deleteGame,
    hideGame,
    renameGame,
    loadMoreGames,
    hiddenGames: () => state.hidden,
    gameDeleted: () => state.deleted,
    receiveLibraryChanged,
    selectMode: (mode) => {
      state.mode = mode;
    },
    setSeatPlan: (seats) => {
      state.seatPlan = seats;
    },
    createInvite,
    startLocalMatch: () => {
      state.localStarted = true;
    },
    startOnlineMatch,
    acceptInvite,
    submitMoves,
    submitPending,
    refreshLibrary,
    refreshLobby,
    openMyGame,
    signOut,
    deliverGoogleCredential,
    receiveStateChanged,
    becomeVisible,
    poll,
    heartbeat,
    noteDisplayed: (version) => {
      state.displayed = version;
      // App only reports a version once the batch producing it has finished.
      state.inFlight = undefined;
      state.replayProgressAt = now();
    },
    pendingReplays: () => [...state.replays],
    takeReplay: () => {
      const next = state.replays.shift();
      if (next !== undefined) {
        state.inFlight = next;
        state.replayProgressAt = now();
      }
      return next;
    },
    takeHealOutcome: () => {
      const outcome = state.healOutcome;
      state.healOutcome = undefined;
      return outcome;
    },
    onlineModeOffered: () => onlineReady(),
    seatKindOptions: () =>
      state.mode === 'online' && onlineReady() ? ONLINE_SEAT_KINDS : LOCAL_SEAT_KINDS,
    seatKindOptionsFor: (seatIndex) => {
      const kinds = state.mode === 'online' && onlineReady() ? ONLINE_SEAT_KINDS : LOCAL_SEAT_KINDS;
      if (state.mode === 'online' && seatIndex === 0) return kinds.filter((kind) => kind !== 'agent');
      return kinds;
    },
    createOffered: () =>
      state.mode === 'online' &&
      onlineReady() &&
      onlinePlanCreatable(state.seatPlan) &&
      normalizeGameName(state.inviteName).ok,
    localMatchStarted: () => state.localStarted,
    copiedInviteUrl: () => state.copiedUrl,
    board: () => state.board,
    lobbyFull: () => state.lobbyIsFull,
    inviteGoneReason: () => state.goneReason,
    inviteSeats: () => state.seats,
    inviteToken: () => state.inviteToken,
    myGames: () => state.library,
    userHash: () => state.userHash,
    sessionExpired: () => state.sessionExpired,
    createInviteNote: () => state.createNote,
    libraryFailed: () => state.libraryFailed,
  };
};
