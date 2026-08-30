/**
 * EARS invariants from docs/spec/encircled-path/encircled-path.md as properties.
 *
 * Deterministic enumeration over fixture boards — no PRNG (ADR 0001).
 *
 * @see docs/spec/encircled-path/encircled-path.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL,
  MINIMAL_DIAMETER,
  SPACIOUS,
  SPACIOUS_DIAMETER,
  allArrows,
  anArrow,
  anExitFrom,
  arrowAt,
  exitsFrom,
  headsOn,
  isTrail,
  onBoard,
  owned,
  ownerOf,
  pathFrom,
  pick,
  slotsAt,
  snapshot,
  stateOf,
  territoryOf,
  totalHeads,
  trailOf,
  via,
} from './support';
import type { ArrowId, GameState } from './support';
import { replay } from '../src/replay';

const BOARDS = [
  { name: 'minimal', description: MINIMAL, diameter: MINIMAL_DIAMETER },
  { name: 'spacious', description: SPACIOUS, diameter: SPACIOUS_DIAMETER },
] as const;

describe('P33 — convert evaporates victim trail from converted arrows', () => {
  it.each(BOARDS)(
    'leaves no victim trail on a converted stack-grade raider’s arrows on $name',
    ({ description }) => {
      const table = onBoard(description);
      const { tip, distal, mover, exit, before } = aRaider(table);
      expect(table.rules.anchorGrade(before, tip, B)).toBe('stack');

      const after = table.rules.apply(before, step(mover, exit, 1));

      expect(ownerOf(after, tip)).toBe(A);
      expect(isTrail(after, B, tip)).toBe(false);
      expect(isTrail(after, B, distal)).toBe(false);
    },
  );
});

describe('P33 — two converting stacks leave no connecting victim trail', () => {
  it.each(BOARDS)('clears the arrows that connected them on $name', ({ description }) => {
    const table = onBoard(description);
    const path = pathFrom(table.geometry, anArrow(table.geometry), 3);
    const first = arrowAt(path, 0);
    const mid = arrowAt(path, 1);
    const second = arrowAt(path, 2);
    const { from: mover, exit, before } = anUnrelatedAdvance(table, path, 2, (from, dest) =>
      stateOf(
        [
          { arrow: first, owner: B, heads: 1 },
          { arrow: second, owner: B, heads: 1 },
          { arrow: from, owner: A, heads: 1 },
        ],
        A,
        {
          trail: { B: [first, mid, second] },
          territory: owned([first, mid, second, from, dest], A),
        },
      ),
    );

    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(ownerOf(after, first)).toBe(A);
    expect(ownerOf(after, second)).toBe(A);
    expect(isTrail(after, B, first)).toBe(false);
    expect(isTrail(after, B, second)).toBe(false);
    expect(isTrail(after, B, mid)).toBe(false);
  });
});

describe('P33 — converted stacks are not victim firebreaks', () => {
  it.each(BOARDS)(
    'does not halt convert wipe at a stack that just flipped owner on $name',
    ({ description }) => {
      const table = onBoard(description);
      const path = pathFrom(table.geometry, anArrow(table.geometry), 3);
      const first = arrowAt(path, 0);
      const mid = arrowAt(path, 1);
      const second = arrowAt(path, 2);
      const { from: mover, exit, before } = anUnrelatedAdvance(table, path, 2, (from, dest) =>
        stateOf(
          [
            { arrow: first, owner: B, heads: 2 },
            { arrow: second, owner: B, heads: 2 },
            { arrow: from, owner: A, heads: 1 },
          ],
          A,
          {
            trail: { B: [first, mid, second] },
            territory: owned([first, mid, second, from, dest], A),
          },
        ),
      );

      const after = table.rules.apply(before, step(mover, exit, 1));

      expect(ownerOf(after, first)).toBe(A);
      expect(ownerOf(after, second)).toBe(A);
      expect(isTrail(after, B, mid)).toBe(false);
    },
  );
});

describe('P33 — remaining victim stack on neutral is a firebreak', () => {
  it.each(BOARDS)('halts convert wipe at that stack and leaves distal trail on $name', ({ description }) => {
    const table = onBoard(description);
    const { converting, empty, fire, distal } = aFirebreakChain(table);
    const { from: mover, exit, before } = anUnrelatedAdvance(
      table,
      [converting, empty, fire, distal],
      2,
      (from, dest) =>
        stateOf(
          [
            { arrow: converting, owner: B, heads: 1 },
            { arrow: fire, owner: B, heads: 1 },
            { arrow: from, owner: A, heads: 1 },
          ],
          A,
          {
            trail: { B: [converting, empty, fire, distal] },
            territory: [
              { arrow: converting, owner: A },
              { arrow: from, owner: A },
              { arrow: dest, owner: A },
            ],
          },
        ),
    );
    expect(territoryOf(before, fire)).toBeUndefined();

    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(isTrail(after, B, converting)).toBe(false);
    expect(isTrail(after, B, empty)).toBe(false);
    expect(ownerOf(after, fire)).toBe(B);
    expect(isTrail(after, B, fire)).toBe(true);
    expect(isTrail(after, B, distal)).toBe(true);
  });
});

describe('P33 — unrelated territory-grade component is untouched', () => {
  it('does not evaporate a separate territory-grade trail of the same victim', () => {
    const table = onBoard(SPACIOUS);
    const tip = anArrow(table.geometry);
    const stem = anExitFrom(table.geometry, tip);
    const reserved = [tip, stem];
    const homePath = aPointDisjointPath(table, reserved, 3);
    const protectedTip = arrowAt(homePath, 2);
    const stretch = [arrowAt(homePath, 0), arrowAt(homePath, 1), protectedTip];
    const feeder = aTerritoryFeeder(table, stretch, reserved);
    const { from: mover, exit, before } = anUnrelatedAdvance(
      table,
      [...reserved, ...stretch, feeder, protectedTip],
      SPACIOUS_DIAMETER,
      (from, dest) =>
        stateOf(
          [
            { arrow: tip, owner: B, heads: 1 },
            { arrow: protectedTip, owner: B, heads: 1 },
            { arrow: from, owner: A, heads: 1 },
          ],
          A,
          {
            trail: { B: [tip, stem, ...stretch] },
            territory: [
              { arrow: tip, owner: A },
              { arrow: from, owner: A },
              { arrow: dest, owner: A },
              { arrow: protectedTip, owner: A },
              { arrow: feeder, owner: B },
            ],
          },
        ),
    );
    expect(table.rules.anchorGrade(before, tip, B)).toBe('stack');
    expect(table.rules.anchorGrade(before, protectedTip, B)).toBe('territory');

    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(isTrail(after, B, tip)).toBe(false);
    expect(isTrail(after, B, stem)).toBe(false);
    for (const arrow of stretch) expect(isTrail(after, B, arrow)).toBe(true);
    expect(ownerOf(after, protectedTip)).toBe(B);
  });
});

describe('P33 — cut-created dormant that no wipe reached still stands', () => {
  it.each(BOARDS)('keeps a point-disjoint dormant tail after convert on $name', ({ description, diameter }) => {
    const table = onBoard(description);
    const tip = anArrow(table.geometry);
    const distal = anExitFrom(table.geometry, tip);
    const tail = aPointDisjointArrow(table, [tip, distal], diameter);
    const { from: mover, exit, before } = anUnrelatedAdvance(
      table,
      [tip, distal, tail],
      diameter,
      (from, dest) =>
        stateOf(
          [
            { arrow: tip, owner: B, heads: 1 },
            { arrow: from, owner: A, heads: 1 },
          ],
          A,
          {
            trail: { B: [tip, distal, tail] },
            territory: [
              { arrow: tip, owner: A },
              { arrow: distal, owner: A },
              { arrow: from, owner: A },
              { arrow: dest, owner: A },
            ],
          },
        ),
    );

    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(isTrail(after, B, tip)).toBe(false);
    expect(isTrail(after, B, distal)).toBe(false);
    expect(isTrail(after, B, tail)).toBe(true);
    expect(table.rules.anchorGrade(after, tail, B)).toBe('dormant');
  });
});

describe('P33 — a converted fork evaporates both arms', () => {
  it.each(BOARDS)('clears stem and both outs on $name', ({ description, diameter }) => {
    const table = onBoard(description);
    const { ins, outs } = slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));
    const stem = pick(ins, 0);
    const arm0 = pick(outs, 0);
    const arm1 = pick(outs, 1);
    const fork = [stem, arm0, arm1] as const;
    const { from: mover, exit, before } = anUnrelatedAdvance(table, fork, diameter, (from, dest) =>
      stateOf(
        [
          { arrow: stem, owner: B, heads: 1 },
          { arrow: from, owner: A, heads: 1 },
        ],
        A,
        {
          trail: { B: [...fork] },
          territory: owned([...fork, from, dest], A),
        },
      ),
    );

    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(isTrail(after, B, stem)).toBe(false);
    expect(isTrail(after, B, arm0)).toBe(false);
    expect(isTrail(after, B, arm1)).toBe(false);
  });
});

describe('P33 — convert wipe conserves heads, is pure, and is deterministic', () => {
  it.each(BOARDS)('preserves head sum, input, and trail maps on $name', ({ description }) => {
    const table = onBoard(description);
    const { mover, exit, before: s0 } = aRaider(table);
    const pictured = snapshot(s0);
    const headsBefore = totalHeads(s0);
    const move = step(mover, exit, 1);

    const s1 = table.rules.apply(s0, move);

    expect(totalHeads(s1)).toBe(headsBefore);
    expect(snapshot(s0)).toEqual(pictured);
    expect(snapshot(table.rules.apply(cloneState(s0), move)).trails).toEqual(snapshot(s1).trails);
  });
});

describe('P33 — not stepping does not convert or wipe', () => {
  it.each(BOARDS)('returns the authored encircled state unchanged on $name', ({ description }) => {
    const table = onBoard(description);
    const { tip, distal, before } = aRaider(table);

    // Nothing steps, so nothing converts: the seat simply ends its turn.
    const after = table.rules.apply(before, endTurn());

    expect(snapshot(after).groups).toEqual(snapshot(before).groups);
    expect(snapshot(after).territory).toEqual(snapshot(before).territory);
    expect(snapshot(after).trails).toEqual(snapshot(before).trails);
    expect(ownerOf(after, tip)).toBe(B);
    expect(isTrail(after, B, distal)).toBe(true);
  });
});

describe('P33 replay — convert a stack-grade raider with distal trail', () => {
  it('replays one converting step to a victim trail with no connected empty arrows', () => {
    const table = onBoard();
    const { tip, distal, mover, exit, before } = aRaider(table);
    const final = replay(table.rules, before, [step(mover, exit, 1)]);

    expect(ownerOf(final, tip)).toBe(A);
    expect(headsOn(final, tip)).toBe(headsOn(before, tip));
    expect(isTrail(final, B, tip)).toBe(false);
    expect(isTrail(final, B, distal)).toBe(false);
    expect(trailOf(final, B)).toEqual([]);
  });
});

const aRaider = (
  table: ReturnType<typeof onBoard>,
): {
  readonly tip: ArrowId;
  readonly distal: ArrowId;
  readonly mover: ArrowId;
  readonly exit: ArrowId;
  readonly before: GameState;
} => {
  const tip = anArrow(table.geometry);
  const distal = anExitFrom(table.geometry, tip);
  const mover = anExitFrom(table.geometry, distal);
  const exit = anExitFrom(table.geometry, mover);
  const before = stateOf(
    [
      { arrow: tip, owner: B, heads: 2 },
      { arrow: mover, owner: A, heads: 1 },
    ],
    A,
    {
      trail: { B: [tip, distal] },
      territory: [
        { arrow: tip, owner: A },
        { arrow: distal, owner: A },
        { arrow: mover, owner: A },
      ],
    },
  );
  return { tip, distal, mover, exit, before };
};

const aFirebreakChain = (
  table: ReturnType<typeof onBoard>,
): {
  readonly converting: ArrowId;
  readonly empty: ArrowId;
  readonly fire: ArrowId;
  readonly distal: ArrowId;
} => {
  for (const start of allArrows(table.geometry, 2)) {
    try {
      const path = pathFrom(table.geometry, start, 4);
      const converting = arrowAt(path, 0);
      const empty = arrowAt(path, 1);
      const fire = arrowAt(path, 2);
      const distal = arrowAt(path, 3);
      const back = table.geometry.inArrows(table.geometry.origin(converting));
      if (back.includes(fire) || back.includes(distal)) continue;
      const forward = table.geometry.outArrows(table.geometry.target(converting));
      if (forward.includes(fire) || forward.includes(distal)) continue;
      return { converting, empty, fire, distal };
    } catch {
      continue;
    }
  }
  throw new Error('setup: no halt-at-first convert-wipe chain');
};

const pointsOf = (
  table: ReturnType<typeof onBoard>,
  arrows: readonly ArrowId[],
): ReadonlySet<string> =>
  new Set(arrows.flatMap((a) => [String(table.geometry.origin(a)), String(table.geometry.target(a))]));

const aPointDisjointArrow = (
  table: ReturnType<typeof onBoard>,
  reserved: readonly ArrowId[],
  diameter: number,
): ArrowId => {
  const blockedPoints = pointsOf(table, reserved);
  for (const a of allArrows(table.geometry, diameter)) {
    if (reserved.includes(a)) continue;
    if (
      !blockedPoints.has(String(table.geometry.origin(a))) &&
      !blockedPoints.has(String(table.geometry.target(a)))
    ) {
      return a;
    }
  }
  throw new Error('setup: no point-disjoint dormant arrow');
};

const aPointDisjointPath = (
  table: ReturnType<typeof onBoard>,
  reserved: readonly ArrowId[],
  length: number,
): readonly ArrowId[] => {
  const blockedPoints = pointsOf(table, reserved);
  const sharesPoint = (a: ArrowId): boolean =>
    blockedPoints.has(String(table.geometry.origin(a))) ||
    blockedPoints.has(String(table.geometry.target(a)));
  for (const start of allArrows(table.geometry, SPACIOUS_DIAMETER)) {
    if (sharesPoint(start)) continue;
    try {
      const path = pathFrom(table.geometry, start, length, reserved);
      if (path.some(sharesPoint)) continue;
      return path;
    } catch {
      continue;
    }
  }
  throw new Error('setup: no point-disjoint path');
};

const aTerritoryFeeder = (
  table: ReturnType<typeof onBoard>,
  stretch: readonly ArrowId[],
  reserved: readonly ArrowId[],
): ArrowId => {
  const start = arrowAt(stretch, 0);
  const avoid = new Set([...reserved, ...stretch].map(String));
  const feeder = table.geometry
    .inArrows(table.geometry.origin(start))
    .find((a) => !avoid.has(String(a)));
  if (feeder === undefined) throw new Error('setup: no territory feeder into the protected stretch');
  return feeder;
};

const anUnrelatedAdvance = (
  table: ReturnType<typeof onBoard>,
  blocked: readonly ArrowId[],
  diameter: number,
  occupancyAndGround: (from: ArrowId, exit: ArrowId) => GameState,
): { from: ArrowId; exit: ArrowId; before: GameState } => {
  const blockedSet = new Set(blocked.map(String));
  for (const from of allArrows(table.geometry, diameter)) {
    if (blockedSet.has(String(from))) continue;
    for (const exit of exitsFrom(table.geometry, from)) {
      if (from === exit || blockedSet.has(String(exit))) continue;
      const before = occupancyAndGround(from, exit);
      if (before.groups.get(from)?.owner !== A) continue;
      const standing = before.groups.get(exit);
      if (standing !== undefined && standing.owner !== A) continue;
      if (table.rules.crossesTrail(before, via(from, exit), B)) continue;
      return { from, exit, before };
    }
  }
  throw new Error("setup: no unrelated advance that avoids B's trail");
};

const cloneState = (state: GameState): GameState => ({
  ...state,
  groups: new Map(state.groups),
  trails: new Map([...state.trails].map(([player, arrows]) => [player, new Set(arrows)])),
  territory: new Map(state.territory),
  accumulators: new Map(state.accumulators),
  spawners: new Map(state.spawners),
});
