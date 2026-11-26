/**
 * docs/spec/online-playtest-ux/online-playtest-ux.core.feature — adapter/host scenarios.
 *
 * @see docs/spec/online-playtest-ux/online-playtest-ux.md
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId, GameState, Group } from '@conquarrow/contracts';
import { DEFAULT_MATCH_CONFIG, endTurn } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { hasLegalStep, onlinePassMove } from '../src/autoEndTurn';
import { parseBoard } from '../src/online-parse';
import { logFromOnlineBoard } from '../src/online-shell-ui';
import {
  ALICE,
  BOB,
  GAME_ONE,
  GROUP_HASH,
  INVITE_TOKEN,
  TWO_HUMAN_HEURISTIC,
  acceptInviteScript,
  aliceBobSeats,
  aliceHostSeats,
  apiCalls,
  bearerOf,
  boardAt,
  createInviteScript,
  gameHash,
  getGameScript,
  goneInviteStartedScript,
  humanBoundCount,
  inviteHash,
  jsonState,
  makeHostHarness,
  openingBoard,
  parseJson,
  peekInviteScript,
  postMoveScript,
} from './online-shell.support';

const spentOutNoStep = (): { readonly rules: ReturnType<typeof makeRules>; readonly state: GameState } => {
  const rules = makeRules(makeTiling());
  const opening = makeMatch();
  const A = opening.players[0];
  if (A === undefined) throw new Error('setup: makeMatch has no players');
  const from = [...opening.groups.entries()].find(([, g]) => g.owner === A)?.[0];
  if (from === undefined) throw new Error('setup: opening has no group for A');
  const state: GameState = {
    ...opening,
    activePlayer: A,
    groups: new Map<ArrowId, Group>([
      [from, { owner: A, heads: 1, spent: 1 }],
      ...[...opening.groups.entries()].filter(([, g]) => g.owner !== A),
    ]),
  };
  return { rules, state };
};

describe('Game GET carries seats', () => {
  it('Two clients show the same seat kinds', async () => {
    const seats = aliceBobSeats();
    const body = { version: 0, state: jsonState({ tag: 'hud-seats' }), seats };
    const game = makeMatch({ ...DEFAULT_MATCH_CONFIG, playerCount: 3 });
    const logA = logFromOnlineBoard(game, parseBoard(body)?.seats);
    const logB = logFromOnlineBoard(game, parseBoard(body)?.seats);
    expect(logA.seats.map((row) => row.kind)).toEqual(['human', 'human', 'heuristic']);
    expect(logB.seats.map((row) => row.kind)).toEqual(logA.seats.map((row) => row.kind));
    expect(logA.seats[2]?.kind).toBe('heuristic');
    expect(logB.seats[2]?.kind).toBe('heuristic');

    const seatedBoard = { version: 0, state: jsonState({ tag: 'hud-get' }), seats };
    const clientA = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(seatedBoard)],
    });
    const clientB = makeHostHarness({
      sessionToken: BOB.bearer,
      hash: gameHash(GROUP_HASH, GAME_ONE),
      fetchScript: [getGameScript(seatedBoard)],
    });
    await clientA.host.boot();
    await clientB.host.boot();
    const fromGetA = logFromOnlineBoard(game, clientA.host.board()?.seats);
    const fromGetB = logFromOnlineBoard(game, clientB.host.board()?.seats);
    expect(fromGetA.seats.map((row) => row.kind)).toEqual(['human', 'human', 'heuristic']);
    expect(fromGetB.seats.map((row) => row.kind)).toEqual(fromGetA.seats.map((row) => row.kind));
  });
});

describe('Host sees the lobby', () => {
  it('Creator does not need to Accept', async () => {
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [peekInviteScript(INVITE_TOKEN, aliceHostSeats())],
    });

    await h.host.boot();

    expect(h.host.acceptOffered()).toBe(false);
    expect(apiCalls(h, 'POST', `/invites/${INVITE_TOKEN}/accept`)).toHaveLength(0);
  });

  it('Guest may Accept until bound', async () => {
    const h = makeHostHarness({
      sessionToken: BOB.bearer,
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [
        peekInviteScript(INVITE_TOKEN, aliceHostSeats()),
        acceptInviteScript(INVITE_TOKEN, aliceBobSeats()),
      ],
    });

    await h.host.boot();
    expect(h.host.acceptOffered()).toBe(true);

    await h.host.acceptInvite();

    expect(humanBoundCount(h.host.adapter().inviteSeats())).toBe(2);
    expect(h.host.acceptOffered()).toBe(false);
  });

  it('refreshLobby sees the other human bind', async () => {
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      fetchScript: [
        createInviteScript(INVITE_TOKEN),
        peekInviteScript(INVITE_TOKEN, aliceBobSeats()),
      ],
    });
    await h.host.boot();
    h.host.selectMode('online');
    h.host.setSeatPlan(TWO_HUMAN_HEURISTIC);
    await h.host.createInvite();
    expect(humanBoundCount(h.host.adapter().inviteSeats())).toBe(1);
    expect(h.host.startOffered()).toBe(false);

    await h.host.refreshLobby();

    const peeks = apiCalls(h, 'GET', `/invites/${INVITE_TOKEN}`);
    expect(peeks).toHaveLength(1);
    const peeked = peeks[0];
    expect(peeked).toBeDefined();
    if (peeked === undefined) return;
    // P105 D3: signed in, the peek carries the bearer so a member sees names.
    expect(bearerOf(peeked)).toBe(ALICE.bearer);
    expect(humanBoundCount(h.host.adapter().inviteSeats())).toBe(2);
    expect(h.host.startOffered()).toBe(true);
  });

  it('410 started opens the match for the waiting host', async () => {
    const h = makeHostHarness({
      sessionToken: ALICE.bearer,
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [
        peekInviteScript(INVITE_TOKEN, aliceHostSeats()),
        goneInviteStartedScript(INVITE_TOKEN, {
          groupHash: GROUP_HASH,
          gameNumber: GAME_ONE,
        }),
        getGameScript(openingBoard()),
      ],
    });
    await h.host.boot();
    expect(h.host.board()).toBeUndefined();
    expect(h.location.hash).toBe(inviteHash(INVITE_TOKEN));

    await h.host.refreshLobby();

    expect(h.location.hash).toBe(gameHash(GROUP_HASH, GAME_ONE));
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(1);
  });
});

describe('Exhausted online turn', () => {
  it('Own turn with no steps POSTs endTurn', async () => {
    const { rules, state } = spentOutNoStep();
    expect(hasLegalStep(rules, state)).toBe(false);
    const activeBefore = state.activePlayer;
    expect(onlinePassMove(rules, state)).toEqual(endTurn());
    expect(state.activePlayer).toBe(activeBefore);

    const after = boardAt(1, { activePlayer: 'B', tag: 'after-online-pass-get' });
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
    const move = onlinePassMove(rules, state);
    expect(move).toEqual(endTurn());
    if (move === undefined) return;

    await h.host.submitMoves([move]);

    const posts = apiCalls(h, 'POST', `/games/${GROUP_HASH}/${GAME_ONE}/moves`);
    expect(posts).toHaveLength(1);
    const posted = posts[0];
    expect(posted).toBeDefined();
    if (posted === undefined) return;
    // P95 D9: every POST carries its submit id.
    const body = parseJson(posted.body) as { readonly submitId?: unknown };
    expect(body).toEqual({ move: endTurn(), submitId: body.submitId });
    expect(typeof body.submitId).toBe('string');
    expect(apiCalls(h, 'GET', `/games/${GROUP_HASH}/${GAME_ONE}`)).toHaveLength(2);
    expect(h.host.board()).toEqual(after);
    expect(h.host.board()).not.toEqual(opening);
  });
});
