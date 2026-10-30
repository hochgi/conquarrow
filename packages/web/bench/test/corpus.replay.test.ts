/**
 * P79 corpus: each committed log replays to its own `summary` line, and every
 * position is a turn start for the seat to move.
 */

import { describe, expect, it } from 'vitest';
import { CORPUS_NAMES, corpusLog, corpusPositions, replaySummary } from '../src/corpus';

describe('P79 corpus', () => {
  it('holds the two archived grok logs and the 2026-10-29 playtest log', () => {
    expect(CORPUS_NAMES).toEqual([
      'grok-2026-09-10T0657',
      'grok-2026-09-10T1442',
      'playtest-2026-10-29',
    ]);
  });

  for (const name of CORPUS_NAMES) {
    it(`Replaying ${name} reproduces its summary line`, () => {
      const log = corpusLog(name);
      expect(replaySummary(log)).toEqual(log.summary);
    });

    it(`A ${name} position is a state with the seat to move and no step yet taken this turn`, () => {
      const log = corpusLog(name);
      const positions = corpusPositions(log);
      expect(positions.length).toBeGreaterThan(0);
      for (const position of positions) {
        const { state, seat, moveIndex } = position;
        expect(state.winner).toBeUndefined();
        expect(state.activePlayer).toBe(seat);
        const previous = log.moves[moveIndex - 1];
        if (moveIndex > 0) expect(previous?.kind).toBe('endTurn');
        for (const group of state.groups.values()) {
          if (group.owner === seat) expect(group.spent).toBe(0);
        }
      }
      // Ordered, and the opening is the first position.
      const indices = positions.map((p) => p.moveIndex);
      expect(indices).toEqual(indices.toSorted((a, b) => a - b));
      expect(positions[0]?.moveIndex).toBe(0);
    });
  }
});
