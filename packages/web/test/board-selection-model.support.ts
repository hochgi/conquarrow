/**
 * Fixtures for P77 — the board selection model (web adapter only, no rule).
 *
 * docs/spec/board-selection-model/board-selection-model.md
 *
 * Pure helpers: no DOM, no React Testing Library, no clock. The input mode is
 * driven through `InputMode` exactly as `App.tsx` drives it; the strip's words
 * are read through the pure `selection/status.ts`, `fx/present.ts` and
 * `route.ts` helpers the spec names.
 *
 * Boards: the generated tiling for anything about a straight ray or a run of
 * several steps (a fixture board's short cycles truncate rays), the P02
 * `spacious` and `minimal` fixtures for the property bank's variety. Every
 * authored state goes through P37's `legalSeats`, so no seat is removed on the
 * first move.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { speed, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PlayerId, RulesPort } from '@conquarrow/contracts';
import { compareArrows } from '@conquarrow/rules-core';
import { REFUSAL_TEXT, refusalText } from '../src/fx/present';
import { Hud, type HudProps } from '../src/Hud';
import { GalconInput } from '../src/input/modes';
import type { InputMode, InputSnapshot, RoutePhase } from '../src/input/modes';
import { draftExits, runMoves } from '../src/route';
import { movableArrows } from '../src/selection/cursor';
import { turnStatus } from '../src/selection/status';
import {
  A,
  B,
  MINIMAL,
  SPACIOUS,
  arrowAlong,
  exitOf,
  fixtureBoard,
  geometry,
  legalSeats,
  refusingRules,
  rules,
  sourceArrow,
  blankState,
  type Board,
} from './ray-run-input.support';

export { A, B, arrowAlong, exitOf, geometry, rules, sourceArrow, refusingRules, type Board };

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(join(here, '../src', file), 'utf8');

export const appSource = (): string => read('App.tsx');
export const boardSource = (): string => read('Board.tsx');
export const dockSource = (): string => read('RouteDock.tsx');
export const stylesSource = (): string => read('styles.css');
export const sourceOf = (file: string): string => read(file);

/** Source with comments stripped — prose may name what code must not do. */
export const codeOf = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

export const tiling: Board = { geometry, rules };
export const spacious: Board = fixtureBoard(SPACIOUS);
export const minimal: Board = fixtureBoard(MINIMAL);

// ---------------------------------------------------------------------------
// Authoring states
// ---------------------------------------------------------------------------

export interface Placement {
  readonly arrow: ArrowId;
  readonly owner: PlayerId;
  readonly heads: number;
  /** Steps already taken this turn. `speed(heads)` means the stack is spent. */
  readonly spent?: number;
}

/** A legal board holding exactly these stacks, plus whatever ground a case adds. */
export const boardWith = (
  placements: readonly Placement[],
  extra: Partial<GameState> = {},
): GameState =>
  legalSeats({
    ...blankState(),
    groups: new Map(
      placements.map((p) => [p.arrow, { owner: p.owner, heads: p.heads, spent: p.spent ?? 0 }]),
    ),
    ...extra,
  });

/** A stack that has spent its whole allowance this turn — the engine refuses every exit. */
export const spentStack = (arrow: ArrowId, heads: number, owner: PlayerId = A): Placement => ({
  arrow,
  owner,
  heads,
  spent: speed(heads),
});

/** A deep copy to compare a state against after the gestures ran. */
export const snapshotOf = (state: GameState): GameState => structuredClone(state);

// ---------------------------------------------------------------------------
// The core feature's Background: S1 (2 heads) on a0, S2 (1 head) on b0
// ---------------------------------------------------------------------------

export interface TwoStacks {
  readonly state: GameState;
  /** S1, 2 heads. */
  readonly a0: ArrowId;
  /** S2, 1 head. One of b0's grain outs is a0, so a0 is a merge for S2. */
  readonly b0: ArrowId;
}

/**
 * b0 feeds the point a0 leaves from, so a0 is one of b0's three out-arrows and
 * S2's offer reaches a0 as a merge — the Background and core scenario 1.
 */
export const twoStacks = (): TwoStacks => {
  const a0 = sourceArrow(geometry);
  const b0 = geometry.inArrows(geometry.origin(a0))[0];
  if (b0 === undefined) throw new Error('setup: a0 has no feeder');
  const state = boardWith([
    { arrow: a0, owner: A, heads: 2 },
    { arrow: b0, owner: A, heads: 1 },
  ]);
  const movable = movableArrows(rules, state).map(String);
  if (!movable.includes(String(a0)) || !movable.includes(String(b0))) {
    throw new Error('setup: a0 and b0 must both be movable');
  }
  return { state, a0, b0 };
};

// ---------------------------------------------------------------------------
// The mode
// ---------------------------------------------------------------------------

export const makeMode = (board: Board = tiling): InputMode => new GalconInput(board.geometry);

export interface Session {
  readonly mode: InputMode;
  readonly state: GameState;
  readonly rules: RulesPort;
}

export const session = (state: GameState, board: Board = tiling, rulesPort?: RulesPort): Session => ({
  mode: makeMode(board),
  state,
  rules: rulesPort ?? board.rules,
});

export const click = (s: Session, arrow: ArrowId): InputSnapshot =>
  s.mode.onArrowClick(arrow, s.state, s.rules);

/** The explicit select — what Next stack, the turn anchor and the advance call. */
export const select = (s: Session, arrow: ArrowId): InputSnapshot =>
  s.mode.select(arrow, s.state, s.rules);

/**
 * Select `arrow` the way a player does before P77 lands: a click. Used only to
 * *reach* a selected state in a Given step — so a scenario about something else
 * is not red merely because `select` is new.
 */
export const clickSelect = (s: Session, arrow: ArrowId): InputSnapshot => click(s, arrow);

export const routeOf = (snap: InputSnapshot): RoutePhase => {
  if (snap.phase.kind !== 'route') {
    throw new Error(`setup: expected the route phase, got '${snap.phase.kind}'`);
  }
  return snap.phase;
};

export const selectedOf = (snap: InputSnapshot): ArrowId | undefined => snap.highlights.selected;

export const draftOf = (snap: InputSnapshot): readonly Move[] =>
  snap.phase.kind === 'route' ? snap.phase.draft : [];

export const exitsOf = (snap: InputSnapshot): readonly ArrowId[] => draftExits(draftOf(snap));

export const sortedIds = (arrows: Iterable<ArrowId>): string[] =>
  [...arrows].map(String).toSorted();

export const isOwnStack = (state: GameState, arrow: ArrowId): boolean =>
  state.groups.get(arrow)?.owner === state.activePlayer;

export const isEnemyStack = (state: GameState, arrow: ArrowId): boolean => {
  const owner = state.groups.get(arrow)?.owner;
  return owner !== undefined && owner !== state.activePlayer;
};

export const headsOn = (state: GameState, arrow: ArrowId): number =>
  state.groups.get(arrow)?.heads ?? 0;

// ---------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------

/**
 * Row 3 of the strip, read off one snapshot: the refusal's sentence if the
 * click was refused, otherwise the turn status. The spec's definition, composed
 * from the two pure helpers it names — nothing here decides wording.
 */
export const messageLine = (snap: InputSnapshot, movableCount: number): string =>
  snap.refusal === undefined
    ? turnStatus(movableCount)
    : refusalText(snap.refusal.reason, snap.highlights.selected);

export { REFUSAL_TEXT };

// ---------------------------------------------------------------------------
// Drafts the engine accepts
// ---------------------------------------------------------------------------

/**
 * Does `rules.apply` accept, step by step on the live board, the current draft
 * followed by the run that reaches `arrow`? The oracle behind invariant 5.
 */
export const acceptsDraftTo = (
  s: Session,
  phase: RoutePhase,
  arrow: ArrowId,
): boolean => {
  const option = phase.offer.clickable.get(arrow);
  if (option === undefined) return false;
  const moves = [...phase.draft, ...runMoves(phase.tip, option.steps, option.count)];
  let at = s.state;
  try {
    for (const move of moves) at = s.rules.apply(at, move);
  } catch {
    return false;
  }
  const last = moves[moves.length - 1];
  return last?.kind === 'step' && last.exit === arrow;
};

/** Every arrow `rules.apply` lets the tip step to, on the scratch state after the draft. */
export const scratchAfter = (s: Session, phase: RoutePhase): GameState => {
  let at = s.state;
  for (const move of phase.draft) at = s.rules.apply(at, move);
  return at;
};

// ---------------------------------------------------------------------------
// Refused self-convert exits — P28, measured on the tiling
// ---------------------------------------------------------------------------

export interface RefusedAtTip {
  readonly state: GameState;
  /** S1, stack grade, no territory-grade anchor. */
  readonly a0: ArrowId;
  /** A grain neighbour of a0 that is enemy territory — refused from the source. */
  readonly r0: ArrowId;
  /** One step along slot 0 from a0: the tip of a one-run draft. */
  readonly t1: ArrowId;
  /** A grain neighbour of t1 that is enemy territory — refused from the tip. */
  readonly r1: ArrowId;
}

/**
 * S1 on a stack-grade trail with enemy territory one grain out of the source
 * (slot 1) and one grain out of the tip one step along slot 0 (slot 1 again).
 */
export const refusedAtTip = (heads = 2): RefusedAtTip => {
  const a0 = sourceArrow(geometry);
  const r0 = exitOf(geometry, a0, 1);
  const t1 = exitOf(geometry, a0, 0);
  const r1 = exitOf(geometry, t1, 1);
  if (new Set([a0, r0, t1, r1].map(String)).size !== 4) {
    throw new Error('setup: a0, r0, t1 and r1 must be four different arrows');
  }
  const state = boardWith([{ arrow: a0, owner: A, heads }], {
    trails: new Map([[A, new Set([a0])]]),
    territory: new Map([
      [r0, B],
      [r1, B],
    ]),
  });
  if (rules.anchorGrade(state, a0, A) !== 'stack') {
    throw new Error('setup: expected a stack-grade fragment on a0');
  }
  return { state, a0, r0, t1, r1 };
};

/** The tip's grain neighbours. */
export const grainOuts = (board: Board, arrow: ArrowId): readonly ArrowId[] =>
  board.geometry.outArrows(board.geometry.target(arrow));

// ---------------------------------------------------------------------------
// The lap
// ---------------------------------------------------------------------------

/** Ids in `compareArrows` order. */
export const inLapOrder = (arrows: readonly ArrowId[]): readonly ArrowId[] =>
  arrows.toSorted(compareArrows);

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

// ---------------------------------------------------------------------------
// The HUD, rendered without a DOM
// ---------------------------------------------------------------------------

export interface HudVariant {
  readonly phase?: HudProps['phase'];
  readonly refusalNote?: string;
  readonly byokStatus?: string;
  readonly illegal?: string;
  /** A starvation clock lengthens the turn banner. */
  readonly starving?: boolean;
  readonly coach?: string;
  readonly tutorial?: boolean;
  readonly pauseOffered?: boolean;
}

const noop = (): void => undefined;

/**
 * Static markup for the HUD.
 *
 * Built with a type assertion rather than a checked literal on purpose: P77
 * moves the refusal out of the HUD, and a test that still *passes* the old prop
 * must not fail to compile when the prop is retired — it then simply proves the
 * text cannot reach the markup.
 */
export const renderHud = (variant: HudVariant = {}): string => {
  const state: GameState = variant.starving === true
    ? { ...blankState(), starvationStreaks: new Map([[A, 2]]) }
    : blankState();
  const props = {
    state,
    victory: { kind: 'playing' },
    phase: variant.phase ?? { kind: 'idle' },
    movableCount: 2,
    vsBot: false,
    byokActive: false,
    byokStatus: variant.byokStatus,
    botBusy: false,
    pauseOffered: variant.pauseOffered ?? false,
    pauseKind: 'running',
    manualPause: false,
    aiChair: false,
    onTogglePause: noop,
    seatSummary: 'A=human · B=human',
    moveCount: 0,
    matchSummary: undefined,
    heads: 3,
    land: 1,
    refusalNote: variant.refusalNote,
    soundOn: false,
    onToggleSound: noop,
    onEndTurn: noop,
    onNextStack: noop,
    onDownloadLog: noop,
    onNewMatch: noop,
    illegal: variant.illegal,
    ...(variant.tutorial === true
      ? {
          tutorial: {
            title: 'Lesson',
            practice: false,
            coach: variant.coach,
            onRestart: noop,
            onSkipLesson: noop,
          },
        }
      : {}),
  } as unknown as HudProps;
  return renderToStaticMarkup(createElement(Hud, props));
};

/** The markup from the start of the HUD through the end of its action row. */
export const throughActionRow = (html: string): string => {
  const start = html.indexOf('class="actions"');
  if (start < 0) throw new Error('setup: the HUD rendered no action row');
  const end = html.indexOf('</div>', start);
  if (end < 0) throw new Error('setup: the action row never closes');
  return html.slice(0, end + '</div>'.length);
};

/** The action row's own markup. */
export const actionRow = (html: string): string => {
  const start = html.indexOf('<div class="actions"');
  const end = html.indexOf('</div>', start);
  return html.slice(start, end + '</div>'.length);
};

/** The step the core feature sends: exactly one step move. */
export const oneStep = (from: ArrowId, exit: ArrowId, count: number): Move => step(from, exit, count);
