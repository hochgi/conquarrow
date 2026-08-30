/**
 * docs/spec/delete-skip-move/delete-skip-move.core.feature — P51, adapter side.
 *
 * "A match log records no skip". The counter and the rendered `n skips` clause
 * are the log's only expression of the kind, and after this packet neither
 * exists — the line was already unreachable once P50 stopped producing skips.
 *
 * @see docs/spec/delete-skip-move/delete-skip-move.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import {
  appendMoves,
  emptyMatchSummary,
  foldMatchSummary,
  formatMatchSummary,
} from '../src/matchLog';
import { arrow, codeOf, gameState, newLog, sourceOf } from './delete-skip-move.support';

const FROM = arrow('a1');
const TO = arrow('a2');
const ONWARD = arrow('a3');

describe('A match log records no skip', () => {
  it('A turn of steps logs only steps and the end turn', () => {
    const moves: readonly Move[] = [step(FROM, TO, 1), step(TO, ONWARD, 1), endTurn()];

    const log = appendMoves(newLog(), moves);
    const summary = foldMatchSummary(
      emptyMatchSummary(),
      moves,
      gameState(),
      gameState(),
      0,
    );

    expect(log.moves).toEqual(moves);
    expect(log.moves.filter((m) => (m.kind as string) === 'skip')).toEqual([]);
    expect(summary.steps).toBe(2);
    expect(summary.endTurns).toBe(1);
    // The log has no notion of a skip at all: no counter, no rendered clause.
    expect(Object.keys(emptyMatchSummary())).not.toContain('skips');
    expect(formatMatchSummary(summary)).not.toContain('skip');
    expect(codeOf(sourceOf('matchLog.ts'))).not.toContain('skip');
  });
});
