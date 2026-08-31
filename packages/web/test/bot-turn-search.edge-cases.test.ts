/**
 * docs/spec/bot-turn-search/bot-turn-search.edge-cases.feature
 * One it() per Gherkin scenario. Pure helper seam — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import { endTurn, mintArrowId, step } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { bestFindingMove } from '../src/findings';
import {
  BRANCH,
  chooseTurnBeam,
  chooseTurnBeamWithBudget,
  chooseTurnGreedy,
  isShuttle,
  MAX_APPLIES,
  MAX_PLAN,
  MOBILITY_SCALE,
  pickBetterComplete,
  planKey,
} from '../src/botSearch';
import { chooseMove, evaluate, playBotTurn } from '../src/opponent';
import { playLayout } from '../src/playLayout';
import {
  botEvaluateSource,
  botSearchSource,
  countingRules,
  enemyBoxMobilityPair,
  geometry,
  heuristicTurnStarts,
  legalSteps,
  loadBaselineLog,
  manyOneStackPosition,
  openingBotState,
  opponentSource,
  pagesHeuristicSource,
  passIsBestPosition,
  passWithManyStepsPosition,
  planIsLegalSequence,
  planTerminates,
  rules,
  selfBoxMobilityPair,
  shuffleMaps,
  strideTwoStackPosition,
  withWinner,
} from './bot-turn-search.support';

describe('Bot turn search — budget, determinism, and frozen greedy-v1', () => {
  it('beam-v1 shuttles under 10 percent of baseline heuristic turns', () => {
    const log = loadBaselineLog();
    const starts = heuristicTurnStarts(log);
    expect(starts.length).toBeGreaterThan(0);
    let shuttles = 0;
    for (const { state, me } of starts) {
      const plan = chooseTurnBeam(geometry, rules, state, me);
      if (isShuttle(plan)) shuttles += 1;
    }
    expect(shuttles / starts.length).toBeLessThan(0.1);
  }, 120_000);

  it('beam-v1 uses count greater than 1 more than greedy-v1 on those turns', () => {
    const log = loadBaselineLog();
    const starts = heuristicTurnStarts(log);
    let beamGt1 = 0;
    let beamSteps = 0;
    let greedyGt1 = 0;
    let greedySteps = 0;
    for (const { state, me } of starts) {
      const beam = chooseTurnBeam(geometry, rules, state, me);
      const greedy = chooseTurnGreedy(geometry, rules, state, me);
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
    const beamShare = beamSteps === 0 ? 0 : beamGt1 / beamSteps;
    const greedyShare = greedySteps === 0 ? 0 : greedyGt1 / greedySteps;
    expect(beamShare).toBeGreaterThan(greedyShare);
  }, 120_000);

  it('Same state yields the same plan twice', () => {
    const { state, Bot } = strideTwoStackPosition();
    const a = chooseTurnBeam(geometry, rules, state, Bot);
    const b = chooseTurnBeam(geometry, rules, state, Bot);
    expect(a).toEqual(b);
  });

  it('Map insertion order does not change the plan', () => {
    const { state, Bot } = strideTwoStackPosition();
    const shuffled = shuffleMaps(state);
    expect([...state.groups.keys()]).not.toEqual([...shuffled.groups.keys()]);
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, shuffled, Bot),
    );
  });

  it('Equal evaluate completes break on planKey', () => {
    const { state } = openingBotState();
    const from = mintArrowId('tiling:a:0,0,0');
    const exit = mintArrowId('tiling:a:0,0,1');
    const low = { moves: [endTurn()], state };
    const high = { moves: [step(from, exit, 1), endTurn()], state };
    expect(evaluate(geometry, low.state, state.activePlayer, rules)).toBe(
      evaluate(geometry, high.state, state.activePlayer, rules),
    );
    expect(planKey(low.moves) < planKey(high.moves)).toBe(true);
    const picked = pickBetterComplete(geometry, state.activePlayer, rules, high, low);
    expect(planKey(picked.moves)).toBe(planKey(low.moves));
  });

  it('Search apply count never exceeds MAX_APPLIES', () => {
    const opening = makeMatch({
      playerCount: 6,
      R: 7,
      homeOffset: 5,
      dominationN: 5,
      spawnerSeed: 1,
    });
    const me = opening.activePlayer;
    const { rules: counted, count } = countingRules(rules);
    chooseTurnBeam(geometry, counted, opening, me);
    expect(count()).toBeLessThanOrEqual(MAX_APPLIES);
    expect(MAX_APPLIES).toBe(2000);
  });

  it('Hitting the cap still returns a valid deterministic plan', () => {
    const opening = makeMatch();
    const me = opening.activePlayer;
    const { rules: counted, count } = countingRules(rules);
    const a = chooseTurnBeamWithBudget(geometry, counted, opening, me, { maxApplies: 2 });
    const b = chooseTurnBeamWithBudget(geometry, rules, opening, me, { maxApplies: 2 });
    expect(a).toEqual(b);
    expect(planIsLegalSequence(opening, a)).toBe(true);
    expect(planTerminates(opening, a)).toBe(true);
    expect(count()).toBeLessThanOrEqual(3);
  });

  it('MAX_PLAN stops extension', () => {
    const { state, Bot } = manyOneStackPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(plan.length).toBeLessThanOrEqual(MAX_PLAN);
    expect(planTerminates(state, plan)).toBe(true);
  });

  it('endTurn is considered even when it is not among the BRANCH steps', () => {
    const { state, Bot } = passWithManyStepsPosition();
    expect(legalSteps(state).length).toBeGreaterThan(BRANCH);
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(plan).toEqual([{ kind: 'endTurn' }]);
  });

  it('greedy-v1 still never passes while a step exists', () => {
    const { state, Bot } = passIsBestPosition();
    expect(legalSteps(state).length).toBeGreaterThan(0);
    expect(chooseMove(geometry, rules, state, Bot).kind).toBe('step');
  });

  it('greedy-v1 still short-circuits on a legal finding', () => {
    const opening = makeMatch();
    const me = opening.activePlayer;
    const guided = bestFindingMove(geometry, rules, opening, me, undefined, playLayout);
    expect(guided).toBeDefined();
    if (guided === undefined) return;
    const pick = chooseMove(geometry, rules, opening, me);
    expect(pick).toEqual(guided);
  });

  it('Findings order beam expansion but do not short-circuit it', () => {
    const { state, Bot, from, first, second } = strideTwoStackPosition();
    const guided = bestFindingMove(geometry, rules, state, Bot, undefined, playLayout);
    expect(guided).toBeDefined();
    if (guided !== undefined) {
      // P54: close_path is max legal count (not pickPortion's count=1 shuttle).
      expect(guided.count).toBe(2);
      expect(guided.from).toBe(from);
    }
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    const steps = plan.filter((m) => m.kind === 'step');
    expect(steps[0]).toMatchObject({ from, exit: first, count: 2 });
    expect(steps[1]).toMatchObject({ from: first, exit: second, count: 2 });
    expect(isShuttle(plan)).toBe(false);
  });

  it('Search and evaluate mobility mention no clock or RNG', () => {
    const src = `${botEvaluateSource()}\n${botSearchSource()}\n${opponentSource()}`;
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
  });

  it('pagesHeuristic still calls chooseMove', () => {
    const src = pagesHeuristicSource();
    expect(src).toContain("from '../../web/src/opponent'");
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
  });

  it('Winner set yields an empty plan', () => {
    const { state, Bot } = openingBotState();
    const over = withWinner(state, Bot);
    const planned = playBotTurn(geometry, rules, over, Bot);
    expect(planned.moves).toEqual([]);
  });

  it('Boxing an enemy raises evaluate by the scaled exit-head product', () => {
    const { open, boxed, Bot, heads, exitsLost } = enemyBoxMobilityPair();
    const delta = evaluate(geometry, boxed, Bot, rules) - evaluate(geometry, open, Bot, rules);
    expect(delta).toBe(MOBILITY_SCALE * heads * exitsLost);
  });

  it('Boxing yourself lowers evaluate', () => {
    const { open, boxed, Bot, heads, exitsLost } = selfBoxMobilityPair();
    const delta = evaluate(geometry, open, Bot, rules) - evaluate(geometry, boxed, Bot, rules);
    expect(delta).toBe(MOBILITY_SCALE * heads * exitsLost);
  });
});
