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
  UserHash,
} from '@conquarrow/contracts';
import { DELETE_GAME_CONFIRM, FINISHED_PAGE, normalizeGameName } from '@conquarrow/contracts';
import { isOnlineEnvReady } from './online-env';
import { copiedInviteUrl, formatGameHash, parsePagesHash } from './online-hash';
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
import { logPath, parseLogWindow, planFromWake } from './online-replay';
import {
  clearSessionToken,
  readSessionToken,
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
  /** P94 D4: a `submitMoves` call has not settled yet. */
  submitting: boolean;
  /** P95 D10: the unsent rest of a submit a 401 stopped. */
  held: HeldSubmit | undefined;
  /** P95 D12: the token a refresh was already asked for, so it is asked once. */
  promptedFor: string | undefined;
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
  submitting: false,
  held: undefined,
  promptedFor: undefined,
  inviteName: '',
  hidden: [],
  deleted: false,
});

const humanCount = (plan: readonly PlannedSeatKind[]): number =>
  plan.filter((kind) => kind === 'human').length;

const agentCount = (plan: readonly PlannedSeatKind[]): number =>
  plan.filter((kind) => kind === 'agent').length;

const onlinePlanCreatable = (plan: readonly PlannedSeatKind[]): boolean => {
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
  const state = emptyState();

  const onlineReady = (): boolean => isOnlineEnvReady(env);

  const token = (): string | undefined => readSessionToken(session);

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
    state.library = undefined;
    state.held = undefined;
    state.promptedFor = undefined;
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

  const request = (
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
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      return fetchHttp({ ...req, headers, body: JSON.stringify(options.body) });
    }
    return fetchHttp(req);
  };

  const onUnauthorized = (status: number): boolean => {
    if (status !== 401) return false;
    gis.prompt();
    return true;
  };

  const loadMe = async (): Promise<void> => {
    if (!onlineReady() || token() === undefined) return;
    const res = await request('GET', '/me');
    if (onUnauthorized(res.status)) return;
    if (res.status !== 200) return;
    const hash = parseUserHash(asRecord(parseJson(res.body))?.['userHash']);
    if (hash !== undefined) state.userHash = hash;
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
    if (!onlineReady()) return;
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

  const createInvite = async (): Promise<void> => {
    if (!onlineReady() || state.mode !== 'online' || !onlinePlanCreatable(state.seatPlan)) {
      return;
    }
    const named = normalizeGameName(state.inviteName);
    if (!named.ok) return;
    const body = named.name === undefined ? { seats: state.seatPlan } : { seats: state.seatPlan, name: named.name };
    const res = await request('POST', '/invites', { body });
    if (onUnauthorized(res.status)) return;
    if (res.status !== 201 && res.status !== 200) return;
    applyInviteBody(parseJson(res.body));
    const inviteToken = state.inviteToken;
    if (inviteToken === undefined) return;
    state.copiedUrl = copiedInviteUrl(location.origin, location.pathname, inviteToken);
  };

  const startOnlineMatch = async (): Promise<void> => {
    if (!onlineReady()) return;
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

  const refreshLibrary = async (): Promise<void> => {
    if (!onlineReady() || token() === undefined) return;
    const res = await request('GET', '/my-games');
    if (onUnauthorized(res.status)) return;
    if (res.status !== 200) return;
    const library = parseMyGames(parseJson(res.body));
    if (library !== undefined) state.library = library;
  };

  const refreshLobby = async (): Promise<void> => {
    if (!onlineReady()) return;
    if (state.inviteToken !== undefined && state.board === undefined) {
      await peekHeldInvite({ promptIfUnsigned: false, followStarted: true });
    }
    if (token() !== undefined) await refreshLibrary();
  };

  const openMyGame = async (groupHash: GroupHash, gameNumber: GameNumber): Promise<void> => {
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
    if (plan.kind === 'replay') state.replays.push(plan.batch);
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

  /** P94 D4: the guards under which a submit sends nothing. */
  const submitBlocked = (moves: readonly Move[]): boolean =>
    !onlineReady() ||
    moves.length === 0 ||
    submitPending() ||
    // P49 D7: the board is showing a superseded position while a batch plays.
    replayInFlight() ||
    !callerIsToMove(state);

  const submitMoves = async (moves: readonly Move[]): Promise<SubmitOutcome> => {
    const route = parsePagesHash(location.hash);
    const board = state.board;
    if (route.kind !== 'game' || board === undefined || submitBlocked(moves)) return 'refused';
    if (winnerOf(board.state) !== undefined) return 'refused';
    state.submitting = true;
    try {
      const ids = moves.map(() => newId());
      return await sendAndHold(route.groupHash, route.gameNumber, moves, ids, board.version);
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

  const deliverGoogleCredential = async (idToken: string): Promise<void> => {
    writeSessionToken(session, idToken);
    if (!onlineReady()) return;
    openSessionSocket();
    await loadMe();
    await sendHeld();
    const route = parsePagesHash(location.hash);
    if (route.kind === 'invite' && !state.inviteGone) {
      await acceptInvite();
      return;
    }
    if (route.kind === 'game') {
      await getGame(route.groupHash, route.gameNumber);
      return;
    }
    // A sign-in on the lobby lists My games straight away (P95 D12).
    await refreshLibrary();
  };

  const signOut = (): void => {
    closeSocket();
    clearSessionToken(session);
    clearIdentityScope();
    location.hash = '';
  };

  /** P96 D12: the server's export of the game on screen, as its text. */
  const exportGame = async (): Promise<string | undefined> => {
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
    },
    pendingReplays: () => [...state.replays],
    takeReplay: () => {
      const next = state.replays.shift();
      if (next !== undefined) state.inFlight = next;
      return next;
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
  };
};
