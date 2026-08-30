/**
 * The EARS invariants of docs/spec/won-is-over/won-is-over.md, as properties.
 *
 * Invariants 1–9 are the rules half; 10–13 are the adapter's and live in
 * `packages/web/test/won-is-over.celebration.test.ts`. Invariant 5 (refuse the
 * first move after a win) is proven on `aWonPosition` / `aMatchLosingThree`.
 * Invariant 6 (the 2026-08-20 log refuses at 233 and names that step) lives in
 * `won-is-over.replay.test.ts` as a P47 prefix golden.
 *
 * The gates themselves are one `undefined` check each, so the value here is
 * **quantification**, not shape: the scenario suite asserts each gate once, and
 * these assert it over every seat that could be the winner, every seat that could
 * hold the chair, every move kind, and both boards the packet touches. A gate
 * written into one branch of a switch, or one that consulted `activePlayer` as well
 * as `winner`, passes a single example and fails here.
 *
 * @see docs/spec/won-is-over/won-is-over.md
 * @see .claude/skills/rules-invariants/SKILL.md
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, step } from '@conquarrow/contracts';
import type { GameState, Move, PlayerId, RulesPort } from '@conquarrow/contracts';
import { headsOf, isLost, territoryCountOf } from '../src/victory';
import { A, B, C, aBoard, bareArrow, held, seatState } from './losing.support';
import { byId, isTrail, snapshot, trailOf } from './support';
import {
  aWinningClosure,
  aWinningWipe,
  aWonPosition,
  outcomeOf,
} from './won-is-over.support';
import type { WonPosition } from './won-is-over.support';

// ── the family every property quantifies over ────────────────────────────────

const SEATS: readonly PlayerId[] = [A, B, C];

/**
 * Every (winner, chair) pairing on the fixture board, named.
 *
 * Nine states, and the diagonal matters most: *winner === activePlayer* is the
 * window item 46 was opened by — the winning seat still holds the chair with
 * allowance unspent, which is the one seat a `legalMoves` that never consulted
 * `winner` was certain to keep offering steps to.
 */
const wonStates = (): readonly {
  readonly name: string;
  readonly position: WonPosition;
}[] =>
  SEATS.flatMap((winner) =>
    SEATS.map((chair) => ({
      name: `${String(winner)} won, ${String(chair)} holds the chair`,
      position: aWonPosition({ winner, activePlayer: chair }),
    })),
  );

/**
 * A won state on the **generated tiling** rather than a fixture — the same two
 * gates over a board with a different id space, a different degree of adjacency
 * and real spawners.
 *
 * Reached by *playing* the deciding move rather than authored, so it is the state
 * a caller actually holds when it asks the question P38 answers.
 */
const wonByPlaying = (): { readonly rules: RulesPort; readonly state: GameState } => {
  const loop = aWinningClosure();
  const after = loop.rules.apply(loop.before, loop.closing);
  if (after.winner === undefined) throw new Error('setup: that closure did not win');
  return { rules: loop.rules, state: after };
};

/** One move of each kind, against a state, whatever the board. */
const everyKindAgainst = (
  state: GameState,
): readonly (readonly [string, Move])[] => {
  const held = [...state.groups.keys()].toSorted(byId)[0];
  if (held === undefined) throw new Error('setup: that state holds no group at all');
  const exit = [...state.territory.keys()].toSorted(byId).find((arrow) => arrow !== held);
  if (exit === undefined) throw new Error('setup: that state owns no second arrow');
  return [
    ['a step', step(held, exit, 1)],
    ['an end of turn', endTurn()],
  ];
};

// ── 1: a won state offers nothing ────────────────────────────────────────────

describe('1. when `winner` is set the system shall offer no legal move', () => {
  it('offers nothing for any winner, whoever holds the chair', () => {
    const offers = wonStates().map(({ name, position }) => ({
      name,
      offered: position.rules.legalMoves(position.won).length,
    }));

    expect(offers).toEqual(offers.map(({ name }) => ({ name, offered: 0 })));
  });

  it('offers a good deal on each of those boards before the winner is set', () => {
    // The other half of the property, and the half that keeps it from being a
    // statement about a barren board: the identical states minus `winner` all offer
    // steps and the pass.
    const live = wonStates().map(({ name, position }) => ({
      name,
      offered: position.rules.legalMoves(position.live).length > 1,
    }));

    expect(live).toEqual(live.map(({ name }) => ({ name, offered: true })));
  });

  it('offers nothing on the tiling either, in the state the deciding move returned', () => {
    const { rules, state } = wonByPlaying();

    expect(rules.legalMoves(state)).toEqual([]);
  });
});

// ── 2: a won state refuses every move, and returns no state ──────────────────

describe('2. when `winner` is set the system shall refuse every move', () => {
  it('refuses every kind from every won state with a ContractViolation', () => {
    const outcomes = wonStates().flatMap(({ name, position }) =>
      everyKindAgainst(position.won).map(([kind, move]) => {
        const outcome = outcomeOf(position.rules, position.won, move);
        return {
          where: `${name}, ${kind}`,
          refused: outcome.refused,
          named: outcome.refused ? outcome.name : 'no refusal',
        };
      }),
    );

    expect(outcomes).toEqual(
      outcomes.map(({ where }) => ({ where, refused: true, named: 'ContractViolation' })),
    );
  });

  it('hands back no state at all, which a thrown-or-not assertion cannot say', () => {
    // The second clause of invariant 2. `toThrow` says a refusal happened; it does
    // not say the call produced nothing — an implementation that returned the input
    // *and* warned would satisfy the first reading and not this one.
    const returned = wonStates().flatMap(({ name, position }) =>
      everyKindAgainst(position.won).map(([kind, move]) => ({
        where: `${name}, ${kind}`,
        state: outcomeOf(position.rules, position.won, move).refused ? undefined : 'a state',
      })),
    );

    expect(returned).toEqual(returned.map(({ where }) => ({ where, state: undefined })));
  });

  it('refuses on the tiling too, in the state the deciding move returned', () => {
    const { rules, state } = wonByPlaying();

    for (const [, move] of everyKindAgainst(state)) {
      expect(() => rules.apply(state, move)).toThrow(ContractViolation);
    }
  });
});

// ── 3: the deciding move resolves every effect it causes ─────────────────────

describe('3. the deciding move shall resolve every effect it causes', () => {
  it('claims the ring, fills its inside and converts the stack, in one returned state', () => {
    // Closure, fill and conversion — three of the four effects invariant 3 names,
    // all of them read off the single state the closing step returns and none of
    // them off a later boundary.
    const loop = aWinningClosure();

    const after = loop.rules.apply(loop.before, loop.closing);

    expect({
      winner: String(after.winner),
      ring: loop.interior.map((arrow) => String(after.territory.get(arrow))),
      converted: String(after.groups.get(loop.victimStack)?.owner),
      victimLand: String(after.territory.get(loop.victimLand)),
    }).toEqual({
      winner: String(A),
      ring: loop.interior.map(() => String(A)),
      converted: String(A),
      victimLand: String(A),
    });
  });

  it('takes the last head and clears the trail the fire ran along, in one returned state', () => {
    // The fourth effect, as far as a board can carry it. `aWinningWipe` explains why
    // no board can show the *evaporated arrows* of a deciding move: the seat whose
    // trail burns is the seat that vanishes, and a bystander whose trail burned
    // instead would be a second survivor and the move would have decided nothing.
    // What is asserted is the kill evaporation was reached through, and that the
    // victim's trail is not in the state the step returns.
    const wipe = aWinningWipe();
    expect(headsOf(wipe.before, C)).toBe(1);
    expect(isTrail(wipe.before, C, wipe.beyond)).toBe(true);

    const after = wipe.rules.apply(wipe.before, wipe.wiping);

    expect({
      winner: String(after.winner),
      victimHeads: headsOf(after, C),
      victimTrail: trailOf(after, C),
      victimLand: territoryCountOf(after, C),
      lost: isLost(after, C, wipe.geometry),
      moverHolds: String(after.groups.get(wipe.victimHead)?.owner),
    }).toEqual({
      winner: String(A),
      victimHeads: 0,
      victimTrail: [],
      victimLand: 0,
      lost: true,
      moverHolds: String(A),
    });
  });
});

// ── 4: never refused on account of the win it causes ─────────────────────────

describe('4. the system shall never refuse a move for a winner that move sets', () => {
  it('accepts every deciding move this packet can author', () => {
    // The reason the gate sits at the **top** of `apply`, above `dispatch`, and not
    // anywhere near `resolveLosses` on its tail. Both shapes of deciding move: a
    // closure on the tiling and a combat wipe on the fixture.
    const loop = aWinningClosure();
    const wipe = aWinningWipe();
    const deciding: readonly (readonly [string, RulesPort, GameState, Move])[] = [
      ['a closure that encircles the last territory', loop.rules, loop.before, loop.closing],
      ['a wipe that takes the last head', wipe.rules, wipe.before, wipe.wiping],
    ];

    const outcomes = deciding.map(([name, rules, before, move]) => {
      const outcome = outcomeOf(rules, before, move);
      return {
        name,
        refused: outcome.refused,
        winner: outcome.refused ? undefined : String(outcome.state.winner),
      };
    });

    expect(outcomes).toEqual(
      outcomes.map(({ name }) => ({ name, refused: false, winner: String(A) })),
    );
  });

  it('is offered the deciding move by `legalMoves` right up to the move itself', () => {
    // The other direction of the standing invariant *everything `legalMoves` offers,
    // `apply` accepts*: the gate must not withdraw the winning move from the offer
    // list of the state that precedes it.
    const wipe = aWinningWipe();

    const offered = wipe.rules.legalMoves(wipe.before);

    expect(
      offered.some(
        (move) =>
          move.kind === 'step' && move.from === wipe.wiping.from && move.exit === wipe.victimHead,
      ),
    ).toBe(true);
  });
});

// ── 7: refusing mutates nothing ──────────────────────────────────────────────

describe('7. the system shall not mutate the input state when it refuses', () => {
  it('leaves every won state byte-identical after every refused move', () => {
    const drift = wonStates().flatMap(({ name, position }) =>
      everyKindAgainst(position.won).map(([kind, move]) => {
        const before = snapshot(position.won);
        outcomeOf(position.rules, position.won, move);
        return {
          where: `${name}, ${kind}`,
          same: JSON.stringify(snapshot(position.won)) === JSON.stringify(before),
        };
      }),
    );

    expect(drift).toEqual(drift.map(({ where }) => ({ where, same: true })));
  });

  it('leaves the very map objects it was handed in place', () => {
    // Stronger than a snapshot compare and cheaper than one: a refusal that rebuilt
    // `groups` into an equal map would pass the snapshot and is still a copy the
    // caller did not ask for. Identity is the only way to say *untouched*.
    const position = aWonPosition();
    const maps = {
      groups: position.won.groups,
      trails: position.won.trails,
      territory: position.won.territory,
      accumulators: position.won.accumulators,
    };
    const sizes = {
      groups: maps.groups.size,
      trails: maps.trails.size,
      territory: maps.territory.size,
    };

    for (const [, move] of everyKindAgainst(position.won)) {
      outcomeOf(position.rules, position.won, move);
    }

    expect({
      groups: position.won.groups === maps.groups,
      trails: position.won.trails === maps.trails,
      territory: position.won.territory === maps.territory,
      accumulators: position.won.accumulators === maps.accumulators,
      sizes: {
        groups: position.won.groups.size,
        trails: position.won.trails.size,
        territory: position.won.territory.size,
      },
    }).toEqual({
      groups: true,
      trails: true,
      territory: true,
      accumulators: true,
      sizes,
    });
  });
});

// ── 8: equal won states refuse equally ───────────────────────────────────────

describe('8. equal won states shall refuse equal moves with equal messages', () => {
  it('gives two independently built boards the same refusal, kind by kind', () => {
    const left = aWonPosition();
    const right = aWonPosition();
    // Built twice, asserted equal first — otherwise "equal messages" is a statement
    // about two names for one object.
    expect(snapshot(right.won)).toEqual(snapshot(left.won));

    const refusals = everyKindAgainst(left.won).map(([kind, move]) => {
      const one = outcomeOf(left.rules, left.won, move);
      const other = outcomeOf(right.rules, right.won, move);
      return {
        kind,
        one: one.refused ? { name: one.name, message: one.message } : 'accepted',
        other: other.refused ? { name: other.name, message: other.message } : 'accepted',
      };
    });

    expect(refusals.map(({ kind, other }) => ({ kind, one: other }))).toEqual(
      refusals.map(({ kind, one }) => ({ kind, one })),
    );
    expect(refusals.map(({ one }) => one)).not.toContain('accepted');
  });

  it('says the same thing about a legal move and an illegal one', () => {
    // *Total*, in the sense the edge-case feature means it: the gate is not a filter
    // over illegal moves. A step against the grain and a step every other rule
    // permits get the identical refusal, because neither was ever looked at.
    const position = aWonPosition();

    const bad = outcomeOf(position.rules, position.won, position.bad);
    const good = outcomeOf(position.rules, position.won, position.good);

    expect(bad.refused && good.refused).toBe(true);
    if (!bad.refused || !good.refused) throw new Error('unreachable: asserted refused above');
    expect(bad.message).toEqual(good.message);
  });
});

// ── 9: a won state is reached through a move, never through `legalMoves` ──────

describe('9. the system shall reach a won state only through a move', () => {
  it('does not mutate a won state when asked for its moves', () => {
    // The purity claim about the new gate. `legalMoves` returning `[]` is the whole
    // of its behaviour here — it must not, on the way, latch a flag, prune a dead
    // seat, or rebuild a map. Asserted as identity on every collection plus a
    // snapshot compare, and asked repeatedly so a first-call side effect cannot
    // hide behind a second call's answer.
    const position = aWonPosition();
    const before = snapshot(position.won);
    const maps = {
      groups: position.won.groups,
      trails: position.won.trails,
      territory: position.won.territory,
      accumulators: position.won.accumulators,
      spawners: position.won.spawners,
      starvationStreaks: position.won.starvationStreaks,
      players: position.won.players,
    };

    const answers = [
      position.rules.legalMoves(position.won),
      position.rules.legalMoves(position.won),
      position.rules.legalMoves(position.won),
    ];

    expect(answers).toEqual([[], [], []]);
    expect(snapshot(position.won)).toEqual(before);
    expect({
      groups: position.won.groups === maps.groups,
      trails: position.won.trails === maps.trails,
      territory: position.won.territory === maps.territory,
      accumulators: position.won.accumulators === maps.accumulators,
      spawners: position.won.spawners === maps.spawners,
      starvationStreaks: position.won.starvationStreaks === maps.starvationStreaks,
      players: position.won.players === maps.players,
      winner: String(position.won.winner),
    }).toEqual({
      groups: true,
      trails: true,
      territory: true,
      accumulators: true,
      spawners: true,
      starvationStreaks: true,
      players: true,
      winner: String(A),
    });
  });

  it('never sets `winner` on a state `legalMoves` was asked about', () => {
    // The converse, and the one that would catch a gate implemented as "ask for the
    // moves, and if there are none the match is over". `winner` is set by
    // `resolveLosses` on the tail of `apply` and by nothing else, so a state that no
    // move has been applied to must come back out with the winner it went in with —
    // including `undefined`, on a board that is one move from decided.
    const wipe = aWinningWipe();
    const board = seatState({
      players: [A, C],
      activePlayer: C,
      groups: [{ arrow: bareArrow(wipe.ground, 0), owner: A, heads: 1 }],
      territory: held([bareArrow(wipe.ground, 0)], A),
    });
    // C owns nothing here, so one resolution away from a decided match — and asking
    // is not that resolution.
    expect(isLost(board, C, wipe.geometry)).toBe(true);

    const offered = wipe.rules.legalMoves(board);
    const askedAgain = wipe.rules.legalMoves(wipe.before);

    expect({
      offeredSomething: offered.length > 0,
      winnerAfterAsking: board.winner,
      decidedBoardWinner: wipe.before.winner,
      offeredOnDecidedBoard: askedAgain.length > 0,
    }).toEqual({
      offeredSomething: true,
      winnerAfterAsking: undefined,
      decidedBoardWinner: undefined,
      offeredOnDecidedBoard: true,
    });
  });
});

// ── the boundary this packet must not move ───────────────────────────────────

describe('a lost seat is not a won match', () => {
  it('offers a lost seat exactly the pass, on every board a won state was built on', () => {
    // P37 invariant 4, quantified alongside invariant 1 so the two cannot drift
    // apart. The reasoning inverts between them: a lost seat's slot still has to be
    // handed on, because `players[0]` is the round-boundary marker and a seat is
    // passed rather than skipped; a won match has no next turn for a pass to reach.
    const ground = aBoard();
    const lostChair = (chair: PlayerId): GameState =>
      seatState({
        players: [A, B, C],
        activePlayer: chair,
        groups: [{ arrow: bareArrow(ground, 0), owner: A, heads: 2 }],
        territory: [...held([bareArrow(ground, 0)], A), ...held([bareArrow(ground, 1)], B)],
      });

    const offers = [B, C].map((chair) => ({
      chair: String(chair),
      lost: isLost(lostChair(chair), chair, ground.geometry),
      offered: ground.rules.legalMoves(lostChair(chair)),
    }));

    expect(offers).toEqual(
      offers.map(({ chair }) => ({ chair, lost: true, offered: [endTurn()] })),
    );
  });
});
