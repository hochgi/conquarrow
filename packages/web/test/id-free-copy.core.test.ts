/**
 * docs/spec/id-free-copy/id-free-copy.core.feature
 *
 * One it() per Gherkin scenario. Pure helpers — no DOM, no test-kit.
 */

import { describe, expect, it } from 'vitest';
import { refusalText } from '../src/fx/present';
import { leftoverNote } from '../src/route';
import { mergeOptions, selectionLine } from '../src/selection/status';
import { cameraLocked, showingMoves } from '../src/spectate';
import { appSource, codeOf, dockSource } from './board-selection-model.support';
import { centres, headsTable, id, ids } from './id-free-copy.support';

describe('Player-facing copy never shows an arrow id', () => {
  describe('The strip names the selected stack by size', () => {
    it('The selection line counts heads, not the arrow', () => {
      const [m1, m2, m3] = ids('m1', 'm2', 'm3');
      if (m1 === undefined || m2 === undefined || m3 === undefined) throw new Error('setup');
      expect(selectionLine({ selected: m2, heads: 2, movable: [m3, m1, m2] })).toBe(
        'Selected: 2 heads · 2 of 3',
      );
    });

    it('The count note says where the rest stay without an id', () => {
      expect(leftoverNote({ count: 1, ceiling: 3 })).toBe('2 heads stay where the last run began');
    });

    it('A refusal with a selection names the selected stack', () => {
      expect(refusalText('out-of-reach', id('s0'))).toBe('Too far for the selected stack');
    });
  });

  describe('A merge button says which of your stacks and which way', () => {
    it('A merge target up and to the left', () => {
      const [sel, tgt] = ids('sel', 'tgt');
      if (sel === undefined || tgt === undefined) throw new Error('setup');
      const options = mergeOptions({
        merges: new Set([tgt]),
        locked: false,
        selected: sel,
        groups: headsTable({ tgt: 3 }),
        centreOf: centres({ sel: { x: 0, y: 0 }, tgt: { x: -2, y: -2 } }),
      });
      expect(options).toEqual([{ arrow: tgt, label: 'Merge into your 3-stack, up-left' }]);
    });
  });

  describe('The camera is locked only while moves are shown', () => {
    it('A seat thinking between two replayed batches leaves the camera free', () => {
      const showing = showingMoves({ replaying: false, pendingReplays: 0, localPlayback: false });
      expect(showing).toBe(false);
      expect(
        cameraLocked({ spectating: true, autoFocus: true, inReplayWindow: showing, paused: false }),
      ).toBe(false);
    });

    it('A replayed batch locks the camera', () => {
      const showing = showingMoves({ replaying: true, pendingReplays: 0, localPlayback: false });
      expect(showing).toBe(true);
      expect(
        cameraLocked({ spectating: true, autoFocus: true, inReplayWindow: showing, paused: false }),
      ).toBe(true);
    });
  });
});

describe('App wires the pure decisions (source scan — no DOM harness)', () => {
  it('The camera lock reads showingMoves, not the camera-save window', () => {
    const app = codeOf(appSource());
    expect(app).toMatch(/inReplayWindow:\s*showingMoves\(/);
    expect(app).not.toMatch(/inReplayWindow:\s*replayOpen/);
  });

  it('The dock paints the option labels and the merges come from mergeOptions', () => {
    expect(codeOf(dockSource())).toMatch(/\{option\.label\}/);
    expect(codeOf(appSource())).toMatch(/merges=\{mergeOptions\(/);
  });
});
