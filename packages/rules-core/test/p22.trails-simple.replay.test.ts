/**
 * P42 replay — a stack-grade landing paints the full against-grain walk,
 * including the sentry and distal tail, identically on a second fold
 * (P10 / ADR 0001).
 *
 * @see docs/spec/trails-simple/trails-simple.md
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { replay, replayIsDeterministic } from '../src/replay';
import {
  A,
  aRunFromHome,
  anExitFrom,
  arrowAt,
  headsOn,
  isTrail,
  onTiling,
  owned,
  pick,
  snapshot,
  stateOf,
  territoryOf,
} from './support';

describe('P42 replay — stack-grade landing paints the full walk', () => {
  it('replays one closing step to territory through the sentry and the distal tail', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 4);
    const fire = arrowAt(run, 0);
    const mid = arrowAt(run, 1);
    const tip = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, tip);
    const distal = pick(
      table.geometry.inArrows(table.geometry.origin(fire)).filter((a) => a !== home && a !== fire),
      0,
    );
    const initial = stateOf(
      [
        { arrow: fire, owner: A, heads: 1 },
        { arrow: tip, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { A: [fire, mid, tip, distal] },
        territory: owned([landing], A),
      },
    );
    const moves: readonly Move[] = [step(tip, landing, 1)];

    expect(() => replay(table.rules, initial, moves)).not.toThrow();
    const final = replay(table.rules, initial, moves);

    expect(territoryOf(final, tip)).toBe(A);
    expect(territoryOf(final, mid)).toBe(A);
    expect(territoryOf(final, fire), 'firebreak sentry').toBe(A);
    expect(territoryOf(final, distal), 'distal beyond fire').toBe(A);
    expect(isTrail(final, A, fire)).toBe(false);
    expect(isTrail(final, A, distal)).toBe(false);
    expect(headsOn(final, fire)).toBe(1);
    expect(headsOn(final, landing)).toBe(1);

    expect(snapshot(replay(table.rules, initial, moves))).toEqual(snapshot(final));
    expect(replayIsDeterministic(table.rules, initial, moves, snapshot)).toBe(true);
  });
});
