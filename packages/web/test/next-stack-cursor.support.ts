/**
 * Shared fixtures for P50 next-stack-cursor tests.
 * Pure helpers only — no clock, no DOM, no React.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endTurn, mintArrowId, mintPlayerId, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PlayerId, RulesPort } from '@conquarrow/contracts';
import type { Viewport } from '../src/viewport';
import { createViewport } from '../src/viewport';

const here = dirname(fileURLToPath(import.meta.url));

export const appSource = (): string => readFileSync(join(here, '../src/App.tsx'), 'utf8');
export const hudSource = (): string => readFileSync(join(here, '../src/Hud.tsx'), 'utf8');
export const cursorSource = (): string =>
  readFileSync(join(here, '../src/selection/cursor.ts'), 'utf8');

/** Source with comments stripped — prose may say "skip"; code must not emit one. */
export const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

export const arrow = (id: string): ArrowId => mintArrowId(id);
export const arrows = (...ids: readonly string[]): readonly ArrowId[] => ids.map(arrow);

export const A: PlayerId = mintPlayerId('A');
export const B: PlayerId = mintPlayerId('B');

/** A destination arrow no fixture lists as movable unless it says so. */
export const SINK = arrow('z0');

/**
 * A stub state. The cursor module reads nothing from it — every fixture states
 * what is movable through `stubRules`. Frozen so an accidental write is loud.
 */
export const stubState = (activePlayer: PlayerId = A): GameState =>
  Object.freeze({ activePlayer } as unknown as GameState);

/**
 * A `RulesPort` whose `legalMoves` offers exactly one step out of each named
 * arrow, plus `endTurn`. Movable is what the rules offer — a stack with
 * allowance but no step simply is not listed here.
 *
 * `legalMoves` is deliberately emitted in a *scrambled* order (reversed), so a
 * cursor that leaned on the port's listing order instead of `compareArrows`
 * fails invariant 9.
 */
export const stubRules = (...movable: readonly string[]): RulesPort => {
  const moves: Move[] = movable
    .map((id) => step(arrow(id), SINK, 1) as Move)
    .reverse();
  moves.push(endTurn());
  return {
    legalMoves: (): readonly Move[] => moves,
  } as unknown as RulesPort;
};

/** Same movable set, offered in the given listing order — for the order-independence test. */
export const stubRulesOrdered = (order: readonly string[]): RulesPort => {
  const moves: Move[] = order.map((id) => step(arrow(id), SINK, 1) as Move);
  moves.push(endTurn());
  return {
    legalMoves: (): readonly Move[] => moves,
  } as unknown as RulesPort;
};

/** A rules stub that offers several steps out of the same arrow — dedup fixture. */
export const stubRulesWithDuplicates = (...movable: readonly string[]): RulesPort => {
  const moves: Move[] = [];
  for (const id of movable) {
    moves.push(step(arrow(id), SINK, 1));
    moves.push(step(arrow(id), arrow('z1'), 2));
  }
  moves.push(endTurn());
  return {
    legalMoves: (): readonly Move[] => moves,
  } as unknown as RulesPort;
};

export const vp = (width = 800, height = 600, scale = 48): Viewport =>
  createViewport(width, height, { x: 0, y: 0 }, scale);

/** Drive `advance` n times, collecting each position. */
export const lap = (
  advance: (cursor: ArrowId | undefined) => ArrowId | undefined,
  start: ArrowId | undefined,
  presses: number,
): readonly (ArrowId | undefined)[] => {
  const seen: (ArrowId | undefined)[] = [];
  let at = start;
  for (let i = 0; i < presses; i += 1) {
    at = advance(at);
    seen.push(at);
  }
  return seen;
};
