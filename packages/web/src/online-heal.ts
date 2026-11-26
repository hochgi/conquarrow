/**
 * P104 — the pure decisions behind the Send self-heal. No clock, no fetch:
 * the adapter reads time and the wire, and passes the facts in.
 *
 * @see docs/spec/send-self-heal/send-self-heal.md
 */

import type { SubmitOutcome, SubmitRefusal } from '@conquarrow/contracts';

/** P104 D2: a queued or in-flight batch untouched this long is stalled. */
export const REPLAY_STALL_MS = 20_000;

/** The hold as the heal reads it (P95 D10, plus who it was made for). */
export interface HoldFacts {
  readonly groupHash: string;
  readonly gameNumber: string;
  readonly version: number;
  readonly userHash?: string | undefined;
}

export type HeldPlan = 'wait' | 'drop-other' | 'drop-stale' | 'send';

/**
 * P104 D1. What to do with a hold once `/me` (and, on its game, the game) has
 * been read. A hold is sent only against the version it was made at: posting
 * it against a newer board would be a move chosen from the past (P49 D7).
 */
export const heldPlan = (facts: {
  readonly held: HoldFacts;
  /** The route is the held game (its group hash and game number). */
  readonly onHeldGame: boolean;
  readonly meOk: boolean;
  readonly me: string | undefined;
  readonly boardVersion: number | undefined;
}): HeldPlan => {
  const { held, me, boardVersion } = facts;
  if (!facts.meOk) return 'wait';
  if (!facts.onHeldGame) return 'drop-other';
  if (me !== undefined && held.userHash !== undefined && me !== held.userHash) return 'drop-stale';
  if (boardVersion === undefined) return 'wait';
  return boardVersion === held.version ? 'send' : 'drop-stale';
};

/** P104 D1: a held POST that landed is `held-sent`; any other stop is its own outcome. */
export const healedOutcome = (posted: SubmitOutcome): SubmitOutcome =>
  posted === 'sent' ? 'held-sent' : posted;

/** P104 D2: a batch is pending and nothing has progressed for `stallMs`. */
export const replayStalled = (args: {
  readonly pending: boolean;
  readonly progressAt: number | undefined;
  readonly now: number;
  readonly stallMs: number;
}): boolean =>
  // Stryker disable next-line ConditionalExpression -- equivalent: without a stamp `now - undefined` is NaN and `NaN >= stallMs` is false too; the term narrows the type.
  args.pending && args.progressAt !== undefined && args.now - args.progressAt >= args.stallMs;

/**
 * P104 D3. After the one re-read of `/me` and the game: a guard that still
 * fails is final; the caller's turn at the same version sends (`undefined`);
 * at any other version the board moved, so `stale` with no POST.
 */
export const afterRecheck = (args: {
  readonly refusal: SubmitRefusal | undefined;
  readonly before: number | undefined;
  readonly after: number | undefined;
}): SubmitRefusal | 'stale' | undefined => {
  if (args.refusal !== undefined) return args.refusal;
  return args.before === args.after ? undefined : 'stale';
};
