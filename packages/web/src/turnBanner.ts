/**
 * Whose turn the banner names (P101). Pure: no clock, no DOM, no I/O.
 *
 * The words live here so Hud cannot drift them. Starvation, the tutorial
 * banner, and the victory banner stay in Hud and do not call this module.
 *
 * @see docs/spec/turn-banner/turn-banner.md
 */

import { pauseHint, type PauseKind } from './botPause';
import type { SeatKind } from './seatPlan';

export type TurnVenue = 'local' | 'online';

export type TurnSeatKind = 'human' | 'agent' | 'heuristic' | 'byok';

export type TurnRelation = 'caller-human' | 'caller-agent' | 'other';

/** Idle, blocked, or route. The route sentence arrives already resolved. */
export type TurnPhase = 'idle' | 'blocked' | 'route';

/**
 * Facts `turnBannerCopy` needs. Online ignores `vsBot`, `pause`, `botBusy`,
 * and `byokActive`. `ownerName` is set only when the seat label carried one.
 */
export interface TurnBannerInput {
  readonly venue: TurnVenue;
  readonly letter: string;
  readonly kind: TurnSeatKind;
  readonly relation: TurnRelation;
  readonly ownerName?: string;
  readonly replaying: boolean;
  readonly vsBot: boolean;
  readonly pause: PauseKind;
  readonly botBusy: boolean;
  readonly byokActive: boolean;
  readonly phase: TurnPhase;
  readonly movableCount: number;
  readonly routeHint: string;
}

export interface TurnBannerCopy {
  readonly letter: string;
  readonly suffix: string;
  readonly banner: string;
  readonly hint: string;
  readonly thinking: boolean;
}

/**
 * Seat facts App passes in. Online comes from `onlineTurnSeat`. Locally the
 * human chair is `caller-human` and every other kind is `other`, with no name.
 */
export interface TurnBannerSeat {
  readonly venue: TurnVenue;
  readonly kind: TurnSeatKind;
  readonly relation: TurnRelation;
  readonly ownerName?: string;
}

/**
 * A chair on the game seats, aligned with `players` (P18). `label` is the
 * optional agent display the GET already sends; human and heuristic labels
 * are not a name source.
 */
export type OnlineSeatFact =
  | { readonly kind: 'human'; readonly userHash?: string; readonly label?: string }
  | { readonly kind: 'agent'; readonly userHash?: string; readonly label?: string }
  | { readonly kind: 'heuristic'; readonly label?: string };

export interface OnlineTurnSeatInput {
  readonly seats?: readonly OnlineSeatFact[];
  readonly userHash?: string;
  readonly players: readonly string[];
  readonly active: string;
}

export interface OnlineTurnSeatResult {
  readonly letter: string;
  readonly kind: TurnSeatKind;
  readonly relation: TurnRelation;
  readonly ownerName?: string;
}

/** Space, U+00B7, space. The same dot the you-suffix tests lock. */
const DOT = ' \u00B7 ';

const ELLIPSIS = '\u2026';

const PASSING = `No steps left — passing${ELLIPSIS}`;

const CALLER_IDLE = 'Your turn — gold-outlined stacks can still move';

const HOT_IDLE = 'Gold-outlined stacks can still move';

const BLOCKED =
  'This stack has nowhere to go. Another gold stack is auto-selected when one finishes';

const AI_MOVING = `AI seat is moving${ELLIPSIS}`;

const LLM_THINKING = `LLM seat is thinking${ELLIPSIS}`;

/** `Agent (` … last `)`. Trimmed, and absent when the interior is empty. */
const AGENT_PREFIX = 'Agent (';

interface CopyParts {
  readonly suffix: string;
  readonly hint: string;
}

const callerHuman = (input: TurnBannerInput): boolean =>
  input.relation === 'caller-human' && input.kind === 'human';

/** Online, not the caller's human seat, and no replay. Local is never thinking. */
const thinkingOf = (input: TurnBannerInput): boolean =>
  input.venue === 'online' && !callerHuman(input) && !input.replaying;

const phaseSentence = (input: TurnBannerInput, idleWithMoves: string): string => {
  if (input.phase === 'blocked') return BLOCKED;
  if (input.phase === 'route') return input.routeHint;
  if (input.movableCount === 0) return PASSING;
  return idleWithMoves;
};

/** Non-empty after trim; otherwise the seat letter. */
const displayName = (input: TurnBannerInput): string => {
  const trimmed = input.ownerName?.trim() ?? '';
  return trimmed === '' ? input.letter : trimmed;
};

const playingSuffix = (input: TurnBannerInput): string => {
  if (input.kind === 'agent' && input.relation === 'caller-agent') {
    return `${DOT}your agent is playing${ELLIPSIS}`;
  }
  if (input.kind === 'agent') {
    return `${DOT}${displayName(input)}'s agent is playing${ELLIPSIS}`;
  }
  if (input.kind === 'heuristic' || input.kind === 'byok') {
    return `${DOT}AI is playing${ELLIPSIS}`;
  }
  return `${DOT}${input.letter} is playing${ELLIPSIS}`;
};

const onlineParts = (input: TurnBannerInput): CopyParts => {
  if (callerHuman(input)) {
    return { suffix: `${DOT}you`, hint: phaseSentence(input, CALLER_IDLE) };
  }
  return { suffix: playingSuffix(input), hint: `Waiting for ${input.letter}${ELLIPSIS}` };
};

/** A pause sentence, or absent while bots are running. */
const pausedParts = (pause: PauseKind): CopyParts | undefined => {
  const hint = pauseHint(pause);
  if (hint === undefined) return undefined;
  return { suffix: `${DOT}paused`, hint };
};

const botParts = (byokActive: boolean): CopyParts =>
  byokActive
    ? { suffix: `${DOT}llm`, hint: LLM_THINKING }
    : { suffix: `${DOT}ai`, hint: AI_MOVING };

/**
 * Hot-seat ignores pause and kind. Versus-bot: pause, then a non-human or a
 * busy seat, then the caller's human seat, then the hot-seat sentence.
 */
const localParts = (input: TurnBannerInput): CopyParts => {
  if (!input.vsBot) {
    return { suffix: '', hint: phaseSentence(input, HOT_IDLE) };
  }
  const paused = pausedParts(input.pause);
  if (paused !== undefined) return paused;
  // Row 2 already excludes a free human, so the next row only asks relation.
  if (input.kind !== 'human' || input.botBusy) return botParts(input.byokActive);
  if (input.relation === 'caller-human') {
    return { suffix: `${DOT}you`, hint: phaseSentence(input, CALLER_IDLE) };
  }
  return { suffix: '', hint: phaseSentence(input, HOT_IDLE) };
};

const assemble = (input: TurnBannerInput, parts: CopyParts): TurnBannerCopy => ({
  letter: input.letter,
  suffix: parts.suffix,
  banner: `Turn: ${input.letter}${parts.suffix}`,
  hint: parts.hint,
  thinking: thinkingOf(input),
});

export const turnBannerCopy = (input: TurnBannerInput): TurnBannerCopy =>
  assemble(input, input.venue === 'online' ? onlineParts(input) : localParts(input));

const unknownChair = (letter: string): OnlineTurnSeatResult => ({
  letter,
  kind: 'human',
  relation: 'other',
});

const relationFor = (seat: OnlineSeatFact, userHash: string | undefined): TurnRelation => {
  if (userHash === undefined) return 'other';
  // Agent first: a widened kind check must not call a matching human an agent.
  if (seat.kind === 'agent') return seat.userHash === userHash ? 'caller-agent' : 'other';
  if (seat.kind === 'human') return seat.userHash === userHash ? 'caller-human' : 'other';
  return 'other';
};

/**
 * Interior between the first `Agent (` and the last `)`, trimmed and non-empty.
 * No opening or no closing parenthesis is not a name.
 */
const ownerNameFrom = (label: string | undefined): string | undefined => {
  if (label === undefined) return undefined;
  const start = label.indexOf(AGENT_PREFIX);
  if (start === -1) return undefined;
  const end = label.lastIndexOf(')');
  if (end === -1) return undefined;
  const name = label.slice(start + AGENT_PREFIX.length, end).trim();
  return name === '' ? undefined : name;
};

const withOwner = (seat: OnlineSeatFact, base: OnlineTurnSeatResult): OnlineTurnSeatResult => {
  if (seat.kind !== 'agent') return base;
  const ownerName = ownerNameFrom(seat.label);
  if (ownerName === undefined) return base;
  return { ...base, ownerName };
};

export const onlineTurnSeat = (input: OnlineTurnSeatInput): OnlineTurnSeatResult => {
  const letter = input.active;
  const seat = input.seats?.[input.players.indexOf(letter)];
  if (seat === undefined) return unknownChair(letter);
  return withOwner(seat, {
    letter,
    kind: seat.kind,
    relation: relationFor(seat, input.userHash),
  });
};

/** One persisted chair. `player` is compared to `active` as a string (D6). */
export interface LocalLogSeat {
  readonly player: string;
  readonly kind: SeatKind;
}

/**
 * `configKind` wins when it is defined. Otherwise the log row whose `player`
 * equals `active`. Absent means no config, not a human caller.
 */
export interface LocalTurnSeatInput {
  readonly configKind: SeatKind | undefined;
  readonly logSeats: readonly LocalLogSeat[];
  readonly active: string;
}

/** Kind and relation only. `ownerName` is never a key. */
export interface LocalTurnSeatResult {
  readonly kind: SeatKind;
  readonly relation: TurnRelation;
}

/**
 * Local chair for the banner (D6). App only calls this.
 *
 * A known human is the caller. A known bot is other. No config and no log row
 * for `active` is human-shaped but not the caller — never `caller-human`.
 * `ownerName` is never a key.
 */
export const localTurnSeat = (input: LocalTurnSeatInput): LocalTurnSeatResult => {
  const kind =
    input.configKind ?? input.logSeats.find((seat) => seat.player === input.active)?.kind;
  if (kind === undefined) return { kind: 'human', relation: 'other' };
  return { kind, relation: kind === 'human' ? 'caller-human' : 'other' };
};

/**
 * Configured kind of the local seat (D6). No seat is not a kind — `localTurnSeat`
 * treats a missing `configKind` as not the caller. App reads this instead of
 * `activeSeat?.kind`.
 */
export const localConfigKind = (seat: { readonly kind: SeatKind } | undefined): SeatKind | undefined =>
  seat?.kind;
