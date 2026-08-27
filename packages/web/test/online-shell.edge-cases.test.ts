/**
 * docs/spec/online-shell/online-shell.edge-cases.feature — one test per scenario.
 *
 * @see docs/spec/online-shell/online-shell.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import {
  ALICE,
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  ONE_HUMAN_TWO_HEURISTIC,
  PAGES_ORIGIN,
  PAGES_PATHNAME,
  TWO_HUMAN_HEURISTIC,
  apiCalls,
  createInviteScript,
  gameHash,
  getGameScript,
  goneInviteEmptyBodyScript,
  inviteHash,
  makeHostHarness,
  myGamesScript,
  openingBoard,
  postMoveScript,
} from './online-shell.support';

describe('Lobby chrome', () => {
  it('Online mode does not offer BYOK', async () => {
    const h = makeHostHarness({ sessionToken: ALICE.bearer });
    await h.host.boot();
    h.host.selectMode('online');

    expect(h.host.seatKindOptions()).toEqual(['human', 'heuristic']);
    expect(h.host.seatKindOptions()).not.toContain('byok');
  });

  it('Online create requires two human seats', async () => {
    const h = makeHostHarness({ sessionToken: ALICE.bearer });
    await h.host.boot();
    h.host.selectMode('online');
    h.host.setSeatPlan(ONE_HUMAN_TWO_HEURISTIC);

    expect(h.host.createOffered()).toBe(false);
    expect(apiCalls(h, 'POST', '/invites')).toHaveLength(0);
  });

  it('Online create requires Sign-In', async () => {
    const h = makeHostHarness();
    await h.host.boot();
    h.host.selectMode('online');
    h.host.setSeatPlan(TWO_HUMAN_HEURISTIC);

    expect(h.host.createOffered()).toBe(false);
    expect(apiCalls(h, 'POST', '/invites')).toHaveLength(0);
  });

  it('Copy-invite uses the Pages pathname', async () => {
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [createInviteScript(INVITE_TOKEN)],
    });
    await h.host.boot();
    h.host.selectMode('online');
    h.host.setSeatPlan(TWO_HUMAN_HEURISTIC);

    await h.host.createInvite();

    const copied = h.host.copiedInviteUrl();
    expect(copied).toBe(`${PAGES_ORIGIN}${PAGES_PATHNAME}#/invite/${INVITE_TOKEN}`);
    expect(copied?.endsWith(`#/invite/${INVITE_TOKEN}`)).toBe(true);
    expect(copied).not.toContain(ALICE.sub);
  });

  it('Library row opens the game hash', async () => {
    const listed = { groupHash: 'G', gameNumber: GAME_ONE, status: 'waiting' as const };
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [
        myGamesScript([listed]),
        getGameScript(openingBoard(), listed.groupHash, listed.gameNumber),
      ],
    });
    await h.host.boot();
    await h.host.refreshLibrary();

    await h.host.openMyGame(listed.groupHash, listed.gameNumber);

    expect(h.location.hash).toBe(gameHash('G', GAME_ONE));
    expect(apiCalls(h, 'GET', `/games/G/${GAME_ONE}`)).toHaveLength(1);
  });
});

describe('Invite 410', () => {
  it('410 without reason still blocks accept', async () => {
    const h = makeHostHarness({
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [goneInviteEmptyBodyScript(INVITE_TOKEN)],
    });

    await h.host.boot();

    expect(h.host.inviteGone()).toBe(true);
    expect(apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(0);

    await h.host.handleGisCredential(ALICE.bearer);
    await h.host.acceptInvite();

    expect(apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(0);
    expect(h.host.inviteGone()).toBe(true);
  });
});

describe('Move errors', () => {
  it('422 surfaces illegal and keeps the GET board', async () => {
    const opening = openingBoard('S');
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(opening), postMoveScript(422, { error: 'unprocessable' })],
    });
    await h.host.boot();
    expect(h.host.board()).toEqual(opening);

    await h.host.submitMove(endTurn());

    expect(h.host.board()).toEqual(opening);
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
    expect(h.host.illegal()).toBe('illegal');
  });

  it('Invalid WS payload does not replace the board', async () => {
    const open = openingBoard('G1');
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(open)],
    });
    await h.host.boot();
    expect(h.host.board()).toEqual(open);

    await h.host.handleSocketMessage('{not-json');

    expect(h.host.board()).toEqual(open);
    expect(h.host.board()?.version).toBe(0);
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
  });
});
