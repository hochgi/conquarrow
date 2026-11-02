/**
 * P82 — the 3-player grid behind `--players 3` (matches tier only). The
 * 2-player grid keeps P79's ids and configs byte-for-byte, so every earlier
 * result file stays comparable.
 */

import { describe, expect, it } from 'vitest';
import { cellConfig, gridCells, matchConfigFor, seatIndexOf } from '../src/grid';
import { parseOptions } from '../src/cli';
import { runMatch } from '../src/match';
import { createByokSeat } from '../src/seat';
import { access, fastRetry, firstRowModel } from './harness.support';

describe('P82 players — the grid', () => {
  it('the 2-player grid is P79 unchanged: 6 cells, no config override', () => {
    const cells = gridCells();
    expect(cells.map((c) => c.id)).toEqual([
      's1-first',
      's1-second',
      's2-first',
      's2-second',
      's3-first',
      's3-second',
    ]);
    expect(cells.every((c) => c.config === undefined)).toBe(true);
    expect(gridCells(2)).toEqual(cells);
  });

  it('the 3-player grid is 3 seeds × 3 seats, prefixed p3-, on the playtest config with playerCount 3', () => {
    const cells = gridCells(3);
    expect(cells).toHaveLength(9);
    expect(cells.map((c) => c.id).slice(0, 3)).toEqual(['p3-s1-first', 'p3-s1-second', 'p3-s1-third']);
    for (const c of cells) expect(cellConfig(c)).toEqual(matchConfigFor(c.seed, 3));
    expect(matchConfigFor(1, 3).playerCount).toBe(3);
  });

  it('seats the BYOK chair by turn order', () => {
    expect([seatIndexOf('first'), seatIndexOf('second'), seatIndexOf('third')]).toEqual([0, 1, 2]);
  });

  it('a 3-player match puts the chair in the third seat', async () => {
    const third = gridCells(3).find((c) => c.id === 'p3-s1-third');
    if (third === undefined) throw new Error('no p3-s1-third cell');
    const seat = createByokSeat(access, 'reasoning', firstRowModel().fetch, fastRetry);
    const record = await runMatch({ cell: third, cap: 1, chair: seat });
    expect(record.players).toHaveLength(3);
    expect(record.byokPlayer).toBe(record.players[2]);
  });
});

describe('P82 players — the flag', () => {
  it('defaults to 2 and accepts 3 for matches', () => {
    expect(parseOptions(['matches']).players).toBe(2);
    expect(parseOptions(['matches', '--players', '3']).players).toBe(3);
  });

  it('refuses any other count, and 3 players outside the matches tier', () => {
    expect(() => parseOptions(['matches', '--players', '4'])).toThrow(/--players must be one of 2, 3/);
    expect(() => parseOptions(['mirror', '--players', '3'])).toThrow(/matches tier only/);
  });
});
