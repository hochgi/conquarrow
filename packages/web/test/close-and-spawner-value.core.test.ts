/**
 * docs/spec/close-and-spawner-value/close-and-spawner-value.core.feature
 * One it() per Gherkin scenario. Adapter seam — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import {
  ARROW_VALUE_A,
  SHARE_VALUE_S,
  closeValue,
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
  homewardClosePathPosition,
  millPosition,
} from './close-and-spawner-value.support';
import { foldPlan, geometry, rules } from './bot-turn-search.support';

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
});
