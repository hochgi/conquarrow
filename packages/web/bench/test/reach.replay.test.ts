/**
 * P78 over the committed corpus: the playtest log reproduces its printed line,
 * and every apply in every log is fully explained — heads that left the board
 * are exactly combat + evaporation + vanished, less births (encirclement moves
 * heads between seats, so it nets to zero).
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { rules } from '../src/board';
import { CORPUS_NAMES, corpusLog } from '../src/corpus';
import { CLOSURE_KINDS, readStep, scoreMatch } from '../src/reach';

const boardHeads = (state: GameState): number => {
  let n = 0;
  for (const group of state.groups.values()) n += group.heads;
  return n;
};

describe('P78 reach — the corpus', () => {
  it('Replaying the 2026-10-29 log reproduces its printed summary line exactly (605 / 62 / 7)', () => {
    const log = corpusLog('playtest-2026-10-29');
    const report = scoreMatch(rules, log.config, log.moves);

    expect([report.summary.steps, report.summary.closes, report.summary.cuts]).toEqual([605, 62, 7]);
    expect(report.summary).toEqual(log.summary);
  });

  for (const name of CORPUS_NAMES) {
    it(`Every apply in ${name} is explained, and closures by kind sum to its closes`, () => {
      const log = corpusLog(name);
      let state = makeMatch(log.config);
      for (const move of log.moves) {
        const after = rules.apply(state, move);
        const r = readStep(rules, state, move, after);
        expect(boardHeads(state) - boardHeads(after) + r.births).toBe(
          r.losses.combat + r.losses.evaporation + r.losses.vanished,
        );
        state = after;
      }
      const report = scoreMatch(rules, log.config, log.moves);
      expect(CLOSURE_KINDS.reduce((n, kind) => n + report.closures[kind], 0)).toBe(report.summary.closes);
      expect(scoreMatch(rules, log.config, log.moves)).toEqual(report);
    });
  }
});
