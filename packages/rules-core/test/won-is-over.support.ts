/**
 * Scaffolding for the won-is-over suite (P38).
 *
 * Three things this adds over `losing.support.ts` and `immediate.support.ts`, and
 * each of them is something P38 asks and no earlier packet did:
 *
 * 1. **A board that exists twice** — once with a winner and once without, and
 *    identical in every other field. Every scenario here is a statement about the
 *    difference `winner` makes, so the comparison has to be against a board that
 *    differs in nothing else. {@link aWonPosition} returns both halves, and refuses
 *    to build unless the *live* half really does offer the moves the *won* half is
 *    asserted to withhold — a vacuous "nothing is offered" would pass on a barren
 *    board.
 * 2. **The outcome of a move as a value.** `apply` either returns a state or
 *    throws, and half of this packet is about which. {@link outcomeOf} makes that a
 *    value a test can read a message off, compare between two states, and assert
 *    *no state came back* from — invariant 2's second clause, which `toThrow`
 *    cannot express on its own.
 * 3. **An arrow-read counter.** `countingVertices` (P37, `./support`) counts the
 *    *vertex* lattice only — `flankVertices` and `borderArrows` — because the five
 *    "enumerate no vertex" invariants are all it was built for. There is no arrow
 *    counter anywhere in the suite, and the edge scenario *a won state is cheaper
 *    to ask than a live one* asserts **no arrow and no vertex** is read, so
 *    {@link countingBoard} wraps the whole port and counts both halves separately.
 * 4. **A deciding move that is not a closure.** {@link aWinningWipe} — a combat
 *    wipe that takes the last head — for the fourth effect invariant 3 names. Its
 *    docstring records why *evaporation* is the one effect a deciding move cannot
 *    be observed to resolve, which is a fact about the rules and not about the
 *    fixture.
 * 5. **The reported playtest log, once.** {@link theReportedLog} and
 *    {@link slicedAt}, with the P37/P38 indices as **fixture landmarks** and
 *    {@link P47_FIRST_UNPLAYABLE} as the current fold stop, because the replay
 *    scenarios have to say *which* index the engine stops at.
 *
 * Same standing rules as the rest of the suite: states are hand-authored and
 * boards are not, and a setup failure throws a plain `Error` so it can never be
 * mistaken for a rule failure.
 *
 * @see docs/spec/won-is-over/won-is-over.md
 */

import { endTurn, movesEqual, skip, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '../src/index';
import { headsOf, isLost, territoryCountOf } from '../src/victory';
import { playtestLog } from './immediate.support';
import {
  A,
  B,
  C,
  THREE,
  aBoard,
  bareArrow,
  bareAwayFrom,
  held,
  seatState,
  shareArrow,
} from './losing.support';
import type { Ground, SeatBoard } from './losing.support';
import {
  MINIMAL_DIAMETER,
  aRingWithAnInside,
  anExitFrom,
  anInterleaving,
  arrowAt,
  exitsFrom,
  notAnExitFrom,
} from './support';

// ── a board with a winner, and the same board without one ────────────────────

export interface WonPosition {
  readonly ground: Ground;
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  /** The board with no winner. Offers `good`, `stand` and the pass — checked, below. */
  readonly live: GameState;
  /** The same board, `winner` set, and nothing else changed. */
  readonly won: GameState;
  /** The **chair's** stack, with its whole allowance unspent. */
  readonly stack: ArrowId;
  /** A step out of {@link stack} that every rule but this one permits. */
  readonly good: Move;
  /** A step against the grain — illegal on the live board too. */
  readonly bad: Move;
  /** A step whose source holds no group at all. */
  readonly sourceless: Move;
  /** A skip of {@link stack} — legal on the live board. */
  readonly stand: Move;
  /** The arrow {@link sourceless} departs, for asserting a message says nothing of it. */
  readonly emptyArrow: ArrowId;
}

/**
 * The fixture board of P02 (`minimal`), authored twice.
 *
 * Three seats, so *a lost seat* and *a won match* can be told apart on the same
 * shape: each seat holds one arrow of ground and a stack of two standing on it, and
 * A's arrow is a spawner share so no seat is on the starvation clock for want of
 * one to take. Nothing here is on the tiling — no closure runs, and a failure on
 * `minimal` prints.
 *
 * Every offered move is built from the **chair's** own stack rather than A's, so
 * that `winner` and `activePlayer` can be varied independently and the live half
 * still offers what the won half is asserted to withhold. A fixture that always
 * moved A would quietly go vacuous the moment a test handed the chair to B.
 */
export const aWonPosition = (
  options: { readonly winner?: PlayerId; readonly activePlayer?: PlayerId } = {},
): WonPosition => {
  const ground = aBoard();
  const homes = new Map<PlayerId, ArrowId>([
    [A, shareArrow(ground, 0)],
    [B, bareArrow(ground, 0)],
    [C, bareArrow(ground, 1)],
  ]);
  const emptyArrow = bareArrow(ground, 2);
  const chair = options.activePlayer ?? A;
  const stack = homes.get(chair);
  if (stack === undefined) throw new Error(`setup: ${String(chair)} is not one of the three seats`);
  const board: SeatBoard = {
    players: THREE,
    activePlayer: chair,
    groups: [...homes].map(([owner, arrow]) => ({ arrow, owner, heads: 2 })),
    territory: [...homes].map(([owner, arrow]) => ({ arrow, owner })),
  };
  const live = seatState(board);
  const won = seatState({ ...board, winner: options.winner ?? A });
  const exit = exitsFrom(ground.geometry, stack).find(
    (candidate) => !live.territory.has(candidate) && !live.groups.has(candidate),
  );
  if (exit === undefined) throw new Error('setup: every exit from that stack is owned or held');
  const position: WonPosition = {
    ground,
    geometry: ground.geometry,
    rules: ground.rules,
    live,
    won,
    stack,
    good: step(stack, exit, 1),
    bad: step(stack, notAnExitFrom(ground.geometry, stack, MINIMAL_DIAMETER), 1),
    sourceless: step(emptyArrow, exitsFrom(ground.geometry, emptyArrow)[0] ?? stack, 1),
    stand: skip(stack),
    emptyArrow,
  };
  assertLivelyEnough(position);
  return position;
};

/**
 * The board without a winner really does offer what the board with one is
 * asserted to withhold.
 *
 * Without this, *no move is offered once a winner is set* would pass just as well
 * on a board where no move was ever available — the failure mode a test asserting
 * an empty list always has.
 */
const assertLivelyEnough = (position: WonPosition): void => {
  const offered = position.rules.legalMoves(position.live);
  for (const [name, move] of [
    ['the step', position.good],
    ['the skip', position.stand],
    ['the pass', endTurn()],
  ] as const) {
    if (!offered.some((candidate) => movesEqual(candidate, move))) {
      throw new Error(`setup: the live board does not offer ${name}`);
    }
  }
  if (position.won.groups.has(position.emptyArrow)) {
    throw new Error('setup: the arrow meant to hold no group holds one');
  }
  const group = position.live.groups.get(position.stack);
  if (group?.spent !== 0) throw new Error('setup: the chair has already spent its allowance');
};

// ── a lost seat, and the same board won ──────────────────────────────────────

export interface LostSeatPosition {
  readonly ground: Ground;
  readonly rules: RulesPort;
  /** C holds nothing and it is C's turn. A and B are both playing, so nobody has won. */
  readonly lost: GameState;
  /** The same board with `winner` set — the state P38 says offers nothing at all. */
  readonly won: GameState;
}

/**
 * The two states whose offer lists must differ, on one board.
 *
 * They look adjacent and the reasoning inverts between them: a **lost** seat is
 * offered exactly the pass, because the round still has to advance through its
 * slot (P37 invariant 4); a **won** match is offered nothing, because there is no
 * next turn to advance to. Built together so a test can put the two assertions on
 * consecutive lines rather than trusting a comment to keep them related.
 */
export const aLostSeatPosition = (): LostSeatPosition => {
  const ground = aBoard();
  const aStack = shareArrow(ground, 0);
  const bHome = bareArrow(ground, 0);
  const board: SeatBoard = {
    players: THREE,
    activePlayer: C,
    groups: [
      { arrow: aStack, owner: A, heads: 2 },
      { arrow: bHome, owner: B, heads: 1 },
    ],
    territory: [{ arrow: aStack, owner: A }, ...held([bHome], B)],
  };
  return {
    ground,
    rules: ground.rules,
    lost: seatState(board),
    won: seatState({ ...board, winner: A }),
  };
};

// ── the outcome of one move, as a value ──────────────────────────────────────

export type Outcome =
  | { readonly refused: false; readonly state: GameState }
  | {
      readonly refused: true;
      readonly error: unknown;
      readonly name: string;
      readonly message: string;
    };

/**
 * Apply one move and report which of the two things happened.
 *
 * `expect(...).toThrow(ContractViolation)` says a refusal happened; it cannot say
 * *no state came back*, and it cannot hand two refusals' messages to one
 * comparison. Invariants 2 and 8 need both.
 */
export const outcomeOf = (rules: RulesPort, state: GameState, move: Move): Outcome => {
  let returned: GameState | undefined;
  try {
    returned = rules.apply(state, move);
  } catch (error) {
    return {
      refused: true,
      error,
      name: error instanceof Error ? error.name : 'not an Error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return { refused: false, state: returned };
};

// ── the closure that wins, with ground and a stack inside it ─────────────────

export interface WinningClosure {
  readonly geometry: GeometryPort;
  readonly rules: RulesPort;
  /** A's ground, which the loop departs and lands back on. */
  readonly home: ArrowId;
  /** A's stack, which the closing step is taken from. */
  readonly tip: ArrowId;
  /** Every arrow the closed loop rings. */
  readonly interior: readonly ArrowId[];
  /** The victim's **last** territory, inside the loop. */
  readonly victimLand: ArrowId;
  /** An arrow the loop rings, carrying a victim stack the closure converts. */
  readonly victimStack: ArrowId;
  /** The board before the closing step: no winner, the victim still playing. */
  readonly before: GameState;
  /** The one step that closes the loop, claims what it rings, and wins. */
  readonly closing: Move;
}

/**
 * A directed 6-cycle on the **tiling** that A closes in one step, ringing both
 * the victim's last territory and a victim stack.
 *
 * The tiling rather than a fixture, because *enclosed* means *cannot reach
 * infinity* and a finite board has no infinity to fail to reach (§11 item 4).
 * Territory and stack sit on two **different** interior arrows so that *claims its
 * ground* and *converts the stack it encircled* are two assertions about two
 * arrows rather than one assertion twice.
 */
export const aWinningClosure = (): WinningClosure => {
  const geometry = makeTiling();
  const rules = makeRules(geometry);
  const ring = aRingWithAnInside(geometry);
  const victimLand = arrowAt(ring.interior, 0);
  const victimStack = arrowAt(ring.interior, 1);
  const home = arrowAt(ring.wall, 0);
  const tip = arrowAt(ring.wall, ring.wall.length - 1);
  const before = seatState({
    players: THREE,
    activePlayer: A,
    groups: [
      { arrow: tip, owner: A, heads: 1 },
      { arrow: victimStack, owner: C, heads: 2 },
    ],
    trails: [[A, ring.wall.slice(1)]],
    territory: [...held([home], A), { arrow: victimLand, owner: C }],
  });
  const closing = step(tip, home, 1);
  const claim = rules.closureOf(before, closing, A);
  if (claim === undefined) throw new Error('setup: that step closes nothing');
  for (const [what, arrow] of [
    ['the last territory', victimLand],
    ['the stack', victimStack],
  ] as const) {
    if (!claim.enclosed.includes(arrow)) {
      throw new Error(`setup: the loop does not ring ${what}`);
    }
  }
  return { geometry, rules, home, tip, interior: ring.interior, victimLand, victimStack, before, closing };
};

// ── the wipe that wins ─────────────────────────────────────────────────

export interface WinningWipe {
  readonly ground: Ground;
  readonly rules: RulesPort;
  readonly geometry: GeometryPort;
  /** The arrow the victim's last head stands on — on the victim's own trail. */
  readonly victimHead: ArrowId;
  /** A victim trail arrow past {@link victimHead}, which the wipe's fire reaches. */
  readonly beyond: ArrowId;
  /** The victim's ground, which is what leaves it on the `T>0, S=0, H=0` row. */
  readonly victimLand: ArrowId;
  /** The board before the move: no winner, both seats playing. */
  readonly before: GameState;
  /** The step that wipes the victim's last stack and decides the match. */
  readonly wiping: StepMove;
}

/**
 * A combat wipe that decides the match, on the P02 fixture (`minimal`).
 *
 * Invariant 3 names four effects of a deciding move — closure, fill, conversion and
 * **evaporation** — and {@link aWinningClosure} covers the first three. This is the
 * closest an authored board can come to the fourth, and the gap is worth stating
 * rather than papering over:
 *
 * - A **cut** cannot decide a match. Evaporation destroys trail (§6.1, P12: fronts
 *   halt at an occupied arrow and take no head), and trail is none of *T*, *S* or
 *   *H*, so no cut can move a seat onto a losing row.
 * - A **combat wipe** can. The attacker takes the defender's last head (§6.2, a 1:1
 *   exchange), which is the `T>0, S=0, H=0` row of §9, and emptying a *trail* arrow
 *   starts an evaporation from it (P12, `evaporateFromArrow`). So one step causes a
 *   kill, an evaporation, and the loss that ends the match.
 * - What no board can show is the **evaporated arrows themselves**. The seat whose
 *   trail the fire runs along is the seat the move loses, and a lost seat *vanishes*
 *   — trail included (§9). A bystander whose trail was cut instead would be a second
 *   survivor, and then the move would not have decided anything. So the two removals
 *   coincide by construction and the fixture asserts the kill, which is the effect
 *   evaporation was reached through.
 *
 * Two seats, not three: the match is decided when one is left, so a third seat would
 * have to be already lost and would only add a vanish nobody is watching.
 */
export const aWinningWipe = (): WinningWipe => {
  const ground = aBoard();
  const crossing = anInterleaving(ground.geometry, MINIMAL_DIAMETER);
  const victimHead = crossing.trailOut;
  const beyond = anExitFrom(ground.geometry, victimHead);
  const moverGround = bareAwayFrom(ground, [
    crossing.trailIn,
    victimHead,
    crossing.ourIn,
    beyond,
  ]);
  const before = seatState({
    players: [A, C],
    activePlayer: A,
    groups: [
      { arrow: crossing.ourIn, owner: A, heads: 3 },
      { arrow: victimHead, owner: C, heads: 1 },
    ],
    trails: [
      [A, [crossing.ourIn]],
      [C, [crossing.trailIn, victimHead, beyond]],
    ],
    territory: [...held([moverGround], A), { arrow: crossing.trailIn, owner: C }],
  });
  const wipe: WinningWipe = {
    ground,
    rules: ground.rules,
    geometry: ground.geometry,
    victimHead,
    beyond,
    victimLand: crossing.trailIn,
    before,
    wiping: step(crossing.ourIn, victimHead, 2),
  };
  assertOneMoveFromDecided(wipe);
  return wipe;
};

/**
 * The board really is one move from decided, and decided by *this* move.
 *
 * Every claim {@link aWinningWipe} carries is a claim about a **transition**, so a
 * board that had already been won, or that holds a victim with a spare head, would
 * make the whole fixture vacuous in a way no assertion downstream would notice.
 */
const assertOneMoveFromDecided = (wipe: WinningWipe): void => {
  if (wipe.before.winner !== undefined) throw new Error('setup: that board is already won');
  for (const seat of [A, C]) {
    if (isLost(wipe.before, seat, wipe.geometry)) {
      throw new Error(`setup: ${String(seat)} is lost before the deciding move`);
    }
  }
  if (headsOf(wipe.before, C) !== 1) {
    throw new Error('setup: the victim does not hold exactly one head');
  }
  if (wipe.before.trails.get(C)?.has(wipe.beyond) !== true) {
    throw new Error('setup: the arrow past the wipe is not on the victim\u2019s trail');
  }
  if (territoryCountOf(wipe.before, C) === 0) {
    throw new Error('setup: the victim owns no ground, so its loss is not the head');
  }
};

// ── the reported playtest log ──────────────────────────────────────────

/**
 * Historical landmarks **in the fixture**, not the current fold.
 *
 * The 2026-08-20 log still contains D's deciding step at 1242 and the `endTurn`
 * at 1243. P47's incidence flood makes the record unplayable earlier — see
 * {@link P47_FIRST_UNPLAYABLE}. P37/P38 behaviour (winner on the deciding move,
 * refuse the next) is proven on the hand-authored fixtures (`aMatchLosingThree`,
 * {@link aWonPosition}).
 */
export const DECIDING_MOVE = 1242;
/** The `endTurn` right after the deciding step — accepted before P38, refused by it. */
export const FIRST_MOVE_AFTER_THE_WIN = 1243;
/** The move a seat that no longer exists makes — P37 stopped the fold here. */
export const FIRST_MOVE_BY_A_DEAD_SEAT = 1244;

export {
  P47_FIRST_UNPLAYABLE,
  P47_PREFIX_FLOOR,
} from './immediate.support';

export interface ReportedLog {
  readonly initial: GameState;
  readonly moves: readonly Move[];
  readonly rules: RulesPort;
  readonly geometry: GeometryPort;
  /** The winner the adapter recorded when the match ended. */
  readonly winner: string;
}

let REPORTED: ReportedLog | undefined;

/**
 * The 1247-move record, the board it was played on, and the rules over that board.
 *
 * Memoised, which is safe *because* the core is pure: the same record over the same
 * board is the same fold, which is the property the replay suite exists to assert.
 *
 * Under current rules the fold stops at {@link P47_FIRST_UNPLAYABLE}; callers that
 * need a complete replay must {@link slicedAt} that index.
 */
export const theReportedLog = (): ReportedLog => {
  REPORTED ??= ((): ReportedLog => {
    const log = playtestLog();
    const geometry = makeTiling();
    return {
      initial: log.opening,
      moves: log.moves,
      rules: makeRules(geometry),
      geometry,
      winner: log.winner,
    };
  })();
  return REPORTED;
};

/** The record up to but not including `at` — the first move a won match refuses. */
export const slicedAt = (moves: readonly Move[], at: number): readonly Move[] =>
  moves.slice(0, at);

// ── counting what one call reads off the board ───────────────────────────────

export interface CountedBoard {
  /** A `GeometryPort` indistinguishable from the original bar the counters. */
  readonly geometry: GeometryPort;
  /** Arrow-lattice reads: `inArrows`, `outArrows`, `origin`, `target`, `slotOf`, `window`. */
  readonly arrowReads: () => number;
  /** Vertex-lattice reads: `flankVertices`, `borderArrows` — the P37 currency. */
  readonly vertexReads: () => number;
}

/**
 * A port that counts **every** query, split into the arrow half and the vertex
 * half.
 *
 * `countingVertices` in `./support` counts only the vertex half, deliberately —
 * it exists for the five "enumerate no vertex" invariants. The won-state cost
 * scenario asserts *no arrow and no vertex is read*, which needs the other half
 * too, and needs it counted separately so a failure says which lattice was
 * touched.
 */
export const countingBoard = (geometry: GeometryPort): CountedBoard => {
  let arrows = 0;
  let vertices = 0;
  const arrow = <T>(value: T): T => {
    arrows += 1;
    return value;
  };
  const vertex = <T>(value: T): T => {
    vertices += 1;
    return value;
  };
  return {
    geometry: {
      seedPoint: () => geometry.seedPoint(),
      window: (centre, radius) => arrow(geometry.window(centre, radius)),
      inArrows: (point) => arrow(geometry.inArrows(point)),
      outArrows: (point) => arrow(geometry.outArrows(point)),
      origin: (a) => arrow(geometry.origin(a)),
      target: (a) => arrow(geometry.target(a)),
      flankVertices: (a) => vertex(geometry.flankVertices(a)),
      borderArrows: (v) => vertex(geometry.borderArrows(v)),
      slotOf: (point, a) => arrow(geometry.slotOf(point, a)),
    },
    arrowReads: () => arrows,
    vertexReads: () => vertices,
  };
};

/** Reads one call makes off a board, as a record a failure prints readably. */
export const readsOf = (
  counted: CountedBoard,
  run: () => void,
): { readonly arrows: number; readonly vertices: number } => {
  const before = { arrows: counted.arrowReads(), vertices: counted.vertexReads() };
  run();
  return {
    arrows: counted.arrowReads() - before.arrows,
    vertices: counted.vertexReads() - before.vertices,
  };
};
