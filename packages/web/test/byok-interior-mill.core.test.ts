/**
 * docs/spec/byok-interior-mill/byok-interior-mill.core.feature
 * One it() per Gherkin scenario. Adapter only — observed as offer text.
 *
 * Board: `spacious` with every arrow but 0>1 as A's territory. Edge distances
 * there (oracle-checked in each test): 1>4 = 2, 4>0 = 1, 4>5 = 3, 7>3 = 2,
 * 3>6 = 2, 3>0 = 1.
 */

import { describe, expect, it } from 'vitest';
import { buildUserPrompt, millOmit } from '../src/byokBot';
import {
  A,
  BASELINE,
  allArrows,
  edgeDistOracle,
  isOwn,
  offerOf,
  rowFor,
  rowsOf,
  sp,
  spacious,
  spaciousInterior,
  stateOf,
  tagRowsOf,
  tiling,
} from './byok-interior-mill.support';
import { corpusPosition } from '../bench/src/corpus';

describe('P80 byok-interior-mill core', () => {
  describe('Rule: Own-territory rows carry edgeDist and to_edge', () => {
    it('A stack two arrows inside territory gets edgeDist=2→1 and to_edge on the approaching step', () => {
      const a0 = sp('1', '4');
      const a1 = sp('4', '0');
      const state = spaciousInterior([{ arrow: a0, heads: 1 }]);
      expect(edgeDistOracle(spacious.geometry, state, A, a0)).toBe(2);
      expect(edgeDistOracle(spacious.geometry, state, A, a1)).toBe(1);

      const row = rowFor(rowsOf(spacious, state), a0, a1);
      expect(row.line).toContain('edgeDist=2→1');
      expect(row.line).not.toContain('tipDist=');
      expect(row.tags).toContain('to_edge');
      expect(row.tags).toContain('onto_home');
      expect(row.tags).not.toContain('home_mill');
    });

    it('A sideways interior step keeps home_mill', () => {
      const a0 = sp('7', '3');
      const a2 = sp('3', '6');
      const state = spaciousInterior([{ arrow: a0, heads: 1 }]);
      expect(edgeDistOracle(spacious.geometry, state, A, a0)).toBe(2);
      expect(edgeDistOracle(spacious.geometry, state, A, a2)).toBe(2);

      const row = rowFor(rowsOf(spacious, state), a0, a2);
      expect(row.line).toContain('edgeDist=2→2');
      expect(row.tags).toContain('home_mill');
      expect(row.tags).toContain('onto_home');
      expect(row.tags).not.toContain('to_edge');
    });
  });

  describe('Rule: millOmit follows the tag', () => {
    it('With every row home_mill or to_edge, the baseline suggestion is printed', () => {
      // 1>4's exits: 4>5 (3, deeper), 4>2 (3, deeper), 4>0 (1, toward the edge).
      const state = spaciousInterior([{ arrow: sp('1', '4'), heads: 2 }]);
      const rows = rowsOf(spacious, state);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(isOwn(state, A, row.from)).toBe(true);
        expect(isOwn(state, A, row.exit)).toBe(true);
      }
      expect(rows.some((row) => row.tags.includes('to_edge'))).toBe(true);

      expect(millOmit(tagRowsOf(rows))).toBe(false);
      const prompt = buildUserPrompt(
        spacious.geometry,
        state,
        A,
        offerOf(spacious, state),
        true,
        spacious.rules,
      );
      expect(prompt).toContain(BASELINE);
    });

    it('With every row home_mill, millOmit stays true', () => {
      // The whole board is A's: no edge within reach, every row is 17→17.
      const territory = allArrows(spacious);
      const state = stateOf(territory, [{ arrow: sp('1', '4'), heads: 2 }]);
      const rows = rowsOf(spacious, state);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.tags).toContain('home_mill');
        expect(row.tags).not.toContain('to_edge');
      }

      expect(millOmit(tagRowsOf(rows))).toBe(true);
      const prompt = buildUserPrompt(
        spacious.geometry,
        state,
        A,
        offerOf(spacious, state),
        true,
        spacious.rules,
      );
      expect(prompt).not.toContain(BASELINE);
    });
  });

  describe('Rule: The archived stall', () => {
    it('The archived position re-rendered offers a to_edge row and the baseline', () => {
      const { state, seat } = corpusPosition('grok-2026-09-10T0657', 56);
      const prompt = buildUserPrompt(
        tiling.geometry,
        state,
        seat,
        tiling.rules.legalMoves(state),
        true,
        tiling.rules,
      );
      const rowLines = prompt.split('\n').filter((line) => /^\[\d+\] step /.test(line));
      expect(rowLines.length).toBeGreaterThan(0);

      expect(rowLines.some((line) => /\btags=\S*\bto_edge\b/.test(line))).toBe(true);
      for (const line of rowLines) {
        const from = /\bfrom=(\S+)/.exec(line)?.[1] ?? '';
        if (isOwn(state, seat, from)) expect(line).toContain('edgeDist=');
      }
      expect(prompt).toContain(BASELINE);
    });
  });
});
