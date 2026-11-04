/**
 * Core scenarios for docs/spec/heuristic-tempo-horizon/heuristic-tempo-horizon.core.feature
 * (P85 — the heuristic seat counts the race).
 *
 * Fixture positions are replayed from `makeMatch` through the committed logs.
 * Every premise a scenario states is checked against the spec oracle in
 * `tempo-race.support.ts` and throws `setup:` when it fails. The two fixture
 * rules are set-level gates (spec "Acceptance"): one test per set computes
 * each row's pass/fail, names the failing ids, and asserts the floor.
 */

import { describe, expect, it } from 'vitest';
import { sortieCredit } from '../src/botTempo';
import { chooseTurnBeam } from '../src/botSearch';
import { playBotTurn } from '../src/opponent';
import {
  enemyAtTurns,
  geometry,
  hasStep,
  INTERCEPT_FIXTURES,
  INTERCEPT_FLOOR,
  interceptPasses,
  interceptPosition,
  openTrailBoard,
  passTurnAt,
  planIsLegalSequence,
  planTerminates,
  PLAYTEST_PASS_TURNS,
  playtest,
  positionAt,
  reachableThisTurn,
  reachesForLargerClose,
  rules,
  SORTIE_FIXTURES,
  SORTIE_FLOOR,
  sortiePosition,
  specSafeWindow,
  specSortie,
  terminalOf,
  trailSize,
} from './heuristic-tempo-horizon.support';

/** Six playBotTurn calls on mid-game boards. */
const INTERCEPT_TIMEOUT = 600_000;
/** 37 chooseTurnBeam calls: ~1–2 min. */
const SORTIE_TIMEOUT = 900_000;
const SEARCH_TIMEOUT = 120_000;

describe('heuristic-tempo-horizon core', () => {
  describe('Rule: A won intercept race makes the seat march, even with no cut legal', () => {
    it(
      'The six intercept fixtures pass as a set at the predeclared floor',
      () => {
        const failing: string[] = [];
        const illegal: string[] = [];
        for (const fixture of INTERCEPT_FIXTURES) {
          // interceptPosition throws `setup:` unless it is <seat>'s turn, no
          // step cuts <enemy>'s trail, and the race reads <mine>/<theirs>.
          const pos = interceptPosition(fixture);

          const turn = playBotTurn(geometry, rules, pos.state, pos.me);

          if (!planIsLegalSequence(pos.state, turn.moves) || !planTerminates(pos.state, turn.moves)) {
            illegal.push(fixture.id);
          }
          if (!interceptPasses(pos, turn.state)) failing.push(fixture.id);
        }

        expect(illegal).toEqual([]);
        const passed = INTERCEPT_FIXTURES.length - failing.length;
        expect(passed, `intercept fixtures failing: ${failing.join(', ')}`).toBeGreaterThanOrEqual(
          INTERCEPT_FLOOR,
        );
      },
      INTERCEPT_TIMEOUT,
    );
  });

  describe('Rule: A wide safe window lets the seat reach for a larger close', () => {
    it(
      'The 37 sortie fixtures pass as a set at the predeclared floor',
      () => {
        const failing: string[] = [];
        const illegal: string[] = [];
        for (const fixture of SORTIE_FIXTURES) {
          const pos = sortiePosition(fixture);

          const plan = chooseTurnBeam(geometry, rules, pos.state, pos.me);

          if (!planIsLegalSequence(pos.state, plan) || !planTerminates(pos.state, plan)) {
            illegal.push(fixture.id);
            continue;
          }
          if (!reachesForLargerClose(pos, terminalOf(pos.state, plan))) failing.push(fixture.id);
        }

        expect(illegal).toEqual([]);
        const passed = SORTIE_FIXTURES.length - failing.length;
        expect(passed, `sortie fixtures failing: ${failing.join(', ')}`).toBeGreaterThanOrEqual(SORTIE_FLOOR);
      },
      SORTIE_TIMEOUT,
    );

    it(
      'The opening position starts a close larger than a land bridge',
      () => {
        const { state, me } = positionAt('opening', 'playtest-2026-11-03', 0, 'A');
        // Premise: no enemy group can reach, within 4 of its own turns, any
        // arrow seat A's groups can step onto this turn (W over them > 4).
        expect(specSafeWindow(state, me, reachableThisTurn(state, me), 4)).toBe(5);

        const plan = chooseTurnBeam(geometry, rules, state, me);
        const terminal = terminalOf(state, plan);

        expect(trailSize(terminal, me)).toBeGreaterThan(0);
        expect(specSortie(terminal, me)?.arrows ?? 0).toBeGreaterThan(3);
        expect(sortieCredit(geometry, terminal, me)).toBeGreaterThan(0);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: A real threat still keeps the sortie short', () => {
    it('A terminal whose window is no wider than its turns to land earns no credit', () => {
      // An open trail of 2 whose 1-stack tip is 2 steps from home: L = 2.
      const board = openTrailBoard(2, 2, 1);
      const sortie = specSortie(board.state, board.me);
      if (sortie === undefined) throw new Error('setup: no open trail');
      const L = sortie.turnsToLand;
      expect(L).toBe(2);
      // An enemy 1-stack 2 passable steps from the projected sortie: W = 2 ≤ L.
      const state = enemyAtTurns(board, sortie.projected, 2);
      expect(specSafeWindow(state, board.me, sortie.projected, L)).toBeLessThanOrEqual(L);

      expect(sortieCredit(geometry, state, board.me)).toBe(0);
    });
  });

  describe('Rule: The seat never passes while a step is legal (P84 stands)', () => {
    it(
      "P84's playtest positions still take a step",
      () => {
        const idle: string[] = [];
        for (const { round, seat, index } of PLAYTEST_PASS_TURNS) {
          const { state, me } = passTurnAt(playtest(), index, seat, round);

          const turn = playBotTurn(geometry, rules, state, me);

          if (!hasStep(turn.moves)) idle.push(`${seat} r${String(round)} @${String(index)}`);
        }
        expect(idle).toEqual([]);
      },
      INTERCEPT_TIMEOUT,
    );
  });

  describe('Rule: Determinism', () => {
    it(
      'The same position twice gives the same plan',
      () => {
        const sample = [
          ...INTERCEPT_FIXTURES.map((f) => interceptPosition(f)),
          ...SORTIE_FIXTURES.filter((_, i) => i % 6 === 0).map((f) => sortiePosition(f)),
        ];
        for (const { id, state, me } of sample) {
          const first = chooseTurnBeam(geometry, rules, state, me);
          const second = chooseTurnBeam(geometry, rules, state, me);
          expect(second, id).toEqual(first);
        }
      },
      SORTIE_TIMEOUT,
    );
  });
});
