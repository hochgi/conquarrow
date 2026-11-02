/**
 * Core scenarios for docs/spec/heuristic-finishes/heuristic-finishes.core.feature
 * (P81 — the heuristic seat finishes matches).
 *
 * Real late-game positions come from the committed `mirror-s1` fixture; the
 * staging board is constructed on the generated tiling. Every premise is
 * checked by a test-side oracle before the seat is asked anything.
 */

import { describe, expect, it } from 'vitest';
import { speed } from '@conquarrow/contracts';
import type { GameState, Move, PlayerId } from '@conquarrow/contracts';
import { edgeDistance } from '../src/botEvaluate';
import { chooseTurnBeam } from '../src/botSearch';
import { playBotTurn } from '../src/opponent';
import {
  CARVE_MOVE,
  entryDistance,
  foldPlan,
  fullRoundsAt,
  geometry,
  headsOf,
  largestGroupArrow,
  mirrorAt,
  planIsLegalSequence,
  planTerminates,
  ROUND_160_MOVE,
  ROUND_60_MOVE,
  rules,
  seatsOf,
  specCarveCandidates,
  specDominant,
  stagingBoard,
  territoryOf,
} from './heuristic-finishes.support';

/** Generous: today a red run plays all 30 rounds (~1.5 s a turn); the fix ends in ~40 s. */
const SELF_PLAY_TIMEOUT = 600_000;
const SEARCH_TIMEOUT = 60_000;
const SELF_PLAY_ROUNDS = 30;

describe('heuristic-finishes core', () => {
  describe('Rule: The seed-1 hoarding position no longer stalls', () => {
    it.each([
      { round: 60, move: ROUND_60_MOVE, heads: 91 },
      { round: 160, move: ROUND_160_MOVE, heads: 403 },
    ])(
      'The archived seed-1 mirror position at round $round takes a step',
      ({ round, move, heads }) => {
        const state = mirrorAt(move);
        const { A, B } = seatsOf(state);
        expect(fullRoundsAt(move)).toBe(round);
        expect(state.activePlayer).toBe(A);
        expect(headsOf(state, A)).toBe(heads);
        expect(headsOf(state, B)).toBeLessThanOrEqual(5);

        const plan = chooseTurnBeam(geometry, rules, state, A);

        expect(plan.filter((m) => m.kind === 'step').length).toBeGreaterThanOrEqual(1);
        expect(planIsLegalSequence(state, plan)).toBe(true);
        expect(planTerminates(state, plan)).toBe(true);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: A dominant seat takes enemy ground it can reach this turn', () => {
    it(
      "A carve through the enemy's territory is played",
      () => {
        const state = mirrorAt(CARVE_MOVE);
        const { A, B } = seatsOf(state);
        expect(state.activePlayer).toBe(A);
        expect(headsOf(state, A)).toBeGreaterThanOrEqual(2 * headsOf(state, B));
        // A stack S1 on A's territory with a loop of ≥ 3 steps that leaves A's
        // territory, crosses an arrow of B's territory and lands back on A's.
        const crossing = specCarveCandidates(state, A).filter(
          (c) => c.path.length >= 3 && c.path.some((a) => state.territory.get(a) === B),
        );
        const s1 = crossing[0]?.from;
        expect(s1).toBeDefined();
        if (s1 === undefined) return;
        expect(state.territory.get(s1)).toBe(A);
        const group = state.groups.get(s1);
        expect(group !== undefined && speed(group.heads) - group.spent >= 3).toBe(true);

        const plan = chooseTurnBeam(geometry, rules, state, A);
        const after = foldPlan(state, plan);

        expect(territoryOf(after, A)).toBeGreaterThan(territoryOf(state, A));
        expect(territoryOf(after, B)).toBeLessThan(territoryOf(state, B));
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: A dominant seat with nothing in reach walks toward the enemy', () => {
    it(
      'An interior stack walks toward the arrow that borders the enemy',
      () => {
        const { state, A, s1, entries } = stagingBoard();
        expect(specDominant(state, A)).toBe(true);
        // No loop from any of A's stacks this turn — claiming or not.
        expect(specCarveCandidates(state, A, { includeNonClaiming: true })).toEqual([]);
        const group = state.groups.get(s1);
        expect(group?.heads ?? 0).toBeGreaterThanOrEqual(4);
        expect(state.territory.get(s1)).toBe(A);
        const before = entryDistance(state, A, s1, entries);
        expect(before).toBeGreaterThan(1);
        // S1 is A's only stack and cannot reach its territory's edge this turn,
        // so every plan A could play stays on own ground: all are quiet.
        expect([...state.groups.values()].filter((g) => g.owner === A)).toHaveLength(1);
        expect(edgeDistance(geometry, state, A, s1)).toBeGreaterThan(speed(group?.heads ?? 1));
        const trailBefore = [...(state.trails.get(A) ?? [])].map(String).toSorted();

        const plan = chooseTurnBeam(geometry, rules, state, A);

        expect(movesOnOwnGroundOnly(state, plan, A)).toBe(true);
        const after = foldPlan(state, plan);
        const s1After = largestGroupArrow(after, A);
        expect(entryDistance(after, A, s1After, entries)).toBeLessThan(before);
        expect([...(after.trails.get(A) ?? [])].map(String).toSorted()).toEqual(trailBefore);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('Rule: A won position is converted, not hoarded', () => {
    it(
      "Self-play from a dominant position takes the loser's ground and ends the match",
      () => {
        let state = mirrorAt(ROUND_160_MOVE);
        const { A, B } = seatsOf(state);
        const leader = headsOf(state, A) > headsOf(state, B) ? A : B;
        let rounds = 0;
        while (state.winner === undefined && rounds < SELF_PLAY_ROUNDS) {
          const mover = state.activePlayer;
          const turn = playBotTurn(geometry, rules, state, mover);
          expect(turn.moves.length).toBeGreaterThan(0);
          let at = state;
          for (const move of turn.moves) {
            if (at.winner !== undefined) break;
            const next = rules.apply(at, move);
            if (move.kind === 'endTurn' && next.activePlayer === next.players[0]) rounds += 1;
            at = next;
          }
          state = at;
        }

        expect(state.winner).toBeDefined();
        expect(state.winner).toBe(leader);
      },
      SELF_PLAY_TIMEOUT,
    );
  });

  describe('Rule: Determinism', () => {
    it(
      'The same position planned twice gives the same plan',
      () => {
        const state = mirrorAt(ROUND_160_MOVE);
        const { A } = seatsOf(state);
        const first = chooseTurnBeam(geometry, rules, state, A);
        const second = chooseTurnBeam(geometry, rules, state, A);
        expect(second).toEqual(first);
      },
      SEARCH_TIMEOUT,
    );
  });
});

/** Every step of `plan` leaves from and lands on `me`'s territory as it stands then. */
const movesOnOwnGroundOnly = (state: GameState, plan: readonly Move[], me: PlayerId): boolean => {
  let at = state;
  for (const move of plan) {
    if (move.kind === 'step') {
      if (at.territory.get(move.from) !== me || at.territory.get(move.exit) !== me) return false;
    }
    at = rules.apply(at, move);
  }
  return true;
};
