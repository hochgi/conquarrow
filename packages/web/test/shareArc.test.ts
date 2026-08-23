import { describe, expect, it } from 'vitest';
import { compareArrows } from '@conquarrow/rules-core';
import { makeLayout, makeTiling } from '@conquarrow/geometry-tiling';
import { compassDeg, polygonCentroid, shareArcSpan } from '../src/shareArc';

const angDiff = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

describe('share arcs face their bordering tiles', () => {
  it('reads south and north-west in SVG layout space', () => {
    const origin = { x: 0, y: 0 };
    expect(compassDeg(origin, { x: 0, y: 1 })).toBeCloseTo(180, 5);
    expect(compassDeg(origin, { x: -1, y: -1 })).toBeCloseTo(315, 5);
  });

  it('centres each gauge on the share arrow, not on sorted id', () => {
    const geometry = makeTiling();
    const layout = makeLayout();
    const vertex = [...geometry.window(geometry.seedPoint(), 2).vertices][0];
    expect(vertex).toBeDefined();
    if (vertex === undefined) return;

    const centre = layout.vertexPosition(vertex);
    const borders = [...geometry.borderArrows(vertex)].toSorted(compareArrows);
    expect(borders).toHaveLength(3);

    const bearings = borders.map((arrow) => {
      const poly = layout.polygon(arrow);
      return compassDeg(centre, polygonCentroid(poly));
    });

    // Id-order slots were 60° / 180° / 300°. At least one real tile is elsewhere,
    // which is the misalignment on the board.
    const idMids = [60, 180, 300];
    expect(bearings.some((b, k) => angDiff(b, idMids[k] ?? 0) > 20)).toBe(true);

    for (const [k, arrow] of borders.entries()) {
      const span = shareArcSpan(centre, polygonCentroid(layout.polygon(arrow)));
      const mid = (span.from + span.to) / 2;
      const bearing = bearings[k];
      expect(bearing).toBeDefined();
      if (bearing === undefined) continue;
      expect(angDiff(mid, bearing)).toBeLessThan(0.01);
    }
  });
});
