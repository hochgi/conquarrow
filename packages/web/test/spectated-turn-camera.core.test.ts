/**
 * docs/spec/spectated-turn-camera/spectated-turn-camera.core.feature
 * One it() per Gherkin scenario, against the pure `spectate.ts` port surface.
 * The rAF tween runner in App is deliberately untested (see the overview).
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import type { SeatKind } from '../src/seatPlan';
import {
  BASE_TIMING,
  arrowsOfMove,
  boundsOf,
  cameraLocked,
  fitViewport,
  focusArrow,
  hopTargets,
  hopTiming,
  isSpectatedSeat,
  restoreTarget,
} from '../src/spectate';
import { ZOOM } from '../src/viewport';
import { arrow, camera, ownedSet, pt, showsPoint, vp } from './spectated-turn-camera.support';

const local = (seatKind: SeatKind): boolean =>
  isSpectatedSeat({ seatKind, online: false, tutorial: false });

const fitOf = (points: readonly { x: number; y: number }[]): ReturnType<typeof fitViewport> => {
  const bounds = boundsOf(points);
  if (bounds === undefined) throw new Error('fixture: empty bounds');
  return fitViewport(bounds, vp());
};

describe('A spectated seat is one nobody at this keyboard drives', () => {
  it('Local seat kinds', () => {
    expect(local('heuristic')).toBe(true);
    expect(local('byok')).toBe(true);
    expect(local('human')).toBe(false);
  });

  it('A hot-seat human who is not you is still not spectated', () => {
    expect(local('human')).toBe(false);
  });

  it('Every seat of an all-bot match is spectated', () => {
    const kinds: readonly SeatKind[] = ['heuristic', 'heuristic', 'heuristic'];
    expect(kinds.map(local)).toEqual([true, true, true]);
  });
});

describe('The camera is locked for the replay window only', () => {
  it('Locked while the decided moves replay', () => {
    expect(
      cameraLocked({ spectating: true, autoFocus: true, inReplayWindow: true, paused: false }),
    ).toBe(true);
  });

  it('Free while the seat is still deciding', () => {
    expect(
      cameraLocked({ spectating: true, autoFocus: true, inReplayWindow: false, paused: false }),
    ).toBe(false);
  });

  it('Auto-focus off releases the camera', () => {
    expect(
      cameraLocked({ spectating: true, autoFocus: false, inReplayWindow: true, paused: false }),
    ).toBe(false);
  });
});

describe('Only a step earns a hop', () => {
  it('A step names its two arrows', () => {
    expect(arrowsOfMove(step(arrow('a1'), arrow('a2'), 1))).toEqual([arrow('a1'), arrow('a2')]);
  });

  it('Moves that show nothing get no hop', () => {
    for (const move of [endTurn()]) {
      expect(arrowsOfMove(move)).toEqual([]);
      expect(hopTargets([pt(0, 0)], [], vp())).toBeUndefined();
    }
  });
});

describe('A fit frames what it was given and stays inside the zoom clamps', () => {
  it('Two nearby arrows are framed together', () => {
    const fit = fitOf([pt(0, 0), pt(3, 2)]);
    expect(fit.target.cx).toBeCloseTo(1.5, 10);
    expect(fit.target.cy).toBeCloseTo(1, 10);
    expect(showsPoint(fit.target, vp(), pt(0, 0))).toBe(true);
    expect(showsPoint(fit.target, vp(), pt(3, 2))).toBe(true);
    expect(fit.hardCut).toBe(false);
  });

  it('A tight fit does not zoom past the maximum', () => {
    expect(fitOf([pt(0, 0), pt(1, 0)]).target.scale).toBe(ZOOM.max);
  });

  it('A wide fit does not zoom out past the minimum', () => {
    // 40 units on both axes: the unclamped fit would be ~14 px/unit.
    expect(fitOf([pt(0, 0), pt(40, 40)]).target.scale).toBe(ZOOM.min);
  });
});

describe('A hop bridges the previous beat and the upcoming move', () => {
  it('The bridging beat frames both, the move beat frames one', () => {
    const hop = hopTargets([pt(0, 0), pt(1, 0)], [pt(6, 0), pt(7, 0)], vp());
    expect(hop).toBeDefined();
    if (hop === undefined) return;
    const wide = hop.wide;
    expect(wide).toBeDefined();
    if (wide === undefined) return;
    for (const p of [pt(0, 0), pt(1, 0), pt(6, 0), pt(7, 0)]) {
      expect(showsPoint(wide, vp(), p)).toBe(true);
    }
    expect(hop.close.cx).toBeCloseTo(6.5, 10);
    expect(hop.close.cy).toBeCloseTo(0, 10);
    expect(showsPoint(hop.close, vp(), pt(0, 0))).toBe(false);
    expect(hop.hardCut).toBe(false);
  });

  it('The first hop of a window bridges from the saved camera centre', () => {
    const hop = hopTargets([pt(0, 0)], [pt(5, 1), pt(6, 1)], vp());
    expect(hop).toBeDefined();
    const wide = hop?.wide;
    expect(wide).toBeDefined();
    if (wide === undefined) return;
    for (const p of [pt(0, 0), pt(5, 1), pt(6, 1)]) {
      expect(showsPoint(wide, vp(), p)).toBe(true);
    }
  });

  it('A seat boundary holds longer', () => {
    const timing = hopTiming({ speed: 1, seatBoundary: true, reducedMotion: false });
    expect(timing.holdMs).toBe(BASE_TIMING.seatHoldMs);
    expect(timing.easeOutMs).toBe(260);
    expect(timing.easeInMs).toBe(300);
  });
});

describe('Timing scales with the playback speed', () => {
  it('Speed divides every duration together', () => {
    const rows = [
      { speed: 1, out: 260, in: 300, hold: 150, gap: 400 },
      { speed: 2, out: 130, in: 150, hold: 75, gap: 200 },
      { speed: 0.5, out: 520, in: 600, hold: 300, gap: 800 },
    ] as const;
    for (const row of rows) {
      const timing = hopTiming({ speed: row.speed, seatBoundary: false, reducedMotion: false });
      expect(timing).toEqual({
        easeOutMs: row.out,
        easeInMs: row.in,
        holdMs: row.hold,
        gapMs: row.gap,
      });
    }
  });

  it('Reduced motion hard-cuts but still takes you there', () => {
    const timing = hopTiming({ speed: 1, seatBoundary: false, reducedMotion: true });
    expect(timing).toEqual({ easeOutMs: 0, easeInMs: 0, holdMs: 150, gapMs: 400 });
    const hop = hopTargets([pt(0, 0)], [pt(2, 0), pt(3, 0)], vp());
    expect(hop?.close).toBeDefined();
  });
});

describe('Restore puts the player back, and nudges only if the target is off screen', () => {
  it('A visible target restores the saved camera untouched', () => {
    const saved = camera(0, 0, 48);
    expect(restoreTarget(saved, pt(1, 1), vp())).toEqual(saved);
  });

  it('An off-screen target re-centres at the saved scale', () => {
    const saved = camera(0, 0, 48);
    expect(restoreTarget(saved, pt(40, 40), vp())).toEqual({ cx: 40, cy: 40, scale: 48 });
  });
});

describe('The target stack falls back down a fixed chain', () => {
  it('End Turn uses the stack selected at the click', () => {
    expect(
      focusArrow({
        selectedAtCommit: arrow('s1'),
        turnExits: [arrow('e1')],
        owned: ownedSet('s1', 'e1'),
      }),
    ).toBe(arrow('s1'));
  });

  it('Exhaustion uses the exit of the final step', () => {
    expect(
      focusArrow({
        turnExits: [arrow('e1'), arrow('e2'), arrow('e3')],
        owned: ownedSet('e3'),
      }),
    ).toBe(arrow('e3'));
  });

  it('A dead stack walks back through this turn’s exits', () => {
    expect(
      focusArrow({
        selectedAtCommit: arrow('s1'),
        turnExits: [arrow('e1'), arrow('e2'), arrow('e3')],
        owned: ownedSet('e1'),
      }),
    ).toBe(arrow('e1'));
  });
});
