/**
 * Fixtures and oracles for P35 — name the route, then say how many heads walk it.
 *
 * Built on P34's support (`ray-run-input.support.ts`), which already owns the two
 * boards, the state builders and the input-mode helpers. What is new here is the
 * **run** as a unit: the counts that walk a whole run, where a run began, and how
 * a draft is built by clicking and *then* counting.
 *
 * The oracle for a run's offerable counts is deliberately not the implementation:
 * {@link countsThatWalk} walks `rules.apply` itself, step by step, at every count
 * from 1 up to the heads standing where the run began. If `runCarries` and this
 * disagree, one of them is wrong and the test says which numbers.
 */

import { step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, RulesPort, StepMove } from '@conquarrow/contracts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InputSnapshot, RoutePhase } from '../src/input/modes';
import { countControl, lastRunLength } from '../src/route';
import type { CountControl, LastRun, RouteInputs } from '../src/route';
import { exitOf, headsOn, routePhaseOf } from './ray-run-input.support';
import type { Board, Selected } from './ray-run-input.support';

export * from './ray-run-input.support';

const here = dirname(fileURLToPath(import.meta.url));

export const readSource = (relative: string): string =>
  readFileSync(join(here, '../src', relative), 'utf8');

// ---------------------------------------------------------------------------
// The oracle: which counts walk a whole run
// ---------------------------------------------------------------------------

/**
 * Every count from 1 to the heads standing on `start` for which **all** of
 * `steps` is accepted, ascending.
 *
 * This is the spec's floor and ceiling in one measurement — "the least count for
 * which every step of that run validates under `rules.apply`", and "never a count
 * exceeding the heads standing on the arrow the last run started from" — and it
 * consults `speed()` nowhere.
 */
export const countsThatWalk = (
  rules: RulesPort,
  state: GameState,
  start: ArrowId,
  steps: readonly ArrowId[],
): readonly number[] => {
  const ceiling = headsOn(state, start);
  const out: number[] = [];
  for (let count = 1; count <= ceiling; count += 1) {
    let scratch = state;
    let at = start;
    let walked = true;
    for (const exit of steps) {
      try {
        scratch = rules.apply(scratch, step(at, exit, count));
      } catch {
        walked = false;
        break;
      }
      at = exit;
    }
    if (walked) out.push(count);
  }
  return out;
};

/** The floor: the least count the engine accepts for the whole run. */
export const leastCountThatWalks = (
  rules: RulesPort,
  state: GameState,
  start: ArrowId,
  steps: readonly ArrowId[],
): number => {
  const counts = countsThatWalk(rules, state, start, steps);
  const least = counts[0];
  if (least === undefined) {
    throw new Error(
      `setup: no count walks ${String(steps.length)} steps from ${String(start)} — the run is unwalkable`,
    );
  }
  return least;
};

/** The ceiling the offer drafts a run at: the largest count that walks it. */
export const largestCountThatWalks = (
  rules: RulesPort,
  state: GameState,
  start: ArrowId,
  steps: readonly ArrowId[],
): number => {
  const counts = countsThatWalk(rules, state, start, steps);
  const largest = counts[counts.length - 1];
  if (largest === undefined) {
    throw new Error(
      `setup: no count walks ${String(steps.length)} steps from ${String(start)} — the run is unwalkable`,
    );
  }
  return largest;
};

// ---------------------------------------------------------------------------
// The clickable-set oracle: unique-route words, then "does any count walk it?"
// ---------------------------------------------------------------------------

/** One candidate route word: `s^m` or `s^m·e` (P34's unique-route set). */
export interface Word {
  readonly steps: readonly ArrowId[];
  readonly arrow: ArrowId;
}

/**
 * Every `s^m` and `s^m·e` word out of `from`, up to `depth` steps, geometrically.
 *
 * Geometry only — no legality is asked here, which is what makes this an oracle
 * for *"an arrow is clickable iff some count walks the run that reaches it"*
 * rather than a second copy of `route.ts`'s ray construction.
 */
export const routeWords = (
  board: Board,
  from: ArrowId,
  depth: number,
): readonly Word[] => {
  const words: Word[] = [];
  for (const slot of [0, 1, 2]) {
    let at = from;
    const straight: ArrowId[] = [];
    for (let m = 1; m <= depth; m += 1) {
      at = exitOf(board.geometry, at, slot);
      straight.push(at);
      words.push({ steps: [...straight], arrow: at });
      for (const turn of [0, 1, 2]) {
        if (turn === slot) continue;
        const exit = exitOf(board.geometry, at, turn);
        words.push({ steps: [...straight, exit], arrow: exit });
      }
    }
  }
  return words;
};

/**
 * The arrows some count `<= heads` reaches by one of those words — invariant 4.
 *
 * Shorter words win where two land on the same arrow, as P34's ray-before-turn
 * keying does, and the source is never a destination.
 */
export const reachedBySomeCount = (
  board: Board,
  state: GameState,
  from: ArrowId,
  depth: number,
): ReadonlySet<ArrowId> => {
  const best = new Map<ArrowId, number>();
  for (const word of routeWords(board, from, depth)) {
    if (word.arrow === from) continue;
    if (word.steps.slice(0, -1).includes(word.arrow)) continue;
    if (countsThatWalk(board.rules, state, from, word.steps).length === 0) continue;
    const seen = best.get(word.arrow);
    if (seen !== undefined && seen <= word.steps.length) continue;
    best.set(word.arrow, word.steps.length);
  }
  return new Set(best.keys());
};

// ---------------------------------------------------------------------------
// Building a draft out of runs
// ---------------------------------------------------------------------------

/** One run of a hand-built draft: the exits it walks, and the count it walks at. */
export interface Run {
  readonly steps: readonly ArrowId[];
  readonly count: number;
}

export interface DraftedRuns {
  readonly draft: readonly Move[];
  /** The scratch state after the whole draft. */
  readonly state: GameState;
  /** The scratch state before the **last** run. */
  readonly runState: GameState;
  readonly tip: ArrowId;
  readonly lastRun: LastRun;
}

/** Walk a list of runs from `from`, and report everything `RouteInputs` needs. */
export const walkRuns = (
  board: Board,
  state: GameState,
  from: ArrowId,
  runs: readonly Run[],
): DraftedRuns => {
  const draft: Move[] = [];
  let scratch = state;
  let runState = state;
  let at = from;
  let start = from;
  let steps: readonly ArrowId[] = [];
  for (const run of runs) {
    runState = scratch;
    start = at;
    steps = run.steps;
    for (const exit of run.steps) {
      const move = step(at, exit, run.count);
      scratch = board.rules.apply(scratch, move);
      draft.push(move);
      at = exit;
    }
  }
  return {
    draft,
    state: scratch,
    runState,
    tip: at,
    lastRun: { state: runState, start, steps },
  };
};

/** `RouteInputs` for a draft built out of runs — the last run is the one counted. */
export const runInputs = (
  board: Board,
  state: GameState,
  from: ArrowId,
  runs: readonly Run[],
): RouteInputs => {
  const walked = walkRuns(board, state, from, runs);
  const last = runs[runs.length - 1];
  const tipHeads = headsOn(walked.state, walked.tip);
  return {
    geometry: board.geometry,
    rules: board.rules,
    state: walked.state,
    from,
    tip: walked.tip,
    draft: walked.draft,
    carry: last?.count ?? tipHeads,
    tipHeads,
    ...(runs.length === 0 ? {} : { lastRun: walked.lastRun }),
  };
};

/**
 * `RouteInputs` rebuilt from a phase's **own** draft, counts read off its moves.
 *
 * The last run is taken from `lastRunLength`, so this is how a test asks the pure
 * helper the same question the phase answered — with no second copy of the run
 * arithmetic in the test.
 */
export const inputsFromPhase = (
  board: Board,
  state: GameState,
  phase: RoutePhase,
): RouteInputs => {
  const boundary = phase.draft.length - lastRunLength(phase.runLengths);
  let scratch = state;
  let at = phase.from;
  for (const move of phase.draft.slice(0, boundary)) {
    if (move.kind !== 'step') continue;
    scratch = board.rules.apply(scratch, move);
    at = move.exit;
  }
  const runState = scratch;
  const start = at;
  const steps: ArrowId[] = [];
  for (const move of phase.draft.slice(boundary)) {
    if (move.kind !== 'step') continue;
    scratch = board.rules.apply(scratch, move);
    steps.push(move.exit);
    at = move.exit;
  }
  return {
    geometry: board.geometry,
    rules: board.rules,
    state: scratch,
    from: phase.from,
    tip: at,
    draft: phase.draft,
    carry: phase.carry,
    tipHeads: headsOn(scratch, at),
    ...(phase.draft.length === 0 ? {} : { lastRun: { state: runState, start, steps } }),
  };
};

// ---------------------------------------------------------------------------
// Driving the input mode: click first, count second
// ---------------------------------------------------------------------------

/** One click, and — if the run needs a different count — the count that follows it. */
export interface Click {
  readonly arrow: ArrowId;
  /** Set after the click, because P35 asks the count *after* the route. */
  readonly count?: number;
}

/** Click the arrows in turn, counting each run after its click. */
export const clickRuns = (selected: Selected, clicks: readonly Click[]): InputSnapshot => {
  let snap = selected.snap;
  for (const click of clicks) {
    snap = selected.mode.onArrowClick(click.arrow, selected.state, selected.board.rules);
    if (click.count !== undefined) snap = selected.mode.setCarry(click.count);
  }
  return snap;
};

// ---------------------------------------------------------------------------
// Reading the phase
// ---------------------------------------------------------------------------

export const runLengthsOf = (snap: InputSnapshot): readonly number[] =>
  routePhaseOf(snap).runLengths;

/** The editable run's length — derived from the boundaries, never stored. */
export const lastRunLengthOf = (snap: InputSnapshot): number =>
  lastRunLength(routePhaseOf(snap).runLengths);

/** The counts the phase offers for its last run. */
export const carriesOf = (snap: InputSnapshot): readonly number[] =>
  routePhaseOf(snap).offer.carries;

/** The `count` on every step move of the draft, in order. */
export const countsOf = (draft: readonly Move[]): readonly number[] =>
  draft.filter((move): move is StepMove => move.kind === 'step').map((move) => move.count);

/** The trailing `lastRunLength` moves — the run the control edits. */
export const lastRunMovesOf = (snap: InputSnapshot): readonly Move[] => {
  const phase = routePhaseOf(snap);
  return phase.draft.slice(phase.draft.length - lastRunLength(phase.runLengths));
};

/** Every move before the last run — the ones a rewrite must leave byte-identical. */
export const earlierMovesOf = (snap: InputSnapshot): readonly Move[] => {
  const phase = routePhaseOf(snap);
  return phase.draft.slice(0, phase.draft.length - lastRunLength(phase.runLengths));
};

/** Where the phase's last run began: the arrow, and the heads standing there. */
export const runStartOf = (
  board: Board,
  state: GameState,
  phase: RoutePhase,
): { readonly start: ArrowId; readonly heads: number; readonly state: GameState } => {
  const prefix = phase.draft.slice(0, phase.draft.length - lastRunLength(phase.runLengths));
  let scratch = state;
  let at = phase.from;
  for (const move of prefix) {
    if (move.kind !== 'step') continue;
    scratch = board.rules.apply(scratch, move);
    at = move.exit;
  }
  return { start: at, heads: headsOn(scratch, at), state: scratch };
};

// ---------------------------------------------------------------------------
// The docked control
// ---------------------------------------------------------------------------

export interface ControlOpts {
  readonly inputLocked?: boolean;
  readonly matchOver?: boolean;
}

/** The docked control the adapter would draw for this snapshot, or `undefined`. */
export const controlOf = (
  snap: InputSnapshot,
  opts: ControlOpts = {},
): CountControl | undefined =>
  countControl({
    phase: snap.phase,
    inputLocked: opts.inputLocked ?? false,
    matchOver: opts.matchOver ?? false,
  });

/**
 * Did the adapter draw a control for this snapshot?
 *
 * A helper rather than an inline call because "no count control is rendered" is
 * the single most repeated assertion in the feature files.
 */
export const controlShown = (snap: InputSnapshot, opts: ControlOpts = {}): boolean =>
  controlOf(snap, opts) !== undefined;
