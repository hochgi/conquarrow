/**
 * Advisory `pnpm bots` metrics (P53). Pure formatting + a self-play fold.
 * Not a CI gate on the numbers. Search stays on the injected `ChooseTurn`.
 */

import type {
  GameState,
  GeometryPort,
  MatchConfig,
  PlayerId,
  RulesPort,
} from '@conquarrow/contracts';
import { foldMatchSummary, emptyMatchSummary } from './matchLog';
import {
  chooseTurnBeam,
  chooseTurnGreedy,
  isShuttle,
  type ChooseTurn,
} from './botSearch';

export const BOTS_SEEDS: readonly number[] = [1, 2, 3];

export const BOTS_MATCH_CONFIG: Omit<MatchConfig, 'spawnerSeed'> = {
  playerCount: 6,
  R: 7,
  homeOffset: 5,
  dominationN: 5,
};

export const BOTS_END_TURNS = 50;

export type BotsImplName = 'greedy-v1' | 'beam-v1';

export interface BotsMetricRow {
  readonly impl: BotsImplName;
  readonly shuttleRate: number;
  readonly countGt1Share: number;
  readonly stepsPerTurn: number;
  readonly closesPer100Turns: number;
  readonly firstCloseAt: number | undefined;
  readonly sharesAtTurn50: number;
  readonly meanAppliesPerTurn: number;
}

const sharesOf = (
  geometry: GeometryPort,
  state: GameState,
  player: PlayerId,
): number => {
  let n = 0;
  const vertices = [...state.spawners.keys()].toSorted((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
  );
  for (const vertex of vertices) {
    for (const arrow of [...geometry.borderArrows(vertex)].toSorted((a, b) =>
      String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
    )) {
      if (state.territory.get(arrow) === player) n += 1;
    }
  }
  return n;
};

export const totalShares = (geometry: GeometryPort, state: GameState): number => {
  let n = 0;
  for (const player of state.players) n += sharesOf(geometry, state, player);
  return n;
};

const countingRules = (
  inner: RulesPort,
): { readonly rules: RulesPort; readonly take: () => number } => {
  let n = 0;
  const rules: RulesPort = {
    ...inner,
    apply(state, move) {
      const next = inner.apply(state, move);
      n += 1;
      return next;
    },
  };
  return {
    rules,
    take: () => {
      const had = n;
      n = 0;
      return had;
    },
  };
};

export const selfPlayMetrics = (
  chooseTurn: ChooseTurn,
  args: {
    readonly geometry: GeometryPort;
    readonly rules: RulesPort;
    readonly opening: GameState;
    readonly endTurns?: number;
  },
): Omit<BotsMetricRow, 'impl'> => {
  const endTurnLimit = args.endTurns ?? BOTS_END_TURNS;
  const counted = countingRules(args.rules);
  let state = args.opening;
  let endTurns = 0;
  let turns = 0;
  let shuttleTurns = 0;
  let steps = 0;
  let countGt1 = 0;
  let searchApplies = 0;
  let logged = 0;
  let summary = emptyMatchSummary();
  while (endTurns < endTurnLimit && state.winner === undefined) {
    const me = state.activePlayer;
    const plan = chooseTurn(args.geometry, counted.rules, state, me);
    searchApplies += counted.take();
    if (plan.length === 0) break;
    turns += 1;
    if (isShuttle(plan)) shuttleTurns += 1;
    for (const move of plan) {
      if (move.kind === 'step') {
        steps += 1;
        if (move.count > 1) countGt1 += 1;
      }
      const before = state;
      state = args.rules.apply(state, move);
      summary = foldMatchSummary(summary, [move], before, state, logged);
      logged += 1;
      if (move.kind === 'endTurn') endTurns += 1;
    }
  }
  const stepMoves = steps;
  return {
    shuttleRate: turns === 0 ? 0 : shuttleTurns / turns,
    countGt1Share: stepMoves === 0 ? 0 : countGt1 / stepMoves,
    stepsPerTurn: turns === 0 ? 0 : steps / turns,
    closesPer100Turns: turns === 0 ? 0 : (summary.closes / turns) * 100,
    firstCloseAt: summary.firstCloseAt,
    sharesAtTurn50: totalShares(args.geometry, state),
    meanAppliesPerTurn: turns === 0 ? 0 : searchApplies / turns,
  };
};

export const meanBotsRows = (
  rows: readonly Omit<BotsMetricRow, 'impl'>[],
  impl: BotsImplName,
): BotsMetricRow => {
  const n = rows.length;
  if (n === 0) {
    return {
      impl,
      shuttleRate: 0,
      countGt1Share: 0,
      stepsPerTurn: 0,
      closesPer100Turns: 0,
      firstCloseAt: undefined,
      sharesAtTurn50: 0,
      meanAppliesPerTurn: 0,
    };
  }
  const sum = rows.reduce(
    (acc, row) => ({
      shuttleRate: acc.shuttleRate + row.shuttleRate,
      countGt1Share: acc.countGt1Share + row.countGt1Share,
      stepsPerTurn: acc.stepsPerTurn + row.stepsPerTurn,
      closesPer100Turns: acc.closesPer100Turns + row.closesPer100Turns,
      sharesAtTurn50: acc.sharesAtTurn50 + row.sharesAtTurn50,
      meanAppliesPerTurn: acc.meanAppliesPerTurn + row.meanAppliesPerTurn,
    }),
    {
      shuttleRate: 0,
      countGt1Share: 0,
      stepsPerTurn: 0,
      closesPer100Turns: 0,
      sharesAtTurn50: 0,
      meanAppliesPerTurn: 0,
    },
  );
  const firsts = rows
    .map((row) => row.firstCloseAt)
    .filter((v): v is number => v !== undefined);
  const firstCloseAt =
    firsts.length === 0
      ? undefined
      : firsts.reduce((a, b) => a + b, 0) / firsts.length;
  return {
    impl,
    shuttleRate: sum.shuttleRate / n,
    countGt1Share: sum.countGt1Share / n,
    stepsPerTurn: sum.stepsPerTurn / n,
    closesPer100Turns: sum.closesPer100Turns / n,
    firstCloseAt,
    sharesAtTurn50: sum.sharesAtTurn50 / n,
    meanAppliesPerTurn: sum.meanAppliesPerTurn / n,
  };
};

const cell = (value: string | number | undefined): string => {
  if (value === undefined) return 'unset';
  if (typeof value === 'number') return value.toFixed(3);
  return value;
};

export const formatBotsReport = (rows: readonly BotsMetricRow[]): string => {
  const header = [
    'impl',
    'shuttle rate',
    'count>1 share',
    'steps per turn',
    'closes per 100 turns',
    'firstCloseAt',
    'shares at turn 50',
    'mean applies per turn',
  ].join('\t');
  const lines = rows.map((row) =>
    [
      row.impl,
      cell(row.shuttleRate),
      cell(row.countGt1Share),
      cell(row.stepsPerTurn),
      cell(row.closesPer100Turns),
      row.firstCloseAt === undefined ? 'unset' : cell(row.firstCloseAt),
      cell(row.sharesAtTurn50),
      cell(row.meanAppliesPerTurn),
    ].join('\t'),
  );
  return [header, ...lines].join('\n');
};

export const collectBotsReport = (
  geometry: GeometryPort,
  rules: RulesPort,
  openings: readonly GameState[],
): readonly BotsMetricRow[] => {
  const greedyRows = openings.map((opening) =>
    selfPlayMetrics(chooseTurnGreedy, {
      geometry,
      rules,
      opening,
      endTurns: BOTS_END_TURNS,
    }),
  );
  const beamRows = openings.map((opening) =>
    selfPlayMetrics(chooseTurnBeam, {
      geometry,
      rules,
      opening,
      endTurns: BOTS_END_TURNS,
    }),
  );
  return [meanBotsRows(greedyRows, 'greedy-v1'), meanBotsRows(beamRows, 'beam-v1')];
};
