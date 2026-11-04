/**
 * docs/spec/bot-turn-search/bot-turn-search.core.feature
 * One it() per Gherkin scenario. Pure helper seam — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import type { StepMove } from '@conquarrow/contracts';
import { formatBotsReport, type BotsMetricRow } from '../src/botReport';
import {
  chooseTurnBeam,
  chooseTurnGreedy,
  isShuttle,
  type ChooseTurn,
} from '../src/botSearch';
import { playBotTurn } from '../src/opponent';
import {
  afterFirstHomeMillClose,
  afterPlaytestP55HumanTurn,
  boxOpenExitPosition,
  openingSixSeatHome,
  planDepartsTerritory,
  foldPlan,
  fourStackThreeArrowPosition,
  geometry,
  heuristicTurnStarts,
  isExpeditionTerminal,
  isHomeMillCloseTerminal,
  legalSteps,
  loadBaselineLog,
  opponentSource,
  passIsBestPosition,
  planIsLegalSequence,
  planTerminates,
  rules,
  splitSharePosition,
  strideTwoStackPosition,
} from './bot-turn-search.support';
import { creditInapplicable, withCreditBlocker, withLongTrail } from './heuristic-tempo-horizon.support';

describe('Bot turn search — stride by searching a whole turn', () => {
  it('playBotTurn plans with beam-v1', () => {
    const { state, Bot } = strideTwoStackPosition();
    const planned = playBotTurn(geometry, rules, state, Bot);
    expect(planned.moves).toEqual(chooseTurnBeam(geometry, rules, state, Bot));
    expect(foldPlan(state, planned.moves)).toEqual(planned.state);
    expect(opponentSource()).toMatch(/export const playBotTurn[\s\S]*chooseTurnBeam/);
  });

  it('greedy-v1 and beam-v1 share the ChooseTurn signature', () => {
    const { state, Bot } = strideTwoStackPosition();
    const greedy: ReturnType<ChooseTurn> = chooseTurnGreedy(geometry, rules, state, Bot);
    const beam: ReturnType<ChooseTurn> = chooseTurnBeam(geometry, rules, state, Bot);
    expect(Array.isArray(greedy)).toBe(true);
    expect(Array.isArray(beam)).toBe(true);
    for (const plan of [greedy, beam]) {
      if (plan.length === 0) continue;
      expect(planTerminates(state, plan)).toBe(true);
    }
  });

  it('Wrong seat or a winner yields an empty plan', () => {
    const { state, Bot } = strideTwoStackPosition();
    const other = state.players.find((p) => p !== Bot);
    expect(other).toBeDefined();
    if (other === undefined) return;
    const wrong = { ...state, activePlayer: other };
    const planned = playBotTurn(geometry, rules, wrong, Bot);
    expect(planned.moves).toEqual([]);
    expect(planned.state).toBe(wrong);
  });

  // Rewritten for P85 (docs/spec/heuristic-tempo-horizon, decision 12): on the
  // original board no enemy can reach, so the sortie credit may now hold the
  // trail. The trail is lengthened behind the tip until elapsed + L exceeds
  // SORTIE_TOTAL_CAP, which makes the credit inapplicable; P53's stride is
  // what is tested.
  it('A 2-stack strides a two-arrow homeward close', () => {
    const pos = strideTwoStackPosition();
    const { Bot, from, first, second } = pos;
    const state = withLongTrail(pos.state, Bot, from, 2);
    expect(creditInapplicable(state, Bot, 2)).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    const steps = plan.filter((m) => m.kind === 'step');
    expect(steps[0]).toMatchObject({ from, exit: first, count: 2 });
    expect(steps[1]).toMatchObject({ from: first, exit: second, count: 2 });
    expect(isShuttle(plan)).toBe(false);
  });

  // Rewritten for P85 (decision 12): an enemy group placed where every
  // sortie this turn has W ≤ L makes the sortie credit inapplicable; P53's
  // three-arrow stride is what is tested.
  it('A 4-stack takes three arrows in one turn', () => {
    const pos = fourStackThreeArrowPosition();
    const { Bot, run } = pos;
    const start = run[0];
    if (start === undefined) throw new Error('setup: empty run');
    const state = withCreditBlocker(pos.state, Bot, start, 3);
    expect(creditInapplicable(state, Bot, 3)).toBe(true);
    const a0 = run[0];
    const a1 = run[1];
    const a2 = run[2];
    const a3 = run[3];
    expect(a0).toBeDefined();
    expect(a1).toBeDefined();
    expect(a2).toBeDefined();
    expect(a3).toBeDefined();
    if (a0 === undefined || a1 === undefined || a2 === undefined || a3 === undefined) return;
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    const steps = plan.filter((m) => m.kind === 'step');
    expect(steps[0]).toMatchObject({ from: a0, exit: a1, count: 4 });
    expect(steps[1]).toMatchObject({ from: a1, exit: a2, count: 4 });
    expect(steps[2]).toMatchObject({ from: a2, exit: a3 });
    const third = steps[2];
    expect(third).toBeDefined();
    if (third === undefined) return;
    expect([2, 4]).toContain(third.count);
    expect(steps.slice(0, 3)).toHaveLength(3);
  });

  // Rewritten for P85 (decision 12): an enemy group makes the sortie credit
  // inapplicable this turn; P53's split is what is tested.
  it('Splitting wins when two destinations beat one deeper advance', () => {
    const pos = splitSharePosition();
    const { Bot, from } = pos;
    const state = withCreditBlocker(pos.state, Bot, from, 3);
    expect(creditInapplicable(state, Bot, 3)).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    const taken = plan.filter(
      (m): m is StepMove => m.kind === 'step' && m.from === from && m.count === 2,
    );
    expect(new Set(taken.map((m) => String(m.exit))).size).toBeGreaterThanOrEqual(2);
  });

  it("The bot occupies a lone enemy head's only open exit", () => {
    const { state, Bot, openExit } = boxOpenExitPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(plan.some((m) => m.kind === 'step' && m.exit === openExit)).toBe(true);
  });

  // Superseded by P84 (docs/spec/heuristic-never-idle), decision 1.
  it('A step is taken even when passing evaluates best', () => {
    const { state, Bot } = passIsBestPosition();
    expect(rules.legalMoves(state).some((m) => m.kind === 'step')).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(plan.some((m) => m.kind === 'step')).toBe(true);
    expect(planIsLegalSequence(state, plan)).toBe(true);
    expect(planTerminates(state, plan)).toBe(true);
  });

  it('After a home-pinwheel mill the bot still leaves', () => {
    const { state, me } = afterPlaytestP55HumanTurn();
    expect(legalSteps(state).length).toBeGreaterThan(0);
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(planDepartsTerritory(state, plan, me)).toBe(true);
  }, 30_000);

  it('An opening home 3-stack leaves rather than milling the pinwheel', () => {
    const { state, me } = openingSixSeatHome();
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(planDepartsTerritory(state, plan, me)).toBe(true);
  }, 30_000);

  it('After a 0-share home close past three arrows the bot still leaves', () => {
    const { state, me } = afterFirstHomeMillClose();
    expect(legalSteps(state).some((m) => state.territory.get(m.exit) !== me)).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(planDepartsTerritory(state, plan, me)).toBe(true);
  }, 30_000);

  it('The post-paint plan is an expedition not another home mill close', () => {
    const { state, me } = afterFirstHomeMillClose();
    expect(legalSteps(state).some((m) => state.territory.get(m.exit) !== me)).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, state, me);
    const terminal = foldPlan(state, plan);
    expect(isExpeditionTerminal(state, terminal, me)).toBe(true);
    expect(isHomeMillCloseTerminal(state, terminal, me)).toBe(false);
  }, 30_000);

  it('beam-v1 beats greedy-v1 on shuttle rate and count greater than 1', () => {
    const starts = heuristicTurnStarts(loadBaselineLog());
    expect(starts.length).toBeGreaterThan(0);
    let beamShuttle = 0;
    let greedyShuttle = 0;
    let beamGt1 = 0;
    let beamSteps = 0;
    let greedyGt1 = 0;
    let greedySteps = 0;
    for (const { state, me } of starts) {
      const beam = chooseTurnBeam(geometry, rules, state, me);
      const greedy = chooseTurnGreedy(geometry, rules, state, me);
      if (isShuttle(beam)) beamShuttle += 1;
      if (isShuttle(greedy)) greedyShuttle += 1;
      for (const move of beam) {
        if (move.kind !== 'step') continue;
        beamSteps += 1;
        if (move.count > 1) beamGt1 += 1;
      }
      for (const move of greedy) {
        if (move.kind !== 'step') continue;
        greedySteps += 1;
        if (move.count > 1) greedyGt1 += 1;
      }
    }
    expect(beamShuttle / starts.length).toBeLessThan(greedyShuttle / starts.length);
    expect(beamGt1 / beamSteps).toBeGreaterThan(greedyGt1 / greedySteps);
  }, 120_000);

  it('pnpm bots reports the metric table', () => {
    const greedy: BotsMetricRow = {
      impl: 'greedy-v1',
      shuttleRate: 0.48,
      countGt1Share: 0.11,
      stepsPerTurn: 3,
      closesPer100Turns: 15,
      firstCloseAt: 56,
      sharesAtTurn50: 12,
      meanAppliesPerTurn: 40,
    };
    const beam: BotsMetricRow = {
      impl: 'beam-v1',
      shuttleRate: 0.05,
      countGt1Share: 0.3,
      stepsPerTurn: 2.2,
      closesPer100Turns: 22,
      firstCloseAt: 40,
      sharesAtTurn50: 18,
      meanAppliesPerTurn: 200,
    };
    const table = formatBotsReport([greedy, beam]);
    expect(table).toMatch(/greedy-v1/);
    expect(table).toMatch(/beam-v1/);
    expect(table).toMatch(/shuttle rate/);
    expect(table).toMatch(/count>1 share/);
    expect(table).toMatch(/steps per turn/);
    expect(table).toMatch(/closes per 100 turns/);
    expect(table).toMatch(/firstCloseAt/);
    expect(table).toMatch(/shares at turn 50/);
    expect(table).toMatch(/mean applies per turn/);
  });
});
