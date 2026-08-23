/**
 * Replay fixtures for P37 — the reported playtest log, and a hand-authored match
 * that loses three seats.
 *
 * The first of these is the regression the packet was filed for and is worth
 * more than every hand-authored scenario in this packet put together: 1247 real
 * moves over the generated tiling, rebuilt from the `config` the log carries with
 * `makeMatch`, folded through the same pure `apply` the adapter used. Replayed
 * against `main` @ `253a359` it sets `winner = D` at move **1246**; the deciding
 * move — D's step that takes E's last territory — is **1242**. P37 moves the win
 * onto 1242, and the four moves the log recorded after it stop being playable.
 *
 * **P38 moved where the fold stops.** Under P37 alone it ran to 1244 and stopped
 * there because move 1244 is E stepping a head E no longer has — a *dead seat*
 * refusal. P38 refuses every move once `winner` is set, so the fold now stops at
 * **1243**, the `endTurn` immediately after the deciding step, and stops because
 * *the match was over*. Both readings are kept below: the index is the P38 one, and
 * the P37 claim it used to carry — that the dead seat's move at 1244 is never
 * played — survives as the stronger statement that the fold never reaches it at
 * all. The 1243 half of that pair is owned by `won-is-over.replay.test.ts`.
 *
 * The second pins invariant 8 as far as it can be pinned: at the end of a record
 * the lost set is the set the §9 table qualifies, and one further move leaves it
 * alone — which since P38 is the stronger statement that there is no further move,
 * because losing three of four seats wins the match for the fourth. It does **not**
 * show that resolving more often never changes the outcome — that needs the pre-P37
 * engine to compare against. See the note on that test.
 *
 * @see docs/spec/immediate-loss/immediate-loss.md
 * @see .claude/skills/rules-invariants/SKILL.md
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn } from '@conquarrow/contracts';
import type { GameState, Move } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '../src/index';
import { replay, replayIsDeterministic } from '../src/replay';
import { isLost, territoryCountOf } from '../src/victory';
import {
  aMatchLosingThree,
  firstWinnerAt,
  landOf,
  lostAlong,
  playtestLog,
  someSeatIsAlive,
  someSeatOwnsAShare,
  statesAlong,
} from './immediate.support';
import { A, B, C, D, holdingsOf } from './losing.support';
import { snapshot } from './support';

// ── the reported playtest log ────────────────────────────────────────────────

interface ReportedMatch {
  readonly initial: GameState;
  readonly moves: readonly Move[];
  readonly rules: ReturnType<typeof makeRules>;
  readonly geometry: ReturnType<typeof makeTiling>;
  readonly winner: string;
}

let REPORTED: ReportedMatch | undefined;

/** The log, the board it was played on, and the rules over that board. */
const theReportedMatch = (): ReportedMatch => {
  REPORTED ??= ((): ReportedMatch => {
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

let TRACE: ReturnType<typeof statesAlong> | undefined;

/**
 * The one fold of the 1247-move record, memoised.
 *
 * Four scenarios read different things off the same trace and folding it once
 * per test costs about a second and a half each. Memoising is safe *because* the
 * core is pure: the same record over the same board is the same trace, which is
 * the property the rest of this file is here to assert.
 */
const theReportedTrace = (): ReturnType<typeof statesAlong> => {
  const { initial, moves, rules } = theReportedMatch();
  TRACE ??= statesAlong(rules, initial, moves);
  return TRACE;
};

/** Zero-based indices measured against `main` @ `253a359`. */
const DECIDING_MOVE = 1242;
const OLD_WINNING_MOVE = 1246;
/**
 * Where the fold stops since P38: the `endTurn` right after the deciding step.
 *
 * Named for *why* it stops. Calling it a dead-seat move would be a lie about the
 * refusal — 1243 is played by D, the seat that had just won, and it is refused
 * because the match is over rather than because the mover is gone.
 */
const FIRST_MOVE_AFTER_THE_WIN = 1243;
/** The move E makes with a head E no longer has — the P37 landmark, never reached. */
const FIRST_MOVE_BY_A_DEAD_SEAT = 1244;

describe('the reported playtest log ends on the deciding move', () => {
  it('sets the winner on the step that takes E’s last territory, not four moves later', () => {
    const { stops } = theReportedTrace();

    expect(firstWinnerAt(stops)).toBe(DECIDING_MOVE);
    expect(firstWinnerAt(stops)).not.toBe(OLD_WINNING_MOVE);
  });

  it('crowns D, the seat the log itself recorded', () => {
    const { winner } = theReportedMatch();

    const { stops } = theReportedTrace();
    const deciding = stops.find((stop) => stop.at === DECIDING_MOVE);

    if (deciding === undefined) throw new Error('setup: the log is shorter than the deciding move');
    expect(deciding.state.winner === undefined ? undefined : String(deciding.state.winner)).toBe(
      winner,
    );
    expect(deciding.move.kind).toBe('step');
  });

  it('takes E’s last territory on that move and leaves E nothing', () => {
    const { geometry } = theReportedMatch();

    const { stops } = theReportedTrace();
    const deciding = stops.find((stop) => stop.at === DECIDING_MOVE);
    const before = stops.find((stop) => stop.at === DECIDING_MOVE - 1);

    if (deciding === undefined || before === undefined) {
      throw new Error('setup: the log is shorter than the deciding move');
    }
    const e = before.state.players[4];
    if (e === undefined) throw new Error('setup: that log has fewer than five seats');
    expect(String(e)).toBe('E');
    expect(territoryCountOf(before.state, e)).toBeGreaterThan(0);
    expect(territoryCountOf(deciding.state, e)).toBe(0);
    expect(isLost(deciding.state, e, geometry)).toBe(true);
    expect(landOf(deciding.state, e)).toEqual([]);
  });

  it('never reaches the turn the seat the deciding move removed would have taken', () => {
    // The log was recorded under the old timing, so it contains E's turn after E was
    // already decided against. P37's claim is that the move is not on offer — *no
    // seat takes a turn after the move that lost it* — and it still holds, in the
    // stronger form that the fold never gets as far as 1244: since P38 the record is
    // refused at 1243, the `endTurn` right after the deciding step, so E's move is
    // unreachable rather than merely unoffered.
    const { stops, refusedAt } = theReportedTrace();

    expect(refusedAt).toBe(FIRST_MOVE_AFTER_THE_WIN);
    expect(refusedAt).toBeLessThan(FIRST_MOVE_BY_A_DEAD_SEAT);
    expect(stops.filter((stop) => stop.at >= FIRST_MOVE_BY_A_DEAD_SEAT)).toEqual([]);
  });

  it('keeps some seat owning a share, and some seat alive, in every state along the way', () => {
    const { initial, geometry } = theReportedMatch();

    const { stops } = theReportedTrace();

    expect(someSeatOwnsAShare(initial, geometry)).toBe(true);
    expect(someSeatIsAlive(initial, geometry)).toBe(true);
    const shareless = stops.filter((stop) => !someSeatOwnsAShare(stop.state, geometry));
    const empty = stops.filter((stop) => !someSeatIsAlive(stop.state, geometry));
    expect(shareless.map((stop) => stop.at)).toEqual([]);
    expect(empty.map((stop) => stop.at)).toEqual([]);
  });

  it('replays to the same board twice', () => {
    const { initial, moves, rules } = theReportedMatch();
    const playable = moves.slice(0, FIRST_MOVE_AFTER_THE_WIN);

    expect(replayIsDeterministic(rules, initial, playable, snapshot)).toBe(true);
  });
});

// ── a hand-authored match that loses three seats ─────────────────────────────

describe('a four-seat match that loses three seats', () => {
  it('removes C on the very first move and A and B at the second boundary', () => {
    // Measured as the move each seat's *pieces* went, not as the move `isLost`
    // first held: the predicate is derived, so an authored board can already read
    // as lost before anything has resolved. What P37 changes is when the removal
    // happens, and the removal is what is watched here.
    const { ground, initial, moves } = aMatchLosingThree();

    const { stops } = statesAlong(ground.rules, initial, moves);
    const gone = (state: GameState): readonly string[] =>
      state.players
        .filter((seat) => holdingsOf(state, seat).land.length === 0)
        .filter((seat) => holdingsOf(initial, seat).land.length > 0)
        .map(String);

    const removals: { at: number; gone: readonly string[] }[] = [];
    let previous = gone(initial);
    for (const stop of stops) {
      const now = gone(stop.state);
      if (now.length > previous.length) removals.push({ at: stop.at, gone: now });
      previous = now;
    }

    expect(removals).toEqual([
      { at: 0, gone: ['C'] },
      { at: 10, gone: ['A', 'B', 'C'] },
    ]);
  });

  it('leaves D the winner and nothing of the other three', () => {
    const { ground, initial, moves } = aMatchLosingThree();

    const final = replay(ground.rules, initial, moves);

    for (const gone of [A, B, C]) {
      expect(holdingsOf(final, gone)).toEqual({ heads: 0, stacks: [], trail: [], land: [] });
    }
    expect(final.winner).toBe(D);
  });

  it('loses exactly the seats the table qualifies, and one further move changes nothing', () => {
    // Invariant 8, in the form it now has: *at the end of a record the set of lost
    // players shall be exactly those the §9 table qualifies, and one further move
    // shall not change it.*
    //
    // **Not** the stronger claim it used to carry. Nothing here keeps a copy of the
    // pre-P37 engine, so nothing here can compare boundary-only resolution against
    // per-move resolution, and the name no longer suggests otherwise. That the two
    // agree follows from removal giving nobody anything — an argument, made in the
    // spec, and left as one. What is checked is the observable consequence: the
    // settled set is the qualified set, and a further chance to resolve moves it
    // nowhere.
    //
    // **Since P38 there is no further move to take.** Losing three of four seats
    // wins the match for the fourth, and a won match refuses everything — so
    // "one more resolution changes nothing" holds in the stronger form that no
    // further resolution can be asked for at all. Asserted that way rather than
    // dropped: the claim is still about what the settled set does next.
    const { ground, initial, moves } = aMatchLosingThree();

    const final = replay(ground.rules, initial, moves);

    expect(lostAlong(final, ground.geometry)).toEqual(['A', 'B', 'C']);
    expect(String(final.winner)).toBe(String(D));
    expect(() => ground.rules.apply(final, endTurn())).toThrow(ContractViolation);
    expect(ground.rules.legalMoves(final)).toEqual([]);
  });

  it('reproduces an identical final state', () => {
    const { ground, initial, moves } = aMatchLosingThree();

    expect(replayIsDeterministic(ground.rules, initial, moves, snapshot)).toBe(true);
  });

  it('never rewrites the player list, at any point in the record', () => {
    const { ground, initial, moves } = aMatchLosingThree();
    const original = [...initial.players].map(String);

    const { stops } = statesAlong(ground.rules, initial, moves);

    for (const stop of stops) {
      expect([...stop.state.players].map(String)).toEqual(original);
    }
  });

  it('keeps some seat owning a share and some seat alive in every state', () => {
    const { ground, initial, moves } = aMatchLosingThree();

    const { stops } = statesAlong(ground.rules, initial, moves);

    for (const stop of [{ at: -1, state: initial }, ...stops]) {
      expect(someSeatOwnsAShare(stop.state, ground.geometry)).toBe(true);
      expect(someSeatIsAlive(stop.state, ground.geometry)).toBe(true);
    }
  });
});
