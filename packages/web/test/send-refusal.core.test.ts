/**
 * P100 core — a Send that sends nothing says why and keeps the route.
 *
 * @see docs/spec/send-refusal/send-refusal.core.feature
 */

import { SUBMIT_OUTCOMES, SUBMIT_REFUSALS } from '@conquarrow/contracts';
import { describe, expect, it } from 'vitest';
import { GOOGLE_ID_TOKEN_SESSION_KEY } from '../src/online-session';
import { draftAfterSubmit, submitNote } from '../src/online-submit';
import { logScript, logWindow, mark, pass, snapshotScript } from './online-move-log-replay.support';
import {
  finishedAt,
  heldPost,
  othersTurnAt,
  posted,
  postStatus,
  postsOf,
  showingAt,
  GAME_PATH,
} from './online-turn-flow.support';
import { ALICE, GAME_ONE, GROUP_HASH, gameHash, makePagesHarness } from './online-web.support';
import {
  arrowAlong,
  clickArrow,
  draftOf,
  geometry,
  pendingOf,
  routePhaseOf,
  selectOpenField,
} from './ray-run-input.support';

const bootedOn = async (script: Parameters<typeof makePagesHarness>[0]) => {
  const h = makePagesHarness(script);
  await h.adapter.boot();
  h.adapter.noteDisplayed(4);
  return h;
};

describe('Each guard has its own reason (D1)', () => {
  it('An empty move list is no-moves', async () => {
    const h = await showingAt(4, [posted(5)]);
    expect(await h.adapter.submitMoves([])).toBe('no-moves');
    expect(postsOf(h)).toBe(0);
  });

  it('A submit in flight is sending', async () => {
    const held = heldPost();
    const h = await showingAt(4, [held.script, snapshotScript(5), logScript(logWindow(4, 5, [pass()]))]);
    const first = h.adapter.submitMoves([pass()]);
    const second = await h.adapter.submitMoves([pass()]);
    held.answer(5);
    await first;
    expect(second).toBe('sending');
    expect(postsOf(h)).toBe(1);
  });

  it('A submit held for the next sign-in is held', async () => {
    const h = await showingAt(4, [postStatus(401), posted(5)]);
    expect(await h.adapter.submitMoves([pass()])).toBe('unauthorized');
    expect(await h.adapter.submitMoves([pass()])).toBe('held');
    expect(postsOf(h)).toBe(1);
  });

  it('A queued replay batch is replaying', async () => {
    const h = await showingAt(4, [snapshotScript(5), logScript(logWindow(4, 5, [mark('b1')])), posted(6)]);
    await h.adapter.receiveStateChanged({
      type: 'stateChanged',
      version: 5,
      groupHash: GROUP_HASH,
      gameNumber: GAME_ONE,
    });
    expect(await h.adapter.submitMoves([pass()])).toBe('replaying');
    expect(postsOf(h)).toBe(0);
  });

  it('A finished game is game-over', async () => {
    const h = await bootedOn({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: [finishedAt(4), posted(5)],
    });
    expect(await h.adapter.submitMoves([pass()])).toBe('game-over');
    expect(postsOf(h)).toBe(0);
  });

  it('Another seat’s turn is not-your-turn', async () => {
    const h = await bootedOn({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: [othersTurnAt(4), posted(5)],
    });
    expect(await h.adapter.submitMoves([pass()])).toBe('not-your-turn');
    expect(postsOf(h)).toBe(0);
  });

  it('Leaving the game route is no-game', async () => {
    const h = await showingAt(4, [posted(5)]);
    (h.location as { hash: string }).hash = '';
    expect(await h.adapter.submitMoves([pass()])).toBe('no-game');
    expect(postsOf(h)).toBe(0);
  });

  it('A game route whose board never loaded is no-game', async () => {
    const h = makePagesHarness({
      hash: gameHash(GROUP_HASH, GAME_ONE),
      sessionToken: ALICE.bearer,
      fetchScript: [{ method: 'GET', path: GAME_PATH, status: 500, body: { error: 'down' } }, posted(5)],
    });
    await h.adapter.boot();
    expect(h.adapter.board()).toBeUndefined();
    expect(await h.adapter.submitMoves([pass()])).toBe('no-game');
    expect(postsOf(h)).toBe(0);
  });

  it('No session token is signed-out', async () => {
    const h = await showingAt(4, [posted(5)]);
    h.session.removeItem(GOOGLE_ID_TOKEN_SESSION_KEY);
    expect(await h.adapter.submitMoves([pass()])).toBe('signed-out');
    expect(postsOf(h)).toBe(0);
  });
});

describe('No outcome but sent is silent (D2)', () => {
  it('Every outcome other than sent has a note', () => {
    const silent = SUBMIT_OUTCOMES.filter((outcome) => submitNote(outcome) === undefined);
    expect(silent).toEqual(['sent']);
  });

  it('Every refusal is an outcome', () => {
    for (const reason of SUBMIT_REFUSALS) expect(SUBMIT_OUTCOMES).toContain(reason);
  });
});

describe('The route survives a refusal (D3)', () => {
  it('Every refusal keeps the draft', () => {
    for (const reason of SUBMIT_REFUSALS) expect(draftAfterSubmit(reason), reason).toBe('keep');
  });

  it('A refused Send restores the drawn route', () => {
    const selected = selectOpenField(4);
    const drafted = clickArrow(selected, arrowAlong(geometry, selected.from, 0, 1));
    const draft = [...draftOf(drafted)];
    const sent = selected.mode.send();
    expect(pendingOf(sent)).toEqual(draft);

    const restored = selected.mode.restoreSent();

    expect(draftOf(restored)).toEqual(draft);
    expect(routePhaseOf(restored).from).toBe(selected.from);
    expect(restored.pending).toBeUndefined();
    expect(restored.refusal).toBeUndefined();
    expect(restored.highlights).toBe(drafted.highlights);
  });
});
