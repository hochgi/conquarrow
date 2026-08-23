/**
 * Hydrating a **pre-P36** GET `/games/…` snapshot (P36).
 *
 * P36 retired `dominationHolder` / `dominationStreak` for the per-seat
 * `starvationStreaks` map. Absence of the new field is legitimate — "absent means
 * zero" is its own semantics — but a snapshot written *before* P36 is not silent:
 * it carries the retired pair, and reading neither field would reload a seat at 4
 * of 5 as 0 of 5, handing it a free reprieve of up to `dominationN` rounds. That
 * is a match outcome changed by omission, so the clock is seeded from the pair.
 *
 * `online-hydrate.ts` is a deliberate copy of `packages/online-api`'s hydrator so
 * web never imports that package, which is why the same scenarios are asserted in
 * both places rather than shared.
 *
 * @see docs/spec/losing-conditions/losing-conditions.md
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '@conquarrow/contracts';
import { hydrateState } from '../src/online-hydrate';

/** The wire record a pre-P36 writer produced: no `starvationStreaks`, plus `extra`. */
const preP36 = (extra: Record<string, unknown>): Record<string, unknown> => ({
  players: ['A', 'B', 'C'],
  activePlayer: 'A',
  groups: [{ arrow: 'a0', owner: 'A', heads: 1, spent: 0 }],
  trails: [{ player: 'A', arrows: ['a0'] }],
  territory: [{ arrow: 'a1', owner: 'A' }],
  accumulators: [{ arrow: 'a1', num: 1, den: 6 }],
  spawners: [{ vertex: 'v0', num: 1, den: 9, phase: 0 }],
  dominationN: 5,
  ...extra,
});

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
    const state = hydrated(preP36({ dominationHolder: 'B', dominationStreak: 4 }));

    expect(clockOf(state)).toEqual([['B', 4]]);
    // The rest of the board still hydrates as it did.
    expect(state.dominationN).toBe(5);
    expect([...state.territory.keys()].map(String)).toEqual(['a1']);
  });

  it('accepts a genuinely absent clock as empty', () => {
    expect(clockOf(hydrated(preP36({})))).toEqual([]);
  });

  it('seeds nothing from a holder whose streak had not started', () => {
    expect(clockOf(hydrated(preP36({ dominationHolder: 'B', dominationStreak: 0 })))).toEqual([]);
  });

  it('seeds nothing from a streak with no holder', () => {
    expect(clockOf(hydrated(preP36({ dominationStreak: 3 })))).toEqual([]);
  });

  it('prefers an explicit starvationStreaks to the retired pair', () => {
    const state = hydrated({
      ...preP36({ dominationHolder: 'A', dominationStreak: 4 }),
      starvationStreaks: [{ player: 'C', streak: 2 }],
    });

    expect(clockOf(state)).toEqual([['C', 2]]);
  });

  it('still rejects a starvationStreaks that is present and malformed', () => {
    expect(hydrateState(preP36({ starvationStreaks: [{ player: 7, streak: 'four' }] }))).toBe(
      undefined,
    );
  });
});
