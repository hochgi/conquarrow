/**
 * Pages online host — GIS / hash / visibility / WS binder around createOnlinePages.
 *
 * HTTP 410 on invite is gone even when `reason` is missing. POST 422 surfaces
 * `illegal` here; the adapter keeps the last GET.
 *
 * @see docs/spec/online-shell/online-shell.md
 */

import type {
  InviteSeat,
  Move,
  OnlineHostDeps,
  OnlineHostPort,
  OnlinePagesFetch,
  OnlinePagesHttpRequest,
  OnlinePagesHttpResponse,
  PagesLobbyMode,
  PlannedSeatKind,
} from '@conquarrow/contracts';
import { parsePagesHash } from './online-hash';
import { createOnlinePages, occupiesHumanChair } from './online-pages';
import { parseLibraryChanged, parseStateChanged } from './online-parse';
import { readUsableSessionToken } from './online-session';
import { submitNote } from './online-submit';

/**
 * P106: Start is offered on the server's rule — every human and every agent
 * chair is bound (a reserved `Agent (yours)` chair waits for its agent).
 * A heuristic chair carries no `userHash`, so it is skipped by kind.
 */
const bindableChairsAllBound = (seats: readonly InviteSeat[] | undefined): boolean => {
  if (seats === undefined) return false;
  return seats.every((seat) => seat.kind === 'heuristic' || seat.userHash !== undefined);
};

const requestPath = (url: string): string => {
  const stripped = url.split('?')[0] ?? url;
  try {
    return new URL(stripped).pathname;
  } catch {
    return stripped;
  }
};

const isInvitePeek = (method: string, path: string): boolean =>
  method === 'GET' && /\/invites\/[^/]+$/.test(path);

const isInviteAccept = (method: string, path: string): boolean =>
  method === 'POST' && /\/invites\/[^/]+\/accept$/.test(path);

const isInviteCreate = (method: string, path: string): boolean =>
  method === 'POST' && /\/invites$/.test(path);

const isPostMoves = (method: string, path: string): boolean =>
  method === 'POST' && path.endsWith('/moves');

/** P94: the snapshot and log reads a submit's reconcile makes. */
const isGameRead = (method: string, path: string): boolean =>
  method === 'GET' && /\/games\/[^/]+\/[^/]+(\/log)?$/.test(path);

const is2xx = (status: number): boolean => status >= 200 && status < 300;

export const createOnlineHost = (deps: OnlineHostDeps): OnlineHostPort => {
  let mode: PagesLobbyMode = 'local';
  let illegalMsg: string | undefined;
  let inviteGoneFlag = false;
  let createPending = false;

  const noteResponse = (req: OnlinePagesHttpRequest, res: OnlinePagesHttpResponse): void => {
    const path = requestPath(req.url);
    if ((isInvitePeek(req.method, path) || isInviteAccept(req.method, path)) && res.status === 410) {
      inviteGoneFlag = true;
    }
    if (isInvitePeek(req.method, path) && res.status === 200) inviteGoneFlag = false;
    if (isInviteAccept(req.method, path) && res.status === 200) inviteGoneFlag = false;
    if (isInviteCreate(req.method, path) && is2xx(res.status)) inviteGoneFlag = false;
    if (isPostMoves(req.method, path) && res.status === 422) {
      // P100 D2: the same sentence `submitNote` gives the outcome.
      illegalMsg = submitNote('illegal');
      return;
    }
    // P94: a 422 stays up through the reconcile reads that follow it.
    if (is2xx(res.status) && !isGameRead(req.method, path)) illegalMsg = undefined;
  };

  const fetch: OnlinePagesFetch = async (req) => {
    const res = await deps.fetch(req);
    noteResponse(req, res);
    return res;
  };

  const pages = createOnlinePages({ ...deps, fetch });
  const now = deps.now ?? Date.now;

  const signedIn = (): boolean => readUsableSessionToken(deps.session, now) !== undefined;

  const syncModeFromHash = (): void => {
    if (!pages.onlineModeOffered()) return;
    const route = parsePagesHash(deps.location.hash);
    if (route.kind === 'invite' || route.kind === 'game') {
      mode = 'online';
      pages.selectMode('online');
    }
  };

  const boot = async (): Promise<void> => {
    await pages.boot();
    syncModeFromHash();
  };

  const startOffered = (): boolean => {
    if (mode === 'online' && pages.onlineModeOffered()) {
      return bindableChairsAllBound(pages.inviteSeats());
    }
    return true;
  };

  const start = async (): Promise<void> => {
    if (mode === 'online' && pages.onlineModeOffered()) {
      if (startOffered()) await pages.startOnlineMatch();
      return;
    }
    pages.startLocalMatch();
  };

  const signOut = (): void => {
    pages.signOut();
    illegalMsg = undefined;
    inviteGoneFlag = false;
    mode = 'local';
    pages.selectMode('local');
  };

  const acceptOffered = (): boolean =>
    mode === 'online' &&
    pages.onlineModeOffered() &&
    signedIn() &&
    pages.inviteToken() !== undefined &&
    !inviteGoneFlag &&
    pages.inviteGoneReason() === undefined &&
    !pages.lobbyFull() &&
    !occupiesHumanChair(pages.inviteSeats(), pages.userHash());

  const seatEditsOffered = (): boolean =>
    pages.inviteToken() === undefined ||
    inviteGoneFlag ||
    pages.inviteGoneReason() !== undefined;

  const createInvite = async (): Promise<void> => {
    if (createPending) return;
    createPending = true;
    try {
      await pages.createInvite();
    } catch {
      // P98 D4: the host promise resolves, including a fetch the pages adapter caught.
    } finally {
      createPending = false;
    }
  };

  return {
    adapter: () => pages,
    boot,
    selectMode: (next: PagesLobbyMode) => {
      mode = next;
      pages.selectMode(next);
    },
    setSeatPlan: (seats: readonly PlannedSeatKind[]) => {
      pages.setSeatPlan(seats);
    },
    start,
    createInvite,
    acceptInvite: () => pages.acceptInvite(),
    submitMoves: (moves: readonly Move[]) => pages.submitMoves(moves),
    submitPending: () => pages.submitPending(),
    refreshLibrary: () => pages.refreshLibrary(),
    refreshLobby: () => pages.refreshLobby(),
    openMyGame: (groupHash, gameNumber) => pages.openMyGame(groupHash, gameNumber),
    signOut,
    promptSignIn: () => {
      deps.gis.offerChooser();
    },
    handleHashChange: async () => {
      await pages.boot();
      syncModeFromHash();
    },
    handleVisibility: (visible: boolean) => {
      if (!visible) return Promise.resolve();
      return pages.becomeVisible();
    },
    handleSocketMessage: async (raw: string) => {
      const payload = parseStateChanged(raw);
      if (payload !== undefined) {
        await pages.receiveStateChanged(payload);
        return;
      }
      // P96 D12: a delete or rename of one of the caller's games.
      const changed = parseLibraryChanged(raw);
      if (changed !== undefined) await pages.receiveLibraryChanged(changed);
    },
    handleGisCredential: (idToken: string) => pages.deliverGoogleCredential(idToken),
    handlePoll: () => pages.poll(),
    handleHeartbeat: () => {
      pages.heartbeat();
    },
    onlineModeOffered: () => pages.onlineModeOffered(),
    startOffered,
    acceptOffered,
    seatEditsOffered,
    createOffered: () => pages.createOffered() && signedIn() && !createPending,
    signedIn,
    sessionExpired: () => pages.sessionExpired(),
    createInviteNote: () => pages.createInviteNote(),
    libraryFailed: () => pages.libraryFailed(),
    createInvitePending: () => createPending,
    mode: () => mode,
    illegal: () => illegalMsg,
    inviteGone: () => inviteGoneFlag || pages.inviteGoneReason() !== undefined,
    seatKindOptions: () => pages.seatKindOptions(),
    copiedInviteUrl: () => pages.copiedInviteUrl(),
    board: () => pages.board(),
    localMatchStarted: () => pages.localMatchStarted(),
  };
};
