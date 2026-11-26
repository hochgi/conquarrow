/**
 * Fixtures for the lost-seat standings view model (P102).
 *
 * Letters and boolean lists only — no GameState, no geometry.
 *
 * @see docs/spec/lost-seat-standings/lost-seat-standings.md
 */

import type { GameSummary, InviteSeat, SeatStanding } from '@conquarrow/contracts';
import { expect } from 'vitest';
import type { SeatLineItem } from '../src/seatLine';
import type { StandingsRow, StandingsView } from '../src/standings';

/** U+2014 EM DASH. A hyphen-minus in the accessible name is a failure. */
export const EM_DASH = '\u2014';

/** `(blank)` — whitespace only, so a trim is empty. Not the absent key. */
export const BLANK_OWNER = '   ';

export const eliminatedName = (letter: string): string => `${letter} ${EM_DASH} eliminated`;

/**
 * Outline tokens. `(absent)` is `undefined`, not the empty list.
 * `(empty)` and `(none)` are `[]`. Other tokens are comma-separated letters.
 */
export const parseLostToken = (token: string): readonly string[] | undefined => {
  if (token === '(absent)') return undefined;
  if (token === '(empty)' || token === '(none)') return [];
  return token.split(',');
};

export const expectNoAccessibleName = (item: SeatLineItem): void => {
  expect(Object.hasOwn(item, 'accessibleLabel')).toBe(false);
};

export const expectMarkedLost = (item: SeatLineItem): void => {
  expect(item.lost).toBe(true);
  expect(item.struck).toBe(true);
  expect(item.greyed).toBe(true);
  expect(item.accessibleLabel).toBe(eliminatedName(item.letter));
};

export const expectNotLost = (item: SeatLineItem): void => {
  expect(item.lost).toBe(false);
  expect(item.struck).toBe(false);
  expect(item.greyed).toBe(false);
  expectNoAccessibleName(item);
};

/** Fallback invents no row. The key is absent, not an empty list. */
export const expectFallback = (view: StandingsView): void => {
  expect(view.kind).toBe('fallback');
  expect(Object.hasOwn(view, 'rows')).toBe(false);
};

export const asTable = (
  view: StandingsView,
): { readonly kind: 'table'; readonly wonOnTurn: string; readonly rows: readonly StandingsRow[] } => {
  expect(view.kind).toBe('table');
  if (view.kind !== 'table') throw new Error('expected a table');
  return view;
};

export const rowOf = (rows: readonly StandingsRow[], letter: string): StandingsRow => {
  const found = rows.find((row) => row.letter === letter);
  expect(found, `row ${letter}`).toBeDefined();
  if (found === undefined) throw new Error(`missing row ${letter}`);
  return found;
};

export const standing = (input: {
  readonly player: string;
  readonly seat: number;
  readonly lost: boolean;
  readonly territory: number;
  readonly shares: number;
  readonly heads: number;
  readonly kind?: InviteSeat['kind'] | undefined;
}): SeatStanding => ({
  player: input.player,
  seat: input.seat,
  kind: input.kind,
  territory: input.territory,
  shares: input.shares,
  heads: input.heads,
  lost: input.lost,
});

export const summaryOf = (
  winner: string,
  turns: number,
  standings: readonly SeatStanding[],
): GameSummary => ({ winner, turns, standings });

/** Letters used by the small-domain sweeps. Not a roster from a match. */
export const LETTERS = ['A', 'B', 'C'] as const;

/** Every sequence of length 0..maxLen over `letters`, including duplicates. `[]` is included. */
export const sequencesUpTo = (
  maxLen: number,
  letters: readonly string[] = LETTERS,
): readonly (readonly string[])[] => {
  let level: readonly (readonly string[])[] = [[]];
  const all: (readonly string[])[] = [[]];
  for (let len = 0; len < maxLen; len += 1) {
    const next: (readonly string[])[] = [];
    for (const seq of level) {
      for (const letter of letters) {
        const grown = [...seq, letter];
        next.push(grown);
        all.push(grown);
      }
    }
    level = next;
  }
  return all;
};

/** Every subset of `letters`, each in `letters` order. */
export const subsetsOf = (letters: readonly string[]): readonly (readonly string[])[] => {
  const out: (readonly string[])[] = [[]];
  for (const letter of letters) {
    const added = out.map((set) => [...set, letter]);
    out.push(...added);
  }
  return out;
};

/** Every assignment of booleans to `letters`. */
export const flagMaps = (letters: readonly string[]): readonly Readonly<Record<string, boolean>>[] => {
  let maps: readonly Readonly<Record<string, boolean>>[] = [{}];
  for (const letter of letters) {
    const next: Readonly<Record<string, boolean>>[] = [];
    for (const map of maps) {
      next.push({ ...map, [letter]: false }, { ...map, [letter]: true });
    }
    maps = next;
  }
  return maps;
};

/**
 * Players the predicate loses, in players order, each letter once (D1).
 * The test oracle. Production must not be this function copied back.
 */
export const lostInOrder = (
  players: readonly string[],
  loses: (letter: string) => boolean,
): readonly string[] => {
  const out: string[] = [];
  for (const letter of players) {
    if (loses(letter) && !out.includes(letter)) out.push(letter);
  }
  return out;
};
