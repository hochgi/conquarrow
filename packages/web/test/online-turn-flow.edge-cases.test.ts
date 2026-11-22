/**
 * P94 edge cases — every outcome of a submit settles, unlocks and stays honest.
 *
 * @see docs/spec/online-turn-flow/online-turn-flow.edge-cases.feature
 * @see docs/spec/online-turn-flow/SCENARIOS.md
 */

import type { SubmitOutcome } from '@conquarrow/contracts';
import { describe, expect, it } from 'vitest';
import { submitNote } from '../src/online-submit';
import {
  batch,
  failedLogScript,
  logRequests,
  logScript,
  logWindow,
  mark,
  pass,
  snapshotScript,
} from './online-move-log-replay.support';
import {
  finishedAt,
  hostShowingAt,
  othersTurnAt,
  postRejected,
  postStatus,
  posted,
  postsOf,
  queued,
  showingAt,
  snapshotReads,
  snapshotRejected,
  MOVES_PATH,
} from './online-turn-flow.support';
import {
  ALICE,
  GAME_ONE,
  GROUP_HASH,
  gameHash,
  makePagesHarness,
  myGamesScript,
  postMoveScript,
} from './online-web.support';

describe('The first refusal stops the rest and the board still catches up', () => {
  it('A refused move stops the rest and replays the prefix', async () => {
    const first = mark('s1');
    const h = await hostShowingAt(4, [
      posted(5),
      postStatus(422),
      snapshotScript(5),
      logScript(logWindow(4, 5, [first])),
    ]);

    const outcome = await h.host.submitMoves([first, mark('s2'), mark('s3')]);

    expect(outcome).toBe('illegal');
    expect(h.host.illegal()).toBeDefined();
    expect(postsOf(h)).toBe(2);
    expect(h.host.adapter().pendingReplays()).toEqual([batch(4, 5, [first])]);
  });

  it.each([409, 412])('A stale version replays what the others did (%i)', async (status) => {
    const others = [mark('b1'), pass()];
    const h = await showingAt(4, [
      postStatus(status),
      snapshotScript(6),
      logScript(logWindow(4, 6, others)),
    ]);

    const outcome = await h.adapter.submitMoves([pass()]);

    expect(outcome).toBe('stale');
    expect(queued(h)).toEqual([batch(4, 6, others)]);
  });

  it('A 200 without a version stops the rest', async () => {
    const first = mark('s1');
    const h = await showingAt(4, [
      postMoveScript(200, {}),
      posted(6),
      snapshotScript(5),
      logScript(logWindow(4, 5, [first])),
    ]);

    const outcome = await h.adapter.submitMoves([first, mark('s2')]);

    expect(outcome).toBe('sent');
    expect(postsOf(h)).toBe(1);
    expect(queued(h)).toEqual([batch(4, 5, [first])]);
  });
});

describe('Failures settle and unlock', () => {
  it('A server error settles as failed', async () => {
    const h = await showingAt(4, [postStatus(500), snapshotScript(4)]);

    const outcome = await h.adapter.submitMoves([pass()]);

    expect(outcome).toBe('failed');
    expect(h.adapter.submitPending()).toBe(false);
    expect(queued(h)).toEqual([]);
  });

  it('A network failure settles as failed and the board catches up if the move landed', async () => {
    const h = await showingAt(4, [
      postRejected(),
      snapshotScript(5),
      logScript(logWindow(4, 5, [pass()])),
    ]);

    const outcome = await h.adapter.submitMoves([pass()]);

    expect(outcome).toBe('failed');
    expect(h.adapter.submitPending()).toBe(false);
    expect(queued(h)).toEqual([batch(4, 5, [pass()])]);
  });

  it('A network failure during reconcile still settles', async () => {
    const h = await showingAt(4, [postRejected(), snapshotRejected()]);

    const outcome = await h.adapter.submitMoves([pass()]);

    expect(outcome).toBe('failed');
    expect(h.adapter.submitPending()).toBe(false);
    expect(h.adapter.board()?.version).toBe(4);
  });

  it('An unauthorised POST prompts and does not reconcile', async () => {
    const h = await showingAt(4, [postStatus(401), snapshotScript(5)]);
    const readsBefore = snapshotReads(h);

    const outcome = await h.adapter.submitMoves([pass()]);

    expect(outcome).toBe('unauthorized');
    expect(h.gis.promptCount).toBeGreaterThan(0);
    expect(snapshotReads(h)).toBe(readsBefore);
  });

  it.each<{ outcome: SubmitOutcome; note: string | undefined }>([
    { outcome: 'sent', note: undefined },
    // P100 D2: illegal has its own sentence; the refusals are pinned in send-refusal.
    {
      outcome: 'illegal',
      note: 'The server refused that move, so the board shows the last accepted position.',
    },
    // P95 D10: the held submit says what happens next.
    {
      outcome: 'unauthorized',
      note: 'Your sign-in expired. Sign in again and your move will be sent.',
    },
    { outcome: 'forbidden', note: 'That seat is not yours to move.' },
    {
      outcome: 'stale',
      note: 'The game moved on before your move arrived. The board has caught up.',
    },
    {
      outcome: 'failed',
      note: 'The server did not answer, so your last move may not have been sent. Try again.',
    },
  ])('A note says what the human can act on ($outcome)', ({ outcome, note }) => {
    expect(submitNote(outcome)).toBe(note);
  });
});

describe('Reconcile falls back to the snapshot like a wake does', () => {
  it('A gap installs the snapshot', async () => {
    const h = await showingAt(4, [
      posted(5),
      snapshotScript(5),
      logScript(logWindow(4, 5, [], true)),
    ]);

    await h.adapter.submitMoves([pass()]);

    expect(h.adapter.board()?.version).toBe(5);
    expect(queued(h)).toEqual([]);
  });

  it('A failed log read installs the snapshot', async () => {
    const h = await showingAt(4, [posted(5), snapshotScript(5), failedLogScript()]);

    await h.adapter.submitMoves([pass()]);

    expect(h.adapter.board()?.version).toBe(5);
    expect(queued(h)).toEqual([]);
  });

  it('No displayed baseline installs the snapshot', async () => {
    const h = makePagesHarness({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: [snapshotScript(0), posted(1), snapshotScript(1)],
    });
    await h.adapter.boot();

    const outcome = await h.adapter.submitMoves([pass()]);

    expect(outcome).toBe('sent');
    expect(h.adapter.board()?.version).toBe(1);
    expect(logRequests(h)).toEqual([]);
  });
});

describe('Guards send nothing', () => {
  it('An empty move list is refused without a request', async () => {
    const h = await showingAt(4, [posted(5)]);

    expect(await h.adapter.submitMoves([])).toBe('no-moves');
    expect(postsOf(h)).toBe(0);
  });

  it('A finished game is refused without a request', async () => {
    const h = makePagesHarness({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: [finishedAt(4), posted(5)],
    });
    await h.adapter.boot();
    h.adapter.noteDisplayed(4);

    expect(await h.adapter.submitMoves([pass()])).toBe('game-over');
    expect(postsOf(h)).toBe(0);
  });

  it('Another seat’s turn is refused without a request', async () => {
    const h = makePagesHarness({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: [othersTurnAt(4), posted(5)],
    });
    await h.adapter.boot();
    h.adapter.noteDisplayed(4);

    expect(await h.adapter.submitMoves([pass()])).toBe('not-your-turn');
    expect(postsOf(h)).toBe(0);
  });

  it('A queued replay batch is refused without a request', async () => {
    const h = await showingAt(4, [
      snapshotScript(5),
      logScript(logWindow(4, 5, [mark('b1')])),
      posted(6),
    ]);
    await h.adapter.receiveStateChanged({
      type: 'stateChanged',
      version: 5,
      groupHash: GROUP_HASH,
      gameNumber: GAME_ONE,
    });

    expect(await h.adapter.submitMoves([pass()])).toBe('replaying');
    expect(postsOf(h)).toBe(0);
  });
});

// P94 review: cases the mutation run found unpinned.
describe('Review — what a 200 carries, the route guard, and how long the 422 note lasts', () => {
  it('A 200 whose version is not an integer stops the rest as sent', async () => {
    const h = await showingAt(4, [postMoveScript(200, { version: 5.5 }), snapshotScript(4)]);

    const outcome = await h.adapter.submitMoves([mark('s1'), mark('s2')]);

    expect(outcome).toBe('sent');
    expect(postsOf(h)).toBe(1);
  });

  it('A 200 whose body is not a JSON object stops the rest as sent', async () => {
    const h = await showingAt(4, [
      { method: 'POST', path: MOVES_PATH, status: 200, rawBody: 'ok' },
      snapshotScript(4),
    ]);

    const outcome = await h.adapter.submitMoves([mark('s1'), mark('s2')]);

    expect(outcome).toBe('sent');
    expect(postsOf(h)).toBe(1);
  });

  it('Leaving the game route refuses a submit without a request', async () => {
    const h = await showingAt(4, [posted(5)]);
    (h.location as { hash: string }).hash = '';

    const outcome = await h.adapter.submitMoves([mark('s1')]);

    expect(outcome).toBe('no-game');
    expect(postsOf(h)).toBe(0);
  });

  it('The 422 note outlives the reconcile reads and clears on the next accepted request', async () => {
    const h = await hostShowingAt(4, [postStatus(422), snapshotScript(4), myGamesScript([])]);

    expect(await h.host.submitMoves([mark('s1')])).toBe('illegal');
    expect(h.host.illegal()).toBeDefined();

    await h.host.refreshLibrary();

    expect(h.host.illegal()).toBeUndefined();
  });
});
