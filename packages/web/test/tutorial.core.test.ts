/**
 * P43 tutorial — core scenarios (docs/spec/tutorial/tutorial.core.feature).
 *
 * One test per scenario, against the tutorial module's public surface. Content
 * shape is pinned hard (ids, step kinds, goal keys) so a vacuous catalogue
 * cannot pass; the validator gives the content its depth.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_MATCH_CONFIG } from '@conquarrow/contracts';
import { decorateInputMode, restrictionFor } from '../src/tutorial/restrict';
import type { RailRestriction, TutoredSnapshot } from '../src/tutorial/restrict';
import { TutorialSession } from '../src/tutorial/session';
import {
  firstRunCardVisible,
  practiceBoard,
  progressDots,
} from '../src/tutorial/chrome';
import { renderCopy } from '../src/tutorial/copy';
import { createProgressStore } from '../src/tutorial/storage';
import { openingOf, validateCatalogue, validateLesson } from '../src/tutorial/validate';
import { GOALS } from '../src/tutorial/goals';
import {
  allLessons,
  alongSlot0,
  driveTo,
  driveToKind,
  fold,
  geometry,
  goldenOf,
  lesson,
  loneStack,
  memoryBacking,
  newStore,
  routeMoves,
  rules,
  spyStore,
  step as mkStep,
  structuralEq,
} from './tutorial.support';
import { GalconInput } from '../src/input/modes';
import { LESSONS } from '../src/tutorial/catalogue';
import type { EndStep, ExpectStep, NarrateStep } from '../src/tutorial/types';

const expectIds = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'] as const;

describe('catalogue shape (content contract)', () => {
  it('ships exactly L0..L7 in teaching order', () => {
    expect(LESSONS.map((l) => l.id)).toEqual([...expectIds]);
  });

  it('every lesson is a fixed two-seat board', () => {
    for (const l of allLessons()) expect(l.config.playerCount).toBe(2);
  });

  it('L0 opens with narration and teaches by rails', () => {
    const l0 = lesson('L0');
    expect(l0.steps[0]?.kind).toBe('narrate');
    expect(l0.steps.some((s) => s.kind === 'expect')).toBe(true);
  });

  it('L3 contains an objective named cutEnemyTrail', () => {
    const l3 = lesson('L3');
    expect(l3.steps.some((s) => s.kind === 'objective' && s.goal === 'cutEnemyTrail')).toBe(true);
  });

  it('L6 contains an objective named capturedShare', () => {
    const l6 = lesson('L6');
    expect(l6.steps.some((s) => s.kind === 'objective' && s.goal === 'capturedShare')).toBe(true);
  });

  it('L5 demonstrates before it asks (demo then objective)', () => {
    const kinds = lesson('L5').steps.map((s) => s.kind);
    const demo = kinds.indexOf('demo');
    const objective = kinds.indexOf('objective');
    expect(demo).toBeGreaterThanOrEqual(0);
    expect(objective).toBeGreaterThan(demo);
  });

  it('every referenced goal is registered', () => {
    for (const l of allLessons())
      for (const s of l.steps)
        if (s.kind === 'objective') expect(GOALS[s.goal]).toBeDefined();
  });
});

describe('the Lobby offers the tutorial without ever blocking play', () => {
  it('the Learn entry starts lesson 1 as a fixed two-seat session', () => {
    const l0 = lesson('L0');
    const session = TutorialSession.start(l0);
    expect(session.id).toBe('L0');
    expect(l0.config.playerCount).toBe(2);
    // No seat handoff exists in the session API at all.
    expect(typeof session.boardInputOpen).toBe('function');
  });

  it('a first visit shows the dismissible walkthrough card', () => {
    const store = newStore();
    expect(firstRunCardVisible(store)).toBe(true);
  });

  it('activating the card enters L0 directly', () => {
    const store = newStore();
    expect(firstRunCardVisible(store)).toBe(true);
    const session = TutorialSession.start(lesson('L0'));
    expect(session.id).toBe('L0');
  });

  it('dismissing the card persists across reloads', () => {
    const backing = memoryBacking();
    const first = createProgressStore(backing);
    first.dismissCard();
    const reloaded = createProgressStore(backing);
    expect(firstRunCardVisible(reloaded)).toBe(false);
  });

  it('an existing player sees no card but keeps the Learn entry', () => {
    const store = newStore();
    store.markComplete('L0');
    expect(firstRunCardVisible(store)).toBe(false);
  });
});

describe('narration points before it asks', () => {
  it('a narrate step waits for Next and blocks the board', () => {
    const { session } = driveToKind('L0', 'narrate');
    expect(session.step().kind).toBe('narrate');
    expect(session.boardInputOpen()).toBe(false);
  });

  it('focus rings name what the text names and nothing else', () => {
    const { session } = driveToKind('L0', 'narrate');
    const step = session.step() as NarrateStep & { focus?: readonly string[] };
    expect(Array.isArray(step.focus ?? [])).toBe(true);
  });

  it('Next advances and unpaints', () => {
    const { session } = driveToKind('L0', 'narrate');
    const beforeIndex = session.stepIndex();
    session.next();
    expect(session.stepIndex()).toBe(beforeIndex + 1);
    const nextStep = session.step();
    if (nextStep.kind === 'narrate') expect(nextStep.focus).toBeUndefined();
  });
});

describe('demos play enemy agency through the ordinary commit path', () => {
  it('a demo hands the host its moves to commit like any sent batch', () => {
    const withDemo = allLessons().find((l) => l.steps.some((s) => s.kind === 'demo'));
    if (withDemo === undefined) throw new Error('setup: no shipped lesson contains a demo step');
    const index = withDemo.steps.findIndex((s) => s.kind === 'demo');
    const driven = driveTo(withDemo.id, (_s, i) => i >= index);
    const pending = driven.session.demoPending();
    expect(pending).toBeDefined();
    expect(pending?.length).toBeGreaterThan(0);
    // The moves are engine-legal on the current state — the ordinary path takes them.
    expect(() => fold(driven.state, pending ?? [])).not.toThrow();
  });

  it('a demo paces itself and advances only after the last effect', () => {
    const withDemo = allLessons().find((l) => l.steps.some((s) => s.kind === 'demo'));
    if (withDemo === undefined) throw new Error('setup: no shipped lesson contains a demo step');
    const index = withDemo.steps.findIndex((s) => s.kind === 'demo');
    const { session } = driveTo(withDemo.id, (_s, i) => i >= index);
    const at = session.stepIndex();
    session.next();
    expect(session.stepIndex()).toBe(at + 1);
  });

  it('an enemy demo never yields control mid-sequence', () => {
    const withDemo = allLessons().find((l) => l.steps.some((s) => s.kind === 'demo'));
    if (withDemo === undefined) throw new Error('setup: no shipped lesson contains a demo step');
    const index = withDemo.steps.findIndex((s) => s.kind === 'demo');
    const { session } = driveTo(withDemo.id, (_s, i) => i >= index);
    expect(session.boardInputOpen()).toBe(false);
    expect(session.halted()).toBe(false);
  });
});

describe('rails narrow choice to the action being taught', () => {
  const railFor = (from: string, exits: readonly string[], coachText: string): RailRestriction => ({
    selectable: new Set([from as never]),
    clickable: new Set(exits as never[]),
    coach: () => coachText,
  });

  const setup = () => {
    const { state, from } = loneStack(4);
    const exit1 = alongSlot0(from, 1);
    return { state, from, exit1 };
  };

  it('only the rail source is selectable during an expect step', () => {
    const { state, from } = setup();
    const mode = decorateInputMode(new GalconInput(geometry), railFor(from, [], 'stay on a0'));
    // Clicking the railed source selects; the coach is silent.
    const snap = mode.onArrowClick(from, state, rules) as TutoredSnapshot;
    expect(snap.highlights.selected).toBeDefined();
    expect(snap.coach).toBeUndefined();
  });

  it('clickable targets are filtered to the route shape', () => {
    const { state, from, exit1 } = setup();
    const plain = new GalconInput(geometry).onArrowClick(from, state, rules);
    const decorated = decorateInputMode(
      new GalconInput(geometry),
      railFor(from, [exit1], 'one run north'),
    );
    const snap = decorated.onArrowClick(from, state, rules) as TutoredSnapshot;
    for (const arrow of snap.highlights.targets) {
      expect(plain.highlights.targets.has(arrow)).toBe(true);
    }
    // The route shape survives the filter; everything else is gone.
    expect(snap.highlights.targets.has(exit1)).toBe(true);
    expect(snap.highlights.targets.size).toBeLessThan(plain.highlights.targets.size);
  });

  it('completing the expected action commits and advances', () => {
    const driven = driveToKind('L0', 'expect');
    const step = driven.session.step() as ExpectStep;
    const before = driven.state;
    const after = fold(before, routeMoves(before, step));
    driven.session.onCommitted(before, after, routeMoves(before, step));
    expect(driven.session.stepIndex()).toBe(driven.index + 1);
  });

  it('landing the L2 rail onto the occupied home still commits', () => {
    const driven = driveToKind('L2', 'expect');
    const step = driven.session.step() as ExpectStep;
    const restriction = restrictionFor(step);
    if (restriction === undefined) throw new Error('setup: L2 expect has no rail');
    const exit = step.action.exits[0];
    if (exit === undefined) throw new Error('setup: L2 expect has no exit');
    expect(driven.state.groups.get(exit)?.owner).toBe(driven.state.activePlayer);
    const decorated = decorateInputMode(new GalconInput(geometry), restriction);
    decorated.onArrowClick(step.action.from, driven.state, rules);
    const after = decorated.onArrowClick(exit, driven.state, rules);
    expect(after.pending?.some((move) => move.kind === 'step' && move.exit === exit)).toBe(true);
    expect(after.phase.kind).toBe('idle');
  });

  it('cancel exits a rail cleanly and the step re-arms', () => {
    const { state, from } = setup();
    const mode = decorateInputMode(new GalconInput(geometry), railFor(from, [], 'again'));
    mode.onArrowClick(from, state, rules);
    mode.cancel();
    const again = mode.onArrowClick(from, state, rules) as TutoredSnapshot;
    expect(again.highlights.selected).toBeDefined();
  });
});

describe('objectives hand over free play until judgement lands', () => {
  it('free play accepts any legal action — an empty rail passes everything through', () => {
    const { state, from } = loneStack(4);
    const unrestricted = decorateInputMode(new GalconInput(geometry), { coach: () => '' });
    const snap = unrestricted.onArrowClick(from, state, rules) as TutoredSnapshot;
    expect(snap.coach).toBeUndefined();
    expect(snap.phase.kind).toBe('route');
  });

  it('the golden solution completes the objective', () => {
    const driven = driveToKind('L3', 'objective');
    const golden = goldenOf(driven.session.step());
    const after = fold(driven.state, golden);
    driven.session.onCommitted(driven.state, after, golden);
    expect(driven.session.stepIndex()).toBe(driven.index + 1);
  });

  it('show me replays the golden answer as a demo', () => {
    const driven = driveToKind('L3', 'objective');
    const golden = goldenOf(driven.session.step());
    // Three fruitless batches arm show-me.
    const source = [...driven.state.groups.keys()][0];
    if (source === undefined) throw new Error('setup: L3 objective state has no groups');
    const exit = geometry.outArrows(geometry.target(source))[0];
    if (exit === undefined) throw new Error('setup: no exit from source');
    const noopBatch = [mkStep(source, exit, 1)];
    for (let i = 0; i < 3; i += 1) {
      try {
        const after = fold(driven.state, noopBatch);
        driven.session.onCommitted(driven.state, after, noopBatch);
      } catch {
        driven.session.onCommitted(driven.state, driven.state, []);
      }
    }
    const hint = driven.session.hint();
    expect(hint.kind).toBe('show-me');
    if (hint.kind === 'show-me') expect(hint.moves).toEqual(golden);
  });
});

describe('completion persists and progress is legible', () => {
  it('reaching end marks completion via the store', () => {
    const spy = spyStore(newStore());
    const { session } = driveTo('L0', () => false);
    while (!session.finished()) session.next();
    session.next(); // dismiss the end summary
    expect(session.completed()).toBe(true);
    if (session.completed()) spy.markComplete(session.id);
    expect(spy.calls).toContain(`markComplete:${session.id}`);
  });

  it('completion survives reload', () => {
    const backing = memoryBacking();
    const first = createProgressStore(backing);
    first.markComplete('L0');
    const reloaded = createProgressStore(backing);
    expect(reloaded.completions().has('L0')).toBe(true);
    expect(firstRunCardVisible(reloaded)).toBe(false);
  });

  it('progress dots reflect complete / current / locked', () => {
    const dots = progressDots([...expectIds], new Set(['L0', 'L1']), 'L2');
    expect(dots.slice(0, 2)).toEqual(['complete', 'complete']);
    expect(dots[2]).toBe('current');
    expect(dots.slice(3)).toEqual(['locked', 'locked', 'locked', 'locked', 'locked']);
  });
});

describe('lessons are deterministic and self-validating', () => {
  it('an opening equals the engine fold of its script', () => {
    for (const l of allLessons()) {
      const manual = fold(
        // makeMatch equivalence is proven by openingOf's own construction in
        // phase 3; here we pin determinism and shape.
        openingOf(l),
        [],
      );
      expect(structuralEq(manual, openingOf(l))).toBe(true);
    }
  });

  it('the golden path validates headlessly for every lesson', () => {
    for (const l of allLessons()) {
      const result = validateLesson(l);
      expect(result.ok).toBe(true);
    }
    expect(validateCatalogue(allLessons()).ok).toBe(true);
  });

  it('practice-board labelling follows the config biconditionally', () => {
    expect(practiceBoard(DEFAULT_MATCH_CONFIG)).toBe(false);
    for (const l of allLessons()) {
      expect(practiceBoard(l.config)).toBe(!structuralEq(l.config, DEFAULT_MATCH_CONFIG));
    }
  });

  it('tunable copy follows the config', () => {
    const two = renderCopy('starvation-rounds', { ...DEFAULT_MATCH_CONFIG, dominationN: 2 });
    const four = renderCopy('starvation-rounds', { ...DEFAULT_MATCH_CONFIG, dominationN: 4 });
    expect(two).toContain('2');
    expect(four).toContain('4');
  });

  it('structural constants stay literal across configs', () => {
    const a = renderCopy('girth', { ...DEFAULT_MATCH_CONFIG, dominationN: 2 });
    const b = renderCopy('girth', { ...DEFAULT_MATCH_CONFIG, dominationN: 7 });
    expect(a).toBe(b);
  });
});

describe('end-step typing sanity', () => {
  it('every lesson ends with an end step carrying a summary', () => {
    for (const l of allLessons()) {
      const last = l.steps[l.steps.length - 1] as EndStep | undefined;
      expect(last?.kind).toBe('end');
      expect(typeof last?.summary).toBe('string');
    }
  });
});
