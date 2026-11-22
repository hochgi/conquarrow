/**
 * P94 core — the client's own move plays out like a wake.
 *
 * @see docs/spec/online-turn-flow/online-turn-flow.core.feature
 * @see docs/spec/online-turn-flow/SCENARIOS.md
 */

import { describe, expect, it } from 'vitest';
import { turnControlsLocked } from '../src/botPause';
import { endTurnLabel } from '../src/online-submit';
import {
  batch,
  logScript,
  logWindow,
  mark,
  pass,
  sincesRequested,
  snapshotScript,
} from './online-move-log-replay.support';
import {
  heldPost,
  ifMatches,
  posted,
  postsOf,
  queued,
  showingAt,
} from './online-turn-flow.support';
import { quotedVersion } from './online-web.support';

describe('A submit replays from the displayed baseline', () => {
  it('End turn replays A’s move and the burst', async () => {
    const burst = [pass(), mark('c1'), pass(), mark('b1'), pass()];
    const h = await showingAt(4, [
      posted(5),
      snapshotScript(5),
      logScript(logWindow(4, 5, burst)),
    ]);

    const outcome = await h.adapter.submitMoves([pass()]);

    expect(outcome).toBe('sent');
    expect(sincesRequested(h)).toEqual(['4']);
    expect(queued(h)).toEqual([batch(4, 5, burst)]);
  });

  it('A route of several steps is one submit and one replay window', async () => {
    const steps = [mark('s1'), mark('s2'), mark('s3')];
    const h = await showingAt(4, [
      posted(5),
      posted(6),
      posted(7),
      snapshotScript(7),
      logScript(logWindow(4, 7, steps)),
    ]);

    const outcome = await h.adapter.submitMoves(steps);

    expect(outcome).toBe('sent');
    expect(ifMatches(h)).toEqual([quotedVersion(4), quotedVersion(5), quotedVersion(6)]);
    expect(queued(h)).toEqual([batch(4, 7, steps)]);
  });
});

describe('A submit is visibly in flight', () => {
  it('A submit is pending until it settles', async () => {
    const held = heldPost();
    const h = await showingAt(4, [
      held.script,
      snapshotScript(5),
      logScript(logWindow(4, 5, [pass()])),
    ]);

    const pending = h.adapter.submitMoves([pass()]);
    expect(h.adapter.submitPending()).toBe(true);
    held.answer(5);
    await pending;

    expect(h.adapter.submitPending()).toBe(false);
  });

  it('A second submit while one is in flight is refused', async () => {
    const held = heldPost();
    const h = await showingAt(4, [
      held.script,
      snapshotScript(5),
      logScript(logWindow(4, 5, [pass()])),
    ]);

    const first = h.adapter.submitMoves([pass()]);
    const second = await h.adapter.submitMoves([pass()]);
    held.answer(5);
    await first;

    expect(second).toBe('sending');
    expect(postsOf(h)).toBe(1);
  });

  it.each([
    { submitting: false, replaying: false, locked: false },
    { submitting: true, replaying: false, locked: true },
    { submitting: false, replaying: true, locked: true },
    { submitting: true, replaying: true, locked: true },
  ])(
    'Turn controls lock while sending or replaying (submitting $submitting, replaying $replaying)',
    ({ submitting, replaying, locked }) => {
      expect(
        turnControlsLocked({ matchOver: false, botBusy: false, aiChair: false, submitting, replaying }),
      ).toBe(locked);
    },
  );

  it('End turn shows that it is sending', () => {
    expect(endTurnLabel(true)).toBe('Sending…');
    expect(endTurnLabel(false)).toBe('End turn');
  });
});
