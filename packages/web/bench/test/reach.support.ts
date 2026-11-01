/**
 * P78 fixture positions: hand-authored states on the generated tiling, found
 * through the port rather than from lattice coordinates (as rules-core's own
 * closure and fill suites do). The tiling, not a fixture board, because a
 * finite board encloses everything off the wall (§11 item 36) and so can never
 * show a land bridge.
 *
 * Every seat gets a far-away keepalive — a territory arrow with a head on it —
 * so the §9 loss check on `apply`'s tail never removes a seat a scenario is not
 * about.
 */

import { mintPlayerId } from '@conquarrow/contracts';
import type { ArrowId, GameState, PlayerId } from '@conquarrow/contracts';
import { geometry } from '../src/board';

export const A: PlayerId = mintPlayerId('A');
export const B: PlayerId = mintPlayerId('B');

const exitsFrom = (arrow: ArrowId): readonly ArrowId[] => geometry.outArrows(geometry.target(arrow));

const at = (arrows: readonly ArrowId[], i: number): ArrowId => {
  const hit = arrows[i];
  if (hit === undefined) throw new Error(`setup: no arrow at ${String(i)}`);
  return hit;
};

/** A head-to-tail run of unvisited arrows from `start`. */
export const pathFrom = (start: ArrowId, length: number, avoid: readonly ArrowId[] = []): readonly ArrowId[] => {
  const path: ArrowId[] = [start];
  while (path.length < length) {
    const next = exitsFrom(at(path, path.length - 1)).find((e) => !path.includes(e) && !avoid.includes(e));
    if (next === undefined) throw new Error('setup: no unvisited exit to extend the path');
    path.push(next);
  }
  return path;
};

const seedOut = (): ArrowId => at(geometry.outArrows(geometry.seedPoint()), 0);

/** Two arrows head-to-tail at the seed: a stack on `from` can step onto `exit`. */
export const aStep = (): { readonly from: ArrowId; readonly exit: ArrowId } => {
  const from = seedOut();
  return { from, exit: at(exitsFrom(from), 0) };
};

/** Depart `home`, walk `length` arrows, and the territory arrow the tip lands on. */
export const aRunFromHome = (
  length: number,
): { readonly home: ArrowId; readonly run: readonly ArrowId[]; readonly landing: ArrowId } => {
  const home = at(geometry.inArrows(geometry.seedPoint()), 0);
  const run = pathFrom(at(exitsFrom(home), 0), length, [home]);
  const landing = at(exitsFrom(at(run, length - 1)).filter((e) => !run.includes(e) && e !== home), 0);
  return { home, run, landing };
};

/**
 * A directed 6-cycle from the seed with at least one arrow inside it — the
 * shortest ring with an inside (girth 3 rings nothing, §11 item 16).
 */
export const aRingWithAnInside = (): { readonly wall: readonly ArrowId[]; readonly inside: readonly ArrowId[] } => {
  const start = seedOut();
  const walk = (path: readonly ArrowId[]): readonly ArrowId[] | undefined => {
    const last = at(path, path.length - 1);
    if (path.length === 6) return exitsFrom(last).includes(start) ? path : undefined;
    for (const next of exitsFrom(last)) {
      if (path.includes(next)) continue;
      const found = walk([...path, next]);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const wall = walk([start]);
  if (wall === undefined) throw new Error('setup: no directed 6-cycle at the seed');
  const points = new Set(wall.flatMap((a) => [String(geometry.origin(a)), String(geometry.target(a))]));
  const inside = [...new Set(wall.flatMap(exitsFrom))]
    .filter((a) => !wall.includes(a))
    .filter((a) => points.has(String(geometry.origin(a))) && points.has(String(geometry.target(a))))
    .toSorted((x, y) => (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0));
  if (inside.length === 0) throw new Error('setup: that ring has no inside');
  return { wall, inside };
};

/** Arrows well away from the seed, for keepalives. */
const farAway = (): readonly ArrowId[] => {
  const path = pathFrom(seedOut(), 60);
  return [at(path, 45), at(path, 59)];
};

export interface Stack {
  readonly arrow: ArrowId;
  readonly owner: PlayerId;
  readonly heads: number;
}

export interface Ground {
  readonly trails?: Partial<Record<'A' | 'B', readonly ArrowId[]>>;
  readonly territory?: Partial<Record<'A' | 'B', readonly ArrowId[]>>;
}

/** A two-seat state, A to move, with both keepalives added. */
export const stateOf = (stacks: readonly Stack[], ground: Ground = {}): GameState => {
  const [keepA, keepB] = farAway() as [ArrowId, ArrowId];
  const all: readonly Stack[] = [...stacks, { arrow: keepA, owner: A, heads: 1 }, { arrow: keepB, owner: B, heads: 1 }];
  const territory = new Map<ArrowId, PlayerId>([
    [keepA, A],
    [keepB, B],
  ]);
  for (const arrow of ground.territory?.A ?? []) territory.set(arrow, A);
  for (const arrow of ground.territory?.B ?? []) territory.set(arrow, B);
  return {
    players: [A, B],
    activePlayer: A,
    groups: new Map(all.map((s) => [s.arrow, { owner: s.owner, heads: s.heads, spent: 0 }] as const)),
    trails: new Map([
      [A, new Set(ground.trails?.A ?? [])],
      [B, new Set(ground.trails?.B ?? [])],
    ]),
    territory,
    accumulators: new Map(),
    spawners: new Map(),
    starvationStreaks: new Map(),
    dominationN: 5,
    winner: undefined,
  };
};

export const headsOn = (state: GameState, arrow: ArrowId): { readonly owner: string; readonly heads: number } | undefined => {
  const group = state.groups.get(arrow);
  return group === undefined ? undefined : { owner: String(group.owner), heads: group.heads };
};
