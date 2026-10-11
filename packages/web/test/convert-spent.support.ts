/**
 * Shared fixtures for P70 convert-spent presentation tests.
 * Pure helpers and stylesheet reads — no React Testing Library.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArrowId, PlayerId } from '@conquarrow/contracts';
import type { GameEvent } from '../src/fx/events';
import { presentEvents, type FxOverlay } from '../src/fx/present';
import { SAFE_BOX, type CameraTarget, type Pt } from '../src/spectate';
import { toScreen, type Viewport } from '../src/viewport';

const here = dirname(fileURLToPath(import.meta.url));

export const stylesCss = (): string =>
  readFileSync(join(here, '../src/styles.css'), 'utf8');

export const A = 'A' as PlayerId;
export const B = 'B' as PlayerId;

export const convertedEvent = (
  arrow: ArrowId,
  heads: number,
  from: PlayerId = B,
  to: PlayerId = A,
): Extract<GameEvent, { kind: 'unitsConverted' }> => ({
  kind: 'unitsConverted',
  arrow,
  from,
  to,
  heads,
});

export const presentConversion = (
  events: readonly GameEvent[],
): readonly Extract<FxOverlay, { kind: 'conversion' }>[] =>
  presentEvents(events, { seq: 1 }).filter(
    (overlay): overlay is Extract<FxOverlay, { kind: 'conversion' }> =>
      overlay.kind === 'conversion',
  );

const blockOf = (css: string, needle: string): string => {
  const start = css.indexOf(needle);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
};

export const keyframeFillOpacities = (
  css: string,
  name: string,
): readonly { readonly at: string; readonly opacity: number }[] => {
  const body = blockOf(css, `@keyframes ${name}`);
  const stops: { readonly at: string; readonly opacity: number }[] = [];
  const re = /([\d.]+%)\s*\{([^}]*)\}/g;
  let match = re.exec(body);
  while (match !== null) {
    const at = match[1] ?? '';
    const inner = match[2] ?? '';
    const opacity = /fill-opacity:\s*([0-9.]+)/.exec(inner);
    if (opacity?.[1] !== undefined) {
      stops.push({ at, opacity: Number(opacity[1]) });
    }
    match = re.exec(body);
  }
  return stops;
};

export const classFillOpacity = (css: string, className: string): number | undefined => {
  const body = blockOf(css, `.${className}`);
  const match = /fill-opacity:\s*([0-9.]+)/.exec(body);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

export const animationNameOf = (css: string, className: string): string | undefined => {
  const body = blockOf(css, `.${className}`);
  const match = /animation-name:\s*([a-z0-9-]+)/.exec(body);
  return match?.[1];
};

export const animationDecl = (
  css: string,
  className: string,
  prop: string,
): string | undefined => {
  const body = blockOf(css, `.${className}`);
  const match = new RegExp(`${prop}:\\s*([^;]+)`).exec(body);
  return match?.[1]?.trim();
};

/** Is a lattice point inside the central SAFE_BOX of this camera shot? */
export const inSafeBox = (target: CameraTarget, viewport: Viewport, p: Pt): boolean => {
  const s = toScreen(
    { ...viewport, cx: target.cx, cy: target.cy, scale: target.scale },
    p.x,
    p.y,
  );
  const mx = (viewport.width * (1 - SAFE_BOX)) / 2;
  const my = (viewport.height * (1 - SAFE_BOX)) / 2;
  return (
    s.x >= mx - 1e-9 &&
    s.x <= viewport.width - mx + 1e-9 &&
    s.y >= my - 1e-9 &&
    s.y <= viewport.height - my + 1e-9
  );
};

export const arrow = (id: string): ArrowId => id as ArrowId;
