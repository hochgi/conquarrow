/**
 * docs/spec/lost-seat-standings/lost-seat-standings.core.feature
 *
 * One it() per Gherkin scenario. Pure helpers — no DOM, no test-kit.
 */

import type { InviteSeat } from '@conquarrow/contracts';
import { describe, expect, it } from 'vitest';
import { eliminationSentence, eliminationToasts, newlyLost } from '../src/lostSeat';
import { seatLineView } from '../src/seatLine';
import { showMatchSummaryLine, standingsForHud } from '../src/standings';
import {
  asTable,
  expectFallback,
  expectMarkedLost,
  expectNotLost,
  rowOf,
  standing,
  summaryOf,
} from './lost-seat-standings.support';

const ALICE_BOB_HEURISTIC: readonly InviteSeat[] = [
  { kind: 'human', userHash: 'alice' },
  { kind: 'human', userHash: 'bob' },
  { kind: 'heuristic' },
];

describe('A lost seat is visible, and a finished online game shows standings', () => {
  describe('The seat line marks a lost seat and keeps it (D6)', () => {
    it('A lost seat is struck, greyed, and named eliminated, and keeps its kind text', () => {
      const items = seatLineView(
        [
          { letter: 'A', kindLabel: 'Player' },
          { letter: 'B', kindLabel: 'AI' },
          { letter: 'C', kindLabel: 'Agent' },
        ],
        ['C'],
      );

      expect(items.map((item) => item.letter)).toEqual(['A', 'B', 'C']);
      const lost = items[2];
      const aliveA = items[0];
      const aliveB = items[1];
      expect(lost).toBeDefined();
      expect(aliveA).toBeDefined();
      expect(aliveB).toBeDefined();
      if (lost === undefined || aliveA === undefined || aliveB === undefined) return;

      expectMarkedLost(lost);
      expect(lost.text).toBe('C=Agent');
      expectNotLost(aliveA);
      expectNotLost(aliveB);
    });
  });

  describe('A toast fires once, from the diff, and the first snapshot is silent (D2, D3, D4)', () => {
    it('The first snapshot toasts for nobody', () => {
      expect(newlyLost(undefined, ['A', 'C'])).toEqual([]);
    });

    it('Several seats lost in one snapshot toast once each, in order', () => {
      const toasts = eliminationToasts(newlyLost([], ['B', 'C']), (letter) => letter);

      expect(toasts.map((toast) => toast.text)).toEqual(['B was eliminated', 'C was eliminated']);
      expect(toasts.map((toast) => toast.id)).toEqual(['B', 'C']);
    });

    it('A later snapshot does not repeat a toast', () => {
      expect(newlyLost(['B', 'C'], ['B', 'C'])).toEqual([]);
    });

    it('The caller\'s own loss says You were eliminated', () => {
      expect(eliminationSentence('you')).toBe('You were eliminated');
    });
  });

  describe('Online standings come from the summary, or not at all (D7)', () => {
    it('The winner is first, the caller is you, a lost seat is marked, and the turn is named', () => {
      const view = standingsForHud(
        true,
        summaryOf('A', 14, [
          standing({ player: 'A', seat: 0, lost: false, territory: 12, shares: 3, heads: 4 }),
          standing({ player: 'B', seat: 1, lost: true, territory: 0, shares: 0, heads: 0 }),
          standing({ player: 'C', seat: 2, lost: true, territory: 0, shares: 0, heads: 0 }),
        ]),
        ALICE_BOB_HEURISTIC,
        'alice',
      );

      const table = asTable(view);
      expect(table.wonOnTurn).toBe('Won on turn 14');
      expect(table.rows.map((row) => row.letter)).toEqual(['A', 'B', 'C']);

      const rowA = rowOf(table.rows, 'A');
      expect(rowA.you).toBe(true);
      expect(rowA.label).toBe('you');
      expect(rowA.winner).toBe(true);
      expect(rowA.marker).toBe('winner');
      expect(rowA.territory).toBe(12);
      expect(rowA.shares).toBe(3);
      expect(rowA.heads).toBe(4);

      const rowB = rowOf(table.rows, 'B');
      expect(rowB.you).toBe(false);
      expect(rowB.label).not.toBe('you');
      expect(rowB.lost).toBe(true);
      expect(rowB.marker).toBe('lost');

      const rowC = rowOf(table.rows, 'C');
      expect(rowC.label).toBe('AI');
      expect(rowC.lost).toBe(true);
      expect(rowC.marker).toBe('lost');

      expect(showMatchSummaryLine(view)).toBe(false);
    });

    it('A missing summary keeps the winner line and the local summary line', () => {
      const view = standingsForHud(true, undefined, undefined, undefined);

      expectFallback(view);
      expect(showMatchSummaryLine(view)).toBe(true);
    });

    it('A summary does not draw a table before game-over is showing', () => {
      const view = standingsForHud(
        false,
        summaryOf('A', 14, [
          standing({ player: 'A', seat: 0, lost: false, territory: 12, shares: 3, heads: 4 }),
        ]),
        ALICE_BOB_HEURISTIC,
        'alice',
      );

      expectFallback(view);
      expect(showMatchSummaryLine(view)).toBe(true);
    });
  });
});
