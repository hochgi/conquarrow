/**
 * Resume a local match (P90).
 *
 * Pure decisions and a thin storage backing. The rules core is not involved
 * except as `makeMatch` + `rules.apply` over the logged moves. No clock, no
 * randomness. `localStorage` is reached only inside {@link resumeBacking}.
 *
 * Skeletons throw until phase 3. A constant that the packet states verbatim
 * is the spec, not an implementation.
 */

import type { GameState, PlayerId } from '@conquarrow/contracts';
import type { MatchLog } from './matchLog';
import type { SeatPlan } from './seatPlan';

/** Separate from `conquarrow:last-match`. */
export const RESUME_STORAGE_KEY = 'conquarrow:resume';

/** The Back confirm. Browser refresh copy is not ours to set. */
export const LEAVE_MATCH_CONFIRM =
  'Leave this game? It is saved; Resume it from the lobby.';

/**
 * Why a board is, or is not, the local match being played.
 *
 * A local match with heuristic seats is local: the camera following a bot
 * turn is not a spectated board. `spectated` / `replayed` are for a board
 * that is not that match (an online spectate, a replay that is not the
 * live local game). Online play and the tutorial are their own flags.
 */
export interface ResumeMode {
  readonly tutorial: boolean;
  readonly online: boolean;
  readonly spectated: boolean;
  readonly replayed: boolean;
}

/** The mode `startMatch` writes under: a new local match, nothing else. */
export const LOCAL_RESUME_MODE: ResumeMode = {
  tutorial: false,
  online: false,
  spectated: false,
  replayed: false,
};

export const shouldAutosaveResume = (_mode: ResumeMode): boolean => {
  throw new Error('not implemented');
};

/** Human and heuristic seats only, and the match is not over. */
export const isResumable = (_log: MatchLog): boolean => {
  throw new Error('not implemented');
};

export type ResumeParsed =
  | { readonly ok: true; readonly log: MatchLog }
  | { readonly ok: false; readonly error: string };

/** Strict. A bad save is an error, never a partial log. */
export const parseResumeLog = (_raw: string): ResumeParsed => {
  throw new Error('not implemented');
};

export type ResumeReplayed =
  | { readonly ok: true; readonly log: MatchLog; readonly state: GameState }
  | { readonly ok: false; readonly error: string };

/**
 * `makeMatch(log.config)`, then `rules.apply` for every logged move.
 * A refused move is an error — the result has no state, so a prefix cannot
 * be started. The returned log is the one passed in.
 */
export const replayResumeLog = (_log: MatchLog): ResumeReplayed => {
  throw new Error('not implemented');
};

export interface ResumeBacking {
  read(): string | undefined;
  write(value: string): void;
  remove(): void;
}

export interface ResumeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The only place a resume save touches storage. `undefined` is "no window". */
export const resumeBacking = (_storage: ResumeStorage | undefined): ResumeBacking => {
  throw new Error('not implemented');
};

export interface ResumeStore {
  save(log: MatchLog): void;
  /** The log, or nothing when missing, unreadable, or the backing throws. */
  load(): MatchLog | undefined;
  /** Raw text even when it does not parse. Nothing when missing or the backing throws. */
  readRaw(): string | undefined;
  remove(): void;
}

export const createResumeStore = (_backing: ResumeBacking): ResumeStore => {
  throw new Error('not implemented');
};

/**
 * Write the resume save after a local move, replace it when a local match
 * starts, or delete it when that match has a winner. Any other mode leaves
 * the existing save untouched.
 */
export const persistResume = (
  _store: ResumeStore,
  _log: MatchLog,
  _mode: ResumeMode,
): void => {
  throw new Error('not implemented');
};

/**
 * One line: seat kinds in log order, the 1-based round, the move count.
 * Round is `floor(endTurns / playerCount) + 1` — the round the resumed
 * position is in, without replaying.
 */
export const resumeDescription = (_log: MatchLog): string => {
  throw new Error('not implemented');
};

/** Seat plan rebuilt from `log.seats`. Kinds only — the log holds no API key. */
export const seatPlanFromLog = (_log: MatchLog): SeatPlan => {
  throw new Error('not implemented');
};

export type ResumeOffer =
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly error: string; readonly raw: string }
  | { readonly kind: 'download'; readonly log: MatchLog; readonly raw: string }
  | {
      readonly kind: 'offer';
      readonly log: MatchLog;
      readonly description: string;
      readonly raw: string;
    };

/**
 * What the lobby can show from the saved text alone. Replay is not run here:
 * a move `rules.apply` refuses is reported when Resume is asked, not by
 * painting a prefix.
 */
export const resumeOffer = (_raw: string | undefined): ResumeOffer => {
  throw new Error('not implemented');
};

export const shouldGuardLeave = (_args: {
  readonly mode: ResumeMode;
  readonly winner: PlayerId | undefined;
}): boolean => {
  throw new Error('not implemented');
};

/** Cancel stays (the caller pushes the history entry again). OK returns to the lobby. */
export const leaveChoice = (_confirmed: boolean): 'stay' | 'lobby' => {
  throw new Error('not implemented');
};
