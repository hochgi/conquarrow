/**
 * docs/spec/encircled-path/encircled-path.edge-cases.feature — one test per scenario.
 *
 * @see docs/spec/encircled-path/encircled-path.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import {
  A,
  B,
  SPACIOUS,
  SPACIOUS_DIAMETER,
  aRunFromHome,
  allArrows,
  anArrow,
  anExitFrom,
  arrowAt,
  exitsFrom,
  headsOn,
  isTrail,
  onBoard,
  onTiling,
  owned,
  ownerOf,
  pathFrom,
  pick,
  snapshot,
  spentOn,
  stateOf,
  territoryOf,
  totalHeads,
  via,
} from './support';
import type { ArrowId, GameState } from './support';

// ── Rule: Halt-at-first still bounds convert wipe ────────────────────────────

describe('halt-at-first still bounds convert wipe', () => {
  it('halts at a remaining victim stack on neutral ground', () => {
    // encircled-path.edge: "A remaining victim stack on neutral ground is a firebreak"
    const table = onBoard();
    const { converting, empty, fire, distal } = aFirebreakChain(table);
    const { from: mover, exit, before } = anUnrelatedAdvance(
      table,
      [converting, empty, fire, distal],
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
    expect(table.rules.anchorGrade(before, converting, B)).toBe('stack');
    expect(territoryOf(before, fire)).toBeUndefined();

    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(ownerOf(after, converting)).toBe(A);
    expect(isTrail(after, B, converting)).toBe(false);
    expect(isTrail(after, B, empty)).toBe(false);
    expect(ownerOf(after, fire)).toBe(B);
    expect(isTrail(after, B, fire)).toBe(true);
    expect(isTrail(after, B, distal)).toBe(true);
  });
});

// ── Rule: Unrelated trail is not convert wipe ────────────────────────────────

describe('unrelated trail is not convert wipe', () => {
  it('leaves a different territory-grade component of the same victim untouched', () => {
    // encircled-path.edge: "A different territory-grade component of the same victim is untouched"
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

    expect(ownerOf(after, tip)).toBe(A);
    expect(isTrail(after, B, tip)).toBe(false);
    expect(isTrail(after, B, stem)).toBe(false);
    for (const arrow of stretch) expect(isTrail(after, B, arrow)).toBe(true);
    expect(ownerOf(after, protectedTip)).toBe(B);
    expect(headsOn(after, protectedTip)).toBe(1);
  });

  it('leaves cut-created dormant standing when no convert runs', () => {
    // encircled-path.edge: "Cut-created dormant with no convert still stands"
    const table = onBoard();
    const path = pathFrom(table.geometry, anArrow(table.geometry), 3);
    const d0 = arrowAt(path, 0);
    const d1 = arrowAt(path, 1);
    const d2 = arrowAt(path, 2);
    const mover = anArrowAwayFrom(table, [d0, d1, d2]);
    const exit = pick(
      exitsFrom(table.geometry, mover).filter((a) => a !== d0 && a !== d1 && a !== d2),
      0,
    );
    const before = stateOf([{ arrow: mover, owner: A, heads: 1 }], A, {
      trail: { A: [d0, d1, d2] },
    });
    expect(table.rules.anchorGrade(before, d2, A)).toBe('dormant');

    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(isTrail(after, A, d0)).toBe(true);
    expect(isTrail(after, A, d1)).toBe(true);
    expect(isTrail(after, A, d2)).toBe(true);
  });
});

// ── Rule: Closure strip and convert bookkeeping still hold ───────────────────

describe('closure strip and convert bookkeeping still hold', () => {
  it('strips bare enemy trail on newly claimed tiles even with no stacks', () => {
    // encircled-path.edge: "Bare enemy trail on newly claimed tiles is stripped even with no stacks"
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const last = arrowAt(run, 1);
    const claimed = arrowAt(run, 0);
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run], B: [claimed] },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(before, step(last, landing, 1));

    expect(territoryOf(after, claimed)).toBe(A);
    expect(isTrail(after, B, claimed)).toBe(false);
  });

  it('keeps converted stacks intact with spent 0', () => {
    // encircled-path.edge: "Converted stacks stay intact with spent 0"
    const table = onBoard();
    const tip = anArrow(table.geometry);
    const distal = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, distal);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 3, spent: 1 },
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

    const after = table.rules.apply(before, step(mover, anExitFrom(table.geometry, mover), 1));

    expect(ownerOf(after, tip)).toBe(A);
    expect(headsOn(after, tip)).toBe(3);
    expect(spentOn(after, tip)).toBe(0);
  });

  it('does not convert or wipe when nobody steps', () => {
    // encircled-path.edge: "Not stepping does not convert and does not wipe"
    const table = onBoard();
    const tip = anArrow(table.geometry);
    const distal = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, distal);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
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

    // Conversion is resolved inside a step (P33). A turn in which nothing stepped
    // is a turn in which nothing converted — declining is the absence of a move.
    const after = table.rules.apply(before, endTurn());

    expect(snapshot(after).groups).toEqual(snapshot(before).groups);
    expect(snapshot(after).territory).toEqual(snapshot(before).territory);
    expect(snapshot(after).trails).toEqual(snapshot(before).trails);
    expect(ownerOf(after, tip)).toBe(B);
    expect(isTrail(after, B, tip)).toBe(true);
    expect(isTrail(after, B, distal)).toBe(true);
  });

  it('conserves heads and does not mutate its input', () => {
    // encircled-path.edge: "Convert wipe conserves heads and does not mutate its input"
    const table = onBoard();
    const tip = anArrow(table.geometry);
    const distal = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, distal);
    const s0 = stateOf(
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
    const pictured = snapshot(s0);
    const headsBefore = totalHeads(s0);
    const move = step(mover, anExitFrom(table.geometry, mover), 1);

    const s1 = table.rules.apply(s0, move);

    expect(totalHeads(s1)).toBe(headsBefore);
    expect(snapshot(s0)).toEqual(pictured);
    expect(snapshot(table.rules.apply(structuredCloneState(s0), move)).trails).toEqual(
      snapshot(s1).trails,
    );
  });
});

const pointsOf = (
  table: ReturnType<typeof onBoard>,
  arrows: readonly ArrowId[],
): ReadonlySet<string> =>
  new Set(arrows.flatMap((a) => [String(table.geometry.origin(a)), String(table.geometry.target(a))]));

const anArrowAwayFrom = (
  table: ReturnType<typeof onBoard>,
  avoid: readonly ArrowId[],
): ArrowId => {
  const blocked = new Set(avoid.map(String));
  for (const a of allArrows(table.geometry, 2)) {
    if (!blocked.has(String(a))) return a;
  }
  throw new Error('setup: no arrow away from the avoid set');
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

/** An A step that does not land on `blocked`, does not fight B, and does not cut B's trail. */
const anUnrelatedAdvance = (
  table: ReturnType<typeof onBoard>,
  blocked: readonly ArrowId[],
  occupancyAndGround: (from: ArrowId, exit: ArrowId) => GameState,
): { from: ArrowId; exit: ArrowId; before: GameState } => {
  const blockedSet = new Set(blocked.map(String));
  for (const from of allArrows(table.geometry, 2)) {
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

/** Structural clone of authored state so a second apply is not the same object. */
const structuredCloneState = (state: GameState): GameState => ({
  ...state,
  groups: new Map(state.groups),
  trails: new Map([...state.trails].map(([player, arrows]) => [player, new Set(arrows)])),
  territory: new Map(state.territory),
  accumulators: new Map(state.accumulators),
  spawners: new Map(state.spawners),
});
