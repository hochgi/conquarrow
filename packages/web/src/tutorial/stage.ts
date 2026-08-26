/**
 * Tutorial stage chrome (P44) — pure decisions the overlay / HUD consume.
 *
 * React stays out of vitest. Copy lint helpers are collectors, not rewrites.
 */

import { DEFAULT_MATCH_CONFIG } from '@conquarrow/contracts';
import type { ArrowId } from '@conquarrow/contracts';
import type { Viewport } from '../viewport';
import { LESSONS } from './catalogue';
import { renderCopy } from './copy';
import type { RailRestriction } from './restrict';
import type { Lesson, LessonStep, RouteAction } from './types';

/** Learner-facing speed-formula pattern — must match nothing after P44 copy. */
export const SPEED_FORMULA = /log\s*[₂2]|⌊|floor\s*\(\s*log/i;

const COPY_KEYS = ['starvation-rounds', 'girth', 'speed-pair', 'speed-three'] as const;

/** Catalogue narrate / title / coach / hint / summary for one lesson. */
export const learnerStringsOf = (lesson: Lesson): readonly string[] => {
  const out: string[] = [lesson.title];
  for (const step of lesson.steps) {
    if (step.kind === 'narrate') out.push(step.text);
    if (step.kind === 'expect') {
      out.push(step.title, step.coach);
    }
    if (step.kind === 'objective') out.push(step.hint);
    if (step.kind === 'end') out.push(step.summary);
  }
  return out;
};

/**
 * Every shipped learner string: catalogue fields plus `copy.ts` templates
 * rendered against `DEFAULT_MATCH_CONFIG`. `COPY_KEYS` is authored here, so a
 * missing template is a broken scan, not a skip.
 */
export const learnerStrings = (): readonly string[] => {
  const out: string[] = [];
  for (const lesson of LESSONS) out.push(...learnerStringsOf(lesson));
  for (const key of COPY_KEYS) {
    out.push(renderCopy(key, DEFAULT_MATCH_CONFIG));
  }
  return out;
};

/** True iff a finished rail has nothing left to decide (single exit, singleton carry). */
export const railAutoSends = (action: RouteAction): boolean =>
  action.exits.length === 1 && (action.carryAllow === undefined || action.carryAllow.length === 1);

export interface StageBanner {
  readonly title?: string;
  readonly body?: string;
}

/** Board-adjacent banner for expect (title + coach) and objective (hint as body). */
export const stageBanner = (
  step: LessonStep,
  coach: string | undefined,
): StageBanner | undefined => {
  if (step.kind === 'expect') {
    return coach === undefined ? { title: step.title } : { title: step.title, body: coach };
  }
  if (step.kind === 'objective') return { body: step.hint };
  return undefined;
};

const screenInViewport = (
  p: { readonly x: number; readonly y: number },
  viewport: Viewport,
): boolean =>
  p.x >= 0 && p.x <= viewport.width && p.y >= 0 && p.y <= viewport.height;

/** True only on expect-entry: empty draft and `from` off-screen. */
export const shouldPanToExpect = (args: {
  readonly step: LessonStep;
  readonly draftLength: number;
  readonly fromScreen: { readonly x: number; readonly y: number };
  readonly viewport: Viewport;
}): boolean =>
  args.step.kind === 'expect' &&
  args.draftLength === 0 &&
  !screenInViewport(args.fromScreen, args.viewport);

/** Lesson-target wash: `selectable ∪ clickable` of the active rail. */
export const lessonTargets = (restriction: RailRestriction): ReadonlySet<ArrowId> => {
  const out = new Set<ArrowId>();
  if (restriction.selectable !== undefined) {
    for (const arrow of restriction.selectable) out.add(arrow);
  }
  if (restriction.clickable !== undefined) {
    for (const arrow of restriction.clickable) out.add(arrow);
  }
  return out;
};

/** DOMRect-like box for the narrate/end card at a phone-width viewport. */
export interface CardBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const contains = (
  box: CardBox,
  p: { readonly x: number; readonly y: number },
): boolean =>
  p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;

/**
 * Place the narrate card so it does not cover `focusScreen` (the focused
 * stack's screen centroid). Phone-width: a short card at the top or bottom.
 */
export const narrateCardBox = (
  viewport: Viewport,
  focusScreen: { readonly x: number; readonly y: number },
): CardBox => {
  const gutter = 16;
  const width = Math.max(1, viewport.width - gutter * 2);
  const height = Math.max(1, Math.min(168, viewport.height * 0.22));
  const x = gutter;
  const top: CardBox = { x, y: gutter, width, height };
  const bottom: CardBox = {
    x,
    y: Math.max(gutter, viewport.height - gutter - height),
    width,
    height,
  };
  const preferBottom = focusScreen.y < viewport.height / 2;
  const first = preferBottom ? bottom : top;
  if (!contains(first, focusScreen)) return first;
  const second = preferBottom ? top : bottom;
  if (!contains(second, focusScreen)) return second;
  return first;
};
