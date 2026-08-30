/**
 * Shared fixtures for P52 spectated-camera-grouping tests.
 * Pure helpers only — no clock, no DOM, no rAF, no `Math.random`.
 *
 * @see docs/spec/spectated-camera-grouping/spectated-camera-grouping.md
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintArrowId, step } from '@conquarrow/contracts';
import type { ArrowId, Move } from '@conquarrow/contracts';
import type { CameraGroup, CameraTarget, Pt } from '../src/spectate';
import {
  FIT_PADDING,
  SAFE_BOX,
  SPECTATE_ZOOM_MAX,
  arrowsOfMove,
  boundsOf,
} from '../src/spectate';
import type { Viewport } from '../src/viewport';
import { clampZoom, createViewport } from '../src/viewport';

const here = dirname(fileURLToPath(import.meta.url));

export const spectateSource = (): string =>
  readFileSync(join(here, '../src/spectate.ts'), 'utf8');

/** Source with comments stripped — prose may name things the code must not reference. */
export const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The Background viewport: 800 by 600, lattice-mapped at scale 48. */
export const vp = (width = 800, height = 600, scale = 48): Viewport =>
  createViewport(width, height, { x: 0, y: 0 }, scale);

export const pt = (x: number, y: number): Pt => ({ x, y });

export const arrow = (id: string): ArrowId => mintArrowId(id);

export const camera = (cx: number, cy: number, scale = 48): CameraTarget => ({ cx, cy, scale });

/** A turn expressed as one single-point beat per move — the feature files' `(x,y)` lists. */
export const beatsAt = (...points: readonly (readonly [number, number])[]): readonly (readonly Pt[])[] =>
  points.map(([x, y]) => [pt(x, y)]);

/** A beat that spans two lattice points, as a real step's `from` and `exit` do. */
export const spanBeat = (
  a: readonly [number, number],
  b: readonly [number, number],
): readonly Pt[] => [pt(a[0], a[1]), pt(b[0], b[1])];

/** A step naming two distinct arrows, so `arrowsOfMove` is non-empty. */
export const stepMove = (n: number): Move => step(arrow(`a${String(n)}`), arrow(`b${String(n)}`), 1);

/** App's own `Move -> beats` mapping, with a caller-supplied centroid table. */
export const beatsOfMoves = (
  moves: readonly Move[],
  centroid: (id: ArrowId) => Pt,
): readonly (readonly Pt[])[] =>
  moves.map(arrowsOfMove).filter((ids) => ids.length > 0).map((ids) => ids.map(centroid));

/**
 * The normative `groupScale` restated independently of the module under test,
 * so a fixture's expected framing is derived from the spec rather than the code.
 */
export const expectedScale = (points: readonly Pt[], viewport: Viewport): number => {
  const b = boundsOf(points);
  if (b === undefined) throw new Error('fixture: empty bounds');
  const halfW = (b.maxX - b.minX) / 2 + FIT_PADDING;
  const halfH = (b.maxY - b.minY) / 2 + FIT_PADDING;
  return Math.min(
    (SAFE_BOX * viewport.width) / (2 * halfW),
    (SAFE_BOX * viewport.height) / (2 * halfH),
  );
};

/** The display scale: the group scale capped at the ceiling, then globally clamped. */
export const expectedDisplay = (points: readonly Pt[], viewport: Viewport): number =>
  clampZoom(Math.min(expectedScale(points, viewport), SPECTATE_ZOOM_MAX));

/** Flatten the beats a `CameraGroup` covers. */
export const pointsOfGroup = (
  beats: readonly (readonly Pt[])[],
  group: CameraGroup,
): readonly Pt[] => beats.slice(group.from, group.to).flat();

/** Every contiguous partition of `n` items into exactly `k` non-empty parts, as split vectors. */
export const partitions = (n: number, k: number): readonly (readonly number[])[] => {
  if (k <= 0 || k > n) return [];
  if (k === 1) return [[]];
  const out: (readonly number[])[] = [];
  for (let first = 1; first <= n - (k - 1); first += 1) {
    for (const rest of partitions(n - first, k - 1)) {
      out.push([first, ...rest.map((s) => s + first)]);
    }
  }
  return out;
};

/** Group boundaries of a split vector, as `[from, to)` pairs. */
export const rangesOf = (n: number, splits: readonly number[]): readonly (readonly [number, number])[] => {
  const edges = [0, ...splits, n];
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    out.push([edges[i] ?? 0, edges[i + 1] ?? 0]);
  }
  return out;
};

/** A partition's display scales, sorted ascending — the leximaxmin score vector. */
export const scoreVector = (
  beats: readonly (readonly Pt[])[],
  splits: readonly number[],
  viewport: Viewport,
): readonly number[] =>
  rangesOf(beats.length, splits)
    .map(([from, to]) => expectedDisplay(beats.slice(from, to).flat(), viewport))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Lexicographic comparison of two ascending score vectors: larger wins. */
export const compareScores = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? -Infinity;
    const y = b[i] ?? -Infinity;
    if (Math.abs(x - y) > 1e-9) return x < y ? -1 : (1 as const);
  }
  return 0;
};

/**
 * A deterministic beat generator for property tests — a plain integer LCG over a
 * caller-supplied seed. No `Math.random` anywhere.
 */
export const beatCloud = (seed: number, count: number): readonly (readonly Pt[])[] => {
  const out: (readonly Pt[])[] = [];
  let s = ((seed * 48271) % 2147483647) + 1;
  const next = (mod: number): number => {
    s = (s * 48271) % 2147483647;
    return s % mod;
  };
  for (let i = 0; i < count; i += 1) {
    const x = next(97) - 48;
    const y = (next(41) - 20) / 2;
    const wide = next(3) === 0;
    out.push(wide ? [pt(x, y), pt(x + (next(9) - 4), y + (next(5) - 2))] : [pt(x, y)]);
  }
  return out;
};
