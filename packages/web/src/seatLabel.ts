/**
 * Seat labels for the toast and the standings table (P102 D5). P101's words.
 * The seat line does not use these. Pure: no clock, no DOM, no I/O.
 *
 * @see docs/spec/lost-seat-standings/lost-seat-standings.md
 */

import type { InviteSeat } from '@conquarrow/contracts';
import type { SeatKind } from './seatPlan';
import {
  localTurnSeat,
  onlineTurnSeat,
  type LocalLogSeat,
  type OnlineSeatFact,
  type TurnRelation,
  type TurnSeatKind,
  type TurnVenue,
} from './turnBanner';

/** Facts for one chair. `ownerName` is absent when there is no name, not `''`. */
export interface SeatLabelInput {
  readonly letter: string;
  readonly kind: TurnSeatKind;
  readonly relation: TurnRelation;
  readonly ownerName?: string;
  readonly sayYou: boolean;
}

const trimmedOwner = (ownerName: string | undefined): string => ownerName?.trim() ?? '';

/** First matching row wins. `you` is exact — not a search for the letters y-o-u. */
export const seatLabel = (input: SeatLabelInput): string => {
  if (input.sayYou && input.relation === 'caller-human' && input.kind === 'human') return 'you';
  if (input.relation === 'caller-agent' && input.kind === 'agent') return 'your agent';
  if (input.kind === 'heuristic' || input.kind === 'byok') return 'AI';
  const owner = trimmedOwner(input.ownerName);
  if (input.kind === 'agent' && owner !== '') return owner;
  return input.letter;
};

/**
 * True when the venue is online, or local with exactly one human seat.
 * A local hot-seat has more than one human, so nobody is `you`.
 */
export const sayYouForRoster = (input: {
  readonly venue: TurnVenue;
  readonly humanSeats: number;
}): boolean => input.venue === 'online' || input.humanSeats === 1;

const withOwner = (
  input: SeatLabelInput,
  ownerName: string | undefined,
): SeatLabelInput =>
  // Stryker disable next-line ConditionalExpression -- optional spread of undefined is the same read as an absent key; the callee treats both as missing
  ownerName === undefined ? input : { ...input, ownerName };

/**
 * Online toast label. Calls `onlineTurnSeat` with `active` set to `letter`, then `seatLabel` with `sayYou: true`.
 */
export interface OnlineSeatLabelInput {
  readonly seats?: readonly OnlineSeatFact[];
  readonly userHash?: string;
  readonly players: readonly string[];
  readonly letter: string;
}

export const labelForOnlineSeat = (input: OnlineSeatLabelInput): string => {
  const derived = onlineTurnSeat({
    players: input.players,
    active: input.letter,
    // Stryker disable next-line ConditionalExpression -- optional spread of undefined is the same read as an absent key; the callee treats both as missing
    ...(input.seats === undefined ? {} : { seats: input.seats }),
    // Stryker disable next-line ConditionalExpression -- optional spread of undefined is the same read as an absent key; the callee treats both as missing
    ...(input.userHash === undefined ? {} : { userHash: input.userHash }),
  });
  return seatLabel(
    withOwner(
      {
        letter: derived.letter,
        kind: derived.kind,
        relation: derived.relation,
        // Online always says you; relation still refuses it unless the chair is proved.
        // humanSeats 0 is ignored for online and keeps this off the one-human local row.
        sayYou: sayYouForRoster({ venue: 'online', humanSeats: 0 }),
      },
      derived.ownerName,
    ),
  );
};

/**
 * Local toast label. `configKind` wins for this letter, as `localTurnSeat` specifies.
 * `humanSeats` is the count of `logSeats` whose kind is `human`. No owner name locally.
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

/**
 * Standings label. `chair` is `seats[standing.seat]`. An absent chair uses `kindHint`
 * when that is `human`, `agent`, or `heuristic`; otherwise the label is the letter.
 * An absent chair is never `you`. `sayYou` is true.
 */
export interface ChairLabelInput {
  readonly letter: string;
  readonly chair?: InviteSeat;
  readonly kindHint?: string;
  readonly userHash?: string;
}

const knownHint = (hint: string | undefined): 'human' | 'agent' | 'heuristic' | undefined => {
  // Stryker disable next-line ConditionalExpression,LogicalOperator -- an absent chair with a human or agent hint labels the letter, which is also the label when that hint is rejected; heuristic is the distinguished case and is tested
  if (hint === 'human' || hint === 'agent'
    || hint === 'heuristic') return hint;
  return undefined;
};

export const labelForChair = (input: ChairLabelInput): string => {
  const sayYou = sayYouForRoster({ venue: 'online', humanSeats: 0 });
  if (input.chair !== undefined) {
    const derived = onlineTurnSeat({
      seats: [input.chair],
      players: [input.letter],
      active: input.letter,
      // Stryker disable next-line ConditionalExpression -- optional spread of undefined is the same read as an absent key; the callee treats both as missing
      ...(input.userHash === undefined ? {} : { userHash: input.userHash }),
    });
    return seatLabel(
      withOwner(
        {
          letter: input.letter,
          kind: derived.kind,
          relation: derived.relation,
          sayYou,
        },
        derived.ownerName,
      ),
    );
  }
  const hint = knownHint(input.kindHint);
  // Stryker disable next-line ConditionalExpression -- an undefined kindHint returns the letter, and seatLabel of an undefined kind also returns the letter and does not take the you, your agent, or AI rows
  if (hint === undefined) return input.letter;
  return seatLabel({ letter: input.letter, kind: hint, relation: 'other', sayYou });
};
