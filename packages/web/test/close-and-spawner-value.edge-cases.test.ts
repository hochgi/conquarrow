/**
 * docs/spec/close-and-spawner-value/close-and-spawner-value.edge-cases.feature
 * One it() per Gherkin scenario. Adapter seam — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import {
  closeValue,
  estimateCloseLoot,
  exposure,
  survival,
  turnsToClose,
} from '../src/botClose';
import { formatBotsReport, BOTS_SEEDS, type BotsMetricRow } from '../src/botReport';
import { chooseTurnBeam } from '../src/botSearch';
import { distanceToTerritory } from '../src/botEvaluate';
import { bestFindingMove, collectFindings, DEFAULT_FINDINGS_CAPS } from '../src/findings';
import { chooseMove } from '../src/opponent';
import { playLayout } from '../src/playLayout';
import {
  bestFindingPrioritySource,
  beyondDistCapPosition,
  botCloseSource,
  DIST_CAP,
  findingsSource,
  homewardClosePathPosition,
  immediateCloseAndPathPosition,
  lootEstimatorPosition,
  millPosition,
  p53ShuttleAssertionsSource,
  shuffleCloseMaps,
  sourceWithoutComments,
  twoStackStrideClosePosition,
  visitUnclaimedBorderPosition,
  webTestSourcesExcluding,
} from './close-and-spawner-value.support';
import {
  geometry,
  legalSteps,
  pagesHeuristicSource,
  passIsBestPosition,
  rules,
} from './bot-turn-search.support';

describe('Closing and spawner value — boundaries and seams', () => {
  it('Zero exposure yields survival 1 at every horizon', () => {
    expect(survival(0, 1)).toBe(1);
    expect(survival(0, 2)).toBe(1);
    expect(survival(0, 6)).toBe(1);
  });

  it('Closing this turn is undiscounted', () => {
    expect(survival(0.9, 1)).toBe(1);
    expect(survival(4, 1)).toBe(1);
  });

  it('turnsToClose uses speed', () => {
    expect(turnsToClose(4, 2)).toBe(2);
    expect(turnsToClose(4, 1)).toBe(4);
  });

  it('A zero-share land bridge still has arrow loot', () => {
    expect(closeValue(0, 3, 3, 0)).toBe(25);
  });

  it('Loot counts trail and homeward path, not fill', () => {
    const pos = lootEstimatorPosition();
    const estimated = estimateCloseLoot(geometry, pos.state, pos.Bot, pos.tip);
    expect(estimated.shares).toBe(1);
    expect(estimated.arrows).toBe(pos.expectedArrows);
    expect(pos.expectedShares).toBe(1);
    const trail = pos.state.trails.get(pos.Bot) ?? new Set();
    expect(trail.has(pos.interiorBorder)).toBe(false);
    expect(pos.interiorBorder).not.toBe(pos.tip);
    expect(pos.interiorBorder).not.toBe(pos.pathExtra);
    expect(pos.interiorBorder).not.toBe(pos.landing);
  });

  it('Homeward distance is distanceToTerritory', () => {
    expect(findingsSource()).toMatch(
      /import \{[^}]*distanceToTerritory[^}]*\} from ['"]\.\/botEvaluate['"]/,
    );
    expect(findingsSource()).not.toMatch(/const distanceToTerritory\s*=/);
    const { state, Bot, from } = homewardClosePathPosition();
    const d = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
    const findings = collectFindings(
      geometry,
      rules,
      state,
      Bot,
      DEFAULT_FINDINGS_CAPS,
      playLayout,
    );
    const hit = findings.find((f) => f.kind === 'close_path' && f.from === from);
    expect(hit).toBeDefined();
    if (hit === undefined) return;
    expect(hit.cost).toBe(turnsToClose(d, state.groups.get(from)?.heads ?? 1));
  });

  it('Beyond distCap there is no close_path', () => {
    const { state, Bot, tip } = beyondDistCapPosition();
    expect(distanceToTerritory(geometry, state, Bot, tip, DIST_CAP)).toBeGreaterThan(DIST_CAP);
    const findings = collectFindings(
      geometry,
      rules,
      state,
      Bot,
      DEFAULT_FINDINGS_CAPS,
      playLayout,
    );
    expect(findings.some((f) => f.kind === 'close_path' && f.from === tip)).toBe(false);
  });

  it('Visiting a border is still not claim_share', () => {
    const { state, Bot, moveFrom, moveExit } = visitUnclaimedBorderPosition();
    const findings = collectFindings(
      geometry,
      rules,
      state,
      Bot,
      DEFAULT_FINDINGS_CAPS,
      playLayout,
    );
    expect(
      findings.some(
        (f) => f.kind === 'claim_share' && f.move.from === moveFrom && f.move.exit === moveExit,
      ),
    ).toBe(false);
  });

  it('close_path strides the homeward exit', () => {
    const { state, Bot, from, exit } = twoStackStrideClosePosition();
    const findings = collectFindings(
      geometry,
      rules,
      state,
      Bot,
      DEFAULT_FINDINGS_CAPS,
      playLayout,
    );
    const hit = findings.find((f) => f.kind === 'close_path' && f.from === from);
    expect(hit).toBeDefined();
    if (hit === undefined) return;
    expect(hit.move.exit).toBe(exit);
    expect(hit.move.count).toBe(2);
  });

  it('Immediate close outranks close_path', () => {
    const { state, Bot, closeFrom, closeExit } = immediateCloseAndPathPosition();
    const move = bestFindingMove(geometry, rules, state, Bot, DEFAULT_FINDINGS_CAPS, playLayout);
    expect(move).toBeDefined();
    if (move === undefined) return;
    expect(move.from).toBe(closeFrom);
    expect(move.exit).toBe(closeExit);
    const order = bestFindingPrioritySource();
    expect(order.indexOf('close')).toBeGreaterThan(-1);
    expect(order.indexOf('close_path')).toBeGreaterThan(order.indexOf('close'));
  });

  it('close_path outranks approach_spawner in kind order', () => {
    const order = bestFindingPrioritySource();
    const attack = order.indexOf('attack');
    const closePath = order.indexOf('close_path');
    const approach = order.indexOf('approach_spawner');
    expect(attack).toBeGreaterThan(-1);
    expect(closePath).toBeGreaterThan(attack);
    expect(approach).toBeGreaterThan(closePath);
  });

  it('Close-value code mentions no clock or RNG', () => {
    const src = sourceWithoutComments(`${botCloseSource()}\n${findingsSource()}`);
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
    expect(src).not.toContain('new Date');
  });

  it('Map insertion order does not change exposure or the plan', () => {
    const { state, Bot } = millPosition();
    const shuffled = shuffleCloseMaps(state);
    expect([...state.groups.keys()]).not.toEqual([...shuffled.groups.keys()]);
    expect(exposure(geometry, state, Bot)).toBe(exposure(geometry, shuffled, Bot));
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, shuffled, Bot),
    );
  });

  it('pagesHeuristic still calls chooseMove', () => {
    const src = pagesHeuristicSource();
    expect(src).toContain("from '../../web/src/opponent'");
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
  });

  it('greedy-v1 still never passes while a step exists', () => {
    const { state, Bot } = passIsBestPosition();
    expect(legalSteps(state).length).toBeGreaterThan(0);
    expect(chooseMove(geometry, rules, state, Bot).kind).toBe('step');
  });

  it('P53 shuttle head-to-head remains the CI assertion', () => {
    const src = p53ShuttleAssertionsSource();
    expect(src).toMatch(/toBeLessThan\(0\.1\)/);
    expect(src).toMatch(/beamGt1 \/ beamSteps\)\.toBeGreaterThan\(greedyGt1 \/ greedySteps\)/);
    expect(src).toMatch(/beamShare\)\.toBeGreaterThan\(greedyShare\)/);
    expect(src).toContain('isShuttle');
  });

  it('pnpm bots still reports closes without gating them', () => {
    expect(BOTS_SEEDS).toEqual([1, 2, 3]);
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
    expect(table).toMatch(/closes per 100 turns/);
    expect(table).toMatch(/firstCloseAt/);
    const others = webTestSourcesExcluding(['close-and-spawner-value.edge-cases.test.ts']);
    expect(others).not.toContain('closesPer100Turns).toBeGreaterThan');
    expect(others).not.toContain('closesPer100Turns).toBeLessThan');
    expect(others).not.toContain('firstCloseAt).toBe(56)');
    expect(others).not.toContain('firstCloseAt).toBe(15)');
  });
});
