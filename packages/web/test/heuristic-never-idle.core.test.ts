/**
 * Core scenarios for docs/spec/heuristic-never-idle/heuristic-never-idle.core.feature
 * (P84 — the heuristic seat never passes while a step is legal).
 *
 * Real positions come from the committed playtest log, replayed from
 * `makeMatch`; every premise is checked in setup before the seat is asked.
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import { hypothesiseChair } from '../src/botReply';
import { chooseTurnBeam, evaluate, IDLE_SLACK } from '../src/botSearch';
import { chooseMove, playBotTurn } from '../src/opponent';
import {
  boxedAfterOccupy,
  geometry,
  guardChangedSteppedTurns,
  hasStep,
  legalSteps,
  passIsBestPosition,
  passTurnAt,
  planIsLegalSequence,
  planTerminates,
  PLAYTEST_PASS_TURNS,
  playtest,
  rules,
  stepIsLegal,
} from './heuristic-never-idle.support';

/** The r35 beam takes ~6–8 s; the rest ~1–3 s. */
const SEARCH_TIMEOUT = 120_000;
/** Rounds 1–20 of seats A and B: ~40 beam turns. */
const REPLAY_TIMEOUT = 600_000;

describe('heuristic-never-idle core', () => {
  describe('Rule: The playtest positions where the seat passed now take a step', () => {
    it.each(PLAYTEST_PASS_TURNS)(
      'Seat $seat steps at the start of its round-$round turn (move $index)',
      ({ round, seat, index }) => {
        const { state, me } = passTurnAt(playtest(), index, seat, round);

        const turn = playBotTurn(geometry, rules, state, me);

        expect(hasStep(turn.moves)).toBe(true);
        expect(planIsLegalSequence(state, turn.moves)).toBe(true);
        expect(planTerminates(state, turn.moves)).toBe(true);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: Stepping worse than passing still steps', () => {
    it(
      'A lone home 1-stack whose every one-step terminal evaluates worse than passing takes a step',
      () => {
        // passIsBestPosition throws `setup:` unless every one-step terminal is strictly worse.
        const { state, Bot } = passIsBestPosition();
        expect(state.players).toHaveLength(3);
        const own = [...state.groups.values()].filter((g) => g.owner === Bot);
        expect(own).toEqual([{ owner: Bot, heads: 1, spent: 0 }]);
        const passEv = evaluate(geometry, rules.apply(state, endTurn()), Bot, rules);
        const bestStep = Math.max(
          ...legalSteps(state).map((m) => evaluate(geometry, rules.apply(state, m), Bot, rules)),
        );
        expect(passEv - bestStep).toBeGreaterThan(IDLE_SLACK);

        const plan = chooseTurnBeam(geometry, rules, state, Bot);

        expect(hasStep(plan)).toBe(true);
        expect(planIsLegalSequence(state, plan)).toBe(true);
        expect(planTerminates(state, plan)).toBe(true);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: A seat with no legal step still passes', () => {
    it(
      'No legal step returns only endTurn',
      () => {
        const { state, E } = boxedAfterOccupy();
        const chair = hypothesiseChair(state, E);
        expect(chair.activePlayer).toBe(E);
        expect(stepIsLegal(chair)).toBe(false);

        const plan = chooseTurnBeam(geometry, rules, chair, E);

        expect(plan).toEqual([{ kind: 'endTurn' }]);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: A plan that already steps is untouched', () => {
    // Rewritten for P85 (docs/spec/heuristic-tempo-horizon, decision 12): the
    // live seat's plans now differ from the pre-P85 log by design. P84's
    // property is that the guard returns a stepping plan unchanged, so it is
    // read off neverIdle itself at every stepped playtest turn of rounds 1–20.
    it(
      'Turns that stepped in the playtest are returned move for move by the guard',
      () => {
        const { checked, changed } = guardChangedSteppedTurns(playtest(), ['A', 'B'], 1, 20);
        expect(checked).toBeGreaterThan(10);
        expect(changed).toEqual([]);
      },
      REPLAY_TIMEOUT,
    );
  });

  describe('Rule: chooseMove keeps its own rule', () => {
    it('chooseMove still never passes while a step exists', () => {
      const { state, Bot } = passIsBestPosition();
      expect(legalSteps(state).length).toBeGreaterThan(0);

      expect(chooseMove(geometry, rules, state, Bot).kind).toBe('step');
    });
  });
});
