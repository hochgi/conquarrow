/**
 * Edge scenarios for docs/spec/heuristic-tempo-horizon/heuristic-tempo-horizon.edge-cases.feature
 * (P85 — the race arithmetic, the caps, the threat test, and what stays
 * unchanged).
 *
 * The readings are asserted on small positions built on the real tiling:
 * SMALL_MATCH / THREE_MATCH territory and spawners, with exactly the groups
 * and trails a scenario names. Each premise is checked against the spec
 * oracle (`tempo-race.support.ts`) before the production reading is asked.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { endTurn, speed } from '@conquarrow/contracts';
import type { ArrowId, GameState } from '@conquarrow/contracts';
import { loot } from '../src/botClose';
import { homewardPath } from '../src/botEvaluate';
import { isKite, isThreatenedKite, missionsOf } from '../src/botMission';
import { hypothesiseChair } from '../src/botReply';
import { chooseTurnBeam, chooseTurnBeamWithBudget } from '../src/botSearch';
import {
  enemyTurnsToClose,
  interceptOf,
  safeWindow,
  SORTIE_CREDIT,
  SORTIE_TOTAL_CAP,
  SORTIE_TURN_CAP,
  sortieCredit,
  sortieOf,
  TEMPO_TURN_CAP,
} from '../src/botTempo';
import { chooseMove } from '../src/opponent';
import {
  allFixturePositions,
  bareThreeSeat,
  bareTwoSeat,
  blockedByMyTerritory,
  compareArrowIds,
  cutLegalAgainst,
  enemyAtTurns,
  findTrail,
  geometry,
  i1Slowed,
  INTERCEPT_FIXTURES,
  interceptPosition,
  KITE_MOVE,
  KITE_MOVE_20_PLAN,
  loneEnemyAt,
  mineBlocked,
  openTrailBoard,
  outs,
  ownedArrows,
  plainDistance,
  positionAt,
  preP85Outputs,
  raceBoard,
  rules,
  seatOf,
  specBareMarks,
  specEnemyTurnsToClose,
  specInterceptOf,
  specPassableDistance,
  specRaceAgainst,
  specSafeWindow,
  specSortie,
  specThreatL,
  SPEC_SORTIE_CREDIT,
  SPEC_SORTIE_TOTAL_CAP,
  SPEC_SORTIE_TURN_CAP,
  SPEC_TEMPO_TURN_CAP,
  terminalOf,
  twoRacesBoard,
  underFireRaceBoard,
  withGroups,
  withLongTrail,
  withoutGroupsOf,
  withTrail,
  arrowAtDistance,
  boxedAfterOccupy,
  stepIsLegal,
} from './heuristic-tempo-horizon.support';
import {
  cutVsDirtPosition,
  originFindingsOf,
  sourceWithoutComments,
  specIsThreatenedKitePreP85,
  specMissionContext,
  specProjectedTrail,
  stagingVsThreatenedKitePosition,
} from './mission-and-staging.support';
import { strideTwoStackPosition } from './bot-turn-search.support';

const SEARCH_TIMEOUT = 120_000;
const SWEEP_TIMEOUT = 600_000;

const here = dirname(fileURLToPath(import.meta.url));

describe('heuristic-tempo-horizon edge cases', () => {
  describe('Rule: The safe window counts each enemy group at its own speed, from its next turn', () => {
    it('A lone enemy 1-stack three grain steps from the target has W 3', () => {
      const { state, me, X, at } = loneEnemyAt(3, 1);
      expect([...state.groups.values()].filter((g) => g.owner !== me)).toHaveLength(1);
      expect(specPassableDistance(at, new Set([String(X)]), mineBlocked(state, me), 12)).toBe(3);

      expect(safeWindow(geometry, state, me, [X], 8)).toBe(3);
    });

    it('A 3-stack at the same distance is faster, and a split never beats the stack', () => {
      const { state, me, enemy, X, at } = loneEnemyAt(3, 3);
      expect(Math.ceil(3 / speed(3))).toBe(2);

      expect(safeWindow(geometry, state, me, [X], 8)).toBe(2);
      // Any part of the stack standing there alone is no faster than the stack.
      for (const heads of [1, 2]) {
        const part = withGroups(state, [[at, enemy, heads]]);
        expect(safeWindow(geometry, part, me, [X], 8)).toBeGreaterThanOrEqual(2);
      }
    });

    it('A group already standing next to the target still needs one turn', () => {
      const { state, me, X, at } = loneEnemyAt(1, 1);
      expect(specPassableDistance(at, new Set([String(X)]), mineBlocked(state, me), 12)).toBe(1);

      expect(safeWindow(geometry, state, me, [X], 8)).toBe(1);
    });

    it('No enemy within the cap gives cap plus one', () => {
      // A 1-stack 3 steps away: beyond speed(1) × 2 = 2 steps.
      const { state, me, X } = loneEnemyAt(3, 1);

      expect(safeWindow(geometry, state, me, [X], 2)).toBe(3);
    });

    it('An enemy path may not cross my territory', () => {
      const { state, me, enemy, X, at, through } = blockedByMyTerritory();
      expect(state.groups.get(at)).toEqual({ owner: enemy, heads: 1, spent: 0 });
      // The only 2-step path runs through an arrow of my territory …
      expect(plainDistance(at, [X], 4)).toBe(2);
      expect(outs(at).filter((m) => outs(m).includes(X))).toEqual([through]);
      expect(state.territory.get(through)).toBe(me);
      // … and the shortest path avoiding my territory is 5 steps.
      expect(specPassableDistance(at, new Set([String(X)]), mineBlocked(state, me), 12)).toBe(5);

      expect(safeWindow(geometry, state, me, [X], 8)).toBe(5);
    });

    it('Every enemy seat counts in a 3-player game, the seat in between included', () => {
      const { state: bare, A, B, C } = bareThreeSeat();
      const mine = findTrail(bare, A, 2, 2);
      const withMine = withGroups(withTrail(bare, A, mine.trail), [[mine.tip, A, 1]]);
      const sortie = specSortie(withMine, A);
      if (sortie === undefined) throw new Error('setup: no projected sortie');
      const avoid = new Set(mine.trail.map(String));
      const atB = arrowAtDistance(withMine, sortie.projected, 4, mineBlocked(withMine, A), avoid);
      const withB = withGroups(withMine, [[atB, B, 1]]);
      const atC = arrowAtDistance(withB, sortie.projected, 2, mineBlocked(withB, A), new Set([...avoid, String(atB)]));
      const state = withGroups(withB, [[atC, C, 1]]);
      expect(specSafeWindow(withoutGroupsOf(state, C), A, sortie.projected, 8)).toBe(4);
      expect(specSafeWindow(withoutGroupsOf(state, B), A, sortie.projected, 8)).toBe(2);

      expect(safeWindow(geometry, state, A, sortie.projected, 8)).toBe(2);
    });
  });

  describe('Rule: The sortie credit is half the projected loot, only inside the caps and the window', () => {
    // W 9 is "no enemy within the cap": no enemy group is placed.
    it.each([
      { L: 2, E: 2, W: 5, half: true },
      { L: 3, E: 2, W: 4, half: true },
      { L: 4, E: 1, W: 9, half: false },
      { L: 3, E: 3, W: 9, half: false },
      { L: 2, E: 2, W: 2, half: false },
      { L: 2, E: 2, W: 1, half: false },
    ])('Credit is 0 outside a cap or the window (L $L, E $E, W $W)', ({ L, E, W, half }) => {
      // A 1-stack tip: L = its home distance, E = the trail's size.
      const board = openTrailBoard(E, L, 1);
      const sortie = specSortie(board.state, board.me);
      if (sortie === undefined) throw new Error('setup: no open trail');
      const state = W > SPEC_TEMPO_TURN_CAP ? board.state : enemyAtTurns(board, sortie.projected, W);
      expect(sortie.turnsToLand).toBe(L);
      expect(sortie.elapsed).toBe(E);
      expect(specSafeWindow(state, board.me, sortie.projected, SPEC_TEMPO_TURN_CAP)).toBe(W);
      const expected = half ? SPEC_SORTIE_CREDIT * loot(sortie.shares, sortie.arrows) : 0;

      expect(sortieCredit(geometry, state, board.me)).toBe(expected);
    });

    it('No open trail earns no credit', () => {
      const { state: bare, Bot } = bareTwoSeat();
      const home = ownedArrows(bare, Bot)[0];
      if (home === undefined) throw new Error('setup: Bot has no home');
      const state = withGroups(bare, [[home, Bot, 3]]);
      expect(state.trails.get(Bot)).toBeUndefined();

      expect(sortieCredit(geometry, state, Bot)).toBe(0);
      expect(sortieOf(geometry, state, Bot)).toBeUndefined();
    });

    it("The projected sortie is the trail plus every tip's homeward path, minus my land", () => {
      // A 2-stack tip, so turnsToLand and elapsed are not just the step counts.
      const { state, me, trail, tip } = openTrailBoard(4, 3, 2);
      const home = homewardPath(geometry, state, me, tip, 16);
      expect(home.distance).toBe(3);
      const projected = [...new Map([...trail, ...home.path].map((a) => [String(a), a])).values()].toSorted(
        compareArrowIds,
      );
      const notMine = projected.filter((a) => state.territory.get(a) !== me);
      const flanks = new Set(
        [...state.spawners.keys()].flatMap((v) => [...geometry.borderArrows(v)].map(String)),
      );

      expect(sortieOf(geometry, state, me)).toEqual({
        turnsToLand: Math.ceil(3 / speed(2)),
        elapsed: Math.ceil(4 / speed(2)),
        projected,
        arrows: notMine.length,
        shares: notMine.filter((a) => flanks.has(String(a))).length,
      });
    });
  });

  describe('Rule: The intercept race counts my turns against the enemy\'s turns to close, to bare marks only', () => {
    it('A tie goes to the seat on move', () => {
      const { state, me, enemy } = raceBoard(3, 2, 2);
      expect(specEnemyTurnsToClose(state, enemy)).toBe(2);
      expect(specRaceAgainst(state, me, enemy)?.turns).toBe(2);

      expect(interceptOf(geometry, state, me)).toMatchObject({ enemy, turns: 2, enemyTurns: 2 });
    });

    it('One turn short is a lost race and no march', () => {
      const { state, me, enemy } = i1Slowed();
      const race = specRaceAgainst(state, me, enemy);
      expect(race?.turns).toBe(3);
      expect(race?.enemyTurns).toBe(2);
      expect(specInterceptOf(state, me)).toBeUndefined();

      const intercept = interceptOf(geometry, state, me);
      expect(intercept).toBeUndefined();
      const missions = missionsOf(geometry, rules, state, me, originFindingsOf(state, me), intercept);
      expect(missions).not.toContain('intercept');
    });

    it("A trail arrow holding the enemy's heads is not a target", () => {
      const { state, me, enemy, enemyTrail, enemyTip } = raceBoard(3, 2, 2);
      expect(enemyTrail).toHaveLength(3);
      expect(state.groups.get(enemyTip)?.owner).toBe(enemy);
      const bare = enemyTrail.filter((a) => a !== enemyTip).toSorted(compareArrowIds);
      expect(bare).toHaveLength(2);

      expect(interceptOf(geometry, state, me)?.targets).toEqual(bare);
    });

    it('An enemy with no tip on its trail cannot close, so there is no race against it', () => {
      const board = raceBoard(3, 2, 2);
      const state = withoutGroupsOf(board.state, board.enemy);
      expect(specBareMarks(state, board.enemy)).toHaveLength(3);

      expect(enemyTurnsToClose(geometry, state, board.enemy)).toBe(TEMPO_TURN_CAP + 1);
      expect(interceptOf(geometry, state, board.me)?.enemy).not.toBe(board.enemy);
    });

    it('Two won races take the one I reach soonest, then the lower PlayerId', () => {
      const soonest = twoRacesBoard(3, 2);
      const { A, B, C } = soonest;
      expect(String(B) < String(C)).toBe(true);
      for (const [enemy, turns] of [
        [B, 3],
        [C, 2],
      ] as const) {
        const race = specRaceAgainst(soonest.state, A, enemy);
        expect(race?.turns).toBe(turns);
        expect(race === undefined ? false : race.turns <= race.enemyTurns).toBe(true);
      }

      expect(interceptOf(geometry, soonest.state, A)?.enemy).toBe(C);

      const tied = twoRacesBoard(2, 2);
      expect(specRaceAgainst(tied.state, A, B)?.turns).toBe(2);
      expect(specRaceAgainst(tied.state, A, C)?.turns).toBe(2);
      expect(interceptOf(geometry, tied.state, A)?.enemy).toBe(B);
    });

    it('The intercept fixtures read as tabled', () => {
      for (const fixture of INTERCEPT_FIXTURES) {
        const pos = interceptPosition(fixture);

        expect(interceptOf(geometry, pos.state, pos.me), fixture.id).toMatchObject({
          enemy: pos.enemy,
          turns: fixture.mine,
          enemyTurns: fixture.theirs,
        });
      }
    });
  });

  describe('Rule: Missions — intercept never displaces bank or cut', () => {
    it('A legal cut keeps the cut mission and no intercept is added', () => {
      const { state, Bot } = cutVsDirtPosition();
      const E = seatOf(state, 'A');
      expect(cutLegalAgainst(state, Bot, E)).toBe(true);
      const race = specRaceAgainst(state, Bot, E);
      expect(race !== undefined && race.turns <= race.enemyTurns).toBe(true);

      const missions = missionsOf(
        geometry,
        rules,
        state,
        Bot,
        originFindingsOf(state, Bot),
        interceptOf(geometry, state, Bot),
      );

      expect(missions).toContain('cut');
      expect(missions).not.toContain('intercept');
    });

    it('Under fire, bank comes first and no intercept is added', () => {
      // underFireRaceBoard throws `setup:` unless exposure > 0 and a race is won.
      const { state, me } = underFireRaceBoard();
      expect(specInterceptOf(state, me)).toBeDefined();

      const missions = missionsOf(
        geometry,
        rules,
        state,
        me,
        originFindingsOf(state, me),
        interceptOf(geometry, state, me),
      );

      expect(missions).toContain('bank');
      expect(missions).not.toContain('intercept');
    });
  });

  describe("Rule: P59's threatened-kite test reads the race, for the live seat", () => {
    it('A kite with a wide window is no longer threatened', () => {
      const { state, me } = positionAt('kite', 'playtest-2026-11-02', KITE_MOVE, 'A');
      const ctx = specMissionContext(state, me);
      expect(ctx.missions).toEqual(['contest']);
      expect(missionsOf(geometry, rules, state, me, originFindingsOf(state, me))).toEqual(['contest']);
      const plan = { moves: KITE_MOVE_20_PLAN, state: terminalOf(state, KITE_MOVE_20_PLAN) };
      expect(isKite(ctx, plan)).toBe(true);
      expect(specSortie(plan.state, me)?.turnsToLand).toBe(2);
      expect(specSafeWindow(plan.state, me, specProjectedTrail(ctx, plan), SPEC_TEMPO_TURN_CAP)).toBe(6);
      expect(specIsThreatenedKitePreP85(ctx, plan)).toBe(true);

      expect(isThreatenedKite(ctx, plan)).toBe(false);
    });

    it('A kite whose window is no wider than its turns to land stays threatened', () => {
      const pos = stagingVsThreatenedKitePosition();
      expect(isKite(pos.ctx, pos.kite)).toBe(true);
      const L = specThreatL(pos.kite.state, pos.Bot);
      const W = specSafeWindow(
        pos.kite.state,
        pos.Bot,
        specProjectedTrail(pos.ctx, pos.kite),
        Math.min(L, SPEC_TEMPO_TURN_CAP),
      );
      expect(W).toBeLessThanOrEqual(L);

      expect(isThreatenedKite(pos.ctx, pos.kite)).toBe(true);
    });
  });

  describe('Rule: What stays as it was', () => {
    it(
      'The nested search is unchanged',
      () => {
        const recorded = preP85Outputs();
        const changed: string[] = [];
        for (const { id, state, me } of allFixturePositions()) {
          const pre = recorded.get(id);
          if (pre === undefined) throw new Error(`setup: no pre-P85 output for ${id}`);
          const plan = chooseTurnBeamWithBudget(geometry, rules, state, me, { withReplies: false });
          if (JSON.stringify(plan) !== JSON.stringify(pre.nested)) changed.push(id);
        }
        expect(changed).toEqual([]);
      },
      SWEEP_TIMEOUT,
    );

    it(
      'chooseMove is unchanged',
      () => {
        const recorded = preP85Outputs();
        const changed: string[] = [];
        for (const { id, state, me } of allFixturePositions()) {
          const pre = recorded.get(id);
          if (pre === undefined) throw new Error(`setup: no pre-P85 output for ${id}`);
          if (JSON.stringify(chooseMove(geometry, rules, state, me)) !== JSON.stringify(pre.chooseMove)) {
            changed.push(id);
          }
        }
        expect(changed).toEqual([]);
      },
      SWEEP_TIMEOUT,
    );

    it(
      'A seat with no legal step still passes',
      () => {
        const { state, E } = boxedAfterOccupy();
        const chair = hypothesiseChair(state, E);
        expect(stepIsLegal(chair)).toBe(false);

        expect(chooseTurnBeam(geometry, rules, chair, E)).toEqual([endTurn()]);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Decision 7 and 9: the module', () => {
    it('The tempo constants are the spec values', () => {
      expect({ TEMPO_TURN_CAP, SORTIE_TURN_CAP, SORTIE_TOTAL_CAP, SORTIE_CREDIT }).toEqual({
        TEMPO_TURN_CAP: SPEC_TEMPO_TURN_CAP,
        SORTIE_TURN_CAP: SPEC_SORTIE_TURN_CAP,
        SORTIE_TOTAL_CAP: SPEC_SORTIE_TOTAL_CAP,
        SORTIE_CREDIT: SPEC_SORTIE_CREDIT,
      });
    });

    it('botTempo is pure: no clock, no randomness, no module-level mutable state', () => {
      const src = sourceWithoutComments(readFileSync(join(here, '../src/botTempo.ts'), 'utf8'));
      expect(src).not.toMatch(/\bDate\b/);
      expect(src).not.toContain('Math.random');
      expect(src).not.toContain('performance.now');
      expect(src).not.toMatch(/^(export\s+)?(let|var)\s/m);
    });

    it('online-api typechecks botTempo with the heuristic graph', () => {
      const tsconfig = readFileSync(join(here, '../../online-api/tsconfig.json'), 'utf8');
      expect(tsconfig).toContain('"../web/src/botTempo.ts"');
    });
  });

  describe('Decision 12: the credit on the superseded "land now" boards', () => {
    // The P53 stride board: no enemy can reach, so after the first stride
    // step the open trail earns credit; on the lengthened-trail rewrite
    // elapsed + L exceeds SORTIE_TOTAL_CAP and it earns none.
    const firstStride = (state: GameState, from: ArrowId, first: ArrowId): GameState =>
      terminalOf(state, [{ kind: 'step', from, exit: first, count: 2 }]);

    it('On the original stride board the open trail after one step earns half its projected loot', () => {
      const { state, Bot, from, first } = strideTwoStackPosition();
      const after = firstStride(state, from, first);
      const sortie = specSortie(after, Bot);
      if (sortie === undefined) throw new Error('setup: no open trail after the first step');
      expect(sortie.turnsToLand).toBeLessThanOrEqual(SPEC_SORTIE_TURN_CAP);
      expect(specSafeWindow(after, Bot, sortie.projected, sortie.turnsToLand)).toBeGreaterThan(
        sortie.turnsToLand,
      );

      expect(sortieCredit(geometry, after, Bot)).toBe(SPEC_SORTIE_CREDIT * loot(sortie.shares, sortie.arrows));
    });

    it('On the lengthened-trail rewrite the same step earns no credit', () => {
      const pos = strideTwoStackPosition();
      const state = withLongTrail(pos.state, pos.Bot, pos.from, 2);
      const after = firstStride(state, pos.from, pos.first);
      const sortie = specSortie(after, pos.Bot);
      if (sortie === undefined) throw new Error('setup: no open trail after the first step');
      expect(sortie.elapsed + sortie.turnsToLand).toBeGreaterThan(SPEC_SORTIE_TOTAL_CAP);

      expect(sortieCredit(geometry, after, pos.Bot)).toBe(0);
    });
  });
});

