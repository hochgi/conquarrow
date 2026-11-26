/**
 * Seat labels for the lobby roster, the seat line, the toast and the standings
 * table. P105: one wording, `seatLabel` in contracts (you, your agent, names,
 * `<name>'s agent`, AI, waiting, `Player X`). Pure: no clock, no DOM, no I/O.
 *
 * @see docs/spec/seat-labels/seat-labels.md
 * @see docs/spec/lost-seat-standings/lost-seat-standings.md
 */

import { labelInviteChair, seatLabel, seatLetter, type InviteSeat } from '@conquarrow/contracts';
import type { SeatKind } from './seatPlan';
import { localTurnSeat, type LocalLogSeat, type TurnVenue } from './turnBanner';

export { seatLabel, type SeatLabelInput } from '@conquarrow/contracts';

/**
 * True when the venue is online, or local with exactly one human seat.
 * A local hot-seat has more than one human, so nobody is `you`.
 */
export const sayYouForRoster = (input: {
  readonly venue: TurnVenue;
  readonly humanSeats: number;
}): boolean => input.venue === 'online' || input.humanSeats === 1;

/** A chair nobody can see: never `you`, never a name. */
const strangerLabel = (letter: string): string =>
  seatLabel({ letter, kind: 'human', relation: 'other' });

/** The lobby roster: chair `index` of an invite, as the signed-in `userHash` sees it. */
export const rosterLabel = (seat: InviteSeat, index: number, userHash: string | undefined): string =>
  labelInviteChair({ letter: seatLetter(index), chair: seat, userHash });

/** Online toast and seat line: the chair for `letter` in `players` order. */
export interface OnlineSeatLabelInput {
  readonly seats?: readonly InviteSeat[] | undefined;
  readonly userHash?: string | undefined;
  readonly players: readonly string[];
  readonly letter: string;
}

export const labelForOnlineSeat = (input: OnlineSeatLabelInput): string => {
  const chair = input.seats?.[input.players.indexOf(input.letter)];
  if (chair === undefined) return strangerLabel(input.letter);
  return labelInviteChair({ letter: input.letter, chair, userHash: input.userHash });
};

/**
 * Local toast and seat line. `configKind` wins for this letter, as `localTurnSeat`
 * specifies. `humanSeats` is the count of `logSeats` whose kind is `human`. No names locally.
 */
export interface LocalSeatLabelInput {
  readonly configKind: SeatKind | undefined;
  readonly logSeats: readonly LocalLogSeat[];
  readonly letter: string;
}

export const labelForLocalSeat = (input: LocalSeatLabelInput): string => {
  const derived = localTurnSeat({
    configKind: input.configKind,
    logSeats: input.logSeats,
    active: input.letter,
  });
  const humanSeats = input.logSeats.filter((seat) => seat.kind === 'human').length;
  return seatLabel({
    letter: input.letter,
    kind: derived.kind,
    relation: derived.relation,
    sayYou: sayYouForRoster({ venue: 'local', humanSeats }),
  });
};

/** The seat line: online when the game is online, local otherwise. */
export interface SeatLineLabelInput {
  readonly letter: string;
  readonly online?: Omit<OnlineSeatLabelInput, 'letter'> | undefined;
  readonly local: Omit<LocalSeatLabelInput, 'letter'>;
}

export const labelForSeat = (input: SeatLineLabelInput): string =>
  input.online === undefined
    ? labelForLocalSeat({ ...input.local, letter: input.letter })
    : labelForOnlineSeat({ ...input.online, letter: input.letter });

/**
 * The seat line prints `letter=label`, so there the `Player X` fallback reads
 * `Player` (`B=Player`, not `B=Player B`). No usable name is `Player <A–F>`,
 * so a name never matches this.
 */
export const seatLineLabel = (input: SeatLineLabelInput): string => {
  const label = labelForSeat(input);
  return label === `Player ${input.letter}` ? 'Player' : label;
};

/**
 * Standings label. `chair` is `seats[standing.seat]`. An absent chair uses
 * `kindHint` when that is `agent` (`Agent`) or `heuristic` (`AI`); any other
 * hint, or none, is `Player X`. An absent chair is never `you`.
 */
export interface ChairLabelInput {
  readonly letter: string;
  readonly chair?: InviteSeat | undefined;
  readonly kindHint?: string | undefined;
  readonly userHash?: string | undefined;
}

/** Only the hints that change the label; `human` reads like no hint at all. */
const knownHint = (hint: string | undefined): 'agent' | 'heuristic' | undefined =>
  hint === 'agent' || hint === 'heuristic' ? hint : undefined;

export const labelForChair = (input: ChairLabelInput): string => {
  if (input.chair !== undefined) {
    return labelInviteChair({ letter: input.letter, chair: input.chair, userHash: input.userHash });
  }
  return seatLabel({
    letter: input.letter,
    kind: knownHint(input.kindHint) ?? 'human',
    relation: 'other',
  });
};
