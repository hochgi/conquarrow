/**
 * P43 tutorial — invariants (docs/spec/tutorial/tutorial.md, EARS section).
 *
 * Property form of the twelve EARS one-liners, expressed where a property is
 * the honest encoding. The ubiquity/determinism pair is the load-bearing one:
 * it is what lets every other test trust that lessons are replays.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_MATCH_CONFIG, endTurn } from '@conquarrow/contracts';
import { TutorialSession } from '../src/tutorial/session';
import { firstRunCardVisible, practiceBoard } from '../src/tutorial/chrome';
import { renderCopy } from '../src/tutorial/copy';
import { openingOf, validateCatalogue, validateLesson } from '../src/tutorial/validate';
import {
  allLessons,
  driveToKind,
  fold,
  geometry,
  lesson,
  loneStack,
  newStore,
  routeMoves,
  rules,
  structuralEq,
} from './tutorial.support';
import { GalconInput } from '../src/input/modes';
import { decorateInputMode } from '../src/tutorial/restrict';

describe('ubiquitous: openings come only from makeMatch folded through apply', () => {
  it('every opening folds twice to the same state', () => {
    for (const l of allLessons()) {
      expect(structuralEq(openingOf(l), fold(openingOf(l), []))).toBe(true);
    }
  });
});

describe('ubiquitous: RulesPort stays the sole authority on legality', () => {
  it('a decorated mode refuses exactly what the plain mode refuses', () => {
    const { state, from } = loneStack(1);
    const far = (() => {
      let at = from;
      for (let i = 0; i < 4; i += 1) at = geometry.outArrows(geometry.target(at))[0] as never;
      return at;
    })();
    const decorated = decorateInputMode(new GalconInput(geometry), {
      coach: () => 'coach',
      selectable: new Set([from]),
    });
    const d = decorated.onArrowClick(far, state, rules);
    const p = new GalconInput(geometry).onArrowClick(far, state, rules);
    expect(d.refusal?.reason).toBe(p.refusal?.reason);
  });
});

describe('ubiquitous: equal data and equal inputs reproduce everything', () => {
  it('driving L0 twice yields identical states and step traces', () => {
    const run = (): { finalState: unknown; trace: readonly number[] } => {
      const les = lesson('L0');
      let state = openingOf(les);
      const session = TutorialSession.start(les);
      const trace: number[] = [];
      let guard = 0;
      while (!session.finished()) {
        guard += 1;
        if (guard > 500) throw new Error('setup: L0 did not finish');
        const current = session.step();
        trace.push(session.stepIndex());
        if (current.kind === 'narrate' || current.kind === 'demo' || current.kind === 'end') {
          session.next();
          continue;
        }
        if (current.kind === 'expect') {
          const batch = routeMoves(state, current);
          const after = fold(state, batch);
          session.onCommitted(state, after, batch);
          state = after;
          continue;
        }
        // objective — the only kind left
        const after = fold(state, current.golden);
        session.onCommitted(state, after, current.golden);
        state = after;
      }
      return { finalState: state, trace };
    };
    const first = run();
    const second = run();
    expect(structuralEq(first.finalState, second.finalState)).toBe(true);
    expect(first.trace).toEqual(second.trace);
  });
});

describe('state-driven: rails offer only what they allow; steps hold until done', () => {
  it('decorated targets are always a subset of plain targets', () => {
    const { state, from } = loneStack(4);
    const plain = new GalconInput(geometry).onArrowClick(from, state, rules);
    const decorated = decorateInputMode(new GalconInput(geometry), {
      selectable: new Set([from]),
      clickable: new Set([from]),
      coach: () => 'c',
    }).onArrowClick(from, state, rules);
    for (const arrow of decorated.highlights.targets) {
      expect(plain.highlights.targets.has(arrow)).toBe(true);
    }
  });

  it('an incomplete expect step never advances on unrelated batches', () => {
    const driven = driveToKind('L2', 'expect');
    // A legal but non-golden batch: end the turn instead of taking the step.
    const before = driven.state;
    const source = [...before.groups.keys()].find(
      (arrow) => before.groups.get(arrow)?.owner === before.activePlayer,
    );
    if (source === undefined) throw new Error('setup: no own stack to leave standing');
    const batch = [endTurn()];
    const after = fold(before, batch);
    driven.session.onCommitted(before, after, batch);
    expect(driven.session.stepIndex()).toBe(driven.index);
  });
});

describe('event-driven: objectives advance only when their predicate holds', () => {
  it('a non-satisfying batch leaves the objective step in place', () => {
    const driven = driveToKind('L3', 'objective');
    driven.session.onCommitted(driven.state, driven.state, []);
    expect(driven.session.stepIndex()).toBe(driven.index);
  });
});

describe('unwanted: practice label iff config differs; copy follows config', () => {
  it('practiceBoard is the biconditional of config difference', () => {
    expect(practiceBoard(DEFAULT_MATCH_CONFIG)).toBe(false);
    expect(practiceBoard({ ...DEFAULT_MATCH_CONFIG, spawnerSeed: 99 })).toBe(true);
    for (const l of allLessons()) {
      expect(practiceBoard(l.config)).toBe(!structuralEq(l.config, DEFAULT_MATCH_CONFIG));
    }
  });

  it('starvation copy tracks dominationN', () => {
    for (const n of [1, 2, 5, 9]) {
      expect(renderCopy('starvation-rounds', { ...DEFAULT_MATCH_CONFIG, dominationN: n })).toContain(
        String(n),
      );
    }
  });
});

describe('unwanted: reset restores pristine; validation gates the catalogue', () => {
  it('reset clears completions and revives the card', () => {
    const store = newStore();
    store.markComplete('L7');
    store.reset();
    expect(store.completions().size).toBe(0);
    expect(firstRunCardVisible(store)).toBe(true);
  });

  it('every shipped lesson validates and the catalogue validates whole', () => {
    for (const l of allLessons()) expect(validateLesson(l).ok).toBe(true);
    expect(validateCatalogue(allLessons()).ok).toBe(true);
  });
});

describe('determinism of the driver itself', () => {
  it('driveToKind is stable across calls', () => {
    const a = driveToKind('L1', 'expect');
    const b = driveToKind('L1', 'expect');
    expect(a.index).toBe(b.index);
    expect(structuralEq(a.state, b.state)).toBe(true);
  });
});
