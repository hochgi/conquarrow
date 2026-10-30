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
import { HIGHLIGHT_STROKE, PATH_STROKE, PREVIEW_STROKE } from './colors';
import type { InputHighlights, InputPhase } from './input/modes';

export type PointerKind = 'fine' | 'coarse';

export const REACH_WASH_PEAK = 0.22;
export const REACH_WASH_FLOOR = 0.08;
export const SELECTED_HALO_STROKE = '#f4efe4';
export const SELECTED_WASH = 'rgba(255, 236, 180, 0.30)';
/** P77 widens the cream over-stroke so the marker reads on any fill at default zoom. */
export const SELECTED_STROKE_WIDTH = 6;
/**
 * The selected marker's dark under-stroke (P77), drawn at
 * `SELECTED_STROKE_WIDTH + 4` beneath the cream over-stroke — so the marker
 * keeps its edge on a pale territory fill as well as on the dark board.
 */
export const SELECTED_UNDER_STROKE = '#0b1016';
/**
 * The multi-run mark's dashed neutral outline (P77): reachable this turn, but
 * not in one run. A different kind of fact from the two lit tiers, so it is not
 * another shade of their hue.
 */
export const MULTI_RUN_STROKE = '#a3a9b0';

/** The route paint tiers (P77). */
export type RouteTier = 'drafted' | 'one-run' | 'multi-run' | 'merge';

export interface TierStyle {
  readonly stroke: string;
  readonly width: number;
  /** An SVG `strokeDasharray`; absent for a solid stroke. */
  readonly dash?: string;
}

const TIER_STYLES: Readonly<Record<RouteTier, TierStyle>> = {
  drafted: { stroke: PATH_STROKE, width: 3 },
  // Rays and turns alike: both are one click away.
  'one-run': { stroke: PREVIEW_STROKE, width: 2.6 },
  'multi-run': { stroke: MULTI_RUN_STROKE, width: 1.5, dash: '4 3' },
  // Legal, but drafted from the strip — a click on the tile selects that stack.
  merge: { stroke: HIGHLIGHT_STROKE, width: 2.6, dash: '6 3' },
};

/** How each route tier is stroked (P77). Board reads it. */
export const tierStyle = (tier: RouteTier): TierStyle => TIER_STYLES[tier];

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
