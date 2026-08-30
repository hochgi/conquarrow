/**
 * docs/spec/spectated-camera-grouping/spectated-camera-grouping.core.feature
 * One it() per Gherkin scenario, against the pure `spectate.ts` surface.
 * The rAF tween runner is deliberately untested (see the overview).
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import type { ArrowId, Move } from '@conquarrow/contracts';
import {
  BASE_TIMING,
  SPECTATE_ZOOM_MAX,
  SPECTATE_ZOOM_MIN,
  groupTiming,
  planGroups,
  splitTurns,
} from '../src/spectate';
import type { Pt } from '../src/spectate';
import {
  beatsAt,
  beatsOfMoves,
  expectedDisplay,
  pointsOfGroup,
  pt,
  stepMove,
  vp,
} from './spectated-camera-grouping.support';

const viewport = vp();

/** Background: safe box 0.72, floor 30, ceiling 56. */
it('Background: the tuning block is the one the feature files assume', () => {
  expect(SPECTATE_ZOOM_MIN).toBe(30);
  expect(SPECTATE_ZOOM_MAX).toBe(56);
});

describe('A run of moves that fits the safe box is framed once', () => {
  it('Three neighbouring moves become one group', () => {
    const beats = beatsAt([0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]);
    const plan = planGroups(beats, viewport);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.from).toBe(0);
    expect(plan[0]?.to).toBe(beats.length);
  });

  it('The camera does not move inside a group', () => {
    const beats = beatsAt([0, 0], [1, 0], [2, 0], [3, 0]);
    const plan = planGroups(beats, viewport);
    // One group is one camera movement; the group carries a single target for
    // all four moves, so there is nowhere for a per-move nudge to live.
    expect(plan).toHaveLength(1);
    expect(Object.keys(plan[0] ?? {}).sort()).toEqual(['from', 'hardCut', 'target', 'to']);
  });

  it('A group is centred on the midpoint of its beats', () => {
    const plan = planGroups(beatsAt([2, 4], [2, 4], [6, 8], [6, 8]), viewport);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.target.cx).toBeCloseTo(4, 10);
    expect(plan[0]?.target.cy).toBeCloseTo(6, 10);
  });

  it('A tight group is framed no closer than the ceiling', () => {
    const plan = planGroups(beatsAt([0, 0], [0, 0]), viewport);
    expect(plan[0]?.target.scale).toBe(SPECTATE_ZOOM_MAX);
  });
});

describe('A turn too wide for one shot costs the fewest shots the box allows', () => {
  it('A spread turn needs two groups', () => {
    const beats = beatsAt([0, 0], [1, 0], [2, 0], [30, 0], [31, 0], [32, 0]);
    const plan = planGroups(beats, viewport);
    expect(plan).toHaveLength(2);
    // No partition into fewer groups fits the safe box at the floor: the one
    // group a 1-partition would make is far below the floor.
    const whole: readonly Pt[] = beats.flat();
    expect(expectedDisplay(whole, viewport)).toBeLessThan(SPECTATE_ZOOM_MIN);
  });

  it('The moves are balanced across the groups, not stuffed into the first', () => {
    // Greedy at the floor admits x = 0,4,8,12,16 (span 16 fits) then 30 alone.
    const beats = beatsAt([0, 0], [4, 0], [8, 0], [12, 0], [16, 0], [30, 0]);
    const plan = planGroups(beats, viewport);
    expect(plan).toHaveLength(2);
    for (const group of plan) expect(group.to - group.from).not.toBe(5);

    const worst = Math.min(...plan.map((g) => g.target.scale));
    const greedyWorst = Math.min(
      expectedDisplay(beats.slice(0, 5).flat(), viewport),
      expectedDisplay(beats.slice(5).flat(), viewport),
    );
    expect(worst).toBeGreaterThan(greedyWorst);
  });
});

describe('Grouping never spans a turn', () => {
  const centroid = (id: ArrowId): Pt => {
    const table: Record<string, Pt> = {
      a1: pt(0, 0),
      b1: pt(1, 0),
      a2: pt(2, 0),
      b2: pt(3, 0),
    };
    return table[String(id)] ?? pt(0, 0);
  };

  it('Two turns in one replay window are planned apart', () => {
    // Both turns' beats sit within a couple of lattice units, so they would fit
    // the safe box together at the floor. They are still planned separately.
    const window: readonly Move[] = [stepMove(1), endTurn(), stepMove(2)];
    const turns = splitTurns(window);
    expect(turns).toHaveLength(2);

    const plans = turns.map((turn) => planGroups(beatsOfMoves(turn, centroid), viewport));
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan).toHaveLength(1);
      expect(plan[0]?.to).toBe(1);
    }
  });

  it('endTurn contributes nothing to a group', () => {
    const turn: readonly Move[] = [stepMove(1), stepMove(2), endTurn()];
    const beats = beatsOfMoves(turn, centroid);
    expect(beats).toHaveLength(2);

    const plan = planGroups(beats, viewport);
    expect(plan).toHaveLength(1);
    const only = plan[0];
    if (only === undefined) throw new Error('no group planned');
    expect(pointsOfGroup(beats, only)).toHaveLength(4);
    expect(plan[0]?.target.cx).toBeCloseTo(1.5, 10);
    expect(plan[0]?.target.cy).toBeCloseTo(0, 10);
  });
});

describe('One camera movement per group, then stillness', () => {
  it('A group boundary is a single merged tween followed by a hold', () => {
    const beats = beatsAt([0, 0], [1, 0], [20, 0], [21, 0]);
    const plan = planGroups(beats, viewport);
    expect(plan).toHaveLength(2);
    // Exactly one movement per group: one target, one hardCut flag, no bridge.
    for (const group of plan) {
      expect(group.target).toBeDefined();
      expect(group).not.toHaveProperty('wide');
    }
    const timing = groupTiming({ speed: 1, boundary: false, reducedMotion: false });
    expect(timing.moveMs).toBe(BASE_TIMING.easeOutMs + BASE_TIMING.easeInMs);
    expect(timing.holdMs).toBe(BASE_TIMING.holdMs);
  });

  it('Local playback and online replay use the same plan', () => {
    const beats = beatsAt([0, 0], [1, 0], [20, 0], [21, 0]);
    const local = planGroups(beats, viewport);
    const online = planGroups(beats, viewport);
    expect(local).toHaveLength(2);
    expect(online).toEqual(local);
  });
});
