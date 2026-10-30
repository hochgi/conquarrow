/**
 * docs/spec/byok-interior-mill/byok-interior-mill.edge-cases.feature
 * One it() per Gherkin scenario. Adapter only — observed as offer text.
 */

import { describe, expect, it } from 'vitest';
import { buildUserPrompt } from '../src/byokBot';
import { readTeachingFile } from './byok-teaching-prompt.support';
import {
  A,
  SP_EDGE,
  edgeDistOracle,
  legalMovesText,
  minimal,
  offTerritoryCase,
  offerOf,
  rowFor,
  rowsOf,
  sp,
  spacious,
  spaciousInterior,
  starState,
  tiling,
  withoutIds,
} from './byok-interior-mill.support';

/** Pre-P80 text of every row from the trail arrow 0>1, written from main at 9d7af96. */
const PRE_P80_OFF_TERRITORY_ROWS = [
  '[0] step from=fixtures:spacious:a:0-1 exit=fixtures:spacious:a:1-2 count=1 leave=1 spd=1 spent=0 left=1 tipDist=1→1 trailLen=2',
  '[1] step from=fixtures:spacious:a:0-1 exit=fixtures:spacious:a:1-2 count=2 spd=2 spent=0 left=2 tipDist=1→1 trailLen=2',
  '[2] step from=fixtures:spacious:a:0-1 exit=fixtures:spacious:a:1-4 count=1 leave=1 spd=1 spent=0 left=1 tipDist=1→0 trailLen=0 tags=closes,homeward,onto_home',
  '[3] step from=fixtures:spacious:a:0-1 exit=fixtures:spacious:a:1-4 count=2 spd=2 spent=0 left=2 tipDist=1→0 trailLen=0 tags=closes,homeward,onto_home',
  '[4] step from=fixtures:spacious:a:0-1 exit=fixtures:spacious:a:1-6 count=1 leave=1 spd=1 spent=0 left=1 tipDist=1→0 trailLen=0 tags=closes,homeward,onto_home',
  '[5] step from=fixtures:spacious:a:0-1 exit=fixtures:spacious:a:1-6 count=2 spd=2 spent=0 left=2 tipDist=1→0 trailLen=0 tags=closes,homeward,onto_home',
] as const;

const TO_EDGE_SENTENCE =
  'Crossing your own territory toward its edge (`to_edge`) is how an interior stack gets back to work; it is not a mill.';

describe('P80 byok-interior-mill edge cases', () => {
  describe('Rule: Narrowed home_mill', () => {
    it('A step moving deeper inside keeps home_mill', () => {
      const a0 = sp('1', '4');
      const a3 = sp('4', '5');
      const state = spaciousInterior([{ arrow: a0, heads: 1 }]);
      const a = edgeDistOracle(spacious.geometry, state, A, a0);
      const b = edgeDistOracle(spacious.geometry, state, A, a3);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(b).toBeGreaterThan(a);

      const row = rowFor(rowsOf(spacious, state), a0, a3);
      expect(row.edgeDist).toEqual([a, b]);
      expect(row.tags).toContain('home_mill');
      expect(row.tags).not.toContain('to_edge');
    });

    it('A step from territory onto non-territory keeps leave_home and is not to_edge', () => {
      const a0 = sp('3', '0');
      const state = spaciousInterior([{ arrow: a0, heads: 1 }]);

      const row = rowFor(rowsOf(spacious, state), a0, SP_EDGE);
      expect(row.line).toContain('edgeDist=1→0');
      expect(row.line).not.toContain('tipDist=');
      expect(row.tags).toContain('leave_home');
      expect(row.tags).toContain('outward');
      expect(row.tags).not.toContain('to_edge');
      expect(row.tags).not.toContain('home_mill');
    });
  });

  describe('Rule: Rows off territory are unchanged', () => {
    it('Rows whose from is not own territory print tipDist exactly as before', () => {
      const { board, state, me } = offTerritoryCase();
      const rows = rowsOf(board, state, me);
      expect(rows.length).toBe(PRE_P80_OFF_TERRITORY_ROWS.length);
      for (const row of rows) {
        expect(row.line).toContain('tipDist=');
        expect(row.line).not.toContain('edgeDist=');
        expect(row.tags).not.toContain('to_edge');
      }
      expect(rows.map((row) => row.line)).toEqual([...PRE_P80_OFF_TERRITORY_ROWS]);
    });

    it('The exposed-tips header still prints tipDist', () => {
      const { board, state, me } = offTerritoryCase();
      const prompt = buildUserPrompt(board.geometry, state, me, offerOf(board, state), true, board.rules);
      const tips = prompt.split('\n').find((line) => line.startsWith('Exposed tips:'));
      expect(tips).toBeDefined();
      expect(tips).toContain('tipDist=');
      expect(tips).not.toContain('edgeDist=');
    });
  });

  describe('Rule: Determinism', () => {
    it('Both geometry implementations produce identical offer text', () => {
      // Arrow ids are minted per geometry, so the comparison is id-free; every
      // other byte of every row must agree, on each board and on a second call.
      const tilingText = legalMovesText(tiling, starState(tiling, 'inside'));
      expect(tilingText).toContain('edgeDist=2→1');
      expect(tilingText).toContain('to_edge');

      const texts = [tiling, spacious, minimal].flatMap((board) => {
        const state = starState(board, 'inside');
        return [legalMovesText(board, state), legalMovesText(board, state)];
      });
      for (const [i, text] of texts.entries()) {
        const first = texts[i - (i % 2)];
        expect(text).toBe(first);
        expect(withoutIds(text)).toBe(withoutIds(tilingText));
      }
    });
  });

  describe('Rule: Teaching', () => {
    it('The teaching file scopes the mill sentence and names to_edge once', () => {
      const teaching = readTeachingFile();
      expect(teaching).toContain('home_mill with empty trail and no expansion is wasted tempo');
      expect(teaching).not.toContain('home_mill / onto_home with empty trail');
      expect(teaching.match(/to_edge/g) ?? []).toHaveLength(1);
      expect(teaching).toContain(TO_EDGE_SENTENCE);
    });
  });
});
