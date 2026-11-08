/**
 * EARS invariants for docs/spec/heuristic-loop-of-doom/heuristic-loop-of-doom.md
 * (P91 — sortie credit pays only a sortie that grew).
 *
 * Table-driven sweeps (this repo has no fast-check). Invariants 1 and 2 are
 * one property over every complete reachable in one step from the loop
 * fixtures' origins (O₀ and O₁ of L1 and L2, replayed and minimal), plus the
 * logged turn into the ring, the close home and L1's ring turn: the sweep
 * holds terminals that grew and terminals that did not, each with a positive
 * `sortieCredit`, so neither branch is vacuous.
 */

import { describe, expect, it } from 'vitest';
import type { GameState, Move, PlayerId } from '@conquarrow/contracts';
import { chooseTurnBeamWithBudget, planKey } from '../src/botSearch';
import { liveSortieCredit, sortieCredit, sortieGrew } from '../src/botTempo';
import {
  closeHomeFromRing,
  completesFrom,
  geometry,
  L1_RING_TURN,
  l1Units,
  LOOP_FIXTURES,
  minimal,
  otherSeat,
  replayed,
  ringStart,
  rules,
  syntheticTrail,
  trailSizeOf,
  turnIntoRing,
  withTrails,
  type LoopFixture,
  type LoopPosition,
} from './heuristic-loop-of-doom.support';

const SWEEP_TIMEOUT = 600_000;
const SEARCH_TIMEOUT = 120_000;

const credit = sortieCredit.bind(undefined, geometry);

type Case = {
  readonly label: string;
  readonly me: PlayerId;
  readonly origin: GameState;
  readonly terminal: GameState;
};

const positionsOf = (f: LoopFixture): readonly (readonly [string, LoopPosition])[] => [
  ['replayed', replayed(f)],
  ['minimal', minimal(f)],
];

/** The sweep of invariants 1–2: origin → terminal pairs over both fixtures. */
const sweep = (): readonly Case[] => {
  const out: Case[] = [];
  for (const f of LOOP_FIXTURES) {
    for (const [name, start] of positionsOf(f)) {
      const { me, o0, t1, o1 } = ringStart(f, start);
      const { after: closed } = closeHomeFromRing(f, t1, me);
      const fromO1: (readonly Move[])[] = f.id === 'L1' ? [L1_RING_TURN] : [];
      for (const [at, origin, plans] of [
        ['O₀', o0, [turnIntoRing(f)]],
        ['O₁', o1, fromO1],
      ] as const) {
        for (const c of completesFrom(origin, plans)) {
          out.push({ label: `${f.id} ${name} ${at}: ${c.label}`, me, origin, terminal: c.terminal });
        }
      }
      out.push({ label: `${f.id} ${name} O₁: close home`, me, origin: o1, terminal: closed });
    }
  }
  return out;
};

describe('heuristic-loop-of-doom invariants', () => {
  it(
    'EARS 1–2: liveSortieCredit is 0 unless the trail grew, and exactly sortieCredit when it did',
    () => {
      const cases = sweep();
      const grewPaid = cases.filter(
        (c) => trailSizeOf(c.terminal, c.me) > trailSizeOf(c.origin, c.me) && credit(c.terminal, c.me) > 0,
      );
      const stillPaid = cases.filter(
        (c) => trailSizeOf(c.terminal, c.me) <= trailSizeOf(c.origin, c.me) && credit(c.terminal, c.me) > 0,
      );
      if (grewPaid.length === 0 || stillPaid.length === 0) {
        throw new Error('setup: the sweep does not hold both a grown and an ungrown credited terminal');
      }

      const wrong: string[] = [];
      for (const c of cases) {
        const grew = trailSizeOf(c.terminal, c.me) > trailSizeOf(c.origin, c.me);
        const want = grew ? credit(c.terminal, c.me) : 0;
        const got = liveSortieCredit(geometry, c.origin, c.terminal, c.me);
        if (sortieGrew(c.origin, c.terminal, c.me) !== grew || got !== want) {
          wrong.push(`${c.label}: grew ${String(grew)}, want ${String(want)}, got ${String(got)}`);
        }
      }
      expect(wrong).toEqual([]);
    },
    SWEEP_TIMEOUT,
  );

  // EARS 3: the nested search's plans, recorded on main `229892d` (before P91),
  // at O₀ and O₁ of both fixtures. Observable without private access: if the
  // nested search began adding sortie credit, these plans would move.
  const NESTED_BEFORE_P91: Readonly<Record<string, Readonly<Record<'O₀' | 'O₁', string>>>> = {
    L1: {
      'O₀': 'step:tiling:a:4,1,2>tiling:a:4,0,0:2|step:tiling:a:4,0,0>tiling:a:5,0,0:2|endTurn',
      'O₁':
        'step:tiling:a:3,0,0>tiling:a:4,0,0:2|step:tiling:a:3,0,0>tiling:a:4,0,2:2|step:tiling:a:4,0,0>tiling:a:5,0,0:2|endTurn',
    },
    L2: {
      'O₀': 'step:tiling:a:-1,3,1>tiling:a:-2,4,2:2|step:tiling:a:-2,4,2>tiling:a:-2,3,2:2|endTurn',
      'O₁': 'step:tiling:a:-2,3,1>tiling:a:-3,4,1:2|step:tiling:a:-3,4,1>tiling:a:-4,5,1:2|endTurn',
    },
  };

  describe.each(LOOP_FIXTURES)('EARS 3: the nested search adds no sortie credit ($id)', (f) => {
    it.each(['replayed', 'minimal'] as const)(
      '%s position: the nested plans at O₀ and O₁ are those of main 229892d',
      (name) => {
        const start = name === 'replayed' ? replayed(f) : minimal(f);
        const { me, o0, o1 } = ringStart(f, start);
        const want = NESTED_BEFORE_P91[f.id];
        if (want === undefined) throw new Error(`setup: no recorded nested plans for ${f.id}`);
        const nested = (s: GameState): string =>
          planKey(chooseTurnBeamWithBudget(geometry, rules, s, me, { withReplies: false }));

        expect({ 'O₀': nested(o0), 'O₁': nested(o1) }).toEqual(want);
      },
      SEARCH_TIMEOUT,
    );
  });

  describe('EARS 4: sortieGrew and liveSortieCredit are pure and deterministic', () => {
    it(
      'neither mutates its inputs, and each gives the same answer twice',
      () => {
        const { me, o0, t1, o1, t2 } = l1Units(credit);
        for (const [origin, terminal] of [
          [o0, t1],
          [o1, t2],
        ] as const) {
          const originBefore = structuredClone(origin);
          const terminalBefore = structuredClone(terminal);

          const grew = [sortieGrew(origin, terminal, me), sortieGrew(origin, terminal, me)];
          const live = [
            liveSortieCredit(geometry, origin, terminal, me),
            liveSortieCredit(geometry, origin, terminal, me),
          ];

          expect(grew[1]).toBe(grew[0]);
          expect(live[1]).toBe(live[0]);
          expect(origin).toEqual(originBefore);
          expect(terminal).toEqual(terminalBefore);
        }
      },
      SEARCH_TIMEOUT,
    );

    it(
      "sortieGrew reads only me's two trail sizes",
      () => {
        const { me, o0, t1, o1, t2 } = l1Units(credit);
        const other = otherSeat(o0, me);
        const wrong: string[] = [];
        for (const [label, origin, terminal] of [
          ['O₀ → T₁', o0, t1],
          ['O₁ → T₂', o1, t2],
          ['T₁ → O₀', t1, o0],
        ] as const) {
          const want = sortieGrew(origin, terminal, me);
          const mine = (s: GameState) => s.trails.get(me) ?? new Set();
          const variants: readonly (readonly [string, GameState, GameState])[] = [
            ['no groups', { ...origin, groups: new Map() }, { ...terminal, groups: new Map() }],
            ['no territory', { ...origin, territory: new Map() }, { ...terminal, territory: new Map() }],
            [
              'another seat trails 0 → 9',
              withTrails(origin, new Map([[me, mine(origin)], [other, syntheticTrail(0, 1)]])),
              withTrails(terminal, new Map([[me, mine(terminal)], [other, syntheticTrail(9, 1)]])),
            ],
            [
              "me's trails replaced by other arrows of the same size",
              withTrails(origin, new Map([[me, syntheticTrail(mine(origin).size, 2)]])),
              withTrails(terminal, new Map([[me, syntheticTrail(mine(terminal).size, 3)]])),
            ],
          ];
          for (const [what, o, t] of variants) {
            if (sortieGrew(o, t, me) !== want) wrong.push(`${label}, ${what}`);
          }
        }
        expect(wrong).toEqual([]);
      },
      SEARCH_TIMEOUT,
    );
  });
});
