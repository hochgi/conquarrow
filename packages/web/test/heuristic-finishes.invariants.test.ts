/**
 * EARS invariants for docs/spec/heuristic-finishes/heuristic-finishes.md.
 *
 * Table-driven sweeps over the committed `mirror-s1` fixture plus the
 * constructed boards — this repo has no fast-check (same style as
 * bot-turn-search.invariants.test.ts).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { endTurn, movesEqual } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PlayerId, VertexId } from '@conquarrow/contracts';
import { campaignTarget } from '../src/botClose';
import { grainDistanceFromAny, grainDistanceToAny } from '../src/botEvaluate';
import { carvePlans, isQuietPlan, stagingWalk } from '../src/botFinish';
import { CAMPAIGN_DIST_CAP, remainingPath } from '../src/botMission';
import { DEFAULT_REPLY_DIST_CAP, reachableEnemySeats } from '../src/botReply';
import { chooseTurnBeam, evaluate, finalistReplyScore, oneStepPerExit } from '../src/botSearch';
import {
  claimEstimate,
  cutReplyBoard,
  dominanceBoard,
  fiveHeadStackBoard,
  foldPlan,
  geometry,
  mirrorAt,
  mirrorTurnStarts,
  pathOfPlan,
  planIsLegalSequence,
  planTerminates,
  readReply,
  rules,
  sampleTurnStarts,
  seatsOf,
  shuffleCloseMaps,
  specCampaignTarget,
  specCarveCandidates,
  specDominant,
  specQuiet,
  specRemainingPath,
  specReplayCarve,
  stagingBoard,
  stagingMergeBoard,
  territoryOf,
} from './heuristic-finishes.support';

const here = dirname(fileURLToPath(import.meta.url));
const SWEEP_TIMEOUT = 300_000;

const compareArrows = (a: ArrowId, b: ArrowId): number =>
  String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

type Position = { readonly label: string; readonly state: GameState; readonly me: PlayerId };

const fixturePosition = (n: number): Position => {
  const state = mirrorAt(n);
  return { label: `mirror-s1@${String(n)}`, state, me: state.activePlayer };
};

/** Search sample: A's turn starts every 40th (0 … round 160) and two of B's. */
const searchSample = (): readonly Position[] =>
  [...sampleTurnStarts('A', 40), ...sampleTurnStarts('B', 80)].map(fixturePosition);

/**
 * Dominant A turn starts that hold claiming loops (rounds ~60 to 160). Pinned
 * rather than filtered: the loop oracle costs seconds per late position.
 */
const CARVE_MOVES = [382, 534, 708, 749, 774, 806, 820] as const;

const carveSample = (): readonly Position[] =>
  CARVE_MOVES.map(fixturePosition).filter((p) => specDominant(p.state, p.me));

const nonDominantSample = (): readonly Position[] => {
  const fromFixture = [...sampleTurnStarts('A', 20), ...sampleTurnStarts('B', 20)]
    .map(fixturePosition)
    .filter((p) => !specDominant(p.state, p.me));
  const boards = [
    dominanceBoard(19, 10, 0),
    dominanceBoard(1, 0, 0),
    dominanceBoard(30, 10, 6),
  ].map((b, i) => ({ label: `dominanceBoard#${String(i)}`, state: b.state, me: b.A }));
  return [...fromFixture, ...boards];
};

const stagingSample = (): readonly Position[] => {
  const fixture = sampleTurnStarts('A', 10)
    .map(fixturePosition)
    .filter((p) => specDominant(p.state, p.me));
  const board = stagingBoard();
  const merge = stagingMergeBoard();
  return [
    ...fixture,
    { label: 'stagingBoard', state: board.state, me: board.A },
    { label: 'stagingMergeBoard', state: merge.state, me: merge.A },
  ];
};

const planCache = new Map<string, readonly Move[]>();
const beamPlan = (p: Position): readonly Move[] => {
  const cached = planCache.get(p.label);
  if (cached !== undefined) return cached;
  const plan = chooseTurnBeam(geometry, rules, p.state, p.me);
  planCache.set(p.label, plan);
  return plan;
};

const sortedTrail = (state: GameState, me: PlayerId): readonly string[] =>
  [...(state.trails.get(me) ?? [])].map(String).toSorted();

describe('heuristic-finishes invariants', () => {
  it(
    'Invariant 1: the system shall return the same move list for the same (state, me) on every call (no clock, no randomness, no iteration-order dependence).',
    () => {
      for (const p of searchSample()) {
        const plan = beamPlan(p);
        expect(chooseTurnBeam(geometry, rules, p.state, p.me), p.label).toEqual(plan);
        expect(chooseTurnBeam(geometry, rules, shuffleCloseMaps(p.state), p.me), p.label).toEqual(plan);
      }
      for (const p of [...carveSample(), ...stagingSample()]) {
        const shuffled = shuffleCloseMaps(p.state);
        expect(
          carvePlans(geometry, rules, shuffled, p.me).map((c) => c.moves),
          p.label,
        ).toEqual(carvePlans(geometry, rules, p.state, p.me).map((c) => c.moves));
        expect(stagingWalk(geometry, rules, shuffled, p.me)?.moves, p.label).toEqual(
          stagingWalk(geometry, rules, p.state, p.me)?.moves,
        );
      }
      const src = readFileSync(join(here, '../src/botFinish.ts'), 'utf8');
      expect(src).not.toContain('Date.now');
      expect(src).not.toContain('Math.random');
      expect(src).not.toContain('performance.now');
    },
    SWEEP_TIMEOUT,
  );

  it(
    "Invariant 2: when chooseTurnBeam returns, every move shall be legal in sequence from state, and the list shall end the seat's turn or the match.",
    () => {
      for (const p of searchSample()) {
        const plan = beamPlan(p);
        expect(planIsLegalSequence(p.state, plan), p.label).toBe(true);
        expect(planTerminates(p.state, plan), p.label).toBe(true);
      }
    },
    SWEEP_TIMEOUT,
  );

  it('Invariant 3: while a seat is not dominant, the system shall add no carve plan and return no staging walk.', () => {
    const sample = nonDominantSample();
    expect(sample.length).toBeGreaterThan(3);
    for (const p of sample) {
      expect(carvePlans(geometry, rules, p.state, p.me), p.label).toEqual([]);
      expect(stagingWalk(geometry, rules, p.state, p.me), p.label).toBeUndefined();
    }
  });

  it(
    "Invariant 4: when a carve plan is returned, the seat's territory after it shall be larger than before it.",
    () => {
      let carves = 0;
      for (const p of carveSample()) {
        for (const plan of carvePlans(geometry, rules, p.state, p.me)) {
          carves += 1;
          expect(planIsLegalSequence(p.state, plan.moves), p.label).toBe(true);
          expect(planTerminates(p.state, plan.moves), p.label).toBe(true);
          const after = foldPlan(p.state, plan.moves);
          expect(territoryOf(plan.state, p.me), p.label).toBe(territoryOf(after, p.me));
          expect(territoryOf(after, p.me), p.label).toBeGreaterThan(territoryOf(p.state, p.me));
        }
      }
      expect(carves).toBeGreaterThan(0);
    },
    SWEEP_TIMEOUT,
  );

  it(
    "Invariant 5: when a carve plan is added to the search, its claim estimate shall include at least one arrow of another seat's territory.",
    () => {
      let carves = 0;
      for (const p of carveSample()) {
        for (const plan of carvePlans(geometry, rules, p.state, p.me)) {
          carves += 1;
          const path = pathOfPlan(plan.moves);
          expect(path, p.label).toBeDefined();
          if (path === undefined) continue;
          const claim = claimEstimate(p.state, p.me, path.path);
          expect(
            claim.some((a) => {
              const owner = p.state.territory.get(a);
              return owner !== undefined && owner !== p.me;
            }),
            p.label,
          ).toBe(true);
        }
      }
      expect(carves).toBeGreaterThan(0);
    },
    SWEEP_TIMEOUT,
  );

  it(
    "Invariant 6: when a staging walk is returned, every step shall start and end on the mover's own territory, and the mover's trail shall be unchanged.",
    () => {
      let walks = 0;
      for (const p of stagingSample()) {
        const walk = stagingWalk(geometry, rules, p.state, p.me);
        if (walk === undefined) continue;
        walks += 1;
        expect(planIsLegalSequence(p.state, walk.moves), p.label).toBe(true);
        let at = p.state;
        for (const move of walk.moves) {
          if (move.kind === 'step') {
            expect(at.territory.get(move.from), p.label).toBe(p.me);
            expect(at.territory.get(move.exit), p.label).toBe(p.me);
          }
          at = rules.apply(at, move);
        }
        expect(sortedTrail(at, p.me), p.label).toEqual(sortedTrail(p.state, p.me));
      }
      expect(walks).toBeGreaterThan(0);
    },
    SWEEP_TIMEOUT,
  );

  it(
    "Invariant 7: if a finalist's enemy reply improves the bot's evaluate relative to the enemy passing, then its score shall equal its unreplied evaluate (and a reply never raises a score).",
    () => {
      const terminals: { label: string; terminal: GameState; me: PlayerId }[] = [];
      for (const n of sampleTurnStarts('A', 20)) {
        const state = mirrorAt(n);
        terminals.push({ label: `[endTurn]@${String(n)}`, terminal: rules.apply(state, endTurn()), me: state.activePlayer });
      }
      for (const n of sampleTurnStarts('B', 20)) {
        const terminal = mirrorAt(n);
        terminals.push({ label: `A's plan→${String(n)}`, terminal, me: seatsOf(terminal).A });
      }
      const cut = cutReplyBoard();
      terminals.push({ label: 'cutReplyBoard', terminal: cut.terminal, me: cut.A });

      let improving = 0;
      for (const { label, terminal, me } of terminals) {
        const unreplied = evaluate(geometry, terminal, me, rules);
        const score = finalistReplyScore(geometry, rules, terminal, me);
        expect(score, label).toBeLessThanOrEqual(unreplied);
        const enemies = reachableEnemySeats(geometry, terminal, me, DEFAULT_REPLY_DIST_CAP);
        let worst = 0;
        for (const enemy of enemies) worst = Math.min(worst, readReply(terminal, me, enemy).damage);
        if (worst === 0) improving += 1;
        expect(score, label).toBe(unreplied + worst);
      }
      expect(improving).toBeGreaterThan(0);
    },
    SWEEP_TIMEOUT,
  );

  it('Invariant 8: the system shall compute nearestOwnGroupDist, remainingPath and campaignTarget with the same results as the per-source BFS they replace.', () => {
    const positions = [...sampleTurnStarts('A', 16), ...sampleTurnStarts('B', 16)].map(fixturePosition);
    let multiSource = 0;
    for (const p of positions) {
      const campaign = campaignTarget(geometry, p.state, p.me);
      expect(campaign, p.label).toBe(specCampaignTarget(p.state, p.me));
      expect(remainingPath(geometry, p.state, p.me, campaign), p.label).toBe(
        specRemainingPath(p.state, p.me, campaign),
      );
      if (campaign === undefined) continue;
      // nearestOwnGroupDist: own groups → the campaign vertex's border arrows.
      const starts = [...p.state.groups.entries()]
        .filter(([, g]) => g.owner === p.me)
        .map(([a]) => a)
        .toSorted(compareArrows);
      if (starts.length === 0) continue;
      const goals = borders(campaign);
      const perSource = Math.min(
        ...starts.map((s) => grainDistanceToAny(geometry, s, goals, CAMPAIGN_DIST_CAP)),
      );
      expect(grainDistanceFromAny(geometry, starts, goals, CAMPAIGN_DIST_CAP), p.label).toBe(perSource);
      multiSource += 1;
    }
    expect(multiSource).toBeGreaterThan(0);
  });

  it('Invariant 9: while the beam orders steps at a node, the findings it consults shall be computed from at most one step per (from, exit).', () => {
    const five = fiveHeadStackBoard();
    const positions: Position[] = [
      ...[...sampleTurnStarts('A', 20), ...sampleTurnStarts('B', 20)].map(fixturePosition),
      { label: 'fiveHeadStackBoard', state: five.state, me: five.A },
    ];
    const view = oneStepPerExit(rules);
    for (const p of positions) {
      const full = rules.legalMoves(p.state);
      const seen = view.legalMoves(p.state);
      const maxCount = new Map<string, number>();
      for (const m of full) {
        if (m.kind !== 'step') continue;
        const k = `${String(m.from)}>${String(m.exit)}`;
        maxCount.set(k, Math.max(maxCount.get(k) ?? 0, m.count));
      }
      const viewKeys: string[] = [];
      for (const m of seen) {
        if (m.kind !== 'step') continue;
        const k = `${String(m.from)}>${String(m.exit)}`;
        viewKeys.push(k);
        expect(m.count, `${p.label} ${k}`).toBe(maxCount.get(k));
        expect(full.some((f) => movesEqual(f, m)), p.label).toBe(true);
      }
      expect(viewKeys.toSorted(), p.label).toEqual([...maxCount.keys()].toSorted());
      expect(seen.some((m) => m.kind === 'endTurn'), p.label).toBe(
        full.some((m) => m.kind === 'endTurn'),
      );
      const first = seen[0];
      if (first !== undefined) {
        expect(view.apply(p.state, first), p.label).toEqual(rules.apply(p.state, first));
      }
    }
  });

  it('Terms: a quiet plan is one after which my territory has not grown, no other seat’s territory has shrunk, and no other seat has lost heads.', () => {
    const pairs: { label: string; origin: GameState; terminal: GameState; me: PlayerId }[] = [];
    const bStarts = new Set(mirrorTurnStarts('B'));
    for (const n of sampleTurnStarts('A', 8)) {
      const origin = mirrorAt(n);
      const me = origin.activePlayer;
      pairs.push({ label: `pass@${String(n)}`, origin, terminal: rules.apply(origin, endTurn()), me });
      let end = n + 1;
      while (end < 821 && !bStarts.has(end)) end += 1;
      if (end < 821) pairs.push({ label: `turn@${String(n)}`, origin, terminal: mirrorAt(end), me });
    }
    for (const p of carveSample().slice(0, 3)) {
      const best = specCarveCandidates(p.state, p.me)[0];
      const carve = best === undefined ? undefined : specReplayCarve(p.state, p.me, best);
      if (carve !== undefined) {
        pairs.push({ label: `carve@${p.label}`, origin: p.state, terminal: carve.state, me: p.me });
      }
    }
    const cut = cutReplyBoard();
    pairs.push({
      label: 'B cuts A (B is me)',
      origin: cut.terminal,
      terminal: readReply(cut.terminal, cut.A, cut.B).afterReply,
      me: cut.B,
    });
    let quiet = 0;
    let loud = 0;
    for (const { label, origin, terminal, me } of pairs) {
      const expected = specQuiet(origin, terminal, me);
      if (expected) quiet += 1;
      else loud += 1;
      expect(isQuietPlan(origin, terminal, me), label).toBe(expected);
    }
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(0);
  });
});

const borders = (vertex: VertexId): readonly ArrowId[] =>
  [...geometry.borderArrows(vertex)].toSorted(compareArrows);
