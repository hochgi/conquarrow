/**
 * docs/spec/id-free-copy/id-free-copy.edge-cases.feature
 */

import { describe, expect, it } from 'vitest';
import { REFUSAL_TEXT, refusalText } from '../src/fx/present';
import { leftoverNote } from '../src/route';
import { mergeOptions, selectionLine } from '../src/selection/status';
import { showingMoves } from '../src/spectate';
import { compassWord, headsPhrase, mergeLabel, nStack } from '../src/stackCopy';
import { centres, headsTable, id, ids } from './id-free-copy.support';

describe('Edge cases of id-free copy and the camera lock', () => {
  describe('Singular and plural', () => {
    it('One head is singular in the selection line', () => {
      const [z0, m1, m2] = ids('z0', 'm1', 'm2');
      if (z0 === undefined || m1 === undefined || m2 === undefined) throw new Error('setup');
      expect(selectionLine({ selected: z0, heads: 1, movable: [m1, m2] })).toBe(
        'Selected: 1 head · no move left · 2 can move',
      );
    });

    it('One head stays is singular', () => {
      expect(leftoverNote({ count: 2, ceiling: 3 })).toBe('1 head stays where the last run began');
    });

    it('Nothing stays', () => {
      expect(leftoverNote({ count: 3, ceiling: 3 })).toBe('No head stays behind');
      expect(leftoverNote({ count: 4, ceiling: 3 })).toBe('No head stays behind');
    });

    it('heads phrase and n-stack', () => {
      expect(headsPhrase(1)).toBe('1 head');
      expect(headsPhrase(0)).toBe('0 heads');
      expect(headsPhrase(5)).toBe('5 heads');
      expect(nStack(3)).toBe('3-stack');
    });
  });

  describe('Refusals without a selection are unchanged', () => {
    it.each(['out-of-reach', 'no-exit', 'not-yours'] as const)(
      'The selection-free sentence is the table’s (%s)',
      (reason) => {
        expect(refusalText(reason)).toBe(REFUSAL_TEXT[reason]);
      },
    );

    it('No exit with a selection', () => {
      expect(refusalText('no-exit', id('s0'))).toBe('The selected stack has no move left this turn');
    });

    it('Other reasons with a selection keep the table text', () => {
      expect(refusalText('not-yours', id('s0'))).toBe(REFUSAL_TEXT['not-yours']);
    });
  });

  describe('Merge options keep order and drop the direction when it means nothing', () => {
    it('Locked input offers no merge', () => {
      const [a] = ids('a');
      if (a === undefined) throw new Error('setup');
      expect(
        mergeOptions({
          merges: new Set([a]),
          locked: true,
          selected: undefined,
          headsOf: headsTable({ a: 2 }),
          centreOf: centres({}),
        }),
      ).toEqual([]);
    });

    it('No merge set offers no merge', () => {
      expect(
        mergeOptions({
          merges: undefined,
          locked: false,
          selected: undefined,
          headsOf: headsTable({}),
          centreOf: centres({}),
        }),
      ).toEqual([]);
    });

    it('No selection gives no direction', () => {
      const [a] = ids('a');
      if (a === undefined) throw new Error('setup');
      expect(
        mergeOptions({
          merges: new Set([a]),
          locked: false,
          selected: undefined,
          headsOf: headsTable({ a: 1 }),
          centreOf: centres({ a: { x: 5, y: 5 } }),
        }),
      ).toEqual([{ arrow: a, label: 'Merge into your 1-stack' }]);
    });

    it('Coinciding centres give no direction', () => {
      const [s, a] = ids('s', 'a');
      if (s === undefined || a === undefined) throw new Error('setup');
      expect(
        mergeOptions({
          merges: new Set([a]),
          locked: false,
          selected: s,
          headsOf: headsTable({ a: 2 }),
          centreOf: centres({ s: { x: 1, y: 1 }, a: { x: 1, y: 1 } }),
        }),
      ).toEqual([{ arrow: a, label: 'Merge into your 2-stack' }]);
    });

    it('Several targets come in compareArrows order', () => {
      const [s, m1, m2, m3] = ids('s', 'm1', 'm2', 'm3');
      if (s === undefined || m1 === undefined || m2 === undefined || m3 === undefined) {
        throw new Error('setup');
      }
      const options = mergeOptions({
        merges: new Set([m3, m1, m2]),
        locked: false,
        selected: s,
        headsOf: headsTable({ m1: 1, m2: 2, m3: 3 }),
        centreOf: centres({ m1: { x: 1, y: 0 }, m2: { x: 0, y: 1 }, m3: { x: -1, y: 0 } }),
      });
      expect(options.map((o) => o.label)).toEqual([
        'Merge into your 1-stack, right',
        'Merge into your 2-stack, down',
        'Merge into your 3-stack, left',
      ]);
      expect(options.map((o) => o.arrow)).toEqual([m1, m2, m3]);
    });

    it('A missing group reads as a 0-stack rather than throwing', () => {
      const [a] = ids('a');
      if (a === undefined) throw new Error('setup');
      expect(mergeLabel(0, undefined)).toBe('Merge into your 0-stack');
      expect(mergeLabel(4, 'up')).toBe('Merge into your 4-stack, up');
    });
  });

  describe('Compass words', () => {
    it.each([
      [1, 0, 'right'],
      [1, 1, 'down-right'],
      [0, 1, 'down'],
      [-1, 1, 'down-left'],
      [-1, 0, 'left'],
      [-1, -1, 'up-left'],
      [0, -1, 'up'],
      [1, -1, 'up-right'],
    ] as const)('Eight directions, y grows downward (%d, %d) is %s', (x, y, word) => {
      expect(compassWord({ x: 0, y: 0 }, { x, y })).toBe(word);
    });

    it('A shallow angle rounds to the nearer axis', () => {
      expect(compassWord({ x: 0, y: 0 }, { x: 10, y: 1 })).toBe('right');
      expect(compassWord({ x: 0, y: 0 }, { x: 10, y: -1 })).toBe('right');
      expect(compassWord({ x: 0, y: 0 }, { x: -10, y: 1 })).toBe('left');
      expect(compassWord({ x: 0, y: 0 }, { x: -10, y: -1 })).toBe('left');
      expect(compassWord({ x: 0, y: 0 }, { x: 1, y: 10 })).toBe('down');
      expect(compassWord({ x: 0, y: 0 }, { x: 1, y: -10 })).toBe('up');
    });

    it('Direction is from the first point to the second, not the origin', () => {
      expect(compassWord({ x: 5, y: 5 }, { x: 6, y: 5 })).toBe('right');
      expect(compassWord({ x: 5, y: 5 }, { x: 5, y: 4 })).toBe('up');
      expect(compassWord({ x: 5, y: 5 }, { x: 4, y: 5 })).toBe('left');
    });

    it('Equal points have no direction; a difference on one axis is enough', () => {
      expect(compassWord({ x: 2, y: 3 }, { x: 2, y: 3 })).toBeUndefined();
      expect(compassWord({ x: 2, y: 3 }, { x: 2, y: 4 })).toBe('down');
      expect(compassWord({ x: 2, y: 3 }, { x: 3, y: 3 })).toBe('right');
    });
  });

  describe('Showing moves', () => {
    it('A queued batch counts as shown', () => {
      expect(showingMoves({ replaying: false, pendingReplays: 1, localPlayback: false })).toBe(true);
    });

    it('A local seat applying its plan counts as shown', () => {
      expect(showingMoves({ replaying: false, pendingReplays: 0, localPlayback: true })).toBe(true);
    });

    it('A local seat that is planning does not', () => {
      expect(showingMoves({ replaying: false, pendingReplays: 0, localPlayback: false })).toBe(false);
    });
  });
});
