/**
 * Thin helpers for the Pages shell — seat kinds for the host, and a stub log
 * so the existing HUD can render an online GET board.
 */

import {
  DEFAULT_MATCH_CONFIG,
  gameTitle,
  onlinePlanProblem,
  type GameState,
  type InviteSeat,
  type LibraryGameStatus,
  type LibraryList,
  type MyGamesBody,
  type OnlinePlanProblem,
  type StartedGameRow,
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

/**
 * P97 D13: a library read is due only when signed in, the hash route is the
 * lobby, and the library is not loaded. `onLobby` is not "React has no match".
 */
export const lobbyLibraryDue = (
  signedIn: boolean,
  onLobby: boolean,
  libraryLoaded: boolean,
): boolean => signedIn && onLobby && !libraryLoaded;

/** P97 D13: the Google chooser slot is offered only while signed out. */
export const chooserSlotOffered = (signedIn: boolean): boolean => !signedIn;

/** P98. Shown when an authenticated 401 cleared the token. */
export const SESSION_EXPIRED_COPY = 'Your sign-in expired — sign in again';

/** P98. A 422 on `POST /invites`, before an optional `: reason`. */
export const CREATE_REFUSED_COPY = 'The server refused this seat plan';

/** P98. Any other non-success create, including a thrown fetch. */
export const CREATE_FAILED_COPY = "Couldn't create the invite — try again";

/** P98. A library read that was not 200 and not 401. */
export const LIBRARY_FAILED_COPY = "Couldn't load your games — Retry";

/** P106. The seat-plan sentences. Shown only when the plan is not creatable. */
export const PICK_YOUR_SEAT_NOTE = 'Pick your seat: choose Player (you) on one seat.';
export const NEEDS_ANOTHER_NOTE = 'Create needs you and at least one more Player or Agent.';

/** `SESSION_EXPIRED_COPY` when the session expired and the player is signed out. */
export const sessionExpiredNote = (
  sessionExpired: boolean,
  signedIn: boolean,
): string | undefined => (sessionExpired && !signedIn ? SESSION_EXPIRED_COPY : undefined);

/** Refused sentence, plus `: ` and `reason` when that is a non-empty string. */
export const createRefusedNote = (reason: string | undefined): string =>
  reason !== undefined && reason !== '' ? `${CREATE_REFUSED_COPY}: ${reason}` : CREATE_REFUSED_COPY;

/**
 * Absent when the plan is creatable. The lobby never builds `size`, `byok` or
 * two `creator` seats, so every problem but `needs-another` asks for the seat.
 */
export const createPlanNote = (problem: OnlinePlanProblem | undefined): string | undefined => {
  if (problem === undefined) return undefined;
  return problem === 'needs-another' ? NEEDS_ANOTHER_NOTE : PICK_YOUR_SEAT_NOTE;
};

/** What My games should paint. `NO_GAMES_COPY` only for `empty`; `LIBRARY_FAILED_COPY` only for `failed`. */
export type LibraryNotice = 'hidden' | 'failed' | 'unset' | 'empty' | 'list';

const libraryCountsEmpty = (library: MyGamesBody): boolean =>
  (['your-turn', 'waiting', 'finished', 'hidden'] as const).every(
    (list) => library.counts[list] === 0,
  );

export const libraryNotice = (
  signedIn: boolean,
  library: MyGamesBody | undefined,
  libraryFailed: boolean,
): LibraryNotice => {
  if (!signedIn) return 'hidden';
  if (libraryFailed) return 'failed';
  if (library === undefined) return 'unset';
  return libraryCountsEmpty(library) ? 'empty' : 'list';
};

/** P106: the lobby's seat-plan note for `plan` as the host would send it online. */
export const seatPlanNote = (plan: SeatPlan): string | undefined =>
  createPlanNote(onlinePlanProblem(kindsForHost(plan, true)));

export const kindsForHost = (
  plan: SeatPlan,
  online: boolean,
): readonly PlannedSeatKind[] =>
  plan.seats.map((seat) => (online && seat.kind === 'byok' ? 'heuristic' : seat.kind));

/**
 * Kind control the lobby dropdown shows. Online (P106), every seat — seat A
 * included — offers the same five choices. Local stays human, heuristic, byok.
 */
export const pickerKindOptions = (mode: PagesLobbyMode): readonly PlannedSeatKind[] =>
  mode === 'online'
    ? ['creator', 'human', 'creator-agent', 'agent', 'heuristic']
    : ['human', 'heuristic', 'byok'];

const LOBBY_KIND_LABEL: Record<PlannedSeatKind, string> = {
  creator: 'Player (you)',
  human: 'Player',
  'creator-agent': 'Agent (yours)',
  agent: 'Agent',
  heuristic: 'AI',
  byok: 'BYOK LLM',
};

/** Labels the lobby `<select>` shows, in `pickerKindOptions` order. */
export const lobbyKindOptions = (
  mode: PagesLobbyMode,
): readonly { readonly value: PlannedSeatKind; readonly label: string }[] =>
  pickerKindOptions(mode).map((kind) => ({ value: kind, label: LOBBY_KIND_LABEL[kind] }));

export const logFromOnlineBoard = (
  game: GameState,
  seats: readonly InviteSeat[] | undefined,
): MatchLog => {
  const playerCount = game.players.length === 6 ? 6 : 3;
  const seatLogs: SeatDriverLog[] = game.players.map((player, index) => {
    const seat = seats?.[index];
    const kind = seat?.kind === 'heuristic' || seat?.kind === 'agent' ? seat.kind : 'human';
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

/** P96 D11: one section of the managed library. */
export type LibrarySectionView = {
  readonly list: LibraryList;
  readonly title: string;
  readonly count: number;
  readonly rows: readonly StartedGameRow[];
  readonly collapsedByDefault: boolean;
  /** True while `count` exceeds the rows held — "Show more" pages it. */
  readonly more: boolean;
};

const SECTION_TITLES: Readonly<Record<LibraryList, string>> = {
  'your-turn': 'Your turn',
  waiting: 'Waiting',
  finished: 'Finished',
  hidden: 'Hidden',
};

const sectionView = (
  list: LibraryList,
  count: number,
  rows: readonly StartedGameRow[],
): LibrarySectionView => ({
  list,
  title: SECTION_TITLES[list],
  count,
  rows,
  collapsedByDefault: list === 'finished' || list === 'hidden',
  more: count > rows.length,
});

/** P96 D11: the library's sections, Hidden only when its count is nonzero. */
export const librarySections = (
  library: MyGamesBody,
  hidden: readonly StartedGameRow[],
): readonly LibrarySectionView[] => {
  const sections = (['your-turn', 'waiting', 'finished'] as const).map((list) =>
    sectionView(
      list,
      library.counts[list],
      library.games.filter((row) => !row.hidden && row.section === list),
    ),
  );
  return library.counts.hidden > 0 ? [...sections, sectionView('hidden', library.counts.hidden, hidden)] : sections;
};

/** P96 D11: `Turn {turns+1}` while playing, `{turns} turns` once finished. */
export const libraryTurnLine = (row: StartedGameRow): string | undefined => {
  if (row.turns === undefined) return undefined;
  return row.section === 'finished' ? `${String(row.turns)} turns` : `Turn ${String(row.turns + 1)}`;
};

/** P96 D11: `Won by {label}`. */
export const libraryWinnerLine = (row: StartedGameRow): string | undefined =>
  row.winner === undefined ? undefined : `Won by ${row.winner.label}`;

/** P96 D6: the row's name, else `Game {gameNumber}`. */
export const libraryRowTitle = (row: StartedGameRow): string => gameTitle(row.name, row.gameNumber);

/** P96 D12: `conquarrow-{slug-}{gameNumber}.json`; the slug keeps ASCII letters and digits. */
export const exportFileName = (name: string | undefined, gameNumber: string): string => {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? `conquarrow-${gameNumber}.json` : `conquarrow-${slug}-${gameNumber}.json`;
};

/** P96 D12: the lobby line after the game on screen was deleted. */
export const GAME_DELETED_COPY = 'That game was deleted.';

/** P96 D12: Download log could not read the server's export. */
export const EXPORT_FAILED_COPY = 'Could not download the log — try again.';
