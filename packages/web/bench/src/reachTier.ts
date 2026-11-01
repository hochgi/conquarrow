/**
 * P78's `reach` tier: score the committed corpus, then a small board grid of
 * heuristic-vs-heuristic matches, with {@link scoreMatch}.
 *
 * The grid is `homeOffset × R × playerCount × spawnerSeed`, fixed here rather
 * than by a flag so a rerun reproduces the note's tables. Matches run through
 * P79's job runner (`runMatch`, heuristic chair, worker processes) under a round
 * cap: mirror matches do not end on their own (byok-benchmark.md, "Mirror").
 * No model is called.
 */

import type { MatchConfig } from '@conquarrow/contracts';
import { rules } from './board';
import { CORPUS_NAMES, corpusLog } from './corpus';
import type { Cell } from './grid';
import { parseMove } from './moves';
import { scoreMatch, type ReachReport } from './reach';
import type { RunJobs } from './tiers';

export const REACH_HOME_OFFSETS = [3, 5] as const;
export const REACH_RADII = [5, 7] as const;
export const REACH_PLAYER_COUNTS = [2, 3] as const;
export const REACH_SEEDS = [1, 2] as const;
export const REACH_DEFAULT_CAP = 100;

/** `p<players>-R<R>-h<homeOffset>-s<seed>`, e.g. `p2-R7-h5-s1` (the playtest board, two seats). */
export const reachCellId = (config: MatchConfig): string =>
  `p${String(config.playerCount)}-R${String(config.R)}-h${String(config.homeOffset)}-s${String(config.spawnerSeed)}`;

export const reachCells = (): readonly Cell[] =>
  REACH_PLAYER_COUNTS.flatMap((playerCount) =>
    REACH_RADII.flatMap((R) =>
      REACH_HOME_OFFSETS.flatMap((homeOffset) =>
        REACH_SEEDS.map((seed): Cell => {
          const config: MatchConfig = { dominationN: 5, R, homeOffset, playerCount, spawnerSeed: seed };
          return { id: reachCellId(config), seed, byokSeat: 'first', config };
        }),
      ),
    ),
  );

export interface ReachRow extends ReachReport {
  readonly id: string;
  readonly config: MatchConfig;
  /** Full rounds played (grid) or end-turns ÷ seats (corpus, rounded down). */
  readonly rounds: number;
  readonly winner: string | null;
}

export interface ReachSummary {
  readonly tier: 'reach';
  readonly cap: number;
  readonly seeds: readonly number[];
  readonly corpus: readonly ReachRow[];
  readonly grid: readonly ReachRow[];
}

export const scoreCorpus = (): readonly ReachRow[] =>
  CORPUS_NAMES.map((name) => {
    const log = corpusLog(name);
    const report = scoreMatch(rules, log.config, log.moves);
    return {
      id: name,
      config: log.config,
      rounds: Math.floor(report.summary.endTurns / log.config.playerCount),
      winner: null,
      ...report,
    };
  });

export const runReachTier = async (cells: readonly Cell[], cap: number, runJobs: RunJobs): Promise<ReachSummary> => {
  const results = await runJobs(cells.map((cell) => ({ kind: 'match', cell, cap, chair: 'heuristic' })));
  const grid = results.flatMap((result): ReachRow[] => {
    if (result.kind !== 'match') return [];
    const { cell, moves, rounds, winner } = result.record;
    const config = cell.config;
    if (config === undefined) throw new Error(`reach: cell ${cell.id} carries no board config`);
    const parsed = moves.map((move, i) => parseMove(move, `${cell.id}.moves[${String(i)}]`));
    return [{ id: cell.id, config, rounds, winner, ...scoreMatch(rules, config, parsed) }];
  });
  return {
    tier: 'reach',
    cap,
    seeds: [...new Set(cells.map((c) => c.seed))],
    corpus: scoreCorpus(),
    grid,
  };
};
