/**
 * The loop of doom: a heuristic seat walks a short ring of its own trail turn
 * after turn instead of driving the stack home, although home is within one
 * turn's reach (docs/design/backlog.md, "The loop of doom").
 *
 * The premise tests run today: the fixtures replay, the close home from the
 * ring is legal, in reach and claims land. The behaviour tests are skipped
 * until the fix lands; unskip them in that packet. Before the fix they fail
 * for the reason they name: the land stays flat while the stack walks the
 * ring.
 *
 * What these tests do not demand: that the stack ends a turn off the ring, or
 * on another arrow. Ending where it started is incidental (a ×2 on the same
 * 3-arrow ring ends on a different arrow each turn and is just as stuck), so
 * the observable is the claim, not the position.
 */

import { describe, expect, it } from 'vitest';
import { chooseTurnBeam } from '../src/botSearch';
import {
  closeHomeFromRing,
  fold,
  landOf,
  landPerTurn,
  LOOP_FIXTURES,
  minimal,
  replayed,
  trailSizeOf,
  turnIntoRing,
} from './heuristic-loop-of-doom.support';

/** Seat turns a fixed seat gets to make its claim: the turn into the ring, then one to close. */
const TURNS = 3;

describe.each(LOOP_FIXTURES)('loop of doom $id ($log, seat $seat)', (f) => {
  it('premise: from the ring, the close home is legal, within one turn, and claims land', () => {
    for (const start of [replayed(f), minimal(f)]) {
      const intoRing = fold(start.state, turnIntoRing(f));
      const { before, after } = closeHomeFromRing(f, intoRing, start.me);
      expect(landOf(after, start.me)).toBeGreaterThan(landOf(before, start.me));
      expect(trailSizeOf(after, start.me)).toBe(0);
    }
  }, 60_000);

  it.skip('replayed position: the seat claims land within three of its turns', () => {
    const start = replayed(f);
    const land = landPerTurn(chooseTurnBeam, start, TURNS);
    expect(Math.max(...land)).toBeGreaterThan(landOf(start.state, start.me));
  }, 120_000);

  it.skip('minimal position: the seat claims land within three of its turns', () => {
    const start = minimal(f);
    const land = landPerTurn(chooseTurnBeam, start, TURNS);
    expect(Math.max(...land)).toBeGreaterThan(landOf(start.state, start.me));
  }, 120_000);
});
