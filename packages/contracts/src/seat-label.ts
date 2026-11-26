/**
 * P105 — the one wording for a seat (moved here from web's P102 `seatLabel`
 * so the server's library rows and every web surface share it). Pure.
 *
 * @see docs/spec/seat-labels/seat-labels.md
 */

import type { InviteSeat } from './online-port';

export type SeatLabelKind = 'human' | 'agent' | 'heuristic' | 'byok';
export type SeatLabelRelation = 'caller-human' | 'caller-agent' | 'other';

/** Facts for one chair. `bound` absent means bound; `ownerName` absent means no name. */
export interface SeatLabelInput {
  readonly letter: string;
  readonly kind: SeatLabelKind;
  readonly relation: SeatLabelRelation;
  readonly bound?: boolean;
  readonly ownerName?: string | undefined;
  /** May this chair read `you`? Absent means no (a stranger's chair never asks). */
  readonly sayYou?: boolean;
}

const RESERVED_SEAT_WORDS: ReadonlySet<string> = new Set(['you', 'your agent', 'ai', 'waiting']);

/** A name that could pose as another seat's fallback (`Player C` on seat B). */
const SEAT_FALLBACK = /^player [a-f]$/;

/**
 * Trimmed and non-empty, and never a word the table itself answers, so another
 * player's name can never read as `you`, `your agent`, `AI`, `waiting` or a
 * `Player <letter>` fallback.
 */
export const usableSeatName = (name: string | undefined): string | undefined => {
  const trimmed = name?.trim() ?? '';
  const lower = trimmed.toLowerCase();
  if (trimmed === '' || RESERVED_SEAT_WORDS.has(lower) || SEAT_FALLBACK.test(lower)) return undefined;
  return trimmed;
};

/** First matching row wins (spec table). */
export const seatLabel = (input: SeatLabelInput): string => {
  if (input.kind === 'heuristic' || input.kind === 'byok') return 'AI';
  if (input.bound === false) return 'waiting';
  if (input.sayYou && input.relation === 'caller-human' && input.kind === 'human') return 'you';
  if (input.relation === 'caller-agent' && input.kind === 'agent') return 'your agent';
  const name = usableSeatName(input.ownerName);
  if (input.kind === 'agent') return name === undefined ? 'Agent' : `${name}'s agent`;
  return name ?? `Player ${input.letter}`;
};

const SEAT_LETTERS = 'ABCDEF';

/** `A` … `F` for seats 0 … 5; `''` outside the board's seats. */
export const seatLetter = (index: number): string => SEAT_LETTERS.charAt(index);

/**
 * The chair's bound user, or `undefined` when nobody is bound. A heuristic
 * chair carries no `userHash`, so one read answers every kind with no branch.
 */
export const chairUserHash = (chair: InviteSeat): string | undefined =>
  (chair as { readonly userHash?: string }).userHash;

/** The owner name the server put on the chair; a heuristic chair has none. */
const chairName = (chair: InviteSeat): string | undefined => (chair as { readonly name?: string }).name;

const relationOf = (
  kind: InviteSeat['kind'],
  chairHash: string | undefined,
  userHash: string | undefined,
): SeatLabelRelation => {
  // An unbound chair compares undefined with the caller's hash, but the
  // `waiting` row answers before any relation row reads this; a heuristic
  // chair answers `AI` before that.
  if (chairHash !== userHash) return 'other';
  return kind === 'agent' ? 'caller-agent' : 'caller-human';
};

/** A chair as the invite, game and library bodies carry it, labelled online (`sayYou`). */
export const labelInviteChair = (input: {
  readonly letter: string;
  readonly chair: InviteSeat;
  readonly userHash?: string | undefined;
}): string => {
  const { chair } = input;
  const chairHash = chairUserHash(chair);
  return seatLabel({
    letter: input.letter,
    kind: chair.kind,
    relation: relationOf(chair.kind, chairHash, input.userHash),
    bound: chairHash !== undefined,
    ownerName: chairName(chair),
    sayYou: true,
  });
};
