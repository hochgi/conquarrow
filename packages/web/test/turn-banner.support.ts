/**
 * Shared oracle for the turn-banner truth table (D2, D3, D4).
 *
 * The product is the full cartesian named in the edge feature: kind × relation
 * × replay × venue, and each local cell is read once as hot-seat and once as
 * versus-bot running and not busy. Not a sample.
 *
 * @see docs/spec/turn-banner/turn-banner.edge-cases.feature
 */

import { expect } from 'vitest';
import type { PauseKind } from '../src/botPause';
import {
  turnBannerCopy,
  type OnlineTurnSeatResult,
  type TurnBannerCopy,
  type TurnBannerInput,
  type TurnPhase,
  type TurnRelation,
  type TurnSeatKind,
  type TurnVenue,
} from '../src/turnBanner';

/** Space, middle dot U+00B7, space, you. Not a substring of `your agent`. */
export const YOU_SUFFIX = ' · you';

/** The hint prefix that claims the turn. Not a search for the letters y-o-u. */
export const YOUR_TURN_PREFIX = 'Your turn';

export const KINDS = ['human', 'agent', 'heuristic', 'byok'] as const satisfies readonly TurnSeatKind[];

export const RELATIONS = ['caller-human', 'caller-agent', 'other'] as const satisfies readonly TurnRelation[];

export const REPLAYS = [false, true] as const;

export type LocalReading = 'hot-seat' | 'versus-bot';

export type ProductReading = 'online' | LocalReading;

export interface ProductRow {
  readonly kind: TurnSeatKind;
  readonly relation: TurnRelation;
  readonly replaying: boolean;
  readonly venue: TurnVenue;
  readonly reading: ProductReading;
}

/**
 * 4 kinds × 3 relations × 2 replay flags × 3 readings
 * (online, local hot-seat, local versus-bot running and not busy) = 72.
 */
export const product = (): readonly ProductRow[] => {
  const rows: ProductRow[] = [];
  for (const kind of KINDS) {
    for (const relation of RELATIONS) {
      for (const replaying of REPLAYS) {
        rows.push({ kind, relation, replaying, venue: 'online', reading: 'online' });
        rows.push({ kind, relation, replaying, venue: 'local', reading: 'hot-seat' });
        rows.push({ kind, relation, replaying, venue: 'local', reading: 'versus-bot' });
      }
    }
  }
  return rows;
};

export const isCallerHumanSeat = (row: {
  readonly kind: TurnSeatKind;
  readonly relation: TurnRelation;
}): boolean => row.kind === 'human' && row.relation === 'caller-human';

/**
 * ` · you` only for a caller-human human seat, and locally only on the
 * versus-bot reading (that reading is running and not busy).
 */
export const isYouCase = (row: ProductRow): boolean =>
  isCallerHumanSeat(row) && (row.venue === 'online' || row.reading === 'versus-bot');

/** Online, not the caller's human seat, and no replay. */
export const thinkingOn = (row: ProductRow): boolean =>
  row.venue === 'online' && !isCallerHumanSeat(row) && !row.replaying;

export const rowLabel = (row: ProductRow): string =>
  `${row.venue}/${row.reading} ${row.kind} ${row.relation} replay=${row.replaying ? 'yes' : 'no'}`;

/**
 * Idle with moves left, so the you-case hint starts with `Your turn`.
 * Versus-bot is running and not busy. Online flags are present and ignored.
 */
export const copyInput = (row: ProductRow, letter = 'C'): TurnBannerInput => ({
  venue: row.venue,
  letter,
  kind: row.kind,
  relation: row.relation,
  replaying: row.replaying,
  vsBot: row.reading === 'versus-bot',
  pause: 'running',
  botBusy: false,
  byokActive: false,
  phase: 'idle',
  movableCount: 1,
  routeHint: '',
});

export interface TurnBannerOverrides {
  readonly venue: TurnVenue;
  readonly letter: string;
  readonly kind: TurnSeatKind;
  readonly relation: TurnRelation;
  readonly ownerName?: string;
  readonly replaying?: boolean;
  readonly vsBot?: boolean;
  readonly pause?: PauseKind;
  readonly botBusy?: boolean;
  readonly byokActive?: boolean;
  readonly phase?: TurnPhase;
  readonly movableCount?: number;
  readonly routeHint?: string;
}

/** Defaults are a quiet idle turn with moves left. Omitted flags stay off. */
export const readTurn = (over: TurnBannerOverrides): TurnBannerCopy => {
  const input: TurnBannerInput = {
    venue: over.venue,
    letter: over.letter,
    kind: over.kind,
    relation: over.relation,
    replaying: over.replaying ?? false,
    vsBot: over.vsBot ?? false,
    pause: over.pause ?? 'running',
    botBusy: over.botBusy ?? false,
    byokActive: over.byokActive ?? false,
    phase: over.phase ?? 'idle',
    movableCount: over.movableCount ?? 1,
    routeHint: over.routeHint ?? '',
  };
  if (over.ownerName === undefined) return turnBannerCopy(input);
  return turnBannerCopy({ ...input, ownerName: over.ownerName });
};

export const expectNoOwner = (seat: OnlineTurnSeatResult): void => {
  expect(Object.hasOwn(seat, 'ownerName')).toBe(false);
};
