/**
 * EARS invariants for docs/spec/online-shell/online-shell.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/online-web.invariants.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { endTurn, GOOGLE_ID_TOKEN_SESSION_KEY } from '@conquarrow/contracts';
import type { OnlinePagesEnv } from '@conquarrow/contracts';
import { submitNote } from '../src/online-submit';
import {
  ALICE,
  BOB,
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  ONE_HUMAN_TWO_HEURISTIC,
  THREE_HEURISTIC,
  TWO_HUMAN_HEURISTIC,
  acceptInviteEmpty410Script,
  accessTokenOf,
  aliceBobSeats,
  aliceHostSeats,
  apiCalled,
  apiCalls,
  boardAt,
  createInviteScript,
  gameHash,
  getGameScript,
  goneInviteEmptyBodyScript,
  humanBoundCount,
  inviteHash,
  makeHostHarness,
  openingBoard,
  peekInviteScript,
  postMoveScript,
  stateChangedJson,
} from './online-shell.support';

describe('online-shell invariants', () => {
  it('When any of VITE_API_BASE, VITE_WS_URL, or VITE_GOOGLE_CLIENT_ID is empty, the host shall not offer Online mode', async () => {
    const empties: readonly (keyof OnlinePagesEnv)[] = [
      'VITE_API_BASE',
      'VITE_WS_URL',
      'VITE_GOOGLE_CLIENT_ID',
    ];
    for (const key of empties) {
      const h = makeHostHarness({ env: { [key]: '' } });
      await h.host.boot();
      expect(h.host.onlineModeOffered(), key).toBe(false);
    }
  });

  it('When Local mode Starts, the host shall not fetch VITE_API_BASE and shall not open a WebSocket', async () => {
    const plans = [ONE_HUMAN_TWO_HEURISTIC, THREE_HEURISTIC] as const;
    for (const seats of plans) {
      const h = makeHostHarness();
      await h.host.boot();
      h.host.selectMode('local');
      h.host.setSeatPlan(seats);
      await h.host.start();
      expect(h.host.localMatchStarted(), seats.join(',')).toBe(true);
      expect(apiCalled(h), seats.join(',')).toBe(false);
      expect(h.sockets, seats.join(',')).toHaveLength(0);
    }
  });

  it('When GIS yields an ID token, the host shall call deliverGoogleCredential with that token', async () => {
    const h = makeHostHarness();
    await h.host.boot();
    await h.host.handleGisCredential(ALICE.bearer);

    expect(h.session.getItem(GOOGLE_ID_TOKEN_SESSION_KEY)).toBe(ALICE.bearer);
    expect(h.session.keys()).toEqual([GOOGLE_ID_TOKEN_SESSION_KEY]);
    expect(h.sockets).toHaveLength(1);
    const socket = h.sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;
    expect(accessTokenOf(socket.url)).toBe(ALICE.bearer);
  });

  it('When a WebSocket message is valid stateChanged JSON, the host shall call receiveStateChanged. When it is not valid JSON or not that type, the host shall not replace the open board', async () => {
    const open = openingBoard('open-ws');
    const woken = boardAt(1, { tag: 'ws-woken' });
    const valid = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(open), getGameScript(woken)],
    });
    await valid.host.boot();
    await valid.host.handleSocketMessage(stateChangedJson(1));
    expect(valid.host.board()).toEqual(woken);
    expect(apiCalls(valid, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);

    const invalidPayloads = [
      '{not-json',
      '',
      'null',
      '[]',
      '{"type":"pong"}',
      '{"type":"stateChanged"}',
      JSON.stringify({ version: 1, groupHash: GROUP_HASH, gameNumber: GAME_ONE }),
    ] as const;
    for (const raw of invalidPayloads) {
      const h = makeHostHarness({
        sessionToken: ALICE.bearer,
        hash: gameHash(GROUP_HASH, GAME_ONE),
        fetchScript: [getGameScript(open)],
      });
      await h.host.boot();
      await h.host.handleSocketMessage(raw);
      expect(h.host.board(), raw).toEqual(open);
      expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`), raw).toHaveLength(1);
    }
  });

  it('When hashchange fires, the host shall boot', async () => {
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [getGameScript(openingBoard())],
    });
    await h.host.boot();
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(0);

    h.location.hash = gameHash(GROUP_HASH, GAME_ONE);
    await h.host.handleHashChange();

    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
    expect(h.host.board()?.version).toBe(0);
    expect(h.host.mode()).toBe('online');
  });

  it('When the hash is #/invite/<token> or #/g/… and Online env is ready, the host shall select Online mode', async () => {
    const invite = makeHostHarness({
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [peekInviteScript(INVITE_TOKEN, aliceHostSeats())],
    });
    await invite.host.boot();
    expect(invite.host.mode()).toBe('online');

    const game = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(openingBoard())],
    });
    await game.host.boot();
    expect(game.host.mode()).toBe('online');
  });

  it('When signed in on an open invite that is not gone and not full, the host shall offer Accept and shall not auto-accept', async () => {
    const h = makeHostHarness({
      sessionToken: BOB.bearer,
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [peekInviteScript(INVITE_TOKEN, aliceHostSeats())],
    });
    await h.host.boot();
    expect(h.host.acceptOffered()).toBe(true);
    expect(apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(0);
  });

  it('When visibilitychange becomes visible, the host shall becomeVisible', async () => {
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(openingBoard()), getGameScript(openingBoard())],
    });
    await h.host.boot();
    await h.host.handleVisibility(true);
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
  });

  it('When Online mode has an invite whose human seats are not all bound, the host shall not offer Start', async () => {
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [createInviteScript(INVITE_TOKEN)],
    });
    await h.host.boot();
    h.host.selectMode('online');
    h.host.setSeatPlan(TWO_HUMAN_HEURISTIC);
    await h.host.createInvite();
    expect(humanBoundCount(h.host.adapter().inviteSeats())).toBe(1);
    expect(h.host.startOffered()).toBe(false);
  });

  it('When Online mode has an invite whose human seats are all bound, the host shall offer Start', async () => {
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [peekInviteScript(INVITE_TOKEN, aliceBobSeats())],
    });
    await h.host.boot();
    h.host.selectMode('online');
    expect(humanBoundCount(h.host.adapter().inviteSeats())).toBe(2);
    expect(h.host.startOffered()).toBe(true);
  });

  it('When the host submits an online move, the board shall be the adapter GET board — not a local apply', async () => {
    const after = boardAt(1, { activePlayer: 'B', tag: 'server-get-not-local-apply' });
    const opening = openingBoard();
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [
        getGameScript(opening),
        postMoveScript(200, { version: 1, groupHash: GROUP_HASH, gameNumber: GAME_ONE }),
        getGameScript(after),
      ],
    });
    await h.host.boot();
    await h.host.submitMoves([endTurn()]);
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
    expect(h.host.board()).toEqual(after);
    expect(h.host.board()).not.toEqual(opening);
  });

  it('When invite GET or accept returns HTTP 410, the host shall not POST accept, even if reason is missing', async () => {
    const peeked = makeHostHarness({
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [goneInviteEmptyBodyScript(INVITE_TOKEN)],
    });
    await peeked.host.boot();
    expect(peeked.host.inviteGone()).toBe(true);
    await peeked.host.handleGisCredential(ALICE.bearer);
    await peeked.host.acceptInvite();
    expect(apiCalls(peeked, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(0);

    const onAccept = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [
        peekInviteScript(INVITE_TOKEN, aliceHostSeats()),
        acceptInviteEmpty410Script(INVITE_TOKEN),
      ],
    });
    await onAccept.host.boot();
    await onAccept.host.acceptInvite();
    expect(apiCalls(onAccept, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(1);
    expect(onAccept.host.inviteGone()).toBe(true);
    await onAccept.host.acceptInvite();
    await onAccept.host.handleGisCredential(ALICE.bearer);
    expect(apiCalls(onAccept, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(1);
  });

  it('When POST moves returns 422, the host shall surface illegal and shall keep the last GET board', async () => {
    const opening = openingBoard('keep-S');
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(opening), postMoveScript(422, { error: 'unprocessable' })],
    });
    await h.host.boot();
    await h.host.submitMoves([endTurn()]);
    expect(h.host.board()).toEqual(opening);
    // P94 D3: a 422 still reconciles — one more GET, and the board below stays put.
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
    expect(h.host.illegal()).toBe(submitNote('illegal'));
  });

  it('When the player signs out via the host, the session key shall be gone and the WebSocket closed', async () => {
    const h = makeHostHarness({ sessionToken: ALICE.bearer });
    await h.host.boot();
    const socket = h.sockets[0];
    expect(socket).toBeDefined();
    if (socket === undefined) return;

    h.host.signOut();

    expect(h.session.getItem(GOOGLE_ID_TOKEN_SESSION_KEY)).toBeNull();
    expect(h.session.keys()).toEqual([]);
    expect(socket.closed).toBe(true);
  });
});
