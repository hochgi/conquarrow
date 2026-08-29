/**
 * Shared fixtures for P48 spectated-turn camera tests.
 * Pure helpers only — no clock, no DOM, no rAF.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintArrowId } from '@conquarrow/contracts';
import type { ArrowId } from '@conquarrow/contracts';
import type { CameraTarget, Pt } from '../src/spectate';
import { FIT_PADDING } from '../src/spectate';
import type { Viewport } from '../src/viewport';
import { createViewport } from '../src/viewport';

const here = dirname(fileURLToPath(import.meta.url));

export const spectateSource = (): string =>
  readFileSync(join(here, '../src/spectate.ts'), 'utf8');

/** Source with comments stripped — prose says "replay window"; code must not say `window`. */
export const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

export const prefsSource = (): string => readFileSync(join(here, '../src/prefs.ts'), 'utf8');

/** The Background viewport: 800 by 600, lattice-mapped at scale 48. */
export const vp = (width = 800, height = 600, scale = 48): Viewport =>
  createViewport(width, height, { x: 0, y: 0 }, scale);

export const pt = (x: number, y: number): Pt => ({ x, y });

export const arrow = (id: string): ArrowId => mintArrowId(id);

export const arrows = (...ids: readonly string[]): readonly ArrowId[] => ids.map(arrow);

export const ownedSet = (...ids: readonly string[]): ReadonlySet<ArrowId> =>
  new Set(ids.map(arrow));

export const camera = (cx: number, cy: number, scale = 48): CameraTarget => ({ cx, cy, scale });

/** Is a lattice point inside the rectangle a camera target shows? */
export const showsPoint = (target: CameraTarget, viewport: Viewport, p: Pt): boolean =>
  Math.abs(p.x - target.cx) * target.scale <= viewport.width / 2 + 1e-9 &&
  Math.abs(p.y - target.cy) * target.scale <= viewport.height / 2 + 1e-9;

/** Half extents of a bounds after `FIT_PADDING`, as the normative fit defines them. */
export const paddedHalf = (min: number, max: number): number => (max - min) / 2 + FIT_PADDING;

/**
 * A deterministic point cloud generator for property tests — no `Math.random`,
 * a plain integer LCG over a caller-supplied seed.
 */
export const pointCloud = (seed: number, count: number): readonly Pt[] => {
  const out: Pt[] = [];
  let s = ((seed * 48271) % 2147483647) + 1;
  for (let i = 0; i < count; i += 1) {
    s = (s * 48271) % 2147483647;
    const x = ((s % 61) - 30) / 4;
    s = (s * 48271) % 2147483647;
    const y = ((s % 41) - 20) / 4;
    out.push({ x, y });
  }
  return out;
};
