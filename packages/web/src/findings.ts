/**
 * Deterministic findings planner — playtest adapter (P21 / P23).
 *
 * Not rules-core. Pure: no Date, no Math.random, no I/O. Caps bound work.
 */

import { speed } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  PointId,
  RulesPort,
  StepMove,
  VertexId,
} from '@conquarrow/contracts';

export type FindingKind =
  | 'claim_share'
  | 'approach_spawner'
  | 'cut'
  | 'intercept'
  | 'close'
  | 'attack'
  | 'merge_pair';

export interface Finding {
  readonly kind: FindingKind;
  readonly from: ArrowId;
  readonly goal: ArrowId;
  readonly cost: number;
  readonly reward: number;
  readonly score: number;
  readonly move: StepMove;
}

export interface FindingsCaps {
  readonly maxFindings: number;
  readonly distCap: number;
}

export const DEFAULT_FINDINGS_CAPS: FindingsCaps = {
  maxFindings: 8,
  distCap: 12,
};

/**
 * Layout positions for Euclidean triangle interior (P23). Satisfied by
 * `TilingLayout` from `@conquarrow/geometry-tiling`.
 */
export interface FindingsLayout {
  pointPosition(point: PointId): { readonly x: number; readonly y: number };
  vertexPosition(vertex: VertexId): { readonly x: number; readonly y: number };
}

const AREA_EPS = 1e-6;

type Vec2 = { readonly x: number; readonly y: number };

const signedArea2 = (a: Vec2, b: Vec2, c: Vec2): number =>
  a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);

const strictlyInsideTriangle = (a: Vec2, b: Vec2, c: Vec2, p: Vec2): boolean => {
  const area = signedArea2(a, b, c);
  if (Math.abs(area) < AREA_EPS) return false;
  const a1 = signedArea2(p, b, c) / area;
  const a2 = signedArea2(a, p, c) / area;
  const a3 = signedArea2(a, b, p) / area;
  return a1 > 0 && a2 > 0 && a3 > 0;
};

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Σ spawner force (`num/den` as number) for vertices strictly inside triangle
 * apex–p0–p1 in layout space (P23 D6).
 */
export const forceInsideTriangle = (
  layout: FindingsLayout,
  state: GameState,
  apex: PointId,
  p0: PointId,
  p1: PointId,
): number => {
  const A = layout.pointPosition(apex);
  const B = layout.pointPosition(p0);
  const C = layout.pointPosition(p1);
  let x = 0;
  for (const [vertex, spawner] of state.spawners) {
    if (strictlyInsideTriangle(A, B, C, layout.vertexPosition(vertex))) {
      x += spawner.force.num / spawner.force.den;
    }
  }
  return x;
};

/**
 * Intercept reward schedule: `clamp(25, 105, round(160 * x / max(1, n)))` (P23 D12).
 */
export const interceptReward = (x: number, n: number): number => {
  const raw = Math.round((160 * x) / Math.max(1, n));
  return Math.min(105, Math.max(25, raw));
};

/** Grain steps along out-arrows from `start` to any arrow owned as `player` territory. */
const distanceToTerritory = (
  geometry: GeometryPort,
  state: GameState,
  player: PlayerId,
  start: ArrowId,
  cap: number,
): number => {
  if (state.territory.get(start) === player) return 0;
  const seen = new Set<string>([String(start)]);
  let frontier: ArrowId[] = [start];
  for (let d = 1; d <= cap; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const exit of geometry.outArrows(geometry.target(arrow))) {
        const key = String(exit);
        if (seen.has(key)) continue;
        if (state.territory.get(exit) === player) return d;
        seen.add(key);
        next.push(exit);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return cap + 1;
};

/**
 * Off-trail arrows from which a step onto `enemy`'s trail cuts (isCutMove).
 * On-trail cut-froms are excluded — approaching along the trail is not the
 * intercept race (P23 D9 / fixture cutter).
 */
const cutFromArrowsForTrail = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  enemy: PlayerId,
): readonly ArrowId[] => {
  const trail = state.trails.get(enemy);
  if (trail === undefined || trail.size === 0) return [];
  const trailKeys = new Set([...trail].map(String));
  const found: ArrowId[] = [];
  const seen = new Set<string>();

  const exits = [...trail].toSorted((a, b) => compareIds(String(a), String(b)));
  for (const exit of exits) {
    const ins = [...geometry.inArrows(geometry.origin(exit))].toSorted((a, b) =>
      compareIds(String(a), String(b)),
    );
    for (const from of ins) {
      const fromKey = String(from);
      if (trailKeys.has(fromKey) || seen.has(fromKey)) continue;
      if (!geometry.outArrows(geometry.target(from)).includes(exit)) continue;

      const hypoGroups = new Map(state.groups);
      for (const [arrow, group] of state.groups) {
        if (group.owner === me) hypoGroups.delete(arrow);
      }
      hypoGroups.set(from, { owner: me, heads: 1, spent: 0 });
      const hypo: GameState = { ...state, activePlayer: me, groups: hypoGroups };

      let cuts = false;
      try {
        for (const m of rules.legalMoves(hypo)) {
          if (m.kind !== 'step' || m.from !== from || m.exit !== exit) continue;
          const after = rules.apply(hypo, m);
          if (isCutMove(hypo, after, me)) {
            cuts = true;
            break;
          }
        }
      } catch {
        cuts = false;
      }
      if (!cuts) continue;
      seen.add(fromKey);
      found.push(from);
    }
  }
  return found.toSorted((a, b) => compareIds(String(a), String(b)));
};

const frontierPointsInWindow = (
  geometry: GeometryPort,
  state: GameState,
  enemy: PlayerId,
  apex: PointId,
  distCap: number,
): readonly PointId[] => {
  const win = new Set(geometry.window(apex, distCap).points.map(String));
  const pts = new Set<PointId>();
  for (const [arrow, owner] of state.territory) {
    if (owner !== enemy) continue;
    const o = geometry.origin(arrow);
    const t = geometry.target(arrow);
    if (win.has(String(o))) pts.add(o);
    if (win.has(String(t))) pts.add(t);
  }
  return [...pts].toSorted((a, b) => compareIds(String(a), String(b)));
};

/** Pick frontier pair maximising force inside apex–p0–p1 (positive area only). */
const bestTriangleForce = (
  layout: FindingsLayout,
  state: GameState,
  apex: PointId,
  frontier: readonly PointId[],
): number | undefined => {
  if (frontier.length < 2) return undefined;
  const apexP = layout.pointPosition(apex);
  let bestX = -1;
  for (let i = 0; i < frontier.length; i += 1) {
    const p0 = frontier[i];
    if (p0 === undefined) continue;
    for (let j = i + 1; j < frontier.length; j += 1) {
      const p1 = frontier[j];
      if (p1 === undefined) continue;
      const A = layout.pointPosition(p0);
      const B = layout.pointPosition(p1);
      if (Math.abs(signedArea2(apexP, A, B)) < AREA_EPS) continue;
      const x = forceInsideTriangle(layout, state, apex, p0, p1);
      if (x > bestX) bestX = x;
    }
  }
  return bestX < 0 ? undefined : bestX;
};

type CutApproach = {
  readonly n: number;
  readonly move: StepMove;
  readonly heads: number;
  readonly goal: ArrowId;
};

/** Min grain distance to an off-trail cut-from, plus the step that shrinks it (D9). */
const bestApproachToCut = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  byFrom: ReadonlyMap<string, readonly StepMove[]>,
  cutFroms: readonly ArrowId[],
  distCap: number,
): CutApproach | undefined => {
  let best: CutApproach | undefined;

  for (const [, moves] of [...byFrom.entries()].toSorted((a, b) => compareIds(a[0], b[0]))) {
    const from = moves[0]?.from;
    if (from === undefined) continue;
    const group = state.groups.get(from);
    if (group === undefined || group.owner !== me) continue;

    const seedGoal = cutFroms[0];
    if (seedGoal === undefined) continue;
    let goal = seedGoal;
    let n = distCap + 1;
    for (const cutFrom of cutFroms) {
      const d = grainDistance(geometry, from, cutFrom, distCap);
      if (d < n || (d === n && String(cutFrom) < String(goal))) {
        n = d;
        goal = cutFrom;
      }
    }
    if (n > distCap) continue;

    let chosen: StepMove | undefined;
    if (n === 0) {
      for (const m of moves) {
        try {
          const after = rules.apply(state, m);
          if (!isCutMove(state, after, me)) continue;
          if (chosen === undefined || moveKey(m) < moveKey(chosen)) chosen = m;
        } catch {
          continue;
        }
      }
    } else {
      let bestN1 = Number.POSITIVE_INFINITY;
      for (const m of moves) {
        const n1 = grainDistance(geometry, m.exit, goal, distCap);
        if (n1 >= n) continue;
        if (
          chosen === undefined ||
          n1 < bestN1 ||
          (n1 === bestN1 && moveKey(m) < moveKey(chosen))
        ) {
          bestN1 = n1;
          chosen = m;
        }
      }
    }
    if (chosen === undefined) continue;

    if (
      best === undefined ||
      n < best.n ||
      (n === best.n && moveKey(chosen) < moveKey(best.move))
    ) {
      best = { n, move: chosen, heads: group.heads, goal };
    }
  }

  return best;
};

/**
 * Approach steps toward in-time cuts of enemy territory-grade tips (P23).
 * Called only when a layout is supplied to {@link collectFindings}.
 */
export const collectInterceptFindings = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  caps: FindingsCaps,
  layout: FindingsLayout,
): readonly Finding[] => {
  const legal = rules.legalMoves(state).filter((m): m is StepMove => m.kind === 'step');
  if (legal.length === 0) return [];

  const byFrom = new Map<string, StepMove[]>();
  for (const m of legal) {
    const key = String(m.from);
    const list = byFrom.get(key) ?? [];
    list.push(m);
    byFrom.set(key, list);
  }

  const out: Finding[] = [];
  const enemies = state.players.filter((p) => p !== me);

  for (const enemy of enemies) {
    const trail = state.trails.get(enemy);
    if (trail === undefined || trail.size < 3) continue;

    const tips = [...state.groups.entries()]
      .filter(([arrow, group]) => group.owner === enemy && trail.has(arrow))
      .map(([arrow]) => arrow)
      .toSorted((a, b) => compareIds(String(a), String(b)));

    const cutFroms = cutFromArrowsForTrail(geometry, rules, state, me, enemy);
    if (cutFroms.length === 0) continue;

    for (const tip of tips) {
      if (rules.anchorGrade(state, tip, enemy) !== 'territory') continue;

      const tipHeads = state.groups.get(tip)?.heads ?? 1;
      const dClose = distanceToTerritory(geometry, state, enemy, tip, caps.distCap);
      const enemyETA = Math.ceil(dClose / speed(tipHeads));

      const apex = geometry.target(tip);
      const frontier = frontierPointsInWindow(geometry, state, enemy, apex, caps.distCap);
      const x = bestTriangleForce(layout, state, apex, frontier);
      if (x === undefined) continue;

      const best = bestApproachToCut(
        geometry,
        rules,
        state,
        me,
        byFrom,
        cutFroms,
        caps.distCap,
      );
      if (best === undefined) continue;

      const botETA = Math.ceil(best.n / speed(best.heads));
      if (botETA > enemyETA) continue;

      const cost = Math.max(1, best.n);
      const reward = interceptReward(x, best.n);
      out.push({
        kind: 'intercept',
        from: best.move.from,
        goal: best.goal,
        cost,
        reward,
        score: scoreOf(reward, cost),
        move: best.move,
      });
    }
  }

  return out;
};

const moveKey = (move: Move): string => {
  switch (move.kind) {
    case 'step':
      return `step:${String(move.from)}>${String(move.exit)}:${String(move.count)}`;
    case 'endTurn':
      return 'endTurn';
  }
};

const compareFindings = (a: Finding, b: Finding): number => {
  if (a.score !== b.score) return b.score - a.score;
  const ka = moveKey(a.move);
  const kb = moveKey(b.move);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};

const scoreOf = (reward: number, cost: number): number => reward * 100 - cost * 10;

const territoryOf = (state: GameState, player: PlayerId): number => {
  let n = 0;
  for (const owner of state.territory.values()) if (owner === player) n += 1;
  return n;
};

/** Spawner-border arrows already owned as territory (true shares). */
const shareCountOf = (
  geometry: GeometryPort,
  state: GameState,
  player: PlayerId,
): number => {
  let n = 0;
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) {
      if (state.territory.get(arrow) === player) n += 1;
    }
  }
  return n;
};

const isClosingMove = (
  before: GameState,
  after: GameState,
  me: PlayerId,
  move: StepMove,
): boolean => {
  const wasOnTrail = before.trails.get(me)?.has(move.from) ?? false;
  if (!wasOnTrail) return false;
  const landedHome = before.territory.get(move.exit) === me;
  const gained = territoryOf(after, me) > territoryOf(before, me);
  return landedHome || gained;
};

const isCutMove = (before: GameState, after: GameState, me: PlayerId): boolean => {
  for (const [player, set] of before.trails) {
    if (player === me) continue;
    const afterSize = after.trails.get(player)?.size ?? 0;
    if (afterSize < set.size) return true;
  }
  return false;
};

/** Grain BFS distance from start to goal (out-arrows only). */
export const grainDistance = (
  geometry: GeometryPort,
  start: ArrowId,
  goal: ArrowId,
  cap: number,
): number => {
  if (start === goal) return 0;
  const seen = new Set<string>([String(start)]);
  let frontier: ArrowId[] = [start];
  for (let d = 1; d <= cap; d += 1) {
    const next: ArrowId[] = [];
    for (const arrow of frontier) {
      for (const exit of geometry.outArrows(geometry.target(arrow))) {
        const key = String(exit);
        if (seen.has(key)) continue;
        if (exit === goal) return d;
        seen.add(key);
        next.push(exit);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return cap + 1;
};

const openSpawnerBorders = (
  geometry: GeometryPort,
  state: GameState,
): ArrowId[] => {
  const out: ArrowId[] = [];
  const vertices = [...state.spawners.keys()].toSorted((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
  for (const vertex of vertices) {
    const borders = [...geometry.borderArrows(vertex)].toSorted((a, b) =>
      String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
    );
    for (const border of borders) {
      if (state.territory.get(border) === undefined) out.push(border);
    }
  }
  return out;
};

const pickPortion = (heads: number, preferred: number): number => {
  if (heads <= 0) return 1;
  if (preferred <= heads) return preferred;
  // Prefer power-of-two shaped leave/take when possible.
  if (heads >= 2) return 2;
  return 1;
};

/**
 * Ranked findings for `me`. Immediate legal steps only; cost is grain distance
 * to the goal (or 1 for tactical findings on the exit itself).
 *
 * Pass `layout` to enable P23 intercept findings (Euclidean triangle value).
 */
export const collectFindings = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  caps: FindingsCaps = DEFAULT_FINDINGS_CAPS,
  layout?: FindingsLayout,
): readonly Finding[] => {
  const legal = rules.legalMoves(state).filter((m): m is StepMove => m.kind === 'step');
  if (legal.length === 0) return [];

  const byFrom = new Map<string, StepMove[]>();
  for (const m of legal) {
    const key = String(m.from);
    const list = byFrom.get(key) ?? [];
    list.push(m);
    byFrom.set(key, list);
  }

  const openShares = openSpawnerBorders(geometry, state);
  const found: Finding[] = [];
  const seenMove = new Set<string>();

  const push = (finding: Finding): void => {
    const key = moveKey(finding.move);
    if (seenMove.has(key)) return;
    seenMove.add(key);
    found.push(finding);
  };

  for (const move of legal) {
    let after: GameState;
    try {
      after = rules.apply(state, move);
    } catch {
      continue;
    }
    const group = state.groups.get(move.from);
    const heads = group?.heads ?? 1;

    if (isClosingMove(state, after, me, move)) {
      const cost = 1;
      const reward = 90;
      push({
        kind: 'close',
        from: move.from,
        goal: move.exit,
        cost,
        reward,
        score: scoreOf(reward, cost),
        move,
      });
    }
    if (isCutMove(state, after, me)) {
      const cost = 1;
      const reward = 70;
      push({
        kind: 'cut',
        from: move.from,
        goal: move.exit,
        cost,
        reward,
        score: scoreOf(reward, cost),
        move,
      });
    }
    const dest = state.groups.get(move.exit);
    if (dest !== undefined && dest.owner !== me) {
      const cost = 1;
      const reward = 55;
      push({
        kind: 'attack',
        from: move.from,
        goal: move.exit,
        cost,
        reward,
        score: scoreOf(reward, cost),
        move,
      });
    }
    const left = heads - move.count;
    if (move.count === 2 || left === 2) {
      const cost = 1;
      const reward = 25;
      push({
        kind: 'merge_pair',
        from: move.from,
        goal: move.exit,
        cost,
        reward,
        score: scoreOf(reward, cost),
        move,
      });
    }
    // Visiting an unclaimed spawner border is not a claim — only a close that
    // raises share count is. False claim_share bait milled tips on pinwheels.
    if (shareCountOf(geometry, after, me) > shareCountOf(geometry, state, me)) {
      const cost = 1;
      const reward = 100;
      push({
        kind: 'claim_share',
        from: move.from,
        goal: move.exit,
        cost,
        reward,
        score: scoreOf(reward, cost),
        move,
      });
    }
  }

  // P23: after immediate cuts (dedup: cut wins) and before approach_spawner.
  if (layout !== undefined) {
    for (const finding of collectInterceptFindings(
      geometry,
      rules,
      state,
      me,
      caps,
      layout,
    )) {
      push(finding);
    }
  }

  for (const [, moves] of [...byFrom.entries()].toSorted((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    const from = moves[0]?.from;
    if (from === undefined) continue;
    // Already on an open share: hopping to a sibling border is a pinwheel mill,
    // not progress. Closing / evaluate homeward owns the next decision.
    if (openShares.some((s) => s === from)) continue;
    const group = state.groups.get(from);
    const heads = group?.heads ?? 1;
    const nearestGoals = openShares
      .map((goal) => ({
        goal,
        d: grainDistance(geometry, from, goal, caps.distCap),
      }))
      .filter((g) => g.d > 0 && g.d <= caps.distCap)
      .toSorted((a, b) =>
        a.d !== b.d ? a.d - b.d : compareIds(String(a.goal), String(b.goal)),
      )
      .slice(0, 3);
    for (const { goal, d: d0 } of nearestGoals) {
      let best: { move: StepMove; d1: number } | undefined;
      for (const m of moves) {
        const d1 = grainDistance(geometry, m.exit, goal, caps.distCap);
        if (d1 >= d0) continue;
        if (
          best === undefined ||
          d1 < best.d1 ||
          (d1 === best.d1 && moveKey(m) < moveKey(best.move))
        ) {
          best = { move: m, d1 };
        }
      }
      if (best === undefined) continue;
      const preferred = pickPortion(heads, best.move.count);
      const adjusted =
        moves.find(
          (m) =>
            m.exit === best.move.exit &&
            m.count === preferred &&
            grainDistance(geometry, m.exit, goal, caps.distCap) < d0,
        ) ?? best.move;
      const cost = Math.max(1, best.d1);
      const reward = 40;
      push({
        kind: 'approach_spawner',
        from,
        goal,
        cost,
        reward,
        score: scoreOf(reward, cost),
        move: adjusted,
      });
    }
  }

  return found.toSorted(compareFindings).slice(0, caps.maxFindings);
};

/** Prefer tactical closes/claims/cuts over long approaches when both exist. */
export const bestFindingMove = (
  geometry: GeometryPort,
  rules: RulesPort,
  state: GameState,
  me: PlayerId,
  caps: FindingsCaps = DEFAULT_FINDINGS_CAPS,
  layout?: FindingsLayout,
): StepMove | undefined => {
  const findings = collectFindings(geometry, rules, state, me, caps, layout);
  const priority: readonly FindingKind[] = [
    'close',
    'claim_share',
    'cut',
    'intercept',
    'attack',
    'approach_spawner',
    'merge_pair',
  ];
  for (const kind of priority) {
    const hit = findings.find((f) => f.kind === kind);
    if (hit !== undefined) return hit.move;
  }
  return findings[0]?.move;
};
