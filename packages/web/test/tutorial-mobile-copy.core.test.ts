/**
 * P44 tutorial mobile-copy — core scenarios
 * (docs/spec/tutorial-mobile-copy/tutorial-mobile-copy.core.feature).
 *
 * One test per Gherkin scenario. React stays out of vitest: hit testing,
 * auto-Send, banner, pan and copy are pinned on pure helpers.
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId } from '@conquarrow/contracts';
import { makeLayout } from '@conquarrow/geometry-tiling';
import { centroidScreen } from '../src/boardGeom';
import { COARSE_HIT_PADDING_PX, hitArrow } from '../src/hit';
import { GalconInput } from '../src/input/modes';
import { decorateInputMode, restrictionFor } from '../src/tutorial/restrict';
import type { TutoredSnapshot } from '../src/tutorial/restrict';
import {
  SPEED_FORMULA,
  learnerStringsOf,
  railAutoSends,
  shouldPanToExpect,
  stageBanner,
} from '../src/tutorial/stage';
import type { ExpectStep, LessonStep } from '../src/tutorial/types';
import { centerOn, createViewport } from '../src/viewport';
import { validateLesson } from '../src/tutorial/validate';
import {
  allLessons,
  alongSlot0,
  driveTo,
  driveToKind,
  firstExpect,
  geometry,
  hitBoard,
  insideClick,
  lesson,
  loneStack,
  nearMissClick,
  openingOf,
  overlapTap,
  pipHit,
  rules,
  spySend,
  twoOwnStacks,
} from './tutorial-mobile-copy.support';

const arrow = (id: string) => mintArrowId(id);

describe('Hit testing expands only for coarse pointers, only among candidates', () => {
  it('Fine pointer inside a polygon selects that arrow', () => {
    const { layout, viewport, a0 } = hitBoard();
    const { sx, sy } = insideClick(layout, viewport, a0);
    if (pipHit(layout, viewport, sx, sy, [a0]) !== a0) {
      throw new Error('setup: inside click is not a lattice PIP hit of a0');
    }
    const hit = hitArrow(layout, viewport, sx, sy, [a0], { paddingPx: 0 });
    expect(hit).toBe(a0);
    expect(pipHit(layout, viewport, sx, sy, [a0])).toBe(a0);
  });

  it('Coarse pointer within padding of a single candidate selects it', () => {
    expect(COARSE_HIT_PADDING_PX).toBe(24);
    const { layout, viewport, a0 } = hitBoard();
    const tap = nearMissClick(layout, viewport, a0, COARSE_HIT_PADDING_PX);
    if (pipHit(layout, viewport, tap.sx, tap.sy, [a0]) !== undefined) {
      throw new Error('setup: near-miss tap is still a lattice PIP hit');
    }
    const hit = hitArrow(layout, viewport, tap.sx, tap.sy, [a0], {
      paddingPx: COARSE_HIT_PADDING_PX,
    });
    expect(hit).toBe(a0);
  });

  it('Coarse overlapping candidates prefer the nearest centroid', () => {
    const { board, a0, a1, sx, sy } = overlapTap(COARSE_HIT_PADDING_PX);
    const hit = hitArrow(board.layout, board.viewport, sx, sy, [a0, a1], {
      paddingPx: COARSE_HIT_PADDING_PX,
    });
    expect(hit).toBe(a0);
  });

  it('Coarse padding never selects outside the candidate list', () => {
    const { layout, viewport, a0, far } = hitBoard();
    const tap = nearMissClick(layout, viewport, a0, COARSE_HIT_PADDING_PX);
    const hit = hitArrow(layout, viewport, tap.sx, tap.sy, [far], {
      paddingPx: COARSE_HIT_PADDING_PX,
    });
    expect(hit).toBeUndefined();
  });
});

describe('A finished single-exit rail sends without a second tap', () => {
  it('Single-exit expect with one allowed carry auto-Sends', () => {
    const step = firstExpect('L0');
    const state = openingOf(lesson('L0'));
    const restriction = restrictionFor(step);
    if (restriction === undefined) throw new Error('setup: L0 expect has no rail');
    const inner = new GalconInput(geometry);
    const { mode, sendCount } = spySend(inner);
    const decorated = decorateInputMode(mode, restriction);
    const exit = step.action.exits[0];
    if (exit === undefined) throw new Error('setup: L0 expect has no exit');
    decorated.onArrowClick(step.action.from, state, rules);
    const after = decorated.onArrowClick(exit, state, rules);
    expect(sendCount()).toBeGreaterThanOrEqual(1);
    expect(after.pending).toBeDefined();
    expect(after.pending?.length).toBeGreaterThan(0);
    expect(after.phase.kind).toBe('idle');
    expect(railAutoSends(step.action)).toBe(true);
  });

  it('Multi-exit expect still requires Send after the first exit', () => {
    const { state, from } = loneStack(4);
    const e0 = alongSlot0(from, 1);
    const e1 = alongSlot0(from, 2);
    const coach = 'Then tap Send under the board.';
    expect(coach).toMatch(/send/i);
    const inner = new GalconInput(geometry);
    const { mode, sendCount } = spySend(inner);
    const decorated = decorateInputMode(mode, {
      selectable: new Set([from]),
      clickable: new Set([e0, e1]),
      coach: () => coach,
    });
    decorated.onArrowClick(from, state, rules);
    const after = decorated.onArrowClick(e0, state, rules);
    expect(after.phase.kind).toBe('route');
    if (after.phase.kind !== 'route') return;
    expect(after.phase.draft.some((move) => move.kind === 'step' && move.exit === e0)).toBe(true);
    expect(after.pending).toBeUndefined();
    expect(sendCount()).toBe(0);
  });

  it('Off-rail coach appears in the stage banner and the HUD', () => {
    const step = firstExpect('L0');
    const C = step.coach;
    const { state, from, other } = twoOwnStacks();
    const mode = decorateInputMode(new GalconInput(geometry), {
      selectable: new Set([from]),
      clickable: new Set(),
      coach: () => C,
    });
    const snap = mode.onArrowClick(other, state, rules) as TutoredSnapshot;
    expect(snap.coach).toBe(C);
    const banner = stageBanner(step, snap.coach);
    expect(banner?.body).toBe(C);
  });

  it('Entering expect pans the source on-screen', () => {
    const step = firstExpect('L0');
    const layout = makeLayout();
    const poly = layout.polygon(step.action.from);
    const lattice = {
      x: poly.reduce((s, p) => s + p.x, 0) / (poly.length || 1),
      y: poly.reduce((s, p) => s + p.y, 0) / (poly.length || 1),
    };
    const viewport = createViewport(390, 844, { x: lattice.x + 40, y: lattice.y + 40 });
    const fromScreen = centroidScreen(viewport, poly);
    const off =
      fromScreen.x < 0 ||
      fromScreen.x > viewport.width ||
      fromScreen.y < 0 ||
      fromScreen.y > viewport.height;
    expect(off).toBe(true);
    expect(shouldPanToExpect({ step, draftLength: 0, fromScreen, viewport })).toBe(true);
    const panned = centerOn(viewport, lattice.x, lattice.y);
    const after = centroidScreen(panned, poly);
    expect(after.x).toBeGreaterThan(0);
    expect(after.x).toBeLessThan(panned.width);
    expect(after.y).toBeGreaterThan(0);
    expect(after.y).toBeLessThan(panned.height);
  });
});

describe('Copy names consequences, not the formula', () => {
  it('L0 narrate strings contain no log or floor formula', () => {
    const strings = learnerStringsOf(lesson('L0'));
    for (const text of strings) {
      expect(text, text).not.toMatch(SPEED_FORMULA);
    }
  });

  it('L0 states the doubling rule in plain language', () => {
    const narrates = lesson('L0')
      .steps.filter((step): step is Extract<LessonStep, { kind: 'narrate' }> => step.kind === 'narrate')
      .map((step) => step.text)
      .join('\n');
    expect(narrates).toMatch(/three heads.{0,80}two steps/i);
    expect(narrates).toMatch(/doubl\w*.{0,80}step/i);
  });

  it('Expect title is visible while the expect step is current', () => {
    const { session } = driveToKind('L0', 'expect');
    const step = session.step() as ExpectStep;
    const banner = stageBanner(step, step.coach);
    expect(banner?.title).toBe(step.title);
  });

  it('Coach that requires Send names the Send control', () => {
    const from = arrow('from');
    const step: ExpectStep = {
      kind: 'expect',
      title: 'Walk two hops',
      action: { kind: 'route', from, exits: [arrow('e0'), arrow('e1')] },
      coach: 'Then tap Send under the board.',
    };
    expect(railAutoSends(step.action)).toBe(false);
    expect(step.coach).toMatch(/send/i);
  });
});

describe('P43 regressions stay green', () => {
  it('The golden path still validates for every lesson', () => {
    for (const l of allLessons()) {
      expect(validateLesson(l).ok).toBe(true);
    }
  });

  it('Narrate Next and end Done still advance', () => {
    const { session } = driveToKind('L0', 'narrate');
    const before = session.stepIndex();
    session.next();
    expect(session.stepIndex()).toBe(before + 1);
    const endIndex = lesson('L0').steps.length - 1;
    const driven = driveTo('L0', (_step, index) => index >= endIndex);
    expect(driven.session.completed()).toBe(false);
    expect(driven.session.step().kind).toBe('end');
    driven.session.next();
    expect(driven.session.completed()).toBe(true);
  });

  it('Engine refusals still surface under the coach', () => {
    const { state, from } = loneStack(1);
    const far = alongSlot0(alongSlot0(from, 2), 1);
    const decorated = decorateInputMode(new GalconInput(geometry), {
      selectable: new Set([from]),
      clickable: new Set([alongSlot0(from, 1)]),
      coach: () => 'stay close',
    });
    const plain = new GalconInput(geometry).onArrowClick(far, state, rules);
    const snap = decorated.onArrowClick(far, state, rules) as TutoredSnapshot;
    expect(plain.refusal).toBeDefined();
    expect(snap.refusal).toEqual(plain.refusal);
    expect(snap.coach).toBe('stay close');
  });
});
