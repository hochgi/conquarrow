/**
 * Hit-test lattice polygons against a screen click.
 */

import type { ArrowId, VertexId } from '@conquarrow/contracts';
import type { Point2, TilingLayout } from '@conquarrow/geometry-tiling';
import type { Viewport } from './viewport';
import { toLattice, toScreen } from './viewport';

/** Ray-cast point-in-polygon (lattice space). */
export const pointInPolygon = (x: number, y: number, poly: readonly Point2[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (pi === undefined || pj === undefined) continue;
    const intersect =
      pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
};

const centroid = (poly: readonly Point2[]): Point2 => {
  let sx = 0;
  let sy = 0;
  for (const p of poly) {
    sx += p.x;
    sy += p.y;
  }
  const n = poly.length || 1;
  return { x: sx / n, y: sy / n };
};

const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
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
export const distanceToPolygonScreen = (
  poly: readonly Point2[],
  viewport: Viewport,
  screenX: number,
  screenY: number,
): number => {
  const lat = toLattice(viewport, screenX, screenY);
  if (pointInPolygon(lat.x, lat.y, poly)) return 0;
  const screen = poly.map((p) => toScreen(viewport, p.x, p.y));
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < screen.length; i += 1) {
    const a = screen[i];
    const b = screen[(i + 1) % screen.length];
    if (a === undefined || b === undefined) continue;
    best = Math.min(best, distToSeg(screenX, screenY, a.x, a.y, b.x, b.y));
  }
  return best;
};

const hitsCandidate = (
  poly: readonly Point2[],
  viewport: Viewport,
  latticeX: number,
  latticeY: number,
  screenX: number,
  screenY: number,
  paddingPx: number,
): boolean => {
  if (pointInPolygon(latticeX, latticeY, poly)) return true;
  return paddingPx > 0 && distanceToPolygonScreen(poly, viewport, screenX, screenY) <= paddingPx;
};

/** Screen-space fat-finger padding for coarse pointers (P44). */
export const COARSE_HIT_PADDING_PX = 24;

/** Optional last argument to {@link hitArrow}. Omitted / 0 keeps lattice PIP. */
export interface HitArrowOptions {
  readonly paddingPx?: number;
}

/**
 * Prefer the polygon whose centroid is closest to the click when several overlap
 * (chevron tips can nest).
 */
export const hitArrow = (
  layout: TilingLayout,
  viewport: Viewport,
  screenX: number,
  screenY: number,
  candidates: readonly ArrowId[],
  options?: HitArrowOptions,
): ArrowId | undefined => {
  const paddingPx = options?.paddingPx ?? 0;
  const { x, y } = toLattice(viewport, screenX, screenY);
  let best: ArrowId | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const arrow of candidates) {
    const poly = layout.polygon(arrow);
    if (!hitsCandidate(poly, viewport, x, y, screenX, screenY, paddingPx)) continue;
    const c = centroid(poly);
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = arrow;
    }
  }
  return best;
};

/**
 * Nearest spawner vertex to the cursor, within `radius` screen pixels.
 *
 * A vertex is not a tile and has no polygon to be inside (§7 — that is the whole reason
 * specials live there), so hovering one is a proximity test in **screen** space rather
 * than a hit test in lattice space. Screen space is also the right frame for the tolerance:
 * the target should stay the same size under the cursor at every zoom level.
 *
 * `candidates` must be the **spawner** vertices, not every vertex in view: nearest-vertex
 * over all of them lets a bare pinwheel centre a few pixels closer steal the hover from the
 * spawner the cursor is on.
 */
export const hitSpawnerVertex = (
  layout: TilingLayout,
  viewport: Viewport,
  screenX: number,
  screenY: number,
  candidates: Iterable<VertexId>,
  radius: number,
): VertexId | undefined => {
  let best: VertexId | undefined;
  let bestDist = radius * radius;
  for (const vertex of candidates) {
    const pos = layout.vertexPosition(vertex);
    const s = toScreen(viewport, pos.x, pos.y);
    const d = (s.x - screenX) ** 2 + (s.y - screenY) ** 2;
    if (d <= bestDist) {
      bestDist = d;
      best = vertex;
    }
  }
  return best;
};
