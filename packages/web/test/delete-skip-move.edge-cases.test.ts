/**
 * docs/spec/delete-skip-move/delete-skip-move.edge-cases.feature — P51,
 * the client's log decoder and the two consumers that used to filter a skip.
 *
 * The persisted-log decoder is `parseLogWindow`: a window it cannot parse is
 * `undefined`, and `planFromWake` then installs a snapshot rather than applying
 * a prefix. That is the "refused, and no partial match" path.
 *
 * @see docs/spec/delete-skip-move/delete-skip-move.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { parseLogWindow, planFromWake } from '../src/online-replay';
import { hasLegalStep, passIfExhausted } from '../src/autoEndTurn';
import { movesForLlm } from '../src/byokBot';
import {
  arrow,
  codeOf,
  gameState,
  skipRecord,
  sourceOf,
  stubRules,
} from './delete-skip-move.support';

const FROM = arrow('a1');
const TO = arrow('a2');

const logBody = (moves: readonly unknown[]): unknown => ({
  from: 0,
  to: moves.length,
  gap: false,
  moves,
});

describe('A persisted skip is rejected, never translated', () => {
  it('A log containing a skip does not replay', () => {
    const raw = logBody([
      { kind: 'step', from: String(FROM), exit: String(TO), count: 1 },
      skipRecord(String(TO)),
      { kind: 'endTurn' },
    ]);

    const window = parseLogWindow(raw);

    expect(window).toBeUndefined();
    // And the entries before the skip are not applied as a partial match: with no
    // usable window the client installs the snapshot instead of replaying a prefix.
    const plan = planFromWake({ baseline: 0, to: 3, window });
    expect(plan.kind).toBe('install');
  });
});

describe('Consumers that filtered skip are unaffected', () => {
  it('Auto-pass still triggers only on the absence of a step', () => {
    const state = gameState();
    const rules = stubRules([endTurn()]);

    expect(hasLegalStep(rules, state)).toBe(false);
    expect(passIfExhausted(rules, state).moves).toEqual([endTurn()]);

    const withStep = stubRules([step(FROM, TO, 1), endTurn()]);
    expect(hasLegalStep(withStep, state)).toBe(true);
    expect(passIfExhausted(withStep, state).moves).toEqual([]);
  });

  it('A bots offered moves are unchanged', () => {
    const offer: readonly Move[] = [step(FROM, TO, 1), endTurn()];

    // Same moves as before the packet, because the bot never saw a skip: it
    // filtered them out itself. With no skip to filter, the offer passes through.
    expect(movesForLlm(offer)).toEqual(offer);
    expect(codeOf(sourceOf('byokBot.ts'))).not.toContain('skip');
  });
});
