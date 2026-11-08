/**
 * Core scenarios for docs/spec/heuristic-loop-of-doom/heuristic-loop-of-doom.core.feature
 * (P91 — sortie credit pays only a sortie that grew).
 *
 * The outline "Fixture <id> claims land within three of its turns" is the four
 * behaviour tests of heuristic-loop-of-doom.replay.test.ts; it is not repeated
 * here. Unit positions O₀, T₁, O₁, T₂ come from L1's minimal position with
 * every premise checked in `l1Units` (throws `setup:` when false).
 */

import { describe, expect, it } from 'vitest';
import { liveSortieCredit, sortieCredit, sortieGrew } from '../src/botTempo';
import { geometry, l1Units, trailSizeOf } from './heuristic-loop-of-doom.support';

const SETUP_TIMEOUT = 60_000;

const credit = sortieCredit.bind(undefined, geometry);

describe('heuristic-loop-of-doom core', () => {
  describe('Rule: A turn that does not grow the sortie earns no sortie credit', () => {
    it(
      'A ring walk earns no credit',
      () => {
        const { me, o1, t2 } = l1Units(credit);
        expect(trailSizeOf(o1, me)).toBe(12);
        expect(trailSizeOf(t2, me)).toBe(12);
        expect(sortieCredit(geometry, t2, me)).toBeGreaterThan(0);

        expect(sortieGrew(o1, t2, me)).toBe(false);
        expect(liveSortieCredit(geometry, o1, t2, me)).toBe(0);
      },
      SETUP_TIMEOUT,
    );
  });

  describe('Rule: A turn that grows the sortie is credited as before', () => {
    it(
      'The turn into the ring is credited as P85 decided',
      () => {
        const { me, o0, t1 } = l1Units(credit);
        expect(trailSizeOf(o0, me)).toBe(9);
        expect(trailSizeOf(t1, me)).toBe(12);
        const p85 = sortieCredit(geometry, t1, me);
        expect(p85).toBeGreaterThan(0);

        expect(sortieGrew(o0, t1, me)).toBe(true);
        expect(liveSortieCredit(geometry, o0, t1, me)).toBe(p85);
      },
      SETUP_TIMEOUT,
    );
  });
});
