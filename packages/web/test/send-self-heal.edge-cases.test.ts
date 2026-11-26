/**
 * docs/spec/send-self-heal/send-self-heal.edge-cases.feature — pure side.
 */

import { describe, expect, it } from 'vitest';
import { afterRecheck, healedOutcome, heldPlan, REPLAY_STALL_MS, replayStalled } from '../src/online-heal';

const HELD = { groupHash: 'g', gameNumber: 'n', version: 4, userHash: 'alice' } as const;

describe('Edge cases of the Send self-heal', () => {
  describe('A hold heals only on a valid session', () => {
    it('/me not ok waits, whatever else is true', () => {
      expect(heldPlan({ held: HELD, onHeldGame: true, meOk: false, me: 'alice', boardVersion: 4 })).toBe('wait');
      expect(heldPlan({ held: HELD, onHeldGame: false, meOk: false, me: undefined, boardVersion: undefined })).toBe(
        'wait',
      );
    });

    it('/me for another user drops the hold', () => {
      expect(heldPlan({ held: HELD, onHeldGame: true, meOk: true, me: 'bob', boardVersion: 4 })).toBe('drop-stale');
    });

    it('an unknown user on either side does not drop', () => {
      expect(heldPlan({ held: HELD, onHeldGame: true, meOk: true, me: undefined, boardVersion: 4 })).toBe('send');
      const anonymous = { groupHash: 'g', gameNumber: 'n', version: 4 } as const;
      expect(heldPlan({ held: anonymous, onHeldGame: true, meOk: true, me: 'bob', boardVersion: 4 })).toBe('send');
    });

    it('another game, or no game route, drops silently', () => {
      expect(
        heldPlan({ held: HELD, onHeldGame: false, meOk: true, me: 'alice', boardVersion: 4 }),
      ).toBe('drop-other');
      expect(
        heldPlan({ held: HELD, onHeldGame: false, meOk: true, me: 'alice', boardVersion: 4 }),
      ).toBe('drop-other');
      expect(heldPlan({ held: HELD, onHeldGame: false, meOk: true, me: 'alice', boardVersion: 4 })).toBe('drop-other');
    });

    it('no board yet waits', () => {
      expect(heldPlan({ held: HELD, onHeldGame: true, meOk: true, me: 'alice', boardVersion: undefined })).toBe('wait');
    });

    it('a board behind the hold is not the hold either', () => {
      expect(heldPlan({ held: HELD, onHeldGame: true, meOk: true, me: 'alice', boardVersion: 3 })).toBe('drop-stale');
    });

    it('The held POST’s own outcome passes through unless it is sent', () => {
      for (const o of ['unauthorized', 'stale', 'illegal', 'failed', 'forbidden'] as const) {
        expect(healedOutcome(o)).toBe(o);
      }
    });
  });

  describe('The watchdog waits for a real stall', () => {
    it('A batch within the stall timeout is not stalled', () => {
      expect(replayStalled({ pending: true, progressAt: 0, now: REPLAY_STALL_MS - 1, stallMs: REPLAY_STALL_MS })).toBe(
        false,
      );
    });

    it('Nothing pending is never stalled', () => {
      expect(replayStalled({ pending: false, progressAt: 0, now: 10 * REPLAY_STALL_MS, stallMs: REPLAY_STALL_MS })).toBe(
        false,
      );
    });

    it('No progress stamp is never stalled', () => {
      expect(
        replayStalled({ pending: true, progressAt: undefined, now: 10 * REPLAY_STALL_MS, stallMs: REPLAY_STALL_MS }),
      ).toBe(false);
    });

    it('The stall timeout is configurable', () => {
      expect(replayStalled({ pending: true, progressAt: 100, now: 5_100, stallMs: 5_000 })).toBe(true);
      expect(replayStalled({ pending: true, progressAt: 100, now: 5_099, stallMs: 5_000 })).toBe(false);
    });

    it('The default is a named config value', () => {
      expect(REPLAY_STALL_MS).toBe(20_000);
    });
  });

  describe('The not-your-turn re-check', () => {
    it('A newer version after the re-check answers stale', () => {
      expect(afterRecheck({ refusal: undefined, before: 4, after: 5 })).toBe('stale');
      expect(afterRecheck({ refusal: undefined, before: 4, after: undefined })).toBe('stale');
    });

    it('A refusal after the re-check is final', () => {
      expect(afterRecheck({ refusal: 'not-your-turn', before: 4, after: 4 })).toBe('not-your-turn');
      expect(afterRecheck({ refusal: 'game-over', before: 4, after: 5 })).toBe('game-over');
    });
  });
});
