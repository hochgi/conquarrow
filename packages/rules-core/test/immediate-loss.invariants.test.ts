/**
 * The 16 EARS invariants of docs/spec/immediate-loss/immediate-loss.md, as
 * properties rather than examples.
 *
 * The generator is the point, as it was for P36: every timing invariant below is
 * quantified over **every assignment of the four-case table's six rows to three
 * seats** — 216 boards — and over **all three move kinds**, so a rule that holds
 * for one landless seat and breaks for two is caught by construction. P37's
 * change is a change to *when* every one of those boards settles, which is
 * exactly the kind of thing a single hand-picked board hides.
 *
 * Invariants 9 and 10 are the item-44 chain and are quantified over every state a
 * replay passes through rather than over its endpoints, because the state the
 * chain rules out would exist for one move and be gone by the last.
 *
 * @see docs/spec/immediate-loss/immediate-loss.md
 * @see .claude/skills/rules-invariants/SKILL.md
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, skip, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PlayerId } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '../src/index';
import { headsOf, isLost, shareCountOf, territoryCountOf } from '../src/victory';
import {
  aMatchLosingThree,
  landOf,
  lostAlong,
  P47_PREFIX_FLOOR,
  playtestLog,
  someSeatIsAlive,
  someSeatOwnsAShare,
  statesAlong,
} from './immediate.support';
import {
  A,
  B,
  C,
  THREE,
  aBoard,
  aVertex,
  bareArrow,
  closeRound,
  held,
  holdingsOf,
  readingsOf,
  seatState,
  shareArrow,
  streakOf,
} from './losing.support';
import type { Ground } from './losing.support';
import { anExitFrom, countingVertices, exitsFrom, snapshot, vertexReadsOf } from './support';
import { replayIsDeterministic } from '../src/replay';

const FORCE = { num: 1, den: 3 } as const;

// ── the generator ────────────────────────────────────────────────────────────

/** One row of the four-case table (§9), as holdings a seat can be given. */
type Row = 0 | 1 | 2 | 3 | 4 | 5;
const ROWS: readonly Row[] = [0, 1, 2, 3, 4, 5];

/** `T`, `S`, `H` for each row, in the table's order. */
const READINGS: readonly { t: boolean; s: boolean; h: boolean }[] = [
  { t: false, s: false, h: false }, // T=0
  { t: false, s: false, h: true }, // T=0, heads
  { t: true, s: false, h: false }, // ground, no share, no head
  { t: true, s: false, h: true }, // ground, no share, heads — the clock
  { t: true, s: true, h: false }, // share, no head — alive, passed over
  { t: true, s: true, h: true }, // normal play
];

const readingFor = (row: Row): { t: boolean; s: boolean; h: boolean } => {
  const reading = READINGS[row];
  if (reading === undefined) throw new Error('setup: no such table row');
  return reading;
};

/** Every assignment of the six rows to three seats. */
const ASSIGNMENTS: readonly (readonly Row[])[] = ROWS.flatMap((a) =>
  ROWS.flatMap((b) => ROWS.map((c) => [a, b, c] as const)),
);

/**
 * A board giving seat `i` the holdings of `rows[i]`.
 *
 * Every seat gets its own share arrow and its own bare arrow, so no two seats can
 * collide and each reading is exactly what the row says. `activePlayer` is
 * `players[0]`, so one end-turn is one seat and three are one round.
 */
const boardFor = (ground: Ground, rows: readonly Row[], threshold = 5): GameState => {
  const groups: { arrow: ArrowId; owner: PlayerId; heads: number }[] = [];
  const territory: { arrow: ArrowId; owner: PlayerId }[] = [];
  THREE.forEach((seat, index) => {
    const reading = readingFor(rows[index] ?? 0);
    const share = shareArrow(ground, index);
    const bare = bareArrow(ground, index);
    const stand = bareArrow(ground, index + THREE.length);
    if (reading.s) territory.push({ arrow: share, owner: seat });
    else if (reading.t) territory.push({ arrow: bare, owner: seat });
    if (reading.h) groups.push({ arrow: stand, owner: seat, heads: 2 });
  });
  return seatState({
    players: THREE,
    activePlayer: A,
    groups,
    territory,
    spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
    dominationN: threshold,
  });
};

/** Whichever moves the active seat may make, one of each kind that is offered. */
const oneOfEachKind = (ground: Ground, state: GameState): readonly Move[] => {
  const mine = [...state.groups.entries()].find(
    ([, group]) => group.owner === state.activePlayer,
  );
  if (mine === undefined) return [endTurn()];
  const [arrow] = mine;
  return [step(arrow, anExitFrom(ground.geometry, arrow), 1), skip(arrow), endTurn()];
};

/** Seats the four-case table says are lost, read off a state. */
const qualifying = (state: GameState, ground: Ground): readonly string[] =>
  state.players
    .filter(
      (seat) =>
        territoryCountOf(state, seat) === 0 ||
        (shareCountOf(state, seat, ground.geometry) === 0 && headsOf(state, seat) === 0),
    )
    .map(String);

// ── 1, 2 and 5: the move that causes a loss records it ───────────────────────

describe('a move records the losses it causes', () => {
  it('1. records a player holding no territory as lost in the state that move returns', () => {
    const ground = aBoard();
    const offenders: string[] = [];
    for (const rows of ASSIGNMENTS) {
      const before = boardFor(ground, rows);
      const landless = THREE.filter((seat) => territoryCountOf(before, seat) === 0);
      if (landless.length === 0) continue;
      for (const move of oneOfEachKind(ground, before)) {
        const after = ground.rules.apply(before, move);
        for (const seat of landless) {
          if (holdingsOf(after, seat).heads !== 0 || landOf(after, seat).length !== 0) {
            offenders.push(`${rows.join('')}/${move.kind}/${String(seat)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. records a player with territory, no share and no head as lost in that same state', () => {
    const ground = aBoard();
    const offenders: string[] = [];
    for (const rows of ASSIGNMENTS) {
      const before = boardFor(ground, rows);
      const destitute = THREE.filter(
        (seat) =>
          territoryCountOf(before, seat) > 0 &&
          shareCountOf(before, seat, ground.geometry) === 0 &&
          headsOf(before, seat) === 0,
      );
      if (destitute.length === 0) continue;
      for (const move of oneOfEachKind(ground, before)) {
        const after = ground.rules.apply(before, move);
        for (const seat of destitute) {
          if (landOf(after, seat).length !== 0) {
            offenders.push(`${rows.join('')}/${move.kind}/${String(seat)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A seat with land, no share and **one head**, and the attack that kills it.
   *
   * The one path that *causes* invariant 2's row rather than authoring it. The
   * generator above selects `destitute` from the state *before* the move, so it
   * only ever checks that an already-destitute seat is settled; nothing there
   * makes a move produce `T>0, S=0, H=0`. Combat does: it is a deterministic 1:1
   * exchange (§6.2), so a lone defender is wiped, and the seat that owned it still
   * owns ground and still owns no share.
   *
   * Authored with `seatState`, which grants no keepalive. `stateOf`'s keepalive
   * hands every seat a share **specifically so this row cannot fire**, so no suite
   * built on it can reach here — which is exactly why the case had no test.
   */
  const aSeatAboutToLoseItsLastHead = (): {
    readonly ground: Ground;
    readonly before: GameState;
    readonly attack: Move;
    readonly victimHead: ArrowId;
    readonly victimLand: ArrowId;
  } => {
    const ground = aBoard();
    const attacker = shareArrow(ground, 0);
    const exits = exitsFrom(ground.geometry, attacker);
    const victimHead = exits[0];
    if (victimHead === undefined) throw new Error('setup: that share arrow has no exit');
    // B's ground is a share so B is plainly playing, and it must not be a
    // destination of the attack — a step onto enemy territory is a refused
    // self-convert (P28), not the attack this scenario is about.
    const bystanderLand = ground.shares.find(
      (arrow) => arrow !== attacker && !exits.includes(arrow),
    );
    if (bystanderLand === undefined) {
      throw new Error('setup: every other share arrow is an exit of the attacker');
    }
    const victimLand = ground.bare.find(
      (arrow) => arrow !== victimHead && !exits.includes(arrow),
    );
    if (victimLand === undefined) throw new Error('setup: no bare arrow clear of the attack');
    const before = seatState({
      players: THREE,
      activePlayer: A,
      groups: [
        { arrow: attacker, owner: A, heads: 3 },
        { arrow: bystanderLand, owner: B, heads: 1 },
        // C: ground, no share, and exactly one head — the seat this step decides.
        { arrow: victimHead, owner: C, heads: 1 },
      ],
      territory: [
        { arrow: attacker, owner: A },
        { arrow: bystanderLand, owner: B },
        ...held([victimLand], C),
      ],
      spawners: [[aVertex(ground), { force: FORCE, phase: 0 }]],
    });
    // §6.2 stay-behind: an attack may not empty `from`, so two of the three go.
    return { ground, before, attack: step(attacker, victimHead, 2), victimHead, victimLand };
  };

  it('2. records a seat whose last head combat kills as lost in that same state', () => {
    const { ground, before, attack, victimHead, victimLand } = aSeatAboutToLoseItsLastHead();
    // Before the move C is on the starvation clock, not lost: ground, no share,
    // one head. So the move is what *causes* the row.
    expect(readingsOf(before, C, ground.geometry)).toEqual({
      territory: 1,
      shares: 0,
      heads: 1,
    });
    expect(isLost(before, C, ground.geometry)).toBe(false);

    const after = ground.rules.apply(before, attack);

    // Combat took the head — A stands where C stood — and C is settled in the
    // state this one move returned, not at some later boundary.
    expect(after.groups.get(victimHead)?.owner).toBe(A);
    expect(headsOf(after, C)).toBe(0);
    expect(isLost(after, C, ground.geometry)).toBe(true);
    expect(landOf(after, C)).toEqual([]);
    expect(after.territory.get(victimLand)).toBeUndefined();
    // And nothing else was decided by it.
    expect(isLost(after, A, ground.geometry)).toBe(false);
    expect(isLost(after, B, ground.geometry)).toBe(false);
  });

  it('5. resolves losses after a step, after a skip and after an end of turn alike', () => {
    const ground = aBoard();
    const disagreements: string[] = [];
    for (const rows of ASSIGNMENTS) {
      const before = boardFor(ground, rows);
      const settled = oneOfEachKind(ground, before).map((move) =>
        lostAlong(ground.rules.apply(before, move), ground.geometry).join(','),
      );
      const [first] = settled;
      if (settled.some((one) => one !== first)) {
        disagreements.push(`${rows.join('')}: ${settled.join(' | ')}`);
      }
      // And every one of them has to have settled the board, not merely agreed.
      for (const move of oneOfEachKind(ground, before)) {
        const after = ground.rules.apply(before, move);
        const stillHolding = qualifying(after, ground).filter(
          (seat) => holdingsOf(after, THREE.find((s) => String(s) === seat) ?? A).land.length > 0,
        );
        if (stillHolding.length > 0) {
          disagreements.push(`${rows.join('')}/${move.kind} left ${stillHolding.join(',')}`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });
});

// ── 3 and 4: the winner, and what a lost seat is offered ─────────────────────

describe('the winner, and what a lost seat is offered', () => {
  it('3. sets the winner in the state the move returns when one seat is left', () => {
    const ground = aBoard();
    const wrong: string[] = [];
    for (const rows of ASSIGNMENTS) {
      const before = boardFor(ground, rows);
      for (const move of oneOfEachKind(ground, before)) {
        const after = ground.rules.apply(before, move);
        const living = THREE.filter((seat) => !isLost(after, seat, ground.geometry));
        const expected = living.length === 1 ? living[0] : undefined;
        if (after.winner !== expected) {
          wrong.push(`${rows.join('')}/${move.kind}: ${String(after.winner)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('4. offers a lost player nothing but the pass', () => {
    // *Nothing but the pass*, asserted as the whole offer list and not as the
    // absence of a step: `legalMoves` always offers `endTurn`, because `players[0]`
    // is the round-boundary marker and a seat is passed, never skipped (P36). So
    // the offer on a lost seat's turn is exactly one move, and it is the pass.
    //
    // Boards that settle **won** are excluded, and that is P38 rather than a
    // loophole: once `winner` is set the offer list is empty for every seat, lost
    // or not, because a won match has no next turn for a pass to advance to (§11
    // item 46). The two rules meet on a board where some seat is lost and some
    // seat still plays, which is what the filter leaves — and
    // `won-is-over.invariants.test.ts` holds the pair on one board so neither can
    // drift.
    const ground = aBoard();
    const offered: string[] = [];
    let checked = 0;
    for (const rows of ASSIGNMENTS) {
      // Settle the board first: an authored board can hold seats §8 calls
      // unplayable, and it is the *settled* board a seat is ever offered moves on.
      const settled = ground.rules.apply(boardFor(ground, rows), endTurn());
      if (settled.winner !== undefined) continue;
      for (const seat of THREE) {
        if (!isLost(settled, seat, ground.geometry)) continue;
        const seated: GameState = { ...settled, activePlayer: seat };
        const moves = ground.rules.legalMoves(seated);
        checked += 1;
        if (moves.length !== 1 || moves[0]?.kind !== 'endTurn') {
          offered.push(`${rows.join('')}/${String(seat)}: [${moves.map((m) => m.kind).join(',')}]`);
        }
      }
    }
    expect(offered).toEqual([]);
    // Non-vacuous: the filter leaves plenty of lost seats in an undecided match.
    expect(checked).toBeGreaterThan(0);
  });
});

// ── 6 and 7: what did *not* move ─────────────────────────────────────────────

describe('what P37 did not move', () => {
  it('6. advances a starvation streak only at a full-round boundary', () => {
    const ground = aBoard();
    const advanced: string[] = [];
    for (const rows of ASSIGNMENTS) {
      const before = boardFor(ground, rows, 5);
      for (const move of oneOfEachKind(ground, before)) {
        if (move.kind === 'endTurn') continue; // one end-turn of three is not a round
        const after = ground.rules.apply(before, move);
        for (const seat of THREE) {
          if (streakOf(after, seat) !== streakOf(before, seat)) {
            advanced.push(`${rows.join('')}/${move.kind}/${String(seat)}`);
          }
        }
      }
    }
    expect(advanced).toEqual([]);
  });

  it('7. accrues, then advances streaks, then resolves losses at the boundary', () => {
    // The order is observable in one board: A owns a share whose accumulator is
    // one step from a head and holds nothing else. Accrue-first pays it, so it is
    // never a loss candidate; resolve-first would have taken it.
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
        { arrow: bareArrow(ground, 0), owner: C },
      ],
      accumulators: [[feed, { num: 2, den: 3 }]],
      spawners: [[aVertex(ground), { force: FORCE, phase }]],
      starvationStreaks: [[C, 1]],
      dominationN: 2,
    });

    const after = closeRound(ground.rules, before);

    // accrue: A is paid a head. tick: C reaches the threshold. resolve: C goes.
    expect(headsOf(after, A)).toBe(1);
    expect(isLost(after, A, ground.geometry)).toBe(false);
    expect(landOf(after, C)).toEqual([]);
  });
});

// ── 8: the set of lost seats at the end of a record ──────────────────────────

describe('the lost set at the end of a record is the one the table qualifies', () => {
  it('8. loses exactly the seats the table qualifies, and one more move changes it not at all', () => {
    // **This does not prove that resolving more often never changes the outcome.**
    // The spec says so in as many words: the stronger claim has no direct test
    // without keeping a copy of the pre-P37 engine, and a second implementation to
    // maintain and be wrong in is not worth a green tick. It follows from removal
    // giving nobody anything, which is an argument and stays one.
    //
    // What is asserted is the observable consequence, exactly as invariant 8 now
    // reads: at the end of the record the set of lost seats is exactly the set the
    // §9 table qualifies, and one further move — one further chance to resolve —
    // leaves that set alone.
    //
    // Since P38 that record ends **won**, and a won match refuses every move (§11
    // item 46), so "one further chance to resolve changes nothing" holds in the
    // stronger form that no further chance can be asked for. Kept as an assertion
    // about what the settled set does next rather than dropped.
    const { ground, initial, moves } = aMatchLosingThree();

    const { stops } = statesAlong(ground.rules, initial, moves);
    const last = stops[stops.length - 1];
    if (last === undefined) throw new Error('setup: the record applied nothing');

    expect(lostAlong(last.state, ground.geometry)).toEqual(qualifying(last.state, ground));
    expect(last.state.winner).toBeDefined();
    expect(() => ground.rules.apply(last.state, endTurn())).toThrow(ContractViolation);
    expect(ground.rules.legalMoves(last.state)).toEqual([]);
    // Non-vacuous: seats really were lost along the way.
    expect(lostAlong(last.state, ground.geometry).length).toBeGreaterThan(0);
  });
});

// ── the *Cost* section: the share walk is short-circuited away ───────────────

describe('the share walk happens only for a seat that owns ground and holds no head', () => {
  it('walks no vertex at all unless some seat owns ground and holds no head', () => {
    // The spec's *Cost* section, as a property. `isLost(p)` is
    // `T === 0 || (S === 0 && H === 0)`, and evaluated in that order — with `H`
    // read before `S` — the `spawners × borderArrows` walk is reached only when a
    // seat owns ground and holds no head:
    //
    //   T === 0  ⇒ lost, no walk.   H > 0 ⇒ not lost, no walk.
    //   only T > 0 && H === 0 needs S.
    //
    // So on an ordinary board where every living seat holds heads, `apply` walks no
    // vertex *at all*. The spec makes that required rather than a taste: five other
    // packets say *the system shall enumerate no vertex*, and an unconditional walk
    // would break them on every move instead of in the one case that needs it.
    //
    // Quantified over all 216 assignments, and measured on a **non-boundary
    // end-turn**: the chair starts at `players[0]` of three, so one end-turn hands
    // the seat on without closing a round. That matters twice — accrual reads the
    // lattice by design (§7) and would swamp the measurement, and a step or a skip
    // could change a seat's own readings between the authored board and the board
    // resolution sees, which would make the predicate below the wrong predicate.
    const ground = aBoard();
    const spy = countingVertices(ground.geometry);
    const rules = makeRules(spy.geometry);
    const wrong: string[] = [];
    let sawZero = 0;
    let sawSome = 0;
    for (const rows of ASSIGNMENTS) {
      const before = boardFor(ground, rows);
      // Rows 2 and 4 are the two T>0, H=0 rows — the only ones that need S.
      const needsWalk = rows.some((row) => row === 2 || row === 4);
      const reads = vertexReadsOf(spy.vertexReads, () => {
        rules.apply(before, endTurn());
      });
      if (needsWalk) sawSome += 1;
      else sawZero += 1;
      if (needsWalk ? reads === 0 : reads !== 0) {
        wrong.push(`${rows.join('')}: ${String(reads)} read(s), needsWalk=${String(needsWalk)}`);
      }
    }

    expect(wrong).toEqual([]);
    // Non-vacuous in both directions: the generator really does produce boards of
    // each kind, so neither half of the iff is an empty quantifier.
    expect(sawZero).toBeGreaterThan(0);
    expect(sawSome).toBeGreaterThan(0);
  });
});

// ── 9, 10 and 11: the item-44 chain ──────────────────────────────────────────

describe('the item-44 chain, over every state a replay passes through', () => {
  const traces = (): readonly {
    readonly name: string;
    readonly states: readonly GameState[];
    readonly geometry: ReturnType<typeof makeTiling>;
  }[] => {
    const log = playtestLog();
    const geometry = makeTiling();
    const opening = log.opening;
    const rules = makeRules(geometry);
    const reported = statesAlong(rules, opening, log.moves);
    const states = [opening, ...reported.stops.map((stop) => stop.state)];
    // The floor belongs here, not in each caller. Invariants 9, 10 and 11 all
    // quantify over these states with no length of their own, so a fixture that
    // failed to load — or a record refused on its first move — would collapse the
    // trace to the opening alone and satisfy all three vacuously. P47 stops the
    // fold at `P47_FIRST_UNPLAYABLE` (233); the floor still bites a 0-move fold.
    expect(states.length).toBeGreaterThan(P47_PREFIX_FLOOR);
    return [{ name: 'the reported playtest log', states, geometry }];
  };

  it('9. keeps some player owning at least one spawner share in every state', () => {
    for (const { name, states, geometry } of traces()) {
      const shareless = states.filter((state) => !someSeatOwnsAShare(state, geometry));
      expect({ name, shareless: shareless.length }).toEqual({ name, shareless: 0 });
    }
  });

  it('10. keeps at least one player not lost in every state', () => {
    for (const { name, states, geometry } of traces()) {
      const empty = states.filter((state) => !someSeatIsAlive(state, geometry));
      expect({ name, empty: empty.length }).toEqual({ name, empty: 0 });
    }
  });

  it('11. never leaves the winner unset where every player is lost — vacuous by 10', () => {
    // This is **vacuous**, and the spec says so: invariant 10 makes the antecedent
    // unreachable, so there is no state in which the implication has anything to
    // check. It is written down anyway, and written down as an implication over an
    // empty set rather than dressed up as a live assertion, for one reason: if 10
    // ever breaks, 11 must break with it rather than keep passing on an empty
    // quantifier. So the emptiness itself is what is asserted first.
    for (const { states, geometry } of traces()) {
      const allLost = states.filter((state) => !someSeatIsAlive(state, geometry));
      expect(allLost).toEqual([]);
      for (const state of allLost) expect(state.winner).toBeDefined();
    }
  });
});

// ── 12 to 15: order, determinism, and purity ─────────────────────────────────

describe('order, determinism and purity', () => {
  it('12. resolves losses in state.players order', () => {
    // What this can and cannot show. Per-seat removal gives nobody anything, so
    // removals commute and the loop's *order* has no falsifying observation at all
    // — no state carries it, and the predicate is derived by filtering
    // `state.players`, so any answer read back is in that order by construction.
    // Comparing the reported order against `players.filter(isLost)` is therefore
    // comparing `lostAlong` to its own body: it cannot fail. (It did, until this
    // was rewritten.)
    //
    // What is real, and what a "resolve in order" loop actually gets wrong, is
    // *completeness*: a loop that removes the first qualifying seat and then reads
    // a stale state, or breaks, leaves later seats standing. So this asserts the
    // pass acted on **every** seat it calls lost — not just the earliest — and left
    // `state.players` itself alone (P36 invariant 14). The map-insertion-order half
    // is invariant 13's test.
    const ground = aBoard();
    const unfinished: string[] = [];
    for (const rows of ASSIGNMENTS) {
      const before = boardFor(ground, rows);
      const after = ground.rules.apply(before, endTurn());
      const lost = lostAlong(after, ground.geometry);
      const seatOrderKept =
        after.players.map(String).join(',') === before.players.map(String).join(',');
      const allCleared = after.players
        .filter((seat) => lost.includes(String(seat)))
        .every(
          (seat) =>
            landOf(after, seat).length === 0 &&
            headsOf(after, seat) === 0 &&
            !after.starvationStreaks.has(seat),
        );
      if (!seatOrderKept || !allCleared) unfinished.push(rows.join(''));
    }
    expect(unfinished).toEqual([]);
    // Non-vacuous: some assignment must actually lose more than one seat, or
    // "every seat, not just the earliest" is a claim about an empty set.
    const multi = ASSIGNMENTS.filter((rows) => {
      const after = ground.rules.apply(boardFor(ground, rows), endTurn());
      return lostAlong(after, ground.geometry).length > 1;
    });
    expect(multi.length).toBeGreaterThan(0);
  });

  it('13. produces equal losses from equal states', () => {
    const ground = aBoard();
    const disagreements: string[] = [];
    for (const rows of ASSIGNMENTS) {
      const before = boardFor(ground, rows);
      // Equal states, built with their maps filled in the opposite order.
      const twin: GameState = {
        ...before,
        groups: new Map([...before.groups].toReversed()),
        territory: new Map([...before.territory].toReversed()),
      };
      const left = ground.rules.apply(before, endTurn());
      const right = ground.rules.apply(twin, endTurn());
      if (JSON.stringify(snapshot(left)) !== JSON.stringify(snapshot(right))) {
        disagreements.push(rows.join(''));
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('14. loses the same seats on the same moves when the record is replayed', () => {
    const { ground, initial, moves } = aMatchLosingThree();

    const first = statesAlong(ground.rules, initial, moves);
    const second = statesAlong(ground.rules, initial, moves);

    expect(
      first.stops.map((stop) => ({ at: stop.at, lost: lostAlong(stop.state, ground.geometry) })),
    ).toEqual(
      second.stops.map((stop) => ({ at: stop.at, lost: lostAlong(stop.state, ground.geometry) })),
    );
    expect(replayIsDeterministic(ground.rules, initial, moves, snapshot)).toBe(true);
  });

  it('15. references neither a clock nor a random source in victory.ts', () => {
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
