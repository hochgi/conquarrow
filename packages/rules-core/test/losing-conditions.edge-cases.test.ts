/**
 * docs/spec/losing-conditions/losing-conditions.edge-cases.feature — one test per
 * scenario.
 *
 * Two scenarios in *Removal cleans up everything the seat owned* rest on a
 * premise the decided table cannot reach, and both are marked where they appear:
 * a seat that owns a spawner-border arrow has `S > 0`, so it is never lost. They
 * are written against the closest constructible board and the theorem that makes
 * the stated premise unreachable is pinned as its own property in
 * `losing-conditions.invariants.test.ts`.
 *
 * @see docs/spec/losing-conditions/losing-conditions.md
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rational, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, PlayerId } from '@conquarrow/contracts';
import { isLost, shareCountOf } from '../src/victory';
import { replay, replayIsDeterministic } from '../src/replay';
import {
  A,
  B,
  C,
  D,
  E,
  SIX,
  THREE,
  aBoard,
  aShareToCapture,
  aVertex,
  bareArrow,
  closeRound,
  closeRoundFrom,
  closeRounds,
  held,
  holdingsOf,
  isUnowned,
  livingSeats,
  lostSeats,
  phaseOf,
  readingsOf,
  roundMoves,
  seatState,
  shareArrow,
  streakOf,
} from './losing.support';
import type { Ground, SeatBoard } from './losing.support';
import { arrowAt, headsOn, onTiling, snapshot } from './support';

// ── Rule: The predicate is exactly the decided table ──────────────────────────

type Row = {
  readonly territory: 'none' | 'some';
  readonly shares: 'none' | 'one';
  readonly heads: 'none' | 'two';
  readonly outcome: 'lost' | 'not lost, on the clock' | 'not lost, clock at zero';
};

const ROWS: readonly Row[] = [
  { territory: 'none', shares: 'none', heads: 'none', outcome: 'lost' },
  { territory: 'none', shares: 'none', heads: 'two', outcome: 'lost' },
  { territory: 'some', shares: 'none', heads: 'none', outcome: 'lost' },
  { territory: 'some', shares: 'none', heads: 'two', outcome: 'not lost, on the clock' },
  { territory: 'some', shares: 'one', heads: 'none', outcome: 'not lost, clock at zero' },
  { territory: 'some', shares: 'one', heads: 'two', outcome: 'not lost, clock at zero' },
];

/**
 * One row of the table as a board: the subject seat with exactly those holdings,
 * and a filler seat that keeps a share so the match never runs out of players.
 */
const rowBoard = (ground: Ground, row: Row): GameState => {
  const subject = A;
  const filler = B;
  const land: { arrow: ArrowId; owner: PlayerId }[] = [
    { arrow: shareArrow(ground, 1), owner: filler },
  ];
  if (row.shares === 'one') land.push({ arrow: shareArrow(ground, 0), owner: subject });
  else if (row.territory === 'some') land.push({ arrow: bareArrow(ground, 0), owner: subject });
  const groups: SeatBoard['groups'] = [
    { arrow: shareArrow(ground, 1), owner: filler, heads: 1 },
    ...(row.heads === 'two'
      ? [{ arrow: bareArrow(ground, 1), owner: subject, heads: 2 }]
      : []),
  ];
  return seatState({
    players: [subject, filler],
    groups,
    territory: land,
    spawners: [[aVertex(ground), { force: rational(1, 12), phase: 2 }]],
    dominationN: 5,
  });
};

describe('the predicate is exactly the decided table', () => {
  for (const row of ROWS) {
    it(`reads ${row.territory} territory, ${row.shares} shares, ${row.heads} heads as "${row.outcome}"`, () => {
      const ground = aBoard();
      const before = rowBoard(ground, row);

      const after = closeRound(ground.rules, before);

      if (row.outcome === 'lost') {
        expect(isLost(after, A, ground.geometry)).toBe(true);
        return;
      }
      expect(isLost(after, A, ground.geometry)).toBe(false);
      expect(streakOf(after, A)).toBe(row.outcome === 'not lost, on the clock' ? 1 : 0);
    });
  }

  it('never lets a player own a share without owning territory', () => {
    // Structural, not incidental: a share *is* territory on a spawner-border
    // arrow (§9), so `S > 0 => T > 0` and the table has no missing case.
    const ground = aBoard();
    const boards = ROWS.map((row) => rowBoard(ground, row));
    boards.push(
      seatState({
        players: THREE,
        // A blockade parks an enemy head on the share without taking it.
        groups: [{ arrow: shareArrow(ground, 0), owner: B, heads: 1 }],
        territory: [{ arrow: shareArrow(ground, 0), owner: A }],
        spawners: [[aVertex(ground), { force: rational(1, 3), phase: 0 }]],
      }),
    );
    for (const board of boards) {
      for (const player of board.players) {
        const readings = readingsOf(board, player, ground.geometry);
        if (readings.shares > 0) expect(readings.territory).toBeGreaterThan(0);
      }
    }
  });

  it('reads S as arrows owned, not as vertex visits', () => {
    // `shareCountOf` is exported as a *count*, and two spawner vertices can flank
    // the same arrow — so walking spawners and then borders reaches that arrow
    // twice and a running total would report two shares for one piece of
    // territory. No rule here would notice: every reading of *S* asks only
    // whether it is zero. That is exactly why the count needs its own test.
    const ground = aBoard();
    const found = [...ground.shares, ...ground.bare]
      .map((arrow) => ({
        arrow,
        vertices: ground.geometry
          .flankVertices(arrow)
          .filter((vertex) => ground.geometry.borderArrows(vertex).includes(arrow)),
      }))
      .find((candidate) => candidate.vertices.length >= 2);
    if (found === undefined) throw new Error('setup: no arrow flanks two vertices');
    const state = seatState({
      players: [A, B],
      territory: [{ arrow: found.arrow, owner: A }],
      spawners: found.vertices
        .slice(0, 2)
        .map((vertex) => [vertex, { force: rational(1, 9), phase: 0 }] as const),
    });

    expect(state.spawners.size).toBe(2);
    expect(readingsOf(state, A, ground.geometry)).toEqual({ territory: 1, shares: 1, heads: 0 });
  });

  it('counts territory away from every spawner as territory', () => {
    const ground = aBoard();
    const away = bareArrow(ground, 0);
    for (const vertex of ground.vertices) {
      expect(ground.geometry.borderArrows(vertex)).not.toContain(away);
    }
    const before = seatState({
      players: THREE,
      groups: [
        { arrow: away, owner: A, heads: 2 },
        { arrow: shareArrow(ground, 0), owner: B, heads: 1 },
        { arrow: shareArrow(ground, 1), owner: C, heads: 1 },
      ],
      territory: [
        ...held([away], A),
        { arrow: shareArrow(ground, 0), owner: B },
        { arrow: shareArrow(ground, 1), owner: C },
      ],
      spawners: [[aVertex(ground), { force: rational(1, 12), phase: 2 }]],
    });

    const after = closeRound(ground.rules, before);

    expect(isLost(after, A, ground.geometry)).toBe(false);
    expect(streakOf(after, A)).toBe(1);
  });
});

// ── Rule: Loss is idempotent and stable ──────────────────────────────────────

/**
 * A three-seat board where A is about to be lost — heads, a trail and a stale
 * clock, but no territory — and B and C each keep a share.
 *
 * A is given something to lose on purpose: a board where A already holds nothing
 * would let *"nothing further is removed"* pass without any removal ever
 * happening.
 */
const aLostSeatBoard = (ground: Ground, extra: SeatBoard = {}): GameState =>
  seatState({
    players: THREE,
    groups: [
      { arrow: bareArrow(ground, 0), owner: A, heads: 2 },
      { arrow: shareArrow(ground, 0), owner: B, heads: 1 },
      { arrow: shareArrow(ground, 1), owner: C, heads: 1 },
    ],
    trails: [[A, [bareArrow(ground, 0), bareArrow(ground, 1)]]],
    territory: [
      { arrow: shareArrow(ground, 0), owner: B },
      { arrow: shareArrow(ground, 1), owner: C },
    ],
    starvationStreaks: [[A, 2]],
    ...extra,
  });

describe('loss is idempotent and stable', () => {
  it('keeps a lost seat lost and removes nothing further', () => {
    const ground = aBoard();
    const before = aLostSeatBoard(ground);

    const once = closeRound(ground.rules, before);
    const later = closeRounds(ground.rules, once, 10);

    expect(isLost(later, A, ground.geometry)).toBe(true);
    expect(holdingsOf(later, A)).toEqual(holdingsOf(once, A));
  });

  it('does not record a lost seat twice', () => {
    const ground = aBoard();
    // No spawners, so accrual cannot move a piece and any change is a re-removal.
    const before = closeRound(ground.rules, aLostSeatBoard(ground));
    // A is already gone by here — that is what "Given A is lost" means.
    expect(holdingsOf(before, A)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });

    const after = closeRound(ground.rules, before);

    expect(snapshot(after).groups).toEqual(snapshot(before).groups);
    expect(snapshot(after).trails).toEqual(snapshot(before).trails);
    expect(snapshot(after).territory).toEqual(snapshot(before).territory);
  });

  it('does not advance a lost seat starvation streak', () => {
    const ground = aBoard();
    const before = aLostSeatBoard(ground);

    const after = closeRounds(ground.rules, before, 3);

    expect(after.starvationStreaks.has(A)).toBe(false);
  });
});

// ── Rule: Removal cleans up everything the seat owned ────────────────────────

describe('removal cleans up everything the seat owned', () => {
  it('removes trail marks, including one an enemy trail also holds', () => {
    const ground = aBoard();
    const shared = bareArrow(ground, 0);
    const before = seatState({
      players: THREE,
      groups: [
        { arrow: shareArrow(ground, 0), owner: B, heads: 1 },
        { arrow: shareArrow(ground, 1), owner: C, heads: 1 },
        { arrow: bareArrow(ground, 1), owner: A, heads: 1 },
      ],
      trails: [
        [A, [shared, bareArrow(ground, 1)]],
        [B, [shared, shareArrow(ground, 0)]],
      ],
      territory: [
        { arrow: shareArrow(ground, 0), owner: B },
        { arrow: shareArrow(ground, 1), owner: C },
      ],
    });

    const after = closeRound(ground.rules, before);

    expect(after.trails.get(A)?.has(shared) ?? false).toBe(false);
    expect(after.trails.get(B)?.has(shared)).toBe(true);
  });

  it('removes a stack sitting under an enemy trail mark', () => {
    const ground = aBoard();
    const under = bareArrow(ground, 0);
    const before = seatState({
      players: THREE,
      groups: [
        { arrow: under, owner: A, heads: 2 },
        { arrow: shareArrow(ground, 0), owner: B, heads: 1 },
        { arrow: shareArrow(ground, 1), owner: C, heads: 1 },
      ],
      trails: [[B, [under, shareArrow(ground, 0)]]],
      territory: [
        { arrow: shareArrow(ground, 0), owner: B },
        { arrow: shareArrow(ground, 1), owner: C },
      ],
    });

    const after = closeRound(ground.rules, before);

    expect(headsOn(after, under)).toBe(0);
    expect(after.trails.get(B)?.has(under)).toBe(true);
  });

  it('resets rather than carries an accumulator on vacated territory', () => {
    // Share-free territory, per the share theorem: a lost seat never owned a
    // share. A part-filled accumulator is still reachable there, because an
    // accumulator outlives the capture that zeroed the arrow's ownership.
    const ground = aBoard();
    const vacated = bareArrow(ground, 0);
    const before = seatState({
      players: THREE,
      groups: [
        { arrow: shareArrow(ground, 0), owner: B, heads: 1 },
        { arrow: shareArrow(ground, 1), owner: C, heads: 1 },
      ],
      territory: [
        ...held([vacated], A),
        { arrow: shareArrow(ground, 0), owner: B },
        { arrow: shareArrow(ground, 1), owner: C },
      ],
      accumulators: [[vacated, rational(5, 6)]],
      spawners: [[aVertex(ground), { force: rational(1, 12), phase: 2 }]],
    });

    const after = closeRound(ground.rules, before);

    expect(isUnowned(after, vacated)).toBe(true);
    expect(after.accumulators.has(vacated)).toBe(false);
  });

  it('advances a spawner round-robin phase without reference to who owns its shares', () => {
    // Every border arrow unowned — the board the share theorem leaves for this
    // question. The cursor must move on regardless.
    const ground = aBoard();
    const vertex = aVertex(ground);
    // A head each, so no seat is on a losing row and the round can close: since
    // P38 a match decided halfway through a round refuses the rest of it, and the
    // cursor would never move at all.
    const before = seatState({
      players: THREE,
      groups: [
        { arrow: bareArrow(ground, 0), owner: A, heads: 1 },
        { arrow: bareArrow(ground, 1), owner: B, heads: 1 },
        { arrow: bareArrow(ground, 2), owner: C, heads: 1 },
      ],
      territory: [
        ...held([bareArrow(ground, 0)], A),
        ...held([bareArrow(ground, 1)], B),
        ...held([bareArrow(ground, 2)], C),
      ],
      spawners: [[vertex, { force: rational(1, 3), phase: 0 }]],
    });
    expect(before.winner).toBeUndefined();
    expect(phaseOf(before, vertex)).toBe(0);
    for (const share of ground.shares) expect(before.territory.has(share)).toBe(false);

    const after = closeRound(ground.rules, before);

    expect(phaseOf(after, vertex)).toBe(1);
    for (const share of ground.shares) expect(after.accumulators.has(share)).toBe(false);
  });

  it('never lets a lost seat have owned spawner-border territory', () => {
    // The share theorem: `S > 0` puts a player in an alive row of every case, so
    // no seat that qualifies to be lost owns a share. Quantified over every
    // assignment of the table's rows in the invariants suite (invariant 22);
    // here it is asserted on the boards this file actually authors.
    const ground = aBoard();
    const wide = aBoard(2);
    const boards: readonly { state: GameState; ground: Ground }[] = [
      ...ROWS.map((row) => ({ state: rowBoard(ground, row), ground })),
      { state: aLostSeatBoard(ground), ground },
      { state: sixSeatBoard(wide, [C, E]), ground: wide },
    ];
    for (const { state, ground: on } of boards) {
      for (const seat of state.players) {
        if (!isLost(state, seat, on.geometry)) continue;
        expect(shareCountOf(state, seat, on.geometry)).toBe(0);
      }
    }
  });
});

// ── Rule: The boundary order cannot remove a seat that was about to be paid ───

describe('the boundary order cannot remove a seat that was about to be paid', () => {
  it('pays a headless share owner and keeps it in the match', () => {
    // Not a rescue from loss: A owns a share, so A was never a candidate.
    const ground = aBoard();
    const feed = shareArrow(ground, 0);
    const phase = ground.shares.indexOf(feed);
    const before = seatState({
      players: THREE,
      groups: [
        { arrow: shareArrow(ground, 1), owner: B, heads: 1 },
        { arrow: shareArrow(ground, 2), owner: C, heads: 1 },
      ],
      territory: [
        { arrow: feed, owner: A },
        { arrow: shareArrow(ground, 1), owner: B },
        { arrow: shareArrow(ground, 2), owner: C },
      ],
      accumulators: [[feed, rational(2, 3)]],
      spawners: [[aVertex(ground), { force: rational(1, 3), phase }]],
    });

    const after = closeRound(ground.rules, before);

    expect(headsOn(after, feed)).toBe(1);
    expect(isLost(after, A, ground.geometry)).toBe(false);
  });

  it('clears the clock when a share is captured on the last streak round', () => {
    // The capture is a **closure**, not accrual: accrual pays only share owners
    // and a destitute seat owns none. So this runs on the tiling, where a trail
    // can depart A's ground and land back on it, and the land bridge turns the
    // path — including a spawner-border arrow — into A's territory.
    const table = onTiling();
    const bridge = aShareToCapture(table.geometry);
    const last = arrowAt(bridge.run, bridge.run.length - 1);
    const before = seatState({
      players: [A, B],
      activePlayer: A,
      groups: [
        { arrow: last, owner: A, heads: 1 },
        { arrow: arrowAt(bridge.otherShares, 0), owner: B, heads: 1 },
      ],
      trails: [[A, bridge.run]],
      territory: [
        ...held([bridge.home, bridge.landing], A),
        { arrow: arrowAt(bridge.otherShares, 0), owner: B },
      ],
      spawners: [[bridge.vertex, { force: rational(1, 12), phase: 0 }]],
      starvationStreaks: [[A, 4]],
      dominationN: 5,
    });
    expect(shareCountOf(before, A, table.geometry)).toBe(0);

    const captured = table.rules.apply(before, step(last, bridge.landing, 1));
    expect(shareCountOf(captured, A, table.geometry)).toBeGreaterThan(0);

    const after = closeRoundFrom(table.rules, captured);

    expect(streakOf(after, A)).toBe(0);
    expect(isLost(after, A, table.geometry)).toBe(false);
  });

  it('loses a seat on the round its streak reaches the threshold', () => {
    // Tick before resolve, and the only ordering inside the boundary that is
    // observable: reverse the two and every starvation loss is a round late.
    const ground = aBoard();
    const before = seatState({
      players: THREE,
      groups: [
        { arrow: bareArrow(ground, 0), owner: A, heads: 1 },
        { arrow: shareArrow(ground, 0), owner: B, heads: 1 },
        { arrow: shareArrow(ground, 1), owner: C, heads: 1 },
      ],
      territory: [
        ...held([bareArrow(ground, 0)], A),
        { arrow: shareArrow(ground, 0), owner: B },
        { arrow: shareArrow(ground, 1), owner: C },
      ],
      spawners: [[aVertex(ground), { force: rational(1, 12), phase: 2 }]],
      dominationN: 3,
    });

    const afterTwo = closeRounds(ground.rules, before, 2);
    expect(streakOf(afterTwo, A)).toBe(2);
    expect(isLost(afterTwo, A, ground.geometry)).toBe(false);

    const afterThree = closeRound(ground.rules, afterTwo);

    expect(isLost(afterThree, A, ground.geometry)).toBe(true);
  });

  it('does not pay the owner of a blockaded share, and does not clock them either', () => {
    const ground = aBoard();
    const feed = shareArrow(ground, 0);
    const phase = ground.shares.indexOf(feed);
    // P37: the blockader has to be a *legal* seat, or it is removed on the first
    // move and un-blockades the share by vanishing. P89: it also needs a life line,
    // or it converts at the round boundary (§6.3) — B's land feeds the point B's
    // trail on `feed` leaves.
    const used = new Set([feed, shareArrow(ground, 1)].map(String));
    const bLand = ground.geometry
      .inArrows(ground.geometry.origin(feed))
      .find((a) => !used.has(String(a)));
    if (bLand === undefined) throw new Error('setup: no free feeder of the feed arrow');
    const before = seatState({
      players: THREE,
      groups: [
        { arrow: feed, owner: B, heads: 1 },
        { arrow: shareArrow(ground, 1), owner: C, heads: 1 },
      ],
      trails: [[B, [feed]]],
      territory: [
        { arrow: feed, owner: A },
        { arrow: bLand, owner: B },
        { arrow: shareArrow(ground, 1), owner: C },
      ],
      accumulators: [[feed, rational(1, 3)]],
      spawners: [[aVertex(ground), { force: rational(1, 3), phase }]],
    });

    const after = closeRound(ground.rules, before);

    expect(after.accumulators.get(feed)).toEqual(rational(1, 3));
    expect(holdingsOf(after, A).heads).toBe(0);
    expect(isLost(after, A, ground.geometry)).toBe(false);
    expect(streakOf(after, A)).toBe(0);
  });
});

// ── Rule: Nobody wins by position in the player list ─────────────────────────

/**
 * Six seats, each on its own share, except the seats named `broke`, which own
 * bare ground and carry a streak one below the threshold.
 */
const sixSeatBoard = (ground: Ground, broke: readonly PlayerId[]): GameState => {
  let slot = 0;
  let bare = 0;
  const groups: { arrow: ArrowId; owner: PlayerId; heads: number }[] = [];
  const territory: { arrow: ArrowId; owner: PlayerId }[] = [];
  for (const seat of SIX) {
    if (broke.includes(seat)) {
      const arrow = bareArrow(ground, bare);
      bare += 1;
      groups.push({ arrow, owner: seat, heads: 1 });
      territory.push({ arrow, owner: seat });
      continue;
    }
    const arrow = shareArrow(ground, slot);
    slot += 1;
    groups.push({ arrow, owner: seat, heads: 1 });
    territory.push({ arrow, owner: seat });
  }
  return seatState({
    players: SIX,
    groups,
    territory,
    spawners: ground.vertices.map(
      (vertex) => [vertex, { force: rational(1, 12), phase: 0 }] as const,
    ),
    starvationStreaks: broke.map((seat) => [seat, 4] as const),
    dominationN: 5,
  });
};

describe('nobody wins by position in the player list', () => {
  it('sets no winner in a six seat match with one starving seat', () => {
    const ground = aBoard(2);
    const before = sixSeatBoard(ground, [C]);

    const after = closeRound(ground.rules, before);

    expect(livingSeats(after, ground.geometry).length).toBe(5);
    expect(after.winner).toBeUndefined();
  });

  it('no longer takes the two-player shortcut', () => {
    const ground = aBoard(2);
    const before = sixSeatBoard(ground, [A]);

    const after = closeRound(ground.rules, before);

    // The repealed rule handed the match to the first surviving seat in array
    // order. Nobody wins here at all.
    expect(after.winner).toBeUndefined();
    expect(livingSeats(after, ground.geometry)[0]).toBe('B');
  });

  it('sets no winner when two of six go and four still contest', () => {
    const ground = aBoard(2);
    const before = sixSeatBoard(ground, [C, E]);

    const after = closeRound(ground.rules, before);

    expect(livingSeats(after, ground.geometry)).toEqual(['A', 'B', 'D', 'F']);
    expect(after.winner).toBeUndefined();
  });
});

// ── Rule: A match with no surviving seat is recorded, not invented ────────────

describe('a match with no surviving seat is recorded, not invented', () => {
  it('leaves no winner when every remaining seat is lost on one boundary', () => {
    // SPEC §11 item 44. This is *recorded as wrong*, not fixed: `winner` stays
    // unset and the state is terminal-but-unwon, which the web adapter reads as
    // still playing. Picking a representation is a game decision for the human,
    // so the assertion below pins what P36 does, not what it should do.
    const ground = aBoard();
    const before = seatState({
      players: [A, B],
      territory: [...held([bareArrow(ground, 0)], A), ...held([bareArrow(ground, 1)], B)],
      spawners: [[aVertex(ground), { force: rational(1, 12), phase: 0 }]],
    });

    const after = closeRound(ground.rules, before);

    expect(lostSeats(after, ground.geometry)).toEqual(['A', 'B']);
    expect(after.winner).toBeUndefined();
    expect(after.groups.size).toBe(0);
    expect(after.trails.size).toBe(0);
    expect(after.territory.size).toBe(0);
  });
});

// ── Rule: Headless seats cannot deadlock the round ───────────────────────────

describe('headless seats cannot deadlock the round', () => {
  const allHeadless = (ground: Ground): GameState =>
    seatState({
      players: THREE,
      territory: [
        { arrow: shareArrow(ground, 0), owner: A },
        { arrow: shareArrow(ground, 1), owner: B },
        { arrow: shareArrow(ground, 2), owner: C },
      ],
      accumulators: [[shareArrow(ground, 0), rational(2, 3)]],
      spawners: [[aVertex(ground), { force: rational(1, 3), phase: 0 }]],
    });

  it('still closes rounds when every remaining seat is headless', () => {
    const ground = aBoard();
    const before = allHeadless(ground);
    expect(before.groups.size).toBe(0);

    const after = closeRound(ground.rules, before);

    expect(phaseOf(after, aVertex(ground))).toBe(1);
    expect(headsOn(after, shareArrow(ground, 0))).toBe(1);
    expect(after.activePlayer).toBe(A);
    expect(ground.rules.legalMoves(after).some((move) => move.kind === 'step')).toBe(true);
  });

  it('still fires the boundary when the first seat is headless', () => {
    const ground = aBoard();
    const before = allHeadless(ground);

    const after = closeRounds(ground.rules, before, 3);

    expect(phaseOf(after, aVertex(ground))).toBe(0);
    expect(isLost(after, A, ground.geometry)).toBe(false);
  });

  it('accrues off territory, not off liveness', () => {
    const ground = aBoard();
    const feed = shareArrow(ground, 1);
    const phase = ground.shares.indexOf(feed);
    const before = seatState({
      players: THREE,
      territory: [
        { arrow: feed, owner: A },
        { arrow: shareArrow(ground, 2), owner: B },
      ],
      spawners: [[aVertex(ground), { force: rational(1, 3), phase }]],
    });
    expect(before.groups.size).toBe(0);

    const after = closeRound(ground.rules, before);

    expect(after.accumulators.get(feed)).toEqual(rational(1, 3));
  });
});

// ── Rule: Determinism ────────────────────────────────────────────────────────

describe('determinism', () => {
  /** Three seats qualifying to be lost, plus one that keeps a share. */
  const threeQualify = (order: 'forward' | 'reversed'): GameState => {
    const ground = aBoard();
    const holdings: readonly (readonly [PlayerId, ArrowId])[] = [
      [A, bareArrow(ground, 0)],
      [B, bareArrow(ground, 1)],
      [C, bareArrow(ground, 2)],
    ];
    const rows = order === 'forward' ? holdings : [...holdings].reverse();
    return seatState({
      players: [A, B, C, D],
      groups: [{ arrow: shareArrow(ground, 0), owner: D, heads: 1 }],
      territory: [
        ...rows.map(([owner, arrow]) => ({ arrow, owner })),
        { arrow: shareArrow(ground, 0), owner: D },
      ],
      spawners: [[aVertex(ground), { force: rational(1, 12), phase: 0 }]],
      starvationStreaks: rows.map(([owner]) => [owner, 0] as const),
    });
  };

  it('loses equal seats from equal states', () => {
    const ground = aBoard();
    const left = threeQualify('forward');
    const right = threeQualify('forward');

    const afterLeft = closeRound(ground.rules, left);
    const afterRight = closeRound(ground.rules, right);

    expect(lostSeats(afterLeft, ground.geometry)).toEqual(['A', 'B', 'C']);
    expect(snapshot(afterLeft)).toEqual(snapshot(afterRight));
  });

  it('checks the winner only after every seat is resolved', () => {
    // All three seats qualify on one boundary. A win check *inside* the per-seat
    // loop would crown C in the instant after A and B went and before C did —
    // which is the only place resolution order is observable at all.
    const ground = aBoard();
    const before = seatState({
      players: THREE,
      territory: [
        ...held([bareArrow(ground, 0)], A),
        ...held([bareArrow(ground, 1)], B),
        ...held([bareArrow(ground, 2)], C),
      ],
      spawners: [[aVertex(ground), { force: rational(1, 12), phase: 0 }]],
    });

    const after = closeRound(ground.rules, before);

    expect(lostSeats(after, ground.geometry)).toEqual(['A', 'B', 'C']);
    expect(after.winner).toBeUndefined();
    expect(after.winner).not.toBe(C);
    expect(after.winner).not.toBe(B);
  });

  it('ignores every map insertion order, and reports lost seats in player order', () => {
    const ground = aBoard();
    // Two states equal but for the order every map was built in: groups,
    // territory, trails, accumulators and the streaks themselves.
    //
    // D is here to make the comparison say something. With only the three
    // starving seats on the board every map is *empty* afterwards, and empty
    // maps compare equal whatever the engine did — and `snapshot` sorts, so it
    // could not see an order difference even if one survived. D holds the
    // spawner's three shares, is never destitute, and its rows are **interleaved**
    // between the varied ones, so the removals open gaps in different places in
    // the two boards. What is left is then compared as **raw key order**.
    const board = (order: readonly PlayerId[]): GameState => {
      const stand = new Map<string, ArrowId>([
        [String(A), bareArrow(ground, 0)],
        [String(B), bareArrow(ground, 1)],
        [String(C), bareArrow(ground, 2)],
      ]);
      const arrowFor = (seat: PlayerId): ArrowId => {
        const arrow = stand.get(String(seat));
        if (arrow === undefined) throw new Error('setup: no arrow for that seat');
        return arrow;
      };
      return seatState({
        players: [A, B, C, D],
        groups: [
          ...order.map((seat) => ({ arrow: arrowFor(seat), owner: seat, heads: 1 })),
          { arrow: shareArrow(ground, 0), owner: D, heads: 1 },
        ],
        trails: [
          ...order.map((seat) => [seat, [arrowFor(seat)]] as const),
          [D, [shareArrow(ground, 1)]] as const,
        ],
        territory: order.flatMap((seat, i) => [
          { arrow: arrowFor(seat), owner: seat },
          { arrow: shareArrow(ground, i), owner: D },
        ]),
        accumulators: order.flatMap((seat, i) => [
          [arrowFor(seat), rational(1, 6)] as const,
          [shareArrow(ground, i), rational(1, 6)] as const,
        ]),
        spawners: [[aVertex(ground), { force: rational(1, 12), phase: 0 }]],
        starvationStreaks: order.map((seat) => [seat, 2] as const),
        dominationN: 3,
      });
    };

    const forward = closeRound(ground.rules, board([A, B, C]));
    const reversed = closeRound(ground.rules, board([C, B, A]));

    const shares = [shareArrow(ground, 0), shareArrow(ground, 1), shareArrow(ground, 2)].map(
      String,
    );
    expect([...forward.territory.keys()].map(String)).toEqual(shares);
    expect([...forward.territory.keys()]).toEqual([...reversed.territory.keys()]);
    expect([...forward.accumulators.keys()]).toEqual([...reversed.accumulators.keys()]);
    expect(snapshot(forward)).toEqual(snapshot(reversed));
    expect(lostSeats(forward, ground.geometry)).toEqual(['A', 'B', 'C']);
    expect(lostSeats(reversed, ground.geometry)).toEqual(['A', 'B', 'C']);
    expect(forward.winner).toBe(D);
  });

  it('loses the same seats at the same boundaries on replay', () => {
    const ground = aBoard();
    const initial = seatState({
      players: [A, B, C, D],
      groups: [
        { arrow: bareArrow(ground, 0), owner: A, heads: 1 },
        { arrow: bareArrow(ground, 1), owner: B, heads: 1 },
        { arrow: shareArrow(ground, 0), owner: C, heads: 1 },
        { arrow: shareArrow(ground, 1), owner: D, heads: 1 },
      ],
      territory: [
        ...held([bareArrow(ground, 0)], A),
        ...held([bareArrow(ground, 1)], B),
        { arrow: shareArrow(ground, 0), owner: C },
        { arrow: shareArrow(ground, 1), owner: D },
      ],
      spawners: [[aVertex(ground), { force: rational(1, 12), phase: 0 }]],
      dominationN: 2,
    });
    const log = [...roundMoves(initial.players), ...roundMoves(initial.players)];

    const final = replay(ground.rules, initial, log);

    expect(lostSeats(final, ground.geometry)).toEqual(['A', 'B']);
    expect(
      replayIsDeterministic(ground.rules, initial, log, snapshot),
    ).toBe(true);
  });

  it('references neither a clock nor a random source', () => {
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
