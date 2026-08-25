/**
 * The golden-path validator (P43) — the load-bearing test, callable.
 *
 * Every lesson replays headlessly: its opening folds through `makeMatch` +
 * `rules.apply`; each expect action must be legal when reached; each objective
 * golden must satisfy its predicate; the lesson must reach its end. A future
 * rules packet that rots an authored board fails here, loudly, naming the
 * lesson, the step, and the action.
 */

import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { step as moveStep } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, RulesPort } from '@conquarrow/contracts';
import { GOALS } from './goals';
import type { Lesson, StepFailure, ValidationResult } from './types';

const geometry = makeTiling();
const baseRules = makeRules(geometry);

/** The opening equals `makeMatch(config)` folded with the script — nothing else may build it. */
export const openingOf = (lesson: Lesson): GameState => {
  let state = makeMatch(lesson.config);
  for (const move of lesson.opening) state = baseRules.apply(state, move);
  return state;
};

const headsOn = (state: GameState, arrow: ArrowId): number =>
  state.groups.get(arrow)?.heads ?? 0;

/** Fold a rail's route the way the learner performs it. */
const railMoves = (
  rulesPort: RulesPort,
  state: GameState,
  from: ArrowId,
  exits: readonly ArrowId[],
  carryAllow: readonly number[] | undefined,
): readonly Move[] => {
  let scratch = state;
  let at = from;
  const moves: Move[] = [];
  let hop = 0;
  for (const exit of exits) {
    const firstCarry = carryAllow?.[0];
    const count =
      hop === 0 && firstCarry !== undefined ? firstCarry : Math.max(1, headsOn(scratch, at));
    const move = moveStep(at, exit, count);
    scratch = rulesPort.apply(scratch, move);
    moves.push(move);
    at = exit;
    hop += 1;
  }
  return moves;
};

const ok: ValidationResult = { ok: true };

/** Replay one lesson's golden path headlessly, against `withRules` when given. */
export const validateLesson = (lesson: Lesson, withRules?: RulesPort): ValidationResult => {
  const rulesPort = withRules ?? baseRules;
  const failures: StepFailure[] = [];
  const fail = (stepIndex: number, reason: string): void => {
    failures.push({ lesson: lesson.id, stepIndex, reason });
  };
  let state = openingOf(lesson);
  for (let index = 0; index < lesson.steps.length; index += 1) {
    const current = lesson.steps[index];
    if (current === undefined) continue;
    try {
      if (current.kind === 'demo') {
        for (const move of current.moves) state = rulesPort.apply(state, move);
      } else if (current.kind === 'expect') {
        for (const move of railMoves(
          rulesPort,
          state,
          current.action.from,
          current.action.exits,
          current.action.carryAllow,
        )) {
          state = rulesPort.apply(state, move);
        }
      } else if (current.kind === 'objective') {
        const goal = GOALS[current.goal];
        if (goal === undefined) {
          fail(index, `unregistered goal '${current.goal}'`);
          continue;
        }
        const before = state;
        for (const move of current.golden) state = rulesPort.apply(state, move);
        if (!goal.holds(before, state, current.golden)) {
          fail(index, `golden answer does not satisfy goal '${current.goal}'`);
        }
      }
    } catch (cause) {
      fail(index, cause instanceof Error ? cause.message : String(cause));
    }
  }
  if (failures.length > 0) return { ok: false, failures };
  return ok;
};

const LESSON_ORDER = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'] as const;

/** §7: placement and force are setup data; lessons may differ only there. */
const TUNABLE = new Set(['dominationN', 'R', 'homeOffset', 'spawnerSeed']);

/** Validate shape + config confinement across the whole catalogue. */
export const validateCatalogue = (lessons: readonly Lesson[]): ValidationResult => {
  const failures: StepFailure[] = [];
  const order = lessons.map((lesson) => lesson.id);
  if (order.join('|') !== LESSON_ORDER.join('|')) {
    failures.push({
      lesson: lessons[0]?.id ?? 'L0',
      stepIndex: 0,
      reason: `catalogue order is [${order.join(', ')}], expected L0..L7`,
    });
  }
  for (const lesson of lessons) {
    for (const key of Object.keys(lesson.config)) {
      if (!TUNABLE.has(key) && key !== 'playerCount') {
        failures.push({
          lesson: lesson.id,
          stepIndex: 0,
          reason: `config key '${key}' is not §7 setup data`,
        });
      }
    }
    if (lesson.config.playerCount !== 2) {
      failures.push({ lesson: lesson.id, stepIndex: 0, reason: 'lessons are fixed two-seat boards' });
    }
    for (let index = 0; index < lesson.steps.length; index += 1) {
      const step = lesson.steps[index];
      if (step?.kind === 'objective' && GOALS[step.goal] === undefined) {
        failures.push({
          lesson: lesson.id,
          stepIndex: index,
          reason: `unregistered goal '${step.goal}'`,
        });
      }
    }
  }
  if (failures.length > 0) return { ok: false, failures };
  return ok;
};
