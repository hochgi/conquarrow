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
import type { GameState } from '@conquarrow/contracts';

const playLesson = (id: string): { state: GameState; steps: readonly number[] } => {
  const driven = driveTo(id, () => false);
  // Re-fold from scratch through the session transcript: the golden answers are
  // already folded inside driveTo; here we assert the end state is reachable
  // and stable by replaying the whole lesson once more and comparing.
  const again = driveTo(id, () => false);
  return {
    state: driven.state,
    steps: again.session.stepIndex() === driven.session.stepIndex() ? [driven.session.stepIndex()] : [-1],
  };
};

describe('every lesson is an exact replay', () => {
  it('driving each lesson twice reproduces its final state exactly', () => {
    for (const l of allLessons()) {
      const first = driveTo(l.id, () => false);
      const second = driveTo(l.id, () => false);
      expect(first.session.finished()).toBe(true);
      expect(second.session.finished()).toBe(true);
      expect(structuralEq(first.state, second.state)).toBe(true);
    }
    void playLesson;
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
