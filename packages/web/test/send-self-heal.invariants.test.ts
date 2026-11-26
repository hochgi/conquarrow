/**
 * EARS invariants 10 (pure) for docs/spec/send-self-heal/send-self-heal.md.
 * The wire invariants (1–9) are the scenarios suite.
 */

import { SUBMIT_OUTCOMES, SUBMIT_REFUSALS } from '@conquarrow/contracts';
import { describe, expect, it } from 'vitest';
import { afterRecheck, heldPlan, replayStalled } from '../src/online-heal';
import { draftAfterSubmit, submitNote } from '../src/online-submit';

const BOOLS = [false, true] as const;
const VERSIONS = [undefined, 3, 4, 5] as const;
const USERS = [undefined, 'alice', 'bob'] as const;


describe('send-self-heal invariants', () => {
  it('heldPlan sends only on a valid session, the held game and the held version', () => {
    for (const meOk of BOOLS) {
      for (const me of USERS) {
        for (const holder of USERS) {
          for (const onHeldGame of BOOLS) {
            for (const boardVersion of VERSIONS) {
              const held = { groupHash: 'g', gameNumber: 'n', version: 4, ...(holder === undefined ? {} : { userHash: holder }) };
              const plan = heldPlan({ held, onHeldGame, meOk, me, boardVersion });
              const sameGame = onHeldGame;
              const sameUser = me === undefined || holder === undefined || me === holder;
              const expected = !meOk
                ? 'wait'
                : !sameGame
                  ? 'drop-other'
                  : !sameUser
                    ? 'drop-stale'
                    : boardVersion === undefined
                      ? 'wait'
                      : boardVersion === 4
                        ? 'send'
                        : 'drop-stale';
              expect(plan, JSON.stringify({ meOk, me, holder, onHeldGame, boardVersion })).toBe(expected);
            }
          }
        }
      }
    }
  });

  it('replayStalled is pending and stamped and old enough', () => {
    for (const pending of BOOLS) {
      for (const progressAt of [undefined, 0, 1_000]) {
        for (const now of [0, 999, 1_000, 20_999, 21_000, 50_000]) {
          const got = replayStalled({ pending, progressAt, now, stallMs: 20_000 });
          expect(got).toBe(pending && progressAt !== undefined && now - progressAt >= 20_000);
        }
      }
    }
  });

  it('afterRecheck: a refusal stays, else same version sends, else stale', () => {
    for (const refusal of [undefined, ...SUBMIT_REFUSALS]) {
      for (const before of VERSIONS) {
        for (const after of VERSIONS) {
          const got = afterRecheck({ refusal, before, after });
          expect(got).toBe(refusal ?? (before === after ? undefined : 'stale'));
        }
      }
    }
  });

  it('every outcome but sent has a note, and the heal outcomes clear the route', () => {
    for (const outcome of SUBMIT_OUTCOMES) {
      expect(submitNote(outcome) === undefined, outcome).toBe(outcome === 'sent');
    }
    expect(SUBMIT_OUTCOMES).toContain('held-sent');
    expect(SUBMIT_OUTCOMES).toContain('held-dropped');
    expect((SUBMIT_REFUSALS as readonly string[]).includes('held-sent')).toBe(false);
    expect(draftAfterSubmit('held-sent')).toBe('clear');
  });
});
