/**
 * EARS invariants for docs/spec/online-web/online-web.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/online-api/test/moves-ws.invariants.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { endTurn, GOOGLE_ID_TOKEN_SESSION_KEY } from '@conquarrow/contracts';
import type { OnlinePagesEnv } from '@conquarrow/contracts';
import {
  ALICE,
  BOB,
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  ONE_HUMAN_TWO_HEURISTIC,
  OTHER_GROUP_HASH,
  PAGES_ORIGIN,
  PAGES_PATHNAME,
  THREE_HEURISTIC,
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
  fullHumanSeats,
  gameHash,
  getGameScript,
  ifMatchOf,
  inviteHash,
  makePagesHarness,
  myGamesScript,
  openingBoard,
  peekInviteScript,
  postMoveScript,
  quotedVersion,
  startGameScript,
} from './online-web.support';

describe('online-web invariants', () => {
  it('When Local mode Starts, the adapter shall not fetch VITE_API_BASE and shall not open a WebSocket', async () => {
    const plans = [ONE_HUMAN_TWO_HEURISTIC, THREE_HEURISTIC] as const;
    for (const seats of plans) {
      const h = makePagesHarness();
      await h.adapter.boot();
      h.adapter.selectMode('local');
      h.adapter.setSeatPlan(seats);
      h.adapter.startLocalMatch();
      expect(h.adapter.localMatchStarted(), seats.join(',')).toBe(true);
      expect(apiCalled(h), seats.join(',')).toBe(false);
      expect(h.sockets, seats.join(',')).toHaveLength(0);
    }
  });

  it('When any of VITE_API_BASE, VITE_WS_URL, or VITE_GOOGLE_CLIENT_ID is empty, the adapter shall not offer Online mode', async () => {
    const empties: readonly (keyof OnlinePagesEnv)[] = [
      'VITE_API_BASE',
      'VITE_WS_URL',
      'VITE_GOOGLE_CLIENT_ID',
    ];
    for (const key of empties) {
      const h = makePagesHarness({ env: { [key]: '' } });
      await h.adapter.boot();
      expect(h.adapter.onlineModeOffered(), key).toBe(false);
      expect(apiCalled(h), key).toBe(false);
    }
  });

  it('When Online mode is selected, the adapter shall not offer a BYOK seat', async () => {
    const h = makePagesHarness({ sessionToken: ALICE.bearer });
    await h.adapter.boot();
    h.adapter.selectMode('online');
    expect(h.adapter.seatKindOptions()).toEqual(['human', 'heuristic']);
    expect(h.adapter.seatKindOptions().includes('byok')).toBe(false);
  });

  it('When Online create is offered, the seat plan shall contain at least two human seats', async () => {
    const h = makePagesHarness({ sessionToken: ALICE.bearer });
    await h.adapter.boot();
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(ONE_HUMAN_TWO_HEURISTIC);
    expect(h.adapter.createOffered()).toBe(false);
    expect(apiCalls(h, 'POST', '/invites')).toHaveLength(0);

    const ready = makePagesHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [createInviteScript(INVITE_TOKEN)],
    });
    await ready.adapter.boot();
    ready.adapter.selectMode('online');
    ready.adapter.setSeatPlan(TWO_HUMAN_HEURISTIC);
    expect(ready.adapter.createOffered()).toBe(true);
  });

  it('When the player is signed in, the adapter shall keep the ID token only in sessionStorage under conquarrow:google-id-token and shall open one WebSocket with that token as access_token', async () => {
    const h = makePagesHarness();
    await h.adapter.boot();
    await h.adapter.deliverGoogleCredential(ALICE.bearer);

    expect(h.session.getItem(GOOGLE_ID_TOKEN_SESSION_KEY)).toBe(ALICE.bearer);
    expect(h.session.keys()).toEqual([GOOGLE_ID_TOKEN_SESSION_KEY]);
    expect(h.sockets).toHaveLength(1);
    const socket = h.sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;
    expect(accessTokenOf(socket.url)).toBe(ALICE.bearer);
  });

  it('When the player signs out, the adapter shall remove that session key, close the WebSocket, and clear invite seats, copied invite URL, board, /my-games, and userHash', async () => {
    const h = makePagesHarness({
      fetchScript: [createInviteScript(INVITE_TOKEN), myGamesScript([])],
    });
    await h.adapter.boot();
    await h.adapter.deliverGoogleCredential(ALICE.bearer);
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(TWO_HUMAN_HEURISTIC);
    await h.adapter.createInvite();
    await h.adapter.refreshLibrary();
    h.adapter.signOut();

    expect(h.session.getItem(GOOGLE_ID_TOKEN_SESSION_KEY)).toBeNull();
    expect(h.session.keys()).toEqual([]);
    const socket = h.sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;
    expect(socket.closed).toBe(true);
    expect(h.adapter.inviteSeats()).toBeUndefined();
    expect(h.adapter.copiedInviteUrl()).toBeUndefined();
    expect(h.adapter.board()).toBeUndefined();
    expect(h.adapter.myGames()).toBeUndefined();
  });

  it('When the hash is #/invite/<token> and the player has no session token, the adapter shall peek the invite and prompt GIS before accept', async () => {
    const h = makePagesHarness({
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [
        peekInviteScript(INVITE_TOKEN, aliceHostSeats()),
        acceptInviteScript(INVITE_TOKEN, aliceBobSeats()),
      ],
    });
    await h.adapter.boot();

    expect(apiCalls(h, 'GET', `/invites/${INVITE_TOKEN}`)).toHaveLength(1);
    expect(h.gis.prompted).toBe(true);
    expect(apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(0);

    await h.adapter.deliverGoogleCredential(BOB.bearer);

    const accepts = apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`);
    expect(accepts).toHaveLength(1);
    const posted = accepts[0];
    expect(posted).toBeDefined();
    if (posted === undefined) return;
    expect(bearerOf(posted)).toBe(BOB.bearer);
  });

  it('When accept returns 409, the adapter shall show the lobby as full and shall not open a game board', async () => {
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [
        peekInviteScript(INVITE_TOKEN, fullHumanSeats()),
        acceptInviteScript(INVITE_TOKEN, fullHumanSeats(), 409, { error: 'conflict' }),
      ],
    });
    await h.adapter.boot();
    await h.adapter.acceptInvite();

    expect(h.adapter.lobbyFull()).toBe(true);
    expect(h.location.hash.startsWith('#/g/')).toBe(false);
    expect(h.adapter.board()).toBeUndefined();
  });

  it('When Start succeeds, the adapter shall set the hash to #/g/<groupHash>/<gameNumber> and GET that game', async () => {
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
    await h.adapter.startOnlineMatch();

    expect(h.location.hash).toBe(gameHash(GROUP_HASH, GAME_ONE));
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
    expect(h.adapter.board()?.version).toBe(0);
  });

  it('When an online move is submitted, the adapter shall POST with If-Match equal to the last GET version, then GET, and shall set the board from that GET — not from a local apply', async () => {
    const after = boardAt(1, { activePlayer: 'B', tag: 'server-get-not-local-apply' });
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
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
    expect(h.adapter.board()).toEqual(after);
  });

  it('When POST moves returns 412, the adapter shall GET, drop the in-flight move, and shall not POST that move again', async () => {
    const refreshed = boardAt(1, { tag: 'after-412' });
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(openingBoard()),
        postMoveScript(412, { error: 'precondition_failed' }),
        getGameScript(refreshed),
      ],
    });
    await h.adapter.boot();
    await h.adapter.submitMove(endTurn());

    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
    expect(apiCalls(h, 'POST', `/games/${GROUP_HASH}/${GAME_ONE}/moves`)).toHaveLength(1);
    expect(h.adapter.board()).toEqual(refreshed);
  });

  it('When POST moves returns 422, the adapter shall keep the last GET board and shall not persist a local apply', async () => {
    const opening = openingBoard('keep-S');
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(opening),
        postMoveScript(422, { error: 'unprocessable' }),
      ],
    });
    await h.adapter.boot();
    await h.adapter.submitMove(endTurn());

    expect(h.adapter.board()).toEqual(opening);
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
  });

  it("When the open game's state.winner is set, the adapter shall not POST moves", async () => {
    const terminal = boardAt(4, { winner: 'A', tag: 'winner-set' });
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

  it('When stateChanged names the open game, the adapter shall GET that game. When it names another game, the adapter shall not replace the open board', async () => {
    const open = openingBoard('open-game');
    const woken = boardAt(1, { tag: 'open-woken' });
    const matching = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(open), getGameScript(woken)],
    });
    await matching.adapter.boot();
    await matching.adapter.receiveStateChanged({
      type: 'stateChanged',
      version: 1,
      groupHash: GROUP_HASH,
      gameNumber: GAME_ONE,
    });
    expect(matching.adapter.board()).toEqual(woken);
    expect(apiCalls(matching, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);

    const other = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(open), myGamesScript([])],
    });
    await other.adapter.boot();
    await other.adapter.receiveStateChanged({
      type: 'stateChanged',
      version: 3,
      groupHash: OTHER_GROUP_HASH,
      gameNumber: GAME_ONE,
    });
    expect(other.adapter.board()).toEqual(open);
    expect(apiCalls(other, 'GET', `/games/${OTHER_GROUP_HASH}/${GAME_ONE}`)).toHaveLength(0);
  });

  it('When visibilitychange becomes visible and a game is open, the adapter shall GET that game', async () => {
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(openingBoard()), getGameScript(openingBoard())],
    });
    await h.adapter.boot();
    await h.adapter.becomeVisible();
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
  });

  it('The adapter shall not include Google sub in copied invite URLs (token only)', async () => {
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [createInviteScript(INVITE_TOKEN)],
    });
    await h.adapter.boot();
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(TWO_HUMAN_HEURISTIC);
    await h.adapter.createInvite();

    const copied = h.adapter.copiedInviteUrl();
    expect(copied).toBe(`${PAGES_ORIGIN}${PAGES_PATHNAME}#/invite/${INVITE_TOKEN}`);
    expect(copied).not.toContain(ALICE.sub);
    expect(copied).not.toContain(BOB.sub);
  });

  it("Library resume shall open #/g/<groupHash>/<gameNumber> and GET, shall clear invite seats from a previous lobby in this adapter, and the listed rows are that user's /my-games only", async () => {
    const own = { groupHash: GROUP_HASH, gameNumber: GAME_ONE, status: 'waiting' as const };
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [
        createInviteScript(INVITE_TOKEN),
        myGamesScript([own]),
        getGameScript(openingBoard()),
      ],
    });
    await h.adapter.boot();
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(TWO_HUMAN_HEURISTIC);
    await h.adapter.createInvite();
    await h.adapter.refreshLibrary();

    expect(h.adapter.myGames()).toEqual({ lobbies: [], games: [own] });
    expect(h.adapter.myGames()?.games.some((row) => row.groupHash === OTHER_GROUP_HASH)).toBe(
      false,
    );
    expect(h.adapter.inviteSeats()).toBeDefined();

    await h.adapter.openMyGame(own.groupHash, own.gameNumber);
    expect(h.location.hash).toBe(gameHash(GROUP_HASH, GAME_ONE));
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
    expect(h.adapter.inviteSeats()).toBeUndefined();
  });
});
