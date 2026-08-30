/**
 * Replay fixtures for P37 — the reported playtest log, and a hand-authored match
 * that loses three seats.
 *
 * The log is the regression the packet was filed for: 1247 real moves over the
 * generated tiling, rebuilt from the `config` the log carries with `makeMatch`.
 * Replayed against `main` @ `253a359` it sets `winner = D` at move **1246**; the
 * deciding move — D's step that takes E's last territory — is **1242**. P37 moves
 * the win onto 1242. **P38** then refuses at **1243**, the `endTurn` right after.
 *
 * **P47 moved where the fold stops again.** Extra evaporation (sibling fork arms)
 * demotes an E trail on F land to stack-grade, so P28 refuses E's recorded step
 * `3,-4,0 → 4,-4,0` at {@link P47_FIRST_UNPLAYABLE} (233). The log is a **prefix
 * golden** of that length, not a full-match golden. P37's claim that the winner
 * is set on the move that takes the last territory lives on
 * `aMatchLosingThree` below; P38's "refuse the next move" lives on `aWonPosition`.
 *
 * Same as P38 slicing 1244 → 1243: the fixture is unchanged, the fold is shorter,
 * and that is a reading of the log rather than a workaround.
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
import {
  P47_FIRST_UNPLAYABLE,
  P47_PREFIX_FLOOR,
  aMatchLosingThree,
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
 * Safe *because* the core is pure: the same record over the same board is the
 * same trace. Under P47 the fold stops at {@link P47_FIRST_UNPLAYABLE}.
 */
const theReportedTrace = (): ReturnType<typeof statesAlong> => {
  const { initial, moves, rules } = theReportedMatch();
  TRACE ??= statesAlong(rules, initial, moves);
  return TRACE;
};

/**
 * Historical landmarks in the fixture — not the current fold (see P47).
 *
 * P51 re-recorded the log without its one `skip` (originally index 600), so both
 * sit one earlier than the 2026-08-20 record did. Kept in step with
 * `won-is-over.support.ts`, which owns the same two numbers.
 */
const DECIDING_MOVE = 1241;
const FIRST_MOVE_AFTER_THE_WIN = 1242;

describe('the reported playtest log is a P47 prefix golden', () => {
  it('stops the fold at the first unplayable recorded step', () => {
    // Extra evaporation demoted E's connecting chain; P28 then refuses the
    // recorded step onto F's land. Measured: statesAlong(...).refusedAt.
    const { moves } = theReportedMatch();
    const { stops, refusedAt } = theReportedTrace();
    const refused = moves[P47_FIRST_UNPLAYABLE];

    expect(refusedAt).toBe(P47_FIRST_UNPLAYABLE);
    expect(stops.length).toBe(P47_FIRST_UNPLAYABLE);
    expect(stops[stops.length - 1]?.at).toBe(P47_FIRST_UNPLAYABLE - 1);
    expect(refused?.kind).toBe('step');
    if (refused === undefined || refused.kind !== 'step') {
      throw new Error('setup: the refused move is not a step');
    }
    expect(String(refused.from)).toBe('tiling:a:3,-4,0');
    expect(String(refused.exit)).toBe('tiling:a:4,-4,0');
    expect(refused.count).toBe(1);
  });

  it('records D as the adapter’s winner without folding to the deciding move', () => {
    // Fixture metadata. P37's "crowns D on the deciding step" lives on
    // `aMatchLosingThree`.
    expect(theReportedMatch().winner).toBe('D');
  });

  it('never reaches the P37 deciding move or the P38 refusal', () => {
    const { stops, refusedAt } = theReportedTrace();

    expect(refusedAt).toBeLessThan(DECIDING_MOVE);
    expect(refusedAt).toBeLessThan(FIRST_MOVE_AFTER_THE_WIN);
    expect(stops.filter((stop) => stop.at >= DECIDING_MOVE)).toEqual([]);
  });

  it('keeps some seat owning a share, and some seat alive, in every prefix state', () => {
    const { initial, geometry } = theReportedMatch();
    const { stops } = theReportedTrace();

    expect(stops.length).toBeGreaterThan(P47_PREFIX_FLOOR);
    expect(someSeatOwnsAShare(initial, geometry)).toBe(true);
    expect(someSeatIsAlive(initial, geometry)).toBe(true);
    const shareless = stops.filter((stop) => !someSeatOwnsAShare(stop.state, geometry));
    const empty = stops.filter((stop) => !someSeatIsAlive(stop.state, geometry));
    expect(shareless.map((stop) => stop.at)).toEqual([]);
    expect(empty.map((stop) => stop.at)).toEqual([]);
  });

  it('replays the playable prefix to the same board twice', () => {
    const { initial, moves, rules } = theReportedMatch();
    const playable = moves.slice(0, P47_FIRST_UNPLAYABLE);

    expect(playable.length).toBe(P47_FIRST_UNPLAYABLE);
    expect(replayIsDeterministic(rules, initial, playable, snapshot)).toBe(true);
  });

  it('names the refused step when the whole record is folded', () => {
    const { initial, moves, rules } = theReportedMatch();
    const refused = moves[P47_FIRST_UNPLAYABLE];
    if (refused === undefined) throw new Error('setup: the record has no move 233');

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
});

// ── a hand-authored match that loses three seats ─────────────────────────────

describe('a four-seat match that loses three seats', () => {
  it('removes C on the very first move and A and B at the second boundary', () => {
    // P37's deciding-move claim that the 2026-08-20 log can no longer reach:
    // the winner is set on the move that takes the last territory, not four
    // moves later. Measured as the move each seat's *pieces* went, not as the
    // move `isLost` first held: the predicate is derived, so an authored board
    // can already read as lost before anything has resolved.
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

    // P51 re-recorded the hand-authored record without B's `skip` — B stands by
    // being named nowhere — so the second boundary is move 9, one earlier. Same
    // match, same removals, one fewer entry in the record.
    expect(removals).toEqual([
      { at: 0, gone: ['C'] },
      { at: 9, gone: ['A', 'B', 'C'] },
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
