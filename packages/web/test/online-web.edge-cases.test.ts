/**
 * docs/spec/online-web/online-web.edge-cases.feature — one test per scenario.
 *
 * @see docs/spec/online-web/online-web.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, GOOGLE_ID_TOKEN_SESSION_KEY } from '@conquarrow/contracts';
import {
  ALICE,
  CAROL,
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  ONE_HUMAN_TWO_HEURISTIC,
  OTHER_GROUP_HASH,
  THREE_HEURISTIC,
  TWO_HUMAN_HEURISTIC,
  acceptInviteScript,
  accessTokenOf,
  apiCalled,
  apiCalls,
  boardAt,
  fullHumanSeats,
  gameHash,
  getGameScript,
  goneInviteEmptyBodyScript,
  inviteHash,
  makePagesHarness,
  myGamesScript,
  openingBoard,
  peekInviteScript,
  postMoveScript,
  startGameScript,
  createInviteScript,
} from './online-web.support';

describe('Mode and env', () => {
  it('Missing env disables Online', async () => {
    const h = makePagesHarness({ env: { VITE_API_BASE: '' } });
    await h.adapter.boot();

    expect(h.adapter.onlineModeOffered()).toBe(false);
    expect(apiCalled(h)).toBe(false);
  });

  it('Online mode does not offer BYOK', async () => {
    const h = makePagesHarness({ sessionToken: ALICE.bearer });
    await h.adapter.boot();
    h.adapter.selectMode('online');

    expect(h.adapter.seatKindOptions()).toEqual(['human', 'heuristic']);
    expect(h.adapter.seatKindOptions()).not.toContain('byok');
  });

  it('Online create requires two human seats', async () => {
    const h = makePagesHarness({ sessionToken: ALICE.bearer });
    await h.adapter.boot();
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(ONE_HUMAN_TWO_HEURISTIC);

    expect(h.adapter.createOffered()).toBe(false);
    expect(apiCalls(h, 'POST', '/invites')).toHaveLength(0);
  });

  it('Local all-AI never calls the API', async () => {
    const h = makePagesHarness();
    await h.adapter.boot();
    h.adapter.selectMode('local');
    h.adapter.setSeatPlan(THREE_HEURISTIC);

    h.adapter.startLocalMatch();

    expect(h.adapter.localMatchStarted()).toBe(true);
    expect(apiCalled(h)).toBe(false);
  });
});

describe('Invite edges', () => {
  it('Full lobby shows game full', async () => {
    const h = makePagesHarness({
      sessionToken: CAROL.bearer,
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

  it('Dead invite is not accepted', async () => {
    const h = makePagesHarness({
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [
        {
          method: 'GET',
          path: `/invites/${INVITE_TOKEN}`,
          status: 410,
          body: { reason: 'started' },
        },
      ],
    });
    await h.adapter.boot();

    expect(apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(0);
    expect(h.adapter.inviteGoneReason()).toBe('started');
  });

  it('Dead invite with empty 410 body is not accepted', async () => {
    const h = makePagesHarness({
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [goneInviteEmptyBodyScript(INVITE_TOKEN)],
    });
    await h.adapter.boot();
    await h.adapter.deliverGoogleCredential(ALICE.bearer);

    expect(apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(0);
  });
});

describe('Move errors', () => {
  it('Stale If-Match refreshes and drops the move', async () => {
    const refreshed = boardAt(1, { activePlayer: 'B', tag: 'after-412-get' });
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

    expect(apiCalls(h, 'POST', `/games/${GROUP_HASH}/${GAME_ONE}/moves`)).toHaveLength(1);
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
    expect(h.adapter.board()).toEqual(refreshed);
  });

  it('Illegal move keeps the last GET', async () => {
    const opening = openingBoard('S');
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(opening),
        postMoveScript(422, { error: 'unprocessable' }),
      ],
    });
    await h.adapter.boot();
    expect(h.adapter.board()).toEqual(opening);

    await h.adapter.submitMove(endTurn());

    expect(h.adapter.board()).toEqual(opening);
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
  });

  it('POST after winner becomes view-only', async () => {
    const terminal = boardAt(1, { winner: 'B', tag: 'finished-get' });
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(openingBoard()),
        postMoveScript(409, { reason: 'finished' }),
        getGameScript(terminal),
      ],
    });
    await h.adapter.boot();

    await h.adapter.submitMove(endTurn());
    expect(h.adapter.board()).toEqual(terminal);

    await h.adapter.submitMove(endTurn());

    expect(apiCalls(h, 'POST', `/games/${GROUP_HASH}/${GAME_ONE}/moves`)).toHaveLength(1);
  });

  it('Not to move does not POST', async () => {
    const notAlice = boardAt(0, { activePlayer: 'B', tag: 'bobs-turn' });
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [
        createInviteScript(INVITE_TOKEN),
        startGameScript(INVITE_TOKEN),
        getGameScript(notAlice),
      ],
    });
    await h.adapter.boot();
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(TWO_HUMAN_HEURISTIC);
    await h.adapter.createInvite();
    await h.adapter.startOnlineMatch();

    await h.adapter.submitMove(endTurn());

    expect(h.adapter.board()).toEqual(notAlice);
    expect(apiCalls(h, 'POST', `/games/${GROUP_HASH}/${GAME_ONE}/moves`)).toHaveLength(0);
  });
});

describe('Library', () => {
  it("Library resume does not apply a previous lobby's seats", async () => {
    const otherTurn = boardAt(0, { activePlayer: 'B', tag: 'other-game-bobs-turn' });
    const listed = { groupHash: OTHER_GROUP_HASH, gameNumber: GAME_ONE, status: 'waiting' as const };
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [
        createInviteScript(INVITE_TOKEN),
        myGamesScript([listed]),
        getGameScript(otherTurn, listed.groupHash, listed.gameNumber),
        postMoveScript(200, { version: 1 }, listed.groupHash, listed.gameNumber),
        getGameScript(
          boardAt(1, { activePlayer: 'A', tag: 'other-after' }),
          listed.groupHash,
          listed.gameNumber,
        ),
      ],
    });
    await h.adapter.boot();
    h.adapter.selectMode('online');
    h.adapter.setSeatPlan(TWO_HUMAN_HEURISTIC);
    await h.adapter.createInvite();
    await h.adapter.refreshLibrary();
    expect(h.adapter.inviteSeats()).toBeDefined();

    await h.adapter.openMyGame(listed.groupHash, listed.gameNumber);
    await h.adapter.submitMove(endTurn());

    expect(h.adapter.inviteSeats()).toBeUndefined();
    expect(apiCalls(h, 'POST', `/games/${OTHER_GROUP_HASH}/${GAME_ONE}/moves`)).toHaveLength(1);
  });
});

describe('Auth and refresh', () => {
  it('401 keeps the hash and prompts Sign-In', async () => {
    const open = gameHash(GROUP_HASH, GAME_ONE);
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: open,
      fetchScript: [
        {
          method: 'GET',
          path: `/games/${GROUP_HASH}/${GAME_ONE}`,
          status: 401,
          body: { error: 'unauthorized' },
        },
      ],
    });
    await h.adapter.boot();

    expect(h.gis.prompted).toBe(true);
    expect(h.location.hash).toBe(open);
  });

  it('Refresh restores the session token', async () => {
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(openingBoard())],
    });

    await h.adapter.boot();

    expect(h.session.getItem(GOOGLE_ID_TOKEN_SESSION_KEY)).toBe(ALICE.bearer);
    expect(h.sockets).toHaveLength(1);
    const socket = h.sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;
    expect(accessTokenOf(socket.url)).toBe(ALICE.bearer);
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
  });
});

describe('Wake-ups', () => {
  it('visibilitychange GETs the open game', async () => {
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(openingBoard()), getGameScript(openingBoard())],
    });
    await h.adapter.boot();

    await h.adapter.becomeVisible();

    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
  });

  it('stateChanged for another game does not replace the board', async () => {
    const open = openingBoard('G1');
    const h = makePagesHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(open), myGamesScript([])],
    });
    await h.adapter.boot();
    expect(h.adapter.board()).toEqual(open);

    await h.adapter.receiveStateChanged({
      type: 'stateChanged',
      version: 1,
      groupHash: OTHER_GROUP_HASH,
      gameNumber: GAME_ONE,
    });

    expect(h.adapter.board()).toEqual(open);
    expect(h.adapter.board()?.version).toBe(0);
    expect(apiCalls(h, 'GET', `/games/${OTHER_GROUP_HASH}/${GAME_ONE}`)).toHaveLength(0);
    expect(apiCalls(h, 'GET', '/my-games')).toHaveLength(1);
  });
});
