/**
 * Fixtures for the P100 send-refusal suite.
 *
 * @see docs/spec/send-refusal/send-refusal.md
 */

import type { SubmitGuardInput } from '../src/online-pages';

/** Every guard passes: the caller may send. */
export const passing = (): SubmitGuardInput => ({
  onlineReady: true,
  signedIn: true,
  onGame: true,
  moveCount: 1,
  submitting: false,
  held: false,
  replaying: false,
  gameOver: false,
  callerToMove: true,
});

/** Every guard fails at once. */
export const failing = (): SubmitGuardInput => ({
  onlineReady: false,
  signedIn: false,
  onGame: false,
  moveCount: 0,
  submitting: true,
  held: true,
  replaying: true,
  gameOver: true,
  callerToMove: false,
});

/** D1's table, in order: the guard that fails, and the reason it returns. */
export const GUARD_ORDER: readonly {
  readonly reason: string;
  readonly fail: Partial<SubmitGuardInput>;
}[] = [
  { reason: 'not-ready', fail: { onlineReady: false } },
  { reason: 'sending', fail: { submitting: true } },
  { reason: 'held', fail: { held: true } },
  { reason: 'signed-out', fail: { signedIn: false } },
  { reason: 'no-game', fail: { onGame: false } },
  { reason: 'no-moves', fail: { moveCount: 0 } },
  { reason: 'replaying', fail: { replaying: true } },
  { reason: 'game-over', fail: { gameOver: true } },
  { reason: 'not-your-turn', fail: { callerToMove: false } },
];
