/**
 * One component test per SCENARIOS.md path, including every alt.
 * The host is the component. The HTTP door is the probed leaf.
 *
 * @see docs/spec/send-self-heal/SCENARIOS.md
 */

import { afterEach, describe, expect, it } from 'vitest';
import { endTurn, GOOGLE_ID_TOKEN_SESSION_KEY } from '@conquarrow/contracts';
import { REPLAY_STALL_MS } from '../src/online-heal';
import { GAME_DELETED_COPY } from '../src/online-shell-ui';
import { submitNote } from '../src/online-submit';
import { aliceBobSeats, BOB, GAME_ONE, GROUP_HASH, gameHash } from './online-web.support';
import {
  ACCEPT_PATH,
  byPath,
  http,
  INVITE_GET,
  INVITE_TOKEN,
  inviteHash,
  jsonBody,
  once,
  onceThrow,
  sentPaths,
} from './session-expired.scenarios.support';
import {
  GAME_PATH,
  MOVES_PATH,
  board,
  bootAt,
  createHealRig,
  holdAt,
  me,
  posted,
  queuedBatch,
  seatsWithoutAlice,
  stuckBatch,
  unauthorized,
  type HealRig,
} from './send-self-heal.scenarios.support';

let rig: HealRig;

afterEach(async () => {
  await rig.close();
});

/** The requests after the setup, as `METHOD path`. */
const after = (skip: number): readonly string[] => sentPaths(rig).slice(skip);

const BOOT = ['GET /me', `GET ${GAME_PATH}`];
const HOLD = [...BOOT, `POST ${MOVES_PATH}`];
const NOT_FOUND = http(404, { error: 'not found' });
/** A flush that forgot the route guard asks for this. Programmed so the assertion fails fast. */
const MISSING_GAME = '/games/undefined/undefined';
const GAME_TWO = '000002';
const TWO_PATH = `/games/${GROUP_HASH}/${GAME_TWO}`;
const TWO_MOVES = `${TWO_PATH}/moves`;
const GAME_TWO_HASH = gameHash(GROUP_HASH, GAME_TWO);
const OTHER_GROUP_HASH = gameHash('cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd', GAME_ONE);

describe('SCENARIOS.md 1 — a Send heals a hold', () => {
  it('alt board still at the held version: the held moves are posted, held-sent', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(4));
    once(rig, 'POST', MOVES_PATH, posted(5));
    once(rig, 'GET', GAME_PATH, board(5, 'B'));

    const outcome = await rig.host.submitMoves([endTurn(), endTurn()]);

    const moves = byPath(rig, 'POST', MOVES_PATH);
    expect({
      outcome,
      note: submitNote(outcome),
      pending: rig.host.submitPending(),
      sent: after(HOLD.length),
      sameBody: moves[1]?.body === moves[0]?.body,
      ifMatch: moves[1]?.headers['If-Match'],
      posts: moves.length,
    }).toEqual({
      outcome: 'held-sent',
      note: submitNote('held-sent'),
      pending: false,
      sent: ['GET /me', `GET ${GAME_PATH}`, `POST ${MOVES_PATH}`, `GET ${GAME_PATH}`],
      sameBody: true,
      ifMatch: '"4"',
      posts: 2,
    });
    expect(submitNote('held-sent')).toBeDefined();
  });

  it('alt board moved on: the hold is dropped, held-dropped, no POST', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(6));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({
      outcome,
      pending: rig.host.submitPending(),
      sent: after(HOLD.length),
      boardVersion: rig.host.board()?.version,
    }).toEqual({
      outcome: 'held-dropped',
      pending: false,
      sent: ['GET /me', `GET ${GAME_PATH}`],
      boardVersion: 6,
    });
    expect(submitNote('held-dropped')).toBeDefined();
  });

  it('alt /me names another user: the hold is dropped', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me(BOB.userHash));
    once(rig, 'GET', GAME_PATH, board(4));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, pending: rig.host.submitPending(), sent: after(HOLD.length) }).toEqual({
      outcome: 'held-dropped',
      pending: false,
      sent: ['GET /me', `GET ${GAME_PATH}`],
    });
  });

  it('alt /me 401: the hold is kept, held, no POST', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', unauthorized);

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({
      outcome,
      pending: rig.host.submitPending(),
      expired: rig.host.sessionExpired(),
      sent: after(HOLD.length),
    }).toEqual({ outcome: 'held', pending: true, expired: true, sent: ['GET /me'] });
  });

  it('alt the held POST answers 401 again: unauthorized, the hold stays', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(4));
    once(rig, 'POST', MOVES_PATH, unauthorized);

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, pending: rig.host.submitPending(), sent: after(HOLD.length) }).toEqual({
      outcome: 'unauthorized',
      pending: true,
      sent: ['GET /me', `GET ${GAME_PATH}`, `POST ${MOVES_PATH}`],
    });
  });

  it('a signed-out hold is not healed: held, no request', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    rig.session.removeItem('conquarrow:google-id-token');

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, sent: after(HOLD.length) }).toEqual({ outcome: 'held', sent: [] });
  });

  it('alt held game 404: no-game, no POST, the hold is not restored', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, NOT_FOUND);

    const outcome = await rig.host.submitMoves([endTurn()]);

    // P100's no-game note is not the explanation; the lobby line is.
    expect(submitNote('no-game')).not.toBe(GAME_DELETED_COPY);
    expect({
      outcome,
      pending: rig.host.submitPending(),
      deleted: rig.host.adapter().gameDeleted(),
      lobby: GAME_DELETED_COPY,
      hash: rig.location.hash,
      sent: after(HOLD.length),
    }).toEqual({
      outcome: 'no-game',
      pending: false,
      deleted: true,
      lobby: 'That game was deleted.',
      hash: '',
      sent: ['GET /me', `GET ${GAME_PATH}`],
    });
  });

  it('alt off the held game, no board loaded: the hold is dropped, no-game, no POST', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    // Invite accept 409 clears the board and does not clear the hold.
    rig.location.hash = inviteHash(INVITE_TOKEN);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', INVITE_GET, http(200, { token: INVITE_TOKEN, seats: aliceBobSeats() }));
    await rig.host.handleHashChange();
    once(rig, 'POST', ACCEPT_PATH, http(409, { error: 'conflict' }));
    await rig.host.acceptInvite();
    expect({
      board: rig.host.board(),
      full: rig.host.adapter().lobbyFull(),
      pending: rig.host.submitPending(),
      hash: rig.location.hash,
    }).toEqual({
      board: undefined,
      full: true,
      pending: true,
      hash: inviteHash(INVITE_TOKEN),
    });
    const before = sentPaths(rig).length;
    once(rig, 'GET', '/me', me());
    // Traps: the hold is off screen, so reading or posting it would be a bug.
    once(rig, 'GET', GAME_PATH, board(9));
    once(rig, 'POST', MOVES_PATH, posted(5));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, pending: rig.host.submitPending(), sent: after(before) }).toEqual({
      outcome: 'no-game',
      pending: false,
      sent: ['GET /me'],
    });
  });
});

describe('SCENARIOS.md 2 — a poll heals a hold, and App hears it once', () => {
  it('alt board at the held version: held-sent is stored and read once', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(4));
    once(rig, 'POST', MOVES_PATH, posted(5));
    once(rig, 'GET', GAME_PATH, board(5, 'B'));

    await rig.host.handlePoll();

    expect({
      sent: after(HOLD.length),
      pending: rig.host.submitPending(),
      first: rig.host.adapter().takeHealOutcome(),
      second: rig.host.adapter().takeHealOutcome(),
    }).toEqual({
      sent: ['GET /me', `GET ${GAME_PATH}`, `POST ${MOVES_PATH}`, `GET ${GAME_PATH}`],
      pending: false,
      first: 'held-sent',
      second: undefined,
    });
  });

  it('alt board moved on: held-dropped is stored', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(7));

    await rig.host.handlePoll();

    expect({
      sent: after(HOLD.length),
      pending: rig.host.submitPending(),
      first: rig.host.adapter().takeHealOutcome(),
    }).toEqual({
      sent: ['GET /me', `GET ${GAME_PATH}`],
      pending: false,
      first: 'held-dropped',
    });
  });

  it('a resume heals too', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(7));
    // becomeVisible's own game read and library read follow the heal.
    once(rig, 'GET', GAME_PATH, board(7));
    once(rig, 'GET', '/my-games', { status: 200, body: JSON.stringify({ lobbies: [], games: [] }) });

    await rig.host.handleVisibility(true);

    expect(rig.host.adapter().takeHealOutcome()).toBe('held-dropped');
    expect(rig.host.submitPending()).toBe(false);
  });

  it('nothing is stored without a hold', async () => {
    rig = createHealRig();
    await bootAt(rig, 4);
    expect(rig.host.adapter().takeHealOutcome()).toBeUndefined();
  });

  it('alt held game 404: nothing is posted, the hold is not restored, nothing is stored', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, NOT_FOUND);
    // A trap: posting the hold, or storing a drop, would be a bug.
    once(rig, 'POST', MOVES_PATH, posted(5));

    await rig.host.handlePoll();

    expect({
      sent: after(HOLD.length),
      pending: rig.host.submitPending(),
      deleted: rig.host.adapter().gameDeleted(),
      lobby: GAME_DELETED_COPY,
      hash: rig.location.hash,
      first: rig.host.adapter().takeHealOutcome(),
      second: rig.host.adapter().takeHealOutcome(),
    }).toEqual({
      sent: ['GET /me', `GET ${GAME_PATH}`],
      pending: false,
      deleted: true,
      lobby: 'That game was deleted.',
      hash: '',
      first: undefined,
      second: undefined,
    });
  });

  it('a resume on a deleted held game stores nothing', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, NOT_FOUND);
    // The hash is the lobby after the 404, so the resume reads the library, not the game.
    once(rig, 'GET', '/my-games', http(200, { lobbies: [], games: [] }));
    once(rig, 'POST', MOVES_PATH, posted(5));

    await rig.host.handleVisibility(true);

    expect({
      sent: after(HOLD.length),
      pending: rig.host.submitPending(),
      deleted: rig.host.adapter().gameDeleted(),
      stored: rig.host.adapter().takeHealOutcome(),
    }).toEqual({
      sent: ['GET /me', `GET ${GAME_PATH}`, 'GET /my-games'],
      pending: false,
      deleted: true,
      stored: undefined,
    });
  });
});

describe('SCENARIOS.md 3 — the replay watchdog', () => {
  it('alt within replayStallMs: replaying, no request', async () => {
    rig = createHealRig();
    await stuckBatch(rig, 4);
    // An empty take leaves the stuck batch in flight and its stamp alone.
    expect(rig.host.adapter().takeReplay()).toBeUndefined();
    const before = sentPaths(rig).length;
    rig.advance(REPLAY_STALL_MS - 1);

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, sent: after(before) }).toEqual({ outcome: 'replaying', sent: [] });
  });

  it('alt stalled: flushed to the latest snapshot, stale, no POST', async () => {
    rig = createHealRig();
    await stuckBatch(rig, 4);
    const before = sentPaths(rig).length;
    rig.advance(REPLAY_STALL_MS);
    once(rig, 'GET', GAME_PATH, board(5));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({
      outcome,
      note: submitNote(outcome),
      sent: after(before),
      queued: rig.host.adapter().pendingReplays().length,
      boardVersion: rig.host.board()?.version,
    }).toEqual({
      outcome: 'stale',
      note: submitNote('stale'),
      sent: [`GET ${GAME_PATH}`],
      queued: 0,
      boardVersion: 5,
    });
  });

  it('after the flush, the next Send is posted without that batch being reported displayed', async () => {
    rig = createHealRig();
    await stuckBatch(rig, 4);
    rig.advance(REPLAY_STALL_MS);
    once(rig, 'GET', GAME_PATH, board(5));
    expect(await rig.host.submitMoves([endTurn()])).toBe('stale');
    // App has not reported the flushed batch displayed. noteDisplayed would
    // clear an in-flight batch by itself, so this follow-up must not call it.
    const before = sentPaths(rig).length;
    once(rig, 'POST', MOVES_PATH, posted(6));
    once(rig, 'GET', GAME_PATH, board(6, 'B'));
    // Trap: a flush that left the displayed baseline would replay from it.
    once(rig, 'GET', `${GAME_PATH}/log`, {
      status: 200,
      body: JSON.stringify({ from: 4, to: 6, gap: false, moves: [{ kind: 'endTurn' }] }),
    });

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect(outcome).not.toBe('replaying');
    expect({ outcome, sent: after(before) }).toEqual({
      outcome: 'sent',
      sent: [`POST ${MOVES_PATH}`, `GET ${GAME_PATH}`],
    });
    expect(byPath(rig, 'POST', MOVES_PATH)[0]?.headers['If-Match']).toBe('"5"');
  });

  it('alt stalled, hash is not a game: stale, the batch is cleared, no game is read', async () => {
    rig = createHealRig();
    await stuckBatch(rig, 4);
    const onGame = rig.location.hash;
    // Navigation does not clear an in-flight batch: leave the game and come
    // back, still inside the stall, and Send is still replaying. Off a game
    // route `no-game` outranks `replaying`, so the stalled answer below is
    // `stale` rather than `no-game` — that is the batch still pending.
    rig.location.hash = '';
    rig.location.hash = onGame;
    expect(await rig.host.submitMoves([endTurn()])).toBe('replaying');
    rig.location.hash = '';
    const before = sentPaths(rig).length;
    rig.advance(REPLAY_STALL_MS);
    // Traps, and the re-check answer if the follow-up is not still replaying.
    once(rig, 'GET', GAME_PATH, board(5, 'B'));
    once(rig, 'GET', MISSING_GAME, NOT_FOUND);
    once(rig, 'GET', '/me', me());

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({
      outcome,
      sent: after(before),
      queued: rig.host.adapter().pendingReplays().length,
    }).toEqual({ outcome: 'stale', sent: [], queued: 0 });
    // Back on the game, a flush that only cleared the progress stamp still refuses.
    rig.location.hash = onGame;
    const again = await rig.host.submitMoves([endTurn()]);
    expect(again).not.toBe('replaying');
  });

  it('a flush clears a batch that is still queued', async () => {
    rig = createHealRig();
    await queuedBatch(rig, 4);
    expect(rig.host.adapter().pendingReplays()).toHaveLength(1);
    const before = sentPaths(rig).length;
    rig.advance(REPLAY_STALL_MS);
    once(rig, 'GET', GAME_PATH, board(5));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({
      outcome,
      queued: rig.host.adapter().pendingReplays().length,
      sent: after(before),
    }).toEqual({ outcome: 'stale', queued: 0, sent: [`GET ${GAME_PATH}`] });
    const againBefore = sentPaths(rig).length;
    once(rig, 'POST', MOVES_PATH, posted(6));
    once(rig, 'GET', GAME_PATH, board(6, 'B'));
    once(rig, 'GET', `${GAME_PATH}/log`, {
      status: 200,
      body: JSON.stringify({ from: 4, to: 6, gap: false, moves: [{ kind: 'endTurn' }] }),
    });

    const again = await rig.host.submitMoves([endTurn()]);

    expect(again).not.toBe('replaying');
    expect({ again, sent: after(againBefore) }).toEqual({
      again: 'sent',
      sent: [`POST ${MOVES_PATH}`, `GET ${GAME_PATH}`],
    });
  });

  it('a poll flushes a stalled batch', async () => {
    rig = createHealRig();
    await stuckBatch(rig, 4);
    const before = sentPaths(rig).length;
    rig.advance(REPLAY_STALL_MS);
    once(rig, 'GET', GAME_PATH, board(5));
    once(rig, 'GET', `${GAME_PATH}/version`, { status: 200, body: JSON.stringify({ version: 5 }) });

    await rig.host.handlePoll();

    expect({
      queued: rig.host.adapter().pendingReplays().length,
      sent: after(before),
    }).toEqual({
      queued: 0,
      sent: [`GET ${GAME_PATH}`, `GET ${GAME_PATH}/version`],
    });
  });

  it('a poll flushes a stalled batch that is still queued', async () => {
    rig = createHealRig();
    await queuedBatch(rig, 4);
    expect(rig.host.adapter().pendingReplays()).toHaveLength(1);
    const before = sentPaths(rig).length;
    rig.advance(REPLAY_STALL_MS);
    once(rig, 'GET', GAME_PATH, board(5));
    once(rig, 'GET', `${GAME_PATH}/version`, http(200, { version: 5 }));

    await rig.host.handlePoll();

    expect({
      queued: rig.host.adapter().pendingReplays().length,
      sent: after(before),
    }).toEqual({
      queued: 0,
      sent: [`GET ${GAME_PATH}`, `GET ${GAME_PATH}/version`],
    });
    const againBefore = sentPaths(rig).length;
    once(rig, 'POST', MOVES_PATH, posted(6));
    once(rig, 'GET', GAME_PATH, board(6, 'B'));
    // Trap: a flush that left the displayed baseline would replay from it.
    once(rig, 'GET', `${GAME_PATH}/log`, {
      status: 200,
      body: JSON.stringify({ from: 4, to: 6, gap: false, moves: [{ kind: 'endTurn' }] }),
    });

    const again = await rig.host.submitMoves([endTurn()]);

    expect(again).not.toBe('replaying');
    expect(after(againBefore)).toEqual([`POST ${MOVES_PATH}`, `GET ${GAME_PATH}`]);
  });

  it('the stall timeout is configurable', async () => {
    rig = createHealRig({ replayStallMs: 5_000 });
    await stuckBatch(rig, 4);
    rig.advance(5_000);
    once(rig, 'GET', GAME_PATH, board(5));

    expect(await rig.host.submitMoves([endTurn()])).toBe('stale');
  });
});

describe('SCENARIOS.md 4 — one re-check before not-your-turn', () => {
  const staleSeatsBoot = async (): Promise<void> => {
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(4, 'A', seatsWithoutAlice()));
    await rig.host.boot();
  };

  it('alt now the caller’s turn at the same version: posted', async () => {
    rig = createHealRig();
    await staleSeatsBoot();
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(4));
    once(rig, 'POST', MOVES_PATH, posted(5));
    once(rig, 'GET', GAME_PATH, board(5, 'B'));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, sent: after(BOOT.length) }).toEqual({
      outcome: 'sent',
      sent: ['GET /me', `GET ${GAME_PATH}`, `POST ${MOVES_PATH}`, `GET ${GAME_PATH}`],
    });
    expect(jsonBody(byPath(rig, 'POST', MOVES_PATH)[0])).toMatchObject({ move: { kind: 'endTurn' } });
  });

  it('alt now the caller’s turn at a newer version: stale, no POST', async () => {
    rig = createHealRig();
    await staleSeatsBoot();
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(5));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, sent: after(BOOT.length) }).toEqual({
      outcome: 'stale',
      sent: ['GET /me', `GET ${GAME_PATH}`],
    });
  });

  it('alt still another seat’s turn: not-your-turn, /me and the game read once each', async () => {
    rig = createHealRig();
    await staleSeatsBoot();
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(4, 'B'));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, sent: after(BOOT.length) }).toEqual({
      outcome: 'not-your-turn',
      sent: ['GET /me', `GET ${GAME_PATH}`],
    });
  });
});

describe('SCENARIOS.md 1–3 — the heal’s own edges', () => {
  it('/me fails without a 401: the hold waits and the game is not read', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', { status: 503, body: '' });

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, pending: rig.host.submitPending(), sent: after(HOLD.length) }).toEqual({
      outcome: 'held',
      pending: true,
      sent: ['GET /me'],
    });
  });

  it('a resume while signed out does not heal: no /me', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    rig.session.removeItem(GOOGLE_ID_TOKEN_SESSION_KEY);
    // A trap: reading /me signed out would be a bug.
    once(rig, 'GET', '/me', me());

    await rig.host.handleVisibility(true);

    expect({ sent: after(HOLD.length), pending: rig.host.submitPending() }).toEqual({
      sent: [],
      pending: true,
    });
  });

  it('the network fails mid-heal: the hold waits, held, and Send is free again', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    onceThrow(rig, 'GET', GAME_PATH);

    const outcome = await rig.host.submitMoves([endTurn()]);
    once(rig, 'GET', '/me', { status: 503, body: '' });
    const again = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, again, sent: after(HOLD.length) }).toEqual({
      outcome: 'held',
      again: 'held',
      sent: ['GET /me', `GET ${GAME_PATH}`, 'GET /me'],
    });
  });

  it('a Send or a poll during a heal sends nothing more', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(6));

    // Traps: a second heal would read /me and the game again.
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(6));

    const healing = rig.host.submitMoves([endTurn()]);
    const polling = rig.host.handlePoll();
    const second = await rig.host.submitMoves([endTurn()]);
    await polling;
    const first = await healing;

    expect({ first, second, sent: after(HOLD.length) }).toEqual({
      first: 'held-dropped',
      second: 'sending',
      sent: ['GET /me', `GET ${GAME_PATH}`],
    });
  });

  it('a hold for a game no longer on screen is dropped silently, and this Send goes out', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    rig.location.hash = gameHash(GROUP_HASH, GAME_TWO);
    once(rig, 'GET', '/me', me());
    once(rig, 'POST', TWO_MOVES, posted(5));
    once(rig, 'GET', TWO_PATH, board(5, 'B'));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, sent: after(HOLD.length) }).toEqual({
      outcome: 'sent',
      sent: ['GET /me', `POST ${TWO_MOVES}`, `GET ${TWO_PATH}`],
    });
    expect(rig.host.adapter().takeHealOutcome()).toBeUndefined();
  });

  it.each([
    ['another game number', GAME_TWO_HASH],
    ['another group', OTHER_GROUP_HASH],
  ])('a poll off the held game (%s) drops the hold and stores nothing', async (_label, hash) => {
    rig = createHealRig();
    await holdAt(rig, 4);
    rig.location.hash = hash;
    once(rig, 'GET', '/me', me());
    // A trap: the held game is off screen, so reading it would be a bug (and
    // a moved board would store held-dropped, failing fast instead of hanging).
    once(rig, 'GET', GAME_PATH, board(9));

    await rig.host.handlePoll();

    expect({
      sent: after(HOLD.length),
      pending: rig.host.submitPending(),
      stored: rig.host.adapter().takeHealOutcome(),
    }).toEqual({ sent: ['GET /me'], pending: false, stored: undefined });
  });

  it('a different game number is not the held game: the hold drops silently and the held moves are not posted', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    const heldBody = byPath(rig, 'POST', MOVES_PATH)[0]?.body;
    rig.location.hash = GAME_TWO_HASH;
    once(rig, 'GET', '/me', me());
    // Traps, in the order a false onHeldGame would take them: read the held
    // game at its version, post those moves there, reconcile, or post them to
    // this game instead. The board is still the held version, so a miss posts
    // rather than storing held-dropped.
    once(rig, 'GET', GAME_PATH, board(4));
    once(rig, 'POST', MOVES_PATH, posted(5));
    once(rig, 'GET', GAME_PATH, board(5, 'B'));
    once(rig, 'POST', TWO_MOVES, posted(5));
    once(rig, 'GET', TWO_PATH, board(5, 'B'));

    await rig.host.handlePoll();

    expect({
      sent: after(HOLD.length),
      pending: rig.host.submitPending(),
      stored: rig.host.adapter().takeHealOutcome(),
      heldReads: byPath(rig, 'GET', GAME_PATH).length,
      heldPosts: byPath(rig, 'POST', MOVES_PATH).length,
      postedHeldToOther: byPath(rig, 'POST', TWO_MOVES).some((request) => request.body === heldBody),
    }).toEqual({
      sent: ['GET /me'],
      pending: false,
      stored: undefined,
      heldReads: 1,
      heldPosts: 1,
      postedHeldToOther: false,
    });
  });

  it('a lobby hash is not the held game: the hold drops silently and the held game is not read', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    const heldBody = byPath(rig, 'POST', MOVES_PATH)[0]?.body;
    rig.location.hash = '';
    once(rig, 'GET', '/me', me());
    // The board is still at the held version. Treating the lobby as that game
    // would read it and post the held moves; a non-game route must not.
    once(rig, 'GET', GAME_PATH, board(4));
    once(rig, 'POST', MOVES_PATH, posted(5));
    once(rig, 'GET', GAME_PATH, board(5, 'B'));

    await rig.host.handlePoll();

    const laterPosts = sentPaths(rig).slice(HOLD.length).filter((line) => line.startsWith('POST '));
    expect({
      sent: after(HOLD.length),
      pending: rig.host.submitPending(),
      stored: rig.host.adapter().takeHealOutcome(),
      heldReads: byPath(rig, 'GET', GAME_PATH).length,
      repostedHeld: byPath(rig, 'POST', MOVES_PATH).some(
        (request, index) => index > 0 && request.body === heldBody,
      ),
      laterPosts,
    }).toEqual({
      sent: ['GET /me'],
      pending: false,
      stored: undefined,
      heldReads: 1,
      repostedHeld: false,
      laterPosts: [],
    });
  });

  it('a stored outcome survives a later resume with no hold', async () => {
    rig = createHealRig();
    await holdAt(rig, 4);
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(4));
    once(rig, 'POST', MOVES_PATH, posted(5));
    once(rig, 'GET', GAME_PATH, board(5, 'B'));
    await rig.host.handlePoll();
    once(rig, 'GET', GAME_PATH, board(5, 'B'));
    once(rig, 'GET', '/my-games', { status: 200, body: JSON.stringify({ lobbies: [], games: [] }) });

    await rig.host.handleVisibility(true);

    expect(rig.host.adapter().takeHealOutcome()).toBe('held-sent');
  });

  it('the re-check finds the game deleted: no-game, no POST', async () => {
    rig = createHealRig();
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, board(4, 'B'));
    await rig.host.boot();
    const before = sentPaths(rig).length;
    once(rig, 'GET', '/me', me());
    once(rig, 'GET', GAME_PATH, { status: 404, body: JSON.stringify({ error: 'not found' }) });

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, sent: after(before) }).toEqual({
      outcome: 'no-game',
      sent: ['GET /me', `GET ${GAME_PATH}`],
    });
  });

  it('a resume flushes a stalled batch before it reads the page', async () => {
    rig = createHealRig();
    await stuckBatch(rig, 4);
    const before = sentPaths(rig).length;
    rig.advance(REPLAY_STALL_MS);
    once(rig, 'GET', GAME_PATH, board(5));
    once(rig, 'GET', GAME_PATH, board(5));
    once(rig, 'GET', '/my-games', { status: 200, body: JSON.stringify({ lobbies: [], games: [] }) });

    await rig.host.handleVisibility(true);

    expect({ sent: after(before), queued: rig.host.adapter().pendingReplays().length }).toEqual({
      sent: [`GET ${GAME_PATH}`, `GET ${GAME_PATH}`, 'GET /my-games'],
      queued: 0,
    });
    expect(rig.host.submitPending()).toBe(false);
  });
});
