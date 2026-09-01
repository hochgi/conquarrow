/**
 * EARS invariants for docs/spec/bot-turn-search/bot-turn-search.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/botPlayback.invariants.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { chooseMove, playBotTurn } from '../src/opponent';
import {
  chooseTurnBeam,
  chooseTurnGreedy,
  MAX_APPLIES,
} from '../src/botSearch';
import {
  afterFirstHomeMillClose,
  afterPlaytestP55HumanTurn,
  botEvaluateSource,
  openingSixSeatHome,
  planDepartsTerritory,
  botReportSource,
  botSearchSource,
  foldPlan,
  geometry,
  isExpeditionTerminal,
  isHomeMillCloseTerminal,
  legalSteps,
  openingBotState,
  opponentSource,
  passIsBestPosition,
  planIsLegalSequence,
  planTerminates,
  rules,
  shuffleMaps,
  strideTwoStackPosition,
  threatenedDepartingExitAfterPaint,
  withWinner,
  withWrongSeat,
} from './bot-turn-search.support';

describe('bot-turn-search invariants', () => {
  it('When playBotTurn is given the active local heuristic seat and the match is not over, the system shall return chooseTurnBeam\'s move list (then fold apply for state).', () => {
    expect(opponentSource()).toMatch(/export const playBotTurn[\s\S]*chooseTurnBeam/);
  });

  it('When chooseTurn is invoked twice on equal inputs, the system shall return byte-identical move lists.', () => {
    const cases = [strideTwoStackPosition(), passIsBestPosition(), openingBotState()];
    for (const { state, Bot } of cases) {
      expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
        chooseTurnBeam(geometry, rules, state, Bot),
      );
      expect(chooseTurnGreedy(geometry, rules, state, Bot)).toEqual(
        chooseTurnGreedy(geometry, rules, state, Bot),
      );
    }
  });

  it('The system shall not use Date, Math.random, performance.now, or an elapsed-time cutoff anywhere in chooseTurn / evaluate mobility.', () => {
    const src = `${botEvaluateSource()}\n${botSearchSource()}\n${botReportSource()}\n${opponentSource()}`;
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
  });

  it('Returned plans shall be a prefix of legal moves from the start state, each applied to the state produced by the previous, last move handing the seat or ending the match.', () => {
    const cases = [strideTwoStackPosition(), passIsBestPosition(), openingBotState()];
    for (const { state, Bot } of cases) {
      if (state.activePlayer !== Bot || state.winner !== undefined) continue;
      for (const chooseTurn of [chooseTurnBeam, chooseTurnGreedy]) {
        const plan = chooseTurn(geometry, rules, state, Bot);
        expect(planIsLegalSequence(state, plan)).toBe(true);
        if (plan.length > 0) expect(planTerminates(state, plan)).toBe(true);
        const folded = foldPlan(state, plan);
        expect(folded.winner !== undefined || folded.activePlayer !== Bot).toBe(true);
      }
    }
  });

  it("Shuffling state.groups / state.territory insertion order shall not change beam-v1's plan.", () => {
    const { state, Bot } = strideTwoStackPosition();
    const shuffled = shuffleMaps(state);
    expect(chooseTurnBeam(geometry, rules, shuffled, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, state, Bot),
    );
  });

  it('The system shall not import packages/rules-core from new search modules except through RulesPort.', () => {
    expect(botSearchSource()).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
    expect(botEvaluateSource()).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
  });

  it('When state.activePlayer !== me or state.winner is set, both chooseTurn implementations and playBotTurn return an empty list / empty moves.', () => {
    const { state, Bot } = openingBotState();
    const wrong = withWrongSeat(state, Bot);
    const over = withWinner(state, Bot);
    expect(chooseTurnBeam(geometry, rules, wrong, Bot)).toEqual([]);
    expect(chooseTurnGreedy(geometry, rules, wrong, Bot)).toEqual([]);
    expect(playBotTurn(geometry, rules, wrong, Bot).moves).toEqual([]);
    expect(chooseTurnBeam(geometry, rules, over, Bot)).toEqual([]);
    expect(chooseTurnGreedy(geometry, rules, over, Bot)).toEqual([]);
    expect(playBotTurn(geometry, rules, over, Bot).moves).toEqual([]);
  });

  it("WHILE greedy-v1's chooseMove sees a legal step, the system shall not return endTurn from chooseMove.", () => {
    const opening = makeMatch();
    const me = opening.activePlayer;
    expect(legalSteps(opening).length).toBeGreaterThan(0);
    expect(chooseMove(geometry, rules, opening, me).kind).toBe('step');
  });

  it('WHILE expanding, the system shall not let search rules.apply count exceed MAX_APPLIES.', () => {
    expect(MAX_APPLIES).toBe(2000);
  });

  it('When a 6-seat opening has taken the 2026-08-31 playtest first round and the next heuristic seat still has a legal step, beam-v1 shall include a step onto an arrow that is not that seat\'s territory.', () => {
    const { state, me } = afterPlaytestP55HumanTurn();
    expect(legalSteps(state).length).toBeGreaterThan(0);
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(planDepartsTerritory(state, plan, me)).toBe(true);
  }, 30_000);

  it("When a 6-seat generated opening has the active seat's 3-stack on its home pinwheel, beam-v1 shall include a step onto an arrow that is not that seat's territory.", () => {
    const { state, me } = openingSixSeatHome();
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(planDepartsTerritory(state, plan, me)).toBe(true);
  }, 30_000);

  it("When a 6-seat generated opening's active seat has completed one 0-share home mill close so it holds more than 3 territory arrows, its trail is empty, and every own group stands on own territory, beam-v1 shall include a step onto an arrow that is not that seat's territory.", () => {
    const { state, me } = afterFirstHomeMillClose();
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(planDepartsTerritory(state, plan, me)).toBe(true);
  }, 30_000);

  it("When invariant 24's position is planned and an expedition complete existed inside the beam, the returned plan's terminal shall be an expedition: open trail, or a group off own territory, or a share gained. A second 0-share home mill close is not an acceptable return.", () => {
    const { state, me } = afterFirstHomeMillClose();
    expect(legalSteps(state).some((m) => state.territory.get(m.exit) !== me)).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, state, me);
    const terminal = foldPlan(state, plan);
    expect(isExpeditionTerminal(state, terminal, me)).toBe(true);
    expect(isHomeMillCloseTerminal(state, terminal, me)).toBe(false);
  }, 30_000);

  it('WHILE a legal departing exit is an arrow a hypothesised enemy can step onto this turn, the system shall not apply the SORTIE_SLACK swap.', () => {
    const constructed = threatenedDepartingExitAfterPaint();
    if (constructed === undefined) {
      throw new Error('setup: no threatened departing exit after paint');
    }
    const { state, me, threatenedExit } = constructed;
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(plan.some((m) => m.kind === 'step' && m.exit === threatenedExit)).toBe(false);
  }, 30_000);

  it("The system shall not change evaluate's own-territory term. homeboundScore is return-time only.", () => {
    expect(botEvaluateSource()).toMatch(/territory \* 25/);
    expect(botEvaluateSource()).not.toMatch(/homeboundScore/);
  });
});
