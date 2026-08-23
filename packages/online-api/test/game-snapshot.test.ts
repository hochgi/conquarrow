/**
 * Hydrating a **pre-P36** persisted snapshot (P36).
 *
 * P36 retired `dominationHolder` / `dominationStreak` for the per-seat
 * `starvationStreaks` map. Absence of the new field is legitimate — "absent means
 * zero" is its own semantics — but a save written *before* P36 is not silent: it
 * carries the retired pair, and reading neither field would reload a seat at 4 of
 * 5 as 0 of 5, handing it a free reprieve of up to `dominationN` rounds. That is a
 * match outcome changed by omission, so the clock is seeded from the pair.
 *
 * The envelope's `version` cannot gate this: `game-handlers.ts` uses it as the
 * optimistic-concurrency revision, so any version may carry either shape.
 *
 * @see docs/spec/losing-conditions/losing-conditions.md
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '@conquarrow/contracts';
import { hydrateState, parsePersistedEnvelope } from '../src/game-snapshot';
import type { StateSnapshot } from './support';
import { openingMatch, snapshotState } from './support';

/** The record a pre-P36 writer produced: no `starvationStreaks`, plus `extra`. */
const preP36 = (extra: Record<string, unknown>): Record<string, unknown> => {
  const snap: StateSnapshot = snapshotState(openingMatch(3));
  const rec: Record<string, unknown> = { ...snap };
  delete rec['starvationStreaks'];
  return { ...rec, ...extra };
};

const seatName = (index: number): string => {
  const seat = openingMatch(3).players[index];
  if (seat === undefined) throw new Error('setup: expected three seats');
  return String(seat);
};

const clockOf = (state: GameState): readonly (readonly [string, number])[] =>
  [...state.starvationStreaks.entries()]
    .map(([player, streak]) => [String(player), streak] as const)
    .toSorted((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));

const hydrated = (rec: Record<string, unknown>): GameState => {
  const state = hydrateState(rec);
  if (state === undefined) throw new Error('setup: the snapshot did not hydrate');
  return state;
};

describe('pre-P36 starvation clock', () => {
  it('seeds the clock from a mid-flight dominationHolder and dominationStreak', () => {
    const holder = seatName(1);

    const state = hydrated(preP36({ dominationHolder: holder, dominationStreak: 4 }));

    expect(clockOf(state)).toEqual([[holder, 4]]);
  });

  it('seeds through the envelope, whatever the concurrency revision says', () => {
    const holder = seatName(0);
    const raw = JSON.stringify({
      version: 12,
      state: preP36({ dominationHolder: holder, dominationStreak: 1 }),
    });

    const parsed = parsePersistedEnvelope(raw);

    expect(parsed?.version).toBe(12);
    expect(parsed === undefined ? undefined : clockOf(parsed.game)).toEqual([[holder, 1]]);
  });

  it('accepts a genuinely absent clock as empty', () => {
    const state = hydrated(preP36({}));

    expect(clockOf(state)).toEqual([]);
  });

  it('seeds nothing from a holder whose streak had not started', () => {
    const state = hydrated(preP36({ dominationHolder: seatName(2), dominationStreak: 0 }));

    expect(clockOf(state)).toEqual([]);
  });

  it('seeds nothing from a streak with no holder', () => {
    const state = hydrated(preP36({ dominationStreak: 3 }));

    expect(clockOf(state)).toEqual([]);
  });

  it('prefers an explicit starvationStreaks to the retired pair', () => {
    const kept = seatName(2);

    const state = hydrated({
      ...preP36({ dominationHolder: seatName(0), dominationStreak: 4 }),
      starvationStreaks: [{ player: kept, streak: 2 }],
    });

    expect(clockOf(state)).toEqual([[kept, 2]]);
  });

  it('still rejects a starvationStreaks that is present and malformed', () => {
    expect(hydrateState(preP36({ starvationStreaks: [{ player: 7, streak: 'four' }] }))).toBe(
      undefined,
    );
  });
});
