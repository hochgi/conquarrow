/**
 * Caller-relative library status for `GET /my-games` started rows (P45).
 *
 * Classification order is owned here so the API and the Pages shell share one
 * spelling. `isLost` stays in rules-core; only persist / hydrate call it.
 *
 * @see docs/spec/online-game-library/online-game-library.md
 */

import type { InviteSeat, UserHash } from './online-port';

/** Shell-facing status of one started game, relative to the bearer. */
export type LibraryGameStatus = 'your-turn' | 'waiting' | 'won' | 'lost';

/**
 * Fields persist writes onto game `meta.json` (additive, seats stay).
 * `winner` is omitted while unset.
 */
export interface LibrarySummary {
  readonly players: readonly string[];
  readonly activePlayer: string;
  readonly lostPlayers: readonly string[];
  readonly winner?: string;
}

const chairIndexOf = (seats: readonly InviteSeat[], userHash: UserHash): number => {
  for (let i = 0; i < seats.length; i += 1) {
    const seat = seats[i];
    if (seat !== undefined && seat.kind === 'human' && seat.userHash === userHash) {
      return i;
    }
  }
  return -1;
};

/**
 * Map the caller onto a chair (`seats` index → `summary.players[index]`) and
 * classify. No summary, or no chair, is waiting.
 *
 * Order: won → lost(winner) → lost(lostPlayers) → your-turn → waiting.
 */
export const libraryStatusFor = (
  userHash: UserHash,
  seats: readonly InviteSeat[],
  summary: LibrarySummary | undefined,
): LibraryGameStatus => {
  if (summary === undefined) return 'waiting';
  const index = chairIndexOf(seats, userHash);
  if (index < 0) return 'waiting';
  const me = summary.players[index];
  if (me === undefined) return 'waiting';
  if (summary.winner === me) return 'won';
  if (summary.winner !== undefined) return 'lost';
  if (summary.lostPlayers.includes(me)) return 'lost';
  if (summary.activePlayer === me) return 'your-turn';
  return 'waiting';
};
