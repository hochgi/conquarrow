/**
 * One test per scenario of docs/spec/immediate-loss/immediate-loss.edge-cases.feature.
 *
 * The edges P37 has to hold are all one shape: *only the moment of a loss moved,
 * never its result*. So most of these compare a state to the state one move
 * before it, rather than to a hand-written expectation — a removal that changed
 * somebody else's holdings would be the defect, and an equality is the only
 * assertion that catches it whatever the board was.
 *
 * @see docs/spec/immediate-loss/immediate-loss.md
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, GeometryPort, PlayerId } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '../src/index';
import { headsOf, isLost, resolveLosses, territoryCountOf } from '../src/victory';
import {
  aLandBridge,
  countingMap,
  crossing,
  farArrow,
  landOf,
  lostAlong,
  ownedSharesOf,
  P47_PREFIX_FLOOR,
  clearExit,
  playtestLog,
  someSeatIsAlive,
  statesAlong,
  traversalsOf,
} from './immediate.support';
import type { LandBridge } from './immediate.support';
import {
  A,
  B,
  C,
  D,
  SIX,
  THREE,
  aBoard,
  aVertex,
  bareArrow,
  closeRounds,
  held,
  holdingsOf,
  isUnowned,
  readingsOf,
  seatState,
  shareArrow,
  streakOf,
} from './losing.support';
import { anExitFrom, snapshot } from './support';

const FORCE = { num: 1, den: 3 } as const;

// ── Rule: Every way a seat can lose its last territory resolves at once ──────

/**
 * A land bridge whose claimed arrow is `victim`'s last territory, with the
 * victim's trail laid across the arrow the mover is about to cross.
 *
 * The crossing is a **cut** as well as a closure: the mover lands by coincidence
 * on an arrow the victim's trail also marks (§6.1), so the same step evaporates
 * and claims. That is what *a cut that strands the last territory* asks for.
 */
const aCutAndClaim = (bridge: LandBridge): GameState =>
  seatState({
    players: [A, B, C],
    activePlayer: A,
    groups: [
      { arrow: bridge.bridge, owner: A, heads: 2 },
      { arrow: farArrow(bridge, 0), owner: C, heads: 1 },
      { arrow: farArrow(bridge, 1), owner: B, heads: 1 },
    ],
    trails: [
      [A, [bridge.bridge]],
      [C, [bridge.landing, farArrow(bridge, 0)]],
    ],
    territory: [
      ...held([bridge.home, bridge.landing], A),
      { arrow: bridge.bridge, owner: C },
      { arrow: farArrow(bridge, 1), owner: B },
    ],
  });

describe('every way a seat can lose its last territory resolves at once', () => {
  it('loses the seat when a closure following a cut takes its last arrow', () => {
    const bridge = aLandBridge();
    const before = aCutAndClaim(bridge);
    expect(isLost(before, C, bridge.geometry)).toBe(false);
    // The step really is a cut as well as a closure: it lands by coincidence on
    // an arrow C's trail marks.
    expect(
      bridge.rules.crossesTrail(before, { from: bridge.bridge, exit: bridge.landing }, C),
    ).toBe(true);

    const after = bridge.rules.apply(before, crossing(bridge));

    expect(territoryCountOf(after, C)).toBe(0);
    expect(isLost(after, C, bridge.geometry)).toBe(true);
    expect(holdingsOf(after, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
  });

  it('loses the seat when its last heads are converted inside the claim', () => {
    // C's head stands on the arrow the bridge claims, unanchored, so the claim
    // converts it (§6.3) *and* takes C's only ground on the same step.
    const bridge = aLandBridge();
    const before = seatState({
      players: [A, B, C],
      activePlayer: A,
      groups: [
        { arrow: bridge.bridge, owner: A, heads: 2 },
        { arrow: farArrow(bridge, 0), owner: C, heads: 1 },
        { arrow: farArrow(bridge, 1), owner: B, heads: 1 },
      ],
      trails: [
        [A, [bridge.bridge]],
        [C, [farArrow(bridge, 0)]],
      ],
      territory: [
        ...held([bridge.home, bridge.landing], A),
        { arrow: bridge.bridge, owner: C },
        { arrow: farArrow(bridge, 1), owner: B },
      ],
    });

    const after = bridge.rules.apply(before, crossing(bridge));

    expect(isLost(after, C, bridge.geometry)).toBe(true);
    expect(holdingsOf(after, C).heads).toBe(0);
  });

  it('loses the seat when a land bridge claims its last arrow', () => {
    const bridge = aLandBridge();
    const before = seatState({
      players: [A, B, C],
      activePlayer: A,
      groups: [
        { arrow: bridge.bridge, owner: A, heads: 1 },
        { arrow: farArrow(bridge, 0), owner: C, heads: 1 },
        { arrow: farArrow(bridge, 1), owner: B, heads: 1 },
      ],
      trails: [[A, [bridge.bridge]]],
      territory: [
        ...held([bridge.home, bridge.landing], A),
        { arrow: bridge.bridge, owner: C },
        { arrow: farArrow(bridge, 1), owner: B },
      ],
    });
    // Nothing is enclosed: the claim is the path alone, which is the land bridge.
    const claim = bridge.rules.closureOf(before, crossing(bridge), A);
    if (claim === undefined) throw new Error('setup: that step closes nothing');
    expect(claim.enclosed).toEqual([]);

    const after = bridge.rules.apply(before, crossing(bridge));

    expect(after.territory.get(bridge.bridge)).toBe(A);
    expect(isLost(after, C, bridge.geometry)).toBe(true);
    // Not just the derived predicate: the removal has to be in *this* state.
    expect(holdingsOf(after, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
  });

  it('loses an authored landless seat on the next move, whatever that move is', () => {
    // *An authored state in which C owns no territory and holds one head*, and
    // *when any move is applied*. A landless seat is what P37 makes unreachable by
    // play, so the premise can only be authored — and what the scenario asks for is
    // therefore **totality**, not a claim about one kind of move. So it quantifies
    // over every move the engine offers on that board rather than picking one, and
    // they include the step into C's stack, the step away from it, and the pass
    // alike.
    const ground = aBoard();
    const mover = shareArrow(ground, 0);
    const before = seatState({
      players: THREE,
      activePlayer: A,
      groups: [
        { arrow: mover, owner: A, heads: 3 },
        { arrow: bareArrow(ground, 0), owner: B, heads: 1 },
        { arrow: bareArrow(ground, 1), owner: C, heads: 1 },
      ],
      territory: [
        { arrow: mover, owner: A },
        ...held([bareArrow(ground, 0)], B),
      ],
      spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
    });
    expect(territoryCountOf(before, C)).toBe(0);
    expect(headsOf(before, C)).toBe(1);

    const offered = ground.rules.legalMoves(before);

    // Non-vacuous, and *totality*: every kind is on offer, so "whatever it is"
    // really ranges over both.
    expect([...new Set(offered.map((move) => move.kind))].toSorted()).toEqual([
      'endTurn',
      'step',
    ]);
    const survived: string[] = [];
    for (const move of offered) {
      const after = ground.rules.apply(before, move);
      if (
        !isLost(after, C, ground.geometry) ||
        holdingsOf(after, C).heads !== 0 ||
        holdingsOf(after, C).land.length !== 0
      ) {
        survived.push(`${move.kind}:${String(move.kind === 'endTurn' ? '' : move.from)}`);
      }
    }
    expect(survived).toEqual([]);
  });
});

// ── Rule: Resolving sooner cannot change who loses ──────────────────────────

/**
 * Two seats each owning ground, no share and heads — the starvation-clock row, so
 * neither is *lost*; but B's clock has already run out, so B is the seat the
 * engine removes.
 *
 * B's streak is what makes this the engine's own removal rather than a hand-built
 * map: the scenario says *when one of them is removed*, and the only way a seat in
 * that row leaves is the clock (§9). Filtering B out of the maps by hand would
 * make the reading of C a statement about `Array.prototype.filter`.
 */
const twoClockedSeats = (): { ground: ReturnType<typeof aBoard>; state: GameState } => {
  const ground = aBoard();
  const state = seatState({
    players: THREE,
    activePlayer: A,
    groups: [
      { arrow: shareArrow(ground, 0), owner: A, heads: 2 },
      { arrow: bareArrow(ground, 0), owner: B, heads: 1 },
      { arrow: bareArrow(ground, 1), owner: C, heads: 1 },
    ],
    territory: [
      { arrow: shareArrow(ground, 0), owner: A },
      ...held([bareArrow(ground, 0)], B),
      ...held([bareArrow(ground, 1)], C),
    ],
    spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
    starvationStreaks: [[B, 2]],
    dominationN: 2,
  });
  return { ground, state };
};

describe('resolving sooner cannot change who loses', () => {
  it('never qualifies one seat by removing another', () => {
    const { ground, state } = twoClockedSeats();
    expect(readingsOf(state, C, ground.geometry)).toEqual({ territory: 1, shares: 0, heads: 1 });
    expect(isLost(state, C, ground.geometry)).toBe(false);

    // The engine's own removal, through `vanishSeat` — B's clock has run out.
    const removed = resolveLosses(state, ground.geometry);

    expect(holdingsOf(removed, B)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
    // What the scenario claims: C's territory, shares and heads are untouched by
    // it, and C is still not lost. Both are real reads now — a `vanishSeat` that
    // handed B's ground to a survivor, or cleared one arrow too many, moves them.
    expect(readingsOf(removed, C, ground.geometry)).toEqual(
      readingsOf(state, C, ground.geometry),
    );
    expect(holdingsOf(removed, C)).toEqual(holdingsOf(state, C));
    expect(isLost(removed, C, ground.geometry)).toBe(false);
  });

  it('leaves a vanished seat’s land belonging to nobody, not to the mover', () => {
    const ground = aBoard();
    const bare = bareArrow(ground, 1);
    const before = seatState({
      players: THREE,
      activePlayer: A,
      groups: [{ arrow: shareArrow(ground, 0), owner: A, heads: 2 }],
      territory: [
        { arrow: shareArrow(ground, 0), owner: A },
        ...held([bareArrow(ground, 0)], B),
        // C: ground, no share, no head — gone on the first move that resolves.
        ...held([bare], C),
      ],
      spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
    });

    const after = ground.rules.apply(before, endTurn());

    expect(isLost(after, C, ground.geometry)).toBe(true);
    expect(isUnowned(after, bare)).toBe(true);
    expect(after.territory.get(bare)).toBeUndefined();
  });

  it('resolves two seats in player-list order', () => {
    const ground = aBoard();
    // B and C both hold ground with no share and no head, so both qualify at
    // once. Order is observable as the order the vacated arrows are reported in.
    const before = seatState({
      players: THREE,
      activePlayer: A,
      groups: [{ arrow: shareArrow(ground, 0), owner: A, heads: 2 }],
      territory: [
        { arrow: shareArrow(ground, 0), owner: A },
        ...held([bareArrow(ground, 0)], B),
        ...held([bareArrow(ground, 1)], C),
      ],
      spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
    });

    const after = resolveLosses(before, ground.geometry);

    expect(lostAlong(after, ground.geometry)).toEqual(['B', 'C']);
    // And each entry of that list stands for a removal that happened. Restating
    // `lostAlong` over the same state would only re-run its own definition — it
    // filters `state.players`, so it cannot report any other order and cannot
    // disagree with itself. Removals commute (P36 invariant 19), so what a single
    // pass *can* be held to is its content: both seats gone, their ground left
    // unowned, and the survivor untouched.
    expect(holdingsOf(after, B)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
    expect(holdingsOf(after, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
    expect(isUnowned(after, bareArrow(ground, 0))).toBe(true);
    expect(isUnowned(after, bareArrow(ground, 1))).toBe(true);
    expect(holdingsOf(after, A)).toEqual(holdingsOf(before, A));
  });

  it('loses both seats that qualify on one step', () => {
    const ground = aBoard();
    const mover = shareArrow(ground, 0);
    const before = seatState({
      players: THREE,
      activePlayer: A,
      groups: [{ arrow: mover, owner: A, heads: 2 }],
      territory: [
        { arrow: mover, owner: A },
        ...held([bareArrow(ground, 0)], B),
        ...held([bareArrow(ground, 1)], C),
      ],
      spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
    });

    const after = ground.rules.apply(before, step(mover, anExitFrom(ground.geometry, mover), 1));

    expect(holdingsOf(after, B)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
    expect(holdingsOf(after, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
  });
});

// ── Rule: The win check runs after every seat is resolved ────────────────────

describe('the win check runs after every seat is resolved', () => {
  it('crowns the seat that is left, never the second to last one removed', () => {
    const ground = aBoard();
    const mover = shareArrow(ground, 0);
    const before = seatState({
      players: THREE,
      activePlayer: A,
      groups: [{ arrow: mover, owner: A, heads: 2 }],
      territory: [
        { arrow: mover, owner: A },
        ...held([bareArrow(ground, 0)], B),
        ...held([bareArrow(ground, 1)], C),
      ],
      spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
    });

    const after = ground.rules.apply(before, endTurn());

    expect(after.winner).toBe(A);
    expect(after.winner).not.toBe(B);
    expect(after.winner).not.toBe(C);
  });

  it('leaves no winner while two seats remain', () => {
    const ground = aBoard();
    const mover = shareArrow(ground, 0);
    const before = seatState({
      players: THREE,
      activePlayer: A,
      groups: [
        { arrow: mover, owner: A, heads: 2 },
        { arrow: shareArrow(ground, 1), owner: B, heads: 1 },
      ],
      territory: [
        { arrow: mover, owner: A },
        { arrow: shareArrow(ground, 1), owner: B },
        // C holds ground and nothing else, so only C goes.
        ...held([bareArrow(ground, 0)], C),
      ],
      spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
    });

    const after = ground.rules.apply(before, endTurn());

    expect(isLost(after, C, ground.geometry)).toBe(true);
    expect(holdingsOf(after, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
    expect(after.winner).toBeUndefined();
  });
});

// ── Rule: A lost seat is inert ──────────────────────────────────────────────

/** A settled board where C is lost and A and B are playing. */
const aBoardWithCGone = (): { ground: ReturnType<typeof aBoard>; state: GameState } => {
  const ground = aBoard();
  const authored = seatState({
    players: THREE,
    activePlayer: A,
    groups: [
      { arrow: shareArrow(ground, 0), owner: A, heads: 2 },
      { arrow: shareArrow(ground, 1), owner: B, heads: 1 },
      { arrow: bareArrow(ground, 0), owner: C, heads: 1 },
    ],
    territory: [
      { arrow: shareArrow(ground, 0), owner: A },
      { arrow: shareArrow(ground, 1), owner: B },
    ],
    spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
  });
  // Any move resolves the loss. A step rather than the pass, so the chair stays
  // with A and `closeRounds` below still starts on a round boundary.
  const mover = shareArrow(ground, 0);
  const move = step(mover, clearExit(ground, authored, mover), 1);
  return { ground, state: ground.rules.apply(authored, move) };
};

describe('a lost seat is inert', () => {
  it('offers a lost seat nothing but the pass', () => {
    const { ground, state } = aBoardWithCGone();
    expect(isLost(state, C, ground.geometry)).toBe(true);

    const seated: GameState = { ...state, activePlayer: C };

    expect(ground.rules.legalMoves(seated)).toEqual([endTurn()]);
  });

  it('never makes a lost seat the winner', () => {
    const { ground, state } = aBoardWithCGone();
    expect(holdingsOf(state, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });

    const later = closeRounds(ground.rules, state, 3);

    expect(isLost(later, C, ground.geometry)).toBe(true);
    expect(later.winner).not.toBe(C);
  });

  it('keeps no starvation streak for a lost seat', () => {
    const { ground, state } = aBoardWithCGone();
    expect(holdingsOf(state, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });

    const closed = closeRounds(ground.rules, state, 1);

    expect(streakOf(closed, C)).toBe(0);
    expect(closed.starvationStreaks.has(C)).toBe(false);
  });

  it('changes nothing about a lost seat over ten rounds', () => {
    const { ground, state } = aBoardWithCGone();
    expect(holdingsOf(state, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });

    const later = closeRounds(ground.rules, state, 10);

    expect(isLost(later, C, ground.geometry)).toBe(true);
    expect(holdingsOf(later, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
    expect([...later.players].map(String)).toEqual([...state.players].map(String));
  });
});

// ── Rule: Item 44's chain is pinned, not merely argued ───────────────────────

describe('item 44’s chain is pinned, not merely argued', () => {
  it('never takes a spawner-border arrow out of ownership along a replay', () => {
    // Link 2 and link 3 together: a claim re-owns a share, and a vanish never
    // vacates one. So an arrow that bordered a spawner and had an owner keeps
    // having one, whoever that is, in every state a real record passes through.
    const log = playtestLog();
    const geometry: GeometryPort = makeTiling();
    const initial = log.opening;
    const rules = makeRules(geometry);

    const { stops } = statesAlong(rules, initial, log.moves);

    let owned = ownedSharesOf(initial, geometry);
    const dropped: string[] = [];
    for (const stop of stops) {
      const now = ownedSharesOf(stop.state, geometry);
      for (const arrow of owned.keys()) {
        if (!now.has(arrow)) dropped.push(`${arrow}@${String(stop.at)}`);
      }
      owned = now;
    }
    expect(dropped).toEqual([]);
    // The guard has to be on the set the loop walks — *owned* shares — and on the
    // trace itself. `shareArrowsOf` counts every spawner-border arrow whoever owns
    // it, so it is positive on any board carrying a spawner and would let an
    // opening that owned none, or a trace that stopped at zero moves, pass with
    // `dropped` empty and nothing compared.
    expect(ownedSharesOf(initial, geometry).size).toBeGreaterThan(0);
    // P47 prefix (233 stops). Floor still bites a 0-move fold; not a pin of 1243.
    expect(stops.length).toBeGreaterThan(P47_PREFIX_FLOOR);
  });

  it('never reaches a state with no seat left', () => {
    const log = playtestLog();
    const geometry: GeometryPort = makeTiling();
    const initial = log.opening;
    const rules = makeRules(geometry);

    const { stops } = statesAlong(rules, initial, log.moves);

    expect(someSeatIsAlive(initial, geometry)).toBe(true);
    expect(stops.filter((stop) => !someSeatIsAlive(stop.state, geometry)).map((s) => s.at)).toEqual(
      [],
    );
  });

  it('states the vacuous guard so that the live one cannot fail silently', () => {
    // Invariant 11 — *never leave `winner` unset in a state where every player is
    // lost* — is **vacuous by invariant 10**: no reachable state has every player
    // lost, so the implication holds with nothing to check. It is asserted anyway,
    // and only in this shape, so that if 10 ever breaks the pair reads as one
    // failure and not as a silently-passing guard. Nothing here dresses it up as
    // a live assertion: the antecedent is the thing being denied.
    const log = playtestLog();
    const geometry: GeometryPort = makeTiling();
    const initial = log.opening;
    const rules = makeRules(geometry);

    const { stops } = statesAlong(rules, initial, log.moves);

    const allLost = [{ at: -1, state: initial }, ...stops].filter(
      (stop) => !someSeatIsAlive(stop.state, geometry),
    );
    expect(allLost).toEqual([]);
    // And the implication itself, over the states that do exist: it is satisfied
    // because the antecedent never holds.
    for (const stop of allLost) {
      expect(stop.state.winner).toBeDefined();
    }
  });
});

// ── Rule: Determinism and cost ──────────────────────────────────────────────

describe('determinism and cost', () => {
  it('loses equal seats on equal moves from equal states', () => {
    const { ground, state } = twoClockedSeats();
    const mover = shareArrow(ground, 0);
    const twin: GameState = {
      ...state,
      groups: new Map([...state.groups].toReversed()),
      territory: new Map([...state.territory].toReversed()),
    };

    const left = ground.rules.apply(state, step(mover, anExitFrom(ground.geometry, mover), 1));
    const right = ground.rules.apply(twin, step(mover, anExitFrom(ground.geometry, mover), 1));

    expect(lostAlong(left, ground.geometry)).toEqual(lostAlong(right, ground.geometry));
    for (const seat of THREE) {
      expect(holdingsOf(left, seat)).toEqual(holdingsOf(right, seat));
    }
  });

  it('ignores every map’s insertion order', () => {
    const ground = aBoard();
    const mover = shareArrow(ground, 0);
    const holdings: readonly { readonly arrow: ArrowId; readonly owner: PlayerId }[] = [
      { arrow: mover, owner: A },
      ...held([bareArrow(ground, 0)], B),
      ...held([bareArrow(ground, 1)], C),
      ...held([bareArrow(ground, 2)], D),
    ];
    const build = (order: readonly { readonly arrow: ArrowId; readonly owner: PlayerId }[]):
      GameState =>
      seatState({
        players: [A, B, C, D],
        activePlayer: A,
        groups: [{ arrow: mover, owner: A, heads: 2 }],
        territory: order,
        spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
      });

    const forward = ground.rules.apply(build(holdings), endTurn());
    const backward = ground.rules.apply(build([...holdings].toReversed()), endTurn());

    expect(snapshot(forward)).toEqual(snapshot(backward));
    // Non-vacuous: three seats really were removed on that move, so the two runs
    // agreed about *removals* and not merely about an untouched board.
    expect(landOf(forward, A)).toEqual([String(mover)]);
    for (const seat of [B, C, D]) expect(landOf(forward, seat)).toEqual([]);
  });

  it('reads territory and groups in one pass, not once per player', () => {
    // The currency is **traversals**, which is the only one a test has for a claim
    // about two plain `Map`s: `countingMap` charges one for each `entries`, `keys`,
    // `values`, `forEach` or spread and nothing at all for a `get`. A resolution
    // that scans `territory` and `groups` once per seat therefore costs a traversal
    // per seat, and its count *grows with the seat list*; one pass costs the same
    // on a two-seat board as on a six-seat one. That difference is the assertion —
    // not an absolute number, which would pin a shape phase 3 is free to choose.
    //
    // Every seat here is alive and nothing is removed, on purpose: `vanishSeat`
    // legitimately traverses once per *removed* seat, and letting removals vary
    // with the seat count would confound the two.
    //
    // What no test here measures is wall-clock cost. The spec measures that on the
    // 1247-move fold and records the number; a timing assertion is not a test.
    const ground = aBoard();
    const alive = (players: readonly PlayerId[]): GameState =>
      seatState({
        players,
        activePlayer: A,
        // Ground and a head for each seat, so no seat qualifies and no seat needs
        // its shares counted — the §9 starvation-clock row.
        groups: players.map((seat, index) => ({
          arrow: bareArrow(ground, players.length + index),
          owner: seat,
          heads: 1,
        })),
        territory: players.map((seat, index) => ({ arrow: bareArrow(ground, index), owner: seat })),
        spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
      });
    const walks = (players: readonly PlayerId[]): number => {
      const authored = alive(players);
      const territory = countingMap(authored.territory);
      const groups = countingMap(authored.groups);
      const state: GameState = { ...authored, territory: territory.map, groups: groups.map };
      return traversalsOf([territory, groups], () => {
        const settled = resolveLosses(state, ground.geometry);
        if (settled.territory.size !== authored.territory.size) {
          throw new Error('setup: that board was meant to lose nobody');
        }
      });
    };

    const twoSeats = walks([A, B]);
    const sixSeats = walks(SIX);

    expect(sixSeats).toBe(twoSeats);
    // Non-vacuous: the resolution really does read them. Zero would mean it decided
    // who is lost without looking at the board.
    expect(twoSeats).toBeGreaterThan(0);
  });

  it('references neither a clock nor a random source in victory.ts', () => {
    const src = readFileSync(new URL('../src/victory.ts', import.meta.url), 'utf8');
    // Call-shaped, and scoped to what invariant 15 actually claims: a clock and a
    // random source. `process` and `fetch` are deliberately absent — they are I/O,
    // not a clock, and they belong to the ESLint purity guard, which bans them as
    // globals across all of `packages/rules-core/**` at the AST level.
    //
    // That split is not tidiness. This test reads the file off disk, so under
    // Stryker it reads the *instrumented* copy — and the namespace shim the
    // instrumenter injects contains `process.env.__STRYKER_ACTIVE_MUTANT__`. A
    // substring or even a call-shaped `process.env` check therefore fails the dry
    // run on the harness rather than on the source, which is what has left
    // `pnpm test:mutation` dead for all of rules-core since P36. The lint rule has
    // no such problem: it reads the real source, and it is the stronger check.
    for (const banned of [
      /\bDate\s*\.\s*now\s*\(/,
      /\bnew\s+Date\b/,
      /\bMath\s*\.\s*random\s*\(/,
      /\bperformance\s*\.\s*now\s*\(/,
      /\bcrypto\s*\./,
    ]) {
      expect(src).not.toMatch(banned);
    }
  });
});

