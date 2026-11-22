/**
 * P100 edge cases — the first failing guard wins, `illegal` is one sentence,
 * and a restore never clobbers what the player did since.
 *
 * @see docs/spec/send-refusal/send-refusal.edge-cases.feature
 */

import type { SubmitOutcome } from '@conquarrow/contracts';
import { describe, expect, it } from 'vitest';
import { submitRefusal } from '../src/online-pages';
import { draftAfterSubmit, submitNote } from '../src/online-submit';
import { mark, snapshotScript } from './online-move-log-replay.support';
import { hostShowingAt, postStatus } from './online-turn-flow.support';
import {
  arrowAlong,
  clickArrow,
  geometry,
  pendingOf,
  selectOpenField,
} from './ray-run-input.support';
import { failing, passing } from './send-refusal.support';

describe('The first failing guard wins (D1)', () => {
  it('Online not configured outranks everything', () => {
    expect(submitRefusal(failing())).toBe('not-ready');
  });

  it('A finished game outranks another seat’s turn', () => {
    expect(submitRefusal({ ...passing(), gameOver: true, callerToMove: false })).toBe('game-over');
  });

  it('In flight outranks held', () => {
    expect(submitRefusal({ ...passing(), submitting: true, held: true })).toBe('sending');
  });

  it('Every guard passing is no reason', () => {
    expect(submitRefusal(passing())).toBeUndefined();
  });
});

describe('illegal shows one sentence (D2)', () => {
  it('The host’s 422 note is the illegal sentence', async () => {
    const h = await hostShowingAt(4, [postStatus(422), snapshotScript(4)]);
    expect(await h.host.submitMoves([mark('s1')])).toBe('illegal');
    expect(h.host.illegal()).toBe(submitNote('illegal'));
    expect(submitNote('illegal')).not.toBe('illegal');
  });
});

describe('What reached the server clears the route (D3)', () => {
  it.each<SubmitOutcome>(['sent', 'illegal', 'stale', 'forbidden', 'failed', 'unauthorized'])(
    'An outcome that reached the server clears (%s)',
    (outcome) => {
      expect(draftAfterSubmit(outcome)).toBe('clear');
    },
  );

  const sentRoute = () => {
    const selected = selectOpenField(4);
    clickArrow(selected, arrowAlong(geometry, selected.from, 0, 1));
    selected.mode.send();
    return selected;
  };

  it('A restore after the player moved on does nothing', () => {
    const selected = sentRoute();
    selected.mode.onBackgroundClick();
    const restored = selected.mode.restoreSent();
    expect(restored.phase.kind).toBe('idle');
    expect(pendingOf(restored)).toEqual([]);
  });

  it('A restore is one-shot', () => {
    const selected = sentRoute();
    expect(selected.mode.restoreSent().phase.kind).toBe('route');
    expect(selected.mode.restoreSent().phase.kind).toBe('idle');
  });

  it('A cancel after a restore is not undone by another restore', () => {
    const selected = sentRoute();
    selected.mode.restoreSent();
    selected.mode.cancel();
    expect(selected.mode.restoreSent().phase.kind).toBe('idle');
  });

  it('End turn has nothing to restore', () => {
    const selected = selectOpenField(4);
    selected.mode.requestEndTurn();
    const restored = selected.mode.restoreSent();
    expect(restored.phase.kind).toBe('idle');
    expect(pendingOf(restored)).toEqual([]);
  });

  it('End turn after a sent route does not bring the route back', () => {
    const selected = sentRoute();
    selected.mode.requestEndTurn();
    const restored = selected.mode.restoreSent();
    expect(restored.phase.kind).toBe('idle');
    expect(pendingOf(restored)).toEqual([]);
  });
});
