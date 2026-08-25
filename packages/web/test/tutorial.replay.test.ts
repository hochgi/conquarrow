/**
 * P43 tutorial — replay fixtures.
 *
 * A lesson IS a replay: opening fold plus an ordered move list (its golden
 * path). Because the core is pure, driving any lesson twice must reproduce the
 * final state exactly — this file is that assertion for all eight lessons, and
 * the detector should a future change introduce nondeterminism anywhere in the
 * tutorial's reach.
 */

import { describe, expect, it } from 'vitest';

import { openingOf } from '../src/tutorial/validate';
import {
  allLessons,
  driveTo,
  fold,
  routeMoves,
  structuralEq,
} from './tutorial.support';

describe('every lesson is an exact replay', () => {
  it('driving each lesson twice reproduces its final state exactly', () => {
    for (const l of allLessons()) {
      const first = driveTo(l.id, () => false);
      const second = driveTo(l.id, () => false);
      expect(first.session.finished()).toBe(true);
      expect(second.session.finished()).toBe(true);
      expect(structuralEq(first.state, second.state)).toBe(true);
    }
  });

  it('openings fold deterministically', () => {
    for (const l of allLessons()) {
      expect(structuralEq(openingOf(l), openingOf(l))).toBe(true);
    }
  });

  it('route golden answers re-fold to identical states', () => {
    for (const l of allLessons()) {
      const firstExpect = l.steps.findIndex((s) => s.kind === 'expect');
      if (firstExpect < 0) continue;
      const step = l.steps[firstExpect];
      if (step?.kind !== 'expect') continue;
      const state = openingOf(l);
      expect(structuralEq(fold(state, routeMoves(state, step)), fold(state, routeMoves(state, step)))).toBe(true);
    }
  });
});
