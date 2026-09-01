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
  BOT_DRIVE,
  SHARE_VALUE_S,
  campaignTarget,
  closeValue,
  estimateCloseLoot,
  exposure,
  gatedCloseValue,
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
  approachCampaignVsNearerSpawnerPosition,
  bestFindingPrioritySource,
  botCloseSource,
  campaignTieBreakPosition,
  contestedVsMonopolisedPosition,
  DIST_CAP,
  findingsSource,
  gameStateSource,
  homewardClosePathPosition,
  isQuietDirtCloseComplete,
  lootEstimatorPosition,
  millPosition,
  p53ShuttleAssertionsSource,
  quietDirtVsCampaignWalkPosition,
  shuffleCloseMaps,
  sourceWithoutComments,
  specCampaignTarget,
  stepTowardVertex,
  twoStackStrideClosePosition,
  visitUnclaimedBorderPosition,
} from './close-and-spawner-value.support';
import {
  afterFirstHomeMillClose,
  botEvaluateSource,
  foldPlan,
  geometry,
  legalSteps,
  opponentSource,
  pagesHeuristicSource,
  passIsBestPosition,
  planDepartsTerritory,
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
    const estimated = estimateCloseLoot(geometry, pos.state, pos.Bot, pos.tip);
    expect(estimated.shares).toBe(1);
    expect(estimated.arrows).toBe(pos.expectedArrows);
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
    expect(exposure(geometry, rules, state, Bot)).toBe(exposure(geometry, rules, shuffled, Bot));
    const d = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
    expect(closeValue(1, 3, turnsToClose(d, 2), exposure(geometry, rules, state, Bot))).toBe(
      closeValue(1, 3, turnsToClose(d, 2), exposure(geometry, rules, shuffled, Bot)),
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

  it('The system shall compute campaignTarget as the spawner vertex V maximising force × missing-own-shares / grainDist among V with ownShares < 3, breaking ties on lesser vertex id.', () => {
    const contested = contestedVsMonopolisedPosition();
    expect(campaignTarget(geometry, contested.state, contested.Bot)).toBe(
      specCampaignTarget(contested.state, contested.Bot),
    );
    expect(campaignTarget(geometry, contested.state, contested.Bot)).toBe(contested.contested);
    const tied = campaignTieBreakPosition();
    expect(campaignTarget(geometry, tied.state, tied.Bot)).toBe(tied.lesser);
  });

  it('The system shall measure grain distance to a vertex as the minimum grainDistance from an own group to that vertex\'s border arrows, and shall not write a third grain BFS.', () => {
    expect(botEvaluateSource()).toMatch(/export const grainDistance/);
    const src = sourceWithoutComments(botCloseSource());
    expect(src).not.toMatch(/let frontier/);
    expect(src).not.toMatch(/cameFrom/);
  });

  it('When a nearer spawner is monopolised by me and a farther spawner is not, campaignTarget shall return the unmonopolised vertex.', () => {
    const { state, Bot, monopolised, contested } = contestedVsMonopolisedPosition();
    expect(campaignTarget(geometry, state, Bot)).toBe(contested);
    expect(campaignTarget(geometry, state, Bot)).not.toBe(monopolised);
  });

  it('When a close candidate has shares == 0, does not hit the campaign, and does not advance it, and exposure is 0, the system shall treat its gated close value as 0.', () => {
    expect(
      gatedCloseValue(0, 3, 1, 0, { hitsCampaign: false, advancesCampaign: false }),
    ).toBe(0);
  });

  it('When that same candidate has exposure > 0, the system shall keep the P54 ungated rate.', () => {
    const e = 2;
    expect(
      gatedCloseValue(0, 3, 1, e, { hitsCampaign: false, advancesCampaign: false }),
    ).toBe(closeValue(0, 3, 1, e));
  });

  it('When a 2-turn close banks one share and a 6-turn close banks two, with equal arrows and exposure 0, the system shall still prefer the 2-turn close (dirt-close gate off).', () => {
    expect(closeValue(1, 3, 2, 0)).toBe(87.5);
    expect(closeValue(2, 3, 6, 0)).toBe(62.5);
    expect(
      preferClose(
        { shares: 1, arrows: 3, turnsToClose: 2, exposure: 0 },
        { shares: 2, arrows: 3, turnsToClose: 6, exposure: 0 },
      ),
    ).toBeLessThan(0);
  });

  it('WHILE approach_spawner ranks departing exits and a campaignTarget exists, the system shall rank by grain distance to that vertex, not to the nearest spawner of any kind.', () => {
    const pos = approachCampaignVsNearerSpawnerPosition();
    const findings = collectFindings(
      geometry,
      rules,
      pos.state,
      pos.Bot,
      { maxFindings: 32, distCap: DIST_CAP },
      playLayout,
    );
    const first = findings.find((f) => f.kind === 'approach_spawner');
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(geometry.borderArrows(pos.campaign).includes(first.goal)).toBe(true);
  });

  it("WHEN a group's from is an open share of campaignTarget, the system shall emit close_path and shall not emit approach_spawner from that from.", () => {
    const { state, Bot, from } = millPosition();
    const findings = collectFindings(
      geometry,
      rules,
      state,
      Bot,
      DEFAULT_FINDINGS_CAPS,
      playLayout,
    );
    expect(findings.some((f) => f.kind === 'close_path' && f.from === from)).toBe(true);
    expect(findings.some((f) => f.kind === 'approach_spawner' && f.from === from)).toBe(false);
  });

  it('WHEN chooseTurnBeam plans the generated opening after one 0-share home mill close (territory > 3, trail empty, groups on home), the first departing step shall strictly reduce grain distance to campaignTarget or land on a shortest grain path to it.', () => {
    const { state, me } = afterFirstHomeMillClose();
    const expected = specCampaignTarget(state, me);
    expect(expected).toBeDefined();
    if (expected === undefined) return;
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(planDepartsTerritory(state, plan, me)).toBe(true);
    let at = state;
    for (const move of plan) {
      if (move.kind === 'step' && at.territory.get(move.exit) !== me) {
        expect(stepTowardVertex(move.from, move.exit, expected)).toBe(true);
        return;
      }
      at = rules.apply(at, move);
    }
    throw new Error('no departing step');
  }, 30_000);

  it('WHEN a quiet board offers a 1-turn 0-share dirt close and a 3-turn walk that would border one unowned share of campaignTarget, chooseTurnBeam shall not terminate on the dirt close.', () => {
    const pos = quietDirtVsCampaignWalkPosition();
    const terminal = foldPlan(
      pos.state,
      chooseTurnBeam(geometry, rules, pos.state, pos.Bot),
    );
    expect(isQuietDirtCloseComplete(pos.state, terminal, pos.Bot, pos.campaign)).toBe(false);
  }, 30_000);

  it('The system shall not store campaignTarget on GameState.', () => {
    expect(gameStateSource()).not.toMatch(/campaignTarget/);
    expect(botCloseSource()).not.toMatch(/state\.campaignTarget/);
  });

  it('The system shall export BotDrive / BOT_DRIVE with every weight equal to 1.', () => {
    expect(BOT_DRIVE).toEqual({
      shareLoot: 1,
      arrowLoot: 1,
      campaignPull: 1,
      bankUnderFire: 1,
    });
  });

  it('The system shall not use Date, Math.random, performance.now, or an elapsed-time cutoff in campaignTarget.', () => {
    const src = sourceWithoutComments(botCloseSource());
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
    expect(src).not.toContain('new Date');
  });

  it("Shuffling state.groups / state.spawners / state.territory insertion order shall not change campaignTarget or chooseTurnBeam's plan on a constructed campaign position.", () => {
    const { state, Bot } = contestedVsMonopolisedPosition();
    const shuffled = shuffleCloseMaps(state);
    expect(campaignTarget(geometry, state, Bot)).toBe(campaignTarget(geometry, shuffled, Bot));
    expect(chooseTurnBeam(geometry, rules, state, Bot)).toEqual(
      chooseTurnBeam(geometry, rules, shuffled, Bot),
    );
  });
});
