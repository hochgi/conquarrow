/**
 * docs/spec/online-web/online-web.core.feature — one test per scenario.
 *
 * @see docs/spec/online-web/online-web.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, GOOGLE_ID_TOKEN_SESSION_KEY } from '@conquarrow/contracts';
import {
  ALICE,
  BOB,
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  ONE_HUMAN_TWO_HEURISTIC,
  PAGES_ORIGIN,
  PAGES_PATHNAME,
  TWO_HUMAN_HEURISTIC,
  acceptInviteScript,
  accessTokenOf,
  aliceBobSeats,
  aliceHostSeats,
  apiCalled,
  apiCalls,
  bearerOf,
  boardAt,
  createInviteScript,
  gameHash,
  getGameScript,
  humanBoundCount,
  ifMatchOf,
  inviteHash,
  makePagesHarness,
  openingBoard,
  parseJson,
  peekInviteScript,
  postMoveScript,
  quotedVersion,
  startGameScript,
  myGamesScript,
} from './online-web.support';

describe('Invite link', () => {
  it('Signed-out invite link Sign-In then accept', async () => {
    const h = makePagesHarness({
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [
        peekInviteScript(INVITE_TOKEN, aliceHostSeats()),
        acceptInviteScript(INVITE_TOKEN, aliceBobSeats()),
      ],
    });

    await h.adapter.boot();
    await h.adapter.deliverGoogleCredential(BOB.bearer);

    const accepts = apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`);
    expect(accepts).toHaveLength(1);
    const accepted = accepts[0];
    expect(accepted).toBeDefined();
    if (accepted === undefined) return;
    expect(bearerOf(accepted)).toBe(BOB.bearer);
    expect(humanBoundCount(h.adapter.inviteSeats())).toBe(2);
    expect(h.session.getItem(GOOGLE_ID_TOKEN_SESSION_KEY)).toBe(BOB.bearer);
  });
});

describe('Lobby', () => {
  it('Online lobby copies an invite hash link', async () => {
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [createInviteScript(INVITE_TOKEN)],
    });
    await h.adapter.boot();
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(TWO_HUMAN_HEURISTIC);

    await h.adapter.createInvite();

    const copied = h.adapter.copiedInviteUrl();
    expect(copied).toBeDefined();
    expect(copied?.endsWith(`#/invite/${INVITE_TOKEN}`)).toBe(true);
    expect(copied).toBe(`${PAGES_ORIGIN}${PAGES_PATHNAME}#/invite/${INVITE_TOKEN}`);
    expect(copied).not.toContain(ALICE.sub);
  });

  it('Online Start opens the game hash', async () => {
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [
        peekInviteScript(INVITE_TOKEN, aliceBobSeats()),
        startGameScript(INVITE_TOKEN),
        getGameScript(openingBoard()),
      ],
    });
    await h.adapter.boot();
    h.adapter.selectMode('online');

    await h.adapter.startOnlineMatch();

    expect(h.location.hash).toBe(gameHash(GROUP_HASH, GAME_ONE));
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
    expect(h.adapter.board()?.version).toBe(0);
  });
});

describe('Local stays local', () => {
  it('Local 1-human plus AI never calls the API', async () => {
    const h = makePagesHarness();
    await h.adapter.boot();
    h.adapter.selectMode('local');
    h.adapter.setSeatPlan(ONE_HUMAN_TWO_HEURISTIC);

    h.adapter.startLocalMatch();

    expect(h.adapter.localMatchStarted()).toBe(true);
    expect(apiCalled(h)).toBe(false);
    expect(h.sockets).toHaveLength(0);
  });
});

describe('Play', () => {
  it('Human move POSTs then GETs server state', async () => {
    const after = boardAt(1, { activePlayer: 'B', tag: 'after-endTurn-get' });
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(openingBoard()),
        postMoveScript(200, { version: 1, groupHash: GROUP_HASH, gameNumber: GAME_ONE }),
        getGameScript(after),
      ],
    });
    await h.adapter.boot();

    await h.adapter.submitMove(endTurn());

    const posts = apiCalls(h, 'POST', `/games/${GROUP_HASH}/${GAME_ONE}/moves`);
    expect(posts).toHaveLength(1);
    const posted = posts[0];
    expect(posted).toBeDefined();
    if (posted === undefined) return;
    expect(ifMatchOf(posted)).toBe(quotedVersion(0));
    expect(parseJson(posted.body)).toEqual({ move: endTurn() });
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
    expect(h.adapter.board()).toEqual(after);
    expect(h.adapter.board()).not.toEqual(openingBoard());
  });

  it('WS wake-up GETs the open game', async () => {
    const woken = boardAt(1, { activePlayer: 'B', tag: 'ws-get' });
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(openingBoard()), getGameScript(woken)],
    });
    await h.adapter.boot();

    await h.adapter.receiveStateChanged({
      type: 'stateChanged',
      version: 1,
      groupHash: GROUP_HASH,
      gameNumber: GAME_ONE,
    });

    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
    expect(h.adapter.board()?.version).toBe(1);
    expect(h.adapter.board()).toEqual(woken);
  });
});

describe('Library', () => {
  it('My-games resume opens the stored game hash', async () => {
    const listed = { groupHash: 'G', gameNumber: GAME_ONE, status: 'waiting' as const };
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [
        createInviteScript(INVITE_TOKEN),
        myGamesScript([listed]),
        getGameScript(openingBoard(), listed.groupHash, listed.gameNumber),
      ],
    });
    await h.adapter.boot();
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(TWO_HUMAN_HEURISTIC);
    await h.adapter.createInvite();
    await h.adapter.refreshLibrary();
    expect(h.adapter.inviteSeats()).toBeDefined();

    await h.adapter.openMyGame(listed.groupHash, listed.gameNumber);

    expect(h.location.hash).toBe(gameHash('G', GAME_ONE));
    expect(apiCalls(h, 'GET', `/games/G/${GAME_ONE}`)).toHaveLength(1);
    expect(h.adapter.inviteSeats()).toBeUndefined();
    expect(h.adapter.inviteToken()).toBeUndefined();
  });

  it('Finished game is view-only', async () => {
    const terminal = boardAt(0, { winner: 'A', tag: 'terminal' });
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(terminal)],
    });
    await h.adapter.boot();

    expect(h.adapter.board()).toEqual(terminal);

    await h.adapter.submitMove(endTurn());

    expect(apiCalls(h, 'POST', `/games/${GROUP_HASH}/${GAME_ONE}/moves`)).toHaveLength(0);
  });
});

describe('Session socket', () => {
  it('Sign-In opens a WebSocket and Sign-out closes it', async () => {
    const h = makePagesHarness({
      fetchScript: [createInviteScript(INVITE_TOKEN), myGamesScript([])],
    });
    await h.adapter.boot();

    await h.adapter.deliverGoogleCredential(ALICE.bearer);
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(TWO_HUMAN_HEURISTIC);
    await h.adapter.createInvite();
    await h.adapter.refreshLibrary();

    expect(h.sockets).toHaveLength(1);
    const socket = h.sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;
    expect(accessTokenOf(socket.url)).toBe(ALICE.bearer);
    expect(socket.url.startsWith(`${h.env.VITE_WS_URL}?`)).toBe(true);
    expect(h.adapter.inviteSeats()).toBeDefined();
    expect(h.adapter.myGames()).toEqual({ lobbies: [], games: [] });

    h.adapter.signOut();

    expect(socket.closed).toBe(true);
    expect(h.session.getItem(GOOGLE_ID_TOKEN_SESSION_KEY)).toBeNull();
    expect(h.adapter.inviteSeats()).toBeUndefined();
    expect(h.adapter.copiedInviteUrl()).toBeUndefined();
    expect(h.adapter.board()).toBeUndefined();
    expect(h.adapter.myGames()).toBeUndefined();
    expect(h.location.hash).toBe('');
  });
});
