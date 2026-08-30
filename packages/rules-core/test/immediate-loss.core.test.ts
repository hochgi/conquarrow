/**
 * One test per scenario of docs/spec/immediate-loss/immediate-loss.core.feature.
 *
 * P37 moves loss resolution from the round boundary onto the tail of every
 * `apply`, so almost everything here is a *timing* assertion read off the single
 * state one move returns — never off a state a later end-turn produced.
 *
 * Four scenarios of the core feature are replay scenarios and live in
 * `immediate-loss.replay.test.ts` rather than being restated here:
 *
 * - *The same seats are lost over a whole match*
 * - *The reported playtest log is a P47 prefix golden* (was: ends on the deciding move)
 * - *Some player owns a share in every state of a replay*
 * - *At least one seat is not lost in every state of a replay*
 *
 * Written against the ports (`RulesPort`, `GeometryPort`). Closure scenarios run
 * on the generated tiling, because closure asks *cannot reach infinity* and a
 * finite fixture has no infinity to fail to reach (§11 item 4); everything else
 * runs on the P02 fixture, where a failure prints.
 *
 * @see docs/spec/immediate-loss/immediate-loss.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, speed, step } from '@conquarrow/contracts';
import type { GameState, PlayerId } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '../src/index';
import { isLost, shareCountOf, territoryCountOf } from '../src/victory';
import {
  aLandBridge,
  anEncirclingLoop,
  closingStep,
  crossing,
  farArrow,
  landOf,
  lostAlong,
  ownedSharesOf,
  someSeatOwnsAShare,
} from './immediate.support';
import type { LandBridge } from './immediate.support';
import {
  A,
  B,
  C,
  D,
  THREE,
  aBoard,
  aVertex,
  bareArrow,
  closeRound,
  held,
  holdingsOf,
  seatState,
  shareArrow,
  streakOf,
} from './losing.support';
import { anExitFrom, headsOn, snapshot } from './support';

// ── the board every closure scenario is built on ─────────────────────────────

/**
 * A board where A's next step is a land bridge and the `victim`'s **last**
 * territory is the arrow that bridge claims.
 *
 * The victim also holds one head, far from the bridge, for two reasons that are
 * the same reason: it makes the seat a *legal* seat before the move (territory,
 * no share, a head — the starvation-clock row, §9) rather than one already lost,
 * and it makes the removal visible in the state the step returns. Every other
 * named seat gets its own far arrow and a head, so nothing but the victim is
 * decided by this step.
 */
const aDecidedPosition = (
  bridge: LandBridge,
  players: readonly PlayerId[],
  options: {
    readonly victim: PlayerId;
    readonly moverHeads?: number;
    /** Seats given ground and a head, so they are plainly still playing. */
    readonly alsoPlaying?: readonly PlayerId[];
  },
): GameState => {
  const bystanders = options.alsoPlaying ?? [];
  const victimHead = farArrow(bridge, 0);
  const homeOf = (index: number): ReturnType<typeof farArrow> => farArrow(bridge, index + 1);
  return seatState({
    players,
    activePlayer: A,
    groups: [
      { arrow: bridge.bridge, owner: A, heads: options.moverHeads ?? 1 },
      { arrow: victimHead, owner: options.victim, heads: 1 },
      ...bystanders.map((seat, index) => ({ arrow: homeOf(index), owner: seat, heads: 1 })),
    ],
    trails: [
      [A, [bridge.bridge]],
      [options.victim, [victimHead]],
    ],
    territory: [
      ...held([bridge.home, bridge.landing], A),
      { arrow: bridge.bridge, owner: options.victim },
      ...bystanders.map((seat, index) => ({ arrow: homeOf(index), owner: seat })),
    ],
  });
};

/** The arrow the victim's head stands on in {@link aDecidedPosition}. */
const victimHeadArrow = (bridge: LandBridge): ReturnType<typeof farArrow> =>
  farArrow(bridge, 0);

// ── Rule: The deciding move ends the match ───────────────────────────────────

describe('the deciding move ends the match', () => {
  it('crowns the mover on the step whose closure takes the last enemy territory', () => {
    // The Given, exactly: *B is already lost*, and *C's last territory lies inside
    // a loop A can close in one step*. Inside, not on the path — so this is the
    // encircling shape and not the land bridge every other scenario here uses, and
    // the claim has to be a real fill for the premise to be the stated one.
    const loop = anEncirclingLoop();
    const before = seatState({
      players: THREE,
      activePlayer: A,
      groups: [
        { arrow: loop.tip, owner: A, heads: 1 },
        { arrow: loop.far, owner: C, heads: 1 },
      ],
      trails: [[A, loop.trail]],
      territory: [...held([loop.home], A), { arrow: loop.inside, owner: C }],
    });
    expect(isLost(before, B, loop.geometry)).toBe(true);
    expect(isLost(before, C, loop.geometry)).toBe(false);
    expect(territoryCountOf(before, C)).toBe(1);
    expect(before.winner).toBeUndefined();
    const claim = loop.rules.closureOf(before, closingStep(loop), A);
    if (claim === undefined) throw new Error('setup: that step closes nothing');
    expect(claim.enclosed).toContain(loop.inside);
    expect(claim.path).not.toContain(loop.inside);

    const after = loop.rules.apply(before, closingStep(loop));

    expect(after.winner).toBe(A);
  });

  it('returns a state in which the losing seat holds no heads, no marks and no land', () => {
    const bridge = aLandBridge();
    const before = aDecidedPosition(bridge, [A, B, C, D], { victim: C, alsoPlaying: [B, D] });
    expect(holdingsOf(before, C).heads).toBe(1);

    const after = bridge.rules.apply(before, crossing(bridge));

    expect(holdingsOf(after, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
  });

  it('offers a lost seat nothing but the pass, and passing applies nothing', () => {
    const bridge = aLandBridge();
    const before = aDecidedPosition(bridge, [A, B, C, D], { victim: C, alsoPlaying: [B, D] });

    const decided = bridge.rules.apply(before, crossing(bridge));
    // Round the chair to what would have been C's turn.
    const atB = bridge.rules.apply(decided, endTurn());
    const atC = bridge.rules.apply(atB, endTurn());

    expect(atC.activePlayer).toBe(C);
    // "No legal move" in this engine is *only the pass*: a seat is passed, never
    // skipped, because `players[0]` is the boundary marker (§9 / P36).
    expect(bridge.rules.legalMoves(atC)).toEqual([endTurn()]);
    const passed = bridge.rules.apply(atC, endTurn());
    expect(snapshot({ ...passed, activePlayer: atC.activePlayer })).toEqual(snapshot(atC));
  });

  it('sets the winner without an end of turn', () => {
    const bridge = aLandBridge();
    const before = aDecidedPosition(bridge, THREE, { victim: C });

    const after = bridge.rules.apply(before, crossing(bridge));

    expect(after.winner).toBe(A);
    // The chair never moved, so nothing ended the turn.
    expect(after.activePlayer).toBe(before.activePlayer);
    expect(after.activePlayer).toBe(A);
  });
});

// ── Rule: Losses resolve after every kind of move ────────────────────────────

/** A board where C already holds nothing, so any move at all decides it. */
const aLandlessSeat = (): {
  readonly ground: ReturnType<typeof aBoard>;
  readonly state: GameState;
  readonly moverArrow: ReturnType<typeof shareArrow>;
} => {
  const ground = aBoard();
  const moverArrow = shareArrow(ground, 0);
  const state = seatState({
    players: THREE,
    activePlayer: A,
    groups: [
      { arrow: moverArrow, owner: A, heads: 2 },
      { arrow: bareArrow(ground, 0), owner: B, heads: 1 },
      { arrow: bareArrow(ground, 1), owner: C, heads: 1 },
    ],
    territory: [{ arrow: moverArrow, owner: A }, ...held([bareArrow(ground, 0)], B)],
    spawners: [[aVertex(ground), { force: { num: 1, den: 3 }, phase: 0 }]],
  });
  return { ground, state, moverArrow };
};

describe('losses resolve after every kind of move', () => {
  // The feature's outline has one example per move kind — a step and an end turn
  // — and each gets its own test rather than a table, because each names a
  // different move and the outline's only variable *is* the move.
  it('resolves a loss after a step', () => {
    const { ground, state, moverArrow } = aLandlessSeat();
    const exit = anExitFrom(ground.geometry, moverArrow);

    const after = ground.rules.apply(state, step(moverArrow, exit, 1));

    expect(lostAlong(after, ground.geometry)).toContain('C');
    expect(holdingsOf(after, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
  });

  it('resolves a loss after an end turn', () => {
    const { ground, state } = aLandlessSeat();

    const after = ground.rules.apply(state, endTurn());

    expect(lostAlong(after, ground.geometry)).toContain('C');
    expect(holdingsOf(after, C)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
  });

  it('leaves the mover’s allowance alone when its step costs a seat its last land', () => {
    const bridge = aLandBridge();
    const before = aDecidedPosition(bridge, [A, B, C, D], {
      victim: C,
      moverHeads: 4,
      alsoPlaying: [B, D],
    });
    // Four heads is three steps (§3), so one spent leaves two. The whole stack
    // crosses, so the allowance to read is the landed group's.
    expect(speed(4)).toBe(3);

    const after = bridge.rules.apply(before, step(bridge.bridge, bridge.landing, 4));

    expect(isLost(after, C, bridge.geometry)).toBe(true);
    const landed = after.groups.get(bridge.landing);
    if (landed === undefined) throw new Error('setup: the step did not land');
    expect(bridge.rules.effectiveSpeed(after, bridge.landing) - landed.spent).toBe(2);
    expect(
      bridge.rules.legalMoves(after).some((move) => move.kind === 'step'),
    ).toBe(true);
  });

  it('takes the losing seat’s heads off the board the mover keeps moving on', () => {
    const bridge = aLandBridge();
    const before = aDecidedPosition(bridge, [A, B, C, D], {
      victim: C,
      moverHeads: 4,
      alsoPlaying: [B, D],
    });
    const stood = victimHeadArrow(bridge);
    expect(headsOn(before, stood)).toBe(1);

    const after = bridge.rules.apply(before, crossing(bridge));

    expect(headsOn(after, stood)).toBe(0);
    expect(after.groups.has(stood)).toBe(false);
  });
});

// ── Rule: Timing moved, outcomes did not ─────────────────────────────────────

/** A destitute seat one round short of the threshold, on a board with survivors. */
const aStarvingSeat = (streak: number): {
  readonly ground: ReturnType<typeof aBoard>;
  readonly state: GameState;
} => {
  const ground = aBoard();
  const bare = bareArrow(ground, 0);
  const state = seatState({
    players: THREE,
    activePlayer: A,
    groups: [
      { arrow: bare, owner: A, heads: 2 },
      { arrow: shareArrow(ground, 0), owner: B, heads: 1 },
      { arrow: shareArrow(ground, 1), owner: C, heads: 1 },
    ],
    territory: [
      ...held([bare], A),
      { arrow: shareArrow(ground, 0), owner: B },
      { arrow: shareArrow(ground, 1), owner: C },
    ],
    spawners: [[aVertex(ground), { force: { num: 1, den: 3 }, phase: 0 }]],
    starvationStreaks: [[A, streak]],
    dominationN: 2,
  });
  return { ground, state };
};

describe('timing moved, outcomes did not', () => {
  it('still makes a starvation loss wait for the boundary', () => {
    const { ground, state } = aStarvingSeat(1);
    const bare = bareArrow(ground, 0);
    const exit = anExitFrom(ground.geometry, bare);

    const stepped = ground.rules.apply(state, step(bare, exit, 1));

    expect(isLost(stepped, A, ground.geometry)).toBe(false);
    expect(streakOf(stepped, A)).toBe(1);

    const closed = closeRound(ground.rules, state);

    expect(isLost(closed, A, ground.geometry)).toBe(true);
  });

  it('advances a starvation streak only at a boundary', () => {
    const { ground, state } = aStarvingSeat(1);
    const bare = bareArrow(ground, 0);

    let walked = state;
    for (let i = 0; i < 2; i += 1) {
      const from = [...walked.groups.entries()].find(([, group]) => group.owner === A)?.[0];
      if (from === undefined) throw new Error('setup: A has no group to walk');
      walked = ground.rules.apply(walked, step(from, anExitFrom(ground.geometry, from), 1));
    }

    expect(streakOf(walked, A)).toBe(1);
    expect(streakOf(state, A)).toBe(1);
    expect(walked.groups.has(bare)).toBe(false);
  });

  it('still accrues before it resolves, so a headless share owner is paid, not lost', () => {
    const ground = aBoard();
    const feed = shareArrow(ground, 0);
    const phase = ground.shares.indexOf(feed);
    const before = seatState({
      players: THREE,
      groups: [
        { arrow: shareArrow(ground, 1), owner: B, heads: 1 },
        { arrow: bareArrow(ground, 0), owner: C, heads: 1 },
      ],
      territory: [
        { arrow: feed, owner: A },
        { arrow: shareArrow(ground, 1), owner: B },
        ...held([bareArrow(ground, 0)], C),
      ],
      accumulators: [[feed, { num: 2, den: 3 }]],
      spawners: [[aVertex(ground), { force: { num: 1, den: 3 }, phase }]],
    });

    const after = closeRound(ground.rules, before);

    expect(headsOn(after, feed)).toBe(1);
    expect(isLost(after, A, ground.geometry)).toBe(false);
  });
});

// ── Rule: Some seat is always alive ──────────────────────────────────────────

describe('some seat is always alive', () => {
  it('opens every seat owning at least one spawner share', () => {
    const geometry = makeTiling();
    for (const playerCount of [2, 3, 6]) {
      const opening = makeMatch({
        dominationN: 5,
        R: 7,
        homeOffset: 5,
        playerCount,
        spawnerSeed: 1,
      });
      expect(opening.players).toHaveLength(playerCount);
      for (const player of opening.players) {
        expect(shareCountOf(opening, player, geometry)).toBeGreaterThan(0);
        expect(territoryCountOf(opening, player)).toBeGreaterThan(0);
      }
    }
  });

  it('vacates no spawner-border arrow when a seat is lost', () => {
    const ground = aBoard();
    // C holds bare ground only, so C goes on the first move; the arrow it leaves
    // must not be a share (invariant 22 of P36, and link 3 of the item-44 chain).
    const before = seatState({
      players: THREE,
      activePlayer: A,
      groups: [{ arrow: shareArrow(ground, 0), owner: A, heads: 2 }],
      territory: [
        { arrow: shareArrow(ground, 0), owner: A },
        { arrow: shareArrow(ground, 1), owner: B },
        ...held([bareArrow(ground, 0)], C),
      ],
      spawners: [[aVertex(ground), { force: { num: 1, den: 3 }, phase: 0 }]],
    });
    const ownedBefore = ownedSharesOf(before, ground.geometry);

    const after = ground.rules.apply(before, endTurn());

    expect(landOf(after, C)).toEqual([]);
    // Read off the *state*, not off the fixture's own split of shares and bare
    // ground: asserting that `bareArrow(0)` is not a share only restates how
    // `bareArrow` chose it. What the invariant claims is that no spawner-border
    // arrow which had an owner lost it across the move.
    const ownedAfter = ownedSharesOf(after, ground.geometry);
    expect([...ownedBefore.keys()].filter((arrow) => !ownedAfter.has(arrow))).toEqual([]);
    expect(ownedBefore.size).toBeGreaterThan(0);
  });

  it('gives every arrow a claim takes an owner, rather than clearing it', () => {
    const bridge = aLandBridge();
    const before = aDecidedPosition(bridge, [A, B, C, D], {
      victim: C,
      alsoPlaying: [B, D],
    });

    const ownedArrows = (state: GameState): readonly string[] =>
      [...state.territory.keys()].map(String).toSorted();
    const before0 = ownedArrows(before);

    const after = bridge.rules.apply(before, crossing(bridge));

    expect(after.territory.get(bridge.bridge)).toBe(A);
    // The live claim. C's last arrow *is* the arrow the bridge claims, and C
    // vanishes on this same step — so if the vanish cleared what the claim had
    // just re-owned, that arrow would leave the map. Every arrow that had an owner
    // before still has one. (Walking `after.territory` for a defined value cannot
    // fail: a `Map<ArrowId, PlayerId>` has no undefined values to find.)
    expect(isLost(after, C, bridge.geometry)).toBe(true);
    expect(ownedArrows(after)).toEqual(before0);
  });

  it('keeps some seat owning a share at the opening of a generated match', () => {
    const geometry = makeTiling();
    const opening = makeMatch({
      dominationN: 5,
      R: 7,
      homeOffset: 5,
      playerCount: 6,
      spawnerSeed: 1,
    });

    expect(someSeatOwnsAShare(opening, geometry)).toBe(true);
    expect(makeRules(geometry).legalMoves(opening).length).toBeGreaterThan(0);
  });
});
