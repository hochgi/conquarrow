/**
 * EARS invariants for docs/spec/heuristic-never-idle/heuristic-never-idle.md.
 *
 * Table-driven sweeps over the positions the diagnosis found (13 playtest
 * passes, 2 mirror-s3 passes, the P53 pass boards) — this repo has no
 * fast-check. Invariant 5 is the replay layer: every logged heuristic turn
 * that already steps is reproduced move for move.
 */

import { describe, expect, it } from 'vitest';
import { speed } from '@conquarrow/contracts';
import type { ArrowId, GameState, Group, PlayerId } from '@conquarrow/contracts';
import { hypothesiseChair } from '../src/botReply';
import { chooseTurnBeam, chooseTurnBeamWithBudget } from '../src/botSearch';
import {
  boxedAfterOccupy,
  geometry,
  hasStep,
  loggedTurn,
  MIRROR_S3_PASS_TURNS,
  mirrorS3,
  passIsBestPosition,
  passTurnAt,
  passWithManyStepsPosition,
  planIsLegalSequence,
  planTerminates,
  PLAYTEST_PASS_TURNS,
  playtest,
  rules,
  sameMoves,
  shuffleCloseMaps,
  stepIsLegal,
  turnStarts,
  type Replay,
  type SeatLabel,
} from './heuristic-never-idle.support';

const SWEEP_TIMEOUT = 600_000;

type Position = { readonly label: string; readonly state: GameState; readonly me: PlayerId };

/** Every position where the pre-P84 live seat passed with a step legal. */
const passSample = (): readonly Position[] => [
  ...PLAYTEST_PASS_TURNS.map(({ round, seat, index }) => {
    const t = passTurnAt(playtest(), index, seat, round);
    return { label: `playtest@${String(index)}`, state: t.state, me: t.me };
  }),
  ...MIRROR_S3_PASS_TURNS.map(({ round, index }) => {
    const t = passTurnAt(mirrorS3(), index, 'A', round);
    return { label: `mirror-s3@${String(index)}`, state: t.state, me: t.me };
  }),
  (() => {
    const { state, Bot } = passIsBestPosition();
    return { label: 'passIsBest', state, me: Bot };
  })(),
  (() => {
    const { state, Bot } = passWithManyStepsPosition();
    return { label: 'passWithManySteps', state, me: Bot };
  })(),
];

/** `me`'s stacks all spent: no step is legal, the turn is still `me`'s. */
const exhausted = (state: GameState, me: PlayerId): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of state.groups) {
    groups.set(arrow, group.owner === me ? { ...group, spent: speed(group.heads) } : group);
  }
  return { ...state, groups };
};

/** Seat-turns that already step in the log: the pre-P84 output (spec "Fixture"). */
const steppedTurnsMismatch = (
  replay: Replay,
  seats: readonly SeatLabel[],
  from: number,
  to: number,
  stride = 1,
): { readonly checked: number; readonly mismatches: readonly string[] } => {
  const stepped = turnStarts(replay, seats, from, to)
    .filter((t) => hasStep(loggedTurn(replay, t.index)))
    .filter((_, i) => i % stride === 0);
  const mismatches: string[] = [];
  for (const t of stepped) {
    const plan = chooseTurnBeam(geometry, rules, t.state, t.me);
    if (!sameMoves(plan, loggedTurn(replay, t.index))) {
      mismatches.push(`${replay.name} ${t.seat} r${String(t.round)} @${String(t.index)}`);
    }
  }
  return { checked: stepped.length, mismatches };
};

describe('heuristic-never-idle invariants', () => {
  it(
    "1. While it is the live seat's turn and a step is legal, the system shall return a plan from chooseTurnBeam that contains at least one step.",
    () => {
      const idle: string[] = [];
      for (const p of passSample()) {
        expect(stepIsLegal(p.state)).toBe(true);
        if (!hasStep(chooseTurnBeam(geometry, rules, p.state, p.me))) idle.push(p.label);
      }
      expect(idle).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    "2. While it is the live seat's turn and no step is legal, the system shall return exactly [endTurn] from chooseTurnBeam.",
    () => {
      const boxed = boxedAfterOccupy();
      const positions: Position[] = [
        { label: 'boxedAfterOccupy', state: hypothesiseChair(boxed.state, boxed.E), me: boxed.E },
        ...passSample()
          .filter((_, i) => i % 3 === 0)
          .map((p) => ({ label: `${p.label} exhausted`, state: exhausted(p.state, p.me), me: p.me })),
      ];
      for (const p of positions) {
        expect(p.state.activePlayer).toBe(p.me);
        expect(stepIsLegal(p.state)).toBe(false);
        expect(chooseTurnBeam(geometry, rules, p.state, p.me)).toEqual([{ kind: 'endTurn' }]);
      }
    },
    SWEEP_TIMEOUT,
  );

  it(
    "3. When chooseTurnBeam returns, every move in the plan shall be legal in sequence from the turn's start state, and the plan shall end the seat's turn or the match.",
    () => {
      const bad: string[] = [];
      for (const p of passSample()) {
        const plan = chooseTurnBeam(geometry, rules, p.state, p.me);
        if (!planIsLegalSequence(p.state, plan) || !planTerminates(p.state, plan)) bad.push(p.label);
      }
      expect(bad).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    '4. The system shall return the same plan for the same (state, me) on every call (no clock, no randomness, no iteration-order dependence).',
    () => {
      for (const p of passSample().filter((_, i) => i % 4 === 0)) {
        const first = chooseTurnBeam(geometry, rules, p.state, p.me);
        expect(chooseTurnBeam(geometry, rules, p.state, p.me)).toEqual(first);
        expect(chooseTurnBeam(geometry, rules, shuffleCloseMaps(p.state), p.me)).toEqual(first);
      }
    },
    SWEEP_TIMEOUT,
  );

  it(
    "5. If the live search's chosen plan already contains a step, then the system shall return that plan unchanged (replay: every stepped heuristic turn of mirror-s3, a third of playtest rounds 21+).",
    () => {
      // Playtest rounds 1–20 are the core scenario; this samples every 3rd of
      // the rest (late beams cost seconds each) and all of mirror-s3.
      const late = steppedTurnsMismatch(playtest(), ['A', 'B'], 21, Number.POSITIVE_INFINITY, 3);
      const mirror = steppedTurnsMismatch(mirrorS3(), ['A', 'B'], 1, Number.POSITIVE_INFINITY);
      expect(late.checked).toBeGreaterThan(5);
      expect(mirror.checked).toBeGreaterThan(10);
      expect([...late.mismatches, ...mirror.mismatches]).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    '6. While withReplies is false, the system shall return the same plan as it did before P84 (the nested search may still return [endTurn] with a step legal).',
    () => {
      for (const { state, Bot } of [passIsBestPosition(), passWithManyStepsPosition()]) {
        expect(stepIsLegal(state)).toBe(true);
        expect(chooseTurnBeamWithBudget(geometry, rules, state, Bot, { withReplies: false })).toEqual([
          { kind: 'endTurn' },
        ]);
      }
      const { state, E } = boxedAfterOccupy();
      expect(
        chooseTurnBeamWithBudget(geometry, rules, hypothesiseChair(state, E), E, { withReplies: false }),
      ).toEqual([{ kind: 'endTurn' }]);
    },
    SWEEP_TIMEOUT,
  );
});
