/**
 * docs/spec/send-self-heal/send-self-heal.core.feature — the pure decisions
 * behind each scenario. The wire is in send-self-heal.scenarios.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { afterRecheck, healedOutcome, heldPlan, replayStalled } from '../src/online-heal';
import { draftAfterSubmit, submitNote } from '../src/online-submit';
import { appSource, codeOf } from './board-selection-model.support';

const HELD = { groupHash: 'g', gameNumber: 'n', version: 4, userHash: 'alice' } as const;
const ROUTE = { groupHash: 'g', gameNumber: 'n' } as const;

describe('A stuck Send heals itself', () => {
  describe('A held submit is sent when the session is valid and the board has not moved', () => {
    it('A Send finds a hold at the same version', () => {
      expect(heldPlan({ held: HELD, route: ROUTE, meOk: true, me: 'alice', boardVersion: 4 })).toBe('send');
      expect(healedOutcome('sent')).toBe('held-sent');
      expect(submitNote('held-sent')).toBeDefined();
      expect(draftAfterSubmit('held-sent')).toBe('clear');
    });

    it('A hold whose board moved on is dropped and says so', () => {
      expect(heldPlan({ held: HELD, route: ROUTE, meOk: true, me: 'alice', boardVersion: 6 })).toBe(
        'drop-stale',
      );
      expect(submitNote('held-dropped')).toBeDefined();
      expect(draftAfterSubmit('held-dropped')).toBe('clear');
    });
  });

  describe('A stalled replay cannot block Send forever', () => {
    it('A batch that never finished is flushed after the stall timeout', () => {
      expect(replayStalled({ pending: true, progressAt: 0, now: 20_000, stallMs: 20_000 })).toBe(true);
    });
  });

  describe('not-your-turn is checked once more before it is final', () => {
    it('The re-check finds the caller to move', () => {
      expect(afterRecheck({ refusal: undefined, before: 4, after: 4 })).toBeUndefined();
    });
  });
});

describe('App shows a heal that happened outside a Send (source scan — no DOM harness)', () => {
  it('reads takeHealOutcome and shows its note', () => {
    expect(codeOf(appSource())).toMatch(/takeHealOutcome\(\)/);
  });
});
