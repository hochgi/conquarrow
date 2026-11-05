/**
 * Shared scaffolding for the P88 suite — rules-core follows the P86 rulings.
 *
 * Builds on the two existing support files rather than beside them: the fixture
 * helpers of `support.ts` for the step rulings (R3, D2, R1), and P87's tiling
 * closings of `raider-survives-claim.support.ts` for the claim rulings (D1, C2, R2).
 * No arrow is named literally; every configuration is searched for through
 * `GeometryPort`, so a second tiling behind the same port satisfies the same tests.
 *
 * Two oracles here re-read SPEC sentences, not the engine:
 * - `floodOf` is §6.1's halt-at-first rule: a front destroys every victim trail
 *   arrow it enters until it would enter an arrow holding the victim's stack;
 *   the victim's territory is a wall.
 * - `cleanFeeders` is §6.1's clean feeder: an in-arrow of `P0` that is the owner's
 *   territory and in no other player's trail.
 *
 * @see docs/spec/spec-alignment/spec-alignment.md
 */

import { chord, chordsInterleave, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  PlayerId,
  PointId,
  Slot,
  StepMove,
} from '@conquarrow/contracts';
import { A, B, allArrows, arrowAt, byId, owned, stateOf } from './support';
import type { Placement, Table } from './support';
import { aShieldedRaider, closings, touches } from './raider-survives-claim.support';
import type { Closing, Shielded } from './raider-survives-claim.support';

// ── reading the board ────────────────────────────────────────────────────────

const endpoints = (geometry: GeometryPort, arrow: ArrowId): readonly PointId[] => [
  geometry.origin(arrow),
  geometry.target(arrow),
];

const arrowsAt = (geometry: GeometryPort, point: PointId): readonly ArrowId[] =>
  [...geometry.inArrows(point), ...geometry.outArrows(point)].toSorted(byId);

const trailOfPlayer = (state: GameState, player: PlayerId): ReadonlySet<ArrowId> =>
  state.trails.get(player) ?? new Set<ArrowId>();

/** Every arrow of `player`'s trail, as sorted strings. */
export const marksOf = (state: GameState, player: PlayerId): readonly string[] =>
  [...trailOfPlayer(state, player)].map(String).toSorted();

// ── §6.1 oracles ─────────────────────────────────────────────────────────────

/**
 * §6.1 clean feeders of `point` for `player`: in-arrows that are the player's
 * territory and in no other player's trail.
 */
export const cleanFeeders = (
  geometry: GeometryPort,
  state: GameState,
  point: PointId,
  player: PlayerId,
): readonly ArrowId[] =>
  geometry
    .inArrows(point)
    .filter((feeder) => state.territory.get(feeder) === player)
    .filter((feeder) =>
      [...state.trails].every(([owner, arrows]) => owner === player || !arrows.has(feeder)),
    );

/** Where a flood starts: every trail arrow at a point, or one arrow (destroyed first). */
export type Seed = { readonly point: PointId } | { readonly arrow: ArrowId };

/**
 * The arrows §6.1's fronts destroy, seeded at `seed`, over `trail`.
 *
 * A front enters a trail arrow; if it is the victim's territory it is a wall, if it
 * holds a group of the victim it halts there, otherwise it destroys the arrow and
 * spreads to every trail arrow at both of its points (all-to-all, §6.1).
 * An arrow seed is destroyed whatever stands on it: its stack is not the victim's
 * (§6.1 "Evaporation from an arrow").
 */
export const floodOf = (
  geometry: GeometryPort,
  state: GameState,
  victim: PlayerId,
  trail: ReadonlySet<ArrowId>,
  seed: Seed,
): ReadonlySet<ArrowId> => {
  const destroyed = new Set<ArrowId>();
  const visited = new Set<ArrowId>();
  const pending: ArrowId[] = [];
  const enqueueAt = (point: PointId): void => {
    for (const next of arrowsAt(geometry, point)) {
      if (!trail.has(next) || visited.has(next)) continue;
      visited.add(next);
      pending.push(next);
    }
  };
  if ('point' in seed) {
    enqueueAt(seed.point);
  } else if (trail.has(seed.arrow)) {
    visited.add(seed.arrow);
    destroyed.add(seed.arrow);
    for (const point of endpoints(geometry, seed.arrow)) enqueueAt(point);
  }
  for (let here = pending.shift(); here !== undefined; here = pending.shift()) {
    if (state.territory.get(here) === victim) continue;
    if (state.groups.get(here)?.owner === victim) continue;
    destroyed.add(here);
    for (const point of endpoints(geometry, here)) enqueueAt(point);
  }
  return destroyed;
};

// ── R3: a step through a point the defender's trail holds ────────────────────

/** A point P, a step `from → exit` through it, and a second arm of B's trail at P. */
export interface ArmAtPoint {
  readonly point: PointId;
  readonly from: ArrowId;
  readonly exit: ArrowId;
  readonly armIn: ArrowId;
  readonly armOut: ArrowId;
  /** Whether `from → exit` interleaves the arm's chord `armIn → armOut`. */
  readonly interleaves: boolean;
}

/**
 * Every (step, arm) configuration at points of a board: `from` and `armIn` distinct
 * in-arrows of P, `exit` and `armOut` distinct out-arrows. Board order, so the list
 * is deterministic.
 */
export const armsAtPoints = (
  geometry: GeometryPort,
  diameter: number,
  pointLimit: number,
): readonly ArmAtPoint[] => {
  const points = [...new Set(allArrows(geometry, diameter).map((a) => geometry.target(a)))]
    .toSorted(byId)
    .slice(0, pointLimit);
  const found: ArmAtPoint[] = [];
  for (const point of points) {
    const slot = (a: ArrowId): Slot => geometry.slotOf(point, a);
    for (const from of geometry.inArrows(point)) {
      for (const exit of geometry.outArrows(point)) {
        for (const armIn of geometry.inArrows(point)) {
          if (armIn === from) continue;
          for (const armOut of geometry.outArrows(point)) {
            if (armOut === exit) continue;
            const interleaves = chordsInterleave(
              chord(slot(from), slot(exit)),
              chord(slot(armIn), slot(armOut)),
            );
            found.push({ point, from, exit, armIn, armOut, interleaves });
          }
        }
      }
    }
  }
  return found;
};

/** The first configuration whose step does **not** interleave the other arm. */
export const anAsideArm = (geometry: GeometryPort, diameter: number): ArmAtPoint => {
  const found = armsAtPoints(geometry, diameter, Number.POSITIVE_INFINITY).find(
    (c) => !c.interleaves,
  );
  if (found === undefined) throw new Error('setup: every arm at every point interleaves');
  return found;
};

// ── D2: a stretch leaving P0 and its feeders ─────────────────────────────────

/** An out-arrow, its origin P0, an in-arrow of P0, and an arrow from which it is one step. */
export interface Feeding {
  readonly out: ArrowId;
  readonly p0: PointId;
  readonly feeder: ArrowId;
  /** An arrow whose target is `origin(feeder)` — A steps from here onto `feeder`. */
  readonly approach: ArrowId;
}

/**
 * A feeding where A's step `approach → feeder` passes a point B's trail `{out}`
 * does not touch, so the step crosses nothing and only marks the feeder.
 */
export const aFeeding = (table: Table): Feeding => {
  const { geometry } = table;
  for (const out of allArrows(geometry, 1).toSorted(byId)) {
    const p0 = geometry.origin(out);
    const outPoints = new Set(endpoints(geometry, out).map(String));
    for (const feeder of geometry.inArrows(p0)) {
      if (feeder === out) continue;
      const via = geometry.origin(feeder);
      if (outPoints.has(String(via))) continue;
      for (const approach of geometry.inArrows(via)) {
        if (approach === out || approach === feeder) continue;
        if (outPoints.has(String(geometry.origin(approach)))) continue;
        return { out, p0, feeder, approach };
      }
    }
  }
  throw new Error('setup: no feeding with a clear approach on this board');
};

// ── D1, C2: roads off P87's closing ───────────────────────────────────────────

const isOff = (closing: Closing, arrow: ArrowId): boolean =>
  !closing.claimed.has(arrow) &&
  arrow !== closing.landing &&
  arrow !== closing.far &&
  !closing.wall.includes(arrow) &&
  endpoints(closing.table.geometry, arrow).every((p) => p !== closing.closePoint);

/** A raider on interior arrow `p` whose road off the claim is at least two arrows long. */
export interface LongRoad {
  readonly p: ArrowId;
  /** First road arrow: touches `p`, off the claim. */
  readonly r1: ArrowId;
  /** Second road arrow: touches `r1`, not `p`, off the claim, touching no ring point. */
  readonly r2: ArrowId;
}

/** Every `(p, r1, r2)` around a closing's pocket, board order. */
export const longRoads = (closing: Closing): readonly LongRoad[] => {
  const { geometry } = closing.table;
  const found: LongRoad[] = [];
  for (const p of closing.interior) {
    const firsts = endpoints(geometry, p)
      .flatMap((point) => arrowsAt(geometry, point))
      .filter((r1) => r1 !== p && isOff(closing, r1));
    for (const r1 of [...new Set(firsts)].toSorted(byId)) {
      const seconds = endpoints(geometry, r1)
        .filter((point) => !closing.ringPoints.has(String(point)))
        .flatMap((point) => arrowsAt(geometry, point))
        .filter(
          (r2) =>
            r2 !== r1 &&
            isOff(closing, r2) &&
            !touches(geometry, r2, p) &&
            endpoints(geometry, r2).every((point) => !closing.ringPoints.has(String(point))),
        );
      for (const r2 of [...new Set(seconds)].toSorted(byId)) found.push({ p, r1, r2 });
    }
  }
  return found;
};

/** The first long road whose state has a stack-grade raider and a close that cuts nothing. */
export const aLongRoad = (closing: Closing): LongRoad => {
  const { rules } = closing.table;
  const found = longRoads(closing).find(({ p, r1, r2 }) => {
    const before = closing.before({
      groups: [
        { arrow: p, owner: B, heads: 2 },
        { arrow: r2, owner: B, heads: 1 },
      ],
      trail: [p, r1, r2],
    });
    return (
      rules.anchorGrade(before, p, B) === 'stack' &&
      !rules.crossesTrail(before, closing.close, B)
    );
  });
  if (found === undefined) throw new Error('setup: no two-arrow road leaves the pocket');
  return found;
};

/**
 * A shielded raider's stretch `[r, ...road]` through interior arrow `r`, with B's
 * stack moved off the claim onto neutral `n` on the other side of `r`: `n` touches
 * `r`, is off the claim, and reaches home only through `r`.
 */
export interface ThroughTheClaim extends Shielded {
  readonly n: ArrowId;
  /** The claimed arrow the stack's road runs through. */
  readonly r: ArrowId;
  /** Every arrow of B's trail: `n`, `r`, then the road. */
  readonly trail: readonly ArrowId[];
}

export const aNeutralRaiderThroughTheClaim = (closing: Closing): ThroughTheClaim => {
  const { geometry, rules } = closing.table;
  for (const r of closing.interior) {
    const shielded = aShieldedRaider(closing, r);
    if (shielded === undefined) continue;
    const used = new Set<ArrowId>([...shielded.stretch, shielded.feeder]);
    const candidates = endpoints(geometry, r)
      .flatMap((point) => arrowsAt(geometry, point))
      .filter(
        (n) =>
          !used.has(n) &&
          isOff(closing, n) &&
          shielded.road.every((a) => !touches(geometry, a, n)) &&
          !touches(geometry, shielded.feeder, n),
      );
    for (const n of [...new Set(candidates)].toSorted(byId)) {
      const trail = [n, ...shielded.stretch];
      const state = (marks: readonly ArrowId[]): GameState =>
        closing.before({
          groups: [{ arrow: n, owner: B, heads: 1 }],
          trail: marks,
          territory: [shielded.feeder],
        });
      const before = state(trail);
      if (rules.anchorGrade(before, n, B) !== 'territory') continue;
      if (rules.crossesTrail(before, closing.close, B)) continue;
      // Without r, n reaches no clean feeder: r is the stack's only road home.
      if (rules.anchorGrade(state(trail.filter((a) => a !== r)), n, B) === 'territory') continue;
      return { ...shielded, n, r, trail };
    }
  }
  throw new Error('setup: no neutral arrow reaches home only through the pocket');
};

// ── R2: a ring of A's land and trail around B's anchoring land ───────────────

/** B's side of an R2 state. */
export interface AnchorSide {
  readonly groups?: readonly Placement[];
  readonly trail?: readonly ArrowId[];
  /** B territory besides `far` and `f`. */
  readonly territory?: readonly ArrowId[];
  /** A territory besides the three land arrows of the ring. */
  readonly alsoA?: readonly ArrowId[];
}

/**
 * The register's R2 shape: a directed 6-ring whose first three arrows are A's land
 * and last three A's trail; A closes from `wall[5]` onto `wall[0]`. B's land `f` is
 * enclosed, and its head point `p0` is a point of A's land only.
 */
export interface AnchorRing {
  readonly table: Table;
  readonly wall: readonly ArrowId[];
  readonly tip: ArrowId;
  readonly landing: ArrowId;
  readonly close: StepMove;
  readonly far: ArrowId;
  readonly f: ArrowId;
  readonly p0: PointId;
  readonly ringPoints: ReadonlySet<string>;
  /** `Claim.path ∪ Claim.enclosed` with `f` as B's land and B's side empty. */
  readonly claimed: ReadonlySet<ArrowId>;
  readonly before: (side: AnchorSide) => GameState;
}

const anchorRingsOf = (closing: Closing): readonly AnchorRing[] => {
  const { table, wall, far, ringPoints } = closing;
  const { geometry, rules } = table;
  const land = [0, 1, 2].map((i) => arrowAt(wall, i));
  const trailA = [3, 4, 5].map((i) => arrowAt(wall, i));
  const tip = arrowAt(wall, 5);
  const landing = arrowAt(wall, 0);
  const close = step(tip, landing, 1);
  const trailPoints = new Set(trailA.flatMap((a) => endpoints(geometry, a).map(String)));
  const landOnly = new Set(
    land.flatMap((a) => endpoints(geometry, a).map(String)).filter((p) => !trailPoints.has(p)),
  );
  const stateWith =
    (f: ArrowId | undefined) =>
    (side: AnchorSide): GameState =>
      stateOf([{ arrow: tip, owner: A, heads: 1 }, ...(side.groups ?? [])], A, {
        trail: { A: trailA, B: [...(side.trail ?? [])] },
        territory: [
          ...owned([...land, ...(side.alsoA ?? [])], A),
          ...owned([far, ...(f === undefined ? [] : [f]), ...(side.territory ?? [])], B),
        ],
      });
  const bare = rules.closureOf(stateWith(undefined)({}), close, A);
  if (bare === undefined) return [];
  const rings: AnchorRing[] = [];
  for (const f of [...bare.enclosed].toSorted(byId)) {
    const p0 = geometry.target(f);
    if (!landOnly.has(String(p0))) continue;
    const before = stateWith(f);
    const claim = rules.closureOf(before({}), close, A);
    if (claim?.enclosed.includes(f) !== true) continue;
    rings.push({
      table,
      wall,
      tip,
      landing,
      close,
      far,
      f,
      p0,
      ringPoints,
      claimed: new Set([...claim.path, ...claim.enclosed]),
      before,
    });
  }
  return rings;
};

/** Up to `count` R2 rings near the tiling's seed, searched over `limit` closings. */
export const anchorRings = (table: Table, limit: number, count: number): readonly AnchorRing[] =>
  closings(table, limit).flatMap(anchorRingsOf).slice(0, count);

/** Arrows leaving the ring's `p0` outward: off the claim and off the wall. */
export const outwardOf = (ring: AnchorRing): readonly ArrowId[] =>
  ring.table.geometry
    .outArrows(ring.p0)
    .filter((e) => !ring.claimed.has(e) && !ring.wall.includes(e) && e !== ring.far)
    .toSorted(byId);

/** B's trail leaving `p0` over bare `e1` to `e2`, neither touching the ring past `p0`. */
export interface BareThenStack {
  readonly e1: ArrowId;
  readonly e2: ArrowId;
}

/** Every `(e1, e2)` road out of a ring's anchor point whose close cuts nothing. */
export const roadsOut = (ring: AnchorRing): readonly BareThenStack[] => {
  const { geometry, rules } = ring.table;
  const found: BareThenStack[] = [];
  for (const e1 of outwardOf(ring)) {
    if (ring.ringPoints.has(String(geometry.target(e1)))) continue;
    for (const e2 of geometry.outArrows(geometry.target(e1)).toSorted(byId)) {
      if (e2 === e1 || ring.claimed.has(e2) || ring.wall.includes(e2) || e2 === ring.far) continue;
      if (endpoints(geometry, e2).some((p) => ring.ringPoints.has(String(p)))) continue;
      const before = ring.before({ groups: [{ arrow: e2, owner: B, heads: 1 }], trail: [e1, e2] });
      if (rules.crossesTrail(before, ring.close, B)) continue;
      const claim = rules.closureOf(before, ring.close, A);
      if (claim?.enclosed.includes(ring.f) !== true) continue;
      if (rules.anchorGrade(before, e2, B) !== 'territory') continue;
      found.push({ e1, e2 });
    }
  }
  return found;
};

/** The register's R2 ring with a bare-then-stack road out of its anchor point. */
export const anAnchorRing = (
  table: Table,
): { readonly ring: AnchorRing; readonly road: BareThenStack } => {
  for (const ring of anchorRings(table, 30, Number.POSITIVE_INFINITY)) {
    const road = roadsOut(ring)[0];
    if (road !== undefined) return { ring, road };
  }
  throw new Error('setup: no ring encloses B land whose head point leads outward');
};

/** A second in-arrow of the ring's `p0`, off the claim — a feeder the claim leaves. */
export const anotherFeederOf = (ring: AnchorRing): ArrowId | undefined =>
  ring.table.geometry
    .inArrows(ring.p0)
    .filter((g) => g !== ring.f && !ring.claimed.has(g) && !ring.wall.includes(g) && g !== ring.far)
    .toSorted(byId)[0];
