/**
 * docs/spec/trails-simple — one component test per Gherkin scenario (core + edge).
 *
 * P22 beta: free branching, legal dormant, no size-1 freeze, convert wipe (P33).
 * P42: the against-grain claim walk ignores firebreaks (occupied trail is
 * painted; evaporation still halt-at-first).
 *
 * @see docs/spec/trails-simple/trails-simple.md
 * @see docs/spec/trails-simple/trails-simple.core.feature
 * @see docs/spec/trails-simple/trails-simple.edge-cases.feature
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId, step } from '@conquarrow/contracts';
import type { GeometryPort, PlayerId } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  SPACIOUS,
  aRingWithAnInside,
  aRunFromHome,
  allArrows,
  anExitFrom,
  anInterleaving,
  arrowAt,
  headsOn,
  isTrail,
  onBoard,
  onTiling,
  owned,
  pathFrom,
  pick,
  slotsAt,
  stateOf,
  territoryOf,
  trailOf,
} from './support';
import type { ArrowId } from './support';

// ── Core: Branching costs nothing ────────────────────────────────────────────

describe('P22 core — branching costs nothing', () => {
  it('lets a lone head create a split', () => {
    // trails-simple.core: "A lone head may create a split"
    const table = onBoard();
    const { ins, outs } = slotsAt(table.geometry, table.geometry.target(anExitFrom(
      table.geometry,
      pick(table.geometry.inArrows(table.geometry.seedPoint()), 0),
    )));
    const t1 = pick(ins, 0);
    const firstOut = pick(outs, 0);
    const t2 = pick(outs, 1);
    const home = pick(table.geometry.inArrows(table.geometry.origin(t1)), 0);
    const before = stateOf([{ arrow: t1, owner: A, heads: 1 }], A, {
      trail: { A: [t1, firstOut] },
      territory: [{ arrow: home, owner: A }],
    });

    const after = table.rules.apply(before, step(t1, t2, 1));

    expect(headsOn(after, t1)).toBe(0);
    expect(headsOn(after, t2)).toBe(1);
    expect(isTrail(after, A, firstOut)).toBe(true);
    expect(isTrail(after, A, t2)).toBe(true);
  });

  it('lets a join vacate the last in-arrow head', () => {
    // trails-simple.core: "A join may vacate the last in-arrow head"
    const table = onBoard();
    const { ins, outs } = slotsAt(table.geometry, table.geometry.target(anExitFrom(
      table.geometry,
      pick(table.geometry.inArrows(table.geometry.seedPoint()), 0),
    )));
    const i1 = pick(ins, 0);
    const i2 = pick(ins, 1);
    const onward = pick(outs, 0);
    const before = stateOf([{ arrow: i1, owner: A, heads: 1 }], A, {
      trail: { A: [i1, i2, onward] },
    });

    const after = table.rules.apply(before, step(i1, onward, 1));

    expect(headsOn(after, i1)).toBe(0);
    expect(isTrail(after, A, i1)).toBe(true);
    expect(headsOn(after, onward)).toBe(1);
  });

  it('permits unlimited successive forks without sentries', () => {
    // trails-simple.core: "Unlimited successive forks"
    const table = onBoard();
    const seed = table.geometry.seedPoint();
    const start = pick(table.geometry.outArrows(seed), 0);
    let state = stateOf([{ arrow: start, owner: A, heads: 3 }], A, {
      trail: { A: [start] },
    });

    for (let i = 0; i < 3; i += 1) {
      const tip = [...state.groups.entries()].find(([, g]) => g.owner === A && g.heads > 0);
      if (tip === undefined) throw new Error('setup: lost A stack mid-fork sequence');
      const [from, group] = tip;
      const point = table.geometry.target(from);
      const outs = table.geometry.outArrows(point);
      const marked = state.trails.get(A) ?? new Set();
      const fresh = outs.find((o) => !marked.has(o));
      const exit = fresh ?? pick(outs, 0);
      state = table.rules.apply(state, step(from, exit, Math.min(1, group.heads)));
      expect(isTrail(state, A, exit)).toBe(true);
    }

    expect(trailOf(state, A).length).toBeGreaterThanOrEqual(3);
  });
});

// ── Core: Dormant marks persist ──────────────────────────────────────────────

describe('P22 core — dormant marks persist', () => {
  it('leaves headless trail when a tip vacates', () => {
    // trails-simple.core: "Vacating a tip leaves headless trail"
    // Soft "may be dormant" only if Tip no longer reaches a stack — after a linear
    // step onto `next`, Tip still reaches the stack on `next`, so grade stays stack.
    const table = onBoard();
    const tip = pick(table.geometry.outArrows(table.geometry.seedPoint()), 0);
    const next = anExitFrom(table.geometry, tip);
    const before = stateOf([{ arrow: tip, owner: A, heads: 1 }], A, {
      trail: { A: [tip] },
    });
    expect(table.rules.anchorGrade(before, tip, A)).toBe('stack');

    const after = table.rules.apply(before, step(tip, next, 1));

    expect(isTrail(after, A, tip)).toBe(true);
    expect(isTrail(after, A, next)).toBe(true);
    expect(headsOn(after, tip)).toBe(0);
    expect(headsOn(after, next)).toBe(1);
  });

  it('evaporates between cut and firebreaks; distal marks remain', () => {
    // trails-simple.core: "Cut evaporates between cut and firebreaks; distal marks remain"
    // Unchanged P13 halt-at-first — regression guard for the beta.
    const table = onBoard();
    const { trailIn, trailOut: mid, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
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
    expect(isTrail(after, A, tip)).toBe(true);
    expect(headsOn(after, mid)).toBe(1);
  });
});

// ── Core: Land on territory paints the full against-grain walk ───────────────

describe('P22 core — land on territory paints the full against-grain walk', () => {
  it('claims the full path on a territory-rooted land bridge', () => {
    // trails-simple.core: "Territory-rooted land bridge claims the full path"
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(before, step(last, landing, 1));

    for (const arrow of run) expect(territoryOf(after, arrow)).toBe(A);
    expect(trailOf(after, A)).toEqual([]);
  });

  it('fills the pocket on a territory-rooted closed path', () => {
    // trails-simple.core: "Territory-rooted closed path fills the pocket"
    const table = onTiling();
    const ring = aRingWithAnInside(table.geometry);
    const tip = arrowAt(ring.wall, 5);
    const landing = anExitFrom(table.geometry, tip);
    const home = arrowAt(ring.wall, 0);
    const before = stateOf([{ arrow: tip, owner: A, heads: 1 }], A, {
      trail: { A: ring.wall },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(before, step(tip, landing, 1));

    for (const arrow of ring.wall) expect(territoryOf(after, arrow)).toBe(A);
    expect(territoryOf(after, ring.inside)).toBe(A);
  });

  it('claims the full walk including the sentry when a stack-grade tip lands home', () => {
    // trails-simple.core: "Stack-grade tip lands home — full walk including the sentry"
    const table = onTiling();
    const { fire, mid, tip, landing, before } = aStackGradeWithSentry(table, false);
    expect(table.rules.anchorGrade(before, tip, A)).toBe('stack');
    expect(table.rules.anchorGrade(before, fire, A)).not.toBe('territory');

    const after = table.rules.apply(before, step(tip, landing, 1));

    expect(territoryOf(after, tip)).toBe(A);
    expect(territoryOf(after, mid)).toBe(A);
    expect(territoryOf(after, fire), 'firebreak sentry').toBe(A);
    expect(isTrail(after, A, fire)).toBe(false);
    expect(headsOn(after, fire)).toBe(1);
    expect(ownerOfHeads(after, fire)).toBe(A);
  });
});

// ── Edge: No size-1 freeze ───────────────────────────────────────────────────

describe('P22 edge — no size-1 freeze', () => {
  it('offers a grain step that vacates a sole stack-grade tip', () => {
    // trails-simple.edge: "Sole stack-grade tip may vacate"
    const table = onBoard();
    const tip = pick(table.geometry.outArrows(table.geometry.seedPoint()), 0);
    const next = anExitFrom(table.geometry, tip);
    const before = stateOf([{ arrow: tip, owner: A, heads: 1, spent: 0 }], A, {
      trail: { A: [tip, next] },
    });
    expect(table.rules.anchorGrade(before, tip, A)).toBe('stack');

    const steps = table.rules
      .legalMoves(before)
      .filter((m) => m.kind === 'step' && m.from === tip && m.count === 1);

    expect(steps.length).toBeGreaterThan(0);
  });
});

// ── Edge: Convert wipe evaporates connected empty trail (P33) ────────────────

describe('P33 edge — convert wipe evaporates connected empty trail', () => {
  it('evaporates connected empty trail and leaves a disconnected cut tail', () => {
    // trails-simple.edge: "Converted stack's connected empty trail evaporates; a disconnected cut tail stands"
    const table = onBoard(SPACIOUS);
    const tip = anArrowOn(table);
    const distal = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, distal);
    const tail = aPointDisjointArrow(table, [tip, distal, mover]);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 2 },
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
    expect(table.rules.anchorGrade(before, tip, B)).toBe('stack');

    const exit = anExitFrom(table.geometry, mover);
    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(ownerOfHeads(after, tip)).toBe(A);
    expect(headsOn(after, tip)).toBe(2);
    expect(isTrail(after, B, tip)).toBe(false);
    expect(isTrail(after, B, distal)).toBe(false);
    expect(isTrail(after, B, tail)).toBe(true);
    expect(table.rules.anchorGrade(after, tail, B)).toBe('dormant');
  });
});

// ── Edge: Claim walk ignores firebreaks (P42) ────────────────────────────────

describe('P42 edge — claim walk ignores firebreaks', () => {
  it('paints through the sentry and the distal tail when an unanchored tip lands home', () => {
    // trails-simple.edge: "Unanchored tip lands home — paint continues through the sentry"
    const table = onTiling();
    const { fire, mid, tip, distal, landing, before } = aStackGradeWithSentry(table, true);
    expect(table.rules.anchorGrade(before, tip, A)).toBe('stack');
    expect(table.rules.anchorGrade(before, fire, A)).not.toBe('territory');

    const after = table.rules.apply(before, step(tip, landing, 1));

    expect(territoryOf(after, tip)).toBe(A);
    expect(territoryOf(after, mid)).toBe(A);
    expect(territoryOf(after, fire), 'firebreak sentry').toBe(A);
    expect(territoryOf(after, distal), 'distal beyond fire').toBe(A);
    expect(isTrail(after, A, fire)).toBe(false);
    expect(isTrail(after, A, distal)).toBe(false);
    expect(headsOn(after, fire)).toBe(1);
    expect(ownerOfHeads(after, fire)).toBe(A);
  });

  it('claims the full walk including a mid sentry when territory-rooted', () => {
    // trails-simple.edge: "Territory-rooted tip lands — full walk including a mid sentry"
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const mid = arrowAt(run, 0);
    const tip = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, tip);
    const before = stateOf(
      [
        { arrow: mid, owner: A, heads: 1 },
        { arrow: tip, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { A: [...run] },
        territory: owned([home, landing], A),
      },
    );
    expect(table.rules.anchorGrade(before, tip, A)).toBe('territory');

    const after = table.rules.apply(before, step(tip, landing, 1));

    for (const arrow of run) expect(territoryOf(after, arrow)).toBe(A);
    expect(isTrail(after, A, mid)).toBe(false);
    expect(headsOn(after, mid)).toBe(1);
  });

  it('claims the sentry and the tail on the six-arrow playtest spine', () => {
    // trails-simple.edge: "Playtest spine — six-arrow stack-grade landing claims the sentry and the tail"
    // conquarrow-match-2026-08-23T181014-387Z seat F:
    // 2,-2,0 → 3,-2,2 → 3,-3,2 (F×1) → 3,-4,0 → 4,-4,2 → 4,-5,0 landing 5,-5,0
    const table = onTiling();
    const { spine, t3, t6, landing } = playtestSpine(table.geometry);
    const before = stateOf(
      [
        { arrow: t3, owner: A, heads: 1 },
        { arrow: t6, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { A: [...spine] },
        territory: owned([landing], A),
      },
    );
    expect(table.rules.anchorGrade(before, t6, A)).not.toBe('territory');
    expect(spine).toHaveLength(6);

    const after = table.rules.apply(before, step(t6, landing, 1));

    // Prefix the old cap paints (T4–T6), then the sentry and tail it skips (T3–T1).
    expect(territoryOf(after, t6), 'T6 closing tip').toBe(A);
    expect(territoryOf(after, arrowAt(spine, 4)), 'T5').toBe(A);
    expect(territoryOf(after, arrowAt(spine, 3)), 'T4').toBe(A);
    expect(territoryOf(after, t3), 'T3 sentry').toBe(A);
    expect(territoryOf(after, arrowAt(spine, 1)), 'T2').toBe(A);
    expect(territoryOf(after, arrowAt(spine, 0)), 'T1 tail').toBe(A);
    for (const arrow of spine) expect(isTrail(after, A, arrow)).toBe(false);
    expect(headsOn(after, t3)).toBe(1);
    expect(ownerOfHeads(after, t3)).toBe(A);
    expect(headsOn(after, landing)).toBe(1);
    expect(ownerOfHeads(after, landing)).toBe(A);
  });

  it('claims the upstream fork arm including a sentry; the other arm stays trail', () => {
    // trails-simple.edge: "Fork — landing claims the upstream arm including a sentry; the other arm stays trail"
    const table = onTiling();
    const { stem, fire, tip, armY, landing, before } = aStackGradeFork(table);
    expect(table.rules.anchorGrade(before, tip, A)).toBe('stack');

    const after = table.rules.apply(before, step(tip, landing, 1));

    expect(territoryOf(after, tip)).toBe(A);
    expect(isTrail(after, A, armY)).toBe(true);
    expect(territoryOf(after, armY)).toBeUndefined();
    expect(territoryOf(after, fire), 'sentry on arm X').toBe(A);
    expect(territoryOf(after, stem), 'stem upstream of the sentry').toBe(A);
    expect(isTrail(after, A, fire)).toBe(false);
    expect(headsOn(after, fire)).toBe(1);
  });

  it('claims every merge in-arrow on the walk, occupied or not', () => {
    // trails-simple.edge: "Merge — every in-arrow on the walk is claimed, occupied or not"
    const table = onTiling();
    const { i1, i2, onward, landing, before } = aStackGradeMerge(table);
    expect(table.rules.anchorGrade(before, onward, A)).toBe('stack');

    const after = table.rules.apply(before, step(onward, landing, 1));

    expect(territoryOf(after, i2), 'empty merge in-arrow').toBe(A);
    expect(territoryOf(after, i1), 'occupied merge in-arrow').toBe(A);
    expect(isTrail(after, A, i1)).toBe(false);
    expect(isTrail(after, A, i2)).toBe(false);
    expect(headsOn(after, i1)).toBe(1);
    expect(ownerOfHeads(after, i1)).toBe(A);
  });

  it('claims the full walk of an unanchored empty trail with no mid sentry', () => {
    // trails-simple.edge: "Unanchored empty trail — no mid sentry, full walk unchanged"
    const table = onTiling();
    const { run } = aRunFromHome(table.geometry, 3);
    const tip = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, tip);
    const before = stateOf([{ arrow: tip, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([landing], A),
    });
    expect(table.rules.anchorGrade(before, tip, A)).toBe('stack');

    const after = table.rules.apply(before, step(tip, landing, 1));

    for (const arrow of run) {
      expect(territoryOf(after, arrow)).toBe(A);
      expect(isTrail(after, A, arrow)).toBe(false);
    }
  });
});

// ── Edge: Conversion predicate unchanged ─────────────────────────────────────

describe('P22 edge — conversion predicate unchanged', () => {
  it('does not convert a head with a territory-grade path home', () => {
    // trails-simple.edge: "Territory-grade path resists conversion"
    const table = onBoard();
    const bHome = pick(table.geometry.inArrows(table.geometry.seedPoint()), 0);
    const path = pathFrom(table.geometry, anExitFrom(table.geometry, bHome), 3);
    const tip = arrowAt(path, 2);
    const stretch = [arrowAt(path, 0), arrowAt(path, 1), tip];
    const safeHome = anArrowAwayFrom(table, [bHome, ...stretch, tip]);
    const safeExit = anExitFrom(table.geometry, safeHome);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: safeHome, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: stretch },
        territory: [
          { arrow: bHome, owner: B },
          { arrow: tip, owner: A },
          { arrow: safeHome, owner: A },
          { arrow: safeExit, owner: A },
        ],
      },
    );
    expect(table.rules.anchorGrade(before, tip, B)).toBe('territory');

    const after = table.rules.apply(before, step(safeHome, safeExit, 1));

    expect(ownerOfHeads(after, tip)).toBe(B);
  });

  it('converts an unanchored tip inside enemy territory', () => {
    // trails-simple.edge: "Unanchored tip inside enemy territory converts"
    const table = onBoard();
    const tip = pick(table.geometry.inArrows(table.geometry.seedPoint()), 0);
    const stem = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, stem);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: [tip, stem] },
        territory: [
          { arrow: tip, owner: A },
          { arrow: mover, owner: A },
        ],
      },
    );
    expect(table.rules.anchorGrade(before, tip, B)).toBe('stack');

    const after = table.rules.apply(before, step(mover, anExitFrom(table.geometry, mover), 1));

    expect(ownerOfHeads(after, tip)).toBe(A);
    expect(headsOn(after, tip)).toBe(1);
  });
});

// ── Edge: Re-attach wakes dormant marks ──────────────────────────────────────

describe('P22 edge — re-attach wakes dormant marks', () => {
  it('keeps dormant marks when a friendly head steps onto them', () => {
    // trails-simple.edge: "Friendly head steps onto dormant trail"
    // Head starts off-trail on neutral ground so the marks are truly dormant
    // (a territory feeder into the stretch would make them territory grade).
    const table = onBoard();
    const path = pathFrom(table.geometry, anArrowOn(table), 3);
    const a0 = arrowAt(path, 0);
    const a2 = arrowAt(path, 2);
    const feeder = pick(table.geometry.inArrows(table.geometry.origin(a0)), 0);
    const before = stateOf([{ arrow: feeder, owner: A, heads: 1 }], A, {
      trail: { A: [a0, arrowAt(path, 1), a2] },
    });
    expect(table.rules.anchorGrade(before, a2, A)).toBe('dormant');

    const after = table.rules.apply(before, step(feeder, a0, 1));

    expect(isTrail(after, A, a0)).toBe(true);
    expect(isTrail(after, A, a2)).toBe(true);
    expect(table.rules.anchorGrade(after, a2, A)).toBe('stack');
  });
});

// ── Edge: Wipe still evaporates ──────────────────────────────────────────────

describe('P22 edge — wipe still evaporates from emptied arrow', () => {
  it('evaporates from a combat wipe and may leave trail beyond a firebreak', () => {
    // trails-simple.edge: "Combat wipe starts evaporation; distal beyond firebreak may remain"
    const table = onBoard();
    const { trailIn, trailOut: wipe, ourIn } = anInterleaving(table.geometry, MINIMAL_DIAMETER);
    const sentry = anExitFrom(table.geometry, wipe);
    const distal = anExitFrom(table.geometry, sentry);
    const before = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 3 },
        { arrow: wipe, owner: B, heads: 1 },
        { arrow: sentry, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [ourIn], B: [trailIn, wipe, sentry, distal] },
        territory: [{ arrow: trailIn, owner: B }],
      },
    );

    const after = table.rules.apply(before, step(ourIn, wipe, 2));

    expect(isTrail(after, B, wipe)).toBe(false);
    expect(isTrail(after, B, sentry)).toBe(true);
    expect(isTrail(after, B, distal)).toBe(true);
  });
});

// ── local helpers (setup only) ───────────────────────────────────────────────

const followsGrain = (geometry: GeometryPort, from: ArrowId, to: ArrowId): boolean => {
  try {
    return geometry.target(from) === geometry.origin(to);
  } catch {
    return false;
  }
};

/**
 * Stack-grade fragment: sentry on Fire, tip beyond it, landing is the only A land.
 * When `withDistal`, a trail feeder against the grain from Fire is included.
 */
const aStackGradeWithSentry = (
  table: ReturnType<typeof onTiling>,
  withDistal: boolean,
): {
  readonly fire: ArrowId;
  readonly mid: ArrowId;
  readonly tip: ArrowId;
  readonly distal: ArrowId;
  readonly landing: ArrowId;
  readonly before: ReturnType<typeof stateOf>;
} => {
  const { home, run } = aRunFromHome(table.geometry, 4);
  const fire = arrowAt(run, 0);
  const mid = arrowAt(run, 1);
  const tip = arrowAt(run, 2);
  const landing = anExitFrom(table.geometry, tip);
  const distal = pick(
    table.geometry.inArrows(table.geometry.origin(fire)).filter((a) => a !== home && a !== fire),
    0,
  );
  const trail = withDistal ? [fire, mid, tip, distal] : [fire, mid, tip];
  const before = stateOf(
    [
      { arrow: fire, owner: A, heads: 1 },
      { arrow: tip, owner: A, heads: 1 },
    ],
    A,
    {
      trail: { A: trail },
      territory: owned([landing], A),
    },
  );
  return { fire, mid, tip, distal, landing, before };
};

const aStackGradeFork = (
  table: ReturnType<typeof onTiling>,
): {
  readonly stem: ArrowId;
  readonly fire: ArrowId;
  readonly tip: ArrowId;
  readonly armY: ArrowId;
  readonly landing: ArrowId;
  readonly before: ReturnType<typeof stateOf>;
} => {
  const { run } = aRunFromHome(table.geometry, 3);
  const stem = arrowAt(run, 0);
  const fire = arrowAt(run, 1);
  const tip = arrowAt(run, 2);
  const forkPoint = table.geometry.target(stem);
  const armY = pick(
    table.geometry.outArrows(forkPoint).filter((a) => a !== fire),
    0,
  );
  const landing = anExitFrom(table.geometry, tip);
  const before = stateOf(
    [
      { arrow: fire, owner: A, heads: 1 },
      { arrow: tip, owner: A, heads: 1 },
    ],
    A,
    {
      trail: { A: [stem, fire, tip, armY] },
      territory: owned([landing], A),
    },
  );
  return { stem, fire, tip, armY, landing, before };
};

const aStackGradeMerge = (
  table: ReturnType<typeof onTiling>,
): {
  readonly i1: ArrowId;
  readonly i2: ArrowId;
  readonly onward: ArrowId;
  readonly landing: ArrowId;
  readonly before: ReturnType<typeof stateOf>;
} => {
  const { run } = aRunFromHome(table.geometry, 2);
  const i1 = arrowAt(run, 0);
  const onward = arrowAt(run, 1);
  const mergePoint = table.geometry.target(i1);
  const i2 = pick(
    table.geometry.inArrows(mergePoint).filter((a) => a !== i1),
    0,
  );
  const landing = anExitFrom(table.geometry, onward);
  const before = stateOf(
    [
      { arrow: i1, owner: A, heads: 1 },
      { arrow: onward, owner: A, heads: 1 },
    ],
    A,
    {
      trail: { A: [i1, i2, onward] },
      territory: owned([landing], A),
    },
  );
  return { i1, i2, onward, landing, before };
};

/**
 * Playtest 2026-08-23 seat F lattice spine, if those ids are a grain chain on
 * this tiling; otherwise an equivalent six-arrow against-grain run with a mid
 * sentry slot at index 2.
 */
const playtestSpine = (
  geometry: GeometryPort,
): {
  readonly spine: readonly ArrowId[];
  readonly t3: ArrowId;
  readonly t6: ArrowId;
  readonly landing: ArrowId;
} => {
  const t1 = mintArrowId('tiling:a:2,-2,0');
  const t2 = mintArrowId('tiling:a:3,-2,2');
  const t3Named = mintArrowId('tiling:a:3,-3,2');
  const t4 = mintArrowId('tiling:a:3,-4,0');
  const t5 = mintArrowId('tiling:a:4,-4,2');
  const t6Named = mintArrowId('tiling:a:4,-5,0');
  const landingNamed = mintArrowId('tiling:a:5,-5,0');
  const named = [t1, t2, t3Named, t4, t5, t6Named];
  let namedIsChain = false;
  try {
    namedIsChain =
      followsGrain(geometry, t1, t2) &&
      followsGrain(geometry, t2, t3Named) &&
      followsGrain(geometry, t3Named, t4) &&
      followsGrain(geometry, t4, t5) &&
      followsGrain(geometry, t5, t6Named) &&
      followsGrain(geometry, t6Named, landingNamed) &&
      geometry.outArrows(geometry.target(t6Named)).includes(landingNamed);
  } catch {
    namedIsChain = false;
  }
  if (namedIsChain) {
    return { spine: named, t3: t3Named, t6: t6Named, landing: landingNamed };
  }
  const { run } = aRunFromHome(geometry, 6);
  const t6 = arrowAt(run, 5);
  return {
    spine: run,
    t3: arrowAt(run, 2),
    t6,
    landing: anExitFrom(geometry, t6),
  };
};

const anArrowOn = (table: ReturnType<typeof onBoard>) =>
  pick(table.geometry.outArrows(table.geometry.seedPoint()), 0);

const ownerOfHeads = (
  state: ReturnType<typeof stateOf>,
  arrow: ReturnType<typeof anArrowOn>,
): PlayerId | undefined => state.groups.get(arrow)?.owner;

const anArrowAwayFrom = (
  table: ReturnType<typeof onBoard>,
  avoid: readonly ReturnType<typeof anArrowOn>[],
): ReturnType<typeof anArrowOn> => {
  const blocked = new Set(avoid.map(String));
  for (const a of table.geometry.window(table.geometry.seedPoint(), 2).arrows) {
    if (!blocked.has(String(a))) return a;
  }
  throw new Error('setup: no arrow away from the avoid set');
};

const aPointDisjointArrow = (
  table: ReturnType<typeof onBoard>,
  reserved: readonly ArrowId[],
): ArrowId => {
  const points = new Set(
    reserved.flatMap((a) => [String(table.geometry.origin(a)), String(table.geometry.target(a))]),
  );
  for (const a of allArrows(table.geometry, 2)) {
    if (reserved.includes(a)) continue;
    if (
      !points.has(String(table.geometry.origin(a))) &&
      !points.has(String(table.geometry.target(a)))
    ) {
      return a;
    }
  }
  throw new Error('setup: no point-disjoint cut tail');
};
