/**
 * Fixtures and drivers for P43 tutorial tests.
 *
 * The real tiling hosts everything behavioural; fixture boards stay available
 * for anything that wants a readable failure. Lesson *content* is pinned by
 * shape here (ids, step kinds, goal keys) so phase 3 cannot ship a vacuous
 * catalogue — the validator then gives the content its depth.
 */

import { endTurn, mintPlayerId, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';

export { endTurn, step };

export const geometry: GeometryPort = makeTiling();
export const rules: RulesPort = makeRules(geometry);

export const A: PlayerId = mintPlayerId('A');
export const B: PlayerId = mintPlayerId('B');

/** Fold moves through the engine, refusing silently-broken scripts. */
export const fold = (state: GameState, moves: readonly Move[]): GameState => {
  let at = state;
  for (const move of moves) at = rules.apply(at, move);
  return at;
};

/** Structural deep equality over GameState-shaped values (Maps and Sets included). */
export const structuralEq = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) return false;
    for (const [key, value] of left) {
      if (!right.has(key)) return false;
      if (!structuralEq(value, right.get(key))) return false;
    }
    return true;
  }
  if (left instanceof Set && right instanceof Set) {
    if (left.size !== right.size) return false;
    for (const value of left) if (!right.has(value)) return false;
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => structuralEq(value, right[index]));
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const l = left as Record<string, unknown>;
    const r = right as Record<string, unknown>;
    const lKeys = Object.keys(l);
    const rKeys = Object.keys(r);
    if (lKeys.length !== rKeys.length) return false;
    return lKeys.every((key) => key in r && structuralEq(l[key], r[key]));
  }
  return false;
};

// ---------------------------------------------------------------------------
// Catalogue access with setup failures that say what is missing
// ---------------------------------------------------------------------------

import { LESSONS } from '../src/tutorial/catalogue';
import type { Lesson } from '../src/tutorial/types';

export const allLessons = (): readonly Lesson[] => {
  if (LESSONS.length === 0) throw new Error('setup: the lesson catalogue is empty — L0..L7 are not authored');
  return LESSONS;
};

export const lesson = (id: string): Lesson => {
  const found = LESSONS.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`setup: lesson ${id} is not authored (catalogue has ${String(LESSONS.length)} lessons)`);
  }
  return found;
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

import { createProgressStore } from '../src/tutorial/storage';
import type { ProgressStore, StorageBacking } from '../src/tutorial/storage';

export interface Cell {
  value: string | undefined;
}

export const memoryBacking = (): StorageBacking & Cell => {
  const cell: Cell = { value: undefined };
  return {
    get value(): string | undefined {
      return cell.value;
    },
    set value(next: string | undefined) {
      cell.value = next;
    },
    read: () => cell.value,
    write: (next: string): void => {
      cell.value = next;
    },
  };
};

/** The ordering spy: records which persistence calls happened, in order. */
export interface SpyStore extends ProgressStore {
  readonly calls: readonly string[];
}

export const spyStore = (inner: ProgressStore): SpyStore => {
  const calls: string[] = [];
  return {
    calls,
    completions: () => inner.completions(),
    markComplete: (id: string): void => {
      calls.push(`markComplete:${id}`);
      inner.markComplete(id);
    },
    reset: (): void => {
      calls.push('reset');
      inner.reset();
    },
    cardDismissed: () => inner.cardDismissed(),
    dismissCard: (): void => {
      calls.push('dismissCard');
      inner.dismissCard();
    },
  };
};

export const newStore = (): ProgressStore => createProgressStore(memoryBacking());

// ---------------------------------------------------------------------------
// Crossing search — every legal A step that shrinks B's trail
// ---------------------------------------------------------------------------

export interface CrossingCandidate {
  readonly move: StepMove;
  /** B's total trail arrows before and after. */
  readonly beforeArrows: number;
  readonly afterArrows: number;
}

const trailTotal = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

/**
 * Every one-step attack/step by the active player whose application shrinks
 * the named player's trail — i.e. a cut or a wipe that eats trail.
 */
export const searchTrailShrinkingSteps = (
  state: GameState,
  victim: PlayerId,
): readonly CrossingCandidate[] => {
  const found: CrossingCandidate[] = [];
  const before = trailTotal(state, victim);
  const sources = [...state.groups.entries()].filter(([, group]) => group.owner === state.activePlayer);
  for (const [from, group] of sources) {
    for (const exit of geometry.outArrows(geometry.target(from))) {
      for (const count of new Set([group.heads, group.heads - 1])) {
        if (count < 1) continue;
        try {
          const after = rules.apply(state, step(from, exit, count));
          const afterTotal = trailTotal(after, victim);
          if (afterTotal < before) found.push({ move: step(from, exit, count), beforeArrows: before, afterArrows: afterTotal });
        } catch {
          // refused — not a candidate
        }
      }
    }
  }
  return found;
};

/** The arrow ids B holds as trail. */
export const trailArrows = (state: GameState, player: PlayerId): readonly ArrowId[] => [
  ...(state.trails.get(player) ?? []),
];

// ---------------------------------------------------------------------------
// Driving a session honestly — every transition folds through the engine
// ---------------------------------------------------------------------------

import { TutorialSession } from '../src/tutorial/session';
import { openingOf } from '../src/tutorial/validate';
import type { ExpectStep, LessonStep } from '../src/tutorial/types';

const headsOn = (state: GameState, arrow: ArrowId): number => state.groups.get(arrow)?.heads ?? 0;

/** The moves a learner performs to satisfy an expect step's route action. */
export const routeMoves = (state: GameState, rail: ExpectStep): readonly Move[] => {
  let scratch = state;
  let at = rail.action.from;
  const moves: Move[] = [];
  let hop = 0;
  for (const exit of rail.action.exits) {
    const firstCarry = rail.action.carryAllow?.[0];
    const count =
      hop === 0 && firstCarry !== undefined ? firstCarry : Math.max(1, headsOn(scratch, at));
    const move = step(at, exit, count);
    scratch = rules.apply(scratch, move);
    moves.push(move);
    at = exit;
    hop += 1;
  }
  return moves;
};

/** The golden answer of an objective step. Throws on any other kind. */
export const goldenOf = (current: LessonStep): readonly Move[] => {
  if (current.kind !== 'objective') throw new Error('setup: not an objective step');
  return current.golden;
};

/**
 * Walk `id` from its first step until `stop` says otherwise, satisfying every
 * rail and objective with its golden answer through the real engine. Throws a
 * loud setup error when authored content cannot be folded — content rot is the
 * validator's job; here it just refuses to drive.
 */
export const driveTo = (
  id: string,
  stop: (step: LessonStep, index: number) => boolean,
): { session: TutorialSession; state: GameState } => {
  const les = lesson(id);
  let state = openingOf(les);
  const session = TutorialSession.start(les);
  let guard = 0;
  while (!session.finished() && !stop(session.step(), session.stepIndex())) {
    guard += 1;
    if (guard > 500) throw new Error(`setup: ${id} did not reach its end — check the validator`);
    const current = session.step();
    if (current.kind === 'narrate' || current.kind === 'end') {
      session.next();
      continue;
    }
    if (current.kind === 'demo') {
      try {
        state = fold(state, current.moves);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`setup: ${id} demo at step ${String(session.stepIndex())} refused: ${detail}`);
      }
      session.next();
      continue;
    }
    if (current.kind === 'expect') {
      const batch = routeMoves(state, current);
      const after = fold(state, batch);
      session.onCommitted(state, after, batch);
      state = after;
      continue;
    }
    // objective
    const after = fold(state, current.golden);
    session.onCommitted(state, after, current.golden);
    state = after;
    continue;
  }
  return { session, state };
};

/** Drive to the first step of the given kind. */
export const driveToKind = (
  id: string,
  kind: LessonStep['kind'],
): { session: TutorialSession; state: GameState; index: number } => {
  const target = lesson(id).steps.findIndex((step) => step.kind === kind);
  if (target < 0) throw new Error(`setup: ${id} has no ${kind} step`);
  const driven = driveTo(id, (_step, index) => index >= target);
  return { ...driven, index: target };
};

// ---------------------------------------------------------------------------
// Synthetic boards for decorator-level tests (rail semantics are content-free)
// ---------------------------------------------------------------------------

import { legalSeats, sourceArrow } from './ray-run-input.support';

export { legalSeats, sourceArrow };

/** Player A holds `heads` on the tiling's seed arrow, seats made legal. */
export const loneStack = (
  heads: number,
): { state: GameState; from: ArrowId } => {
  const from = sourceArrow(geometry);
  return {
    from,
    state: legalSeats({
      players: [A, B],
      activePlayer: A,
      groups: new Map([[from, { owner: A, heads, spent: 0 }]]),
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

/** The exit arrow `hops` along slot 0 from an arrow. */
export const alongSlot0 = (from: ArrowId, hops: number): ArrowId => {
  let at = from;
  for (let i = 0; i < hops; i += 1) {
    const next = geometry.outArrows(geometry.target(at))[0];
    if (next === undefined) throw new Error('setup: no out-slot 0');
    at = next;
  }
  return at;
};
