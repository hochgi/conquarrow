/**
 * EARS invariants for docs/spec/heuristic-tempo-horizon/heuristic-tempo-horizon.md.
 *
 * Table-driven sweeps (this repo has no fast-check) over the 43 fixture
 * positions, their one-step children, every heuristic turn start of the five
 * committed logs, and the small boards of the edge suite. The replay layer is
 * the logs themselves: every position is reached by replaying a committed
 * move list from `makeMatch`.
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId, GameState, Move, PlayerId } from '@conquarrow/contracts';
import { missionsOf } from '../src/botMission';
import { chooseTurnBeam, chooseTurnBeamWithBudget, evaluate, moveKey } from '../src/botSearch';
import {
  enemyTurnsToClose,
  interceptDistance,
  interceptOf,
  isSortieThreatened,
  safeWindow,
  sortieCredit,
  sortieOf,
  TEMPO_TURN_CAP,
} from '../src/botTempo';
import { chooseMove } from '../src/opponent';
import {
  allFixturePositions,
  compareArrowIds,
  cutLegalAgainst,
  geometry,
  groupsOf,
  hasStep,
  i1Slowed,
  INTERCEPT_FIXTURES,
  interceptPosition,
  legalSteps,
  loneEnemyAt,
  openTrailBoard,
  planIsLegalSequence,
  planTerminates,
  preP85Outputs,
  raceBoard,
  replayOf,
  rules,
  shuffleCloseMaps,
  SORTIE_FIXTURES,
  sortiePosition,
  specSortie,
  specSortieCredit,
  stepIsLegal,
  turnStarts,
  twoRacesBoard,
  underFireRaceBoard,
  withGroups,
  type FixturePosition,
  type LogName,
} from './heuristic-tempo-horizon.support';
import { cutVsDirtPosition, originFindingsOf } from './mission-and-staging.support';

const SWEEP_TIMEOUT = 900_000;

type Reading = { readonly label: string; readonly state: GameState; readonly me: PlayerId };

/** The edge suite's small boards, each read for the seat it was built for. */
const smallBoards = (): readonly Reading[] => {
  const out: Reading[] = [];
  for (const [d, heads] of [
    [1, 1],
    [3, 1],
    [3, 3],
  ] as const) {
    const b = loneEnemyAt(d, heads);
    out.push({ label: `loneEnemy d${String(d)} h${String(heads)}`, state: b.state, me: b.me });
  }
  for (const [length, home, heads] of [
    [1, 4, 1],
    [2, 2, 1],
    [2, 3, 1],
    [3, 3, 1],
    [4, 3, 2],
  ] as const) {
    const b = openTrailBoard(length, home, heads);
    out.push({ label: `openTrail ${String(length)}/${String(home)}/${String(heads)}`, state: b.state, me: b.me });
  }
  const race = raceBoard(3, 2, 2);
  out.push({ label: 'raceBoard', state: race.state, me: race.me });
  const two = twoRacesBoard(3, 2);
  out.push({ label: 'twoRaces', state: two.state, me: two.A });
  const fire = underFireRaceBoard();
  out.push({ label: 'underFireRace', state: fire.state, me: fire.me });
  const slowed = i1Slowed();
  out.push({ label: 'i1Slowed', state: slowed.state, me: slowed.me });
  return out;
};

/** Each sortie fixture origin and its first four one-step children (by move key): terminals with and without open trails. */
const sortieTerminals = (): readonly Reading[] => {
  const out: Reading[] = [];
  for (const fixture of SORTIE_FIXTURES) {
    const { id, state, me } = sortiePosition(fixture);
    out.push({ label: id, state, me });
    const steps = legalSteps(state).toSorted((a, b) => {
      const ka = moveKey(a);
      const kb = moveKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    for (const [i, m] of steps.slice(0, 4).entries()) {
      out.push({ label: `${id}+${String(i)}`, state: rules.apply(state, m), me });
    }
  }
  return out;
};

const readingSample = (): readonly Reading[] => [...smallBoards(), ...sortieTerminals()];

/** Every heuristic seat-turn start of the five committed logs (every `stride`-th). */
const logTurnStarts = (stride: number): readonly Reading[] => {
  const logs: readonly LogName[] = [
    'playtest-2026-11-02',
    'playtest-2026-11-03',
    'mirror-p85-s1',
    'mirror-p85-s2',
    'mirror-p85-s3',
  ];
  return logs.flatMap((log) =>
    turnStarts(replayOf(log), ['A', 'B'], 1, Number.POSITIVE_INFINITY)
      .filter((_, i) => i % stride === 0)
      .map((t) => ({ label: `${log}@${String(t.index)}`, state: t.state, me: t.me })),
  );
};

/** Arrows to read W over: the projected sortie when there is one, else every arrow of `me`'s groups. */
const windowTargets = (state: GameState, me: PlayerId): readonly ArrowId[] =>
  specSortie(state, me)?.projected ?? groupsOf(state, me).map(([a]) => a);

/** Live plans, memoised per fixture position across invariants 9 and 10. */
const livePlans = new Map<string, readonly Move[]>();
const livePlan = (p: FixturePosition): readonly Move[] => {
  const hit = livePlans.get(p.id);
  if (hit !== undefined) return hit;
  const plan = chooseTurnBeam(geometry, rules, p.state, p.me);
  livePlans.set(p.id, plan);
  return plan;
};

describe('heuristic-tempo-horizon invariants', () => {
  it(
    '1. The system shall return the same plan from chooseTurnBeam for the same (state, me) on every call (no clock, no randomness, no iteration-order dependence, no state kept between calls).',
    () => {
      const sample = [
        ...INTERCEPT_FIXTURES.filter((_, i) => i % 2 === 0).map((f) => interceptPosition(f)),
        ...SORTIE_FIXTURES.filter((_, i) => i % 9 === 0).map((f) => sortiePosition(f)),
      ];
      for (const p of sample) {
        const first = chooseTurnBeam(geometry, rules, p.state, p.me);
        // Interleave another position's search: no state may carry over.
        chooseTurnBeam(geometry, rules, sample[0]?.state ?? p.state, sample[0]?.me ?? p.me);
        expect(chooseTurnBeam(geometry, rules, p.state, p.me), p.id).toEqual(first);
        expect(chooseTurnBeam(geometry, rules, shuffleCloseMaps(p.state), p.me), p.id).toEqual(first);
      }
    },
    SWEEP_TIMEOUT,
  );

  it(
    '2. The system shall return from every botTempo reading a value that depends only on its arguments.',
    () => {
      const read = (state: GameState, me: PlayerId): unknown => {
        const targets = windowTargets(state, me);
        const intercept = interceptOf(geometry, state, me);
        return {
          window: safeWindow(geometry, state, me, targets, TEMPO_TURN_CAP),
          sortie: sortieOf(geometry, state, me),
          credit: sortieCredit(geometry, state, me),
          threatened: isSortieThreatened(geometry, state, me, targets),
          close: state.players.filter((p) => p !== me).map((p) => enemyTurnsToClose(geometry, state, p)),
          intercept:
            intercept === undefined
              ? undefined
              : {
                  enemy: intercept.enemy,
                  targets: intercept.targets,
                  turns: intercept.turns,
                  enemyTurns: intercept.enemyTurns,
                  stepsTo: groupsOf(state, me).map(([a]) => intercept.stepsTo(a)),
                  distance: interceptDistance(state, me, intercept),
                },
        };
      };
      for (const r of readingSample().filter((_, i) => i % 3 === 0)) {
        const first = read(r.state, r.me);
        expect(read(r.state, r.me), r.label).toEqual(first);
        expect(read(shuffleCloseMaps(r.state), r.me), r.label).toEqual(first);
      }
    },
    SWEEP_TIMEOUT,
  );

  it(
    '3. When sortieCredit reads a terminal with no open trail of me, no tip, turns to land > SORTIE_TURN_CAP, elapsed + turns to land > SORTIE_TOTAL_CAP, or W ≤ turns to land, the system shall return 0.',
    () => {
      const zero = readingSample().filter((r) => specSortieCredit(r.state, r.me) === 0);
      expect(zero.length).toBeGreaterThan(10);
      const wrong = zero.filter((r) => sortieCredit(geometry, r.state, r.me) !== 0).map((r) => r.label);
      expect(wrong).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    '4. Otherwise sortieCredit shall return exactly SORTIE_CREDIT × loot(shares, arrows) of the projected sortie, which is ≥ 0.',
    () => {
      const credited = readingSample().filter((r) => specSortieCredit(r.state, r.me) > 0);
      expect(credited.length).toBeGreaterThan(3);
      const wrong = credited
        .filter((r) => sortieCredit(geometry, r.state, r.me) !== specSortieCredit(r.state, r.me))
        .map((r) => r.label);
      expect(wrong).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    '5. The system shall return from safeWindow a value no larger when an enemy group is added, and no smaller when one is removed.',
    () => {
      const bad: string[] = [];
      for (const r of readingSample().filter((_, i) => i % 2 === 0)) {
        const targets = windowTargets(r.state, r.me);
        const enemy = r.state.players.find((p) => p !== r.me);
        if (enemy === undefined || targets.length === 0) continue;
        const base = safeWindow(geometry, r.state, r.me, targets, TEMPO_TURN_CAP);
        const near = targets[0];
        if (near === undefined) continue;
        const free = [...geometry.window(geometry.origin(near), 3).arrows]
          .filter((a) => !r.state.groups.has(a) && r.state.territory.get(a) !== r.me)
          .toSorted(compareArrowIds)[0];
        if (free !== undefined) {
          const added = withGroups(r.state, [[free, enemy, 1]]);
          if (safeWindow(geometry, added, r.me, targets, TEMPO_TURN_CAP) > base) bad.push(`${r.label} +${String(free)}`);
        }
        for (const [at, group] of r.state.groups) {
          if (group.owner === r.me) continue;
          const groups = new Map(r.state.groups);
          groups.delete(at);
          const removed = { ...r.state, groups };
          if (safeWindow(geometry, removed, r.me, targets, TEMPO_TURN_CAP) < base) bad.push(`${r.label} -${String(at)}`);
        }
      }
      expect(bad).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    "6. While a cut against some enemy is legal at the origin, or bank is among the missions, the system shall not include intercept in the live seat's missions.",
    () => {
      const cut = cutVsDirtPosition();
      const fire = underFireRaceBoard();
      const positions: readonly Reading[] = [
        { label: 'cutVsDirt', state: cut.state, me: cut.Bot },
        { label: 'underFireRace', state: fire.state, me: fire.me },
        ...allFixturePositions().map((p) => ({ label: p.id, state: p.state, me: p.me })),
      ];
      let guarded = 0;
      const bad: string[] = [];
      for (const r of positions) {
        const missions = missionsOf(
          geometry,
          rules,
          r.state,
          r.me,
          originFindingsOf(r.state, r.me),
          interceptOf(geometry, r.state, r.me),
        );
        const cutLegal = r.state.players.some((p) => p !== r.me && cutLegalAgainst(r.state, r.me, p));
        if (!cutLegal && !missions.includes('bank')) continue;
        guarded += 1;
        // MissionKind gains 'intercept' in phase 3 (decision 4); read the list as strings.
        const kinds: readonly string[] = missions;
        if (kinds.includes('intercept')) bad.push(r.label);
      }
      expect(guarded).toBeGreaterThanOrEqual(2);
      expect(bad).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    "7. When interceptOf returns a race, the system shall have turns ≤ enemyTurns ≤ TEMPO_TURN_CAP, and every target shall be an arrow of that enemy's trail holding no group of that enemy.",
    () => {
      const bad: string[] = [];
      let races = 0;
      for (const r of [...logTurnStarts(2), ...smallBoards()]) {
        const race = interceptOf(geometry, r.state, r.me);
        if (race === undefined) continue;
        races += 1;
        const trail = r.state.trails.get(race.enemy);
        const ok =
          race.turns <= race.enemyTurns &&
          race.enemyTurns <= TEMPO_TURN_CAP &&
          race.targets.length > 0 &&
          race.targets.every((a) => trail?.has(a) === true && r.state.groups.get(a)?.owner !== race.enemy) &&
          race.targets.every((a, i, all) => i === 0 || compareArrowIds(all[i - 1] ?? a, a) < 0);
        if (!ok) bad.push(r.label);
      }
      expect(races).toBeGreaterThanOrEqual(INTERCEPT_FIXTURES.length);
      expect(bad).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    '8. While withReplies is false, the system shall return the same plan from chooseTurnBeamWithBudget as it did before P85; and chooseMove and evaluate shall return what they did before P85.',
    () => {
      const recorded = preP85Outputs();
      const changed: string[] = [];
      for (const p of allFixturePositions()) {
        const pre = recorded.get(p.id);
        if (pre === undefined) throw new Error(`setup: no pre-P85 output for ${p.id}`);
        const nested = chooseTurnBeamWithBudget(geometry, rules, p.state, p.me, { withReplies: false });
        if (JSON.stringify(nested) !== JSON.stringify(pre.nested)) changed.push(`${p.id} nested`);
        if (JSON.stringify(chooseMove(geometry, rules, p.state, p.me)) !== JSON.stringify(pre.chooseMove)) {
          changed.push(`${p.id} chooseMove`);
        }
        if (evaluate(geometry, p.state, p.me, rules) !== pre.evaluate) changed.push(`${p.id} evaluate`);
      }
      expect(recorded.size).toBe(INTERCEPT_FIXTURES.length + SORTIE_FIXTURES.length);
      expect(changed).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    "9. While it is the live seat's turn and a step is legal, the system shall return a plan that contains at least one step (P84, unchanged).",
    () => {
      const idle: string[] = [];
      for (const p of allFixturePositions()) {
        expect(stepIsLegal(p.state), p.id).toBe(true);
        if (!hasStep(livePlan(p))) idle.push(p.id);
      }
      expect(idle).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  it(
    "10. When chooseTurnBeam returns, every move in the plan shall be legal in sequence from the turn's start state, and the plan shall end the seat's turn or the match.",
    () => {
      const bad: string[] = [];
      for (const p of allFixturePositions()) {
        const plan = livePlan(p);
        if (!planIsLegalSequence(p.state, plan) || !planTerminates(p.state, plan)) bad.push(p.id);
      }
      expect(bad).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );
});
