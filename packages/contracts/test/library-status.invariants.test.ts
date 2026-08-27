/**
 * EARS invariants for `libraryStatusFor` (P45).
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check.
 *
 * @see docs/spec/online-game-library/online-game-library.md
 */

import { describe, expect, it } from 'vitest';
import type { InviteSeat, LibrarySummary, UserHash } from '../src/index';
import { libraryStatusFor } from '../src/index';

const ALICE: UserHash = 'alice-user-hash';
const BOB: UserHash = 'bob-user-hash';
const CAROL: UserHash = 'carol-user-hash';

const seats: readonly InviteSeat[] = [
  { kind: 'human', userHash: ALICE },
  { kind: 'human', userHash: BOB },
  { kind: 'heuristic' },
];

const players = ['A', 'B', 'C'] as const;

const summary = (overrides?: {
  readonly activePlayer?: string;
  readonly lostPlayers?: readonly string[];
  readonly winner?: string;
}): LibrarySummary => {
  const row: {
    players: readonly string[];
    activePlayer: string;
    lostPlayers: readonly string[];
    winner?: string;
  } = {
    players,
    activePlayer: overrides?.activePlayer ?? 'A',
    lostPlayers: overrides?.lostPlayers ?? [],
  };
  if (overrides?.winner !== undefined) row.winner = overrides.winner;
  return row;
};

describe('libraryStatusFor invariants', () => {
  it('libraryStatusFor shall be a function of userHash, seats, and summary only: equal inputs shall yield equal status', () => {
    const cases: readonly {
      readonly userHash: UserHash;
      readonly seats: readonly InviteSeat[];
      readonly summary: LibrarySummary | undefined;
    }[] = [
      { userHash: ALICE, seats, summary: undefined },
      { userHash: ALICE, seats, summary: summary() },
      { userHash: BOB, seats, summary: summary({ activePlayer: 'B' }) },
      { userHash: ALICE, seats, summary: summary({ winner: 'A' }) },
      { userHash: BOB, seats, summary: summary({ winner: 'A' }) },
      { userHash: ALICE, seats, summary: summary({ lostPlayers: ['A'], activePlayer: 'A' }) },
      { userHash: CAROL, seats, summary: summary() },
    ];
    for (const input of cases) {
      expect(libraryStatusFor(input.userHash, input.seats, input.summary)).toBe(
        libraryStatusFor(input.userHash, input.seats, input.summary),
      );
    }
  });

  it('When winner is set, bound humans shall not receive your-turn or waiting', () => {
    const won = summary({ winner: 'A' });
    for (const human of [ALICE, BOB]) {
      const status = libraryStatusFor(human, seats, won);
      expect(['won', 'lost'], human).toContain(status);
      expect(status).not.toBe('your-turn');
      expect(status).not.toBe('waiting');
    }
  });

  it('When winner is unset, at most one bound human who is not in lostPlayers is your-turn', () => {
    const boards: readonly LibrarySummary[] = [
      summary({ activePlayer: 'A' }),
      summary({ activePlayer: 'B' }),
      summary({ activePlayer: 'C' }),
      summary({ activePlayer: 'A', lostPlayers: ['B'] }),
      summary({ activePlayer: 'B', lostPlayers: ['A'] }),
    ];
    for (const board of boards) {
      const yours = [ALICE, BOB].filter(
        (human) => libraryStatusFor(human, seats, board) === 'your-turn',
      );
      expect(yours.length).toBeLessThanOrEqual(1);
    }
  });

  it('When the bearer is in lostPlayers and winner is unset, the system shall report lost and shall not report waiting or your-turn', () => {
    const eliminated = summary({ lostPlayers: ['A'], activePlayer: 'A' });
    const status = libraryStatusFor(ALICE, seats, eliminated);
    expect(status).toBe('lost');
    expect(status).not.toBe('waiting');
    expect(status).not.toBe('your-turn');
  });

  it('When winner is the bearer, the system shall report won; when winner is set and is not the bearer, lost', () => {
    const board = summary({ winner: 'A' });
    expect(libraryStatusFor(ALICE, seats, board)).toBe('won');
    expect(libraryStatusFor(BOB, seats, board)).toBe('lost');
  });

  it('When there is no summary, or the caller has no chair, the status is waiting', () => {
    expect(libraryStatusFor(ALICE, seats, undefined)).toBe('waiting');
    expect(libraryStatusFor(CAROL, seats, summary({ activePlayer: 'A' }))).toBe('waiting');
  });
});
