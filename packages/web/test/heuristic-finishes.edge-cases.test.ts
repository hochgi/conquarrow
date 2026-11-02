/**
 * Edge scenarios for docs/spec/heuristic-finishes/heuristic-finishes.edge-cases.feature
 * (P81): the dominance gate, carve shapes, staging limits, reply scoring and
 * the two behaviour-preserving search changes.
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, RulesPort, StepMove } from '@conquarrow/contracts';
import { carvePlans, isDominant, stagingWalk } from '../src/botFinish';
import { grainDistanceFromAny, grainDistanceToAny } from '../src/botEvaluate';
import { DEFAULT_REPLY_DIST_CAP, reachableEnemySeats } from '../src/botReply';
import {
  chooseTurnBeam,
  chooseTurnBeamWithBudget,
  evaluate,
  finalistReplyScore,
  replyScore,
} from '../src/botSearch';
import {
  attackBoard,
  CARVE_MOVE,
  cutReplyBoard,
  dominanceBoard,
  entryArrows,
  fiveHeadStackBoard,
  foldPlan,
  geometry,
  GROUND_TAKING_MOVE,
  headsOf,
  legalSteps,
  MANY_CARVES_MOVE,
  mirrorAt,
  ownStackBlockBoard,
  pathOfPlan,
  planIsLegalSequence,
  planTerminates,
  readReply,
  rules,
  seatsOf,
  sharesClaimedByPath,
  specCarveCandidates,
  specDominant,
  specHasWalker,
  specReplayCarve,
  stagingBoard,
  stagingMergeBoard,
  territoryOf,
  unownedLoopsOnlyBoard,
  withSeatHeads,
} from './heuristic-finishes.support';

const SEARCH_TIMEOUT = 60_000;

/** A plan's steps with the state each was taken from. */
const stepsWithState = (
  state: GameState,
  moves: readonly Move[],
): readonly { readonly move: StepMove; readonly at: GameState }[] => {
  const out: { move: StepMove; at: GameState }[] = [];
  let at = state;
  for (const move of moves) {
    if (move.kind === 'step') out.push({ move, at });
    at = rules.apply(at, move);
  }
  return out;
};

/** Reply case: P = `[endTurn]` from A's turn start at move 107 — B's best reply costs A nothing. */
const QUIET_REPLY_MOVE = 107;

describe('heuristic-finishes edge cases', () => {
  describe('Rule: The dominance gate', () => {
    it.each([
      { a: 20, b: 10, c: 0, dominant: true },
      { a: 19, b: 10, c: 0, dominant: false },
      { a: 2, b: 0, c: 0, dominant: true },
      { a: 1, b: 0, c: 0, dominant: false },
      { a: 30, b: 10, c: 6, dominant: false },
      { a: 32, b: 10, c: 6, dominant: true },
    ])(
      "A seat is dominant only with twice every other seat's heads combined (A=$a B=$b C=$c → $dominant)",
      ({ a, b, c, dominant }) => {
        const { state, A } = dominanceBoard(a, b, c);
        const [, B, C] = state.players;
        expect(
          [...state.territory.values()].some((owner) => owner === B || owner === C),
        ).toBe(true);

        expect(isDominant(state, A)).toBe(dominant);
      },
    );

    it('A seat that is not dominant gets no carve and no staging walk', () => {
      const base = mirrorAt(CARVE_MOVE);
      const { A, B } = seatsOf(base);
      const state = withSeatHeads(base, B, headsOf(base, A));
      expect(specDominant(state, A)).toBe(false);
      expect(specCarveCandidates(state, A).length).toBeGreaterThan(0);

      expect(carvePlans(geometry, rules, state, A)).toEqual([]);
      expect(stagingWalk(geometry, rules, state, A)).toBeUndefined();
    });
  });

  describe('Rule: Carve shapes', () => {
    it('A loop that claims no enemy arrow is not a carve', () => {
      const { state, A } = unownedLoopsOnlyBoard();
      expect(specDominant(state, A)).toBe(true);
      expect(specCarveCandidates(state, A, { includeNonClaiming: true }).length).toBeGreaterThan(0);
      expect(specCarveCandidates(state, A)).toEqual([]);

      expect(carvePlans(geometry, rules, state, A)).toEqual([]);
    });

    it('A carve may attack an enemy head standing on enemy ground', () => {
      const { state, A, B, target } = attackBoard();
      expect(specDominant(state, A)).toBe(true);

      const plans = carvePlans(geometry, rules, state, A);

      expect(plans.length).toBeGreaterThan(0);
      let attacks = 0;
      for (const plan of plans) {
        expect(planIsLegalSequence(state, plan.moves)).toBe(true);
        for (const { move, at } of stepsWithState(state, plan.moves)) {
          const defender = at.groups.get(move.exit);
          if (defender?.owner !== B || at.territory.get(move.exit) !== B) continue;
          attacks += 1;
          const heads = at.groups.get(move.from)?.heads ?? 0;
          expect([heads, heads - 1]).toContain(move.count);
        }
        const landing = pathOfPlan(plan.moves)?.path.at(-1);
        expect(landing).toBeDefined();
        if (landing === undefined) continue;
        expect(foldPlan(state, plan.moves).groups.get(landing)?.owner).toBe(A);
      }
      expect(attacks).toBeGreaterThan(0);
      expect(plans.some((p) => p.moves.some((m) => m.kind === 'step' && m.exit === target))).toBe(
        true,
      );
    });

    it('A carve never runs through an own stack before its landing', () => {
      const { state, A } = ownStackBlockBoard();
      expect(specDominant(state, A)).toBe(true);

      const plans = carvePlans(geometry, rules, state, A);

      for (const plan of plans) {
        const steps = stepsWithState(state, plan.moves);
        for (const { move, at } of steps.slice(0, -1)) {
          expect(at.groups.get(move.exit)?.owner).not.toBe(A);
        }
      }
    });

    it('At most four carves are offered, best claim first', () => {
      const state = mirrorAt(MANY_CARVES_MOVE);
      const { A } = seatsOf(state);
      expect(specDominant(state, A)).toBe(true);
      const loops = specCarveCandidates(state, A);
      expect(loops.length).toBeGreaterThan(4);
      // Every one of the best four survives decision 5's replay, so "left out"
      // means ranked out, never dropped.
      for (const loop of loops.slice(0, 4)) expect(specReplayCarve(state, A, loop)).toBeDefined();

      const plans = carvePlans(geometry, rules, state, A);

      expect(plans.length).toBeGreaterThan(0);
      expect(plans.length).toBeLessThanOrEqual(4);
      const returned = plans.map((p) => {
        const path = pathOfPlan(p.moves);
        if (path === undefined) throw new Error('a carve moves one group');
        return path;
      });
      const key = (from: ArrowId, path: readonly ArrowId[]): string =>
        [from, ...path].map(String).join('|');
      const returnedKeys = new Set(returned.map((r) => key(r.from, r.path)));
      const leftOut = loops.filter((l) => !returnedKeys.has(key(l.from, l.path)));
      for (const r of returned) {
        const shares = sharesClaimedByPath(state, A, r.path);
        for (const l of leftOut) expect(shares).toBeGreaterThanOrEqual(l.enemySharesClaimed);
      }
    });
  });

  describe('Rule: Staging limits', () => {
    it('A staging walk stops where it merges into another own stack', () => {
      const { state, A, s1, s2 } = stagingMergeBoard();
      expect(specDominant(state, A)).toBe(true);
      expect(state.groups.get(s1)?.heads).toBeGreaterThanOrEqual(4);
      expect(state.groups.get(s2)?.owner).toBe(A);

      const walk = stagingWalk(geometry, rules, state, A);

      expect(walk).toBeDefined();
      if (walk === undefined) return;
      const steps = walk.moves.filter((m): m is StepMove => m.kind === 'step');
      expect(steps.at(-1)?.exit).toBe(s2);
      expect(walk.moves.at(-1)).toEqual(endTurn());
      expect(planIsLegalSequence(state, walk.moves)).toBe(true);
      expect(planTerminates(state, walk.moves)).toBe(true);
    });

    it('No entry arrow means no staging walk', () => {
      const { state, A, s1 } = stagingBoard({ withEntry: false });
      expect(specDominant(state, A)).toBe(true);
      expect(entryArrows(state, A)).toEqual([]);
      expect(state.groups.get(s1)?.heads).toBeGreaterThanOrEqual(4);

      expect(stagingWalk(geometry, rules, state, A)).toBeUndefined();
    });

    it(
      'A plan that takes ground is not replaced by a staging walk',
      () => {
        const state = mirrorAt(GROUND_TAKING_MOVE);
        const { A } = seatsOf(state);
        expect(specDominant(state, A)).toBe(true);
        expect(specHasWalker(state, A)).toBe(true);

        const walk = stagingWalk(geometry, rules, state, A);
        const plan = chooseTurnBeam(geometry, rules, state, A);

        expect(walk).toBeDefined();
        expect(territoryOf(foldPlan(state, plan), A)).toBeGreaterThan(territoryOf(state, A));
        expect(plan).not.toEqual(walk?.moves);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: Reply scores measure the enemy, not the round boundary', () => {
    it('A finalist whose only change across the reply is production keeps its own score', () => {
      const origin = mirrorAt(QUIET_REPLY_MOVE);
      const { A, B } = seatsOf(origin);
      const terminal = rules.apply(origin, endTurn());
      expect(reachableEnemySeats(geometry, terminal, A, DEFAULT_REPLY_DIST_CAP)).toEqual([B]);
      const reading = readReply(terminal, A, B);
      expect(reading.damage).toBe(0);
      // The boundary pays production: today's P55 score counts it as the reply's.
      expect(replyScore(geometry, rules, terminal, A)).toBeGreaterThan(reading.unreplied);

      expect(finalistReplyScore(geometry, rules, terminal, A)).toBe(
        evaluate(geometry, terminal, A, rules),
      );
    });

    it('A finalist the enemy can punish loses exactly the damage', () => {
      const { terminal, A, B } = cutReplyBoard();
      const reading = readReply(terminal, A, B);
      const unreplied = evaluate(geometry, terminal, A, rules);
      const replied = evaluate(geometry, reading.afterReply, A, rules);
      const passed = evaluate(geometry, reading.afterPass, A, rules);

      const score = finalistReplyScore(geometry, rules, terminal, A);

      expect(score).toBe(unreplied + replied - passed);
      expect(score).toBeLessThan(unreplied);
    });
  });

  describe('Rule: Behaviour-preserving changes', () => {
    it('Findings at a beam node are computed from one step per from→exit', () => {
      const { state, A, stack } = fiveHeadStackBoard();
      expect(state.groups.get(stack)?.heads).toBe(5);
      const exits = new Set(legalSteps(state).filter((m) => m.from === stack).map((m) => String(m.exit)));
      expect(exits.size).toBe(3);
      const maxCount = new Map<string, number>();
      for (const m of legalSteps(state)) {
        const k = `${String(m.from)}>${String(m.exit)}`;
        maxCount.set(k, Math.max(maxCount.get(k) ?? 0, m.count));
      }

      // One beam node: the root orders its steps (findings), takes one branch, ends.
      const fromRoot = new Map<string, Set<number>>();
      const recording: RulesPort = {
        ...rules,
        apply(at, move) {
          if (at === state && move.kind === 'step') {
            const k = `${String(move.from)}>${String(move.exit)}`;
            const counts = fromRoot.get(k) ?? new Set<number>();
            counts.add(move.count);
            fromRoot.set(k, counts);
          }
          return rules.apply(at, move);
        },
      };
      chooseTurnBeamWithBudget(geometry, recording, state, A, {
        beam: 1,
        branch: 1,
        maxPlan: 2,
        withReplies: false,
      });

      expect(fromRoot.size).toBeGreaterThan(0);
      for (const [k, counts] of fromRoot) {
        expect([...counts]).toEqual([maxCount.get(k)]);
      }
    });

    it('The multi-source grain distance equals the minimum of single-source distances', () => {
      const state = mirrorAt(CARVE_MOVE);
      const centre = geometry.origin(state.groups.keys().next().value as ArrowId);
      const arrows = [...geometry.window(centre, 3).arrows].toSorted((a, b) =>
        String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
      );
      const pick = (offset: number, stride: number, n: number): ArrowId[] => {
        const out: ArrowId[] = [];
        for (let i = 0; i < n; i += 1) {
          const a = arrows[(offset + i * stride) % arrows.length];
          if (a !== undefined) out.push(a);
        }
        return out;
      };
      let cases = 0;
      for (const cap of [0, 1, 2, 4, 12, 16]) {
        for (const [startCount, goalCount] of [
          [1, 1],
          [1, 3],
          [3, 1],
          [4, 0],
          [5, 6],
          [12, 2],
        ] as const) {
          for (const offset of [0, 17, 41]) {
            const starts = pick(offset, 7, startCount);
            const goals = pick(offset + 3, 11, goalCount);
            const expected = Math.min(
              ...starts.map((s) => grainDistanceToAny(geometry, s, goals, cap)),
            );
            expect(grainDistanceFromAny(geometry, starts, goals, cap)).toBe(expected);
            cases += 1;
          }
        }
      }
      expect(cases).toBe(108);
    });
  });
});

