/**
 * The lesson step machine (P43) — narrate / demo / expect / objective / end.
 *
 * The session owns *sequence*, never state. The host keeps the one game state;
 * the session is told what committed (`onCommitted`) and answers with what the
 * host must do next (demo batches, locks, hints). Demos ride the ordinary
 * commit path exactly like a sent batch — there is no second application route.
 */

import type { ArrowId, GameState, Move } from '@conquarrow/contracts';
import type { HintResponse, Lesson, LessonStep } from './types';
import { GOALS } from './goals';

const exitsOf = (moves: readonly Move[]): readonly ArrowId[] =>
  moves.flatMap((move) => (move.kind === 'step' ? [move.exit] : []));

export class TutorialSession {
  private index = 0;
  private fruitless = 0;
  private done = false;
  private haltedAt: string | undefined;
  private lastState: GameState | undefined;

  private constructor(private readonly lesson: Lesson) {}

  /** Open a lesson: the session sits on its first step; the host folds the opening. */
  static start(lesson: Lesson): TutorialSession {
    if (lesson.steps.length === 0) throw new Error(`tutorial: ${lesson.id} has no steps`);
    return new TutorialSession(lesson);
  }

  get id(): string {
    return this.lesson.id;
  }

  stepIndex(): number {
    return this.index;
  }

  step(): LessonStep {
    const step = this.lesson.steps[this.index];
    if (step === undefined) throw new Error(`tutorial: ${this.lesson.id} stepped past its end`);
    return step;
  }

  /** True while the learner may act on the board (expect / objective steps). */
  boardInputOpen(): boolean {
    if (this.haltedAt !== undefined) return false;
    const kind = this.step().kind;
    return kind === 'expect' || kind === 'objective';
  }

  /**
   * Narrate: Next. Demo: the host's signal that the last effect was presented.
   * End: dismisses the summary and earns completion. Idempotent once completed.
   */
  next(): void {
    if (this.done) return;
    const step = this.step();
    if (step.kind === 'end') {
      this.done = true;
      return;
    }
    if (this.index < this.lesson.steps.length - 1) this.index += 1;
  }

  /** When the current step is a demo, the moves the host must commit. */
  demoPending(): readonly Move[] | undefined {
    const step = this.step();
    return step.kind === 'demo' ? step.moves : undefined;
  }

  /** The host reports a demo move refused at application time. Halts visibly. */
  onDemoHalted(move: Move, cause: unknown): void {
    const detail =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown';
    this.haltedAt = `${this.lesson.id} step ${String(this.index)} (${move.kind}): ${detail}`;
  }

  halted(): boolean {
    return this.haltedAt !== undefined;
  }

  haltDetail(): string {
    if (this.haltedAt === undefined) throw new Error('tutorial: session is not halted');
    return this.haltedAt;
  }

  /**
   * The host reports one committed batch (human or demo). Rails advance when
   * satisfied; objectives evaluate their predicate; fruitless batches feed the
   * hint ladder.
   */
  onCommitted(before: GameState, after: GameState, moves: readonly Move[]): void {
    if (this.done || this.haltedAt !== undefined) return;
    this.lastState = after;
    const step = this.step();
    if (step.kind === 'expect') {
      if (this.satisfiesRail(step.action.from, moves)) this.index += 1;
      return;
    }
    if (step.kind === 'objective') {
      const goal = GOALS[step.goal];
      if (goal === undefined) throw new Error(`tutorial: unregistered goal '${step.goal}'`);
      if (goal.holds(before, after, moves)) {
        this.index += 1;
        this.fruitless = 0;
      } else {
        this.fruitless += 1;
      }
    }
  }

  private satisfiesRail(from: ArrowId, moves: readonly Move[]): boolean {
    const first = moves.find((move): move is Extract<Move, { kind: 'step' }> => move.kind === 'step');
    if (first === undefined) return false;
    if (first.from !== from) return false;
    return exitsOf(moves).join('|') === this.currentRailExits().join('|');
  }

  private currentRailExits(): readonly ArrowId[] {
    const step = this.step();
    return step.kind === 'expect' ? step.action.exits : [];
  }

  /** The current hint response; escalation driven by fruitless batches. */
  hint(): HintResponse {
    const step = this.step();
    if (step.kind !== 'objective') throw new Error('tutorial: hints exist only on objectives');
    if (this.fruitless >= 3) return { kind: 'show-me', moves: step.golden };
    const state = this.lastState;
    const candidates =
      this.fruitless >= 2 && state !== undefined
        ? GOALS[step.goal]?.candidates?.(state)
        : undefined;
    if (candidates !== undefined && candidates.length > 0) {
      return { kind: 'highlight', arrows: candidates };
    }
    return { kind: 'nudge', text: step.hint };
  }

  /** Back to the first step; counters cleared. The host refolds the opening. */
  restart(): void {
    this.index = 0;
    this.fruitless = 0;
    this.done = false;
    this.haltedAt = undefined;
    this.lastState = undefined;
  }

  /** True once the end step has been dismissed. */
  completed(): boolean {
    return this.done;
  }

  finished(): boolean {
    return this.done;
  }
}
