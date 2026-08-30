/**
 * Scaffolding for the immediate-loss suite (P37).
 *
 * Two things this adds over `losing.support.ts`, and both are what P37 is about:
 *
 * 1. **Every state a replay passes through**, not just its endpoint. Invariants 9
 *    and 10 are the item-44 chain — *some seat always owns a share*, *some seat is
 *    never lost* — and quantifying them over the endpoints only would miss the one
 *    move that briefly emptied the board. {@link statesAlong} folds a record and
 *    keeps the whole trace.
 * 2. **The reported playtest log**, replayed from the repo rather than from a
 *    download. `playtestLog` reads a committed fixture and rebuilds the opening
 *    with `makeMatch(config)` plus the frozen 2026-08-20 spawner field, so the
 *    regression the packet was filed for is a test and not an anecdote. The
 *    snapshot is the board as played that day — **not** what current
 *    `makeMatch` emits after P41's orbit-representative thinning. P41's own
 *    tests use live `makeMatch`.
 *
 * Same standing rules as the rest of the suite: states are hand-authored and
 * boards are not, and a setup failure throws a plain `Error` so it can never be
 * mistaken for a rule failure.
 *
 * @see docs/spec/immediate-loss/immediate-loss.md
 */

import { readFileSync } from 'node:fs';
import { endTurn, mintArrowId, mintVertexId, movesEqual, rational, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  MatchConfig,
  Move,
  PlayerId,
  RulesPort,
  Spawner,
  VertexId,
} from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '../src/index';
import { isLost, shareCountOf } from '../src/victory';
import { A, B, C, D, aBoard, aVertex, bareArrow, held, seatState, shareArrow } from './losing.support';
import type { Ground } from './losing.support';
import { aRingWithAnInside, arrowAt, byId, exitsFrom } from './support';

// ── the committed playtest log ────────────────────────────────────────────────

/** The move shapes an adapter-side match log writes (`packages/web/src/matchLog.ts`). */
interface LoggedMove {
  readonly kind: string;
  readonly from?: string;
  readonly exit?: string;
  readonly count?: number;
}

interface LoggedMatch {
  readonly version: number;
  readonly config: MatchConfig;
  readonly moves: readonly LoggedMove[];
  readonly winner?: string;
}

export interface PlaytestLog {
  readonly config: MatchConfig;
  readonly moves: readonly Move[];
  /** The winner the adapter recorded when the match ended. */
  readonly winner: string;
  /**
   * Opening board for **this** log. Homes/groups/territory come from live
   * `makeMatch`; spawners are the frozen 2026-08-20 field.
   */
  readonly opening: GameState;
}

interface FrozenSpawner {
  readonly force: { readonly num: number; readonly den: number };
  readonly phase: number;
}

/**
 * The 2026-08-20 opening spawners, as played. Sampled at each vertex itself
 * (pre-P41), not at the orbit representative. Not what live `makeMatch` emits.
 */
const frozenPlaytestSpawners = (): Map<VertexId, Spawner> => {
  const raw = readFileSync(
    new URL('./fixtures/playtest-2026-08-20-D-wins.spawners.json', import.meta.url),
    'utf8',
  );
  const entries = JSON.parse(raw) as readonly (readonly [string, FrozenSpawner])[];
  return new Map(
    entries.map(([id, spawner]) => [
      mintVertexId(id),
      { force: rational(spawner.force.num, spawner.force.den), phase: spawner.phase },
    ]),
  );
};

/**
 * The 2026-08-20 six-seat hot-seat log the packet was filed for, as moves.
 *
 * Committed under `test/fixtures/` on purpose: a test that read `~/Downloads`
 * would pass on one machine and be a missing-file error everywhere else.
 *
 * `opening` is the choke point for this log: every P37/P38 consumer must use
 * it rather than `makeMatch(log.config)`, which would rebuild today's mirrored
 * field and refuse the recorded steps around ply 459.
 *
 * **P47:** the current engine will not fold the whole 1247-move record. Extra
 * evaporation demotes an E trail; P28 then refuses the recorded step at
 * {@link P47_FIRST_UNPLAYABLE}. The log is a prefix golden from there — P37/P38
 * win timing stays on the hand-authored fixtures.
 */
export const playtestLog = (): PlaytestLog => {
  const raw = readFileSync(
    new URL('./fixtures/playtest-2026-08-20-D-wins.json', import.meta.url),
    'utf8',
  );
  const parsed = JSON.parse(raw) as LoggedMatch;
  if (parsed.winner === undefined) throw new Error('setup: that log records no winner');
  const opening = makeMatch(parsed.config);
  return {
    config: parsed.config,
    moves: parsed.moves.map(asMove),
    winner: parsed.winner,
    opening: { ...opening, spawners: frozenPlaytestSpawners() },
  };
};

const requireArrow = (raw: string | undefined, what: string): ArrowId => {
  if (raw === undefined) throw new Error(`setup: a logged move has no ${what}`);
  return mintArrowId(raw);
};

const asMove = (logged: LoggedMove): Move => {
  switch (logged.kind) {
    case 'endTurn':
      return { kind: 'endTurn' };
    case 'step':
      return {
        kind: 'step',
        from: requireArrow(logged.from, 'from'),
        exit: requireArrow(logged.exit, 'exit'),
        count: logged.count ?? 1,
      };
    default:
      throw new Error(`setup: a logged move has an unknown kind ${logged.kind}`);
  }
};

/**
 * First recorded move the current engine will not offer (P47).
 *
 * P47's incidence flood evaporates sibling fork arms the 2026-08-20 engine left
 * standing. On this log that demotes an E trail on F land to stack-grade, so
 * P28 refuses E's recorded step `3,-4,0 → 4,-4,0` (zero-based **233**). The log
 * is a **prefix golden** of that length, not a full-match golden. P37/P38
 * (winner at 1242, refuse at 1243) stay proven on `aMatchLosingThree` and
 * `aWonPosition`.
 *
 * Measured once: `statesAlong(rules, playtestLog().opening, playtestLog().moves).refusedAt`.
 */
export const P47_FIRST_UNPLAYABLE = 233;

/**
 * Floor on the P47 prefix length so a 0-move fold cannot satisfy the item-44
 * chain vacuously. The prefix is 233 stops; 200 still bites.
 */
export const P47_PREFIX_FLOOR = 200;

// ── every state a record passes through ──────────────────────────────────────

export interface Stop {
  /** Zero-based index of the move that produced this state. */
  readonly at: number;
  readonly move: Move;
  readonly state: GameState;
}

/**
 * The initial state followed by the state after each move.
 *
 * Stops at the first move `legalMoves` does not offer and reports it, rather
 * than throwing: *a lost seat is offered no move* (invariant 4) makes a refusal
 * the expected end of a log that was recorded under the old timing, and the
 * index it stops at is exactly what the regression test asserts.
 */
export const statesAlong = (
  rules: RulesPort,
  initial: GameState,
  moves: readonly Move[],
): { readonly stops: readonly Stop[]; readonly refusedAt: number | undefined } => {
  const stops: Stop[] = [];
  let state = initial;
  for (let index = 0; index < moves.length; index += 1) {
    const move = moves[index];
    if (move === undefined) throw new Error('setup: a hole in the move list');
    if (!offers(rules, state, move)) return { stops, refusedAt: index };
    state = rules.apply(state, move);
    stops.push({ at: index, move, state });
  }
  return { stops, refusedAt: undefined };
};

const offers = (rules: RulesPort, state: GameState, move: Move): boolean =>
  rules.legalMoves(state).some((offered) => movesEqual(offered, move));

/** The index of the first stop whose state has a winner, or `undefined`. */
export const firstWinnerAt = (stops: readonly Stop[]): number | undefined =>
  stops.find((stop) => stop.state.winner !== undefined)?.at;

// ── reading the item-44 chain off a state ────────────────────────────────────

/** Whether any seat owns at least one spawner share — invariant 9. */
export const someSeatOwnsAShare = (state: GameState, geometry: GeometryPort): boolean =>
  state.players.some((player) => shareCountOf(state, player, geometry) > 0);

/** Whether any seat is still playing — invariant 10. */
export const someSeatIsAlive = (state: GameState, geometry: GeometryPort): boolean =>
  state.players.some((player) => !isLost(state, player, geometry));

/** Every arrow bordering a spawner, whoever owns it. */
export const shareArrowsOf = (
  state: GameState,
  geometry: GeometryPort,
): ReadonlySet<ArrowId> => {
  const shares = new Set<ArrowId>();
  for (const vertex of state.spawners.keys()) {
    for (const arrow of geometry.borderArrows(vertex)) shares.add(arrow);
  }
  return shares;
};

/** Owned spawner-border arrows, as `arrow -> owner`, for a before/after compare. */
export const ownedSharesOf = (
  state: GameState,
  geometry: GeometryPort,
): ReadonlyMap<string, string> => {
  const owned = new Map<string, string>();
  for (const arrow of shareArrowsOf(state, geometry)) {
    const owner = state.territory.get(arrow);
    if (owner !== undefined) owned.set(String(arrow), String(owner));
  }
  return owned;
};

/** Seats the derived predicate calls lost, in `state.players` order. */
export const lostAlong = (
  state: GameState,
  geometry: GeometryPort,
): readonly string[] => state.players.filter((p) => isLost(state, p, geometry)).map(String);

/** Arrows this player holds, as sorted strings. */
export const landOf = (state: GameState, player: PlayerId): readonly string[] =>
  [...state.territory.entries()]
    .filter(([, owner]) => owner === player)
    .map(([arrow]) => String(arrow))
    .toSorted();

// ── a hand-authored record that loses three seats ────────────────────────────

/** An exit from `arrow` that nobody owns — a step that cannot convert itself. */
export const clearExit = (ground: Ground, state: GameState, arrow: ArrowId): ArrowId => {
  const found = exitsFrom(ground.geometry, arrow).find(
    (exit) => !state.territory.has(exit) && !state.groups.has(exit),
  );
  if (found === undefined) throw new Error('setup: every exit is owned or occupied');
  return found;
};

/**
 * The record: A and B hold bare ground and heads, so they are on the starvation
 * clock; C holds bare ground and nothing else, so C goes on the first move that
 * resolves. D holds a share. The threshold is two rounds, so A and B follow at
 * the second boundary and D is left alone.
 */
export const aMatchLosingThree = (): {
  ground: Ground;
  initial: GameState;
  moves: readonly Move[];
} => {
  const ground = aBoard();
  const aStack = bareArrow(ground, 3);
  const bStack = bareArrow(ground, 4);
  const dStack = shareArrow(ground, 2);
  const initial = seatState({
    players: [A, B, C, D],
    groups: [
      { arrow: aStack, owner: A, heads: 1 },
      { arrow: bStack, owner: B, heads: 1 },
      { arrow: dStack, owner: D, heads: 2 },
    ],
    territory: [
      ...held([bareArrow(ground, 0)], A),
      ...held([bareArrow(ground, 1)], B),
      // C: territory, no share, no head — lost the moment anything resolves.
      ...held([bareArrow(ground, 2)], C),
      { arrow: dStack, owner: D },
    ],
    accumulators: [[dStack, rational(2, 3)]],
    spawners: [[aVertex(ground), { force: rational(1, 3), phase: 2 }]],
    dominationN: 2,
  });
  const aExit = clearExit(ground, initial, aStack);
  const dExit = clearExit(ground, initial, dStack);
  const moves: readonly Move[] = [
    // Round 1 — A wanders, B stands (naming no move at all), C is passed, D
    // pushes a head out.
    step(aStack, aExit, 1),
    endTurn(),
    endTurn(),
    endTurn(),
    step(dStack, dExit, 1),
    endTurn(),
    // Round 2 — everyone ends. The boundary takes A and B together.
    endTurn(),
    endTurn(),
    endTurn(),
    endTurn(),
  ];
  return { ground, initial, moves };
};


// ── the one step that takes a seat's last arrow ──────────────────────────────

/**
 * A land bridge on the generated tiling: one arrow of trail, departing the
 * mover's own ground and landing back on it (§7 / P05b).
 *
 * This is the only shape that *takes* territory on one step without needing fill,
 * which is why every "the move that decides it" scenario is built on it: the
 * arrow the bridge claims can be authored as the victim's last territory, and the
 * claim changes its owner rather than clearing it.
 *
 * The tiling rather than a fixture, because closure asks *cannot reach infinity*
 * and a finite board has no infinity to fail to reach (P02 measurement, §11 item 4).
 */
export interface LandBridge {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  /** The mover's departure ground. */
  readonly home: ArrowId;
  /** The single trail arrow the bridge claims — author it as the victim's last. */
  readonly bridge: ArrowId;
  /** The mover's ground the bridge lands on. */
  readonly landing: ArrowId;
  /** Arrows well clear of the bridge, for holdings that must not touch it. */
  readonly far: readonly ArrowId[];
}

export const aLandBridge = (): LandBridge => {
  const geometry = makeTiling();
  const home = geometry.inArrows(geometry.seedPoint())[0];
  if (home === undefined) throw new Error('setup: the seed point has no in-arrow');
  const bridge = geometry.outArrows(geometry.target(home))[0];
  if (bridge === undefined) throw new Error('setup: no arrow leaves the home');
  const landing = geometry.outArrows(geometry.target(bridge))[0];
  if (landing === undefined) throw new Error('setup: the bridge has no landing');
  const used = new Set([home, bridge, landing].map(String));
  const far = geometry
    .window(geometry.seedPoint(), 6)
    .arrows.filter((arrow) => !used.has(String(arrow)))
    // Total comparator (see `byId` in ./support) — descending.
    .toSorted((left, right) => byId(right, left));
  if (far.length < 4) throw new Error('setup: the board offered too few arrows clear of the bridge');
  return { geometry, rules: makeRules(geometry), home, bridge, landing, far };
};

/** One of a bridge's far arrows, index-checked. */
export const farArrow = (bridge: LandBridge, index: number): ArrowId => {
  const arrow = bridge.far[index];
  if (arrow === undefined) throw new Error(`setup: no far arrow ${String(index)}`);
  return arrow;
};

/** The step that walks the bridge and claims it. */
export const crossing = (bridge: LandBridge): Move => step(bridge.bridge, bridge.landing, 1);

// ── a loop with an enemy arrow inside it ─────────────────────────────────────

/**
 * A directed 6-cycle on the tiling that A can close in **one step**, with an
 * arrow genuinely *inside* it.
 *
 * The land bridge above claims the path and encloses nothing; this is the other
 * shape, and the one the core feature's *closure taking the last enemy territory*
 * scenario now asks for — the victim's last arrow **lies inside** the loop rather
 * than being the arrow the mover walks. So the claim has to be a real fill: an
 * arrow from which no walk escapes, which no finite fixture board can host (§11
 * item 4), hence the tiling.
 *
 * The loop is closed by a single step from {@link tip} onto {@link home}, which is
 * the mover's own territory — departing your ground and landing back on it (§7).
 */
export interface EncirclingLoop {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  /** The mover's territory the loop departs from and lands back on. */
  readonly home: ArrowId;
  /** The trail arrow the closing step is taken from. */
  readonly tip: ArrowId;
  /** The mover's trail before the closing step — the loop bar `home`. */
  readonly trail: readonly ArrowId[];
  /** An arrow the closed loop rings — author it as the victim's last territory. */
  readonly inside: ArrowId;
  /** An arrow well outside the loop, for holdings the closure must not touch. */
  readonly far: ArrowId;
}

export const anEncirclingLoop = (): EncirclingLoop => {
  const geometry = makeTiling();
  const ring = aRingWithAnInside(geometry);
  return {
    geometry,
    rules: makeRules(geometry),
    home: arrowAt(ring.wall, 0),
    tip: arrowAt(ring.wall, ring.wall.length - 1),
    trail: ring.wall.slice(1),
    inside: ring.inside,
    far: ring.far,
  };
};

/** The one step that closes the loop and claims what it rings. */
export const closingStep = (loop: EncirclingLoop): Move => step(loop.tip, loop.home, 1);

// ── counting how often a state's maps are walked ─────────────────────────────

export interface CountedMap<K, V> {
  /** A `ReadonlyMap` indistinguishable from the original bar the counter. */
  readonly map: ReadonlyMap<K, V>;
  /** How many times something has started iterating it. */
  readonly traversals: () => number;
}

/**
 * A `ReadonlyMap` that counts **traversals** — not element reads.
 *
 * The currency the *counts are read in one pass, not once per player* scenario
 * needs. `get` and `has` are free; `entries`, `keys`, `values`, `forEach` and
 * spreading each cost one. An implementation that scans `territory` once per seat
 * therefore costs one traversal per seat and its count grows with the seat list,
 * while a single pass costs the same on a two-seat board and a six-seat one — and
 * *that difference* is what a test can assert without pinning a shape phase 3 is
 * free to choose.
 */
export const countingMap = <K, V>(source: ReadonlyMap<K, V>): CountedMap<K, V> => {
  const inner = new Map(source);
  let traversals = 0;
  const walked = <T>(iterator: IterableIterator<T>): IterableIterator<T> => {
    traversals += 1;
    return iterator;
  };
  const map: ReadonlyMap<K, V> = {
    get size() {
      return inner.size;
    },
    get: (key) => inner.get(key),
    has: (key) => inner.has(key),
    entries: () => walked(inner.entries()),
    keys: () => walked(inner.keys()),
    values: () => walked(inner.values()),
    forEach: (callback, thisArg) => {
      traversals += 1;
      inner.forEach(callback, thisArg);
    },
    [Symbol.iterator]: () => walked(inner[Symbol.iterator]()),
  };
  return { map, traversals: () => traversals };
};

/** Traversals one call makes, as a delta — the same shape as `vertexReadsOf`. */
export const traversalsOf = (
  counted: readonly { readonly traversals: () => number }[],
  run: () => void,
): number => {
  const total = (): number => counted.reduce((sum, one) => sum + one.traversals(), 0);
  const before = total();
  run();
  return total() - before;
};
