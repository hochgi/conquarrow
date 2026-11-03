/**
 * Edge scenarios for docs/spec/heuristic-never-idle/heuristic-never-idle.edge-cases.feature
 * (P84 — which stepping plan replaces a pass, the starved beam, the nested
 * search, determinism).
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import { isDominant, stagingWalk } from '../src/botFinish';
import { neverIdle, type NeverIdleComplete, type NeverIdleSearch } from '../src/botNeverIdle';
import { hypothesiseChair } from '../src/botReply';
import {
  BEAM,
  BRANCH,
  chooseTurnBeam,
  chooseTurnBeamWithBudget,
  evaluate,
  IDLE_SLACK,
  MAX_APPLIES,
  MAX_PLAN,
  MOBILITY_SCALE,
  planKey,
  SORTIE_SLACK,
} from '../src/botSearch';
import { chooseMove } from '../src/opponent';
import {
  botNeverIdleSource,
  botSearchSource,
  boxedAfterOccupy,
  foldPlan,
  geometry,
  hasStep,
  IDLE_SLACK_MOVE,
  KITE_GATE_MOVE,
  legalSteps,
  MIRROR_S3_PASS_TURNS,
  mirrorS3,
  passIsBestPosition,
  passTurnAt,
  passWithManyStepsPosition,
  planIsLegalSequence,
  planTerminates,
  playtest,
  rules,
  seatOf,
  sourceWithoutComments,
  specIsThreatenedKite,
  specMissionContext,
  specOwnStacksAllSingle,
  stateAt,
  stepIsLegal,
  threatenedKiteNoStagingPosition,
} from './heuristic-never-idle.support';

const SEARCH_TIMEOUT = 120_000;

describe('heuristic-never-idle edge cases', () => {
  describe('Rule: Each cause the diagnosis found is covered', () => {
    it(
      'The IDLE_SLACK cause with many legal steps',
      () => {
        const { state, Bot } = passWithManyStepsPosition();
        expect(specOwnStacksAllSingle(state, Bot)).toBe(true);
        expect([...state.groups.values()].filter((g) => g.owner === Bot)).toHaveLength(3);
        expect(legalSteps(state).length).toBeGreaterThan(BRANCH);
        const passEv = evaluate(geometry, rules.apply(state, endTurn()), Bot, rules);
        const bestStep = Math.max(
          ...legalSteps(state).map((m) => evaluate(geometry, rules.apply(state, m), Bot, rules)),
        );
        expect(passEv - bestStep).toBeGreaterThan(IDLE_SLACK);

        const plan = chooseTurnBeam(geometry, rules, state, Bot);

        expect(hasStep(plan)).toBe(true);
        expect(planIsLegalSequence(state, plan)).toBe(true);
        expect(planTerminates(state, plan)).toBe(true);
      },
      SEARCH_TIMEOUT,
    );

    it(
      'The kite-gate cause where a non-kite stepping complete exists',
      () => {
        const { state, me } = passTurnAt(playtest(), KITE_GATE_MOVE, 'A', 6);
        const ctx = specMissionContext(state, me);
        expect(ctx.missions).toEqual(['contest']);

        const plan = chooseTurnBeam(geometry, rules, state, me);

        expect(hasStep(plan)).toBe(true);
        expect(specIsThreatenedKite(ctx, { moves: plan, state: foldPlan(state, plan) })).toBe(false);
      },
      SEARCH_TIMEOUT,
    );

    it(
      'The kite-gate cause where every contest plan is a threatened kite and no staging close exists',
      () => {
        // threatenedKiteNoStagingPosition throws `setup:` unless its premises hold.
        const { state, Bot } = threatenedKiteNoStagingPosition().onlyKites;
        expect(state.activePlayer).toBe(Bot);
        expect(stepIsLegal(state)).toBe(true);

        const plan = chooseTurnBeam(geometry, rules, state, Bot);

        expect(hasStep(plan)).toBe(true);
        expect(planIsLegalSequence(state, plan)).toBe(true);
        expect(planTerminates(state, plan)).toBe(true);
      },
      SEARCH_TIMEOUT,
    );

    it.each(MIRROR_S3_PASS_TURNS)(
      'A dominant seat with no staging walk steps instead of passing (round $round, move $index)',
      ({ round, index }) => {
        const { state, me } = passTurnAt(mirrorS3(), index, 'A', round);
        expect(isDominant(state, me)).toBe(true);
        expect(stagingWalk(geometry, rules, state, me)).toBeUndefined();

        const plan = chooseTurnBeam(geometry, rules, state, me);

        expect(hasStep(plan)).toBe(true);
        expect(planIsLegalSequence(state, plan)).toBe(true);
        expect(planTerminates(state, plan)).toBe(true);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: The starved beam falls back to chooseMove', () => {
    it(
      'The beam keeps no stepping complete',
      () => {
        const { state, me } = passTurnAt(playtest(), KITE_GATE_MOVE, 'A', 6);
        // Not dominant: no carve seeds a complete and no staging walk replaces
        // the pass, so with maxApplies 0 the search keeps no stepping complete.
        expect(isDominant(state, me)).toBe(false);
        const expected = chooseMove(geometry, rules, state, me);
        expect(expected.kind).toBe('step');

        const plan = chooseTurnBeamWithBudget(geometry, rules, state, me, {
          withReplies: true,
          maxApplies: 0,
        });

        expect(plan[0]).toEqual(expected);
        expect(planIsLegalSequence(state, plan)).toBe(true);
        expect(planTerminates(state, plan)).toBe(true);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: The nested search keeps P53 and P59 as they were', () => {
    it('The nested reply search may still pass with a step legal', () => {
      const { state, Bot } = passIsBestPosition();
      expect(stepIsLegal(state)).toBe(true);

      const plan = chooseTurnBeamWithBudget(geometry, rules, state, Bot, { withReplies: false });

      expect(plan).toEqual([{ kind: 'endTurn' }]);
    });

    it('A boxed enemy with no legal step still passes in the nested search', () => {
      const { state, E } = boxedAfterOccupy();
      const chair = hypothesiseChair(state, E);
      expect(stepIsLegal(chair)).toBe(false);

      const plan = chooseTurnBeamWithBudget(geometry, rules, chair, E, { withReplies: false });

      expect(plan).toEqual([{ kind: 'endTurn' }]);
    });
  });

  describe('Rule: No game rule and no new constant', () => {
    it('The tuning constants are unchanged', () => {
      expect(IDLE_SLACK).toBe(MOBILITY_SCALE);
      expect(SORTIE_SLACK).toBe(MOBILITY_SCALE);
      expect({ BEAM, BRANCH, MAX_PLAN, MAX_APPLIES }).toEqual({
        BEAM: 8,
        BRANCH: 6,
        MAX_PLAN: 8,
        MAX_APPLIES: 2000,
      });
    });

    it('The guard lives in its own module and botSearch only calls it', () => {
      const guard = sourceWithoutComments(botNeverIdleSource());
      const search = sourceWithoutComments(botSearchSource());
      expect(guard).toMatch(/export const neverIdle\b/);
      for (const src of [guard, search]) {
        expect(src).not.toMatch(/\bDate\b/);
        expect(src).not.toContain('Math.random');
        expect(src).not.toContain('performance.now');
      }
      expect(search).toMatch(/import\s*\{[^}]*\bneverIdle\b[^}]*\}\s*from\s*'\.\/botNeverIdle'/);
    });
  });

  describe('Rule: Determinism', () => {
    it.each([{ index: KITE_GATE_MOVE }, { index: IDLE_SLACK_MOVE }])(
      'The same position gives the same plan twice (move $index)',
      ({ index }) => {
        const state = stateAt(playtest(), index);
        const me = state.activePlayer;
        expect([seatOf(state, 'A'), seatOf(state, 'B')]).toContain(me);

        const first = chooseTurnBeam(geometry, rules, state, me);
        const second = chooseTurnBeam(geometry, rules, state, me);

        expect(second).toEqual(first);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe("Rule: Decision 3's order picks the replacement", () => {
    // Direct calls on neverIdle with stubbed readings, so the order is pinned
    // independently of what the real search happens to keep.
    type Reading = { readonly score: number; readonly kite: boolean; readonly kiteLength: number };
    type Fixture = {
      readonly plans: readonly NeverIdleComplete[];
      readonly search: (completes: readonly NeverIdleComplete[]) => NeverIdleSearch<NeverIdleComplete>;
    };
    const nth = <T,>(items: readonly T[], index: number): T => {
      const item = items[index];
      if (item === undefined) throw new Error(`setup: no item ${String(index)}`);
      return item;
    };
    const setup = (readings: readonly Reading[]): Fixture => {
      const { state, Bot } = passIsBestPosition();
      const steps = legalSteps(state);
      const read = new Map<NeverIdleComplete, Reading>();
      const plans = readings.map((reading, i) => {
        const plan: NeverIdleComplete = { moves: [nth(steps, i), endTurn()], state };
        read.set(plan, reading);
        return plan;
      });
      const at = (complete: NeverIdleComplete): Reading => {
        const reading = read.get(complete);
        if (reading === undefined) throw new Error('setup: unread complete');
        return reading;
      };
      return {
        plans,
        search: (completes) => ({
          geometry,
          rules,
          origin: state,
          me: Bot,
          completes,
          score: (c) => at(c).score,
          isThreatenedKite: (c) => at(c).kite,
          kiteLength: (c) => at(c).kiteLength,
          planKey,
          chooseMove,
        }),
      };
    };
    const smallerKey = (plans: readonly NeverIdleComplete[]): NeverIdleComplete =>
      plans.reduce((a, b) => (planKey(b.moves) < planKey(a.moves) ? b : a));
    const pass = [endTurn()];

    it('The best-scoring stepping complete that is not a threatened kite wins, in any input order', () => {
      const { search, plans } = setup([
        { score: 1, kite: false, kiteLength: 0 },
        { score: 5, kite: false, kiteLength: 0 },
        { score: 3, kite: false, kiteLength: 0 },
      ]);
      const best = nth(plans, 1).moves;
      expect(neverIdle(search(plans), pass)).toEqual(best);
      expect(neverIdle(search([...plans].reverse()), pass)).toEqual(best);
    });

    it('A score tie goes to the smaller planKey', () => {
      const { search, plans } = setup([
        { score: 2, kite: false, kiteLength: 0 },
        { score: 2, kite: false, kiteLength: 0 },
      ]);
      const smaller = smallerKey(plans).moves;
      expect(neverIdle(search(plans), pass)).toEqual(smaller);
      expect(neverIdle(search([...plans].reverse()), pass)).toEqual(smaller);
    });

    it('A stepping complete that is not a threatened kite beats a better-scoring threatened kite', () => {
      const { search, plans } = setup([
        { score: 9, kite: true, kiteLength: 1 },
        { score: 1, kite: false, kiteLength: 4 },
      ]);
      expect(neverIdle(search(plans), pass)).toEqual(nth(plans, 1).moves);
    });

    it('When every stepping complete is a threatened kite, the least kiteLength wins, then the smaller planKey', () => {
      const least = setup([
        { score: 9, kite: true, kiteLength: 5 },
        { score: 1, kite: true, kiteLength: 2 },
        { score: 5, kite: true, kiteLength: 3 },
      ]);
      expect(neverIdle(least.search(least.plans), pass)).toEqual(nth(least.plans, 1).moves);

      const tied = setup([
        { score: 9, kite: true, kiteLength: 2 },
        { score: 1, kite: true, kiteLength: 2 },
      ]);
      const smaller = smallerKey(tied.plans).moves;
      expect(neverIdle(tied.search(tied.plans), pass)).toEqual(smaller);
      expect(neverIdle(tied.search([...tied.plans].reverse()), pass)).toEqual(smaller);
    });

    it("With no stepping complete, chooseMove's move is played and the turn is ended", () => {
      const { search } = setup([]);
      const { state, Bot } = passIsBestPosition();
      const idle: NeverIdleComplete = { moves: pass, state };
      expect(neverIdle(search([idle]), pass)).toEqual([chooseMove(geometry, rules, state, Bot), endTurn()]);
    });

    it('A chosen plan that already steps is returned unchanged', () => {
      const { search, plans } = setup([
        { score: 1, kite: false, kiteLength: 0 },
        { score: 5, kite: false, kiteLength: 0 },
      ]);
      const chosen = nth(plans, 0).moves;
      expect(neverIdle(search(plans), chosen)).toBe(chosen);
    });
  });
});
