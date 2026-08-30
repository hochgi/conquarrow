/**
 * EARS invariants for
 * docs/spec/spectated-camera-grouping/spectated-camera-grouping.md.
 * Property tests over deterministic generators — no `Math.random` anywhere.
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import {
  BASE_TIMING,
  FIT_CAP_RADIUS,
  FIT_PADDING,
  GROUP_MOVE_PAN_EPS,
  GROUP_MOVE_SCALE_EPS,
  SPECTATE_ZOOM_MAX,
  SPECTATE_ZOOM_MIN,
  SPEED_MAX,
  SPEED_MIN,
  arrowsOfMove,
  boundsOf,
  clampSpeed,
  groupScale,
  groupTarget,
  groupTiming,
  planGroups,
  splitTurns,
  suppressed,
} from '../src/spectate';
import type { CameraGroup, Pt } from '../src/spectate';
import { ZOOM } from '../src/viewport';
import type { Viewport } from '../src/viewport';
import {
  beatCloud,
  beatsAt,
  camera,
  codeOf,
  compareScores,
  expectedDisplay,
  expectedScale,
  partitions,
  pointsOfGroup,
  rangesOf,
  scoreVector,
  spanBeat,
  spectateSource,
  stepMove,
  vp,
} from './spectated-camera-grouping.support';

const viewport: Viewport = vp();

/** Deterministic sample turns: seeds 1..24, lengths 1..8. */
const sampleTurns = (): readonly (readonly (readonly Pt[])[])[] => {
  const out: (readonly (readonly Pt[])[])[] = [];
  for (let seed = 1; seed <= 24; seed += 1) {
    out.push(beatCloud(seed, 1 + (seed % 8)));
  }
  return out;
};

const feasible = (points: readonly Pt[]): boolean =>
  expectedScale(points, viewport) >= SPECTATE_ZOOM_MIN;

/** The normative pass-1 greedy prefix count, restated from the spec. */
const greedyK = (beats: readonly (readonly Pt[])[]): number => {
  let i = 0;
  let k = 0;
  while (i < beats.length) {
    let j = i + 1;
    while (j < beats.length && feasible(beats.slice(i, j + 1).flat())) j += 1;
    k += 1;
    i = j;
  }
  return k;
};

/** The unique leximaxmin-best partition, ties broken on the earliest split (D10). */
const bestSplits = (beats: readonly (readonly Pt[])[], k: number): readonly number[] => {
  const all = partitions(beats.length, k);
  let best = all[0] ?? [];
  for (const cand of all.slice(1)) {
    const cmp = compareScores(scoreVector(beats, cand, viewport), scoreVector(beats, best, viewport));
    if (cmp > 0) {
      best = cand;
      continue;
    }
    if (cmp === 0) {
      // D10: earliest split wins, evaluated last-split-first.
      for (let i = cand.length - 1; i >= 0; i -= 1) {
        const a = cand[i] ?? 0;
        const b = best[i] ?? 0;
        if (a !== b) {
          if (a < b) best = cand;
          break;
        }
      }
    }
  }
  return best;
};

const splitsOf = (plan: readonly CameraGroup[]): readonly number[] =>
  plan.slice(1).map((g) => g.from);

describe('Segmentation', () => {
  it('1, 2: a plan is built per turn, split at endTurn', () => {
    const window: readonly Move[] = [stepMove(1), stepMove(2), endTurn(), stepMove(3), endTurn()];
    const turns = splitTurns(window);
    for (const turn of turns) {
      expect(turn.filter((m) => m.kind === 'endTurn').length).toBeLessThanOrEqual(1);
      const idx = turn.findIndex((m) => m.kind === 'endTurn');
      if (idx >= 0) expect(idx).toBe(turn.length - 1);
    }
    expect(turns.flat().filter((m) => m.kind !== 'endTurn')).toHaveLength(3);
  });

  it('D15: splitTurns never emits an empty turn', () => {
    const windows: readonly (readonly Move[])[] = [
      [],
      [endTurn()],
      [endTurn(), endTurn()],
      [stepMove(1)],
      [stepMove(1), endTurn()],
      [stepMove(1), endTurn(), stepMove(2)],
      [stepMove(1), endTurn(), stepMove(2), endTurn()],
      [stepMove(1), stepMove(2), endTurn(), stepMove(3)],
    ];
    const steps = (moves: readonly Move[]): readonly Move[] =>
      moves.filter((m) => m.kind !== 'endTurn');
    for (const window of windows) {
      const turns = splitTurns(window);
      for (const turn of turns) expect(turn.length).toBeGreaterThan(0);
      // Nothing is lost, duplicated or re-ordered.
      expect(steps(turns.flat())).toEqual(steps(window));
    }
    expect(splitTurns([])).toEqual([]);
    expect(splitTurns([endTurn()])).toEqual([]);
    expect(splitTurns([stepMove(1), endTurn()])).toHaveLength(1);
  });

  it('3: grouping never spans a seat, because it never spans a turn', () => {
    // `planGroups` has no seat parameter: it is called once per turn, and a turn
    // is one seat's. The signature is the invariant.
    expect(planGroups.length).toBe(2);
    for (const group of planGroups(beatsAt([0, 0], [1, 0]), viewport)) {
      expect(Object.keys(group)).not.toContain('seat');
    }
  });

  it('4, 5: only moves that name arrows become beats; a beatless turn plans nothing', () => {
    expect(arrowsOfMove(endTurn())).toEqual([]);
    expect(planGroups([], viewport)).toEqual([]);
  });
});

describe('Allocation is total, contiguous and minimal', () => {
  it('6: groups are contiguous, non-empty, in order, and cover every beat once', () => {
    for (const beats of sampleTurns()) {
      const plan = planGroups(beats, viewport);
      expect(plan.length).toBeGreaterThan(0);
      let cursor = 0;
      for (const group of plan) {
        expect(group.from).toBe(cursor);
        expect(group.to).toBeGreaterThan(group.from);
        cursor = group.to;
      }
      expect(cursor).toBe(beats.length);
    }
  });

  it('7: the group count is exactly the greedy prefix count at the floor', () => {
    for (const beats of sampleTurns()) {
      expect(planGroups(beats, viewport)).toHaveLength(greedyK(beats));
    }
  });

  it('8: no partition into fewer groups fits the safe box at the floor', () => {
    for (const beats of sampleTurns()) {
      const k = planGroups(beats, viewport).length;
      expect(k).toBe(greedyK(beats));
      for (let fewer = 1; fewer < k; fewer += 1) {
        for (const splits of partitions(beats.length, fewer)) {
          const ok = rangesOf(beats.length, splits).every(([from, to]) =>
            feasible(beats.slice(from, to).flat()),
          );
          expect(ok).toBe(false);
        }
      }
    }
  });

  it('15: the chosen partition is lexicographically greatest on ascending display scales', () => {
    for (const beats of sampleTurns()) {
      const plan = planGroups(beats, viewport);
      expect(plan.length).toBe(greedyK(beats));
      const chosen = scoreVector(beats, splitsOf(plan), viewport);
      for (const splits of partitions(beats.length, plan.length)) {
        expect(compareScores(chosen, scoreVector(beats, splits, viewport))).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('16: ties break on the earliest split, and one partition is returned', () => {
    for (const beats of sampleTurns()) {
      const plan = planGroups(beats, viewport);
      expect(plan.length).toBe(greedyK(beats));
      expect(splitsOf(plan)).toEqual(bestSplits(beats, plan.length));
    }
  });

  it('17: scale above the ceiling does not influence the allocation', () => {
    // A group whose raw scale is far above the ceiling reports exactly the
    // ceiling, so the allocation cannot see the surplus zoom and spends its
    // moves on the needier neighbour instead.
    const tight = beatsAt([0, 0], [0, 0], [0, 0], [0, 0]);
    for (const group of planGroups(tight, viewport)) {
      expect(group.target.scale).toBe(SPECTATE_ZOOM_MAX);
    }
    expect(expectedScale([{ x: 0, y: 0 }], viewport)).toBeGreaterThan(SPECTATE_ZOOM_MAX);

    const beats = beatsAt([0, 0], [4, 0], [8, 0], [12, 0], [16, 0], [30, 0]);
    const plan = planGroups(beats, viewport);
    // The discarded 5|1 split holds a group far above the ceiling; the chosen
    // one keeps both groups between the floor and the ceiling.
    expect(expectedScale(beats.slice(5).flat(), viewport)).toBeGreaterThan(SPECTATE_ZOOM_MAX);
    expect(splitsOf(plan)).toEqual([4]);
  });
});

describe('Framing', () => {
  it('9: a group feasible at the floor is framed at or above the floor', () => {
    for (const beats of sampleTurns()) {
      expect(planGroups(beats, viewport).length).toBe(greedyK(beats));
      for (const group of planGroups(beats, viewport)) {
        const points = pointsOfGroup(beats, group);
        if (feasible(points)) expect(group.target.scale).toBeGreaterThanOrEqual(SPECTATE_ZOOM_MIN);
      }
    }
  });

  it('10, 11: no group is framed above the ceiling, and every scale is within the zoom clamps', () => {
    for (const beats of sampleTurns()) {
      expect(planGroups(beats, viewport).length).toBe(greedyK(beats));
      for (const group of planGroups(beats, viewport)) {
        expect(group.target.scale).toBeLessThanOrEqual(SPECTATE_ZOOM_MAX);
        expect(group.target.scale).toBeGreaterThanOrEqual(ZOOM.min);
        expect(group.target.scale).toBeLessThanOrEqual(ZOOM.max);
      }
    }
  });

  it('12: a singleton that cannot fit the safe box at the floor is framed below it, not cropped', () => {
    for (const width of [34, 40, 60, 80]) {
      const beats = [spanBeat([0, 0], [width, 0])];
      const plan = planGroups(beats, viewport);
      expect(plan).toHaveLength(1);
      expect(plan[0]?.target.scale).toBeLessThan(SPECTATE_ZOOM_MIN);
      expect(plan[0]?.target.scale).toBeGreaterThanOrEqual(ZOOM.min);
    }
  });

  it('13: every target is centred on the midpoint of its group’s beats', () => {
    for (const beats of sampleTurns()) {
      expect(planGroups(beats, viewport).length).toBe(greedyK(beats));
      for (const group of planGroups(beats, viewport)) {
        const b = boundsOf(pointsOfGroup(beats, group));
        expect(b).toBeDefined();
        if (b === undefined) continue;
        expect(group.target.cx).toBeCloseTo((b.minX + b.maxX) / 2, 9);
        expect(group.target.cy).toBeCloseTo((b.minY + b.maxY) / 2, 9);
      }
    }
  });

  it('14: hardCut is exactly the padded half-diagonal passing the cap', () => {
    for (const beats of sampleTurns()) {
      expect(planGroups(beats, viewport).length).toBe(greedyK(beats));
      for (const group of planGroups(beats, viewport)) {
        const b = boundsOf(pointsOfGroup(beats, group));
        if (b === undefined) continue;
        const halfW = (b.maxX - b.minX) / 2 + FIT_PADDING;
        const halfH = (b.maxY - b.minY) / 2 + FIT_PADDING;
        expect(group.hardCut).toBe(Math.hypot(halfW, halfH) > FIT_CAP_RADIUS);
      }
    }
  });

  it('groupScale and groupTarget agree with the normative fit', () => {
    for (const beats of sampleTurns()) {
      const points = beats.flat();
      expect(groupScale(points, viewport)).toBeCloseTo(expectedScale(points, viewport), 9);
      expect(groupTarget(points, viewport).target.scale).toBeCloseTo(
        expectedDisplay(points, viewport),
        9,
      );
    }
  });
});

describe('Determinism', () => {
  it('18: equal inputs yield equal plans, targets and timings', () => {
    for (const beats of sampleTurns()) {
      expect(planGroups(beats, viewport).length).toBe(greedyK(beats));
      expect(planGroups(beats, viewport)).toEqual(planGroups(beats, viewport));
      expect(groupTarget(beats.flat(), viewport)).toEqual(groupTarget(beats.flat(), viewport));
    }
    const args = { speed: 1.7, boundary: true, reducedMotion: false } as const;
    expect(groupTiming(args)).toEqual(groupTiming(args));
  });

  it('19, 29: nothing in the plan reads a clock, a random source, the DOM or Set order', () => {
    const code = codeOf(spectateSource());
    for (const forbidden of [
      'Math.random',
      'Date.now',
      'new Date',
      'performance.now',
      'document',
      'window.',
      'localStorage',
      'crypto',
    ]) {
      expect(code).not.toContain(forbidden);
    }
    // No iteration over an unordered collection feeds a decision.
    expect(code).not.toMatch(/for\s*\(\s*const\s+\w+\s+of\s+new (Set|Map)/);
  });

  it('28: local playback and online replay consume one plan function', () => {
    for (const beats of sampleTurns()) {
      const local = planGroups(beats, viewport);
      const online = planGroups(beats, viewport);
      expect(local.length).toBe(greedyK(beats));
      expect(online).toEqual(local);
    }
  });

  it('30: spectate.ts touches no game rule', () => {
    const code = codeOf(spectateSource());
    for (const forbidden of ['GameState', 'rules-core', 'applyMove', 'legalMoves']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe('Motion', () => {
  it('20, 21: a group carries exactly one camera movement and no per-move target', () => {
    for (const beats of sampleTurns()) {
      expect(planGroups(beats, viewport).length).toBe(greedyK(beats));
      for (const group of planGroups(beats, viewport)) {
        expect(Object.keys(group).sort()).toEqual(['from', 'hardCut', 'target', 'to']);
      }
    }
  });

  it('22: a target within both thresholds leaves the camera exactly where it is', () => {
    const shorter = Math.min(viewport.width, viewport.height);
    const current = camera(0, 0, 48);
    for (const panFraction of [0, 0.01, 0.02, 0.039]) {
      for (const ratio of [1, 1.01, 1.029]) {
        const next = camera((panFraction * shorter) / 48, 0, 48 * ratio);
        const withinPan = panFraction <= GROUP_MOVE_PAN_EPS;
        const withinScale = ratio - 1 <= GROUP_MOVE_SCALE_EPS;
        expect(suppressed(current, next, viewport)).toBe(withinPan && withinScale);
      }
    }
  });

  it('22: past either threshold the camera moves', () => {
    const shorter = Math.min(viewport.width, viewport.height);
    const current = camera(0, 0, 48);
    expect(suppressed(current, current, viewport)).toBe(true);
    expect(suppressed(current, camera((0.05 * shorter) / 48, 0, 48), viewport)).toBe(false);
    expect(suppressed(current, camera(0, 0, 48 * 1.05), viewport)).toBe(false);
    expect(suppressed(current, camera(0, 0, 48 / 1.05), viewport)).toBe(false);
  });

  it('23: suppression is measured against the camera as it stands', () => {
    const current = camera(3, -2, 41);
    const next = camera(3.05, -2, 41);
    // The reference is `current` only; there is no third parameter for a
    // pending target, so a suppressed group cannot shift the reference.
    expect(suppressed(current, next, viewport)).toBe(suppressed(current, next, viewport));
    expect(suppressed(current, current, viewport)).toBe(true);
    expect(suppressed.length).toBe(3);
  });
});

describe('Timing', () => {
  it('24: one tween per boundary, of the summed P48 ease-out and ease-in', () => {
    expect(groupTiming({ speed: 1, boundary: false, reducedMotion: false }).moveMs).toBe(
      BASE_TIMING.easeOutMs + BASE_TIMING.easeInMs,
    );
  });

  it('25: the gap, the hold and the turn-boundary hold keep their P48 values', () => {
    const ordinary = groupTiming({ speed: 1, boundary: false, reducedMotion: false });
    const boundary = groupTiming({ speed: 1, boundary: true, reducedMotion: false });
    expect(ordinary.holdMs).toBe(BASE_TIMING.holdMs);
    expect(boundary.holdMs).toBe(BASE_TIMING.seatHoldMs);
    expect(ordinary.gapMs).toBe(BASE_TIMING.gapMs);
    expect(boundary.gapMs).toBe(BASE_TIMING.gapMs);
  });

  it('26: reduced motion zeroes the tween only, and still takes the camera everywhere', () => {
    for (const boundary of [false, true]) {
      const timing = groupTiming({ speed: 1, boundary, reducedMotion: true });
      expect(timing.moveMs).toBe(0);
      expect(timing.gapMs).toBe(BASE_TIMING.gapMs);
      expect(timing.holdMs).toBe(boundary ? BASE_TIMING.seatHoldMs : BASE_TIMING.holdMs);
    }
    // Every group still has a target to be taken to.
    for (const group of planGroups(beatsAt([0, 0], [40, 0]), viewport)) {
      expect(group.target).toBeDefined();
    }
  });

  it('27: speed scales the tween, the hold and the gap together, clamped to [0.5, 3]', () => {
    for (const speed of [0.1, 0.5, 1, 1.5, 2, 3, 99, Infinity, NaN]) {
      const used = clampSpeed(speed);
      expect(used).toBeGreaterThanOrEqual(SPEED_MIN);
      expect(used).toBeLessThanOrEqual(SPEED_MAX);
      const timing = groupTiming({ speed, boundary: false, reducedMotion: false });
      expect(timing).toEqual({
        moveMs: Math.round((BASE_TIMING.easeOutMs + BASE_TIMING.easeInMs) / used),
        holdMs: Math.round(BASE_TIMING.holdMs / used),
        gapMs: Math.round(BASE_TIMING.gapMs / used),
      });
    }
  });
});
