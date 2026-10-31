/**
 * docs/spec/byok-offer-vertex-join/byok-offer-vertex-join.edge-cases.feature
 * One it() per Gherkin scenario. Adapter only — observed as offer text.
 *
 * Fixture scenarios use `spacious` exactly as the core file does: `a1` its
 * lowest arrow, `v1` the lower vertex it flanks, `a1 → x → y → a1` the cycle
 * bounding `v1`, and `z` a feeder of `a1` that borders neither flanked vertex.
 */

import { describe, expect, it } from 'vitest';
import { compareArrows, compareVertices } from '@conquarrow/rules-core';
import type { ArrowId, GameState, Move, StepMove } from '@conquarrow/contracts';
import { buildUserPrompt, formatLegalMoves, snapshotForPrompt } from '../src/byokBot';
import { corpusPosition } from '../bench/src/corpus';
import { reinserted } from './byok-interior-mill.support';
import {
  A,
  B,
  BUDGET_CEILING,
  BUDGET_POSITION,
  QUARTER,
  THIRD,
  advancesCount,
  allArrows,
  allPositions,
  asSnapRows,
  clausesOf,
  cycleOf,
  dropTags,
  feederOf,
  flanksSorted,
  flanksSpawner,
  golden,
  grokPositions,
  idOf,
  isIncident,
  isInteresting,
  isReWalk,
  minimal,
  offerLines,
  rowOf,
  spacious,
  stateOf,
  step,
  tagsOf,
  tiling,
  withoutIds,
} from './byok-offer-vertex-join.support';
import type { Board } from './byok-offer-vertex-join.support';

const a1 = allArrows(spacious).toSorted(compareArrows)[0];
if (a1 === undefined) throw new Error('setup: spacious has no arrows');
const [v1, w1] = flanksSorted(spacious.geometry, a1);
if (v1 === undefined || w1 === undefined) throw new Error('setup: a1 flanks fewer than 2 vertices');
const { x, y } = cycleOf(spacious.geometry, a1, v1);
const z = feederOf(spacious.geometry, a1, [v1, w1]);

const isLegal = (board: Board, state: GameState, move: StepMove): boolean =>
  board.rules
    .legalMoves(state)
    .some((m) => m.kind === 'step' && m.from === move.from && m.exit === move.exit && m.count === move.count);

const legalRow = (board: Board, state: GameState, move: StepMove): string => {
  expect(isLegal(board, state, move), 'setup: the step is not on the offer').toBe(true);
  const row = rowOf(board, state, move);
  expect(row, 'setup: apply rejected the step').not.toContain('tags=illegal');
  return row;
};

const clauseFor = (row: string, vertex: unknown): string | undefined =>
  clausesOf(row).find((c) => c.vertex === String(vertex))?.text;

describe('P75 byok-offer-vertex-join edge cases', () => {
  describe('Rule: Held means territory, read after apply', () => {
    it('A step onto own territory that flanks a spawner emits no advances=', () => {
      // Control: the same spawner, a1 not yet held — the row does advance v1.
      const open = stateOf({ territory: [[y, A]], stack: y, spawners: [[v1, QUARTER]] });
      expect(advancesCount(legalRow(spacious, open, step(y, a1))), 'control row').toBe(1);

      const held = stateOf({
        territory: [
          [y, A],
          [a1, A],
        ],
        stack: y,
        spawners: [[v1, QUARTER]],
      });
      expect(isReWalk(held, A, a1)).toBe(true);
      expect(spacious.geometry.borderArrows(v1).some((b) => held.territory.get(b) === undefined)).toBe(true);
      const row = legalRow(spacious, held, step(y, a1));
      expect(advancesCount(row)).toBe(0);
      expect(tagsOf(row)).not.toContain('double_fed');
      expect(row).not.toContain('borders_spawner');
    });

    it("A's own trail on another border is not a holding", () => {
      const anchor = feederOf(spacious.geometry, y, [v1]);
      const state = stateOf({
        territory: [[anchor, A]],
        trail: [y],
        stack: y,
        spawners: [[v1, QUARTER]],
      });
      expect(state.trails.get(A)?.has(y)).toBe(true);
      expect(isReWalk(state, A, a1)).toBe(false);

      const row = legalRow(spacious, state, step(y, a1));
      expect(clauseFor(row, v1)).toBe(`advances=${String(v1)} 0/3→1/3 force=1/4`);
    });


    it('An arrow flanking a vertex wholly held by an opponent reports that opponent\'s hold', () => {
      const state = stateOf({
        territory: [
          [z, A],
          [a1, B],
          [x, B],
          [y, B],
        ],
        stack: z,
        spawners: [[v1, QUARTER]],
      });
      expect(isReWalk(state, A, a1)).toBe(false);

      const row = legalRow(spacious, state, step(z, a1));
      expect(clauseFor(row, v1)).toBe(`advances=${String(v1)} 0/3→1/3 force=1/4 denies=B:3/3→2/3`);
    });

    it('No denies= on an unowned exit', () => {
      const state = stateOf({
        territory: [
          [z, A],
          [x, B],
          [y, B],
        ],
        stack: z,
        spawners: [[v1, QUARTER]],
      });
      const row = legalRow(spacious, state, step(z, a1));
      expect(clauseFor(row, v1)).toBe(`advances=${String(v1)} 0/3→1/3 force=1/4`);
      expect(row).not.toContain('denies=');
    });
  });

  describe('Rule: Order and identity are deterministic', () => {
    it('Clause order is stable across calls', () => {
      // Fixture boards return flankVertices sorted; the tiling mostly does not.
      const g = tiling.geometry;
      const a2 = g
        .window(g.seedPoint(), 2)
        .arrows.toSorted(compareArrows)
        .find((arrow) => {
          const flank = g.flankVertices(arrow);
          return String(flank) !== String(flanksSorted(g, arrow));
        });
      if (a2 === undefined) throw new Error('setup: no tiling arrow with unsorted flankVertices');
      const [first, second] = flanksSorted(g, a2);
      if (first === undefined || second === undefined) throw new Error('setup: a2 flanks fewer than 2');
      expect(g.flankVertices(a2)).toEqual([second, first]);
      const feeder = feederOf(g, a2, [first, second]);
      const state = stateOf({
        territory: [[feeder, A]],
        stack: feeder,
        spawners: [
          [second, THIRD],
          [first, QUARTER],
        ],
      });

      const once = legalRow(tiling, state, step(feeder, a2));
      expect(rowOf(tiling, state, step(feeder, a2))).toBe(once);
      expect(rowOf(tiling, reinserted(state), step(feeder, a2))).toBe(once);
      const vertices = clausesOf(once).map((c) => c.vertex);
      expect(vertices).toEqual([String(first), String(second)]);
      expect(compareVertices(first, second)).toBeLessThan(0);
    });

    it('Two GeometryPort implementations produce identical offer text', () => {
      const reference = starOffer(tiling);
      expect(reference.some((line) => line.includes('advances=')), 'no advances= row').toBe(true);
      expect(reference.some((line) => tagsOf(line).includes('double_fed')), 'no double_fed row').toBe(true);
      for (const board of [spacious, minimal]) {
        expect(starOffer(board), board.name).toEqual(reference);
      }
    });

    it('A row that flanks no spawner is unchanged except for borders_spawner', () => {
      const before = golden();
      let compared = 0;
      for (const position of grokPositions()) {
        const id = idOf(position);
        const was = before[id];
        if (was === undefined) throw new Error(`setup: golden has no ${id}`);
        const now = offerLines(tiling, position.state, position.seat);
        expect(now.length, id).toBe(was.length);
        for (const [i, { move, line }] of now.entries()) {
          if (flanksSpawner(tiling.geometry, position.state, move.exit)) continue;
          compared += 1;
          // Decision 5/7(b): the only tag P75 may add to such a row is completes_spawner.
          expect(dropTags(line, ['completes_spawner']), id).toBe(was[i]);
        }
      }
      expect(compared).toBeGreaterThan(200);
    });
  });

  describe('Rule: The spawner rows cover every vertex an offer row advances', () => {
    it('The cap never hides an advanced vertex', () => {
      const crowded = allPositions().filter((position) => {
        const offer = tiling.rules.legalMoves(position.state);
        return tierZero(position.state, position.seat, offer).length > 12;
      });
      expect(crowded.length, 'setup: no corpus position with more than 12 tier-0 vertices').toBeGreaterThan(0);

      for (const position of crowded) {
        const { state, seat } = position;
        const offer = tiling.rules.legalMoves(state);
        const snap = asSnapRows(snapshotForPrompt(tiling.geometry, state, seat, offer));
        const listed = new Set(snap.vertices);
        const zero = tierZero(state, seat, offer);
        expect(snap.spawnersShown, idOf(position)).toBe(snap.vertices.length);
        for (const vertex of zero) expect(listed.has(String(vertex)), `${idOf(position)} ${String(vertex)}`).toBe(true);
        // Total ≥ 12 from tier 0 alone: no tier-1 row.
        expect(snap.vertices.length, idOf(position)).toBe(zero.length);

        for (const { line } of offerLines(tiling, state, seat)) {
          for (const clause of clausesOf(line)) {
            const vertex = [...state.spawners.keys()].find((v) => String(v) === clause.vertex);
            if (vertex === undefined) throw new Error(`clause names a non-spawner ${clause.vertex}`);
            if (!isInteresting(tiling.geometry, state, seat, vertex)) continue;
            expect(listed.has(clause.vertex), `${idOf(position)} ${line}`).toBe(true);
          }
        }
      }
    });
  });

  describe('Rule: Budget', () => {
    it('Offer growth on a mid-game position is within 15%', () => {
      const { state, seat } = corpusPosition(BUDGET_POSITION.log, BUDGET_POSITION.moveIndex);
      const user = buildUserPrompt(
        tiling.geometry,
        state,
        seat,
        tiling.rules.legalMoves(state),
        true,
        tiling.rules,
      );
      expect(user, 'the P75 clauses are not in the measured prompt').toContain('advances=');
      expect(user.length).toBeLessThanOrEqual(BUDGET_CEILING);
    });
  });
});

/** Interesting spawner vertices touched by an arrow of `me`'s groups or an offer exit. */
function tierZero(state: GameState, me: typeof A, offer: readonly Move[]): readonly unknown[] {
  return [...state.spawners.keys()].filter(
    (vertex) =>
      isInteresting(tiling.geometry, state, me, vertex) &&
      isIncident(tiling.geometry, state, me, vertex, offer),
  );
}

/**
 * The same position on any board: A's two-head stack on `a0` (the seed point's
 * lowest out-arrow), `a0` A's only territory, and a 1/4 spawner on every vertex
 * flanked by an exit of `a0` that `a0` does not border — so every clause reads
 * `0/3→1/3` whatever the board's ids. On an alternating point that is two
 * spawners on the exit opposite `a0` (double-fed) and one on each other exit.
 *
 * Offer order follows each board's own arrow ids, so the rows are compared as a
 * sorted list with `[i]` and every id replaced by a placeholder.
 */
function starOffer(board: Board): string[] {
  const g = board.geometry;
  const a0: ArrowId | undefined = [...g.outArrows(g.seedPoint())].toSorted(compareArrows)[0];
  if (a0 === undefined) throw new Error(`setup: ${board.name} has no out-arrow at its seed`);
  const vertices = g
    .outArrows(g.target(a0))
    .flatMap((exit) => flanksSorted(g, exit))
    .filter((vertex) => !g.borderArrows(vertex).includes(a0));
  const state = stateOf({
    territory: [[a0, A]],
    stack: a0,
    heads: 2,
    spawners: vertices.map((vertex) => [vertex, QUARTER] as const),
  });
  const text = formatLegalMoves(board.rules.legalMoves(state), g, board.rules, state, A);
  expect(text, `setup: ${board.name} star offer is empty`).not.toBe('');
  expect(text, `setup: ${board.name} star offer has an illegal row`).not.toContain('tags=illegal');
  return text
    .split('\n')
    .map((line) => withoutIds(line.replace(/^\[\d+\] /, '')))
    .toSorted();
}
