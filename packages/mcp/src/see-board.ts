/**
 * Simple SVG of the match R-window. Not an offer. ADR 0004.
 */

import type { ArrowId, GameState, GeometryPort } from '@conquarrow/contracts';
import { makeLayout, type Point2 } from '@conquarrow/geometry-tiling';

const layout = makeLayout();

const SEAT_FILL: Readonly<Record<string, string>> = {
  A: '#e0b050',
  B: '#50a0e0',
  C: '#e8734a',
  D: '#7fc47f',
  E: '#b98bd9',
  F: '#e05a7a',
};

const EMPTY_FILL = '#3a4a5a';
const EMPTY_STROKE = '#6a8098';
const TRAIL_OPACITY = '0.5';
const HIGHLIGHT_STROKE = '#f0c96a';

const fmt = (n: number): string => n.toFixed(4);

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const centroid = (pts: readonly Point2[]): Point2 => {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = pts.length === 0 ? 1 : pts.length;
  return { x: x / n, y: y / n };
};

const pointsAttr = (pts: readonly Point2[]): string =>
  pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');

const fillFor = (seat: string): string => SEAT_FILL[seat] ?? '#969ea6';

const arrowOwner = (
  state: GameState,
  arrow: ArrowId,
): { readonly kind: 'territory' | 'trail'; readonly seat: string } | undefined => {
  const terr = state.territory.get(arrow);
  if (terr !== undefined) return { kind: 'territory', seat: String(terr) };
  for (const [player, trail] of [...state.trails.entries()].toSorted((a, b) =>
    compareIds(String(a[0]), String(b[0])),
  )) {
    if (trail.has(arrow)) return { kind: 'trail', seat: String(player) };
  }
  return undefined;
};

export const renderBoardSvg = (
  geometry: GeometryPort,
  state: GameState,
  seat: string,
  radius: number,
): string => {
  const win = geometry.window(geometry.seedPoint(), radius);
  const arrows = [...win.arrows].toSorted((a, b) => compareIds(String(a), String(b)));
  const vertices = [...win.vertices].toSorted((a, b) => compareIds(String(a), String(b)));

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const grow = (p: Point2): void => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };

  const arrowPolys: { readonly id: string; readonly pts: readonly Point2[] }[] = [];
  for (const arrow of arrows) {
    const pts = layout.polygon(arrow);
    for (const p of pts) grow(p);
    arrowPolys.push({ id: String(arrow), pts });
  }
  for (const vertex of vertices) grow(layout.vertexPosition(vertex));

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  const pad = 0.5;
  const viewBox = `${fmt(minX - pad)} ${fmt(minY - pad)} ${fmt(maxX - minX + pad * 2)} ${fmt(maxY - minY + pad * 2)}`;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
  ];

  for (const { id, pts } of arrowPolys) {
    const owner = arrowOwner(state, id as ArrowId);
    const fill = owner === undefined ? EMPTY_FILL : fillFor(owner.seat);
    const opacity = owner?.kind === 'trail' ? ` fill-opacity="${TRAIL_OPACITY}"` : '';
    parts.push(
      `<polygon data-arrow="${esc(id)}" points="${pointsAttr(pts)}" fill="${fill}"${opacity} stroke="${EMPTY_STROKE}" stroke-width="0.02"/>`,
    );
  }

  for (const vertex of vertices) {
    if (!state.spawners.has(vertex)) continue;
    const p = layout.vertexPosition(vertex);
    parts.push(
      `<circle data-spawner="${esc(String(vertex))}" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="0.08" fill="#a0bcd6" stroke="#0b1016" stroke-width="0.02"/>`,
    );
  }

  const groups = [...state.groups.entries()].toSorted((a, b) =>
    compareIds(String(a[0]), String(b[0])),
  );
  const arrowSet = new Set(arrows.map(String));
  for (const [arrow, group] of groups) {
    if (!arrowSet.has(String(arrow))) continue;
    const pts = layout.polygon(arrow);
    const c = centroid(pts);
    const owner = String(group.owner);
    const highlight = owner === seat;
    const hl = highlight ? ' data-highlight="1"' : '';
    const stroke = highlight ? HIGHLIGHT_STROKE : '#141a21';
    const width = highlight ? '0.05' : '0.02';
    parts.push(
      `<circle data-group="${esc(String(arrow))}" data-owner="${esc(owner)}"${hl} cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="0.12" fill="${fillFor(owner)}" stroke="${stroke}" stroke-width="${width}"/>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
};
