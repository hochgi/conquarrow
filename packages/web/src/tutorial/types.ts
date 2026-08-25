/**
 * Tutorial types (P43) — data only.
 *
 * A lesson is immutable data: a config, an opening move script, and an ordered
 * step list. Every staged board is reachable-and-legal by construction: the
 * opening folds `makeMatch(config)` through `rules.apply`. Nothing here knows
 * about React, timers, or storage.
 */

import type { ArrowId, GameState, MatchConfig, Move } from '@conquarrow/contracts';

/** The eight shipped lessons, in teaching order. */
export type LessonId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7';

/** One straight-run expectation: the rail names its source and its exits. */
export interface RouteAction {
  readonly kind: 'route';
  readonly from: ArrowId;
  /** The exact exit-arrow sequence the rail expects, in walk order. */
  readonly exits: readonly ArrowId[];
  /**
   * Carry values the rail permits. Omitted means whatever the route offer lists
   * is acceptable — a rail that does not teach sizing leaves the decision alone.
   */
  readonly carryAllow?: readonly number[];
}

export type ActionSpec = RouteAction;

export interface NarrateStep {
  readonly kind: 'narrate';
  readonly text: string;
  /** Arrows the narration points at; rendered as focus rings and nothing else. */
  readonly focus?: readonly ArrowId[];
}

export interface DemoStep {
  readonly kind: 'demo';
  readonly label: string;
  /**
   * Moves the host commits through the ordinary path, paced like bot playback.
   * Enemy agency in lessons is always this — never an opponent intelligence.
   */
  readonly moves: readonly Move[];
}

export interface ExpectStep {
  readonly kind: 'expect';
  readonly title: string;
  readonly action: ActionSpec;
  /** Shown on any off-rail interaction; never replaces the engine's own refusal. */
  readonly coach: string;
}

export interface ObjectiveStep {
  readonly kind: 'objective';
  /** Key into the goal-predicate registry (`goals.ts`). */
  readonly goal: string;
  /** The golden answer — what *Show me* replays and the validator replays. */
  readonly golden: readonly Move[];
  /** Tier-one hint text; tier two highlights, tier three offers Show me. */
  readonly hint: string;
}

export interface EndStep {
  readonly kind: 'end';
  readonly summary: string;
}

export type LessonStep = NarrateStep | DemoStep | ExpectStep | ObjectiveStep | EndStep;

export interface Lesson {
  readonly id: LessonId;
  readonly title: string;
  readonly config: MatchConfig;
  readonly opening: readonly Move[];
  readonly steps: readonly LessonStep[];
}

export interface HintNudge {
  readonly kind: 'nudge';
  readonly text: string;
}

export interface HintHighlight {
  readonly kind: 'highlight';
  readonly arrows: readonly ArrowId[];
}

export interface HintShowMe {
  readonly kind: 'show-me';
  readonly moves: readonly Move[];
}

export type HintResponse = HintNudge | HintHighlight | HintShowMe;

/**
 * A goal predicate: pure, deterministic, evaluated on the states around one
 * committed batch. `candidates` powers hint tier two; omit it and tier two
 * degrades to a repeat of the nudge.
 */
export interface GoalDef {
  readonly holds: (before: GameState, after: GameState, moves: readonly Move[]) => boolean;
  readonly candidates?: (state: GameState) => readonly ArrowId[];
}

/** One reason a lesson failed validation, named precisely enough to fix. */
export interface StepFailure {
  readonly lesson: LessonId;
  readonly stepIndex: number;
  readonly reason: string;
}

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly failures: readonly StepFailure[] };
