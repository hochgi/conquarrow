/**
 * Selection chrome — the selected halo, and the quiet floor the reach wash sits on.
 *
 * Packet P31, trimmed by P34. P31's deferred cost (a min-count numeral on the
 * hovered destination) and its path-only commit both belonged to
 * source → destination → portion, and P34 retired that flow: there is no
 * destination to hover a price for, and no dialog to wash a path under. What
 * survives is the halo that says *this stack is selected* and the wash floor the
 * route's faintest tier is drawn at (`route.ts`).
 *
 * Pure: equal phase + highlights + pointer kind → equal paint. No clocks, no RNG.
 */

import type { ArrowId } from '@conquarrow/contracts';
import type { InputHighlights, InputPhase } from './input/modes';

export type PointerKind = 'fine' | 'coarse';

export const REACH_WASH_PEAK = 0.22;
export const REACH_WASH_FLOOR = 0.08;
export const SELECTED_HALO_STROKE = '#f4efe4';
export const SELECTED_WASH = 'rgba(255, 236, 180, 0.30)';
export const SELECTED_STROKE_WIDTH = 4.8;
/**
 * P77 skeleton — the selected marker's dark under-stroke (drawn at
 * `SELECTED_STROKE_WIDTH + 4` beneath the cream over-stroke). Not chosen yet.
 */
export const SELECTED_UNDER_STROKE = '';
/** P77 skeleton — the multi-run mark's dashed neutral outline. Not chosen yet. */
export const MULTI_RUN_STROKE = '';

/** The route paint tiers (P77). */
export type RouteTier = 'drafted' | 'one-run' | 'multi-run' | 'merge';

export interface TierStyle {
  readonly stroke: string;
  readonly width: number;
  /** An SVG `strokeDasharray`; absent for a solid stroke. */
  readonly dash?: string;
}

/** How each route tier is stroked (P77). Board reads it. */
export const tierStyle = (tier: RouteTier): TierStyle => {
  throw new Error(`not implemented: tierStyle(${tier}) (P77)`);
};

export interface SelectionPaint {
  readonly selected?: ArrowId;
  readonly selectedEmphasis: boolean;
}

export const selectionPaint = (opts: {
  readonly phase: InputPhase;
  readonly highlights: InputHighlights;
  readonly hoverArrow?: ArrowId;
  readonly pointer: PointerKind;
}): SelectionPaint => {
  const selected = opts.highlights.selected;
  // A halo, not a wash: P31's finding was that washing the source made the
  // *reach* read as the selection. Emphasis follows the selection itself, so the
  // route phase and the blocked phase both mark their source.
  return selected === undefined
    ? { selectedEmphasis: false }
    : { selected, selectedEmphasis: true };
};
