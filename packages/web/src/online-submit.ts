/**
 * P94 — what the human sees about a submit. Pure: no clock, no fetch, no DOM.
 *
 * @see docs/spec/online-turn-flow/online-turn-flow.md
 * @see docs/spec/send-refusal/send-refusal.md
 */

import { SUBMIT_REFUSALS, type SubmitOutcome, type SubmitRefusal } from '@conquarrow/contracts';
import type { InputMode, InputSnapshot } from './input/modes';

/** P100 D2: every outcome is a key, so the type keeps the table total. */
const NOTES: Readonly<Record<SubmitOutcome, string | undefined>> = {
  sent: undefined,
  // P100 D1: a guard stopped it, so nothing was sent and the route is kept.
  'not-ready': 'Online play is not set up on this page, so nothing was sent.',
  'signed-out': 'You are signed out, so nothing was sent. Sign in and tap Send again.',
  'no-game': 'The game has not loaded yet, so nothing was sent. Try again in a moment.',
  'no-moves': 'There was nothing to send.',
  sending: 'Your last move is still being sent. Tap Send again when it lands.',
  held: 'A move from before your sign-in expired is still waiting. Sign in again to send it.',
  replaying: 'Other seats’ moves are still playing, so nothing was sent. Tap Send again when they finish.',
  'game-over': 'The game is over, so nothing was sent.',
  'not-your-turn': 'It is not your turn, so nothing was sent.',
  illegal: 'The server refused that move, so the board shows the last accepted position.',
  stale: 'The game moved on before your move arrived. The board has caught up.',
  failed: 'The server did not answer, so your last move may not have been sent. Try again.',
  // P95 D10: the submit is held, not lost; the lock stays until it is sent.
  unauthorized: 'Your sign-in expired. Sign in again and your move will be sent.',
  forbidden: 'That seat is not yours to move.',
  // P104 D1: a heal resolved the hold; the board catches up, the route clears.
  'held-sent': 'Your waiting move was sent. The board has caught up — check it before you move again.',
  'held-dropped':
    'Your waiting move was dropped: the game moved on while you were signed out. The board has caught up.',
};

/** D6 / P100 D2. The one line under the buttons for an outcome; `sent` has none. */
export const submitNote = (outcome: SubmitOutcome): string | undefined => NOTES[outcome];

const isRefusal = (outcome: SubmitOutcome | undefined): outcome is SubmitRefusal =>
  (SUBMIT_REFUSALS as readonly (SubmitOutcome | undefined)[]).includes(outcome);

/**
 * P100 D3. `keep` the drawn route when nothing was sent; `clear` it when the
 * submit reached the server (a prefix may have landed, or the rest is held).
 * `undefined` is a rejected submit, which clears too.
 */
export const draftAfterSubmit = (outcome: SubmitOutcome | undefined): 'keep' | 'clear' =>
  isRefusal(outcome) ? 'keep' : 'clear';

/**
 * P100 D3. What the shell does when a submit settles: the snapshot to show,
 * and whether to refresh the host. `undefined` is a rejected submit, which
 * clears like any outcome that may have reached the server. A kept route is
 * not refreshed: a refresh re-installs the snapshot, which resets the input.
 */
export const settleSubmit = (
  outcome: SubmitOutcome | undefined,
  mode: Pick<InputMode, 'reset' | 'restoreSent'>,
): { readonly snap: InputSnapshot; readonly refresh: boolean } =>
  draftAfterSubmit(outcome) === 'keep'
    ? { snap: mode.restoreSent(), refresh: false }
    : { snap: mode.reset(), refresh: true };

/** D6. End turn's label: "Sending…" while a submit is in flight. */
export const endTurnLabel = (sending: boolean): string => (sending ? 'Sending…' : 'End turn');
