/**
 * docs/spec/mission-and-staging/mission-and-staging.core.feature
 * One it() per Gherkin scenario. Adapter seam — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import { exposure } from '../src/botClose';
import {
  KITE_RATIO,
  missionsOf,
  type MissionKind,
} from '../src/botMission';
import { chooseTurnBeam, chooseTurnGreedy, isShuttle } from '../src/botSearch';
import {
  afterFirstHomeMillClose,
  foldPlan,
  geometry,
  heuristicTurnStarts,
  loadBaselineLog,
  planDepartsTerritory,
  planIsLegalSequence,
  planTerminates,
  rules,
  strideTwoStackPosition,
  trailSizeOf,
} from './bot-turn-search.support';
import { quietDirtVsCampaignWalkPosition, isQuietDirtCloseComplete } from './close-and-spawner-value.support';
import {
  boxOpenExitPosition,
  contestAdvancing,
  cutVsDirtPosition,
  enemyTrailSize,
  firstDepartingStep,
  originFindingsOf,
  specIsSidewaysDirt,
  specIsThreatenedKite,
  specStagingShape,
  specMissionsOf,
  specMissionContext,
  specRemainingPath,
  stagingVsThreatenedKitePosition,
  stepTowardVertex,
  unthreatenedShareWalkPosition,
  afterOpeningOpenTrailUnderFire,
} from './mission-and-staging.support';

describe('Mission and staging — search only the job, paint only as a step', () => {
  it('Generated opening after a 0-share home close lists contest and still leaves toward V', () => {
    expect(KITE_RATIO).toBe(2);
    const { state, me } = afterFirstHomeMillClose();
    expect(trailSizeOf(state, me)).toBe(0);
    expect(exposure(geometry, rules, state, me)).toBe(0);
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(planDepartsTerritory(state, plan, me)).toBe(true);
    const campaign = specMissionContext(state, me).campaign;
    expect(campaign).toBeDefined();
    const departing = firstDepartingStep(state, plan, me);
    expect(departing).toBeDefined();
    if (departing === undefined || campaign === undefined) return;
    expect(stepTowardVertex(departing.from, departing.exit, campaign)).toBe(true);
    const findings = originFindingsOf(state, me);
    expect(specMissionsOf(state, me, findings)).toEqual(['contest']);
    expect(missionsOf(geometry, rules, state, me, findings)).toEqual(['contest']);
  }, 30_000);

  it('Quiet 1-turn 0-share loop that does not drop remainingPath loses to a walk toward V', () => {
    const pos = quietDirtVsCampaignWalkPosition();
    const plan = chooseTurnBeam(geometry, rules, pos.state, pos.Bot);
    const terminal = foldPlan(pos.state, plan);
    expect(isQuietDirtCloseComplete(pos.state, terminal, pos.Bot, pos.campaign)).toBe(false);
    const ctx = specMissionContext(pos.state, pos.Bot);
    const returned: { moves: typeof plan; state: typeof terminal } = { moves: plan, state: terminal };
    if (contestAdvancing(ctx, returned) || specStagingShape(ctx, returned)) {
      expect(specIsSidewaysDirt(ctx, returned)).toBe(false);
    }
  }, 30_000);

  it('Staging close beats a threatened kite', () => {
    const pos = stagingVsThreatenedKitePosition();
    expect(pos.outbound).toBeGreaterThanOrEqual(1);
    expect(specStagingShape(pos.ctx, pos.staging)).toBe(true);
    expect(specIsThreatenedKite(pos.ctx, pos.kite)).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, pos.state, pos.Bot);
    const terminal = foldPlan(pos.state, plan);
    const returned = { moves: plan, state: terminal };
    expect(specStagingShape(pos.ctx, returned)).toBe(true);
    expect(specIsThreatenedKite(pos.ctx, returned)).toBe(false);
  }, 30_000);

  it('Unthreatened share walk may take the kite', () => {
    const pos = unthreatenedShareWalkPosition();
    const plan = chooseTurnBeam(geometry, rules, pos.state, pos.Bot);
    expect(planIsLegalSequence(pos.state, plan)).toBe(true);
    expect(planTerminates(pos.state, plan)).toBe(true);
    const terminal = foldPlan(pos.state, plan);
    const returned = { moves: plan, state: terminal };
    expect(specIsThreatenedKite(pos.ctx, returned)).toBe(false);
    const toward =
      specStagingShape(pos.ctx, returned) ||
      contestAdvancing(pos.ctx, returned) ||
      specRemainingPath(terminal, pos.Bot, pos.campaign) <= pos.outbound;
    expect(toward).toBe(true);
  }, 30_000);

  it('Under fire the menu starts with bank and a 1-turn land-bridge is allowed', () => {
    const { state, me } = afterOpeningOpenTrailUnderFire();
    expect(trailSizeOf(state, me)).toBeGreaterThan(0);
    expect(exposure(geometry, rules, state, me)).toBeGreaterThan(0);
    const plan = chooseTurnBeam(geometry, rules, state, me);
    const terminal = foldPlan(state, plan);
    const trailShrunk = trailSizeOf(terminal, me) < trailSizeOf(state, me);
    const exposureDropped =
      trailSizeOf(state, me) > 0 &&
      exposure(geometry, rules, terminal, me) < exposure(geometry, rules, state, me);
    expect(trailShrunk || exposureDropped).toBe(true);
    const findings = originFindingsOf(state, me);
    const menu = missionsOf(geometry, rules, state, me, findings);
    expect(menu[0]).toBe('bank');
    expect(menu.includes('contest')).toBe(false);
    expect(specMissionsOf(state, me, findings)[0]).toBe('bank');
  }, 30_000);

  it('A legal cut beats sideways dirt on a quiet board', () => {
    const pos = cutVsDirtPosition();
    expect(exposure(geometry, rules, pos.state, pos.Bot)).toBe(0);
    expect(trailSizeOf(pos.state, pos.Bot)).toBe(0);
    const findings = originFindingsOf(pos.state, pos.Bot);
    expect(specMissionsOf(pos.state, pos.Bot, findings).includes('cut')).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, pos.state, pos.Bot);
    const terminal = foldPlan(pos.state, plan);
    expect(enemyTrailSize(terminal, pos.Bot)).toBeLessThan(enemyTrailSize(pos.state, pos.Bot));
    const returned = { moves: plan, state: terminal };
    expect(specIsSidewaysDirt(pos.ctx, returned)).toBe(false);
    expect(missionsOf(geometry, rules, pos.state, pos.Bot, findings).includes('cut')).toBe(true);
  }, 30_000);

  it("Deny occupies the boxed enemy's open exit", () => {
    const { state, Bot, openExit } = boxOpenExitPosition();
    expect(exposure(geometry, rules, state, Bot)).toBe(0);
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    expect(plan.some((m) => m.kind === 'step' && m.exit === openExit)).toBe(true);
    const findings = originFindingsOf(state, Bot);
    const expected = specMissionsOf(state, Bot, findings);
    expect(expected.includes('deny')).toBe(true);
    expect(expected.includes('bank')).toBe(false);
    const menu: readonly MissionKind[] = missionsOf(geometry, rules, state, Bot, findings);
    expect(menu.includes('deny')).toBe(true);
    expect(menu.includes('bank')).toBe(false);
  });

  it('chooseTurnBeam twice on equal inputs returns byte-identical plans', () => {
    const { state, Bot } = strideTwoStackPosition();
    expect(state.activePlayer).toBe(Bot);
    const a = chooseTurnBeam(geometry, rules, state, Bot);
    const b = chooseTurnBeam(geometry, rules, state, Bot);
    expect(a).toEqual(b);
  });

  it('P53 stride construction still strides and shuttle rate still holds', () => {
    const { state, Bot, from, first, second } = strideTwoStackPosition();
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    const steps = plan.filter((m) => m.kind === 'step');
    expect(steps[0]).toMatchObject({ from, exit: first, count: 2 });
    expect(steps[1]).toMatchObject({ from: first, exit: second, count: 2 });
    expect(isShuttle(plan)).toBe(false);
    const starts = heuristicTurnStarts(loadBaselineLog());
    expect(starts.length).toBeGreaterThan(0);
    let beamShuttle = 0;
    let greedyShuttle = 0;
    let beamGt1 = 0;
    let beamSteps = 0;
    let greedyGt1 = 0;
    let greedySteps = 0;
    for (const { state: at, me } of starts) {
      const beam = chooseTurnBeam(geometry, rules, at, me);
      const greedy = chooseTurnGreedy(geometry, rules, at, me);
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
    expect(beamShuttle / starts.length).toBeLessThan(0.1);
    expect(beamGt1 / beamSteps).toBeGreaterThan(greedyGt1 / greedySteps);
  }, 120_000);
});
