/**
 * EARS invariants for docs/spec/win-board-celebration/win-board-celebration.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/online-shell.invariants.test.ts).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_CONFIG, type GameState, type PlayerId } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { styleFor } from '../src/colors';
import {
  MATCH_OVER_DIM_OPACITY,
  MATCH_OVER_OVERLAY,
  controlsLocked,
  hasSplash,
  isMatchOverDimmed,
  playHighlightsAllowed,
  victoryFx,
  yieldSoonAllowed,
} from '../src/fx/victory';
import {
  anEmptyArrow,
  aNonShareArrow,
  bannerOf,
  cmpId,
  dimBoard,
  eliminationBoard,
  geometry,
  leftoverClockBoard,
  livingCount,
  noShareBoard,
  playingBoard,
  pulseOf,
  reversedShareBoards,
  shineBoard,
  shineOf,
  snapshotState,
  sortedIds,
  starvationBoard,
  trailBoard,
  yieldSoonBoard,
} from './victory-fx.support';

const helperSrc = (): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/fx/victory.ts'), 'utf8');

const sampleArrows = (state: GameState) => {
  const extra = [anEmptyArrow(state), aNonShareArrow(state)];
  return [...new Set([...geometry.window(geometry.seedPoint(), 4).arrows, ...extra])];
};

const specShine = (state: GameState, winner: PlayerId): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const vertex of [...state.spawners.keys()].toSorted(cmpId)) {
    for (const arrow of [...geometry.borderArrows(vertex)].toSorted(cmpId)) {
      if (state.territory.get(arrow) !== winner) continue;
      if (seen.has(String(arrow))) continue;
      seen.add(String(arrow));
      out.push(String(arrow));
    }
  }
  return out.toSorted();
};

describe('win-board-celebration invariants', () => {
  it('When state.winner is unset, the system shall not apply victory shine, victory pulse, match-over dim, or the match-over banner', () => {
    const boards = [playingBoard().state, yieldSoonBoard(false).state];
    for (const state of boards) {
      const fx = victoryFx(state, geometry);
      expect(fx.kind).toBe('playing');
      expect(shineOf(fx).size).toBe(0);
      expect(pulseOf(fx).size).toBe(0);
      expect(bannerOf(fx)).toBeUndefined();
      for (const arrow of sampleArrows(state)) {
        expect(isMatchOverDimmed(fx, arrow, state)).toBe(false);
      }
    }
  });

  it('When state.winner is set, the system shall not paint yield-soon shine', () => {
    expect(yieldSoonAllowed(victoryFx(playingBoard().state, geometry))).toBe(true);
    const boards = [
      eliminationBoard().state,
      starvationBoard().state,
      yieldSoonBoard(true).state,
    ];
    for (const state of boards) {
      expect(yieldSoonAllowed(victoryFx(state, geometry))).toBe(false);
    }
  });

  it("When state.winner is set, the system shall shine exactly the winner's share arrows and shall not shine a winner territory arrow that is not a share", () => {
    const states: readonly GameState[] = [
      shineBoard().state,
      eliminationBoard().state,
      noShareBoard().state,
      reversedShareBoards().left,
    ];
    for (const state of states) {
      const winner = state.winner;
      expect(winner).toBeDefined();
      if (winner === undefined) continue;
      const shine = sortedIds(shineOf(victoryFx(state, geometry)));
      expect(shine).toEqual(specShine(state, winner));
      const t1 = aNonShareArrow(state);
      if (state.territory.get(t1) === winner) {
        expect(shine).not.toContain(String(t1));
      }
    }
  });

  // P36 replaces the two head-count banner invariants below with one negative
  // invariant: **while `winner` is set, the banner shall not assert a losing
  // mechanism.** A lost seat's heads are removed, so `livingCount` is 1 whenever
  // `winner` is set and the old discriminant is dead. See
  // docs/spec/losing-conditions/losing-conditions.md.
  it('While state.winner is set, the banner shall name the winner and shall not assert a losing mechanism', () => {
    const threeOpening = makeMatch({ ...DEFAULT_MATCH_CONFIG, playerCount: 3 });
    const threeWinner = threeOpening.players[0];
    expect(threeWinner).toBeDefined();
    if (threeWinner === undefined) return;
    const boards = [
      eliminationBoard().state,
      leftoverClockBoard().state,
      noShareBoard().state,
      starvationBoard().state,
      { ...threeOpening, winner: threeWinner },
    ];
    for (const state of boards) {
      const winner = state.winner;
      expect(winner).toBeDefined();
      if (winner === undefined) continue;
      const banner = String(bannerOf(victoryFx(state, geometry)));
      expect(banner).toContain(styleFor(winner).label);
      for (const mechanism of ['last head', 'elimination', 'starvation', 'domination']) {
        expect(banner.toLowerCase()).not.toContain(mechanism);
      }
    }
  });

  it('While state.winner is set, the banner shall be the same however the loser went', () => {
    // Head count can no longer discriminate, so a caption that branched on it
    // would be asserting something the state does not know.
    const oneLiving = eliminationBoard().state;
    const twoLiving = starvationBoard().state;
    expect(livingCount(oneLiving)).toBe(1);
    expect(livingCount(twoLiving)).toBeGreaterThanOrEqual(2);
    expect(oneLiving.winner).toBe(twoLiving.winner);

    expect(bannerOf(victoryFx(twoLiving, geometry))).toBe(
      bannerOf(victoryFx(oneLiving, geometry)),
    );
  });

  it('When state.winner is set, the system shall pulse every arrow that holds a winner group and shall not pulse a loser group', () => {
    const boards = [starvationBoard().state, eliminationBoard().state, noShareBoard().state];
    for (const state of boards) {
      const winner = state.winner;
      expect(winner).toBeDefined();
      if (winner === undefined) continue;
      const pulse = pulseOf(victoryFx(state, geometry));
      for (const [arrow, group] of state.groups) {
        if (group.owner === winner) expect(pulse.has(arrow)).toBe(true);
        else expect(pulse.has(arrow)).toBe(false);
      }
    }
  });

  it('When state.winner is set, the system shall dim every arrow that is not winner territory, winner trail, or a winner group, at opacity 0.4', () => {
    expect(MATCH_OVER_DIM_OPACITY).toBe(0.4);
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/styles.css'),
      'utf8',
    );
    expect(css).toMatch(/\.match-over-dim\s*\{[^}]*opacity:\s*0\.4/);
    const boards = [dimBoard().state, trailBoard().state, starvationBoard().state];
    for (const state of boards) {
      const winner = state.winner;
      expect(winner).toBeDefined();
      if (winner === undefined) continue;
      const fx = victoryFx(state, geometry);
      const trail = state.trails.get(winner) ?? new Set();
      for (const arrow of sampleArrows(state)) {
        const keep =
          state.territory.get(arrow) === winner ||
          trail.has(arrow) ||
          state.groups.get(arrow)?.owner === winner;
        expect(isMatchOverDimmed(fx, arrow, state)).toBe(!keep);
      }
    }
  });

  it('When state.winner is set, the system shall not offer End turn', () => {
    expect(controlsLocked(victoryFx(playingBoard().state, geometry))).toBe(false);
    const boards = [eliminationBoard().state, starvationBoard().state];
    for (const state of boards) {
      expect(controlsLocked(victoryFx(state, geometry))).toBe(true);
    }
  });

  it('When state.winner is set, the system shall not render selected, reach, path, movable, or preview washes', () => {
    expect(playHighlightsAllowed(victoryFx(playingBoard().state, geometry))).toBe(true);
    const boards = [eliminationBoard().state, starvationBoard().state];
    for (const state of boards) {
      expect(playHighlightsAllowed(victoryFx(state, geometry))).toBe(false);
    }
  });

  it('The system shall not mutate GameState to produce the celebration; equal inputs shall yield equal shine and pulse sets', () => {
    const { left, right, s1, s2 } = reversedShareBoards();
    const before = snapshotState(left);
    const fxLeft = victoryFx(left, geometry);
    expect(snapshotState(left)).toEqual(before);
    const fxRight = victoryFx(right, geometry);
    expect(sortedIds(shineOf(fxLeft))).toEqual(sortedIds(shineOf(fxRight)));
    expect(sortedIds(pulseOf(fxLeft))).toEqual(sortedIds(pulseOf(fxRight)));
    expect(sortedIds(shineOf(fxLeft))).toEqual([String(s1), String(s2)].toSorted());
  });

  it('The system shall not cover the board with a splash, modal, or portion-backdrop', () => {
    const fx = victoryFx(eliminationBoard().state, geometry);
    expect(MATCH_OVER_OVERLAY).toBeUndefined();
    expect(hasSplash(fx)).toBe(false);
    expect(helperSrc()).not.toContain('portion-backdrop');
    const boardSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/Board.tsx'),
      'utf8',
    );
    const hudSrc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/Hud.tsx'),
      'utf8',
    );
    expect(boardSrc).not.toContain('portion-backdrop');
    expect(hudSrc).not.toContain('portion-backdrop');
    expect(boardSrc).not.toMatch(/\bsplash\b/i);
    expect(hudSrc).not.toMatch(/\bsplash\b/i);
  });

  it('The rules engine shall be unchanged: no new win condition, no new field, no edit to packages/rules-core/src/victory.ts', async () => {
    const exported = Object.keys(await import('../src/fx/victory'));
    expect(exported).not.toContain('resolveLosses');
    expect(exported).not.toContain('tickStarvation');
    expect(victoryFx.length).toBe(2);
    const src = helperSrc();
    expect(src).not.toContain('@conquarrow/rules-core');
    expect(src).not.toContain('resolveLosses');
    expect(src).not.toContain('tickStarvation');
  });
});
