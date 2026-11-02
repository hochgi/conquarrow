/**
 * docs/spec/byok-opening-horizon/byok-opening-horizon.core.feature
 * One it() per Gherkin scenario. Adapter only — observed as offer text.
 *
 * The bench scenario of this feature ("A benched match records each BYOK
 * turn's plan and why") lives with the bench: packages/web/bench/test/
 * byok-turns.core.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  A,
  closingTip,
  findLadderStep,
  ifHomeOracle,
  landOf,
  noTerritoryState,
  parseRow,
  promptOf,
  rowOf,
  sharesOf,
  SP_TIP,
  sp,
  spacious,
  stateWith,
  step,
  tiling,
  tipEntryFor,
  walkMoves,
} from './byok-opening-horizon.support';

describe('P83 byok-opening-horizon core', () => {
  describe('Rule: homeIn counts this portion\'s turns', () => {
    it('A trail row prints homeIn in turns of the portion', () => {
      // 3 heads, spent 1: spd 2, L0 1, L1 0, v 2 — ⌈6 / 2⌉ = 3.
      const found = findLadderStep(
        [{ heads: 3, spent: 1, count: 3 }],
        (f) => !f.exitOwn && f.dExit === 6,
        'd(a1) = 6',
      );
      expect(found.facts.after).toBe(3);

      const line = rowOf(tiling, found.state, found.move);
      expect(line, 'setup: the step is illegal').not.toContain('tags=illegal');
      expect(line).toContain('tipDist=');
      expect(line).toContain(' homeIn=3 ');
      expect(line).toMatch(/ tipDist=\S+ homeIn=3 trailLen=/);
    });

    it('A row whose remaining walk this turn reaches home prints homeIn=0', () => {
      // 3 heads, spent 0: L1 = 1 ≥ d(a1) = 1.
      const found = findLadderStep(
        [{ heads: 3, count: 3 }],
        (f) => !f.exitOwn && f.dExit === 1,
        'd(a1) = 1',
      );
      const line = rowOf(tiling, found.state, found.move);
      expect(line, 'setup: the step is illegal').not.toContain('tags=illegal');
      expect(parseRow(line).homeIn).toBe('0');
    });

    it('A row that lands on own territory has no homeIn', () => {
      // spacious: A holds 1>4; the 3-stack on trail arrow 0>1 steps onto it.
      const home = sp('1', '4');
      const state = stateWith({ territory: [home], trail: [SP_TIP], stacks: [{ arrow: SP_TIP, heads: 3 }] });
      const line = rowOf(spacious, state, step(SP_TIP, home, 3));
      expect(line, 'setup: the step is illegal').not.toContain('tags=illegal');
      expect(parseRow(line).tags, 'setup: the row does not land').toContain('onto_home');
      // Non-vacuity: a sibling row off territory from the same stack does print it.
      const sibling = rowOf(spacious, state, step(SP_TIP, sp('1', '2'), 3));
      expect(sibling).toContain('homeIn=');

      expect(line).not.toContain('homeIn=');
      expect(parseRow(line).tags).not.toContain('leaves_horizon');
    });
  });

  describe('Rule: leaves_horizon marks the crossing step', () => {
    it('The step that takes homeIn from 2 to 3 is tagged leaves_horizon', () => {
      const found = findLadderStep(
        [{ heads: 1, count: 1 }, { heads: 3, count: 3 }],
        (f) => !f.exitOwn && f.before === 2 && f.after === 3,
        'homeIn 2 → 3',
      );
      const line = rowOf(tiling, found.state, found.move);
      expect(line, 'setup: the step is illegal').not.toContain('tags=illegal');
      expect(parseRow(line).homeIn).toBe('3');
      expect(parseRow(line).tags).toContain('leaves_horizon');
    });
  });

  describe('Rule: The sentinel is not a number', () => {
    it('A row beyond the distance cap prints none', () => {
      // spacious with no A territory: every distance is capped; no id holds "17".
      const state = noTerritoryState(spacious);
      const line = rowOf(spacious, state, step(SP_TIP, sp('1', '2'), 3));
      expect(line, 'setup: the step is illegal').not.toContain('tags=illegal');

      expect(line).toContain('tipDist=none→none');
      expect(line).toContain('homeIn=none');
      expect(line).not.toContain('17');
    });
  });

  describe('Rule: The tips line shows the nearest close', () => {
    it('An exposed tip shows homeIn and the claim of the shortest walk home', () => {
      const fixture = closingTip();
      const { state, tip } = fixture;
      const claim = ifHomeOracle(tiling, state, A, tip);
      if (claim === undefined) throw new Error('setup: the closing tip has no way home');
      expect(claim.shares, 'setup: the walk claims no spawner border').toBeGreaterThan(0);

      const entry = tipEntryFor(promptOf(tiling, state), tip);
      expect(entry).toContain('homeIn=');
      expect(entry).toContain(`ifHome=+${String(claim.land)} share+${String(claim.shares)}`);
      expect(entry).toContain('heads=3');

      // Playing that walk out with apply gains A exactly L territory and S shares.
      let at = state;
      for (const move of walkMoves(fixture, 3)) at = tiling.rules.apply(at, move);
      expect(landOf(at, A) - landOf(state, A)).toBe(claim.land);
      expect(sharesOf(tiling.geometry, at, A) - sharesOf(tiling.geometry, state, A)).toBe(claim.shares);
    });
  });
});
