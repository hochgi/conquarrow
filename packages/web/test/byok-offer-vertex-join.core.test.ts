/**
 * docs/spec/byok-offer-vertex-join/byok-offer-vertex-join.core.feature
 * One it() per Gherkin scenario. Adapter only — observed as offer text.
 *
 * Fixture scenarios use `spacious`: `a1` is its lowest arrow, `v1` the lower of
 * the two vertices it flanks, and `a1 → x → y → a1` the 3-cycle bounding `v1`
 * (so a stack on `y` steps onto `a1`). The closing row uses the tiling.
 */

import { describe, expect, it } from 'vitest';
import { compareArrows } from '@conquarrow/rules-core';
import { buildSystemPrompt, buildUserPrompt, threatLineFromCounts } from '../src/byokBot';
import { corpusPosition } from '../bench/src/corpus';
import {
  A,
  LEGEND_PREFIX,
  LEGEND_SENTENCE,
  QUARTER,
  THIRD,
  advancesCount,
  allArrows,
  allPositions,
  clausesOf,
  cycleOf,
  feederOf,
  flanksSorted,
  isReWalk,
  offerLines,
  rowOf,
  spacious,
  stateOf,
  step,
  tagsOf,
  tiling,
} from './byok-offer-vertex-join.support';
import type { Board } from './byok-offer-vertex-join.support';
import type { ArrowId, GameState, StepMove } from '@conquarrow/contracts';

const lowest = (board: Board): ArrowId => {
  const a = allArrows(board).toSorted(compareArrows)[0];
  if (a === undefined) throw new Error(`setup: ${board.name} has no arrows`);
  return a;
};

const a1 = lowest(spacious);
const v1 = flanksSorted(spacious.geometry, a1)[0];
if (v1 === undefined) throw new Error('setup: a1 flanks no vertex');
const { x, y } = cycleOf(spacious.geometry, a1, v1);

const isLegal = (board: Board, state: GameState, move: StepMove): boolean =>
  board.rules
    .legalMoves(state)
    .some((m) => m.kind === 'step' && m.from === move.from && m.exit === move.exit && m.count === move.count);

/** The row for `move`, after checking the setup offers it and it applies. */
const legalRow = (board: Board, state: GameState, move: StepMove): string => {
  expect(isLegal(board, state, move), 'setup: the step is not on the offer').toBe(true);
  const row = rowOf(board, state, move);
  expect(row, 'setup: apply rejected the step').not.toContain('tags=illegal');
  return row;
};

describe('P75 byok-offer-vertex-join core', () => {
  describe('Rule: A step onto a new arrow names every flanked spawner', () => {
    it('A step onto an arrow flanking one spawner emits one advances= clause', () => {
      const state = stateOf({ territory: [[y, A]], stack: y, spawners: [[v1, QUARTER]] });
      expect(isReWalk(state, A, a1)).toBe(false);
      const flanked = spacious.geometry.flankVertices(a1).filter((v) => state.spawners.has(v));
      expect(flanked).toEqual([v1]);

      const row = legalRow(spacious, state, step(y, a1));
      expect(advancesCount(row)).toBe(1);
      expect(clausesOf(row).map((c) => c.text)).toEqual([`advances=${String(v1)} 1/3→2/3 force=1/4`]);
      expect(row).toMatch(/ trailLen=\d+ advances=\S+ 1\/3→2\/3 force=1\/4 tags=/);
      expect(tagsOf(row)).not.toContain('double_fed');
    });

    it('A step onto a double-fed arrow emits two clauses and double_fed', () => {
      const [first, second] = flanksSorted(spacious.geometry, a1);
      if (first === undefined || second === undefined) throw new Error('setup: a1 flanks fewer than 2');
      const z = feederOf(spacious.geometry, a1, [first, second]);
      const state = stateOf({
        territory: [[z, A]],
        stack: z,
        spawners: [
          [second, QUARTER],
          [first, THIRD],
        ],
      });
      expect(isReWalk(state, A, a1)).toBe(false);

      const row = legalRow(spacious, state, step(z, a1));
      expect(clausesOf(row).map((c) => c.text)).toEqual([
        `advances=${String(first)} 0/3→1/3 force=1/3`,
        `advances=${String(second)} 0/3→1/3 force=1/4`,
      ]);
      expect(tagsOf(row)).toContain('double_fed');
    });

    it('A step onto an arrow flanking no spawner emits neither', () => {
      const state = stateOf({ territory: [[y, A]], stack: y, spawners: [[v1, QUARTER]] });
      const a3 = spacious.geometry
        .outArrows(spacious.geometry.target(y))
        .find((exit) => !spacious.geometry.flankVertices(exit).some((v) => state.spawners.has(v)));
      if (a3 === undefined) throw new Error('setup: every exit from y flanks a spawner');

      const row = legalRow(spacious, state, step(y, a3));
      expect(advancesCount(row)).toBe(0);
      expect(tagsOf(row)).not.toContain('double_fed');
      expect(tagsOf(row)).not.toContain('completes_spawner');
    });
  });

  describe('Rule: Re-walking an arrow already held advances nothing', () => {
    it('The 2026-09-10T1442 cycle position emits no advances= on its trail arrows', () => {
      const { state, seat } = corpusPosition('grok-2026-09-10T1442', 34);
      expect(String(seat)).toBe('B');
      const lines = offerLines(tiling, state, seat);
      const openSpawner = (exit: ArrowId): boolean =>
        tiling.geometry
          .flankVertices(exit)
          .some(
            (v) =>
              state.spawners.has(v) &&
              tiling.geometry.borderArrows(v).some((b) => state.territory.get(b) === undefined),
          );
      const cycleRows = lines.filter(
        ({ move }) => (state.trails.get(seat)?.has(move.exit) ?? false) && openSpawner(move.exit),
      );
      expect(cycleRows.length, 'setup: #34 has no trail row bordering an open spawner').toBeGreaterThan(0);

      for (const { line } of cycleRows) expect(advancesCount(line), line).toBe(0);
      for (const { line } of lines) expect(line).not.toContain('borders_spawner');
    });
  });

  describe('Rule: Completion is called out', () => {
    it('Walking the third arrow of a vertex emits completes_spawner', () => {
      const state = stateOf({
        territory: [
          [x, A],
          [y, A],
        ],
        stack: y,
        spawners: [[v1, QUARTER]],
      });
      expect(isReWalk(state, A, a1)).toBe(false);

      const row = legalRow(spacious, state, step(y, a1));
      expect(row).toContain(`advances=${String(v1)} 2/3→3/3`);
      expect(tagsOf(row)).toContain('completes_spawner');
      expect(tagsOf(row).some((tag) => tag.startsWith('share+'))).toBe(false);
    });

    it('A closing row that completes a vertex emits share+N and completes_spawner', () => {
      const t = closingOnTiling();
      const row = legalRow(tiling, t.state, t.close);
      const tags = tagsOf(row);
      expect(tags).toContain('closes');
      expect(tags).toContain('share+1');
      expect(tags).toContain('completes_spawner');
    });
  });

  describe('Rule: The prompt carries the new vocabulary and not the old', () => {
    it('borders_spawner no longer appears in the offer or the prompt', () => {
      const positions = allPositions().filter((_, i) => i % 10 === 0);
      expect(positions.length).toBeGreaterThan(10);
      for (const position of positions) {
        const { state, seat } = position;
        for (const reasoning of [true, false]) {
          expect(buildSystemPrompt(seat, reasoning)).not.toContain('borders_spawner');
        }
        const user = buildUserPrompt(
          tiling.geometry,
          state,
          seat,
          tiling.rules.legalMoves(state),
          true,
          tiling.rules,
        );
        expect(user).not.toContain('borders_spawner');
        const legend = user.split('\n').find((line) => line.startsWith(LEGEND_PREFIX));
        expect(legend, 'no LEGAL_MOVES legend line').toBeDefined();
        expect(legend).toContain(LEGEND_SENTENCE);
      }
    });

    it('The threat header names completes_spawner', () => {
      const t = closingOnTiling();
      const offer = t.board.rules.legalMoves(t.state);
      const prompt = buildUserPrompt(t.board.geometry, t.state, A, offer, true, t.board.rules);
      const rows = offerLines(t.board, t.state, A);
      expect(rows.some(({ line }) => tagsOf(line).includes('closes')), 'setup: no closes row').toBe(true);
      expect(rows.some(({ line }) => tagsOf(line).includes('completes_spawner')), 'no completes_spawner row').toBe(
        true,
      );
      expect(prompt).toContain('Offer tags: closes, completes_spawner');

      const line = threatLineFromCounts({
        me: 'A',
        players: ['A', 'B'],
        shares: { A: 2, B: 0 },
        territory: { A: 2, B: 0 },
        trailLen: { A: 2, B: 0 },
        offerTags: ['completes_spawner', 'double_fed', 'closes'],
        nearTrail: false,
      });
      expect(line).toContain('Offer tags: closes, completes_spawner.');
      expect(line).not.toContain('double_fed');
    });
  });
});

/**
 * Tiling: `a1` the seed point's lowest out-arrow, `v1` its lower flanked vertex,
 * cycle `a1 → x → y`. A holds `x` and `y`; A's trail is `p → a1` with `p` a
 * feeder of `a1` off `v1`; the stack on `a1` steps onto `x`. The claim takes
 * `p` and `a1`, so the row `closes`, and `a1` is `v1`'s last border: 2/3 → 3/3.
 * `v1` is the only spawner, so `share+N` counts exactly that border.
 */
function closingOnTiling(): { board: Board; state: GameState; close: StepMove } {
  const g = tiling.geometry;
  const t1 = [...g.outArrows(g.seedPoint())].toSorted(compareArrows)[0];
  if (t1 === undefined) throw new Error('setup: no out-arrow at the seed');
  const tv = flanksSorted(g, t1)[0];
  if (tv === undefined) throw new Error('setup: t1 flanks no vertex');
  const cycle = cycleOf(g, t1, tv);
  const p = feederOf(g, t1, [tv]);
  const state = stateOf({
    territory: [
      [cycle.x, A],
      [cycle.y, A],
    ],
    trail: [p, t1],
    stack: t1,
    spawners: [[tv, QUARTER]],
  });
  return { board: tiling, state, close: step(t1, cycle.x) };
}
