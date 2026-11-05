/**
 * The EARS invariants of docs/spec/spec-alignment/spec-alignment.md, as properties.
 *
 * Families, all enumerated deterministically through the port:
 * - **steps through a trail point** (invariants 1, 2): every (step, arm) pair at the
 *   first points of both fixture boards, repelled, landing on empty ground, winning,
 *   and mutually wiped;
 * - **P87 closings** (invariants 3, 4): several 6-rings near the tiling's seed, with
 *   stack-grade raiders whose roads leave the pocket, and territory-grade stretches
 *   whose stack stands on the claim, beside it, or deeper in neutral ground;
 * - **R2 rings** (invariant 5): rings of A's land and trail enclosing B's anchoring
 *   land, with B's trail leaving the anchor point outward;
 * - **feeders** (invariant 6): every territory / enemy-mark pattern on the feeders of
 *   a stretch's root points on both fixture boards.
 *
 * Expected outcomes are never hard-coded per case. They come from the §6.1 oracles in
 * `spec-alignment.support.ts` (halt-at-first flood, clean feeder) and the post-claim
 * board of `raider-survives-claim.support.ts`.
 *
 * @see docs/spec/spec-alignment/spec-alignment.md
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PointId } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL,
  MINIMAL_DIAMETER,
  SPACIOUS,
  SPACIOUS_DIAMETER,
  allArrows,
  arrowAt,
  byId,
  exitsFrom,
  onBoard,
  onTiling,
  owned,
  ownerOf,
  snapshot,
  stateOf,
  via,
} from './support';
import type { Placement, Table } from './support';
import {
  aShieldedRaider,
  closings,
  postClaimBoard,
  shieldingArrows,
} from './raider-survives-claim.support';
import type { Closing } from './raider-survives-claim.support';
import {
  aNeutralRaiderThroughTheClaim,
  anchorRings,
  anotherFeederOf,
  armsAtPoints,
  cleanFeeders,
  floodOf,
  longRoads,
  marksOf,
  roadsOut,
} from './spec-alignment.support';
import type { AnchorRing, ArmAtPoint } from './spec-alignment.support';

/** One state and the move applied to it, on a table. */
interface Applied {
  readonly name: string;
  readonly table: Table;
  readonly before: GameState;
  readonly move: Move;
  readonly after: GameState;
}

const applied = (name: string, table: Table, before: GameState, move: Move): Applied => ({
  name,
  table,
  before,
  move,
  after: table.rules.apply(before, move),
});

const trailSet = (state: GameState, player: typeof A): ReadonlySet<ArrowId> =>
  state.trails.get(player) ?? new Set<ArrowId>();

const minus = (all: readonly string[], gone: ReadonlySet<ArrowId>): readonly string[] => {
  const drop = new Set([...gone].map(String));
  return all.filter((a) => !drop.has(a));
};

// ── family: steps through a point B's trail holds (invariants 1, 2) ───────────

const boards = [
  { label: 'minimal', table: onBoard(MINIMAL), diameter: MINIMAL_DIAMETER },
  { label: 'spacious', table: onBoard(SPACIOUS), diameter: SPACIOUS_DIAMETER },
] as const;

interface StepCase extends Applied {
  readonly arm: ArmAtPoint;
  readonly point: PointId;
}

const stepCase = (
  label: string,
  shape: string,
  table: Table,
  arm: ArmAtPoint,
  placements: readonly Placement[],
  bTrail: readonly ArrowId[],
  count: number,
): StepCase => {
  const before = stateOf(placements, A, { trail: { B: bTrail } });
  return {
    ...applied(
      `${label} ${shape} ${String(arm.from)}→${String(arm.exit)} arm ${String(arm.armIn)}→${String(arm.armOut)}`,
      table,
      before,
      step(arm.from, arm.exit, count),
    ),
    arm,
    point: arm.point,
  };
};

const repelled: readonly StepCase[] = boards.flatMap(({ label, table, diameter }) =>
  armsAtPoints(table.geometry, diameter, 2).map((arm) =>
    stepCase(
      label,
      'repelled',
      table,
      arm,
      [
        { arrow: arm.from, owner: A, heads: 2 },
        { arrow: arm.exit, owner: B, heads: 3 },
      ],
      [arm.armIn, arm.armOut, arm.exit],
      1,
    ),
  ),
);

/** A third arrow of B's arm beyond `armOut`, away from the point, when the board has one. */
const beyondOf = (table: Table, arm: ArmAtPoint): ArrowId | undefined =>
  exitsFrom(table.geometry, arm.armOut)
    .filter(
      (b) =>
        ![arm.from, arm.exit, arm.armIn, arm.armOut].includes(b) &&
        table.geometry.target(b) !== arm.point,
    )
    .toSorted(byId)[0];

const landing: readonly StepCase[] = boards.flatMap(({ label, table, diameter }) =>
  armsAtPoints(table.geometry, diameter, 2).flatMap((arm) => {
    const beyond = beyondOf(table, arm);
    const arms = beyond === undefined ? [arm.armIn, arm.armOut] : [arm.armIn, arm.armOut, beyond];
    const onArm = (arrow: ArrowId): Placement => ({ arrow, owner: B, heads: 1 });
    return [
      stepCase(label, 'empty', table, arm, [{ arrow: arm.from, owner: A, heads: 1 }], arms, 1),
      stepCase(
        label,
        'empty-firebreak',
        table,
        arm,
        [{ arrow: arm.from, owner: A, heads: 1 }, onArm(arm.armOut)],
        arms,
        1,
      ),
      stepCase(
        label,
        'win',
        table,
        arm,
        [
          { arrow: arm.from, owner: A, heads: 3 },
          { arrow: arm.exit, owner: B, heads: 1 },
        ],
        [...arms, arm.exit],
        2,
      ),
      stepCase(
        label,
        'mutual-wipe',
        table,
        arm,
        [
          { arrow: arm.from, owner: A, heads: 3 },
          { arrow: arm.exit, owner: B, heads: 3 },
        ],
        [...arms, arm.exit],
        2,
      ),
    ];
  }),
).filter((c) => c.table.rules.crossesTrail(c.before, via(c.arm.from, c.arm.exit), B));

// ── family: P87 closings (invariants 3, 4) ────────────────────────────────────

const tiling = onTiling();
const ring6 = closings(tiling, 4);

interface ClaimCase extends Applied {
  readonly closing: Closing;
}

const claimCase = (closing: Closing, name: string, before: GameState): ClaimCase => ({
  ...applied(`${name} in ring ${String(closing.tip)}`, closing.table, before, closing.close),
  closing,
});

const cutsNothing = (c: ClaimCase): boolean =>
  !c.table.rules.crossesTrail(c.before, via(c.closing.tip, c.closing.landing), B);

/** Stack-grade raiders on claimed arrows, with roads off the claim (D1). */
const converting: readonly ClaimCase[] = ring6
  .flatMap((closing) => [
    ...closing.interior.flatMap((p) => {
      const road = aShieldedRaider(closing, p)?.road;
      if (road === undefined) return [];
      return [
        claimCase(
          closing,
          `road from ${String(p)}`,
          closing.before({ groups: [{ arrow: p, owner: B, heads: 2 }], trail: [p, ...road] }),
        ),
      ];
    }),
    ...longRoads(closing)
      .slice(0, 6)
      .map(({ p, r1, r2 }) =>
        claimCase(
          closing,
          `firebreak road ${String(p)}→${String(r2)}`,
          closing.before({
            groups: [
              { arrow: p, owner: B, heads: 2 },
              { arrow: r2, owner: B, heads: 1 },
            ],
            trail: [p, r1, r2],
          }),
        ),
      ),
  ])
  .filter(cutsNothing);

const throughTheClaim = (closing: Closing): readonly ClaimCase[] => {
  try {
    const { n, trail, feeder } = aNeutralRaiderThroughTheClaim(closing);
    return [
      claimCase(
        closing,
        `neutral raider ${String(n)} through the claim`,
        closing.before({ groups: [{ arrow: n, owner: B, heads: 1 }], trail, territory: [feeder] }),
      ),
    ];
  } catch {
    return [];
  }
};

/** Territory-grade stretches carrying a B stack on, beside, or beyond the claim (C2). */
const sparing: readonly ClaimCase[] = ring6
  .flatMap((closing) => [
    ...closing.interior.flatMap((p) => {
      const s = aShieldedRaider(closing, p);
      if (s === undefined) return [];
      const side = { trail: s.stretch, territory: [s.feeder] };
      const off = s.road[0];
      return [
        claimCase(closing, `on claim ${String(p)}`, closing.before({ ...side, groups: [{ arrow: p, owner: B, heads: 1 }] })),
        ...(off === undefined
          ? []
          : [
              claimCase(
                closing,
                `beside claim ${String(off)}`,
                closing.before({ ...side, groups: [{ arrow: off, owner: B, heads: 1 }] }),
              ),
            ]),
      ];
    }),
    ...throughTheClaim(closing),
  ])
  .filter(cutsNothing);

// ── family: R2 rings (invariant 5) ────────────────────────────────────────────

interface RingCase extends Applied {
  readonly ring: AnchorRing;
}

const ringCase = (ring: AnchorRing, name: string, before: GameState): RingCase => ({
  ...applied(`${name} at ${String(ring.p0)} (f ${String(ring.f)})`, ring.table, before, ring.close),
  ring,
});

const rootCuts: readonly RingCase[] = anchorRings(tiling, 30, 6).flatMap((ring) =>
  roadsOut(ring)
    .slice(0, 3)
    .flatMap(({ e1, e2 }) => {
      const g = anotherFeederOf(ring);
      return [
        ringCase(ring, `stack on e2 ${String(e2)}`, ring.before({ groups: [{ arrow: e2, owner: B, heads: 1 }], trail: [e1, e2] })),
        ringCase(ring, `stack on e1 ${String(e1)}`, ring.before({ groups: [{ arrow: e1, owner: B, heads: 1 }], trail: [e1] })),
        ringCase(ring, `dormant ${String(e1)}`, ring.before({ trail: [e1, e2] })),
        ...(g === undefined
          ? []
          : [
              ringCase(
                ring,
                `second feeder ${String(g)}`,
                ring.before({ groups: [{ arrow: e2, owner: B, heads: 1 }], trail: [e1, e2], territory: [g] }),
              ),
            ]),
      ];
    }),
);

// ── family: feeders (invariant 6) ─────────────────────────────────────────────

interface GradeCase {
  readonly name: string;
  readonly table: Table;
  readonly state: GameState;
  readonly stretch: readonly ArrowId[];
}

const subsets = <T,>(items: readonly T[]): readonly (readonly T[])[] =>
  items.reduce<readonly (readonly T[])[]>(
    (acc, item) => [...acc, ...acc.map((s) => [...s, item])],
    [[]],
  );

const grades: readonly GradeCase[] = boards.flatMap(({ label, table, diameter }) => {
  const { geometry } = table;
  return allArrows(geometry, diameter)
    .toSorted(byId)
    .slice(0, 3)
    .flatMap((out) => {
      const next = exitsFrom(geometry, out).toSorted(byId)[0];
      const stretches = next === undefined ? [[out]] : [[out], [out, next]];
      return stretches.flatMap((stretch) => {
        const feeders = [
          ...new Set(stretch.flatMap((a) => geometry.inArrows(geometry.origin(a)))),
        ]
          .filter((f) => !stretch.includes(f))
          .toSorted(byId);
        return subsets(feeders)
          .filter((land) => land.length > 0)
          .flatMap((land) =>
            subsets(land).map((marked) => ({
              name: `${label} ${stretch.map(String).join('+')} land ${land.map(String).join(',')} marked ${marked.map(String).join(',')}`,
              table,
              stretch,
              state: stateOf([{ arrow: out, owner: B, heads: 1 }], A, {
                trail: { A: marked, B: stretch },
                territory: owned(land, B),
              }),
            })),
          );
      });
    });
});

// ── the families are not vacuous ──────────────────────────────────────────────

describe('the families are not vacuous', () => {
  it('hold repelled, landing, converting, sparing and root-cut cases', () => {
    expect(repelled.length).toBeGreaterThan(10);
    expect(repelled.every((c) => ownerOf(c.after, c.arm.exit) === B)).toBe(true);
    expect(landing.filter((c) => c.name.includes('empty ')).length).toBeGreaterThan(0);
    expect(landing.filter((c) => c.name.includes('win')).length).toBeGreaterThan(0);
    expect(landing.filter((c) => c.name.includes('mutual-wipe')).length).toBeGreaterThan(0);
    expect(new Set(converting.map((c) => String(c.closing.tip))).size).toBeGreaterThan(1);
    expect(converting.filter((c) => c.name.startsWith('firebreak')).length).toBeGreaterThan(0);
    expect(sparing.filter((c) => c.name.startsWith('beside')).length).toBeGreaterThan(0);
    expect(sparing.filter((c) => c.name.startsWith('neutral raider')).length).toBeGreaterThan(0);
    expect(new Set(rootCuts.map((c) => String(c.ring.f))).size).toBeGreaterThan(1);
    expect(rootCuts.filter((c) => c.name.startsWith('second feeder')).length).toBeGreaterThan(0);
    expect(grades.length).toBeGreaterThan(50);
  });
});

// ── invariant 1 ───────────────────────────────────────────────────────────────

describe("invariant 1 — a step whose attacker does not land leaves every other player's trail", () => {
  it.each(repelled)('$name', (c) => {
    expect(marksOf(c.after, B)).toEqual(marksOf(c.before, B));
  });
});

// ── invariant 2 ───────────────────────────────────────────────────────────────

describe('invariant 2 — a step that lands and crosses evaporates from the crossing point', () => {
  it.each(landing)('$name', (c) => {
    // Occupancy after the battle: a wiped defender is no firebreak (§6.2).
    const flood = floodOf(c.table.geometry, c.after, B, trailSet(c.before, B), { point: c.point });
    expect(marksOf(c.after, B)).toEqual(minus(marksOf(c.before, B), flood));
  });
});

// ── invariant 3 ───────────────────────────────────────────────────────────────

/** B's marks the claim itself removes: claimed, not shielding, no B group on them. */
const removedByClaim = (c: ClaimCase): ReadonlySet<ArrowId> => {
  const shielding = shieldingArrows(c.table, c.before, c.closing.claimed, A, B);
  return new Set(
    [...trailSet(c.before, B)].filter(
      (a) =>
        c.closing.claimed.has(a) && !shielding.has(a) && c.before.groups.get(a)?.owner !== B,
    ),
  );
};

describe('invariant 3 — a convert wipe leaves no victim trail reachable from the converted arrow', () => {
  it.each(converting)('$name', (c) => {
    const converted = [...c.before.groups]
      .filter(([arrow, group]) => group.owner === B && ownerOf(c.after, arrow) === A)
      .map(([arrow]) => arrow);
    expect(converted.length).toBeGreaterThan(0);
    const gone = removedByClaim(c);
    const trail = new Set([...trailSet(c.before, B)].filter((a) => !gone.has(a)));
    const after = new Set(marksOf(c.after, B));
    for (const arrow of converted) {
      for (const reached of floodOf(c.table.geometry, c.after, B, trail, { arrow })) {
        expect(after.has(String(reached))).toBe(false);
      }
    }
  });
});

// ── invariant 4 ───────────────────────────────────────────────────────────────

describe('invariant 4 — a closure keeps every arrow of a territory-grade stretch carrying its stack', () => {
  it.each(sparing)('$name', (c) => {
    const shielding = shieldingArrows(c.table, c.before, c.closing.claimed, A, B);
    expect(shielding.size).toBeGreaterThan(0);
    const after = new Set(marksOf(c.after, B));
    for (const arrow of shielding) expect(after.has(String(arrow))).toBe(true);
  });
});

// ── invariant 5 ───────────────────────────────────────────────────────────────

describe('invariant 5 — a closure that takes the last clean feeder of a root point evaporates from it', () => {
  it.each(rootCuts)('$name', (c) => {
    const { geometry } = c.table;
    const { p0, claimed } = c.ring;
    const post = postClaimBoard(c.before, claimed, A);
    const rooted = geometry.outArrows(p0).some((a) => trailSet(c.before, B).has(a));
    const lost =
      rooted &&
      cleanFeeders(geometry, c.before, p0, B).length > 0 &&
      cleanFeeders(geometry, post, p0, B).length === 0;
    const flood = lost
      ? floodOf(geometry, post, B, trailSet(c.before, B), { point: p0 })
      : new Set<ArrowId>();
    // No B mark is claimed and no B stack stands on land, so nothing else moves B's trail.
    expect(marksOf(c.after, B)).toEqual(minus(marksOf(c.before, B), flood));
  });
});

// ── invariant 6 ───────────────────────────────────────────────────────────────

describe('invariant 6 — territory grade only when the stretch leaves a point with a clean feeder', () => {
  it.each(grades)('$name', (c) => {
    const { geometry } = c.table;
    const clean = c.stretch.some(
      (a) => cleanFeeders(geometry, c.state, geometry.origin(a), B).length > 0,
    );
    const grade = c.table.rules.anchorGrade(c.state, arrowAt(c.stretch, 0), B);
    // B's stack stands on the stretch, so without a clean feeder it is stack grade.
    expect(grade).toBe(clean ? 'territory' : 'stack');
  });
});

// ── invariant 7 ───────────────────────────────────────────────────────────────

const everyApplied: readonly Applied[] = [
  ...repelled,
  ...landing,
  ...converting,
  ...sparing,
  ...rootCuts,
];

describe('invariant 7 — apply is pure and deterministic', () => {
  it.each(everyApplied)('$name', (c) => {
    const pictured = snapshot(c.before);
    const again = c.table.rules.apply(c.before, c.move);
    expect(snapshot(again)).toEqual(snapshot(c.after));
    expect(snapshot(c.before)).toEqual(pictured);
  });

  it('grades the same state the same way twice, without mutating it', () => {
    for (const c of grades) {
      const pictured = snapshot(c.state);
      const arrow = arrowAt(c.stretch, 0);
      expect(c.table.rules.anchorGrade(c.state, arrow, B)).toBe(
        c.table.rules.anchorGrade(c.state, arrow, B),
      );
      expect(snapshot(c.state)).toEqual(pictured);
    }
  });
});
