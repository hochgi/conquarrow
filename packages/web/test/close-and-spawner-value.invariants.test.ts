/**
 * EARS invariants for docs/spec/close-and-spawner-value/close-and-spawner-value.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/bot-turn-search.invariants.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { speed } from '@conquarrow/contracts';
import {
  ARROW_VALUE_A,
  SHARE_VALUE_S,
  closeValue,
  estimateCloseLoot,
  exposure,
  loot,
  preferClose,
  shareTerm,
  survival,
  turnsToClose,
} from '../src/botClose';
import { chooseTurnBeam } from '../src/botSearch';
import { distanceToTerritory } from '../src/botEvaluate';
import { collectFindings, DEFAULT_FINDINGS_CAPS } from '../src/findings';
import { chooseMove, playBotTurn } from '../src/opponent';
import { playLayout } from '../src/playLayout';
import {
  bestFindingPrioritySource,
  botCloseSource,
  DIST_CAP,
  exposurePair,
  findingsSource,
  homewardClosePathPosition,
  lootEstimatorPosition,
  millPosition,
  p53ShuttleAssertionsSource,
  shuffleCloseMaps,
  sourceWithoutComments,
  twoStackStrideClosePosition,
  visitUnclaimedBorderPosition,
} from './close-and-spawner-value.support';
import {
  geometry,
  legalSteps,
  opponentSource,
  pagesHeuristicSource,
  passIsBestPosition,
  rules,
} from './bot-turn-search.support';

describe('close-and-spawner-value invariants', () => {
  it('When two candidate closes differ only in loot and turnsToClose and exposure is 0, the system shall pick the higher loot / turnsToClose, breaking a numeric tie on fewer turnsToClose.', () => {
    expect(closeValue(1, 3, 2, 0)).toBeGreaterThan(closeValue(2, 3, 6, 0));
    expect(closeValue(1, 0, 2, 0)).toBe(closeValue(2, 0, 6, 0));
    expect(
      preferClose(
        { shares: 1, arrows: 0, turnsToClose: 2, exposure: 0, goal: 'z' },
        { shares: 2, arrows: 0, turnsToClose: 6, exposure: 0, goal: 'a' },
      ),
    ).toBeLessThan(0);
  });

  it('When a 2-turn close banks one share and a 6-turn close banks two, with equal arrows and exposure 0, the system shall prefer the 2-turn close.', () => {
    expect(closeValue(1, 3, 2, 0)).toBe(87.5);
    expect(closeValue(2, 3, 6, 0)).toBe(62.5);
  });

  it('When a 2-turn close banks one share and a 3-turn close banks two, with equal arrows and exposure 0, the system shall prefer the 3-turn close.', () => {
    expect(closeValue(2, 3, 3, 0)).toBe(125);
    expect(closeValue(2, 3, 3, 0)).toBeGreaterThan(closeValue(1, 3, 2, 0));
  });

  it('When one closure claims three shares and three closures each claim one share, at equal turnsToClose and equal total arrows, the system shall prefer the three-share closure (shareTerm(3) > 3 × shareTerm(1)).', () => {
    expect(shareTerm(3)).toBeGreaterThan(3 * shareTerm(1));
    expect(closeValue(3, 9, 4, 0)).toBeGreaterThan(3 * closeValue(1, 3, 4, 0));
  });

  it('The system shall compute shareTerm(n) as S × n × (n + 1) / 2 with S = 100.', () => {
    expect(SHARE_VALUE_S).toBe(100);
    const rows = [
      [0, 0],
      [1, 100],
      [2, 300],
      [3, 600],
    ] as const;
    for (const [n, expected] of rows) {
      expect(shareTerm(n), `shareTerm(${String(n)})`).toBe(expected);
    }
  });

  it('The system shall add arrows × 25 to loot and shall not introduce a third loot coefficient.', () => {
    expect(ARROW_VALUE_A).toBe(25);
    expect(loot(0, 3)).toBe(75);
    expect(loot(1, 0)).toBe(100);
    expect(loot(1, 3)).toBe(175);
    expect(loot(2, 3)).toBe(375);
    const exported = botCloseSource().match(/export const \w+_VALUE_\w+/g);
    expect(exported).toEqual(['export const SHARE_VALUE_S', 'export const ARROW_VALUE_A']);
  });

  it('When exposure is 0, the system shall return survival = 1 for every turnsToClose ≥ 1.', () => {
    for (const T of [1, 2, 3, 6, 12] as const) {
      expect(survival(0, T), `T=${String(T)}`).toBe(1);
    }
  });

  it('When turnsToClose is 1, the system shall return survival = 1 even if exposure is positive.', () => {
    for (const e of [0.1, 1, 2.5, 11] as const) {
      expect(survival(e, 1), `e=${String(e)}`).toBe(1);
    }
  });

  it('When an otherwise identical trail has an enemy group two grain steps from it versus no enemy in distCap, the system shall report a strictly larger exposure in the first.', () => {
    const { quiet, threatened, Bot } = exposurePair();
    expect(exposure(geometry, threatened, Bot)).toBeGreaterThan(exposure(geometry, quiet, Bot));
    expect(exposure(geometry, quiet, Bot)).toBe(0);
  });

  it('When that threatened exposure is applied to a 2-turn one-share close versus a 3-turn two-share close (equal arrows), the system shall prefer the 2-turn close.', () => {
    const { threatened, Bot } = exposurePair();
    const e = exposure(geometry, threatened, Bot);
    expect(e).toBeGreaterThan(0);
    expect(closeValue(1, 3, 2, e)).toBeGreaterThan(closeValue(2, 3, 3, e));
  });

  it('The system shall compute turnsToClose as max(1, ceil(grainDist / speed(walkingHeads))).', () => {
    const rows = [
      [4, 2],
      [4, 1],
      [1, 1],
      [5, 2],
      [8, 4],
    ] as const;
    for (const [dist, heads] of rows) {
      const expected = Math.max(1, Math.ceil(dist / speed(heads)));
      expect(turnsToClose(dist, heads), `dist=${String(dist)} heads=${String(heads)}`).toBe(
        expected,
      );
    }
  });

  it('WHEN a group stands on my trail with 1 ≤ distanceToTerritory ≤ cap and a legal step that reduces that distance, the system shall emit a close_path finding whose move reduces it.', () => {
    const { state, Bot, from } = homewardClosePathPosition();
    const d0 = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
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
    expect(distanceToTerritory(geometry, state, Bot, hit.move.exit, DIST_CAP)).toBeLessThan(d0);
  });

  it("WHEN a group's from is an open spawner-border arrow, the system shall not emit approach_spawner from that from, and shall emit close_path rather than skipping the group.", () => {
    const { state, Bot, from } = millPosition();
    const findings = collectFindings(
      geometry,
      rules,
      state,
      Bot,
      DEFAULT_FINDINGS_CAPS,
      playLayout,
    );
    expect(findings.some((f) => f.kind === 'approach_spawner' && f.from === from)).toBe(false);
    expect(findings.some((f) => f.kind === 'close_path' && f.from === from)).toBe(true);
  });

  it("WHEN a legal step visits an unclaimed spawner border without raising the seat's share count, the system shall not emit claim_share for that step.", () => {
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

  it('The system shall estimate claimed arrows and shares from the current trail and the homeward path only, and shall not run fill.', () => {
    const pos = lootEstimatorPosition();
    expect(estimateCloseLoot(geometry, pos.state, pos.Bot, pos.tip)).toEqual({
      shares: 1,
      arrows: pos.expectedArrows,
    });
  });

  it('The system shall pick the close_path move as a maximum-count legal step that strictly reduces distanceToTerritory.', () => {
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

  it('WHILE bestFindingMove chooses among kinds, the system shall prefer immediate close over close_path over approach_spawner.', () => {
    const order = bestFindingPrioritySource();
    expect(order.indexOf('close')).toBeGreaterThan(-1);
    expect(order.indexOf('close_path')).toBeGreaterThan(order.indexOf('close'));
    expect(order.indexOf('approach_spawner')).toBeGreaterThan(order.indexOf('close_path'));
  });

  it('The system shall compute homeward distance with the same distanceToTerritory implementation evaluate uses.', () => {
    expect(findingsSource()).toMatch(
      /import \{[^}]*distanceToTerritory[^}]*\} from ['"]\.\/botEvaluate['"]/,
    );
    expect(findingsSource()).not.toMatch(/const distanceToTerritory\s*=/);
  });

  it('The system shall not use Date, Math.random, performance.now, or an elapsed-time cutoff in closeValue / exposure / close_path.', () => {
    const src = sourceWithoutComments(`${botCloseSource()}\n${findingsSource()}`);
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
    expect(src).not.toContain('new Date');
  });

  it("Shuffling state.groups / state.trails / state.territory insertion order shall not change exposure, closeValue, or chooseTurnBeam's plan on a constructed close position.", () => {
    const { state, Bot, from } = homewardClosePathPosition();
    const shuffled = shuffleCloseMaps(state);
    expect(exposure(geometry, state, Bot)).toBe(exposure(geometry, shuffled, Bot));
    const d = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
    expect(closeValue(1, 3, turnsToClose(d, 2), exposure(geometry, state, Bot))).toBe(
      closeValue(1, 3, turnsToClose(d, 2), exposure(geometry, shuffled, Bot)),
    );
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, shuffled, Bot),
    );
  });

  it('pagesHeuristic shall keep calling chooseMove.', () => {
    const src = pagesHeuristicSource();
    expect(src).toMatch(/import \{[^}]*chooseMove/);
    expect(src).not.toContain('chooseTurnBeam');
  });

  it("WHILE greedy-v1's chooseMove sees a legal step, the system shall not return endTurn from chooseMove.", () => {
    const { state, Bot } = passIsBestPosition();
    expect(legalSteps(state).length).toBeGreaterThan(0);
    expect(chooseMove(geometry, rules, state, Bot).kind).toBe('step');
  });

  it("On the committed P53 baseline heuristic turn-starts, beam-v1's shuttle rate shall remain below greedy-v1's and below 10 percent, and its share of count > 1 steps shall remain above greedy-v1's.", () => {
    const src = p53ShuttleAssertionsSource();
    expect(src).toMatch(/toBeLessThan\(0\.1\)/);
    expect(src).toMatch(/beamShare\)\.toBeGreaterThan\(greedyShare\)/);
    expect(src).toMatch(/beamGt1 \/ beamSteps\)\.toBeGreaterThan\(greedyGt1 \/ greedySteps\)/);
  });

  it('The system shall not import packages/rules-core from botClose.ts except through RulesPort (it should need none).', () => {
    expect(botCloseSource()).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
    expect(botCloseSource()).not.toMatch(/from ['"]\.\.\/rules-core/);
  });

  it("playBotTurn shall keep returning chooseTurnBeam's move list.", () => {
    expect(opponentSource()).toMatch(/export const playBotTurn[\s\S]*chooseTurnBeam/);
    const { state, Bot } = homewardClosePathPosition();
    expect(playBotTurn(geometry, rules, state, Bot).moves).toEqual(
      chooseTurnBeam(geometry, rules, state, Bot),
    );
  });
});
