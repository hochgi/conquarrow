/**
 * docs/spec/spectated-camera-grouping/spectated-camera-grouping.edge-cases.feature
 * One it() per Gherkin scenario, against the pure `spectate.ts` surface.
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import {
  BASE_TIMING,
  FIT_CAP_RADIUS,
  GROUP_MOVE_PAN_EPS,
  GROUP_MOVE_SCALE_EPS,
  SPECTATE_ZOOM_MAX,
  SPECTATE_ZOOM_MIN,
  arrowsOfMove,
  clampSpeed,
  groupTarget,
  groupTiming,
  planGroups,
  splitTurns,
  suppressed,
} from '../src/spectate';
import { ZOOM } from '../src/viewport';
import {
  beatsAt,
  camera,
  expectedDisplay,
  expectedScale,
  spanBeat,
  stepMove,
  vp,
} from './spectated-camera-grouping.support';

const viewport = vp();

/** Turns that name at least one arrow — the only ones that produce beats. */
const beatingTurns = (moves: readonly Move[]): readonly (readonly Move[])[] =>
  splitTurns(moves).filter((turn) => turn.some((m) => arrowsOfMove(m).length > 0));

describe('A turn with nothing to look at asks for nothing', () => {
  it('An empty move list plans nothing', () => {
    expect(beatingTurns([])).toHaveLength(0);
    expect(planGroups([], viewport)).toEqual([]);
  });

  it('A turn of nothing but endTurn plans nothing', () => {
    // D15: a window of nothing but `endTurn` yields no turn at all.
    expect(splitTurns([endTurn()])).toEqual([]);
    expect(beatingTurns([endTurn()])).toHaveLength(0);
    expect(planGroups([], viewport)).toEqual([]);
  });

  it('A turn of one move is one group', () => {
    const plan = planGroups(beatsAt([3, 3]), viewport);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.to).toBe(1);
    expect(plan[0]?.from).toBe(0);
  });

  it('A beat whose arrows share a centroid is not a division by zero', () => {
    const plan = planGroups([spanBeat([5, 5], [5, 5])], viewport);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.target.scale).toBe(SPECTATE_ZOOM_MAX);
    expect(plan[0]?.target.cx).toBeCloseTo(5, 10);
    expect(plan[0]?.target.cy).toBeCloseTo(5, 10);
  });
});

describe('A move the camera had no choice about showing is never cropped', () => {
  it('A lone move too wide for the safe box zooms out past the floor', () => {
    const plan = planGroups([spanBeat([0, 0], [40, 0])], viewport);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.target.scale).toBeLessThan(SPECTATE_ZOOM_MIN);
    expect(plan[0]?.target.scale).toBeGreaterThanOrEqual(ZOOM.min);
  });

  it('A lone move beyond the fit cap is cut to, not flown to', () => {
    const plan = planGroups([spanBeat([0, 0], [200, 0])], viewport);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.hardCut).toBe(true);
    // The flag is exactly the padded half-diagonal passing the cap, and the
    // target is still the midpoint the camera jumps to.
    const fit = groupTarget(spanBeat([0, 0], [200, 0]), viewport);
    expect(fit.hardCut).toBe(true);
    expect(Math.hypot(101.5, 1.5)).toBeGreaterThan(FIT_CAP_RADIUS);
    expect(plan[0]?.target).toEqual(fit.target);
    expect(fit.target.cx).toBeCloseTo(100, 10);
  });
});

describe('Turns are split at endTurn, and never merged', () => {
  it('A trailing run with no endTurn is its own turn', () => {
    expect(splitTurns([stepMove(1), endTurn(), stepMove(2)])).toHaveLength(2);
    // D15: a window that *ends* in `endTurn` has no trailing empty run.
    expect(splitTurns([stepMove(1), endTurn()])).toHaveLength(1);
    expect(splitTurns([])).toEqual([]);
  });

  it("The same seat's consecutive turns are not merged", () => {
    // The seat moves twice in a row; both turns' beats sit on top of each other,
    // so they would fit the safe box together at the floor.
    const window: readonly Move[] = [stepMove(1), endTurn(), stepMove(1), endTurn()];
    expect(splitTurns(window)).toHaveLength(2);
    const turns = beatingTurns(window);
    expect(turns).toHaveLength(2);
    const plans = turns.map(() => planGroups(beatsAt([0, 0], [1, 0]), viewport));
    expect(plans).toHaveLength(2);
    for (const plan of plans) expect(plan).toHaveLength(1);
    // The second turn's first group starts a fresh camera beat at its own index 0.
    expect(plans[1]?.[0]?.from).toBe(0);
  });

  it('Two turns that would fit together are still planned apart', () => {
    const window: readonly Move[] = [stepMove(1), endTurn(), stepMove(1)];
    const turns = beatingTurns(window);
    expect(turns).toHaveLength(2);
    const plans = turns.map(() => planGroups(beatsAt([0, 0], [1, 0]), viewport));
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan).toHaveLength(1);
      expect(plan[0]?.to).toBe(2);
    }
  });
});

describe('A movement too small to see is not made', () => {
  const shorter = Math.min(viewport.width, viewport.height);
  const current = camera(0, 0, 48);

  it('A near-identical next group leaves the camera untouched', () => {
    const next = camera((0.01 * shorter) / 48, 0, 48 * 1.01);
    expect(suppressed(current, next, viewport)).toBe(true);
    expect(GROUP_MOVE_PAN_EPS).toBe(0.04);
    expect(GROUP_MOVE_SCALE_EPS).toBe(0.03);
  });

  it('A pan just past the threshold is made', () => {
    const next = camera((0.06 * shorter) / 48, 0, 48);
    expect(suppressed(current, current, viewport)).toBe(true);
    expect(suppressed(current, next, viewport)).toBe(false);
  });

  it('A scale change just past the threshold is made even with no pan', () => {
    expect(suppressed(current, current, viewport)).toBe(true);
    expect(suppressed(current, camera(0, 0, 48 * 1.1), viewport)).toBe(false);
  });

  it('Suppression does not accumulate drift', () => {
    const nexts = [
      camera((0.01 * shorter) / 48, 0, 48),
      camera((0.02 * shorter) / 48, 0, 48),
      camera((0.03 * shorter) / 48, 0, 48),
    ];
    // Each is measured against the camera as it stands, which never moves.
    for (const next of nexts) expect(suppressed(current, next, viewport)).toBe(true);
    // Suppression is a pure function of the standing camera and the next
    // target: asking twice cannot answer differently, so nothing accumulates.
    for (const next of nexts) {
      expect(suppressed(current, next, viewport)).toBe(suppressed(current, next, viewport));
    }
  });
});

describe('The allocation is exact, total and single-valued', () => {
  it('Every beat lands in exactly one group, in play order', () => {
    const beats = beatsAt([0, 0], [5, 0], [11, 0], [24, 0], [25, 0], [40, 0]);
    const plan = planGroups(beats, viewport);
    expect(plan.length).toBeGreaterThan(0);
    let cursor = 0;
    for (const group of plan) {
      expect(group.from).toBe(cursor);
      expect(group.to).toBeGreaterThan(group.from);
      cursor = group.to;
    }
    expect(cursor).toBe(beats.length);
  });

  it('Two identical turns plan identically', () => {
    const beats = beatsAt([0, 0], [9, 0], [18, 0], [27, 0]);
    expect(planGroups(beats, viewport)).toHaveLength(2);
    expect(planGroups(beats, viewport)).toEqual(planGroups(beats, viewport));
  });

  it('Ties break on the earliest split, not the evenest', () => {
    // Beats are indexed by play order, not by position, so a later beat can sit
    // inside an earlier group's bounds. Each fixture below has two or more
    // partitions into `k` groups with identical ascending display-scale
    // vectors; D10 takes the earliest split, so the last group takes the
    // remainder. (Verified tied: the optimum is reached by >= 2 partitions.)
    const rows = [
      { xs: [0, 1, 17, 1], k: 2, sizes: [1, 3] },
      { xs: [0, 17, 1, 1, 16, 0], k: 3, sizes: [1, 1, 4] },
      { xs: [0, 1, 1, 1, 17, 1], k: 2, sizes: [1, 5] },
    ] as const;
    for (const row of rows) {
      const beats = beatsAt(...row.xs.map((x) => [x, 0] as readonly [number, number]));
      const plan = planGroups(beats, viewport);
      expect(plan).toHaveLength(row.k);
      expect(plan.map((g) => g.to - g.from)).toEqual([...row.sizes]);
    }
  });

  it('Zoom above the ceiling scores as the ceiling', () => {
    // D9 is a guard, not a live rule at this spread: while the ceiling is under
    // twice the floor, two adjacent groups can never both sit at the ceiling, so
    // capping cannot flip a comparison and no reachable turn is allocated
    // differently because of it. The honest assertion is the one the invariant
    // now makes — a group framed above the ceiling *reports* the ceiling — not a
    // claim that the cap moved a split.
    const tight = beatsAt([12, 0]);
    expect(expectedScale(tight.flat(), viewport)).toBeGreaterThan(SPECTATE_ZOOM_MAX);
    const plan = planGroups(tight, viewport);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.target.scale).toBe(SPECTATE_ZOOM_MAX);
    expect(expectedDisplay(tight.flat(), viewport)).toBe(SPECTATE_ZOOM_MAX);
  });

  it('A group may be infeasible at the floor when k cannot be reduced', () => {
    const beats = [
      spanBeat([0, 0], [40, 0]),
      spanBeat([100, 0], [140, 0]),
      spanBeat([200, 0], [240, 0]),
    ];
    const plan = planGroups(beats, viewport);
    expect(plan).toHaveLength(3);
    for (const group of plan) {
      expect(group.to - group.from).toBe(1);
      expect(group.target.scale).toBeLessThan(SPECTATE_ZOOM_MIN);
    }
  });
});

describe('Timing follows the preferences, not the plan', () => {
  it('Reduced motion cuts instead of tweening but keeps the reading time', () => {
    const timing = groupTiming({ speed: 1, boundary: false, reducedMotion: true });
    expect(timing).toEqual({
      moveMs: 0,
      holdMs: BASE_TIMING.holdMs,
      gapMs: BASE_TIMING.gapMs,
    });
  });

  it('Playback speed scales the tween, the hold and the gap together', () => {
    const rows = [
      { speed: 0.5, tween: 1120, hold: 800, gap: 800 },
      { speed: 1, tween: 560, hold: 400, gap: 400 },
      { speed: 2, tween: 280, hold: 200, gap: 200 },
    ] as const;
    for (const row of rows) {
      expect(groupTiming({ speed: row.speed, boundary: true, reducedMotion: false })).toEqual({
        moveMs: row.tween,
        holdMs: row.hold,
        gapMs: row.gap,
      });
    }
  });

  it('An unusable stored speed is put in range, never thrown on', () => {
    const rows = [
      { stored: 0.1, used: 0.5 },
      { stored: 99, used: 3 },
      { stored: Infinity, used: 3 },
      { stored: NaN, used: 1 },
    ] as const;
    for (const row of rows) {
      expect(clampSpeed(row.stored)).toBe(row.used);
      const timing = groupTiming({ speed: row.stored, boundary: false, reducedMotion: false });
      expect(timing.gapMs).toBe(Math.round(BASE_TIMING.gapMs / row.used));
      expect(timing.moveMs).toBe(
        Math.round((BASE_TIMING.easeOutMs + BASE_TIMING.easeInMs) / row.used),
      );
    }
  });
});
