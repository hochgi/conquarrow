/**
 * Fixtures and oracles for P34 ray-run route input.
 *
 * Two boards, one set of helpers: the generated tiling (`geometry` / `rules`)
 * for anything about the real lattice — the nine-per-distance counts, ray
 * straightness by slot, ambiguity beginning at distance 3 — and the hand-authored
 * fixtures (`fixtureBoard`) where a short cycle or a readable failure is the
 * point.
 *
 * The **oracle** here is deliberately *not* the ray construction. It enumerates
 * every walk the engine accepts and counts the shortest routes to each arrow, so
 * "the clickable set is the unique-route set" is checked against an independent
 * measurement rather than against a second copy of the implementation.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintPlayerId, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { MINIMAL, SPACIOUS, makeFixture } from '@conquarrow/geometry-fixtures';
import type { BoardDescription } from '@conquarrow/geometry-fixtures';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { GalconInput } from '../src/input/modes';
import type { InputMode, InputSnapshot, RoutePhase } from '../src/input/modes';
import { reachFrom } from '../src/reach';
import type { Reach } from '../src/reach';
import { MAX_DEPTH } from '../src/route';
import type { ClickableSet, RouteInputs, RouteOption } from '../src/route';

export { MINIMAL, SPACIOUS };

/** The generated tiling — the board the unique-route maths is a property of. */
export const geometry: GeometryPort = makeTiling();
export const rules: RulesPort = makeRules(geometry);

export const A: PlayerId = mintPlayerId('A');
export const B: PlayerId = mintPlayerId('B');

export interface Board {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
}

export const fixtureBoard = (board: BoardDescription): Board => {
  const fixture = makeFixture(board);
  return { geometry: fixture, rules: makeRules(fixture) };
};

export const routeSource = (): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/route.ts'), 'utf8');

export const sortedIds = (arrows: Iterable<ArrowId>): string[] =>
  [...arrows].map(String).toSorted();

/** An empty board: two players, no trail, no territory, no spawner. */
export const blankState = (): GameState => ({
  players: [A, B],
  activePlayer: A,
  groups: new Map(),
  trails: new Map(),
  territory: new Map(),
  accumulators: new Map(),
  spawners: new Map(),
  starvationStreaks: new Map(),
  dominationN: 5,
  winner: undefined,
});

/** One stack of `heads` on an otherwise empty board — no truncation anywhere. */
export const openField = (from: ArrowId, heads: number): GameState =>
  legalSeats({
    ...blankState(),
    groups: new Map([[from, { owner: A, heads, spent: 0 }]]),
  });

/** A board with exactly these groups, plus whatever else a fixture needs. */
export const stateWith = (
  groups: readonly (readonly [ArrowId, { readonly owner: PlayerId; readonly heads: number }])[],
  extra: Partial<GameState> = {},
): GameState =>
  legalSeats({
    ...blankState(),
    groups: new Map(groups.map(([arrow, group]) => [arrow, { ...group, spent: 0 }])),
    ...extra,
  });

/** The first out-arrow of the board's seed point. Named, not invented. */
export const sourceArrow = (board: GeometryPort): ArrowId => {
  const first = board.outArrows(board.seedPoint())[0];
  if (first === undefined) throw new Error('setup: the board offered no out-arrow at its seed');
  return first;
};

export const exitOf = (board: GeometryPort, at: ArrowId, slot: number): ArrowId => {
  const next = board.outArrows(board.target(at))[slot];
  if (next === undefined) {
    throw new Error(`setup: ${String(at)} has no out-slot ${String(slot)}`);
  }
  return next;
};

/** Walk a word of out-slots from `from`, geometrically — no legality asked. */
export const alongSlots = (
  board: GeometryPort,
  from: ArrowId,
  slots: readonly number[],
): ArrowId => {
  let at = from;
  for (const slot of slots) at = exitOf(board, at, slot);
  return at;
};

/** The arrow `steps` hops along one slot — the ray arrow at that distance. */
export const arrowAlong = (
  board: GeometryPort,
  from: ArrowId,
  slot: number,
  steps: number,
): ArrowId => alongSlots(board, from, Array.from({ length: steps }, () => slot));

/** The arrows a slot-walk visits, in order, geometry only. */
export const raySlotWalk = (
  board: GeometryPort,
  from: ArrowId,
  slot: number,
  steps: number,
): readonly ArrowId[] => {
  const out: ArrowId[] = [];
  let at = from;
  for (let i = 0; i < steps; i += 1) {
    at = exitOf(board, at, slot);
    out.push(at);
  }
  return out;
};

// ---------------------------------------------------------------------------
// The oracle: every walk the engine accepts, and the shortest-route count
// ---------------------------------------------------------------------------

export interface RouteCount {
  /** Fewest accepted hops that land on the arrow. */
  readonly distance: number;
  /** How many distinct shortest walks land on it. */
  readonly routes: number;
}

/**
 * Shortest-route counts from `tip`, measured by walking `rules.apply`.
 *
 * Prunes a walk that re-enters `from` or an arrow it already walked: dropping a
 * zero-sum cycle from such a walk gives a strictly shorter one, so no *shortest*
 * route is ever discarded by the prune. Stops extending past occupied ground for
 * the same reason `reach.ts` does — the portion merges there (§3) and stops
 * being separable.
 */
export const shortestRoutes = (
  board: Board,
  state: GameState,
  from: ArrowId,
  carry: number,
  walked: ReadonlySet<ArrowId> = new Set(),
): ReadonlyMap<ArrowId, RouteCount> => {
  const found = new Map<ArrowId, { distance: number; routes: number }>();
  const walk = (scratch: GameState, at: ArrowId, seen: readonly ArrowId[]): void => {
    if (seen.length >= MAX_DEPTH) return;
    for (const exit of board.geometry.outArrows(board.geometry.target(at))) {
      if (exit === from || seen.includes(exit) || walked.has(exit)) continue;
      let next: GameState;
      try {
        next = board.rules.apply(scratch, step(at, exit, carry));
      } catch {
        continue;
      }
      const distance = seen.length + 1;
      const already = found.get(exit);
      if (already === undefined) found.set(exit, { distance, routes: 1 });
      else if (distance < already.distance) {
        already.distance = distance;
        already.routes = 1;
      } else if (distance === already.distance) already.routes += 1;
      if (scratch.groups.get(exit) === undefined) walk(next, exit, [...seen, exit]);
    }
  };
  walk(state, from, []);
  return found;
};

/** Arrows exactly one shortest route reaches — what the clickable set must be. */
export const uniqueRouteSet = (counts: ReadonlyMap<ArrowId, RouteCount>): ReadonlySet<ArrowId> => {
  const unique = new Set<ArrowId>();
  for (const [arrow, count] of counts) {
    if (count.routes === 1) unique.add(arrow);
  }
  return unique;
};

export const atDistance = (
  counts: ReadonlyMap<ArrowId, RouteCount>,
  distance: number,
): readonly ArrowId[] =>
  [...counts.entries()]
    .filter(([, count]) => count.distance === distance)
    .map(([arrow]) => arrow);

export const withRouteCount = (
  counts: ReadonlyMap<ArrowId, RouteCount>,
  distance: number,
  routes: number,
): ArrowId => {
  for (const [arrow, count] of counts) {
    if (count.distance === distance && count.routes === routes) return arrow;
  }
  throw new Error(
    `setup: no arrow at distance ${String(distance)} with ${String(routes)} shortest routes`,
  );
};

// ---------------------------------------------------------------------------
// Walking a draft, and building `RouteInputs`
// ---------------------------------------------------------------------------

export interface Walked {
  /** The scratch state after the steps. */
  readonly state: GameState;
  /** The arrows walked, in order. */
  readonly arrows: readonly ArrowId[];
}

/** Apply `steps` from `tip` at `carry` on a scratch state. Throws if refused. */
export const walkSteps = (
  board: Board,
  state: GameState,
  tip: ArrowId,
  steps: readonly ArrowId[],
  carry: number,
): Walked => {
  let scratch = state;
  let at = tip;
  const arrows: ArrowId[] = [];
  for (const exit of steps) {
    scratch = board.rules.apply(scratch, step(at, exit, carry));
    arrows.push(exit);
    at = exit;
  }
  return { state: scratch, arrows };
};

export const headsOn = (state: GameState, arrow: ArrowId): number =>
  state.groups.get(arrow)?.heads ?? 0;

/** The state after one hop. Throws if the engine refuses it. */
export const applyOnce = (
  board: Board,
  state: GameState,
  at: ArrowId,
  exit: ArrowId,
  carry: number,
): GameState => board.rules.apply(state, step(at, exit, carry));

/** `RouteInputs` for an empty draft at the source. */
export const inputsAt = (
  board: Board,
  state: GameState,
  from: ArrowId,
  carry: number,
): RouteInputs => ({
  geometry: board.geometry,
  rules: board.rules,
  state,
  from,
  tip: from,
  draft: [],
  carry,
  tipHeads: headsOn(state, from),
});

/**
 * `RouteInputs` after walking `steps` from the source at `carry`.
 *
 * `offerCarry` defaults to `carry` — pass it to measure the offer at a carry the
 * draft was *not* walked at, which is what a mid-route carry change does.
 */
export const inputsAfter = (
  board: Board,
  state: GameState,
  from: ArrowId,
  steps: readonly ArrowId[],
  carry: number,
  offerCarry?: number,
): RouteInputs => {
  const after = walkSteps(board, state, from, steps, carry);
  const tip = steps[steps.length - 1] ?? from;
  const draft: Move[] = [];
  let at = from;
  for (const exit of steps) {
    draft.push(step(at, exit, carry));
    at = exit;
  }
  return {
    geometry: board.geometry,
    rules: board.rules,
    state: after.state,
    from,
    tip,
    draft,
    carry: offerCarry ?? carry,
    tipHeads: headsOn(after.state, tip),
  };
};

/** How many hops along one slot the engine accepts from `from`, measured. */
export const acceptedRunLength = (
  board: Board,
  state: GameState,
  from: ArrowId,
  slot: number,
  carry: number,
): number => {
  let scratch = state;
  let at = from;
  let taken = 0;
  const seen = new Set<ArrowId>([from]);
  for (let m = 0; m < MAX_DEPTH; m += 1) {
    const exit = board.geometry.outArrows(board.geometry.target(at))[slot];
    if (exit === undefined || seen.has(exit)) return taken;
    // Occupancy is read *before* the hop: after it, the movers themselves stand
    // on `exit`, which would make every hop look like a merge.
    const occupied = scratch.groups.get(exit) !== undefined;
    try {
      scratch = board.rules.apply(scratch, step(at, exit, carry));
    } catch {
      return taken;
    }
    taken += 1;
    seen.add(exit);
    if (occupied) return taken;
    at = exit;
  }
  return taken;
};

/** Does the engine take this one hop from `at`? */
export const hopAccepted = (
  board: Board,
  state: GameState,
  at: ArrowId,
  exit: ArrowId,
  carry: number,
): boolean => {
  try {
    board.rules.apply(state, step(at, exit, carry));
    return true;
  } catch {
    return false;
  }
};

/**
 * A stack-grade fragment facing enemy territory on its first grain out — the
 * P28 refused self-convert exit (§6.3).
 */
export const refusedConvertFixture = (): {
  readonly state: GameState;
  readonly from: ArrowId;
  readonly refused: ArrowId;
} => {
  const from = sourceArrow(geometry);
  const refused = exitOf(geometry, from, 0);
  const state: GameState = legalSeats({
    ...blankState(),
    groups: new Map([[from, { owner: A, heads: 8, spent: 0 }]]),
    trails: new Map([[A, new Set([from])]]),
    territory: new Map([[refused, B]]),
  });
  if (rules.anchorGrade(state, from, A) !== 'stack') {
    throw new Error('setup: expected a stack-grade fragment');
  }
  return { state, from, refused };
};

// ---------------------------------------------------------------------------
// The input mode
// ---------------------------------------------------------------------------

export const makeMode = (board: Board): InputMode => new GalconInput(board.geometry);

/**
 * The route phase of a snapshot.
 *
 * Throws rather than returning undefined: until the `route` phase exists this is
 * exactly the missing behaviour, and the message should say so.
 */
export const routePhaseOf = (snap: InputSnapshot): RoutePhase => {
  const { phase } = snap;
  if (phase.kind !== 'route') {
    throw new Error(
      `setup: expected the route phase, got '${phase.kind}' — route drafting is not implemented`,
    );
  }
  return phase;
};

export interface Selected {
  readonly mode: InputMode;
  readonly board: Board;
  readonly state: GameState;
  readonly from: ArrowId;
  readonly snap: InputSnapshot;
  readonly phase: RoutePhase;
}

/** Click an own stack and land in the route phase. */
export const selectRoute = (board: Board, state: GameState, from: ArrowId): Selected => {
  const mode = makeMode(board);
  const snap = mode.onArrowClick(from, state, board.rules);
  return { mode, board, state, from, snap, phase: routePhaseOf(snap) };
};

/** A stack of `heads` on the tiling's seed out-arrow, selected. */
export const selectOpenField = (heads: number): Selected => {
  const board: Board = { geometry, rules };
  const from = sourceArrow(geometry);
  return selectRoute(board, openField(from, heads), from);
};

export const clickArrow = (selected: Selected, arrow: ArrowId): InputSnapshot =>
  selected.mode.onArrowClick(arrow, selected.state, selected.board.rules);

export const clickableOf = (snap: InputSnapshot): ClickableSet => routePhaseOf(snap).offer.clickable;

export const rayOf = (snap: InputSnapshot, slot: number): readonly ArrowId[] => {
  const ray = routePhaseOf(snap).offer.rays[slot];
  if (ray === undefined) throw new Error(`setup: the offer has no ray for slot ${String(slot)}`);
  return ray;
};

export const optionFor = (snap: InputSnapshot, arrow: ArrowId): RouteOption => {
  const option = clickableOf(snap).get(arrow);
  if (option === undefined) {
    throw new Error(`setup: ${String(arrow)} is not clickable`);
  }
  return option;
};

export const draftOf = (snap: InputSnapshot): readonly Move[] => routePhaseOf(snap).draft;

/** The arrows a list of moves walks, in order. */
export const exitsOf = (moves: readonly Move[]): readonly ArrowId[] =>
  moves.filter((move): move is StepMove => move.kind === 'step').map((move) => move.exit);

export const pendingOf = (snap: InputSnapshot): readonly Move[] => snap.pending ?? [];

/** Draft a route by clicking each arrow in turn, and return the last snapshot. */
export const draftClicks = (
  selected: Selected,
  arrows: readonly ArrowId[],
): InputSnapshot => {
  let snap = selected.snap;
  for (const arrow of arrows) snap = clickArrow(selected, arrow);
  return snap;
};

/** Every arrow the carry can reach this turn, as `reach.ts` measures it. */
export const reachForCarry = (
  board: Board,
  state: GameState,
  from: ArrowId,
  carry: number,
): ReadonlySet<ArrowId> => {
  const reach: Reach = reachFrom(board.geometry, board.rules, state, from);
  const found = new Set<ArrowId>();
  for (const [arrow, entry] of reach) {
    if (entry.plans.has(carry)) found.add(arrow);
  }
  return found;
};

// ---------------------------------------------------------------------------
// Instrumented ports
// ---------------------------------------------------------------------------

export interface CountingRules {
  readonly rules: RulesPort;
  /** How many times `apply` has been asked. Reset with `zero()`. */
  calls: number;
  readonly zero: () => void;
}

/** Count `apply` calls — the observable for "built once per change, not per hover". */
export const countingRules = (inner: RulesPort): CountingRules => {
  const counter: { calls: number } = { calls: 0 };
  const wrapped: RulesPort = {
    ...inner,
    apply: (state: GameState, move: Move): GameState => {
      counter.calls += 1;
      return inner.apply(state, move);
    },
  };
  return {
    rules: wrapped,
    get calls(): number {
      return counter.calls;
    },
    zero: (): void => {
      counter.calls = 0;
    },
  };
};

/**
 * A rules port that refuses one hop the engine would otherwise allow.
 *
 * Stands in for "a rule change would refuse a hop that `speed` alone would
 * allow": an offer derived from `speed()` would still include it.
 */
export const refusingRules = (
  inner: RulesPort,
  refuse: (move: StepMove) => boolean,
): RulesPort => ({
  ...inner,
  apply: (state: GameState, move: Move): GameState => {
    if (move.kind === 'step' && refuse(move)) {
      throw new Error(`refused by the stand-in rule: ${String(move.exit)}`);
    }
    return inner.apply(state, move);
  },
});

// ---------------------------------------------------------------------------
// Terminal steps — the three accepted hops that end a draft
// ---------------------------------------------------------------------------

/**
 * A draft whose last step is terminal, one per effect in the spec's table.
 *
 * `clicks` land the draft on the terminal tip; `popTarget` is the arrow a pop
 * goes back to (the source when the draft is one move long).
 */
export interface TerminalFixture {
  /** The `<effect>` column of the spec's outline. */
  readonly label: string;
  readonly board: Board;
  readonly state: GameState;
  readonly from: ArrowId;
  readonly carry: number;
  readonly clicks: readonly ArrowId[];
  readonly draftLength: number;
  readonly popTarget: ArrowId;
  readonly poppedLength: number;
}

export const terminalFixtures = (): readonly TerminalFixture[] => {
  const tiling: Board = { geometry, rules };
  const source = sourceArrow(geometry);
  const first = arrowAlong(geometry, source, 0, 1);
  const second = arrowAlong(geometry, source, 0, 2);
  return [
    {
      label: "merges into another of the player's stacks",
      board: tiling,
      state: stateWith([
        [source, { owner: A, heads: 8 }],
        [first, { owner: A, heads: 3 }],
      ]),
      from: source,
      carry: 8,
      clicks: [first],
      draftLength: 1,
      popTarget: source,
      poppedLength: 0,
    },
    {
      label: 'completes a closure',
      board: tiling,
      state: stateWith([[source, { owner: A, heads: 8 }]], {
        territory: new Map([
          [source, A],
          [second, A],
        ]),
        trails: new Map([[A, new Set([source])]]),
      }),
      from: source,
      carry: 8,
      clicks: [second],
      draftLength: 2,
      popTarget: first,
      poppedLength: 1,
    },
    {
      // P35: the click alone reaches this now — an adjacent enemy arrow is
      // clickable and its run drafts at `heads - 1`, which is the 7 named here.
      // The `setCarry` in `draftToTerminalTip` is a no-op under P35 and is kept
      // only so this fixture reads the same on either model.
      label: 'resolves combat against an enemy stack',
      board: tiling,
      state: stateWith([
        [source, { owner: A, heads: 8 }],
        [first, { owner: B, heads: 6 }],
      ]),
      from: source,
      // §6.2 stay-behind: the attack is only offered while a head stays put.
      carry: 7,
      clicks: [first],
      draftLength: 1,
      popTarget: source,
      poppedLength: 0,
    },
  ];
};

/**
 * Select, set the carry, and land the clicks — the setup every terminal test shares.
 *
 * P77: a landing on another of the player's own stacks is drafted through
 * `mergeInto` (the strip's Merge button), because a click on an own stack
 * selects it.
 */
export const draftToTerminalTip = (
  fixture: TerminalFixture,
): { readonly selected: Selected; readonly snap: InputSnapshot } => {
  const selected = selectRoute(fixture.board, fixture.state, fixture.from);
  selected.mode.setCarry(fixture.carry);
  let snap = selected.snap;
  for (const arrow of fixture.clicks) {
    const own = fixture.state.groups.get(arrow)?.owner === fixture.state.activePlayer;
    snap = own ? selected.mode.mergeInto(arrow) : clickArrow(selected, arrow);
  }
  return { selected, snap };
};

// ---------------------------------------------------------------------------
// Every authored seat has to be a legal seat (P37)
// ---------------------------------------------------------------------------

/**
 * Give every seat in `state.players` the minimum holdings that keep it legal.
 *
 * Since P37 a loss resolves on the move that causes it, so `rules.apply` removes
 * a landless seat's pieces on the **first** move of any state that authored one —
 * and §8 has always called a seat holding no territory an unplayable position
 * that setup must prevent. These fixtures are about route drafting and never
 * cared who owned what, so they authored seats with heads and no ground; that was
 * an illegal board all along and merely got away with it.
 *
 * The grant is the same minimum `rules-core`'s own fixtures use: **one** arrow of
 * territory, and a spawner flanking it so the seat holds a share and is never on
 * a starvation clock. Both are derived from the board the state's own arrows came
 * from — never a hardcoded id, and never an arrow from the other board, which
 * would make the spawner walk ask a fixture about a tiling vertex.
 *
 * The arrow is ranked to be as inert as the board allows: never an exit of an
 * arrow the fixture named (a step onto enemy ground is a refused self-convert,
 * so it would shorten a ray) and never a feeder of one's origin (which would lift
 * a drafted trail to territory grade).
 */
export const legalSeats = (state: GameState): GameState => {
  const named = [
    ...state.groups.keys(),
    ...state.territory.keys(),
    ...[...state.trails.values()].flatMap((arrows) => [...arrows]),
  ];
  const first = named[0];
  if (first === undefined) return state;
  const board = boardOfArrow(first);
  const landed = new Set([...state.territory.values()].map(String));
  const taken = new Set(named.map(String));
  const asExit = new Set<string>();
  const asFeeder = new Set<string>();
  for (const arrow of named) {
    for (const exit of board.outArrows(board.target(arrow))) asExit.add(String(exit));
    for (const feeder of board.inArrows(board.origin(arrow))) asFeeder.add(String(feeder));
  }
  const cost = (arrow: ArrowId): number =>
    (asExit.has(String(arrow)) ? 2 : 0) + (asFeeder.has(String(arrow)) ? 1 : 0);
  const territory = new Map(state.territory);
  for (const player of state.players) {
    if (landed.has(String(player))) continue;
    const home = candidateHomes(board)
      .filter((arrow) => !taken.has(String(arrow)))
      .toSorted((left, right) => cost(left) - cost(right) || byId(right, left))[0];
    if (home === undefined) throw new Error('setup: the board offered no free arrow for a home');
    taken.add(String(home));
    territory.set(home, player);
  }
  // A spawner flanking each seat's ground, so every seat holds a share. Without
  // it a seat that owns the enemy land a scenario authored — and no heads — is
  // the §9 *ground, no share, no head* row, and it would be removed on the first
  // move, taking that authored land off the board with it.
  const spawners = new Map(state.spawners);
  if (state.spawners.size === 0) {
    for (const player of state.players) {
      const mine = [...territory.entries()].find(([, owner]) => owner === player);
      if (mine === undefined) continue;
      const vertex = [...board.flankVertices(mine[0])].toSorted(byId)[0];
      if (vertex === undefined) {
        throw new Error(
          `setup: that board flanks ${String(mine[0])} with no vertex, so ${String(player)} cannot be given a share`,
        );
      }
      spawners.set(vertex, { force: { num: 1, den: 3 }, phase: 0 });
    }
  }
  return { ...state, territory, spawners };
};

/**
 * The arrows a home may be taken from.
 *
 * On a fixture that is the whole finite board. On the **unbounded** tiling it is
 * a distant annulus — radius 5 to 8 from the seed — because there the board has
 * room for a home that cannot touch anything a route test does, and an inert home
 * is worth more than a near one.
 */
/**
 * A **total** comparator on arrow / vertex ids — returns 0 for equal ids.
 *
 * `a < b ? -1 : 1` is not total: it asserts a strict order between two equal ids,
 * leaving `toSorted` formally free to do anything with them. AGENTS.md names this
 * exact shape — "a `sort` whose ties break on identity" — as one of the two
 * realistic ways nondeterminism enters this repo, the kind that passes every unit
 * test and surfaces only as replay drift. Found by Copilot on PR #21.
 *
 * Duplicated from `packages/rules-core/test/support.ts` rather than imported: a
 * web test reaching into another package's test tree is a worse coupling than four
 * lines of comparator. The duplication of `legalSeats` itself is the follow-up.
 */
const byId = (left: unknown, right: unknown): number => {
  const a = String(left);
  const b = String(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

const candidateHomes = (board: GeometryPort): readonly ArrowId[] => {
  const near = new Set(board.window(board.seedPoint(), 5).arrows.map(String));
  const wide = board.window(board.seedPoint(), 8).arrows;
  const far = wide.filter((arrow) => !near.has(String(arrow)));
  return (far.length > 0 ? far : wide).toSorted(byId);
};

/**
 * Which of the three boards an authored arrow id came from, or a **setup
 * failure**.
 *
 * The identification is lexical — the id's first two segments — which no port
 * promises (ids are opaque, P01 D1). That shortcut is tolerable only while a miss
 * is *loud*: this used to return `undefined`, and `legalSeats` then handed the
 * state back untouched, so a fixture that needed a legal seat silently got none
 * and the failure surfaced later, elsewhere, as a rule failure. Throwing names
 * the board it could not place a seat on instead.
 */
const boardOfArrow = (arrow: ArrowId): GeometryPort => {
  const prefix = String(arrow).split(':').slice(0, 2).join(':');
  for (const candidate of [geometry, makeFixture(MINIMAL), makeFixture(SPACIOUS)]) {
    const sample = candidate.window(candidate.seedPoint(), 1).arrows[0];
    if (sample !== undefined && String(sample).split(':').slice(0, 2).join(':') === prefix) {
      return candidate;
    }
  }
  throw new Error(
    `setup: no known board for arrow ${String(arrow)} — its prefix "${prefix}" is neither fixture nor the tiling, so no seat can be placed on it`,
  );
};
