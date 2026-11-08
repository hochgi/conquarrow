/**
 * Edge scenarios for docs/spec/heuristic-loop-of-doom/heuristic-loop-of-doom.edge-cases.feature
 * (P91 — sortie credit pays only a sortie that grew).
 *
 * The size table uses hand-made states: L1's minimal O₀ with only `trails`
 * replaced (spec "Fixtures"). The nested-plan, sortieCredit-contract and
 * determinism scenarios pin behaviour P91 leaves unchanged, so they pass
 * before the fix as well as after it.
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId, PlayerId } from '@conquarrow/contracts';
import { chooseTurnBeam, chooseTurnBeamWithBudget } from '../src/botSearch';
import { sortieCredit, sortieGrew } from '../src/botTempo';
import {
  geometry,
  L1_NESTED_PLAN_AT_O1,
  l1Units,
  otherSeat,
  rules,
  syntheticTrail,
  trailSizeOf,
  withTrails,
} from './heuristic-loop-of-doom.support';

const SEARCH_TIMEOUT = 120_000;

const credit = sortieCredit.bind(undefined, geometry);

/** L1's minimal O₀, the base every hand-made state copies. */
const base = () => {
  const { me, o0 } = l1Units(credit);
  return { me, state: o0 };
};

const trailsOf = (
  entries: readonly (readonly [PlayerId, ReadonlySet<ArrowId>])[],
): ReadonlyMap<PlayerId, ReadonlySet<ArrowId>> => new Map(entries);

describe('heuristic-loop-of-doom edge cases', () => {
  describe('Rule: sortieGrew compares trail sizes, nothing else', () => {
    it.each([
      { origin: 0, terminal: 0, grew: false, note: 'no trail at either end' },
      { origin: 0, terminal: 3, grew: true, note: 'an opening sortie' },
      { origin: 9, terminal: 12, grew: true, note: 'the sortie was extended' },
      { origin: 12, terminal: 12, grew: false, note: 'a ring walk or a pass' },
      { origin: 12, terminal: 4, grew: false, note: 'part closed, a smaller trail left open' },
      { origin: 12, terminal: 0, grew: false, note: 'the sortie closed' },
    ])(
      'sortieGrew with origin trail size $origin and terminal trail size $terminal ($note)',
      ({ origin, terminal, grew }) => {
        const { me, state } = base();
        const o = withTrails(state, trailsOf([[me, syntheticTrail(origin, 0)]]));
        const t = withTrails(state, trailsOf([[me, syntheticTrail(terminal, 0)]]));
        if (trailSizeOf(o, me) !== origin || trailSizeOf(t, me) !== terminal) {
          throw new Error('setup: hand-made trail sizes are wrong');
        }

        expect(sortieGrew(o, t, me)).toBe(grew);
      },
      SEARCH_TIMEOUT,
    );

    it(
      'A trail absent from the map counts as size 0',
      () => {
        const { me, state } = base();
        const o = withTrails(state, trailsOf([]));
        const t = withTrails(state, trailsOf([[me, syntheticTrail(2, 0)]]));
        if (o.trails.has(me)) throw new Error('setup: origin has an entry for me');

        expect(sortieGrew(o, t, me)).toBe(true);
      },
      SEARCH_TIMEOUT,
    );

    it(
      "sortieGrew does not read the other seats' trails",
      () => {
        const { me, state } = base();
        const other = otherSeat(state, me);
        const mine = syntheticTrail(5, 0);
        const o = withTrails(state, trailsOf([[me, mine], [other, syntheticTrail(0, 1)]]));
        const t = withTrails(state, trailsOf([[me, mine], [other, syntheticTrail(7, 1)]]));
        if (trailSizeOf(t, other) !== 7) throw new Error('setup: other seat trail is not 7');

        expect(sortieGrew(o, t, me)).toBe(false);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: The nested search is unchanged', () => {
    it(
      'The nested search plans as it did before P91',
      () => {
        const { me, o1 } = l1Units(credit);

        const plan = chooseTurnBeamWithBudget(geometry, rules, o1, me, { withReplies: false });

        expect(plan).toEqual(L1_NESTED_PLAN_AT_O1);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: sortieCredit keeps its P85 contract', () => {
    it(
      'sortieCredit still prices an open sortie without an origin',
      () => {
        const { me, t2 } = l1Units(credit);

        expect(sortieCredit(geometry, t2, me)).toBeGreaterThan(0);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: The gate is deterministic', () => {
    it(
      'The same position gives the same plan twice',
      () => {
        const { me, o1 } = l1Units(credit);

        const first = chooseTurnBeam(geometry, rules, o1, me);
        const second = chooseTurnBeam(geometry, rules, o1, me);

        expect(second).toEqual(first);
      },
      SEARCH_TIMEOUT,
    );
  });
});
