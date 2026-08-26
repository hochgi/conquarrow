/**
 * P44 tutorial mobile-copy — EARS invariants
 * (docs/spec/tutorial-mobile-copy/tutorial-mobile-copy.md).
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * in `packages/web`. Replay of turn flow is unchanged: validateLesson stays
 * green and equal hit inputs reproduce equal hits.
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId } from '@conquarrow/contracts';
import { COARSE_HIT_PADDING_PX, hitArrow } from '../src/hit';
import { GalconInput } from '../src/input/modes';
import { decorateInputMode } from '../src/tutorial/restrict';
import {
  SPEED_FORMULA,
  learnerStrings,
  lessonTargets,
  railAutoSends,
  shouldPanToExpect,
  stageBanner,
} from '../src/tutorial/stage';
import type { ExpectStep, RouteAction } from '../src/tutorial/types';
import { createViewport } from '../src/viewport';
import { validateCatalogue, validateLesson } from '../src/tutorial/validate';
import {
  allLessons,
  alongSlot0,
  firstExpect,
  geometry,
  hitBoard,
  insideClick,
  lesson,
  loneStack,
  nearMissClick,
  paddedHit,
  pipHit,
  rules,
} from './tutorial-mobile-copy.support';

const arrow = (id: string) => mintArrowId(id);

describe('ubiquitous: RulesPort stays the sole authority on legality', () => {
  it('a decorated mode refuses exactly what the plain mode refuses', () => {
    const { state, from } = loneStack(1);
    const far = alongSlot0(alongSlot0(from, 2), 1);
    const decorated = decorateInputMode(new GalconInput(geometry), {
      coach: () => 'coach',
      selectable: new Set([from]),
    });
    const d = decorated.onArrowClick(far, state, rules);
    const p = new GalconInput(geometry).onArrowClick(far, state, rules);
    expect(d.refusal?.reason).toBe(p.refusal?.reason);
  });
});

describe('ubiquitous: fine-pointer hitArrow equals lattice point-in-polygon', () => {
  it('padding 0 matches the PIP oracle for inside, miss, and mixed candidates', () => {
    const { layout, viewport, a0, a1, far } = hitBoard();
    const taps = [
      insideClick(layout, viewport, a0),
      nearMissClick(layout, viewport, a0, COARSE_HIT_PADDING_PX),
      insideClick(layout, viewport, a1),
    ];
    const candidateSets = [[a0], [a0, a1], [a0, a1, far], [far]] as const;
    for (const tap of taps) {
      for (const candidates of candidateSets) {
        const hit = hitArrow(layout, viewport, tap.sx, tap.sy, candidates, { paddingPx: 0 });
        expect(hit).toBe(pipHit(layout, viewport, tap.sx, tap.sy, candidates));
      }
    }
  });
});

describe('ubiquitous: every learner string is free of the speed formula', () => {
  it('no catalogue or copy-template string matches SPEED_FORMULA', () => {
    const hits = learnerStrings().filter((text) => SPEED_FORMULA.test(text));
    expect(hits).toEqual([]);
  });
});

describe('state-driven: coarse pointer accepts a candidate within 24 CSS px', () => {
  it('a near-miss of each of several candidates hits that candidate under padding', () => {
    const { layout, viewport, a0, a1 } = hitBoard();
    for (const candidate of [a0, a1]) {
      const tap = nearMissClick(layout, viewport, candidate, COARSE_HIT_PADDING_PX);
      const hit = hitArrow(layout, viewport, tap.sx, tap.sy, [candidate], {
        paddingPx: COARSE_HIT_PADDING_PX,
      });
      expect(hit).toBe(paddedHit(layout, viewport, tap.sx, tap.sy, [candidate], COARSE_HIT_PADDING_PX));
      expect(hit).toBe(candidate);
    }
  });
});

describe('state-driven: single-exit singleton-carry rails auto-Send', () => {
  it('L0/L4-shaped rails auto-Send; multi-exit and multi-carry do not', () => {
    expect(railAutoSends(firstExpect('L0').action)).toBe(true);
    expect(railAutoSends(firstExpect('L4').action)).toBe(true);
    const from = arrow('from');
    const multi: RouteAction = { kind: 'route', from, exits: [arrow('e0'), arrow('e1')] };
    const carry: RouteAction = { kind: 'route', from, exits: [arrow('e0')], carryAllow: [1, 2] };
    const omitted: RouteAction = { kind: 'route', from, exits: [arrow('e0')] };
    const singleton: RouteAction = { kind: 'route', from, exits: [arrow('e0')], carryAllow: [2] };
    expect(railAutoSends(multi)).toBe(false);
    expect(railAutoSends(carry)).toBe(false);
    expect(railAutoSends(omitted)).toBe(true);
    expect(railAutoSends(singleton)).toBe(true);
  });
});

describe('state-driven: lesson-target wash is selectable union clickable', () => {
  it('the wash equals the union and never includes an off-rail own stack', () => {
    const { from } = loneStack(4);
    const clickable = alongSlot0(from, 1);
    const other = alongSlot0(from, 4);
    const restriction = {
      selectable: new Set([from]),
      clickable: new Set([clickable]),
      coach: () => '',
    };
    const targets = lessonTargets(restriction);
    expect(targets.has(from)).toBe(true);
    expect(targets.has(clickable)).toBe(true);
    expect(targets.size).toBe(2);
    expect(targets.has(other)).toBe(false);
  });
});

describe('event-driven: expect-entry pans only when from is off-screen and draft empty', () => {
  it('off-screen empty-draft expect pans; the three skip conditions do not', () => {
    const step = firstExpect('L0');
    const viewport = createViewport(390, 844);
    const off = { x: -40, y: -40 };
    const on = { x: viewport.width / 2, y: viewport.height / 2 };
    expect(shouldPanToExpect({ step, draftLength: 0, fromScreen: off, viewport })).toBe(true);
    expect(shouldPanToExpect({ step, draftLength: 1, fromScreen: off, viewport })).toBe(false);
    expect(shouldPanToExpect({ step, draftLength: 0, fromScreen: on, viewport })).toBe(false);
    const narrate = lesson('L0').steps[0];
    if (narrate === undefined) throw new Error('setup: L0 has no first step');
    expect(shouldPanToExpect({ step: narrate, draftLength: 0, fromScreen: off, viewport })).toBe(false);
  });
});

describe('event-driven: off-rail coach is the same string in banner and HUD', () => {
  it('stageBanner body equals the coach line passed in', () => {
    const step = firstExpect('L0');
    const banner = stageBanner(step, step.coach);
    expect(banner?.body).toBe(step.coach);
  });
});

describe('event-driven: expect title appears in the stage banner', () => {
  it('every shipped expect step surfaces its title as the banner title', () => {
    for (const l of allLessons()) {
      for (const step of l.steps) {
        if (step.kind !== 'expect') continue;
        expect(stageBanner(step, step.coach)?.title).toBe(step.title);
      }
    }
  });
});

describe('unwanted: padding never selects an arrow outside the candidate list', () => {
  it('a near-miss of a0 with candidates [far] is never a0', () => {
    const { layout, viewport, a0, far } = hitBoard();
    const tap = nearMissClick(layout, viewport, a0, COARSE_HIT_PADDING_PX);
    const hit = hitArrow(layout, viewport, tap.sx, tap.sy, [far], {
      paddingPx: COARSE_HIT_PADDING_PX,
    });
    expect(hit).not.toBe(a0);
    expect(hit).toBe(paddedHit(layout, viewport, tap.sx, tap.sy, [far], COARSE_HIT_PADDING_PX));
  });
});

describe('unwanted: a route draft in progress is not yanked', () => {
  it('draftLength > 0 is never a pan', () => {
    const step = firstExpect('L0');
    const viewport = createViewport(390, 844);
    expect(
      shouldPanToExpect({ step, draftLength: 3, fromScreen: { x: -10, y: -10 }, viewport }),
    ).toBe(false);
  });
});

describe('unwanted: a coach that requires Send names the Send control', () => {
  it('when auto-Send does not apply, the expect coach matches /send/i', () => {
    const step: ExpectStep = {
      kind: 'expect',
      title: 'Two hops',
      action: { kind: 'route', from: arrow('from'), exits: [arrow('e0'), arrow('e1')] },
      coach: 'Then tap Send under the board.',
    };
    expect(railAutoSends(step.action)).toBe(false);
    expect(step.coach).toMatch(/send/i);
    for (const l of allLessons()) {
      for (const entry of l.steps) {
        if (entry.kind !== 'expect') continue;
        if (railAutoSends(entry.action)) continue;
        expect(entry.coach).toMatch(/send/i);
      }
    }
  });
});

describe('determinism: equal hit inputs reproduce equal hits; lessons still validate', () => {
  it('the same layout, viewport, click and candidates yield the same hit twice', () => {
    const { layout, viewport, a0, a1 } = hitBoard();
    const taps = [insideClick(layout, viewport, a0), nearMissClick(layout, viewport, a0, 24)];
    for (const tap of taps) {
      for (const paddingPx of [0, 24, undefined]) {
        const options = paddingPx === undefined ? undefined : { paddingPx };
        const first = hitArrow(layout, viewport, tap.sx, tap.sy, [a0, a1], options);
        const second = hitArrow(layout, viewport, tap.sx, tap.sy, [a0, a1], options);
        expect(first).toBe(second);
      }
    }
  });

  it('every shipped lesson still validates', () => {
    for (const l of allLessons()) expect(validateLesson(l).ok).toBe(true);
    expect(validateCatalogue(allLessons()).ok).toBe(true);
  });
});
