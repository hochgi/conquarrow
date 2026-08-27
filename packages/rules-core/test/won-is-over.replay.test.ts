/**
 * The Rule *a record that runs past the win stops there* — replay of the
 * reported playtest log, plus the P38 gates that used to be asserted *on that
 * log* at 1242/1243.
 *
 * The log is 1247 real moves over the generated tiling. Measured against
 * `main` @ `fc5bc2e`: the deciding step is **1242**, and the four moves recorded
 * after it are an `endTurn` (1243), a step by a seat that no longer exists
 * (1244), and two more end-turns (1245, 1246). P37 stopped the fold at 1244;
 * **P38** stopped it at **1243**.
 *
 * **P47 moved where the fold stops again.** Extra evaporation demotes an E trail
 * on F land; P28 refuses E's recorded step `3,-4,0 → 4,-4,0` at
 * {@link P47_FIRST_UNPLAYABLE} (233). The log is a **prefix golden**. Invariant 5
 * (refuse the first move after a win) lives on `aWonPosition` /
 * `aMatchLosingThree`. Invariant 6 (this log refuses at 233 and names that step)
 * is this file. Same as P38 slicing 1244 → 1243: the fixture is unchanged, the
 * fold is shorter.
 *
 * @see docs/spec/won-is-over/won-is-over.md
 * @see .claude/skills/rules-invariants/SKILL.md
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, movesEqual } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { replay, replayIsDeterministic } from '../src/replay';
import { firstWinnerAt, statesAlong } from './immediate.support';
import { snapshot } from './support';
import {
  DECIDING_MOVE,
  FIRST_MOVE_AFTER_THE_WIN,
  FIRST_MOVE_BY_A_DEAD_SEAT,
  P47_FIRST_UNPLAYABLE,
  P47_PREFIX_FLOOR,
  slicedAt,
  theReportedLog,
} from './won-is-over.support';

/** How many moves the record carries after the deciding one (fixture, not fold). */
const MOVES_RECORDED_AFTER_THE_WIN = 4;

let TRACE: ReturnType<typeof statesAlong> | undefined;

/**
 * The one fold of the record, memoised.
 *
 * Safe *because* the core is pure: the same record over the same board is the same
 * trace. Under P47 the fold stops at {@link P47_FIRST_UNPLAYABLE}.
 */
const theTrace = (): ReturnType<typeof statesAlong> => {
  const { initial, moves, rules } = theReportedLog();
  TRACE ??= statesAlong(rules, initial, moves);
  return TRACE;
};

const moveAt = (moves: readonly Move[], at: number): Move => {
  const move = moves[at];
  if (move === undefined) throw new Error(`setup: the record has no move ${String(at)}`);
  return move;
};

// ── Rule: A record that runs past the win stops there ────────────────────────
// P38's *engine* claims (empty legalMoves, apply throws) are on `aWonPosition`.
// This file now pins how far the 2026-08-20 log still folds.

describe('the reported playtest log is a P47 prefix golden', () => {
  it('stops the fold at the first unplayable recorded step', () => {
    const { moves } = theReportedLog();
    const { stops, refusedAt } = theTrace();
    const refused = moveAt(moves, P47_FIRST_UNPLAYABLE);

    expect(refusedAt).toBe(P47_FIRST_UNPLAYABLE);
    expect(stops.length).toBeGreaterThan(P47_PREFIX_FLOOR);
    expect(stops.length).toBe(P47_FIRST_UNPLAYABLE);
    expect(stops[stops.length - 1]?.at).toBe(P47_FIRST_UNPLAYABLE - 1);
    expect(refused.kind).toBe('step');
    if (refused.kind !== 'step') throw new Error('setup: the refused move is not a step');
    expect(String(refused.from)).toBe('tiling:a:3,-4,0');
    expect(String(refused.exit)).toBe('tiling:a:4,-4,0');
    expect(refused.count).toBe(1);
    expect(firstWinnerAt(stops)).toBeUndefined();
  });

  it('names the refused move in the error the fold raises', () => {
    const { initial, moves, rules } = theReportedLog();
    const refused = moveAt(moves, P47_FIRST_UNPLAYABLE);

    let message: string | undefined;
    try {
      replay(rules, initial, moves);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      expect(error).toBeInstanceOf(ContractViolation);
    }

    expect(message).toBeDefined();
    expect(String(message)).toContain(JSON.stringify(refused));
  });

  it('folds the prefix cleanly and deterministically', () => {
    const { initial, moves, rules } = theReportedLog();
    const playable = slicedAt(moves, P47_FIRST_UNPLAYABLE);
    expect(playable.length).toBe(P47_FIRST_UNPLAYABLE);

    const final = replay(rules, initial, playable);

    expect(final.winner).toBeUndefined();
    expect(replayIsDeterministic(rules, initial, playable, snapshot)).toBe(true);
  });

  it('never reaches the P37 deciding move or the P38 refusal', () => {
    const { stops, refusedAt } = theTrace();

    expect(refusedAt).toBeLessThan(DECIDING_MOVE);
    expect(refusedAt).toBeLessThan(FIRST_MOVE_AFTER_THE_WIN);
    expect(stops.filter((stop) => stop.at >= DECIDING_MOVE)).toEqual([]);
  });

  it('still records the historical 1242/1243 tail in the fixture', () => {
    // A guard on the fixture, not on the engine. P38 filed over 1243 as endTurn.
    const { moves } = theReportedLog();

    expect({
      atTheWin: moveAt(moves, DECIDING_MOVE).kind,
      after: moveAt(moves, FIRST_MOVE_AFTER_THE_WIN).kind,
      deadSeat: moveAt(moves, FIRST_MOVE_BY_A_DEAD_SEAT).kind,
      tail: moves.slice(FIRST_MOVE_AFTER_THE_WIN).map((move) => move.kind),
      recorded: moves.length - (DECIDING_MOVE + 1),
      total: moves.length,
      sameMove: movesEqual(
        moveAt(moves, FIRST_MOVE_AFTER_THE_WIN),
        moveAt(moves, FIRST_MOVE_AFTER_THE_WIN),
      ),
    }).toEqual({
      atTheWin: 'step',
      after: 'endTurn',
      deadSeat: 'step',
      tail: ['endTurn', 'step', 'endTurn', 'endTurn'],
      recorded: MOVES_RECORDED_AFTER_THE_WIN,
      total: 1247,
      sameMove: true,
    });
  });
});
