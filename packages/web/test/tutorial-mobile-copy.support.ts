/**
 * Fixtures for P44 tutorial mobile-copy tests.
 *
 * Hit cases use the real tiling layout so padding is genuine screen space.
 * Rails reuse P43's tutorial.support (lone stacks, catalogue, session driver).
 */

import type { ArrowId, GameState } from '@conquarrow/contracts';
import { makeLayout, makeTiling } from '@conquarrow/geometry-tiling';
import type { Point2, TilingLayout } from '@conquarrow/geometry-tiling';
import { centroidScreen } from '../src/boardGeom';
import { pointInPolygon } from '../src/hit';
import type { InputMode } from '../src/input/modes';
import { createViewport, toLattice, toScreen, type Viewport } from '../src/viewport';
import type { ExpectStep, LessonStep, ObjectiveStep } from '../src/tutorial/types';
import {
  A,
  B,
  allLessons,
  alongSlot0,
  driveTo,
  driveToKind,
  fold,
  geometry,
  legalSeats,
  lesson,
  loneStack,
  rules,
  sourceArrow,
} from './tutorial.support';

export { allLessons, alongSlot0, driveTo, driveToKind, fold, geometry, lesson, loneStack, rules };

export { openingOf } from '../src/tutorial/validate';

export const PHONE = { width: 390, height: 844 } as const;

export interface HitBoard {
  readonly layout: TilingLayout;
  readonly viewport: Viewport;
  readonly a0: ArrowId;
  readonly a1: ArrowId;
  readonly far: ArrowId;
}

const latticeCentroid = (poly: readonly Point2[]): Point2 => {
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  const n = poly.length || 1;
  return { x: sx / n, y: sy / n };
};

const distToSeg = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number => {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(px - ax, py - ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(px - bx, py - by);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
};

/** Screen-space distance to a lattice polygon (0 if the lattice point is inside). */
export const screenDistToPolygon = (
  layout: TilingLayout,
  viewport: Viewport,
  arrow: ArrowId,
  sx: number,
  sy: number,
): number => {
  const poly = layout.polygon(arrow);
  const lat = toLattice(viewport, sx, sy);
  if (pointInPolygon(lat.x, lat.y, poly)) return 0;
  const screen = poly.map((p) => toScreen(viewport, p.x, p.y));
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < screen.length; i += 1) {
    const a = screen[i];
    const b = screen[(i + 1) % screen.length];
    if (a === undefined || b === undefined) continue;
    best = Math.min(best, distToSeg(sx, sy, a.x, a.y, b.x, b.y));
  }
  return best;
};

/** A screen click whose lattice point is strictly inside `arrow`'s polygon. */
export const insideClick = (
  layout: TilingLayout,
  viewport: Viewport,
  arrow: ArrowId,
): { readonly sx: number; readonly sy: number } => {
  const poly = layout.polygon(arrow);
  const c = latticeCentroid(poly);
  const toTap = (x: number, y: number): { readonly sx: number; readonly sy: number } | undefined => {
    const screen = toScreen(viewport, x, y);
    const back = toLattice(viewport, screen.x, screen.y);
    return pointInPolygon(back.x, back.y, poly) ? { sx: screen.x, sy: screen.y } : undefined;
  };
  const fromCentroid = toTap(c.x, c.y);
  if (fromCentroid !== undefined) return fromCentroid;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const steps = 16;
  for (let i = 1; i < steps; i += 1) {
    for (let j = 1; j < steps; j += 1) {
      const x = minX + (i / steps) * (maxX - minX);
      const y = minY + (j / steps) * (maxY - minY);
      const tap = toTap(x, y);
      if (tap !== undefined) return tap;
    }
  }
  throw new Error('setup: no interior lattice point on this chevron');
};

/**
 * A tap outside `arrow`'s lattice polygon but within `paddingPx` of it in
 * screen space. Throws a setup error rather than silently picking a PIP hit.
 */
export const nearMissClick = (
  layout: TilingLayout,
  viewport: Viewport,
  arrow: ArrowId,
  paddingPx: number,
): { readonly sx: number; readonly sy: number; readonly dist: number } => {
  const poly = layout.polygon(arrow);
  const screen = poly.map((p) => toScreen(viewport, p.x, p.y));
  const c = centroidScreen(viewport, poly);
  for (let i = 0; i < screen.length; i += 1) {
    const a = screen[i];
    const b = screen[(i + 1) % screen.length];
    if (a === undefined || b === undefined) continue;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let nx = a.y - b.y;
    let ny = b.x - a.x;
    const nlen = Math.hypot(nx, ny) || 1;
    nx /= nlen;
    ny /= nlen;
    if ((mx - c.x) * nx + (my - c.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    for (const extra of [6, 10, 14, 18]) {
      const sx = mx + nx * extra;
      const sy = my + ny * extra;
      const lat = toLattice(viewport, sx, sy);
      if (pointInPolygon(lat.x, lat.y, poly)) continue;
      const dist = screenDistToPolygon(layout, viewport, arrow, sx, sy);
      if (dist > 0 && dist <= paddingPx) return { sx, sy, dist };
    }
  }
  throw new Error('setup: no near-miss tap within padding of the candidate polygon');
};

/** Oracle: lattice PIP among candidates, nearest lattice centroid wins. */
export const pipHit = (
  layout: TilingLayout,
  viewport: Viewport,
  sx: number,
  sy: number,
  candidates: readonly ArrowId[],
): ArrowId | undefined => {
  const { x, y } = toLattice(viewport, sx, sy);
  let best: ArrowId | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const arrow of candidates) {
    const poly = layout.polygon(arrow);
    if (!pointInPolygon(x, y, poly)) continue;
    const c = latticeCentroid(poly);
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = arrow;
    }
  }
  return best;
};

/** Oracle: PIP or screen-distance ≤ padding, nearest lattice centroid among hits. */
export const paddedHit = (
  layout: TilingLayout,
  viewport: Viewport,
  sx: number,
  sy: number,
  candidates: readonly ArrowId[],
  paddingPx: number,
): ArrowId | undefined => {
  const { x, y } = toLattice(viewport, sx, sy);
  let best: ArrowId | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const arrow of candidates) {
    const poly = layout.polygon(arrow);
    const near =
      pointInPolygon(x, y, poly) ||
      screenDistToPolygon(layout, viewport, arrow, sx, sy) <= paddingPx;
    if (!near) continue;
    const c = latticeCentroid(poly);
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = arrow;
    }
  }
  return best;
};

const farthestFrom = (arrows: readonly ArrowId[], layout: TilingLayout, a0: ArrowId): ArrowId => {
  const c0 = latticeCentroid(layout.polygon(a0));
  let best: ArrowId | undefined;
  let bestD = -1;
  for (const arrow of arrows) {
    if (arrow === a0) continue;
    const c = latticeCentroid(layout.polygon(arrow));
    const d = (c.x - c0.x) ** 2 + (c.y - c0.y) ** 2;
    if (d > bestD) {
      bestD = d;
      best = arrow;
    }
  }
  if (best === undefined) throw new Error('setup: window has no second arrow');
  return best;
};

/** Layout + viewport centred on a seed-window arrow, with a neighbour and a far tile. */
export const hitBoard = (): HitBoard => {
  const tiling = makeTiling();
  const layout = makeLayout();
  const arrows = tiling.window(tiling.seedPoint(), 8).arrows;
  const a0 = arrows[0];
  if (a0 === undefined) throw new Error('setup: empty tiling window');
  const a1 = arrows[1];
  if (a1 === undefined) throw new Error('setup: window has no neighbour');
  const viewport = createViewport(800, 600, latticeCentroid(layout.polygon(a0)), 48);
  return { layout, viewport, a0, a1, far: farthestFrom(arrows, layout, a0) };
};

export interface OverlapTap {
  readonly board: HitBoard;
  readonly a0: ArrowId;
  readonly a1: ArrowId;
  readonly sx: number;
  readonly sy: number;
}

const overlapCandidate = (
  layout: TilingLayout,
  viewport: Viewport,
  a0: ArrowId,
  a1: ArrowId,
  paddingPx: number,
): { readonly sx: number; readonly sy: number } | undefined => {
  const c0 = centroidScreen(viewport, layout.polygon(a0));
  const c1 = centroidScreen(viewport, layout.polygon(a1));
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  const span = Math.hypot(dx, dy) || 1;
  for (const t of [0.35, 0.45, 0.5, 0.55, 0.65]) {
    for (const side of [0, 8, -8]) {
      const sx = c0.x + t * dx + (-dy / span) * side;
      const sy = c0.y + t * dy + (dx / span) * side;
      const lat = toLattice(viewport, sx, sy);
      if (pointInPolygon(lat.x, lat.y, layout.polygon(a0))) continue;
      if (pointInPolygon(lat.x, lat.y, layout.polygon(a1))) continue;
      const d0 = screenDistToPolygon(layout, viewport, a0, sx, sy);
      const d1 = screenDistToPolygon(layout, viewport, a1, sx, sy);
      if (d0 > paddingPx || d1 > paddingPx) continue;
      const lc0 = latticeCentroid(layout.polygon(a0));
      const lc1 = latticeCentroid(layout.polygon(a1));
      const closer0 =
        (lc0.x - lat.x) ** 2 + (lc0.y - lat.y) ** 2 < (lc1.x - lat.x) ** 2 + (lc1.y - lat.y) ** 2;
      if (closer0) return { sx, sy };
    }
  }
  return undefined;
};

/**
 * A tap outside both polygons whose padded regions both contain it, with
 * `a0`'s lattice centroid closer to the tap's lattice point than `a1`'s.
 */
export const overlapTap = (paddingPx: number): OverlapTap => {
  const tiling = makeTiling();
  const layout = makeLayout();
  const arrows = tiling.window(tiling.seedPoint(), 3).arrows;
  const first = arrows[0];
  if (first === undefined) throw new Error('setup: empty window for overlap');
  const viewport = createViewport(800, 600, latticeCentroid(layout.polygon(first)), 48);
  for (const a0 of arrows) {
    for (const a1 of arrows) {
      if (a0 === a1) continue;
      const tap = overlapCandidate(layout, viewport, a0, a1, paddingPx);
      if (tap === undefined) continue;
      return {
        a0,
        a1,
        sx: tap.sx,
        sy: tap.sy,
        board: { layout, viewport, a0, a1, far: farthestFrom(arrows, layout, a0) },
      };
    }
  }
  throw new Error('setup: no overlapping padded near-miss on the tiling window');
};

/** Two own stacks so an off-rail idle click has a stack that is not the rail source. */
export const twoOwnStacks = (): { state: GameState; from: ArrowId; other: ArrowId } => {
  const from = sourceArrow(geometry);
  const other = alongSlot0(from, 4);
  return {
    from,
    other,
    state: legalSeats({
      players: [A, B],
      activePlayer: A,
      groups: new Map([
        [from, { owner: A, heads: 4, spent: 0 }],
        [other, { owner: A, heads: 2, spent: 0 }],
      ]),
      trails: new Map(),
      territory: new Map(),
      accumulators: new Map(),
      spawners: new Map(),
      starvationStreaks: new Map(),
      dominationN: 5,
      winner: undefined,
    }),
  };
};

export const firstOfKind = <K extends LessonStep['kind']>(
  id: string,
  kind: K,
): Extract<LessonStep, { kind: K }> => {
  const step = lesson(id).steps.find((entry) => entry.kind === kind);
  if (step === undefined || step.kind !== kind) {
    throw new Error(`setup: ${id} has no ${kind} step`);
  }
  return step as Extract<LessonStep, { kind: K }>;
};

export const firstExpect = (id: string): ExpectStep => firstOfKind(id, 'expect');
export const firstObjective = (id: string): ObjectiveStep => firstOfKind(id, 'objective');

/** Wrap an input mode, counting `send` and optionally replacing it. */
export const spySend = (
  inner: InputMode,
  send: InputMode['send'] = () => inner.send(),
): { readonly mode: InputMode; readonly sendCount: () => number } => {
  let n = 0;
  const mode: InputMode = {
    get id() {
      return inner.id;
    },
    get label() {
      return inner.label;
    },
    reset: () => inner.reset(),
    onArrowClick: (arrow, state, rules) => inner.onArrowClick(arrow, state, rules),
    onBackgroundClick: () => inner.onBackgroundClick(),
    setCarry: (count) => inner.setCarry(count),
    send: () => {
      n += 1;
      return send();
    },
    cancel: () => inner.cancel(),
    requestEndTurn: () => inner.requestEndTurn(),
  };
  return { mode, sendCount: () => n };
};

export const boxContains = (
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  p: { readonly x: number; readonly y: number },
): boolean =>
  p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;
