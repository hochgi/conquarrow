/**
 * P47 replay — a cut that arrives along one fork arm evaporates the sibling.
 *
 * Authored initial state plus the cutting step. The far fragment's firebreak
 * (stem garrison) remains; Y is gone.
 *
 * @see docs/spec/cuts/cuts.md
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { replay, replayIsDeterministic } from '../src/replay';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  aForkArmCut,
  headsOn,
  isTrail,
  onBoard,
  snapshot,
  stateOf,
  trailOf,
  via,
} from './support';

describe('P47 replay — sibling-arm cut on a fixture', () => {
  it('replays one interleave at the far end of arm X to a trail whose only remnant is the stem firebreak', () => {
    const table = onBoard();
    const { stem, armX, armY, trailOut, cutterIn, interleavingExit } = aForkArmCut(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const initial = stateOf(
      [
        { arrow: cutterIn, owner: A, heads: 1 },
        { arrow: stem, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [cutterIn], B: [stem, armX, armY, trailOut] },
      },
    );
    expect(table.rules.crossesTrail(initial, via(cutterIn, interleavingExit), B)).toBe(true);
    const moves: readonly Move[] = [step(cutterIn, interleavingExit, 1)];

    const final = replay(table.rules, initial, moves);

    expect(isTrail(final, B, armX)).toBe(false);
    expect(isTrail(final, B, armY)).toBe(false);
    expect(isTrail(final, B, trailOut)).toBe(false);
    expect(isTrail(final, B, stem)).toBe(true);
    expect(headsOn(final, stem)).toBe(1);
    expect(trailOf(final, B)).toEqual([String(stem)]);
    expect(snapshot(replay(table.rules, initial, moves))).toEqual(snapshot(final));
    expect(replayIsDeterministic(table.rules, initial, moves, snapshot)).toBe(true);
  });
});
