/**
 * docs/spec/byok-opening-horizon/byok-opening-horizon.edge-cases.feature
 * One it() per Gherkin scenario (one per Examples row for an Outline).
 * Adapter only — observed as offer text.
 *
 * The two bench scenarios of this feature ("An unusable reply adds no entry…",
 * "Recorded texts are one line and capped") live with the bench:
 * packages/web/bench/test/byok-turns.edge-cases.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { corpusPosition, positionId } from '../bench/src/corpus';
import {
  A,
  NO_TIPS,
  PORTIONS,
  SP_TIP,
  crosses,
  dOracle,
  findLadderStep,
  golden,
  idFreeOffer,
  ladderArrows,
  ladderD,
  minimal,
  noTerritoryState,
  offerLines,
  parseRow,
  promptOf,
  ringState,
  rowOf,
  spacious,
  sp,
  stateWith,
  tiling,
  tipEntryFor,
  tipsLine,
  turnsHome,
  withoutP83,
} from './byok-opening-horizon.support';
import type { HomeIn, Turns } from './byok-opening-horizon.support';
import { speed } from '@conquarrow/contracts';

const legalRow = (line: string): string => {
  expect(line, 'setup: the step is illegal').not.toContain('tags=illegal');
  return line;
};

describe('P83 byok-opening-horizon edge cases', () => {
  describe('Rule: Speed and count', () => {
    const examples: readonly { count: number; d: number; homeIn: string }[] = [
      { count: 1, d: 4, homeIn: '4' },
      { count: 3, d: 4, homeIn: '2' },
      { count: 3, d: 1, homeIn: '0' },
    ];
    it.each(examples)(
      'The same exit prints homeIn by the portion\'s speed — count=$count d=$d → homeIn=$homeIn',
      ({ count, d, homeIn }) => {
        const found = findLadderStep(
          [{ heads: 3, count }],
          (f) => !f.exitOwn && f.dExit === d,
          `3-stack, count ${String(count)}, d(a1) = ${String(d)}`,
        );
        expect(found.facts.spent).toBe(0);
        const line = legalRow(rowOf(tiling, found.state, found.move));
        expect(parseRow(line).homeIn).toBe(homeIn);
      },
    );

    it('The same exit, both counts: one stack and one exit, count 1 and count 3 differ as the outline says', () => {
      // The two d=4 examples on literally the same a0 → a1.
      const found = findLadderStep([{ heads: 3, count: 3 }], (f) => !f.exitOwn && f.dExit === 4, 'd(a1) = 4');
      const one = legalRow(rowOf(tiling, found.state, { ...found.move, count: 1 }));
      const three = legalRow(rowOf(tiling, found.state, found.move));
      expect(parseRow(one).homeIn).toBe('4');
      expect(parseRow(three).homeIn).toBe('2');
    });

    it('A merge-override portion uses its override this turn and speed(count) later', () => {
      // spd 1 (override), L1 0, v = speed(4) = 3 — ⌈4 / 3⌉ = 2.
      const found = findLadderStep(
        [{ heads: 4, speedOverride: 1, count: 4 }],
        (f) => !f.exitOwn && f.dExit === 4,
        'override 1, d(a1) = 4',
      );
      expect(found.facts.spd).toBe(1);
      expect(found.facts.v).toBe(speed(4));
      const line = legalRow(rowOf(tiling, found.state, found.move));
      expect(line).toContain('spd=1');
      expect(line).toContain(' homeIn=2 ');
    });

    it('A leave_home row gets homeIn after its edgeDist slot', () => {
      const found = findLadderStep(
        [{ heads: 3, count: 3 }],
        (f) => !f.exitOwn && f.dFrom === 0 && f.dExit === 3,
        '3-stack on own territory, d(a1) = 3',
        true,
      );
      const line = legalRow(rowOf(tiling, found.state, found.move));
      expect(parseRow(line).tags).toContain('leave_home');
      expect(line).toMatch(/ edgeDist=\S+ homeIn=\S+ trailLen=/);
      // spd 2, L1 1, v 2 — ⌈(3 − 1) / 2⌉ = 1.
      expect(parseRow(line).homeIn).toBe('1');
    });
  });

  describe('Rule: Only the crossing step is tagged', () => {
    const examples: readonly { before: Turns; after: Turns; verdict: 'contain' | 'do not contain' }[] = [
      { before: 2, after: 3, verdict: 'contain' },
      { before: 0, after: 'none', verdict: 'contain' },
      { before: 3, after: 4, verdict: 'do not contain' },
      { before: 2, after: 2, verdict: 'do not contain' },
    ];
    it.each(examples)(
      'leaves_horizon fires on 2 to 3 only — $before → $after: tags $verdict leaves_horizon',
      ({ before, after, verdict }) => {
        const found = findLadderStep(
          PORTIONS,
          (f) => !f.exitOwn && f.before === before && f.after === after,
          `homeIn ${String(before)} → ${String(after)}`,
        );
        const line = legalRow(rowOf(tiling, found.state, found.move));
        expect(parseRow(line).homeIn).toBe(String(after));
        if (verdict === 'contain') expect(parseRow(line).tags).toContain('leaves_horizon');
        else expect(parseRow(line).tags).not.toContain('leaves_horizon');
      },
    );

    /**
     * Examples row `| 3 | 2 | do not contain |` cannot be instantiated: a step
     * spends one of this turn's steps (L1 = L0 − 1) and moves at most one grain
     * step closer (d(from) ≤ d(exit) + 1), so d(exit) − L1 ≥ d(from) − L0 and a
     * numeric homeIn never falls. Reported to phase 1. What this test pins
     * instead: (1) no ladder step realises a numeric fall; (2) the one fall that
     * does occur — `none` before, a number after, at the cap — is printed and
     * is not tagged.
     */
    it('leaves_horizon fires on 2 to 3 only — 3 → 2: a falling homeIn is not tagged', () => {
      let checked = 0;
      for (const a0 of ladderArrows) {
        const dFrom = ladderD(a0);
        for (const exit of tiling.geometry.outArrows(tiling.geometry.target(a0))) {
          const dExit = ladderD(exit);
          for (const p of PORTIONS.slice(0, 4)) {
            const spd = p.speedOverride ?? speed(p.count);
            const left = spd - (p.spent ?? 0);
            const b = turnsHome(dFrom, left, speed(p.count));
            const a = turnsHome(dExit, left - 1, speed(p.count));
            if (b === 'none' || a === 'none') continue;
            checked += 1;
            expect(a, `${String(a0)} → ${String(exit)}`).toBeGreaterThanOrEqual(b);
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);

      const fall = findLadderStep(
        [{ heads: 1, count: 1 }],
        (f: HomeIn) => !f.exitOwn && f.before === 'none' && f.after !== 'none',
        'homeIn none → number',
      );
      const line = legalRow(rowOf(tiling, fall.state, fall.move));
      expect(parseRow(line).homeIn).toBe(String(fall.facts.after));
      expect(crosses(fall.facts.before, fall.facts.after)).toBe(false);
      expect(parseRow(line).tags).not.toContain('leaves_horizon');
    });
  });

  describe('Rule: The sentinel and the tips line', () => {
    it('A tip beyond the cap prints none and no ifHome', () => {
      const state = noTerritoryState(spacious);
      expect(dOracle(spacious.geometry, state, A, SP_TIP)).toBe('none');
      const entry = tipEntryFor(promptOf(spacious, state), SP_TIP);
      expect(entry).toContain('tipDist=none homeIn=none');
      expect(entry).not.toContain('ifHome=');
    });

    it('With no exposed tip the tips line is unchanged', () => {
      // A's 3-stack stands on its own territory: no stack on its trail.
      const home = sp('0', '1');
      const state = stateWith({ territory: [home], stacks: [{ arrow: home, heads: 3 }] });
      expect(tipsLine(promptOf(spacious, state))).toBe(NO_TIPS);
    });
  });

  describe('Rule: Nothing else moves', () => {
    it('Existing tags are unchanged', () => {
      const log = 'grok-2026-09-10T1442';
      const moveIndex = 34;
      const id = positionId(log, moveIndex);
      const { state, seat } = corpusPosition(log, moveIndex);
      const before = golden().offerRows[id];
      if (before === undefined) throw new Error(`setup: golden has no ${id}`);

      const after = offerLines(tiling, state, seat).map(({ line }) => line);
      expect(after.some((line) => line.includes('homeIn=')), 'the P83 tokens are not on the offer').toBe(true);
      expect(after.map(withoutP83)).toEqual(before);
    });

    it('Both geometry ports give identical offer text', () => {
      const reference = idFreeOffer(tiling, ringState(tiling).state);
      expect(reference.some((line) => line.includes('homeIn=')), 'no homeIn= on the reference offer').toBe(true);
      for (const board of [tiling, spacious, minimal]) {
        const { state, tip } = ringState(board);
        // Setup: "with matching distances" — the tip is 2 from home and every exit 1, on every board.
        expect(dOracle(board.geometry, state, A, tip), board.name).toBe(2);
        for (const exit of board.geometry.outArrows(board.geometry.target(tip))) {
          expect(dOracle(board.geometry, state, A, exit), `${board.name} ${String(exit)}`).toBe(1);
        }
        expect(idFreeOffer(board, state), board.name).toEqual(reference);
      }
    });
  });
});
