/**
 * EARS invariants for docs/spec/lost-seat-standings/lost-seat-standings.md.
 *
 * Exhaustive over letters and boolean lists. No GameState, no geometry, no
 * fast-check. Invariant 8 does not pass a GameSummary — lostSeatIds cannot
 * read one.
 */

import type { GameSummary, InviteSeat, SeatStanding } from '@conquarrow/contracts';
import { describe, expect, it } from 'vitest';
import { eliminationToasts, lostSeatIds, newlyLost, observeLosses } from '../src/lostSeat';
import { seatLineView } from '../src/seatLine';
import { standingsForHud, standingsView } from '../src/standings';
import {
  asTable,
  eliminatedName,
  expectFallback,
  expectNoAccessibleName,
  flagMaps,
  LETTERS,
  lostInOrder,
  sequencesUpTo,
  standing,
  subsetsOf,
  summaryOf,
} from './lost-seat-standings.support';

const IDENTITIES = ['g/000001', 'local:2026-11-25T00:00:00.000Z'] as const;

/** Spec sentence. A label of exactly `you` is the only `were`. */
const sentenceOf = (label: string): string =>
  label === 'you' ? 'You were eliminated' : `${label} was eliminated`;

/** Letters in `next` that are not in `prev`, in next order, first occurrence only. Absent prev emits nothing. */
const expectedNewly = (
  prev: readonly string[] | undefined,
  next: readonly string[],
): readonly string[] => {
  if (prev === undefined) return [];
  const out: string[] = [];
  for (const letter of next) {
    if (out.includes(letter) || prev.includes(letter)) continue;
    out.push(letter);
  }
  return out;
};

const kindLabelOf = (letter: string): string => {
  if (letter === 'B') return 'AI';
  if (letter === 'C') return 'Agent';
  return 'Player';
};

const WINNERS = ['A', 'B', 'C', 'Z'] as const;

const PLAYER_ORDERS: readonly (readonly string[])[] = [
  [],
  ['A'],
  ['B'],
  ['C'],
  ['A', 'B'],
  ['B', 'A'],
  ['A', 'B', 'C'],
  ['C', 'A', 'B'],
  ['B', 'C', 'A'],
  ['A', 'A'],
  ['A', 'B', 'A'],
];

/** Winners first, then the rest. Each group keeps server order. Duplicate players both move. */
const expectedRowOrder = (players: readonly string[], winner: string): readonly string[] => [
  ...players.filter((player) => player === winner),
  ...players.filter((player) => player !== winner),
];

const CHAIRS: readonly { readonly name: string; readonly chair: InviteSeat | undefined }[] = [
  { name: 'absent', chair: undefined },
  { name: 'human-alice', chair: { kind: 'human', userHash: 'alice' } },
  { name: 'human-bob', chair: { kind: 'human', userHash: 'bob' } },
  { name: 'human-unbound', chair: { kind: 'human' } },
  { name: 'agent-alice', chair: { kind: 'agent', userHash: 'alice', name: 'Ada' } },
  { name: 'heuristic', chair: { kind: 'heuristic' } },
];

const KIND_HINTS: readonly (InviteSeat['kind'] | undefined)[] = [
  undefined,
  'human',
  'agent',
  'heuristic',
];

const HASHES: readonly (string | undefined)[] = [undefined, 'alice', 'bob'];

/** A human chair whose userHash is the caller. An agent with that hash is not this. */
const provedHuman = (chair: InviteSeat | undefined, hash: string | undefined): boolean => {
  if (hash === undefined || chair === undefined || chair.kind !== 'human') return false;
  return chair.userHash === hash;
};

const oneStanding = (kind: InviteSeat['kind'] | undefined): GameSummary =>
  summaryOf('A', 1, [
    standing({ player: 'A', seat: 0, lost: false, territory: 1, shares: 0, heads: 1, kind }),
  ]);

describe('lost-seat standings invariants', () => {
  it('When the previous lost set is absent, the system shall emit no elimination toast, whatever the next set contains', () => {
    const nexts = sequencesUpTo(3);
    expect(nexts).toHaveLength(40);

    for (const next of nexts) {
      expect(newlyLost(undefined, next), `next=${next.join(',') || 'empty'}`).toEqual([]);
      expect(eliminationToasts(newlyLost(undefined, next), (letter) => letter)).toEqual([]);
      for (const identity of IDENTITIES) {
        expect(observeLosses(undefined, identity, next).newly, identity).toEqual([]);
      }
    }
  });

  it('When a letter is in both the previous and the next lost set, the system shall not toast that letter', () => {
    const prevs = subsetsOf([...LETTERS]);
    const nexts = sequencesUpTo(3);
    expect(prevs).toHaveLength(8);
    expect(nexts).toHaveLength(40);
    let overlaps = 0;

    for (const prev of prevs) {
      for (const next of nexts) {
        const shared = prev.filter((letter) => next.includes(letter));
        if (shared.length === 0) continue;
        overlaps += 1;
        const newly = newlyLost(prev, next);
        const ids = eliminationToasts(newly, (letter) => letter).map((toast) => toast.id);
        for (const letter of shared) {
          expect(newly, `prev=${prev.join('')} next=${next.join('')}`).not.toContain(letter);
          expect(ids, letter).not.toContain(letter);
        }
      }
    }
    expect(overlaps).toBeGreaterThan(0);
  });

  it('When several letters are newly lost in one snapshot, the system shall emit one toast per letter, in next-lost order, with no duplicates', () => {
    const prevs = subsetsOf([...LETTERS]);
    const nexts = sequencesUpTo(3);
    expect(prevs).toHaveLength(8);
    expect(nexts).toHaveLength(40);
    let several = 0;

    for (const prev of prevs) {
      for (const next of nexts) {
        const expected = expectedNewly(prev, next);
        const newly = newlyLost(prev, next);
        expect(newly, `prev=${prev.join(',')} next=${next.join(',')}`).toEqual(expected);
        expect(new Set(newly).size).toBe(newly.length);

        const toasts = eliminationToasts(newly, (letter) => letter);
        expect(toasts.map((toast) => toast.id)).toEqual(expected);
        expect(toasts.map((toast) => toast.text)).toEqual(expected.map((letter) => sentenceOf(letter)));
        if (expected.length >= 2) several += 1;
      }
    }
    expect(several).toBeGreaterThan(0);
  });

  it('When a seat-line letter is in the lost set, that item shall be struck, greyed, and accessibly named with the letter and eliminated; a letter that is not lost shall have none of those', () => {
    const rosters = sequencesUpTo(3);
    const lostSets = subsetsOf([...LETTERS, 'Z']);
    expect(rosters).toHaveLength(40);
    expect(lostSets).toHaveLength(16);

    for (const letters of rosters) {
      for (const lost of lostSets) {
        const seats = letters.map((letter) => ({ letter, kindLabel: kindLabelOf(letter) }));
        const items = seatLineView(seats, lost);
        const where = `seats=${letters.join('')} lost=${lost.join('') || 'none'}`;
        expect(items, where).toHaveLength(seats.length);
        expect(items.map((item) => item.letter), where).toEqual([...letters]);
        for (const item of items) {
          expect(item.text, where).toBe(`${item.letter}=${kindLabelOf(item.letter)}`);
          if (lost.includes(item.letter)) {
            expect(item.lost, where).toBe(true);
            expect(item.struck, where).toBe(true);
            expect(item.greyed, where).toBe(true);
            expect(item.accessibleLabel, where).toBe(eliminatedName(item.letter));
          } else {
            expect(item.lost, where).toBe(false);
            expect(item.struck, where).toBe(false);
            expect(item.greyed, where).toBe(false);
            expectNoAccessibleName(item);
          }
        }
      }
    }
  });

  it('When summary is absent, or the displayed match is not yet showing game-over, the standings view shall be the fallback and shall invent no row', () => {
    const present: readonly GameSummary[] = [
      summaryOf('A', 0, []),
      summaryOf('A', 14, [
        standing({ player: 'A', seat: 0, lost: false, territory: 12, shares: 3, heads: 4 }),
        standing({ player: 'B', seat: 1, lost: true, territory: 0, shares: 0, heads: 0 }),
      ]),
    ];
    const seatSets: readonly (readonly InviteSeat[] | undefined)[] = [
      undefined,
      [],
      [{ kind: 'human', userHash: 'alice' }],
    ];
    const hashes: readonly (string | undefined)[] = [undefined, 'alice'];
    let sawPresentWhilePlaying = 0;

    for (const seats of seatSets) {
      for (const hash of hashes) {
        expectFallback(standingsView(undefined, seats, hash));
        expectFallback(standingsForHud(true, undefined, seats, hash));
        for (const summary of present) {
          sawPresentWhilePlaying += 1;
          expectFallback(standingsForHud(false, summary, seats, hash));
        }
      }
    }
    expect(sawPresentWhilePlaying).toBeGreaterThan(0);
  });

  it('When a table is shown, every winner row shall precede every non-winner row, and each of those groups shall keep server order', () => {
    expect(PLAYER_ORDERS).toHaveLength(11);
    expect(WINNERS).toHaveLength(4);
    let sawSplit = 0;

    for (const players of PLAYER_ORDERS) {
      for (const winner of WINNERS) {
        const standings: readonly SeatStanding[] = players.map((player, seat) =>
          standing({
            player,
            seat,
            lost: seat % 2 === 1,
            territory: seat,
            shares: 0,
            heads: 1,
          }),
        );
        const summary = summaryOf(winner, 3, standings);
        const expected = expectedRowOrder(players, winner);
        const views = [
          standingsView(summary, undefined, undefined),
          standingsForHud(true, summary, undefined, undefined),
        ];
        for (const view of views) {
          const table = asTable(view);
          expect(table.rows.map((row) => row.letter)).toEqual(expected);
          let seenNonWinner = false;
          for (const row of table.rows) {
            if (!row.winner) seenNonWinner = true;
            else expect(seenNonWinner, `${players.join('')}/${winner}`).toBe(false);
            expect(row.winner).toBe(row.letter === winner);
          }
        }
        if (expected.some((letter) => letter === winner) && expected.some((letter) => letter !== winner)) {
          sawSplit += 1;
        }
      }
    }
    expect(sawSplit).toBeGreaterThan(0);
  });

  it('When the caller is not proved to own a human chair, no standings row shall be marked you', () => {
    expect(CHAIRS).toHaveLength(6);
    expect(KIND_HINTS).toHaveLength(4);
    expect(HASHES).toHaveLength(3);
    let negatives = 0;

    for (const { name, chair } of CHAIRS) {
      for (const kind of KIND_HINTS) {
        for (const hash of HASHES) {
          const seats = chair === undefined ? undefined : [chair];
          const view = standingsView(oneStanding(kind), seats, hash);
          const table = asTable(view);
          if (provedHuman(chair, hash)) continue;
          negatives += 1;
          for (const row of table.rows) {
            expect(row.you, `${name} kind=${kind ?? 'absent'} hash=${hash ?? 'absent'}`).toBe(false);
            expect(row.label).not.toBe('you');
          }
        }
      }
    }

    // The caller's agent is a chair, and not a human one. Neither row is you.
    const agentWorld = standingsView(
      summaryOf('A', 2, [
        standing({ player: 'A', seat: 0, lost: false, territory: 1, shares: 0, heads: 1 }),
        standing({ player: 'C', seat: 1, lost: true, territory: 0, shares: 0, heads: 0 }),
      ]),
      [
        { kind: 'human', userHash: 'bob' },
        { kind: 'agent', userHash: 'alice', name: 'Ada' },
      ],
      'alice',
    );
    const agentTable = asTable(agentWorld);
    expect(agentTable.rows.length).toBeGreaterThan(0);
    for (const row of agentTable.rows) {
      expect(row.you).toBe(false);
      expect(row.label).not.toBe('you');
    }
    expect(negatives).toBeGreaterThan(0);
  });

  it('The seat line\'s lost flags shall come from the injected rules predicate, not from GameSummary', () => {
    const players = sequencesUpTo(3);
    const flags = flagMaps([...LETTERS]);
    expect(players).toHaveLength(40);
    expect(flags).toHaveLength(8);

    for (const roster of players) {
      for (const flag of flags) {
        const loses = (letter: string): boolean => flag[letter] === true;
        // No GameSummary argument. A disagreeing summary cannot be passed.
        expect(lostSeatIds(roster, loses)).toEqual(lostInOrder(roster, loses));
      }
    }
  });
});
