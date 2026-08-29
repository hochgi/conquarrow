/**
 * Pages online adapter — GIS session, hash routes, REST, and WS wake-up.
 * Tests inject fake GIS, fetch, WebSocket, and sessionStorage.
 *
 * @see docs/spec/online-web/online-web.md
 */

import type {
  GameNumber,
  GroupHash,
  InviteSeat,
  InviteToken,
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
  StateChangedPayload,
  UserHash,
} from '@conquarrow/contracts';
import { isOnlineEnvReady } from './online-env';
import { copiedInviteUrl, formatGameHash, parsePagesHash } from './online-hash';
import {
  asRecord,
  parseBoard,
  parseGoneReason,
  parseInviteToken,
  parseJson,
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
import { clearSessionToken, readSessionToken, writeSessionToken } from './online-session';

const LOCAL_SEAT_KINDS: readonly PlannedSeatKind[] = ['human', 'heuristic', 'byok'];
const ONLINE_SEAT_KINDS: readonly PlannedSeatKind[] = ['human', 'heuristic'];

interface AdapterState {
  mode: PagesLobbyMode;
  seatPlan: readonly PlannedSeatKind[];
  localStarted: boolean;
  copiedUrl: string | undefined;
  board: OnlineGameBoard | undefined;
  lobbyIsFull: boolean;
  /** HTTP 410 on peek/accept — blocks another POST even when `reason` is absent. */
  inviteGone: boolean;
  goneReason: 'revoked' | 'started' | undefined;
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
});

const humanCount = (plan: readonly PlannedSeatKind[]): number =>
  plan.filter((kind) => kind === 'human').length;

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
    clearInviteScope();
  };

  const openSessionSocket = (): void => {
    closeSocket();
    const access = token();
    if (!onlineReady() || access === undefined) return;
    state.socket = openSocket(
      `${env.VITE_WS_URL}?access_token=${encodeURIComponent(access)}`,
    );
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
    if (res.status !== 200) return;
    const board = parseBoard(parseJson(res.body));
    if (board === undefined) return;
    state.board = board;
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
    if (!onlineReady() || state.mode !== 'online' || humanCount(state.seatPlan) < 2) {
      return;
    }
    const res = await request('POST', '/invites', { body: { seats: state.seatPlan } });
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
    location.hash = formatGameHash(groupHash, gameNumber);
    await getGame(groupHash, gameNumber);
  };

  const submitMove = async (move: Move): Promise<void> => {
    if (!onlineReady()) return;
    // D7: the board is showing a superseded position while a batch plays, so a
    // commit against it would be a move chosen from the past. In flight covers
    // the batch App is *playing*, which has already left the queue.
    if (replayInFlight()) return;
    const route = parsePagesHash(location.hash);
    if (route.kind !== 'game' || state.board === undefined) return;
    if (winnerOf(state.board.state) !== undefined) return;
    if (!callerIsToMove(state)) return;
    const path = `/games/${route.groupHash}/${route.gameNumber}/moves`;
    const res = await request('POST', path, {
      body: { move },
      headers: { 'If-Match': quotedVersion(state.board.version) },
    });
    if (onUnauthorized(res.status)) return;
    if (res.status === 422) return;
    if (res.status === 200 || res.status === 412 || res.status === 409) {
      await getGame(route.groupHash, route.gameNumber);
    }
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

  const receiveStateChanged = async (payload: StateChangedPayload): Promise<void> => {
    if (!onlineReady()) return;
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

  const becomeVisible = async (): Promise<void> => {
    if (!onlineReady()) return;
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
    const route = parsePagesHash(location.hash);
    if (route.kind === 'invite' && !state.inviteGone) {
      await acceptInvite();
      return;
    }
    if (route.kind === 'game') await getGame(route.groupHash, route.gameNumber);
  };

  const signOut = (): void => {
    closeSocket();
    clearSessionToken(session);
    clearIdentityScope();
    location.hash = '';
  };

  return {
    boot,
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
    submitMove,
    refreshLibrary,
    refreshLobby,
    openMyGame,
    signOut,
    deliverGoogleCredential,
    receiveStateChanged,
    becomeVisible,
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
    createOffered: () =>
      state.mode === 'online' && onlineReady() && humanCount(state.seatPlan) >= 2,
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
