/**
 * P44 tutorial mobile-copy — edge cases
 * (docs/spec/tutorial-mobile-copy/tutorial-mobile-copy.edge-cases.feature).
 *
 * Honesty under misuse: padding does not steal a far arrow, auto-Send does not
 * fire early, and the viewport does not yank a draft.
 */

import { describe, expect, it } from 'vitest';
import { makeLayout } from '@conquarrow/geometry-tiling';
import { centroidScreen } from '../src/boardGeom';
import { COARSE_HIT_PADDING_PX, hitArrow } from '../src/hit';
import { GalconInput } from '../src/input/modes';
import { decorateInputMode, restrictionFor } from '../src/tutorial/restrict';
import type { TutoredSnapshot } from '../src/tutorial/restrict';
import {
  SPEED_FORMULA,
  learnerStrings,
  learnerStringsOf,
  lessonTargets,
  narrateCardBox,
  railAutoSends,
  shouldPanToExpect,
  stageBanner,
} from '../src/tutorial/stage';
import type { ExpectStep, LessonStep, RouteAction } from '../src/tutorial/types';
import { createViewport } from '../src/viewport';
import {
  PHONE,
  alongSlot0,
  boxContains,
  driveToKind,
  firstExpect,
  firstObjective,
  geometry,
  hitBoard,
  insideClick,
  lesson,
  loneStack,
  nearMissClick,
  openingOf,
  pipHit,
  rules,
  spySend,
} from './tutorial-mobile-copy.support';

describe('Fine pointers and non-candidates stay exact', () => {
  it('Fine pointer within coarse padding but outside the polygon misses', () => {
    const { layout, viewport, a0 } = hitBoard();
    const tap = nearMissClick(layout, viewport, a0, COARSE_HIT_PADDING_PX);
    const hit = hitArrow(layout, viewport, tap.sx, tap.sy, [a0], { paddingPx: 0 });
    expect(hit).toBeUndefined();
    expect(pipHit(layout, viewport, tap.sx, tap.sy, [a0])).toBeUndefined();
  });

  it('Padding 0 matches today\'s point-in-polygon', () => {
    const { layout, viewport, a0, a1 } = hitBoard();
    const inside = insideClick(layout, viewport, a0);
    const miss = nearMissClick(layout, viewport, a0, COARSE_HIT_PADDING_PX);
    for (const tap of [inside, miss]) {
      const omitted = hitArrow(layout, viewport, tap.sx, tap.sy, [a0, a1]);
      const zero = hitArrow(layout, viewport, tap.sx, tap.sy, [a0, a1], { paddingPx: 0 });
      expect(zero).toBe(omitted);
      expect(zero).toBe(pipHit(layout, viewport, tap.sx, tap.sy, [a0, a1]));
    }
  });

  it('A far own stack is not a lesson-target', () => {
    const { from } = loneStack(4);
    const other = alongSlot0(from, 4);
    const restriction = {
      selectable: new Set([from]),
      clickable: new Set<typeof from>(),
      coach: () => '',
    };
    const targets = lessonTargets(restriction);
    expect(targets.has(from)).toBe(true);
    expect(targets.has(other)).toBe(false);
  });
});

describe('Auto-Send does not invent a send', () => {
  it('Multi-value carryAllow does not auto-Send', () => {
    const { from } = loneStack(4);
    const e0 = alongSlot0(from, 1);
    const action: RouteAction = { kind: 'route', from, exits: [e0], carryAllow: [1, 2] };
    expect(railAutoSends(action)).toBe(false);
    const step: ExpectStep = {
      kind: 'expect',
      title: 'Choose a carry',
      action,
      coach: 'Set the count, then tap Send under the board.',
    };
    expect(step.coach).toMatch(/send/i);
  });

  it('Auto-Send still uses the ordinary send path', () => {
    const step = firstExpect('L0');
    const state = openingOf(lesson('L0'));
    const restriction = restrictionFor(step);
    if (restriction === undefined) throw new Error('setup: L0 expect has no rail');
    const exit = step.action.exits[0];
    if (exit === undefined) throw new Error('setup: L0 expect has no exit');

    const control = new GalconInput(geometry);
    control.onArrowClick(step.action.from, state, rules);
    const drafted = control.onArrowClick(exit, state, rules);
    const expected = drafted.pending !== undefined ? drafted : control.send();

    const inner = new GalconInput(geometry);
    const { mode, sendCount } = spySend(inner);
    const decorated = decorateInputMode(mode, restriction);
    decorated.onArrowClick(step.action.from, state, rules);
    const after = decorated.onArrowClick(exit, state, rules);
    expect(sendCount()).toBe(1);
    expect(after.pending).toEqual(expected.pending);
    expect(after.phase.kind).toBe('idle');
  });

  it('An engine-illegal send is still refused', () => {
    const step = firstExpect('L0');
    const state = openingOf(lesson('L0'));
    const restriction = restrictionFor(step);
    if (restriction === undefined) throw new Error('setup: L0 expect has no rail');
    const exit = step.action.exits[0];
    if (exit === undefined) throw new Error('setup: L0 expect has no exit');
    const galcon = new GalconInput(geometry);
    const { mode, sendCount } = spySend(galcon, () => {
      const snap = galcon.send();
      return { ...snap, refusal: { arrow: exit, reason: 'out-of-reach' } };
    });
    const decorated = decorateInputMode(mode, restriction);
    decorated.onArrowClick(step.action.from, state, rules);
    const after = decorated.onArrowClick(exit, state, rules) as TutoredSnapshot;
    expect(sendCount()).toBe(1);
    expect(after.refusal).toEqual({ arrow: exit, reason: 'out-of-reach' });
    expect(after.coach).toBe(step.coach);
  });
});

describe('Pan does not yank a draft', () => {
  const offscreenExpect = (): {
    readonly step: ExpectStep;
    readonly fromScreen: { readonly x: number; readonly y: number };
    readonly viewport: ReturnType<typeof createViewport>;
  } => {
    const step = firstExpect('L0');
    const layout = makeLayout();
    const poly = layout.polygon(step.action.from);
    const lattice = {
      x: poly.reduce((s, p) => s + p.x, 0) / (poly.length || 1),
      y: poly.reduce((s, p) => s + p.y, 0) / (poly.length || 1),
    };
    const viewport = createViewport(PHONE.width, PHONE.height, {
      x: lattice.x + 40,
      y: lattice.y + 40,
    });
    return { step, viewport, fromScreen: centroidScreen(viewport, poly) };
  };

  it('Expect-entry pan is skipped while a draft is in progress', () => {
    const { step, fromScreen, viewport } = offscreenExpect();
    expect(shouldPanToExpect({ step, draftLength: 1, fromScreen, viewport })).toBe(false);
  });

  it('Expect-entry pan is skipped when from is already on-screen', () => {
    const step = firstExpect('L0');
    const layout = makeLayout();
    const poly = layout.polygon(step.action.from);
    const lattice = {
      x: poly.reduce((s, p) => s + p.x, 0) / (poly.length || 1),
      y: poly.reduce((s, p) => s + p.y, 0) / (poly.length || 1),
    };
    const viewport = createViewport(PHONE.width, PHONE.height, lattice);
    const fromScreen = centroidScreen(viewport, poly);
    expect(fromScreen.x).toBeGreaterThan(0);
    expect(fromScreen.x).toBeLessThan(viewport.width);
    expect(shouldPanToExpect({ step, draftLength: 0, fromScreen, viewport })).toBe(false);
  });

  it('Pan does not run on narrate, demo, objective or end', () => {
    const { fromScreen, viewport } = offscreenExpect();
    const kinds: readonly LessonStep['kind'][] = ['narrate', 'demo', 'objective', 'end'];
    for (const kind of kinds) {
      const step = lesson('L5').steps.find((entry) => entry.kind === kind) ??
        lesson('L0').steps.find((entry) => entry.kind === kind) ??
        lesson('L3').steps.find((entry) => entry.kind === kind);
      if (step === undefined) throw new Error(`setup: no ${kind} step in L0/L3/L5`);
      expect(shouldPanToExpect({ step, draftLength: 0, fromScreen, viewport })).toBe(false);
    }
  });
});

describe('Banner and copy stay honest', () => {
  it('Stage banner and HUD coach are the same string', () => {
    const step = firstExpect('L0');
    const C = step.coach;
    const banner = stageBanner(step, C);
    expect(banner?.title).toBe(step.title);
    expect(banner?.body).toBe(C);
    expect(C).toBe(step.coach);
  });

  it('Objective banner shows the hint', () => {
    const { session } = driveToKind('L3', 'objective');
    const step = firstObjective('L3');
    expect(session.step().kind).toBe('objective');
    const banner = stageBanner(step, undefined);
    expect(banner?.body).toBe(step.hint);
  });

  it('No learner string contains the speed formula', () => {
    for (const text of learnerStrings()) {
      expect(text, text).not.toMatch(SPEED_FORMULA);
    }
  });

  it('L4 copy does not name the threat-weighted floor rule', () => {
    for (const text of learnerStringsOf(lesson('L4'))) {
      expect(text, text).not.toMatch(/threat-weighted/i);
    }
  });

  it('L7 copy names territory, shares and heads in plain outcomes', () => {
    const l7 = lesson('L7');
    const narrates = l7.steps.filter(
      (step): step is Extract<LessonStep, { kind: 'narrate' }> => step.kind === 'narrate',
    );
    expect(narrates.length).toBeGreaterThanOrEqual(2);
    const blob = narrates.map((step) => step.text).join('\n');
    expect(blob).toMatch(/territory/i);
    expect(blob).toMatch(/share/i);
    expect(blob).toMatch(/head/i);
    expect(blob).not.toMatch(SPEED_FORMULA);
  });

  it('Narrate with focus does not cover the focused arrow', () => {
    const step = lesson('L0').steps[0];
    if (step?.kind !== 'narrate') throw new Error('setup: L0 does not open on narrate');
    const home = step.focus?.[0];
    if (home === undefined) throw new Error('setup: L0 narrate has no focused stack');
    const layout = makeLayout();
    const poly = layout.polygon(home);
    const lattice = {
      x: poly.reduce((s, p) => s + p.x, 0) / (poly.length || 1),
      y: poly.reduce((s, p) => s + p.y, 0) / (poly.length || 1),
    };
    const viewport = createViewport(PHONE.width, PHONE.height, lattice);
    const focusScreen = centroidScreen(viewport, poly);
    const box = narrateCardBox(viewport, focusScreen);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(boxContains(box, focusScreen)).toBe(false);
  });
});
