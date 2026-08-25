/**
 * EARS invariants from docs/spec/trails-simple/trails-simple.md as properties.
 *
 * Deterministic enumeration over fixture boards — no PRNG (ADR 0001).
 * Claim-walk cases run on the tiling (fill / reconnect need the plane).
 *
 * @see docs/spec/trails-simple/trails-simple.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import type { ArrowId, GameState } from '@conquarrow/contracts';
import { compareArrows } from '../src/order';
import {
  A,
  B,
  MINIMAL,
  MINIMAL_DIAMETER,
  SPACIOUS,
  SPACIOUS_DIAMETER,
  aRunFromHome,
  allArrows,
  anArrow,
  anExitFrom,
  anInterleaving,
  arrowAt,
  claimKeys,
  headsOn,
  isTrail,
  onBoard,
  onTiling,
  owned,
  pathFrom,
  pick,
  stateOf,
  territoryOf,
  totalHeads,
} from './support';

const BOARDS = [
  { name: 'minimal', description: MINIMAL, diameter: MINIMAL_DIAMETER },
  { name: 'spacious', description: SPACIOUS, diameter: SPACIOUS_DIAMETER },
] as const;

const junctionsOf = (
  table: ReturnType<typeof onBoard>,
  diameter: number,
): readonly {
  readonly ins: readonly ArrowId[];
  readonly outs: readonly ArrowId[];
}[] =>
  [...new Set(allArrows(table.geometry, diameter).map((a) => table.geometry.target(a)))].map(
    (point) => ({
      ins: table.geometry.inArrows(point),
      outs: table.geometry.outArrows(point),
    }),
  );

describe('P22 — no branch toll', () => {
  it.each(BOARDS)(
    'never refuses a whole-stack join/split vacate for unpaid toll on $name',
    ({ description, diameter }) => {
      // WHEN a move creates or vacates a join or split, SHALL NOT refuse for unpaid branch toll.
      const table = onBoard(description);
      for (const { ins, outs } of junctionsOf(table, diameter)) {
        const arriving = pick(ins, 1);
        const exit = pick(outs, 0);
        const state = stateOf([{ arrow: arriving, owner: A, heads: 2 }], A, {
          trail: { A: [pick(ins, 0), arriving] },
        });
        expect(() => table.rules.apply(state, step(arriving, exit, 2))).not.toThrow();

        const arm = pick(outs, 0);
        const other = pick(outs, 1);
        const splitState = stateOf([{ arrow: arm, owner: A, heads: 1 }], A, {
          trail: { A: [arm, other] },
        });
        const onward = anExitFrom(table.geometry, arm);
        expect(() => table.rules.apply(splitState, step(arm, onward, 1))).not.toThrow();
      }
    },
  );
});

describe('P22 — dormant persists until cut or re-attach', () => {
  it.each(BOARDS)(
    'keeps headless marks after a tip vacates on $name',
    ({ description }) => {
      // WHILE dormant / headless, SHALL leave marks standing until cut or re-attach.
      const table = onBoard(description);
      const tip = anArrow(table.geometry);
      const next = anExitFrom(table.geometry, tip);
      const before = stateOf([{ arrow: tip, owner: A, heads: 1 }], A, {
        trail: { A: [tip] },
      });
      const after = table.rules.apply(before, step(tip, next, 1));
      expect(isTrail(after, A, tip)).toBe(true);
      expect(headsOn(after, tip)).toBe(0);

      // Authored dormant (no stack, no territory departure) also stands.
      const path = pathFrom(table.geometry, anArrow(table.geometry), 3);
      const stretch = [arrowAt(path, 0), arrowAt(path, 1), arrowAt(path, 2)];
      const dormant = stateOf([], A, { trail: { A: stretch } });
      for (const arrow of stretch) {
        expect(table.rules.anchorGrade(dormant, arrow, A)).toBe('dormant');
        expect(isTrail(dormant, A, arrow)).toBe(true);
      }
    },
  );
});

describe('P22 — no size-1 stack-grade freeze', () => {
  it.each(BOARDS)(
    'always offers a vacating grain step from a lone stack-grade tip on $name',
    ({ description }) => {
      // WHEN size-1 is the sole stack on a stack-grade component, SHALL still permit a legal grain step that vacates.
      const table = onBoard(description);
      const tip = anArrow(table.geometry);
      const next = anExitFrom(table.geometry, tip);
      const state = stateOf([{ arrow: tip, owner: A, heads: 1, spent: 0 }], A, {
        trail: { A: [tip, next] },
      });
      expect(table.rules.anchorGrade(state, tip, A)).toBe('stack');
      const vacating = table.rules
        .legalMoves(state)
        .filter((m) => m.kind === 'step' && m.from === tip && m.count === 1);
      expect(vacating.length).toBeGreaterThan(0);
      for (const move of vacating) {
        expect(() => table.rules.apply(state, move)).not.toThrow();
      }
    },
  );
});

describe('P33 — convert wipe evaporates connected empty trail', () => {
  it('clears distal empty trail after converting a stack-grade tip', () => {
    // WHEN conversion wipes from converted arrows, SHALL evaporate connected empty trail (P33).
    // A point-disjoint cut tail that no wipe reached still stands (P22).
    const table = onBoard(SPACIOUS);
    const tip = anArrow(table.geometry);
    const distal = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, distal);
    const points = new Set(
      [tip, distal, mover].flatMap((a) => [
        String(table.geometry.origin(a)),
        String(table.geometry.target(a)),
      ]),
    );
    const tail = allArrows(table.geometry, SPACIOUS_DIAMETER).find(
      (a) =>
        a !== tip &&
        a !== distal &&
        a !== mover &&
        !points.has(String(table.geometry.origin(a))) &&
        !points.has(String(table.geometry.target(a))),
    );
    if (tail === undefined) throw new Error('setup: no point-disjoint cut tail');
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: [tip, distal, tail] },
        territory: [
          { arrow: tip, owner: A },
          { arrow: distal, owner: A },
          { arrow: mover, owner: A },
        ],
      },
    );

    const after = table.rules.apply(before, step(mover, anExitFrom(table.geometry, mover), 1));

    expect(isTrail(after, B, tip)).toBe(false);
    expect(isTrail(after, B, distal)).toBe(false);
    expect(isTrail(after, B, tail)).toBe(true);
  });
});

describe('P22 — territory-rooted claim is uncapped', () => {
  it('claims the full upstream walk on a territory-rooted landing', () => {
    // WHEN landing from a territory-grade component, SHALL claim the full upstream walk.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 4);
    const tip = arrowAt(run, 3);
    const landing = anExitFrom(table.geometry, tip);
    const before = stateOf([{ arrow: tip, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });
    expect(table.rules.anchorGrade(before, tip, A)).toBe('territory');

    const after = table.rules.apply(before, step(tip, landing, 1));

    for (const arrow of run) expect(territoryOf(after, arrow)).toBe(A);
  });
});

describe('P42 — claim walk includes occupied trail arrows', () => {
  it('paints every against-grain predecessor, including the sentry, for each spine length', () => {
    // WHEN a head lands on own territory with trail behind, SHALL claim every arrow
    // reached walking against the grain from `from`, including owner-occupied trail.
    const table = onTiling();
    for (const length of [3, 4, 5] as const) {
      const { fire, run, tip, landing, before } = aStackGradeSpine(table, length);
      expect(table.rules.anchorGrade(before, tip, A)).not.toBe('territory');

      const after = table.rules.apply(before, step(tip, landing, 1));

      for (let i = run.length - 1; i >= 0; i -= 1) {
        const arrow = arrowAt(run, i);
        expect(territoryOf(after, arrow), `length ${String(length)} ${String(arrow)}`).toBe(A);
        expect(isTrail(after, A, arrow)).toBe(false);
      }
      expect(headsOn(after, fire)).toBe(1);
    }
  });
});

describe('P42 — pre-landing grade does not change the claimed set', () => {
  it('paints the same run whether the fragment was stack-grade or territory-rooted', () => {
    // Pre-landing grade SHALL NOT change the set claimed.
    const table = onTiling();
    for (const length of [3, 4] as const) {
      const stack = aStackGradeSpine(table, length);
      const { home, run } = aRunFromHome(table.geometry, length);
      const fire = arrowAt(run, 0);
      const tip = arrowAt(run, length - 1);
      const landing = anExitFrom(table.geometry, tip);
      const rooted = stateOf(
        [
          { arrow: fire, owner: A, heads: 1 },
          { arrow: tip, owner: A, heads: 1 },
        ],
        A,
        {
          trail: { A: [...run] },
          territory: owned([home, landing], A),
        },
      );
      expect(table.rules.anchorGrade(stack.before, stack.tip, A)).not.toBe('territory');
      expect(table.rules.anchorGrade(rooted, tip, A)).toBe('territory');

      const afterStack = table.rules.apply(stack.before, step(stack.tip, stack.landing, 1));
      const afterRooted = table.rules.apply(rooted, step(tip, landing, 1));

      for (const arrow of run) {
        expect(territoryOf(afterStack, arrow)).toBe(A);
        expect(territoryOf(afterRooted, arrow)).toBe(A);
      }
    }
  });
});

describe('P42 — a fork’s other arm stays trail because it is downstream', () => {
  it('leaves every non-closing out-arrow of the fork as trail', () => {
    // WHEN a fork arm is downstream of the closing step, SHALL leave that arm as trail.
    const table = onTiling();
    const { run } = aRunFromHome(table.geometry, 3);
    const stem = arrowAt(run, 0);
    const fire = arrowAt(run, 1);
    const tip = arrowAt(run, 2);
    const forkPoint = table.geometry.target(stem);
    const otherArms = table.geometry.outArrows(forkPoint).filter((a) => a !== fire);
    const landing = anExitFrom(table.geometry, tip);
    const before = stateOf(
      [
        { arrow: fire, owner: A, heads: 1 },
        { arrow: tip, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { A: [stem, fire, tip, ...otherArms] },
        territory: owned([landing], A),
      },
    );

    const after = table.rules.apply(before, step(tip, landing, 1));

    for (const arm of otherArms) {
      expect(isTrail(after, A, arm)).toBe(true);
      expect(territoryOf(after, arm)).toBeUndefined();
    }
    expect(territoryOf(after, fire), 'sentry on closing arm').toBe(A);
    expect(territoryOf(after, stem), 'stem upstream of the sentry').toBe(A);
  });
});

describe('P42 — a merge claims every trail in-arrow', () => {
  it('paints each in-arrow of the merge whether that in-arrow is occupied', () => {
    // WHEN the walk transits a merge, SHALL claim every trail in-arrow, occupied or not.
    const table = onTiling();
    const { run } = aRunFromHome(table.geometry, 2);
    const first = arrowAt(run, 0);
    const onward = arrowAt(run, 1);
    const mergePoint = table.geometry.target(first);
    const ins = table.geometry.inArrows(mergePoint);
    const landing = anExitFrom(table.geometry, onward);

    for (const occupied of ins) {
      const before = stateOf(
        [
          { arrow: occupied, owner: A, heads: 1 },
          { arrow: onward, owner: A, heads: 1 },
        ],
        A,
        {
          trail: { A: [...ins, onward] },
          territory: owned([landing], A),
        },
      );
      const after = table.rules.apply(before, step(onward, landing, 1));
      for (const incoming of ins) {
        if (incoming !== occupied) expect(territoryOf(after, incoming)).toBe(A);
      }
      expect(territoryOf(after, occupied), 'occupied merge in-arrow').toBe(A);
      expect(headsOn(after, occupied)).toBe(1);
    }
  });
});

describe('P42 — evaporation still halt-at-first', () => {
  it.each(BOARDS)(
    'a movement cut does not enter the firebreak on $name',
    ({ description, diameter }) => {
      // WHEN a front would enter an owner-occupied trail arrow, SHALL halt.
      const table = onBoard(description);
      const { trailIn, trailOut: mid, ourIn, ourExit } = anInterleaving(
        table.geometry,
        diameter,
      );
      const tip = anExitFrom(table.geometry, mid);
      const home = pick(table.geometry.inArrows(table.geometry.origin(trailIn)), 0);
      const before = stateOf(
        [
          { arrow: ourIn, owner: B, heads: 1 },
          { arrow: mid, owner: A, heads: 1 },
          { arrow: tip, owner: A, heads: 1 },
        ],
        B,
        {
          trail: { A: [trailIn, mid, tip], B: [ourIn] },
          territory: [{ arrow: home, owner: A }],
        },
      );

      const after = table.rules.apply(before, step(ourIn, ourExit, 1));

      expect(isTrail(after, A, mid)).toBe(true);
      expect(headsOn(after, mid)).toBe(1);
      expect(isTrail(after, A, tip)).toBe(true);
    },
  );
});

describe('P42 — head count is conserved across a claim that paints occupied arrows', () => {
  it('keeps the same total heads after a stack-grade landing through a sentry', () => {
    // The system SHALL preserve total head count across a claim that paints occupied arrows.
    const table = onTiling();
    for (const length of [3, 4, 5] as const) {
      const { fire, tip, landing, before } = aStackGradeSpine(table, length);
      const heads = totalHeads(before);
      const after = table.rules.apply(before, step(tip, landing, 1));
      expect(totalHeads(after)).toBe(heads);
      expect(headsOn(after, fire)).toBe(1);
      expect(headsOn(after, landing)).toBe(1);
    }
  });
});

describe('P42 — claim walk is ordered by compareArrows, not insertion order', () => {
  it('returns the same compareArrows-sorted path for reversed trail insertion', () => {
    // SHALL NOT consult Date, Math.random, or insertion order; walk result ordered by compareArrows.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 4);
    const fire = arrowAt(run, 0);
    const mid = arrowAt(run, 1);
    const tip = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, tip);
    const distal = pick(
      table.geometry.inArrows(table.geometry.origin(fire)).filter((a) => a !== home && a !== fire),
      0,
    );
    const arrows = [fire, mid, tip, distal];
    const placements = [
      { arrow: fire, owner: A, heads: 1 },
      { arrow: tip, owner: A, heads: 1 },
    ] as const;
    const groundFor = (trail: readonly ArrowId[]) => ({
      trail: { A: trail },
      territory: owned([landing], A),
    });
    const forward = stateOf(placements, A, groundFor(arrows));
    const reversed = stateOf(placements, A, groundFor([...arrows].toReversed()));
    const move = step(tip, landing, 1);

    const left = table.rules.closureOf(forward, move, A);
    const right = table.rules.closureOf(reversed, move, A);
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (left === undefined || right === undefined) return;

    expect(claimKeys(left).path).toEqual(claimKeys(right).path);
    expect(left.path).toEqual([...left.path].toSorted(compareArrows));
    expect(right.path).toEqual([...right.path].toSorted(compareArrows));
    for (const arrow of arrows) {
      expect(left.path.map(String)).toContain(String(arrow));
    }
  });
});

describe('P22 — conversion predicate (territory-grade only)', () => {
  it('protects territory-grade and converts stack-grade inside enemy land', () => {
    // WHILE continuous own-trail path to own territory, SHALL NOT convert by encirclement alone.
    // IF no such path and inside enemy territory, THEN SHALL convert.
    const table = onBoard();

    const bHome = anArrow(table.geometry);
    const path = pathFrom(table.geometry, anExitFrom(table.geometry, bHome), 3);
    const protectedTip = arrowAt(path, 2);
    const stretch = [arrowAt(path, 0), arrowAt(path, 1), protectedTip];
    const mover = anExitFrom(table.geometry, protectedTip);
    // Ensure mover is on A's land and not colliding with B's stretch.
    const protectedState = stateOf(
      [
        { arrow: protectedTip, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: stretch },
        territory: [
          { arrow: bHome, owner: B },
          { arrow: protectedTip, owner: A },
          { arrow: mover, owner: A },
        ],
      },
    );
    if (table.rules.anchorGrade(protectedState, protectedTip, B) === 'territory') {
      const after = table.rules.apply(
        protectedState,
        step(mover, anExitFrom(table.geometry, mover), 1),
      );
      expect(after.groups.get(protectedTip)?.owner).toBe(B);
    }

    const tip = pick(table.geometry.inArrows(table.geometry.seedPoint()), 0);
    const stem = anExitFrom(table.geometry, tip);
    const aMover = anExitFrom(table.geometry, stem);
    const exposed: GameState = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: aMover, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: [tip, stem] },
        territory: [
          { arrow: tip, owner: A },
          { arrow: aMover, owner: A },
        ],
      },
    );
    expect(table.rules.anchorGrade(exposed, tip, B)).toBe('stack');
    const converted = table.rules.apply(
      exposed,
      step(aMover, anExitFrom(table.geometry, aMover), 1),
    );
    expect(converted.groups.get(tip)?.owner).toBe(A);
    expect(headsOn(converted, tip)).toBe(1);
  });
});

const aStackGradeSpine = (
  table: ReturnType<typeof onTiling>,
  length: 3 | 4 | 5,
): {
  readonly fire: ArrowId;
  readonly run: readonly ArrowId[];
  readonly tip: ArrowId;
  readonly landing: ArrowId;
  readonly before: GameState;
} => {
  const { run } = aRunFromHome(table.geometry, length);
  const fire = arrowAt(run, 0);
  const tip = arrowAt(run, length - 1);
  const landing = anExitFrom(table.geometry, tip);
  const before = stateOf(
    [
      { arrow: fire, owner: A, heads: 1 },
      { arrow: tip, owner: A, heads: 1 },
    ],
    A,
    {
      trail: { A: [...run] },
      territory: owned([landing], A),
    },
  );
  return { fire, run, tip, landing, before };
};
