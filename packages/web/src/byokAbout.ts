/**
 * P108 — a local BYOK seat's `OfferAbout`, so its model reads the same offer
 * an MCP agent does: the seat table from the match log's seats and the recent
 * window replayed from the log's moves.
 *
 * @see docs/spec/agent-context-v2/agent-context-v2.md D1, D3
 */

import type { MatchConfig, Move, PlayerId } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { recentFromMoves, type OfferAbout, type OfferSeat } from '@conquarrow/byok-offer';
import type { SeatKind } from './seatPlan';

const geometry = makeTiling();

/** D1 for a local game: no profiles, so a human reads `Player <letter>` and every model seat reads `Agent`. */
export const localOfferSeats = (
  seats: readonly { readonly player: PlayerId; readonly kind: SeatKind }[],
  me: PlayerId,
): OfferSeat[] =>
  seats.map(({ player, kind }) => {
    const row: OfferSeat =
      kind === 'human'
        ? { player: String(player), kind: 'human', name: `Player ${String(player)}` }
        : kind === 'heuristic'
          ? { player: String(player), kind: 'heuristic', name: 'AI' }
          : { player: String(player), kind: 'agent', name: 'Agent' };
    return player === me ? { ...row, relation: 'you' } : row;
  });

/** The about for `me`'s turn; a log that does not replay leaves the history out rather than failing the turn. */
export const byokTurnAbout = (
  log: {
    readonly config: MatchConfig;
    readonly moves: readonly Move[];
    readonly seats: readonly { readonly player: PlayerId; readonly kind: SeatKind }[];
  },
  me: PlayerId,
): OfferAbout => {
  const seats = localOfferSeats(log.seats, me);
  try {
    return { seats, recent: recentFromMoves(geometry, makeMatch(log.config), log.moves, me) };
  } catch {
    return { seats };
  }
};

/** The local AI loop's about: only a BYOK seat reads one, and only once the match log exists. */
export const byokSeatAbout = (
  kind: SeatKind,
  log: Parameters<typeof byokTurnAbout>[0] | undefined,
  me: PlayerId,
): OfferAbout | undefined => (kind === 'byok' && log !== undefined ? byokTurnAbout(log, me) : undefined);
