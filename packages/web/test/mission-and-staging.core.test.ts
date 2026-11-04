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
  isHomeMillCloseTerminal,
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
  planEndsWithEndTurn,
  specHasLumpReady,
  specIsSidewaysDirt,
  specIsThreatenedKite,
  specStagingShape,
  specMissionsOf,
  specMissionContext,
  specProjectedTrail,
  specRemainingPath,
  stagingVsThreatenedKitePosition,
  type StagingKiteBoard,
  stepTowardVertex,
  threeSeatQuietHomeAfterFirstClose,
  unthreatenedShareWalkPosition,
  afterOpeningOpenTrailUnderFire,
} from './mission-and-staging.support';
import {
  creditInapplicable,
  specSafeWindow,
  specSortieCredit,
  specThreatL,
  withCreditBlocker,
  withLongTrail,
} from './heuristic-tempo-horizon.support';

/** The staging and kite plans on the P59 board each take three steps. */
const STAGING_KITE_PLIES = 3;

/**
 * The P59 staging-vs-kite board with one enemy group added (P85 decision 12)
 * so the sortie credit is inapplicable for STAGING_KITE_PLIES steps. The
 * context, outbound and both plans are recomputed on the new state.
 */
const stagingVsThreatenedKiteCreditBlocked = (): StagingKiteBoard => {
  const base = stagingVsThreatenedKitePosition();
  const home = base.staging.moves.find((m) => m.kind === 'step')?.from;
  if (home === undefined) throw new Error('setup: staging plan has no step');
  const state = withCreditBlocker(base.state, base.Bot, home, STAGING_KITE_PLIES);
  const ctx = specMissionContext(state, base.Bot);
  return {
    ...base,
    state,
    ctx,
    outbound: specRemainingPath(state, base.Bot, base.campaign),
    staging: { moves: base.staging.moves, state: foldPlan(state, base.staging.moves) },
    kite: { moves: base.kite.moves, state: foldPlan(state, base.kite.moves) },
  };
};

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

  // Rewritten for P85 (docs/spec/heuristic-tempo-horizon, decision 12):
  // specIsThreatenedKite follows decision 3b (W over the projected trail ≤
  // the terminal's turns to land), so "threatened" is that premise here. On
  // the original board a safe sortie earns credit and wins (see the twin
  // below), so an enemy group is added that makes the sortie credit
  // inapplicable for the plan's three steps; P59's staging choice is what is
  // tested.
  it('Staging close beats a threatened kite', () => {
    const pos = stagingVsThreatenedKiteCreditBlocked();
    expect(creditInapplicable(pos.state, pos.Bot, STAGING_KITE_PLIES)).toBe(true);
    expect(pos.outbound).toBeGreaterThanOrEqual(1);
    expect(specStagingShape(pos.ctx, pos.staging)).toBe(true);
    expect(specIsThreatenedKite(pos.ctx, pos.kite)).toBe(true);
    const kiteL = specThreatL(pos.kite.state, pos.Bot);
    expect(
      specSafeWindow(pos.kite.state, pos.Bot, specProjectedTrail(pos.ctx, pos.kite), Math.min(kiteL, 8)),
    ).toBeLessThanOrEqual(kiteL);
    const plan = chooseTurnBeam(geometry, rules, pos.state, pos.Bot);
    const terminal = foldPlan(pos.state, plan);
    const returned = { moves: plan, state: terminal };
    expect(specStagingShape(pos.ctx, returned)).toBe(true);
    expect(specIsThreatenedKite(pos.ctx, returned)).toBe(false);
  }, 60_000);

  // P85 (decision 12): on the original staging-vs-kite board a third plan, a
  // safe sortie, earns sortie credit and out-ranks staging. The seat takes
  // it, and it is not a threatened kite.
  it('P85: on the staging-vs-kite board the seat takes the safe credited sortie', () => {
    const pos = stagingVsThreatenedKitePosition();
    expect(specIsThreatenedKite(pos.ctx, pos.kite)).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, pos.state, pos.Bot);
    expect(planIsLegalSequence(pos.state, plan)).toBe(true);
    expect(planTerminates(pos.state, plan)).toBe(true);
    const terminal = foldPlan(pos.state, plan);
    const returned = { moves: plan, state: terminal };
    expect(specIsThreatenedKite(pos.ctx, returned)).toBe(false);
    expect(specSortieCredit(terminal, pos.Bot)).toBeGreaterThan(0);
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

  // P85 (decision 12): the position is now replayed from a recorded move
  // list (fixtures/three-seat-quiet-home.moves.json), not reached by self-play.
  it('3-seat quiet-home leftover after the first close still leaves', () => {
    const { state, A } = threeSeatQuietHomeAfterFirstClose();
    expect(state.activePlayer).toBe(A);
    expect(trailSizeOf(state, A)).toBe(0);
    expect(specHasLumpReady(state, A)).toBe(true);
    const plan = chooseTurnBeam(geometry, rules, state, A);
    expect(plan.some((m) => m.kind === 'step'), `A r3 plan was ${JSON.stringify(plan)}`).toBe(
      true,
    );
    expect(planDepartsTerritory(state, plan, A)).toBe(true);
    expect(isHomeMillCloseTerminal(state, foldPlan(state, plan), A)).toBe(false);
    expect(planIsLegalSequence(state, plan)).toBe(true);
    expect(planEndsWithEndTurn(plan)).toBe(true);
    expect(planTerminates(state, plan)).toBe(true);
    const again = chooseTurnBeam(geometry, rules, state, A);
    expect(again).toEqual(plan);
  }, 240_000);

  // Rewritten for P85 (docs/spec/heuristic-tempo-horizon, decision 12): the
  // stride board's trail is lengthened so elapsed + L exceeds
  // SORTIE_TOTAL_CAP and the sortie credit is inapplicable.
  it('P53 stride construction still strides and shuttle rate still holds', () => {
    const pos = strideTwoStackPosition();
    const { Bot, from, first, second } = pos;
    const state = withLongTrail(pos.state, Bot, from, 2);
    expect(creditInapplicable(state, Bot, 2)).toBe(true);
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
