/**
 * Thin helpers for the Pages shell — seat kinds for the host, and a stub log
 * so the existing HUD can render an online GET board.
 */

import {
  DEFAULT_MATCH_CONFIG,
  type GameState,
  type InviteSeat,
  type LibraryGameStatus,
  type PagesLobbyMode,
  type PlannedSeatKind,
} from '@conquarrow/contracts';
import { styleFor } from './colors';
import { createMatchLog, type MatchLog, type SeatDriverLog } from './matchLog';
import { seatPlayerId, type SeatPlan } from './seatPlan';

export { libraryVsLine } from '@conquarrow/contracts';

/** Shell copy while `POST /invites` is in flight (P27). */
export const CREATING_INVITE_COPY =
  'Creating your unique invite link - this may take a few moments…';

/** Signed-in Online control that lists started rows (P45). */
export const MY_GAMES_COPY = 'My games';

/** Empty started-games list (P45). */
export const NO_GAMES_COPY = 'No games yet';

const LIBRARY_LABELS: Record<LibraryGameStatus, string> = {
  'your-turn': 'Open (your turn)',
  waiting: 'Open (waiting)',
  won: 'Won',
  lost: 'Lost',
};

export const libraryStatusLabel = (status: LibraryGameStatus): string => LIBRARY_LABELS[status];

export const formatLibraryRow = (status: LibraryGameStatus, gameNumber: string): string =>
  `${libraryStatusLabel(status)} · ${gameNumber}`;

const UTC_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** UTC line for a library row — never the operator's local timezone. */
export const formatLibraryStartedAt = (iso: string | undefined): string | undefined => {
  if (iso === undefined || iso === '') return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const month = UTC_MONTHS[date.getUTCMonth()];
  if (month === undefined) return undefined;
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  return `${String(day)} ${month} ${String(year)}, ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
};

/** Caller's board fill for the row border / swatch. */
export const libraryRowTint = (seatIndex: number): string =>
  styleFor(seatPlayerId(seatIndex)).fill;

export const libraryOffered = (mode: PagesLobbyMode, signedIn: boolean): boolean =>
  mode === 'online' && signedIn;

export const kindsForHost = (
  plan: SeatPlan,
  online: boolean,
): readonly PlannedSeatKind[] =>
  plan.seats.map((seat) => (online && seat.kind === 'byok' ? 'heuristic' : seat.kind));

/** HUD / roster labels — API kinds stay `human` | `heuristic`. */
export const displaySeatKind = (kind: 'human' | 'heuristic' | 'byok'): string => {
  if (kind === 'heuristic') return 'AI';
  if (kind === 'byok') return 'BYOK';
  return 'Player';
};

export const rosterOccupancy = (
  seat: InviteSeat,
  userHash: string | undefined,
): 'you' | 'waiting' | 'player' | 'ai' => {
  if (seat.kind === 'heuristic') return 'ai';
  if (seat.userHash === undefined) return 'waiting';
  if (userHash !== undefined && seat.userHash === userHash) return 'you';
  return 'player';
};

export const rosterOccupancyLabel = (
  occupancy: 'you' | 'waiting' | 'player' | 'ai',
): string => {
  if (occupancy === 'you') return 'you';
  if (occupancy === 'waiting') return 'waiting';
  if (occupancy === 'ai') return 'AI';
  return 'Player';
};

export const logFromOnlineBoard = (
  game: GameState,
  seats: readonly InviteSeat[] | undefined,
): MatchLog => {
  const playerCount = game.players.length === 6 ? 6 : 3;
  const seatLogs: SeatDriverLog[] = game.players.map((player, index) => {
    const seat = seats?.[index];
    const kind = seat?.kind === 'heuristic' ? 'heuristic' : 'human';
    return { player, kind };
  });
  const firstPlayer = game.players[0];
  if (firstPlayer === undefined) {
    throw new Error('P25: online board has no players');
  }
  const human = seatLogs.find((row) => row.kind === 'human')?.player ?? firstPlayer;
  const bot = seatLogs.find((row) => row.kind !== 'human')?.player;
  return createMatchLog({
    config: { ...DEFAULT_MATCH_CONFIG, playerCount },
    vsBot: seatLogs.some((row) => row.kind !== 'human'),
    botMode: seatLogs.some((row) => row.kind === 'heuristic') ? 'heuristic' : 'human-hotseat',
    seats: seatLogs,
    humanSeat: human,
    botSeat: bot,
  });
};
