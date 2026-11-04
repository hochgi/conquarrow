/**
 * Shared scaffolding for the P87 suite — a territory-grade raider survives a claim.
 *
 * Everything runs on the **generated tiling**: the claim's pocket is *enclosed*
 * ground, and only an unbounded board can tell enclosed from escaping (closure.md).
 * No arrow is named literally; every ring, road and feeder is asked of
 * `GeometryPort`, so a second tiling behind the same port satisfies the same tests.
 *
 * The closer is always A. A closes a directed 6-ring of trail by stepping from
 * `wall[5]` onto `wall[0]`, which is A's territory. The claim is the ring plus the
 * pocket it rings. B is the raider; each scenario authors B's side only.
 *
 * Two oracles here are **port readings**, not re-implementations of the fix:
 * `postClaimBoard` writes the claimed arrows as the closer's territory and keeps
 * every trail (the overview's *post-claim board*), and `shieldingArrows` asks
 * `RulesPort.anchorGrade` of that board for each of B's stretches.
 *
 * @see docs/spec/raider-survives-claim/raider-survives-claim.md
 */

import { readFileSync } from 'node:fs';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { mintArrowId, mintPlayerId, rational, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  PointId,
  Rational,
  Spawner,
  StepMove,
  VertexId,
} from '@conquarrow/contracts';
import { A, B, arrowAt, byId, exitsFrom, onTiling, owned, stateOf } from './support';
import type { Placement, Table } from './support';

// ── geometry asked of the port ────────────────────────────────────────────────

const endpoints = (geometry: GeometryPort, arrow: ArrowId): readonly PointId[] => [
  geometry.origin(arrow),
  geometry.target(arrow),
];

const arrowsAt = (geometry: GeometryPort, point: PointId): readonly ArrowId[] => [
  ...geometry.inArrows(point),
  ...geometry.outArrows(point),
];

/** Two arrows share a point — trail connectivity, either direction (§6.1). */
export const touches = (geometry: GeometryPort, left: ArrowId, right: ArrowId): boolean => {
  const mine = new Set(endpoints(geometry, left).map(String));
  return endpoints(geometry, right).some((point) => mine.has(String(point)));
};

/**
 * A directed 6-cycle from `start` with at least one arrow inside it, or `undefined`.
 *
 * The same search as `support.aRingWithAnInside`, from any start arrow, so the
 * property tests can range over more than one ring.
 */
const ringFrom = (
  geometry: GeometryPort,
  start: ArrowId,
): { readonly wall: readonly ArrowId[]; readonly interior: readonly ArrowId[] } | undefined => {
  const walk = (path: readonly ArrowId[]): readonly ArrowId[] | undefined => {
    const last = arrowAt(path, path.length - 1);
    if (path.length === 6) return exitsFrom(geometry, last).includes(start) ? path : undefined;
    for (const next of exitsFrom(geometry, last)) {
      if (path.includes(next)) continue;
      const found = walk([...path, next]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const wall = walk([start]);
  if (wall === undefined) return undefined;
  const points = new Set(wall.flatMap((a) => endpoints(geometry, a).map(String)));
  const interior = [...new Set(wall.flatMap((a) => geometry.outArrows(geometry.target(a))))]
    .filter((a) => !wall.includes(a))
    .filter((a) => endpoints(geometry, a).every((p) => points.has(String(p))))
    .toSorted(byId);
  return interior.length === 0 ? undefined : { wall, interior };
};

// ── the closure every scenario shares ─────────────────────────────────────────

/** B's side of a scenario: the raider's groups, its trail and its ground. */
export interface Raid {
  readonly groups?: readonly Placement[];
  readonly trail?: readonly ArrowId[];
  /** B's territory besides the distant keepalive arrow every scenario grants. */
  readonly territory?: readonly ArrowId[];
  /** Arrows A already owns besides the landing — the "already the closer's" case. */
  readonly alsoA?: readonly ArrowId[];
  /** A heads besides the closing tip. */
  readonly moreA?: readonly Placement[];
  readonly accumulators?: readonly (readonly [ArrowId, Rational])[];
  readonly spawners?: readonly (readonly [VertexId, Spawner])[];
}

export interface Closing {
  readonly table: Table;
  readonly wall: readonly ArrowId[];
  /** The arrows strictly inside the ring. */
  readonly interior: readonly ArrowId[];
  /** A's closing tip, on `wall[5]`. */
  readonly tip: ArrowId;
  /** `wall[0]`, A's territory: the closing step lands here. */
  readonly landing: ArrowId;
  /** The point the closing traversal passes — no B road may touch it. */
  readonly closePoint: PointId;
  /** A's closing step. */
  readonly close: StepMove;
  /** Everything the closure claims: `Claim.path ∪ Claim.enclosed`. */
  readonly claimed: ReadonlySet<ArrowId>;
  /** Every point of the ring. */
  readonly ringPoints: ReadonlySet<string>;
  /** B's distant keepalive territory, far from the ring. */
  readonly far: ArrowId;
  /** The state before A's closing step, with B's side authored. */
  readonly before: (raid: Raid) => GameState;
}

const closingFor = (
  table: Table,
  ring: { readonly wall: readonly ArrowId[]; readonly interior: readonly ArrowId[] },
): Closing | undefined => {
  const { geometry, rules } = table;
  const { wall, interior } = ring;
  const tip = arrowAt(wall, 5);
  const landing = arrowAt(wall, 0);
  const close = step(tip, landing, 1);
  const ringPoints = new Set(wall.flatMap((a) => endpoints(geometry, a).map(String)));
  const near = new Set(geometry.window(geometry.origin(landing), 6).arrows.map(String));
  const far = geometry
    .window(geometry.origin(landing), 12)
    .arrows.filter((a) => !near.has(String(a)))
    .toSorted(byId)[0];
  if (far === undefined) return undefined;

  const before = (raid: Raid): GameState =>
    stateOf(
      [{ arrow: tip, owner: A, heads: 1 }, ...(raid.moreA ?? []), ...(raid.groups ?? [])],
      A,
      {
        trail: { A: [...wall], B: [...(raid.trail ?? [])] },
        territory: [
          ...owned([landing, ...(raid.alsoA ?? [])], A),
          ...owned([far, ...(raid.territory ?? [])], B),
        ],
        ...(raid.accumulators === undefined ? {} : { accumulators: raid.accumulators }),
        ...(raid.spawners === undefined ? {} : { spawners: raid.spawners }),
      },
    );

  const claim = rules.closureOf(before({}), close, A);
  if (claim === undefined) return undefined;
  const claimed = new Set<ArrowId>([...claim.path, ...claim.enclosed]);
  if (!interior.every((a) => claimed.has(a))) return undefined;

  return {
    table,
    wall,
    interior,
    tip,
    landing,
    closePoint: geometry.target(tip),
    close,
    claimed,
    ringPoints,
    far,
    before,
  };
};

/** The ring every core scenario uses — the tiling's first 6-ring at its seed. */
export const aClosing = (): Closing => {
  const table = onTiling();
  const first = closings(table, 1)[0];
  if (first === undefined) throw new Error('setup: the tiling offered no closable 6-ring');
  return first;
};

/** Up to `count` distinct closable rings near the tiling's seed, for the properties. */
export const closings = (table: Table, count: number): readonly Closing[] => {
  const { geometry } = table;
  const found: Closing[] = [];
  const seen = new Set<string>();
  const starts = [...geometry.window(geometry.seedPoint(), 3).arrows].toSorted(byId);
  for (const start of [...geometry.outArrows(geometry.seedPoint()), ...starts]) {
    if (found.length >= count) break;
    const ring = ringFrom(geometry, start);
    if (ring === undefined) continue;
    const key = ring.wall.map(String).toSorted().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const closing = closingFor(table, ring);
    if (closing !== undefined) found.push(closing);
  }
  return found;
};

// ── B's roads ────────────────────────────────────────────────────────────────

/** A road of B trail from `seeds` out to a point a B territory arrow feeds. */
export interface Road {
  /** The road's arrows, not counting the seeds. */
  readonly road: readonly ArrowId[];
  /** B's territory arrow feeding the origin of the road's last arrow. */
  readonly feeder: ArrowId;
}

/**
 * The shortest road of unclaimed arrows from `seeds` to a point that a fresh B
 * territory arrow can feed — what lifts a stretch to territory grade (§6.1:
 * some trail arrow departs from a point the owner's territory feeds).
 *
 * No road arrow may touch `blocked` (the closing point, and in the
 * through-the-pocket case the raider's own points), and the feed point is never a
 * ring point, so the grade cannot come from anything the closure takes.
 */
export const roadHome = (
  closing: Closing,
  seeds: readonly ArrowId[],
  blocked: ReadonlySet<string>,
): Road | undefined => {
  const { geometry } = closing.table;
  const avoid = new Set<string>(
    [...closing.claimed, closing.landing, closing.far, ...seeds].map(String),
  );
  const ok = (arrow: ArrowId): boolean =>
    !avoid.has(String(arrow)) &&
    endpoints(geometry, arrow).every((p) => !blocked.has(String(p)));

  const parent = new Map<string, ArrowId | undefined>();
  const queue: ArrowId[] = [];
  for (const seed of seeds) {
    for (const point of endpoints(geometry, seed)) {
      if (blocked.has(String(point))) continue;
      for (const next of [...arrowsAt(geometry, point)].toSorted(byId)) {
        if (!ok(next) || parent.has(String(next))) continue;
        parent.set(String(next), undefined);
        queue.push(next);
      }
    }
  }
  for (let i = 0; i < queue.length && i < 400; i += 1) {
    const here = arrowAt(queue, i);
    const road: ArrowId[] = [];
    for (let at: ArrowId | undefined = here; at !== undefined; at = parent.get(String(at))) {
      road.unshift(at);
    }
    const origin = geometry.origin(here);
    if (!closing.ringPoints.has(String(origin)) && !blocked.has(String(origin))) {
      const feeder = [...geometry.inArrows(origin)]
        .toSorted(byId)
        .find((f) => ok(f) && !road.includes(f) && !closing.ringPoints.has(String(geometry.origin(f))));
      if (feeder !== undefined) return { road, feeder };
    }
    for (const point of endpoints(geometry, here)) {
      for (const next of [...arrowsAt(geometry, point)].toSorted(byId)) {
        if (!ok(next) || parent.has(String(next))) continue;
        parent.set(String(next), here);
        queue.push(next);
      }
    }
  }
  return undefined;
};

/** A raider on interior arrow `p` with a road home outside the pocket. */
export interface Shielded extends Road {
  readonly p: ArrowId;
  /** Every arrow of B's trail: `p`, then the road. */
  readonly stretch: readonly ArrowId[];
}

export const aShieldedRaider = (closing: Closing, p: ArrowId): Shielded | undefined => {
  const found = roadHome(closing, [p], new Set([String(closing.closePoint)]));
  return found === undefined ? undefined : { ...found, p, stretch: [p, ...found.road] };
};

/** The first interior arrow that has a road home. */
export const firstShielded = (closing: Closing): Shielded => {
  for (const p of closing.interior) {
    const found = aShieldedRaider(closing, p);
    if (found !== undefined) return found;
  }
  throw new Error('setup: no interior arrow of that ring has a road home');
};

/**
 * A raider on interior arrow `p` whose road home runs through a second interior arrow
 * `r` first — and touches `p`'s points nowhere else, so dropping `r` alone would
 * leave `p` cut off from home (decision 2).
 */
export const aRoadThroughThePocket = (
  closing: Closing,
): Shielded & { readonly r: ArrowId } => {
  const { geometry } = closing.table;
  for (const p of closing.interior) {
    for (const r of closing.interior) {
      if (r === p || !touches(geometry, p, r)) continue;
      const blocked = new Set([
        String(closing.closePoint),
        ...endpoints(geometry, p).map(String),
      ]);
      const found = roadHome(closing, [r], blocked);
      if (found === undefined) continue;
      return { ...found, p, r, stretch: [p, r, ...found.road] };
    }
  }
  throw new Error('setup: no two touching interior arrows lead a road home');
};

// ── oracles read through the port ─────────────────────────────────────────────

/** The overview's post-claim board: claimed arrows are the closer's, every trail stays. */
export const postClaimBoard = (
  before: GameState,
  claimed: ReadonlySet<ArrowId>,
  closer: PlayerId,
): GameState => {
  const territory = new Map(before.territory);
  for (const arrow of claimed) territory.set(arrow, closer);
  return { ...before, territory };
};

/** One connected component of a player's trail containing `seed` (§6.1). */
export const stretchOf = (
  geometry: GeometryPort,
  state: GameState,
  player: PlayerId,
  seed: ArrowId,
): readonly ArrowId[] => {
  const trail = state.trails.get(player);
  if (trail?.has(seed) !== true) return [];
  const reached = new Set<ArrowId>([seed]);
  const pending: ArrowId[] = [seed];
  for (let here = pending.pop(); here !== undefined; here = pending.pop()) {
    for (const point of endpoints(geometry, here)) {
      for (const next of arrowsAt(geometry, point)) {
        if (reached.has(next) || !trail.has(next)) continue;
        reached.add(next);
        pending.push(next);
      }
    }
  }
  return [...reached].toSorted(byId);
};

/**
 * The arrows of `player`'s shielding stretches: territory grade on the post-claim
 * board and carrying one of the player's groups on another player's territory.
 */
export const shieldingArrows = (
  table: Table,
  before: GameState,
  claimed: ReadonlySet<ArrowId>,
  closer: PlayerId,
  player: PlayerId,
): ReadonlySet<ArrowId> => {
  const board = postClaimBoard(before, claimed, closer);
  const shielding = new Set<ArrowId>();
  for (const [arrow, group] of board.groups) {
    if (group.owner !== player) continue;
    const land = board.territory.get(arrow);
    if (land === undefined || land === player) continue;
    if (board.trails.get(player)?.has(arrow) !== true) continue;
    if (table.rules.anchorGrade(board, arrow, player) !== 'territory') continue;
    for (const a of stretchOf(table.geometry, board, player, arrow)) shielding.add(a);
  }
  return shielding;
};

/** A spawner flanking `arrow`, for scenarios that author the economy themselves. */
export const aSpawnerBy = (
  geometry: GeometryPort,
  arrow: ArrowId,
): readonly [VertexId, Spawner] => {
  const vertex = [...geometry.flankVertices(arrow)].toSorted(byId)[0];
  if (vertex === undefined) throw new Error(`setup: no vertex flanks ${String(arrow)}`);
  return [vertex, { force: rational(1, 3), phase: 0 }] as const;
};

// ── the 2026-11-04 playtest log ───────────────────────────────────────────────

interface LoggedMove {
  readonly kind: string;
  readonly from?: string;
  readonly exit?: string;
  readonly count?: number;
}

interface LoggedMatch {
  readonly config: Parameters<typeof makeMatch>[0];
  readonly moves: readonly LoggedMove[];
}

const asArrow = (raw: string | undefined, what: string): ArrowId => {
  if (raw === undefined) throw new Error(`setup: a logged move has no ${what}`);
  return mintArrowId(raw);
};

const asMove = (logged: LoggedMove): Move => {
  if (logged.kind === 'endTurn') return { kind: 'endTurn' };
  if (logged.kind === 'step') {
    return {
      kind: 'step',
      from: asArrow(logged.from, 'from'),
      exit: asArrow(logged.exit, 'exit'),
      count: logged.count ?? 1,
    };
  }
  throw new Error(`setup: a logged move has an unknown kind ${logged.kind}`);
};

export const C: PlayerId = mintPlayerId('C');

/**
 * The 2026-11-04 three-seat log, read from the committed research folder.
 *
 * `states[i]` is the state **before** move `i` (0-based), so `states[i + 1]` is the
 * state after it. Folded once, through move `upTo`, with `RulesPort.apply` on the
 * generated tiling from `makeMatch(config)`.
 */
export const playtest20261104 = (
  upTo: number,
): { readonly table: Table; readonly moves: readonly Move[]; readonly states: readonly GameState[] } => {
  const raw = readFileSync(
    new URL('../../../docs/research/playtest-2026-11-04/match-log.json', import.meta.url),
    'utf8',
  );
  const log = JSON.parse(raw) as LoggedMatch;
  const table = onTiling();
  const moves = log.moves.map(asMove);
  const states: GameState[] = [makeMatch(log.config)];
  for (let i = 0; i <= upTo; i += 1) {
    const move = moves[i];
    const state = states[i];
    if (move === undefined || state === undefined) throw new Error(`setup: the log has no move ${String(i)}`);
    states.push(table.rules.apply(state, move));
  }
  return { table, moves, states };
};

export const stateAt = (states: readonly GameState[], index: number): GameState => {
  const state = states[index];
  if (state === undefined) throw new Error(`setup: no replayed state at ${String(index)}`);
  return state;
};
