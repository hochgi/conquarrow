/**
 * docs/spec/lost-seat-standings/lost-seat-standings.edge-cases.feature
 *
 * One it() per Gherkin scenario. Each Scenario Outline is an it.each over every
 * Examples row. Pure helpers — no DOM, no test-kit.
 */

import type { InviteSeat } from '@conquarrow/contracts';
import { describe, expect, it } from 'vitest';
import {
  ELIMINATION_TOAST_MS,
  eliminationSentence,
  lostSeatIds,
  matchIdentity,
  newlyLost,
  observeLosses,
} from '../src/lostSeat';
import { parseBoard, parseGameSummary } from '../src/online-parse';
import { seatLineView } from '../src/seatLine';
import {
  labelForChair,
  labelForLocalSeat,
  labelForOnlineSeat,
  seatLabel,
  type SeatLabelInput,
} from '../src/seatLabel';
import { standingsForHud } from '../src/standings';
import type { LocalLogSeat, TurnRelation, TurnSeatKind } from '../src/turnBanner';
import {
  asTable,
  BLANK_OWNER,
  expectMarkedLost,
  expectNotLost,
  parseLostToken,
  rowOf,
  standing,
  summaryOf,
} from './lost-seat-standings.support';

const IDENTITY_ROWS = [
  { online: true, hash: '#/g/abc/000001', startedAt: '2026-11-25T00:00:00.000Z', identity: 'abc/000001' },
  {
    online: false,
    hash: '#/g/abc/000001',
    startedAt: '2026-11-25T00:00:00.000Z',
    identity: 'local:2026-11-25T00:00:00.000Z',
  },
  { online: true, hash: '#/', startedAt: '2026-11-25T00:00:00.000Z', identity: 'local:2026-11-25T00:00:00.000Z' },
  {
    online: true,
    hash: '#/invite/tok',
    startedAt: '2026-11-25T00:00:00.000Z',
    identity: 'local:2026-11-25T00:00:00.000Z',
  },
] as const;

const DIFF_ROWS = [
  { prev: '(absent)', next: 'A,C', result: '(none)' },
  { prev: '(empty)', next: 'B,C', result: 'B,C' },
  { prev: 'A', next: 'A,C', result: 'C' },
  { prev: 'A,C', next: 'A,C', result: '(none)' },
  { prev: 'C', next: 'A', result: 'A' },
  { prev: 'A', next: 'C,A,C', result: 'C' },
  { prev: '(empty)', next: '(empty)', result: '(none)' },
  { prev: 'B,C', next: 'C,B', result: '(none)' },
] as const;

const LABEL_ROWS = [
  { letter: 'A', kind: 'human', relation: 'caller-human', owner: '(none)', sayYou: true, label: 'you' },
  { letter: 'A', kind: 'human', relation: 'caller-human', owner: '(none)', sayYou: false, label: 'A' },
  { letter: 'C', kind: 'agent', relation: 'caller-agent', owner: 'Ada', sayYou: true, label: 'your agent' },
  { letter: 'C', kind: 'agent', relation: 'caller-agent', owner: '(none)', sayYou: true, label: 'your agent' },
  { letter: 'B', kind: 'heuristic', relation: 'other', owner: '(none)', sayYou: true, label: 'AI' },
  { letter: 'B', kind: 'byok', relation: 'other', owner: '(none)', sayYou: false, label: 'AI' },
  { letter: 'B', kind: 'agent', relation: 'other', owner: 'Ada', sayYou: true, label: 'Ada' },
  { letter: 'B', kind: 'agent', relation: 'other', owner: '(none)', sayYou: true, label: 'B' },
  { letter: 'B', kind: 'human', relation: 'other', owner: '(none)', sayYou: true, label: 'B' },
  { letter: 'B', kind: 'agent', relation: 'other', owner: '(blank)', sayYou: true, label: 'B' },
  { letter: 'A', kind: 'human', relation: 'caller-agent', owner: '(none)', sayYou: true, label: 'A' },
  { letter: 'C', kind: 'agent', relation: 'caller-human', owner: 'Ada', sayYou: true, label: 'Ada' },
] as const satisfies readonly {
  readonly letter: string;
  readonly kind: TurnSeatKind;
  readonly relation: TurnRelation;
  readonly owner: '(none)' | '(blank)' | 'Ada';
  readonly sayYou: boolean;
  readonly label: string;
}[];

const FAULTS = [
  'is not an object',
  'has an empty winner',
  'has a fractional turn count',
  'has a negative turn count',
  'has no standings array',
  'has a standing with no player',
  'has a standing whose lost is not a boolean',
  'has a standing with a negative head count',
] as const;

type Fault = (typeof FAULTS)[number];

const VALID_STANDING = {
  player: 'A',
  seat: 0,
  territory: 1,
  shares: 0,
  heads: 1,
  lost: false,
} as const;

/** A valid summary whose only varying field is the standing's kind. */
const summaryWithKind = (kind: string): unknown => ({
  winner: 'A',
  turns: 1,
  standings: [{ ...VALID_STANDING, kind }],
});

/** One invalid summary per Examples row. The rest of the body stays a versioned board. */
const summaryForFault = (fault: Fault): unknown => {
  switch (fault) {
    case 'is not an object':
      return null;
    case 'has an empty winner':
      return { winner: '', turns: 1, standings: [VALID_STANDING] };
    case 'has a fractional turn count':
      return { winner: 'A', turns: 1.5, standings: [VALID_STANDING] };
    case 'has a negative turn count':
      return { winner: 'A', turns: -1, standings: [VALID_STANDING] };
    case 'has no standings array':
      return { winner: 'A', turns: 1, standings: 'none' };
    case 'has a standing with no player':
      return {
        winner: 'A',
        turns: 1,
        standings: [{ seat: 0, territory: 1, shares: 0, heads: 1, lost: false }],
      };
    case 'has a standing whose lost is not a boolean':
      return {
        winner: 'A',
        turns: 1,
        standings: [{ player: 'A', seat: 0, territory: 1, shares: 0, heads: 1, lost: 'yes' }],
      };
    case 'has a standing with a negative head count':
      return {
        winner: 'A',
        turns: 1,
        standings: [{ player: 'A', seat: 0, territory: 1, shares: 0, heads: -1, lost: false }],
      };
    default: {
      const unreachable: never = fault;
      throw new Error(`unknown fault: ${String(unreachable)}`);
    }
  }
};

const ownerNameOf = (token: '(none)' | '(blank)' | 'Ada'): string | undefined => {
  if (token === '(none)') return undefined;
  if (token === '(blank)') return BLANK_OWNER;
  return token;
};

const HOT_SEAT: readonly LocalLogSeat[] = [
  { player: 'A', kind: 'human' },
  { player: 'B', kind: 'human' },
  { player: 'C', kind: 'heuristic' },
];

const VERSUS_BOT: readonly LocalLogSeat[] = [
  { player: 'A', kind: 'human' },
  { player: 'B', kind: 'heuristic' },
  { player: 'C', kind: 'heuristic' },
];

describe('Lost-seat and standings boundaries', () => {
  describe('newlyLost is a total diff (D2)', () => {
    it.each(DIFF_ROWS)(
      'The diff toasts only letters that just appeared (prev $prev, next $next)',
      ({ prev, next, result }) => {
        const nextLost = parseLostToken(next);
        expect(nextLost, 'next is a list, never absent').toBeDefined();
        if (nextLost === undefined) return;

        expect(newlyLost(parseLostToken(prev), nextLost)).toEqual(parseLostToken(result));
      },
    );
  });

  describe('The match identity is the game route only while online (D3)', () => {
    it.each(IDENTITY_ROWS)(
      'Identity is the game id only for an online game route (online $online, hash $hash)',
      ({ online, hash, startedAt, identity }) => {
        expect(matchIdentity(online, hash, startedAt)).toBe(identity);
      },
    );
  });

  describe('A new match identity is a first snapshot (D3)', () => {
    it('A version jump in the same match toasts only the new letter', () => {
      const observed = observeLosses(
        { identity: 'g/000001', prevLost: ['C'] },
        'g/000001',
        ['C', 'A'],
      );

      expect(observed.newly).toEqual(['A']);
      expect(observed.memory).toEqual({ identity: 'g/000001', prevLost: ['C', 'A'] });
    });

    it('Opening another game does not toast seats that are already lost', () => {
      const observed = observeLosses(
        { identity: 'g/000001', prevLost: ['C'] },
        'g/000002',
        ['C'],
      );

      expect(observed.newly).toEqual([]);
      expect(observed.memory).toEqual({ identity: 'g/000002', prevLost: ['C'] });
    });

    it('A new identity does not toast when the previous lost set was empty', () => {
      // D3: memory.identity !== identity is a first snapshot, even if nextLost is non-empty.
      const observed = observeLosses({ identity: 'g/000001', prevLost: [] }, 'g/000002', ['C']);

      expect(observed.newly).toEqual([]);
      expect(observed.memory).toEqual({ identity: 'g/000002', prevLost: ['C'] });
    });

    it('The first observation of a mount records the lost set and emits nothing', () => {
      const identity = 'local:2026-11-25T00:00:00.000Z';
      const observed = observeLosses(undefined, identity, ['B']);

      expect(observed.newly).toEqual([]);
      expect(observed.memory).toEqual({ identity, prevLost: ['B'] });
    });
  });

  describe('The lost set is the predicate, in players order (D1)', () => {
    it('Only the letters the predicate loses are returned, in players order', () => {
      const lost = lostSeatIds(['C', 'A', 'B'], (letter) => letter === 'A' || letter === 'B');

      expect(lost).toEqual(['A', 'B']);
    });

    it('A predicate that loses nobody returns an empty set', () => {
      expect(lostSeatIds(['A', 'B'], () => false)).toEqual([]);
    });
  });

  describe('Seat labels are the P101 words (D5)', () => {
    it.each(LABEL_ROWS)(
      'The first matching label row wins ($letter $kind $relation owner $owner sayYou $sayYou)',
      ({ letter, kind, relation, owner, sayYou, label }) => {
        const ownerName = ownerNameOf(owner);
        const input: SeatLabelInput = {
          letter,
          kind,
          relation,
          sayYou,
          ...(ownerName === undefined ? {} : { ownerName }),
        };

        expect(seatLabel(input)).toBe(label);
      },
    );

    it('Online, only a proved human caller is you', () => {
      const seats = [
        { kind: 'human' as const, userHash: 'alice' },
        { kind: 'human' as const, userHash: 'bob' },
        { kind: 'agent' as const, userHash: 'alice', label: 'Agent (Ada)' },
      ];
      const players = ['A', 'B', 'C'];
      const label = (letter: string): string =>
        labelForOnlineSeat({ seats, userHash: 'alice', players, letter });

      expect(label('A')).toBe('you');
      expect(label('B')).toBe('B');
      expect(label('C')).toBe('your agent');
    });

    it('A missing hash or a missing chair is never you', () => {
      expect(labelForOnlineSeat({ players: ['A'], letter: 'A' })).toBe('A');
    });

    it('A human with an owner name and relation other is the letter, not the name', () => {
      expect(
        seatLabel({
          letter: 'B',
          kind: 'human',
          relation: 'other',
          ownerName: 'Ada',
          sayYou: true,
        }),
      ).toBe('B');
    });

    it('Omitting the caller hash does not mark you, and passing it does', () => {
      const seats = [{ kind: 'human' as const, userHash: 'alice' }];

      expect(labelForOnlineSeat({ seats, players: ['A'], letter: 'A' })).toBe('A');
      expect(labelForOnlineSeat({ seats, userHash: 'alice', players: ['A'], letter: 'A' })).toBe('you');
    });

    it('Omitting seats does not throw and does not mark you', () => {
      expect(labelForOnlineSeat({ userHash: 'alice', players: ['A'], letter: 'A' })).toBe('A');
    });

    it('An agent chair labeled Agent (Ada) is Ada', () => {
      expect(
        labelForChair({
          letter: 'C',
          chair: { kind: 'agent', userHash: 'bob', label: 'Agent (Ada)' },
          userHash: 'alice',
        }),
      ).toBe('Ada');
    });

    it('A proved human chair is you only when the hash is passed', () => {
      const chair = { kind: 'human' as const, userHash: 'alice' };

      expect(labelForChair({ letter: 'A', chair })).toBe('A');
      expect(labelForChair({ letter: 'A', chair, userHash: 'alice' })).toBe('you');
    });

    it('Without a chair, a heuristic hint is AI and a human hint is the letter, not you', () => {
      expect(labelForChair({ letter: 'B', kindHint: 'heuristic' })).toBe('AI');
      expect(labelForChair({ letter: 'A', kindHint: 'human' })).toBe('A');
      expect(labelForChair({ letter: 'C', kindHint: 'agent' })).toBe('C');
    });

    it('Without a chair, a byok hint is the letter', () => {
      expect(labelForChair({ letter: 'B', kindHint: 'byok' })).toBe('B');
    });

    it('Without a chair and without a kind hint, the label is the letter', () => {
      expect(labelForChair({ letter: 'C' })).toBe('C');
    });

    it('A local hot-seat labels humans by letter', () => {
      const label = (letter: string): string =>
        labelForLocalSeat({ configKind: undefined, logSeats: HOT_SEAT, letter });

      expect(label('A')).toBe('A');
      expect(label('B')).toBe('B');
      expect(label('C')).toBe('AI');
    });

    it('The one human in a local versus-bot match is you', () => {
      const label = (letter: string): string =>
        labelForLocalSeat({ configKind: undefined, logSeats: VERSUS_BOT, letter });

      expect(label('A')).toBe('you');
      expect(label('B')).toBe('AI');
      expect(label('C')).toBe('AI');
    });

    it('your agent does not take the you sentence', () => {
      expect(eliminationSentence('your agent')).toBe('your agent was eliminated');
    });

    it('The toast duration is the named constant', () => {
      expect(ELIMINATION_TOAST_MS).toBe(4000);
    });
  });

  describe('The seat line does not invent rows or names (D6)', () => {
    it('A lost letter that is not on the roster adds no item', () => {
      const items = seatLineView([{ letter: 'A', kindLabel: 'Player' }], ['C']);

      expect(items.map((item) => item.letter)).toEqual(['A']);
      const only = items[0];
      expect(only).toBeDefined();
      if (only === undefined) return;
      expectNotLost(only);
    });

    it('Every listed copy of a lost letter is marked', () => {
      const items = seatLineView(
        [
          { letter: 'A', kindLabel: 'Player' },
          { letter: 'A', kindLabel: 'AI' },
        ],
        ['A'],
      );

      expect(items).toHaveLength(2);
      for (const item of items) expectMarkedLost(item);
      expect(items.map((item) => item.text)).toEqual(['A=Player', 'A=AI']);
    });
  });

  describe('Standings sort, marks, and fallback (D7)', () => {
    it('The winner is not the caller, and still comes first', () => {
      const seats: readonly InviteSeat[] = [
        { kind: 'human', userHash: 'alice' },
        { kind: 'human', userHash: 'bob' },
        { kind: 'heuristic' },
      ];
      const view = standingsForHud(
        true,
        summaryOf('B', 3, [
          standing({ player: 'A', seat: 0, lost: true, territory: 1, shares: 0, heads: 0 }),
          standing({ player: 'B', seat: 1, lost: false, territory: 9, shares: 2, heads: 5 }),
          standing({ player: 'C', seat: 2, lost: true, territory: 0, shares: 0, heads: 2 }),
        ]),
        seats,
        'alice',
      );

      const table = asTable(view);
      expect(table.rows.map((row) => row.letter)).toEqual(['B', 'A', 'C']);
      expect(table.wonOnTurn).toBe('Won on turn 3');

      const rowA = rowOf(table.rows, 'A');
      expect(rowA.you).toBe(true);
      expect(rowA.label).toBe('you');
      expect(rowA.marker).toBe('lost');

      const rowB = rowOf(table.rows, 'B');
      expect(rowB.you).toBe(false);
      expect(rowB.label).not.toBe('you');
      expect(rowB.winner).toBe(true);
      expect(rowB.marker).toBe('winner');
      expect(rowB.territory).toBe(9);
      expect(rowB.shares).toBe(2);
      expect(rowB.heads).toBe(5);
    });

    it('A winner string that matches no row keeps server order', () => {
      const view = standingsForHud(
        true,
        summaryOf('Z', 1, [
          standing({ player: 'A', seat: 0, lost: false, territory: 1, shares: 0, heads: 1 }),
          standing({ player: 'B', seat: 1, lost: true, territory: 0, shares: 0, heads: 0 }),
        ]),
        undefined,
        undefined,
      );

      const table = asTable(view);
      expect(table.rows.map((row) => row.letter)).toEqual(['A', 'B']);
      expect(table.wonOnTurn).toBe('Won on turn 1');
      for (const row of table.rows) {
        expect(row.you).toBe(false);
        expect(row.label).not.toBe('you');
        expect(row.winner).toBe(false);
      }
      // Neither winner nor lost: the marker is empty, not a synthesised winner.
      expect(rowOf(table.rows, 'A').lost).toBe(false);
      expect(rowOf(table.rows, 'A').marker).toBe('');
    });

    it('A row that is both winner and lost carries both marks', () => {
      const view = standingsForHud(
        true,
        summaryOf('A', 2, [
          standing({ player: 'A', seat: 0, lost: true, territory: 0, shares: 0, heads: 0 }),
        ]),
        undefined,
        undefined,
      );

      const table = asTable(view);
      const rowA = rowOf(table.rows, 'A');
      expect(rowA.winner).toBe(true);
      expect(rowA.lost).toBe(true);
      expect(rowA.marker).toBe('winner, lost');
      expect(rowA.you).toBe(false);
      expect(rowA.label).not.toBe('you');
    });

    it('An empty standings list is still a table', () => {
      const view = standingsForHud(true, summaryOf('A', 0, []), undefined, undefined);

      const table = asTable(view);
      expect(table.wonOnTurn).toBe('Won on turn 0');
      expect(table.rows).toEqual([]);
    });

    it('Without a chair, an absent kind is the letter and a heuristic is AI', () => {
      const view = standingsForHud(
        true,
        summaryOf('A', 1, [
          standing({ player: 'A', seat: 0, lost: false, territory: 1, shares: 0, heads: 1 }),
          standing({
            player: 'B',
            seat: 1,
            lost: false,
            territory: 0,
            shares: 0,
            heads: 1,
            kind: 'heuristic',
          }),
        ]),
        undefined,
        undefined,
      );

      const table = asTable(view);
      const rowA = rowOf(table.rows, 'A');
      expect(rowA.label).toBe('A');
      expect(rowA.you).toBe(false);
      const rowB = rowOf(table.rows, 'B');
      expect(rowB.label).toBe('AI');
      expect(rowB.you).toBe(false);
    });

    it('Omitting the caller hash does not mark a proved chair you; passing it does', () => {
      const seats: readonly InviteSeat[] = [{ kind: 'human', userHash: 'alice' }];
      const summary = summaryOf('A', 1, [
        standing({ player: 'A', seat: 0, lost: false, territory: 1, shares: 0, heads: 1 }),
      ]);

      const omitted = asTable(standingsForHud(true, summary, seats, undefined));
      expect(rowOf(omitted.rows, 'A').you).toBe(false);
      expect(rowOf(omitted.rows, 'A').label).not.toBe('you');

      const passed = asTable(standingsForHud(true, summary, seats, 'alice'));
      expect(rowOf(passed.rows, 'A').you).toBe(true);
      expect(rowOf(passed.rows, 'A').label).toBe('you');
    });

    it('Omitting seats does not throw and does not mark you', () => {
      const view = standingsForHud(
        true,
        summaryOf('A', 1, [
          standing({ player: 'A', seat: 0, lost: false, territory: 1, shares: 0, heads: 1 }),
        ]),
        undefined,
        'alice',
      );

      const rowA = rowOf(asTable(view).rows, 'A');
      expect(rowA.you).toBe(false);
      expect(rowA.label).toBe('A');
    });

    it('Without a chair, a heuristic standing is AI and a human is the letter', () => {
      const view = standingsForHud(
        true,
        summaryOf('A', 4, [
          standing({
            player: 'A',
            seat: 0,
            lost: false,
            territory: 1,
            shares: 0,
            heads: 1,
            kind: 'human',
          }),
          standing({
            player: 'B',
            seat: 1,
            lost: true,
            territory: 0,
            shares: 0,
            heads: 0,
            kind: 'heuristic',
          }),
        ]),
        undefined,
        'alice',
      );

      const table = asTable(view);
      const rowA = rowOf(table.rows, 'A');
      expect(rowA.label).toBe('A');
      expect(rowA.you).toBe(false);
      const rowB = rowOf(table.rows, 'B');
      expect(rowB.label).toBe('AI');
      expect(rowB.marker).toBe('lost');
    });

    it('The caller\'s agent is your agent, not the owner name', () => {
      // Seat 1 is unread. C's chair is seats[2], not the row index.
      const seats: readonly InviteSeat[] = [
        { kind: 'human', userHash: 'bob' },
        { kind: 'heuristic' },
        { kind: 'agent', userHash: 'alice', label: 'Agent (Ada)' },
      ];
      const view = standingsForHud(
        true,
        summaryOf('A', 8, [
          standing({ player: 'A', seat: 0, lost: false, territory: 2, shares: 1, heads: 1 }),
          standing({ player: 'C', seat: 2, lost: true, territory: 0, shares: 0, heads: 0 }),
        ]),
        seats,
        'alice',
      );

      const table = asTable(view);
      const rowA = rowOf(table.rows, 'A');
      expect(rowA.label).toBe('A');
      expect(rowA.you).toBe(false);
      expect(rowOf(table.rows, 'C').label).toBe('your agent');
    });

    it('Another agent\'s owner name is the label', () => {
      // Seat 0 and 1 are unread. C's chair is seats[2].
      const seats: readonly InviteSeat[] = [
        { kind: 'heuristic' },
        { kind: 'heuristic' },
        { kind: 'agent', userHash: 'bob', label: 'Agent (Ada)' },
      ];
      const view = standingsForHud(
        true,
        summaryOf('A', 8, [
          standing({ player: 'A', seat: 0, lost: false, territory: 2, shares: 1, heads: 1 }),
          standing({ player: 'C', seat: 2, lost: true, territory: 0, shares: 0, heads: 0 }),
        ]),
        seats,
        'alice',
      );

      const table = asTable(view);
      expect(rowOf(table.rows, 'C').label).toBe('Ada');
    });
  });

  describe('A bad summary does not drop the board (D8)', () => {
    it('A valid summary is kept on the board', () => {
      const rawStanding = {
        player: 'A',
        seat: 0,
        territory: 4,
        shares: 1,
        heads: 2,
        lost: false,
      };
      const rawSummary = { winner: 'A', turns: 6, standings: [rawStanding] };
      const body = { version: 3, state: { tag: 'ok' }, summary: rawSummary };

      const parsed = parseGameSummary(body.summary);
      expect(parsed?.winner).toBe('A');
      expect(parsed?.turns).toBe(6);
      const kept = parsed?.standings[0];
      expect(kept?.player).toBe('A');
      expect(kept?.territory).toBe(4);
      expect(kept?.shares).toBe(1);
      expect(kept?.heads).toBe(2);
      expect(kept?.lost).toBe(false);

      const board = parseBoard(body);
      expect(board?.version).toBe(3);
      expect(board?.summary?.winner).toBe('A');
      expect(board?.summary?.turns).toBe(6);
      const onBoard = board?.summary?.standings[0];
      expect(onBoard?.player).toBe('A');
      expect(onBoard?.territory).toBe(4);
      expect(onBoard?.shares).toBe(1);
      expect(onBoard?.heads).toBe(2);
      expect(onBoard?.lost).toBe(false);
    });

    it('An absent summary leaves the board without the key', () => {
      const board = parseBoard({ version: 3, state: { tag: 'ok' } });

      expect(board).toBeDefined();
      if (board === undefined) return;
      expect(board.version).toBe(3);
      expect(Object.hasOwn(board, 'summary')).toBe(false);
    });

    it.each(FAULTS.map((fault) => ({ fault })))(
      'An invalid summary is dropped and the board remains ($fault)',
      ({ fault }) => {
        const summary = summaryForFault(fault);
        const body = { version: 3, state: { tag: 'ok' }, summary };
        const board = parseBoard(body);

        expect(board).toBeDefined();
        if (board === undefined) return;
        expect(board.version).toBe(3);
        expect(Object.hasOwn(board, 'summary')).toBe(false);
        expect(parseGameSummary(summary)).toBeUndefined();
      },
    );

    it('An unknown kind is dropped and the standing is kept', () => {
      const rawSummary = {
        winner: 'A',
        turns: 1,
        standings: [
          {
            player: 'A',
            seat: 0,
            territory: 1,
            shares: 0,
            heads: 1,
            lost: false,
            kind: 'byok',
          },
        ],
      };
      const body = { version: 1, state: { tag: 'ok' }, summary: rawSummary };

      const parsed = parseGameSummary(body.summary);
      expect(parsed?.standings[0]?.player).toBe('A');
      expect(parsed?.standings[0]?.kind).toBeUndefined();
      expect(parsed?.standings[0]?.territory).toBe(1);
      expect(parsed?.standings[0]?.shares).toBe(0);
      expect(parsed?.standings[0]?.heads).toBe(1);
      expect(parsed?.standings[0]?.lost).toBe(false);

      const board = parseBoard(body);
      expect(board?.version).toBe(1);
      expect(board?.summary).toBeDefined();
      expect(board?.summary?.standings[0]?.player).toBe('A');
      expect(board?.summary?.standings[0]?.kind).toBeUndefined();
    });

    it('A negative turn count drops the summary', () => {
      expect(parseGameSummary({ winner: 'A', turns: -1, standings: [VALID_STANDING] })).toBeUndefined();
    });

    it('A negative seat drops the summary', () => {
      expect(
        parseGameSummary({
          winner: 'A',
          turns: 1,
          standings: [{ ...VALID_STANDING, seat: -1 }],
        }),
      ).toBeUndefined();
    });

    it('A negative territory drops the summary', () => {
      expect(
        parseGameSummary({
          winner: 'A',
          turns: 1,
          standings: [{ ...VALID_STANDING, territory: -1 }],
        }),
      ).toBeUndefined();
    });

    it('A negative share count drops the summary', () => {
      expect(
        parseGameSummary({
          winner: 'A',
          turns: 1,
          standings: [{ ...VALID_STANDING, shares: -1 }],
        }),
      ).toBeUndefined();
    });

    it('A negative head count drops the summary', () => {
      expect(
        parseGameSummary({
          winner: 'A',
          turns: 1,
          standings: [{ ...VALID_STANDING, heads: -1 }],
        }),
      ).toBeUndefined();
    });

    it('A non-object standing drops the summary', () => {
      expect(parseGameSummary({ winner: 'A', turns: 1, standings: [null] })).toBeUndefined();
    });

    it('Standings that are not an array drop the summary', () => {
      expect(parseGameSummary({ winner: 'A', turns: 1, standings: { not: 'an array' } })).toBeUndefined();
    });

    it('Kind human is kept', () => {
      expect(parseGameSummary(summaryWithKind('human'))?.standings[0]?.kind).toBe('human');
    });

    it('Kind agent is kept', () => {
      expect(parseGameSummary(summaryWithKind('agent'))?.standings[0]?.kind).toBe('agent');
    });

    it('Kind heuristic is kept', () => {
      expect(parseGameSummary(summaryWithKind('heuristic'))?.standings[0]?.kind).toBe('heuristic');
    });

    it('Kind byok is absent and the standing is kept', () => {
      const parsed = parseGameSummary(summaryWithKind('byok'));

      expect(parsed?.standings[0]?.player).toBe('A');
      expect(parsed?.standings[0]?.territory).toBe(1);
      expect(parsed?.standings[0]?.kind).toBeUndefined();
    });

    it('Extra keys do not reject the summary', () => {
      const rawSummary = {
        winner: 'A',
        turns: 1,
        standings: [VALID_STANDING],
        note: 'ignored',
      };
      const body = { version: 1, state: { tag: 'ok' }, summary: rawSummary };

      expect(parseGameSummary(body.summary)?.winner).toBe('A');
      expect(parseBoard(body)?.summary?.winner).toBe('A');
    });
  });
});
