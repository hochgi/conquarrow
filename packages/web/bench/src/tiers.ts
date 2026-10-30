/**
 * The three P79 tiers over a job runner.
 *
 * A **job** is one match cell or one corpus position, plain JSON so it can
 * cross a process boundary. The adapter keeps per-seat plans and target locks
 * in module state, so two jobs must never interleave in one process: the
 * in-process runner is strictly sequential, and parallel runs put each worker
 * in its own process (`workers.ts`). Every job clears that state first.
 *
 * **Budget.** Each process has one {@link SpendMeter}. Once it refuses a call,
 * the job in flight is recorded `aborted_budget` and every later job in that
 * process is returned `skipped` without starting. Neither is scored.
 */

import type { FetchLike } from '../../src/byokBot';
import { clearByokPlans } from '../../src/byokBot';
import { clearTargetLocks } from '../../src/targets';
import { addCost, ZERO_COST, type CostTotals, type SpendMeter } from './budget';
import { CORPUS_NAMES, corpusLog, corpusPosition, corpusPositions, parsePositionId, positionId } from './corpus';
import type { Cell } from './grid';
import { runMatch, type ByokTotals, type MatchRecord } from './match';
import { formatRational, incomeRate, isInteriorPass, isMissedClose, shareCloseRows } from './metrics';
import { fallbackRate, isInvalidCell, mean, median, roundCapFromLengths, scoreOutcome } from './score';
import { createByokSeat, playByokSeatTurn, type BenchMode, type ModelAccess } from './seat';
import type { RetryOptions } from './transport';

export type Job =
  | {
      readonly kind: 'match';
      readonly cell: Cell;
      readonly cap: number;
      readonly chair: 'heuristic' | BenchMode;
    }
  | { readonly kind: 'position'; readonly log: string; readonly moveIndex: number; readonly mode: BenchMode };

export const jobId = (job: Job): string =>
  job.kind === 'match' ? job.cell.id : positionId(job.log, job.moveIndex);

export interface PositionRecord {
  /** `<log>#<move-index>`. */
  readonly id: string;
  readonly log: string;
  readonly moveIndex: number;
  readonly seat: string;
  readonly parse: 'ok' | 'fallback' | 'aborted_budget';
  readonly calls: number;
  readonly retries: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cost: CostTotals;
  /** The seat's nominal income (heads per round, exact) at the end of its turn. */
  readonly incomeAfter: string;
  readonly interiorPass: boolean;
  readonly missedClose: boolean;
  readonly lastError: string | null;
}

export type JobResult =
  | { readonly kind: 'match'; readonly record: MatchRecord }
  | { readonly kind: 'position'; readonly record: PositionRecord }
  /** Not started: the process's budget was already spent. */
  | { readonly kind: 'skipped'; readonly id: string };

export interface JobEnv {
  /** Absent for `mirror`, which never calls a model. */
  readonly access: ModelAccess | undefined;
  readonly baseFetch: FetchLike;
  readonly retry: RetryOptions;
  readonly meter: SpendMeter;
}

export type RunJobs = (jobs: readonly Job[]) => Promise<readonly JobResult[]>;

const requireAccess = (env: JobEnv): ModelAccess => {
  if (env.access === undefined) throw new Error('this job calls a model; BYOK_* are not set');
  return env.access;
};

const runPosition = async (
  job: Extract<Job, { kind: 'position' }>,
  env: JobEnv,
): Promise<PositionRecord> => {
  clearByokPlans();
  clearTargetLocks();
  const position = corpusPosition(job.log, job.moveIndex);
  const seat = createByokSeat(requireAccess(env), job.mode, env.baseFetch, env.retry, env.meter);
  const rows = shareCloseRows(position.state);
  const turn = await playByokSeatTurn(seat, position.state);
  // Jobs start only on an unspent meter, so an exhausted one was spent here.
  const aborted = env.meter.exhausted;
  return {
    id: positionId(job.log, job.moveIndex),
    log: job.log,
    moveIndex: job.moveIndex,
    seat: String(position.seat),
    parse: aborted ? 'aborted_budget' : turn.llmFallbacks > 0 ? 'fallback' : 'ok',
    calls: seat.counters.calls,
    retries: seat.counters.retries,
    promptTokens: turn.promptTokens ?? 0,
    completionTokens: turn.completionTokens ?? 0,
    cost: seat.tally.cost,
    incomeAfter: formatRational(incomeRate(turn.state, position.seat)),
    interiorPass: !aborted && isInteriorPass(position.state, turn),
    missedClose: !aborted && isMissedClose(rows, turn),
    lastError: turn.lastError ?? null,
  };
};

export const runJob = async (job: Job, env: JobEnv): Promise<JobResult> => {
  if (job.kind === 'position') return { kind: 'position', record: await runPosition(job, env) };
  const chair =
    job.chair === 'heuristic'
      ? ({ kind: 'heuristic' } as const)
      : createByokSeat(requireAccess(env), job.chair, env.baseFetch, env.retry, env.meter);
  return { kind: 'match', record: await runMatch({ cell: job.cell, cap: job.cap, chair }) };
};

/** One job at a time, in order. Never interleave jobs in one process (module state). */
export const inProcessJobs =
  (env: JobEnv): RunJobs =>
  async (jobs) => {
    const out: JobResult[] = [];
    for (const job of jobs) {
      out.push(env.meter.exhausted ? { kind: 'skipped', id: jobId(job) } : await runJob(job, env));
    }
    return out;
  };

const matchRecords = (results: readonly JobResult[]): MatchRecord[] =>
  results.flatMap((r) => (r.kind === 'match' ? [r.record] : []));

const skippedIds = (results: readonly JobResult[]): string[] =>
  results.flatMap((r) => (r.kind === 'skipped' ? [r.id] : []));

/** What a run sent: model cost plus transport retries. */
export interface Spend {
  readonly cost: CostTotals;
  readonly retries: number;
}

const spendOf = (items: readonly { readonly cost: CostTotals; readonly retries: number }[]): Spend => ({
  cost: items.reduce<CostTotals>((acc, item) => addCost(acc, item.cost), ZERO_COST),
  retries: items.reduce((acc, item) => acc + item.retries, 0),
});

const perCall = (promptTokens: number, calls: number): number | null =>
  calls === 0 ? null : promptTokens / calls;

const numbers = (values: readonly (number | null)[]): number[] =>
  values.filter((v): v is number => v !== null);

// ── mirror ───────────────────────────────────────────────────────────────────

export interface MirrorCell extends MatchRecord {
  /** Scored against the cap this mirror ran under. */
  readonly score: number | null;
}

export interface MirrorSummary {
  readonly tier: 'mirror';
  readonly cap: number;
  readonly cells: readonly MirrorCell[];
  readonly lengths: readonly number[];
  readonly medianRounds: number;
  /** K = 2 × median length, rounded up to a multiple of 10. Null if any cell hit the cap. */
  readonly k: number | null;
  readonly cappedCells: readonly string[];
  /** Both seats are the heuristic, so `sN-first` and `sN-second` must be one match. */
  readonly pairsIdentical: boolean;
  /** Over distinct seeds: who won by turn order. */
  readonly seatBias: {
    readonly firstSeatWins: number;
    readonly secondSeatWins: number;
    readonly unfinished: number;
  };
}

const seatBiasOf = (records: readonly MatchRecord[]): MirrorSummary['seatBias'] => {
  const bySeed = new Map<number, MatchRecord>();
  for (const record of records) if (!bySeed.has(record.cell.seed)) bySeed.set(record.cell.seed, record);
  let firstSeatWins = 0;
  let secondSeatWins = 0;
  let unfinished = 0;
  for (const record of bySeed.values()) {
    if (record.winner === null) unfinished += 1;
    else if (record.winner === record.players[0]) firstSeatWins += 1;
    else secondSeatWins += 1;
  }
  return { firstSeatWins, secondSeatWins, unfinished };
};

const pairsIdenticalOf = (records: readonly MatchRecord[]): boolean =>
  records.every((a) =>
    records.every(
      (b) => a.cell.seed !== b.cell.seed || JSON.stringify(a.moves) === JSON.stringify(b.moves),
    ),
  );

export const runMirrorTier = async (
  cells: readonly Cell[],
  cap: number,
  runJobs: RunJobs,
): Promise<MirrorSummary> => {
  const records = matchRecords(
    await runJobs(cells.map((cell) => ({ kind: 'match', cell, cap, chair: 'heuristic' }))),
  );
  const lengths = records.map((r) => r.rounds);
  const cappedCells = records.filter((r) => r.outcome.kind === 'capped').map((r) => r.cell.id);
  return {
    tier: 'mirror',
    cap,
    cells: records.map((r) => ({ ...r, score: scoreOutcome(r.outcome, cap) })),
    lengths,
    medianRounds: median(lengths),
    k: cappedCells.length > 0 ? null : roundCapFromLengths(lengths),
    cappedCells,
    pairsIdentical: pairsIdenticalOf(records),
    seatBias: seatBiasOf(records),
  };
};

// ── matches ──────────────────────────────────────────────────────────────────

export interface MatchesCell extends MatchRecord {
  /** Null when the budget aborted the match. */
  readonly score: number | null;
  readonly fallbackRate: number;
  readonly invalid: boolean;
  /** Over the threshold on the first run, so this is the rerun's record. */
  readonly reran: boolean;
}

export interface MatchesSummary {
  readonly tier: 'matches';
  readonly mode: BenchMode;
  readonly k: number;
  readonly cells: readonly MatchesCell[];
  /** Over every scored cell, invalid included; aborted cells are never scored. */
  readonly mean: number | null;
  /** Over valid scored cells only. The gate reader picks; the packet does not say. */
  readonly meanValid: number | null;
  readonly invalidCells: readonly string[];
  readonly abortedCells: readonly string[];
  /** Never started: the budget was spent first. */
  readonly skippedCells: readonly string[];
  readonly budgetExhausted: boolean;
  readonly totals: ByokTotals;
  readonly fallbackRate: number;
  readonly meanPromptTokensPerCall: number | null;
  /** Everything sent, discarded first runs of rerun cells included. */
  readonly spend: Spend;
}

const sumTotals = (records: readonly MatchRecord[]): ByokTotals => {
  const zero: ByokTotals = {
    turns: 0,
    hits: 0,
    fallbacks: 0,
    calls: 0,
    retries: 0,
    promptTokens: 0,
    completionTokens: 0,
    lengthOuts: 0,
    salvageParses: 0,
  };
  return records.reduce<ByokTotals>((acc, r) => {
    const b = r.byok;
    return {
      turns: acc.turns + b.turns,
      hits: acc.hits + b.hits,
      fallbacks: acc.fallbacks + b.fallbacks,
      calls: acc.calls + b.calls,
      retries: acc.retries + b.retries,
      promptTokens: acc.promptTokens + b.promptTokens,
      completionTokens: acc.completionTokens + b.completionTokens,
      lengthOuts: acc.lengthOuts + b.lengthOuts,
      salvageParses: acc.salvageParses + b.salvageParses,
    };
  }, zero);
};

const isAborted = (r: MatchRecord): boolean => r.outcome.kind === 'aborted_budget';

const invalidRecord = (r: MatchRecord): boolean =>
  !isAborted(r) && isInvalidCell(r.byok.fallbacks, r.byok.turns);

const scoredCell = (r: MatchRecord, k: number, reran: boolean): MatchesCell => ({
  ...r,
  score: scoreOutcome(r.outcome, k),
  fallbackRate: fallbackRate(r.byok.fallbacks, r.byok.turns),
  invalid: invalidRecord(r),
  reran,
});

const matchSpend = (records: readonly MatchRecord[]): Spend =>
  spendOf(records.map((r) => ({ cost: r.cost, retries: r.byok.retries })));

export const runMatchesTier = async (
  cells: readonly Cell[],
  k: number,
  mode: BenchMode,
  runJobs: RunJobs,
): Promise<MatchesSummary> => {
  const jobFor = (cell: Cell): Job => ({ kind: 'match', cell, cap: k, chair: mode });
  const firstResults = await runJobs(cells.map(jobFor));
  const first = matchRecords(firstResults);
  const spentOut = first.some(isAborted) || skippedIds(firstResults).length > 0;
  // Gate 4: a cell over 10% fallbacks is rerun once; if still over, it is reported invalid.
  // A spent budget reruns nothing.
  const rerunResults = spentOut ? [] : await runJobs(first.filter(invalidRecord).map((r) => jobFor(r.cell)));
  const reruns = matchRecords(rerunResults);
  const final = first.map((r) => {
    const again = reruns.find((x) => x.cell.id === r.cell.id);
    return again === undefined ? scoredCell(r, k, false) : scoredCell(again, k, true);
  });
  const skippedCells = [...skippedIds(firstResults), ...skippedIds(rerunResults)];
  const totals = sumTotals(final.filter((c) => !isAborted(c)));
  return {
    tier: 'matches',
    mode,
    k,
    cells: final,
    mean: mean(numbers(final.map((c) => c.score))),
    meanValid: mean(numbers(final.filter((c) => !c.invalid).map((c) => c.score))),
    invalidCells: final.filter((c) => c.invalid).map((c) => c.cell.id),
    abortedCells: final.filter(isAborted).map((c) => c.cell.id),
    skippedCells,
    budgetExhausted: spentOut || reruns.some(isAborted) || skippedCells.length > 0,
    totals,
    fallbackRate: fallbackRate(totals.fallbacks, totals.turns),
    meanPromptTokensPerCall: perCall(totals.promptTokens, totals.calls),
    spend: matchSpend([...first, ...reruns]),
  };
};

// ── positions ────────────────────────────────────────────────────────────────

export interface PositionsSummary {
  readonly tier: 'positions';
  readonly mode: BenchMode;
  readonly positions: readonly PositionRecord[];
  /** Positions that produced a reading (not aborted, not skipped). */
  readonly count: number;
  readonly fallbacks: number;
  readonly parseRate: number | null;
  readonly meanPromptTokensPerCall: number | null;
  readonly interiorPasses: number;
  readonly missedCloses: number;
  readonly abortedPositions: readonly string[];
  readonly skippedPositions: readonly string[];
  readonly budgetExhausted: boolean;
  readonly spend: Spend;
}

export interface PositionFilter {
  /** `<log>#<move-index>` ids; each must name a corpus position. */
  readonly ids?: readonly string[] | undefined;
  /** Keep the first N (after `ids`). */
  readonly max?: number | undefined;
}

const selectedPositions = (filter: PositionFilter): { readonly log: string; readonly moveIndex: number }[] => {
  if (filter.ids === undefined || filter.ids.length === 0) {
    return CORPUS_NAMES.flatMap((name) =>
      corpusPositions(corpusLog(name)).map((p) => ({ log: name, moveIndex: p.moveIndex })),
    );
  }
  return filter.ids.map((id) => {
    const parsed = parsePositionId(id);
    corpusPosition(parsed.log, parsed.moveIndex); // throws on a turn start that is not a position
    return parsed;
  });
};

/** Every corpus position (log by log, in move order), or the ones named; then the first `max`. */
export const positionJobs = (mode: BenchMode, filter: PositionFilter = {}): readonly Job[] => {
  const picked = selectedPositions(filter).map(
    (p): Job => ({ kind: 'position', log: p.log, moveIndex: p.moveIndex, mode }),
  );
  return filter.max === undefined ? picked : picked.slice(0, filter.max);
};

export const runPositionsTier = async (
  mode: BenchMode,
  jobs: readonly Job[],
  runJobs: RunJobs,
): Promise<PositionsSummary> => {
  const results = await runJobs(jobs);
  const positions = results.flatMap((r) => (r.kind === 'position' ? [r.record] : []));
  const read = positions.filter((p) => p.parse !== 'aborted_budget');
  const fallbacks = read.filter((p) => p.parse === 'fallback').length;
  const skippedPositions = skippedIds(results);
  const abortedPositions = positions.filter((p) => p.parse === 'aborted_budget').map((p) => p.id);
  const readCalls = read.reduce((acc, p) => acc + p.calls, 0);
  const readPrompt = read.reduce((acc, p) => acc + p.promptTokens, 0);
  return {
    tier: 'positions',
    mode,
    positions,
    count: read.length,
    fallbacks,
    parseRate: read.length === 0 ? null : (read.length - fallbacks) / read.length,
    meanPromptTokensPerCall: perCall(readPrompt, readCalls),
    interiorPasses: read.filter((p) => p.interiorPass).length,
    missedCloses: read.filter((p) => p.missedClose).length,
    abortedPositions,
    skippedPositions,
    budgetExhausted: abortedPositions.length > 0 || skippedPositions.length > 0,
    spend: spendOf(positions),
  };
};
