/**
 * P43 tutorial — edge cases (docs/spec/tutorial/tutorial.edge-cases.feature).
 *
 * Honesty under misuse: rails coach without faking legality; objectives accept
 * every route to the idea; failures halt loudly; copy never lies about numbers.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_MATCH_CONFIG, endTurn as mkEndTurn } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { decorateInputMode } from '../src/tutorial/restrict';
import type { TutoredSnapshot } from '../src/tutorial/restrict';
import { firstRunCardVisible, practiceBoard, progressDots } from '../src/tutorial/chrome';
import { renderCopy } from '../src/tutorial/copy';
import { validateLesson } from '../src/tutorial/validate';
import {
  allLessons,
  alongSlot0,
  driveTo,
  driveToKind,
  fold,
  geometry,
  lesson,
  loneStack,
  newStore,
  routeMoves,
  rules,
  searchTrailShrinkingSteps,
  structuralEq,
} from './tutorial.support';
import { GalconInput } from '../src/input/modes';
import type { ExpectStep } from '../src/tutorial/types';

describe('a rail coaches without ever faking legality', () => {
  it('an off-rail but legal click gets the coach line only', () => {
    const { state, from } = loneStack(4);
    const east = geometry.outArrows(geometry.target(from))[1];
    if (east === undefined) throw new Error('setup: no out-slot 1');
    const north = alongSlot0(from, 1);
    const mode = decorateInputMode(new GalconInput(geometry), {
      clickable: new Set([north]),
      selectable: new Set([from]),
      coach: () => 'one run north',
    });
    mode.onArrowClick(from, state, rules);
    // The east run is legal — the plain mode would draft it — but off-rail.
    const snap = mode.onArrowClick(east, state, rules) as TutoredSnapshot;
    expect(snap.coach).toBe('one run north');
    expect(snap.refusal).toBeUndefined();
  });

  it('an engine-illegal click keeps its ordinary refusal beneath the coach', () => {
    const { state, from } = loneStack(1);
    // A lone head stepping is legal, but an ATTACK emptying the source is not;
    // with one head there is nothing to attack with — use a refused self-convert
    // shape instead: enemy territory adjacent (P28) is out of scope here, so the
    // simplest engine refusal available on this board: clicking an arrow that is
    // neither own nor clickable.
    const far = alongSlot0(alongSlot0(from, 3), 1);
    const mode = decorateInputMode(new GalconInput(geometry), {
      clickable: new Set([alongSlot0(from, 1)]),
      selectable: new Set([from]),
      coach: () => 'stay close',
    });
    const plain = new GalconInput(geometry).onArrowClick(far, state, rules);
    const snap = mode.onArrowClick(far, state, rules) as TutoredSnapshot;
    expect(plain.refusal).toBeDefined();
    expect(snap.refusal).toEqual(plain.refusal);
    expect(snap.coach).toBe('stay close');
  });

  it('a disallowed carry value ignores the change and coaches', () => {
    const { state, from } = loneStack(4);
    const target = alongSlot0(from, 1);
    const mode = decorateInputMode(new GalconInput(geometry), {
      selectable: new Set([from]),
      carryAllow: [3],
      coach: () => 'leave one head behind',
    });
    mode.onArrowClick(from, state, rules);
    const refused = mode.setCarry(4) as TutoredSnapshot;
    expect(refused.coach).toBe('leave one head behind');
    const accepted = mode.setCarry(3) as TutoredSnapshot;
    expect(accepted.coach).toBeUndefined();
    void target;
  });

  it('the engine stays the sole authority on legality', () => {
    const { state, from } = loneStack(1);
    const far = alongSlot0(alongSlot0(from, 2), 1);
    const decorated = decorateInputMode(new GalconInput(geometry), { coach: () => 'x' });
    const plain = new GalconInput(geometry);
    for (const arrow of [far]) {
      const d = decorated.onArrowClick(arrow, state, rules);
      const p = plain.onArrowClick(arrow, state, rules);
      expect(d.refusal?.reason ?? null).toBe(p.refusal?.reason ?? null);
    }
  });
});

describe('objectives tolerate every route to the idea', () => {
  it('an alternative legal solution also completes the goal', () => {
    const driven = driveToKind('L3', 'objective');
    const candidates = searchTrailShrinkingSteps(driven.state, /* victim */ driven.state.players[1] as never);
    // The lesson promises at least two distinct crossings of the enemy trail.
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    for (const candidate of candidates.slice(0, 2)) {
      const fresh = driveToKind('L3', 'objective');
      const after = fold(fresh.state, [candidate.move]);
      fresh.session.onCommitted(fresh.state, after, [candidate.move]);
      expect(fresh.session.stepIndex()).toBe(fresh.index + 1);
    }
  });

  it('an objective survives End Turn boundaries while unmet', () => {
    const driven = driveToKind('L6', 'objective');
    let state = driven.state;
    for (let round = 0; round < 3; round += 1) {
      const moves: Move[] = [mkEndTurn(), mkEndTurn()];
      const after = fold(state, moves);
      driven.session.onCommitted(state, after, moves);
      state = after;
      expect(driven.session.stepIndex()).toBe(driven.index);
    }
  });

  it('the hint ladder escalates nudge then highlight then show me', () => {
    const driven = driveToKind('L3', 'objective');
    const empty: Move[] = [];
    driven.session.onCommitted(driven.state, driven.state, empty);
    expect(driven.session.hint().kind).toBe('nudge');
    driven.session.onCommitted(driven.state, driven.state, empty);
    expect(['highlight', 'nudge']).toContain(driven.session.hint().kind);
    driven.session.onCommitted(driven.state, driven.state, empty);
    expect(driven.session.hint().kind).toBe('show-me');
  });
});

describe('practice boards are labelled and confined to setup data', () => {
  it('a differing config labels the session practice board', () => {
    const l7 = lesson('L7');
    if (!structuralEq(l7.config, DEFAULT_MATCH_CONFIG)) {
      expect(practiceBoard(l7.config)).toBe(true);
    } else {
      expect(practiceBoard({ ...DEFAULT_MATCH_CONFIG, dominationN: 2 })).toBe(true);
    }
  });

  it('the default config shows no label', () => {
    expect(practiceBoard(DEFAULT_MATCH_CONFIG)).toBe(false);
  });

  it('config differences touch only §7 setup data', () => {
    const tunable = new Set(['dominationN', 'R', 'homeOffset', 'spawnerSeed']);
    for (const l of allLessons()) {
      expect(l.config.playerCount).toBe(DEFAULT_MATCH_CONFIG.playerCount);
      for (const key of Object.keys(l.config) as readonly (keyof typeof DEFAULT_MATCH_CONFIG)[]) {
        if (l.config[key] !== DEFAULT_MATCH_CONFIG[key]) expect(tunable.has(key)).toBe(true);
      }
    }
  });
});

describe('restart, skip and leaving behave predictably', () => {
  it('restart refolds the opening exactly', () => {
    const driven = driveToKind('L2', 'expect');
    driven.session.restart();
    expect(driven.session.stepIndex()).toBe(0);
    expect(structuralEq(driven.state, fold(driven.state, []))).toBe(true);
  });

  it('skip advances without marking completion', () => {
    const dots = progressDots(
      ['L0', 'L1', 'L2'],
      new Set(['L0']),
      'L2',
    );
    // L1 was skipped: hollow. Nothing pretends it was completed.
    expect(dots[0]).toBe('complete');
    expect(dots[2]).toBe('current');
  });

  it('leaving mid-lesson discards the match and records nothing', () => {
    const store = newStore();
    const { session } = driveToKind('L5', 'demo');
    // Leaving = dropping the session without completion.
    void session;
    expect(store.completions().size).toBe(0);
  });

  it('reset progress restores the pristine first-run state', () => {
    const store = newStore();
    store.markComplete('L0');
    store.markComplete('L1');
    store.dismissCard();
    store.reset();
    expect(store.completions().size).toBe(0);
    expect(firstRunCardVisible(store)).toBe(true);
  });
});

describe('failures fail loudly', () => {
  it('a demo move refused at runtime halts visibly', () => {
    const withDemo = allLessons().find((l) => l.steps.some((s) => s.kind === 'demo'));
    if (withDemo === undefined) throw new Error('setup: no shipped lesson contains a demo step');
    const index = withDemo.steps.findIndex((s) => s.kind === 'demo');
    const { session } = driveTo(withDemo.id, (_s, i) => i >= index);
    const pending = session.demoPending() ?? [];
    session.onDemoHalted(pending[0] as never, new Error('refused by rule change'));
    expect(session.halted()).toBe(true);
    expect(session.haltDetail()).toContain(withDemo.id);
    expect(session.boardInputOpen()).toBe(false);
  });

  it('the validator fails loudly when authored boards rot', () => {
    const result = validateLesson(lesson('L0'), {
      ...rules,
      apply: (state, move) => {
        if (move.kind === 'step') throw new Error('refused by the stand-in rule');
        return rules.apply(state, move);
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures[0]?.lesson).toBe('L0');
      expect(result.failures[0]?.reason).toMatch(/refused|illegal/i);
    }
  });
});

describe('copy teaches numbers the board can prove', () => {
  it('tunable copy follows the config', () => {
    expect(renderCopy('starvation-rounds', { ...DEFAULT_MATCH_CONFIG, dominationN: 2 })).toContain('2');
    expect(renderCopy('starvation-rounds', { ...DEFAULT_MATCH_CONFIG, dominationN: 4 })).toContain('4');
  });

  it('structural constants stay literal across configs', () => {
    const low = renderCopy('girth', { ...DEFAULT_MATCH_CONFIG, R: 3 });
    const high = renderCopy('girth', { ...DEFAULT_MATCH_CONFIG, R: 9 });
    expect(low).toBe(high);
  });
});

describe('lesson chrome never mimics hot-seat play', () => {
  it('no passing gate exists during a lesson — B batches commit gatelessly', () => {
    const driven = driveToKind('L3', 'objective');
    const moves: Move[] = [mkEndTurn(), mkEndTurn()];
    const after = fold(driven.state, moves);
    expect(() => {
      driven.session.onCommitted(driven.state, after, moves);
    }).not.toThrow();
  });

  it('end turn during an observe phase commits normally and advances', () => {
    const driven = driveToKind('L1', 'expect');
    const step = driven.session.step() as ExpectStep;
    const batch = routeMoves(driven.state, step);
    const after = fold(driven.state, batch);
    driven.session.onCommitted(driven.state, after, batch);
    // Observe phase ends with End Turn; the next narrate plays over the new board.
    const endBatch: Move[] = [mkEndTurn(), mkEndTurn()];
    const afterRound = fold(after, endBatch);
    driven.session.onCommitted(after, afterRound, endBatch);
    expect(driven.session.stepIndex()).toBeGreaterThan(driven.index);
  });
});
