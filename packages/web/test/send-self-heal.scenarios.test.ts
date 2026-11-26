/**
 * One component test per SCENARIOS.md path, including every alt.
 * The host is the component. The HTTP door is the probed leaf.
 *
 * @see docs/spec/send-self-heal/SCENARIOS.md
 */

import { afterEach, describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import { REPLAY_STALL_MS } from '../src/online-heal';
import { submitNote } from '../src/online-submit';
import { BOB } from './online-web.support';
import { byPath, jsonBody, once, sentPaths } from './session-expired.scenarios.support';
import {
  GAME_PATH,
  MOVES_PATH,
  board,
  bootAt,
  createHealRig,
  holdAt,
  me,
  posted,
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
});

describe('SCENARIOS.md 3 — the replay watchdog', () => {
  it('alt within replayStallMs: replaying, no request', async () => {
    rig = createHealRig();
    await stuckBatch(rig, 4);
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

  it('after the flush and the install, the next Send is posted', async () => {
    rig = createHealRig();
    await stuckBatch(rig, 4);
    rig.advance(REPLAY_STALL_MS);
    once(rig, 'GET', GAME_PATH, board(5));
    await rig.host.submitMoves([endTurn()]);
    // App installs the snapshot and reports it.
    rig.host.adapter().noteDisplayed(5);
    const before = sentPaths(rig).length;
    once(rig, 'POST', MOVES_PATH, posted(6));
    once(rig, 'GET', GAME_PATH, board(6, 'B'));

    const outcome = await rig.host.submitMoves([endTurn()]);

    expect({ outcome, sent: after(before) }).toEqual({
      outcome: 'sent',
      sent: [`POST ${MOVES_PATH}`, `GET ${GAME_PATH}`],
    });
    expect(byPath(rig, 'POST', MOVES_PATH)[0]?.headers['If-Match']).toBe('"5"');
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
