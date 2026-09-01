/**
 * docs/spec/close-and-spawner-value/close-and-spawner-value.core.feature
 * One it() per Gherkin scenario. Adapter seam — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import type { StepMove } from '@conquarrow/contracts';
import {
  ARROW_VALUE_A,
  SHARE_VALUE_S,
  campaignTarget,
  closeValue,
  gatedCloseValue,
  preferClose,
  shareTerm,
} from '../src/botClose';
import { chooseTurnBeam, isShuttle } from '../src/botSearch';
import { distanceToTerritory } from '../src/botEvaluate';
import { collectFindings, DEFAULT_FINDINGS_CAPS } from '../src/findings';
import { playBotTurn } from '../src/opponent';
import { playLayout } from '../src/playLayout';
import {
  DIST_CAP,
  approachCampaignVsNearerSpawnerPosition,
  contestedVsMonopolisedPosition,
  homewardClosePathPosition,
  isQuietDirtCloseComplete,
  millPosition,
  quietDirtVsCampaignWalkPosition,
  specCampaignTarget,
  stepTowardVertex,
} from './close-and-spawner-value.support';
import {
  afterFirstHomeMillClose,
  foldPlan,
  geometry,
  planDepartsTerritory,
  rules,
  sharesOf,
  trailSizeOf,
} from './bot-turn-search.support';

describe('Closing and spawner value — walk home at a rate', () => {
  it('A 2-turn one-share close beats a 6-turn two-share close', () => {
    expect(SHARE_VALUE_S).toBe(100);
    expect(ARROW_VALUE_A).toBe(25);
    expect(closeValue(1, 3, 2, 0)).toBe(87.5);
    expect(closeValue(2, 3, 6, 0)).toBe(62.5);
    expect(closeValue(1, 3, 2, 0)).toBeGreaterThan(closeValue(2, 3, 6, 0));
    expect(
      preferClose(
        { shares: 1, arrows: 3, turnsToClose: 2, exposure: 0 },
        { shares: 2, arrows: 3, turnsToClose: 6, exposure: 0 },
      ),
    ).toBeLessThan(0);
  });

  it('A 3-turn two-share close beats a 2-turn one-share close', () => {
    expect(closeValue(1, 3, 2, 0)).toBe(87.5);
    expect(closeValue(2, 3, 3, 0)).toBe(125);
    expect(closeValue(2, 3, 3, 0)).toBeGreaterThan(closeValue(1, 3, 2, 0));
    expect(
      preferClose(
        { shares: 2, arrows: 3, turnsToClose: 3, exposure: 0 },
        { shares: 1, arrows: 3, turnsToClose: 2, exposure: 0 },
      ),
    ).toBeLessThan(0);
  });

  it('Three shares in one closure beat three one-share closures', () => {
    expect(shareTerm(3)).toBe(600);
    expect(shareTerm(1)).toBe(100);
    expect(shareTerm(3)).toBeGreaterThan(3 * shareTerm(1));
    const oneClosure = closeValue(3, 9, 2, 0);
    const threeSeparates = 3 * closeValue(1, 3, 2, 0);
    expect(oneClosure).toBeGreaterThan(threeSeparates);
  });

  it('A trail tip emits close_path toward own territory', () => {
    const { state, Bot, from } = homewardClosePathPosition();
    const d0 = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
    expect(d0).toBeGreaterThanOrEqual(1);
    expect(d0).toBeLessThanOrEqual(DIST_CAP);
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
    const d1 = distanceToTerritory(geometry, state, Bot, hit.move.exit, DIST_CAP);
    expect(d1).toBeLessThan(d0);
    expect(state.territory.get(hit.goal)).toBe(Bot);
  });

  it('beam-v1 takes the homeward close_path', () => {
    const { state, Bot, from } = homewardClosePathPosition();
    const findings = collectFindings(
      geometry,
      rules,
      state,
      Bot,
      DEFAULT_FINDINGS_CAPS,
      playLayout,
    );
    expect(findings.some((f) => f.kind === 'claim_share' || f.kind === 'cut')).toBe(false);
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    let at = state;
    let tip = from;
    let reached = false;
    for (const move of plan) {
      if (move.kind === 'step' && move.from === tip) tip = move.exit;
      at = rules.apply(at, move);
      if (distanceToTerritory(geometry, at, Bot, tip, DIST_CAP) === 0) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
    expect(isShuttle(plan)).toBe(false);
    const folded = foldPlan(state, plan);
    expect(folded.winner !== undefined || folded.activePlayer !== Bot).toBe(true);
  });

  it('A group standing on an open share emits close_path not approach', () => {
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

  it('beam-v1 banks the share instead of hopping to a sibling', () => {
    const { state, Bot, from, sibling } = millPosition();
    const d0 = distanceToTerritory(geometry, state, Bot, from, DIST_CAP);
    const plan = chooseTurnBeam(geometry, rules, state, Bot);
    const first = plan.find((m) => m.kind === 'step' && m.from === from);
    expect(first).toBeDefined();
    if (first === undefined || first.kind !== 'step') return;
    expect(first.exit).not.toBe(sibling);
    expect(distanceToTerritory(geometry, state, Bot, first.exit, DIST_CAP)).toBeLessThan(d0);
  });

  it('playBotTurn still plans with beam-v1', () => {
    const { state, Bot } = homewardClosePathPosition();
    const planned = playBotTurn(geometry, rules, state, Bot);
    expect(planned.moves).toEqual(chooseTurnBeam(geometry, rules, state, Bot));
  });

  it('campaignTarget prefers a contested vertex over a monopolised nearer one', () => {
    const { state, Bot, monopolised, contested } = contestedVsMonopolisedPosition();
    const result = campaignTarget(geometry, state, Bot);
    expect(result).toBe(contested);
    expect(result).not.toBe(monopolised);
    expect(specCampaignTarget(state, Bot)).toBe(contested);
  });

  it('After a 0-share home close the departing exit walks toward campaignTarget', () => {
    const { state, me } = afterFirstHomeMillClose();
    const expected = specCampaignTarget(state, me);
    expect(expected).toBeDefined();
    if (expected === undefined) return;
    const plan = chooseTurnBeam(geometry, rules, state, me);
    expect(planDepartsTerritory(state, plan, me)).toBe(true);
    let at = state;
    let first: StepMove | undefined;
    for (const move of plan) {
      if (move.kind === 'step' && at.territory.get(move.exit) !== me) {
        first = move;
        break;
      }
      at = rules.apply(at, move);
    }
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(stepTowardVertex(first.from, first.exit, expected)).toBe(true);
    expect(campaignTarget(geometry, state, me)).toBe(expected);
  }, 30_000);

  it('On a quiet board a 1-turn dirt close loses to a 3-turn campaign-share walk', () => {
    const pos = quietDirtVsCampaignWalkPosition();
    expect(pos.campaignTurns).toBe(3);
    expect(pos.dirtArrows).toBeGreaterThan(0);
    const plan = chooseTurnBeam(geometry, rules, pos.state, pos.Bot);
    const terminal = foldPlan(pos.state, plan);
    expect(isQuietDirtCloseComplete(pos.state, terminal, pos.Bot, pos.campaign)).toBe(false);
    const closedDirt =
      trailSizeOf(terminal, pos.Bot) === 0 &&
      sharesOf(terminal, pos.Bot) === sharesOf(pos.state, pos.Bot);
    expect(closedDirt).toBe(false);
  }, 30_000);

  it('Under fire the 1-turn empty loop is the P54 corridor again', () => {
    const pos = quietDirtVsCampaignWalkPosition();
    const e = 2;
    expect(e).toBeGreaterThan(0);
    const flags = { hitsCampaign: false, advancesCampaign: false } as const;
    const gated = gatedCloseValue(0, pos.dirtArrows, 1, e, flags);
    expect(
      preferClose(
        {
          shares: 0,
          arrows: pos.dirtArrows,
          turnsToClose: 1,
          exposure: e,
          hitsCampaign: false,
          advancesCampaign: false,
        },
        {
          shares: 1,
          arrows: 3,
          turnsToClose: 3,
          exposure: e,
          hitsCampaign: true,
          advancesCampaign: false,
        },
      ),
    ).toBeLessThan(0);
    expect(gated).toBe(closeValue(0, pos.dirtArrows, 1, e));
    expect(gated).not.toBe(0);
  });

  it('approach_spawner ranks departing exits toward campaignTarget', () => {
    const pos = approachCampaignVsNearerSpawnerPosition();
    const findings = collectFindings(
      geometry,
      rules,
      pos.state,
      pos.Bot,
      { maxFindings: 32, distCap: DIST_CAP },
      playLayout,
    );
    const campaignBorders = geometry.borderArrows(pos.campaign);
    const approaches = findings.filter((f) => f.kind === 'approach_spawner');
    expect(approaches.length).toBeGreaterThan(0);
    expect(approaches.some((f) => campaignBorders.includes(f.goal))).toBe(true);
    const firstApproach = findings.find((f) => f.kind === 'approach_spawner');
    expect(firstApproach).toBeDefined();
    if (firstApproach === undefined) return;
    expect(campaignBorders.includes(firstApproach.goal)).toBe(true);
    expect(geometry.borderArrows(pos.nearer).includes(firstApproach.goal)).toBe(false);
  });
});
