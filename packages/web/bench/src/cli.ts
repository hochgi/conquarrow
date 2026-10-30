/**
 * `pnpm byok-bench <mirror|positions|matches> [options]` — the composition root.
 *
 * Everything impure arrives through {@link CliIo}: the environment, the clock,
 * `fetch`, the git revision, the results directory and the job runner. The
 * harness's own tests drive `main` with a scripted io; `nodeIo()` is the real one.
 *
 * Spend is opt-in and capped. A tier that calls a model needs `--max-usd`, prints
 * its projection, and stops there unless `--yes` is given. When the cap refuses a
 * call, the run writes what it has, says so, and exits 4. The key is redacted
 * from every line and file.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { FetchLike } from '../../src/byokBot';
import { createMeter, DEFAULT_PRICES, ZERO_COST, type CostTotals, type Prices } from './budget';
import { gridCells, selectCells, type Cell } from './grid';
import { latestCalibration, resultExists, resultFileName, writeResult } from './results';
import { BENCH_MODES, ENV_API_KEY, modelAccessFromEnv, type BenchMode, type ModelAccess } from './seat';
import {
  inProcessJobs,
  positionJobs,
  runMatchesTier,
  runMirrorTier,
  runPositionsTier,
  type JobEnv,
  type RunJobs,
  type Spend,
} from './tiers';
import { redactor, type RetryOptions } from './transport';
import { childProcessJobs, RESULT_MARKER, type WorkerInput } from './workers';

export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: (line: string) => void;
  readonly fetch: FetchLike;
  /** Milliseconds, for wall time only. */
  readonly now: () => number;
  readonly isoNow: () => string;
  readonly revision: () => { readonly sha: string; readonly dirty: boolean };
  readonly resultsDir: string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly jobRunner: (env: JobEnv, concurrency: number) => RunJobs;
}

type Tier = 'mirror' | 'positions' | 'matches';

interface Options {
  readonly tier: Tier;
  readonly cells: readonly string[] | undefined;
  /** matches: K. mirror: a safety cap (default 400). */
  readonly roundCap: number | undefined;
  readonly mode: BenchMode;
  /** Undefined = the default, which depends on `maxUsd`. */
  readonly concurrency: number | undefined;
  readonly yes: boolean;
  readonly tag: string | undefined;
  readonly positions: readonly string[] | undefined;
  readonly maxPositions: number | undefined;
  readonly maxUsd: number | undefined;
  readonly prices: Prices;
  readonly reasoningBilledSeparately: boolean;
  readonly retries: number;
  readonly timeoutMs: number;
}

const MIRROR_SAFETY_CAP = 400;
/** Under this cap the default is one worker, so the overshoot is at most one call. */
const LOW_CAP_USD = 3;

export const EXIT_BUDGET = 4;

const USAGE = `usage: pnpm byok-bench <mirror|positions|matches> [options]
  --max-usd X                  hard spend cap (required for positions, matches)
  --yes                        allow a tier that calls the model to spend
  --cells s1-first,s2-second   run only these grid cells (default: all 6)
  --round-cap K                matches: the round cap K (from the mirror run);
                               mirror: safety cap (default 400)
  --mode reasoning|fast        lobby Reasoning flag (default reasoning)
  --positions ID,ID            positions: only these, ID = <log>#<move-index>
  --max-positions N            positions: at most the first N
  --concurrency N              worker processes (default 4; 1 when --max-usd < 3)
  --price-in X --price-cached Y --price-out Z
                               USD per 1M tokens (default grok-4.7: 2.00 / 0.50 / 6.00;
                               env BYOK_PRICE_IN / BYOK_PRICE_CACHED / BYOK_PRICE_OUT)
  --[no-]reasoning-billed-separately
                               when usage cannot tell, bill reasoning tokens on top of
                               completion tokens (default yes: over-counts)
  --tag LABEL                  appended to the results file name (e.g. run2)
  --retries N                  transport retries per call (default 5)
  --timeout-ms N               per attempt (default 300000)
env: BYOK_BASE_URL, BYOK_MODEL, BYOK_API_KEY (positions, matches)`;

const positiveInt = (raw: string | undefined, name: string): number | undefined => {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
};

const nonNegative = (raw: string | undefined, name: string): number | undefined => {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
};

const list = (raw: string | undefined): readonly string[] | undefined =>
  raw?.split(',').map((c) => c.trim()).filter((c) => c.length > 0);

const isTier = (value: string | undefined): value is Tier =>
  value === 'mirror' || value === 'positions' || value === 'matches';

const isMode = (value: string): value is BenchMode => (BENCH_MODES as readonly string[]).includes(value);

const pricesOf = (values: Record<string, string | boolean | undefined>, env: CliIo['env']): Prices => {
  const pick = (flag: string, envName: string, fallback: number): number => {
    const raw = values[flag];
    return (
      nonNegative(typeof raw === 'string' ? raw : undefined, `--${flag}`) ??
      nonNegative(env[envName], envName) ??
      fallback
    );
  };
  return {
    in: pick('price-in', 'BYOK_PRICE_IN', DEFAULT_PRICES.in),
    cached: pick('price-cached', 'BYOK_PRICE_CACHED', DEFAULT_PRICES.cached),
    out: pick('price-out', 'BYOK_PRICE_OUT', DEFAULT_PRICES.out),
  };
};

export const parseOptions = (argv: readonly string[], env: CliIo['env'] = {}): Options => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    allowNegative: true,
    options: {
      cells: { type: 'string' },
      'round-cap': { type: 'string' },
      mode: { type: 'string' },
      concurrency: { type: 'string' },
      yes: { type: 'boolean' },
      tag: { type: 'string' },
      positions: { type: 'string' },
      'max-positions': { type: 'string' },
      'max-usd': { type: 'string' },
      'price-in': { type: 'string' },
      'price-cached': { type: 'string' },
      'price-out': { type: 'string' },
      'reasoning-billed-separately': { type: 'boolean' },
      retries: { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
  });
  const tier = positionals[0];
  if (!isTier(tier) || positionals.length !== 1) throw new Error('expected exactly one tier');
  const mode = values.mode ?? 'reasoning';
  if (!isMode(mode)) throw new Error(`--mode must be one of ${BENCH_MODES.join(', ')}`);
  return {
    tier,
    cells: list(values.cells),
    roundCap: positiveInt(values['round-cap'], 'round-cap'),
    mode,
    concurrency: positiveInt(values.concurrency, 'concurrency'),
    yes: values.yes === true,
    tag: values.tag,
    positions: list(values.positions),
    maxPositions: positiveInt(values['max-positions'], 'max-positions'),
    maxUsd: nonNegative(values['max-usd'], '--max-usd'),
    prices: pricesOf(values, env),
    reasoningBilledSeparately: values['reasoning-billed-separately'] !== false,
    retries: nonNegative(values.retries, '--retries') ?? 5,
    timeoutMs: positiveInt(values['timeout-ms'], 'timeout-ms') ?? 300_000,
  };
};

const concurrencyOf = (opts: Options): number =>
  opts.concurrency ?? (opts.maxUsd !== undefined && opts.maxUsd < LOW_CAP_USD ? 1 : 4);

const retryOf = (opts: Options, io: CliIo): RetryOptions => ({
  maxRetries: opts.retries,
  baseDelayMs: 2000,
  timeoutMs: opts.timeoutMs,
  sleep: io.sleep,
});

const fmt = (n: number | null, digits = 3): string => (n === null ? '—' : n.toFixed(digits));

const usd = (n: number): string => `$${n.toFixed(4)}`;

const costLine = (cost: CostTotals, retries: number, wallMs: number): string =>
  `tokens in ${String(cost.promptTokens)} (cached ${String(cost.cachedTokens)}), ` +
  `tokens out ${String(cost.completionTokens)} (reasoning ${String(cost.reasoningTokens)}, ` +
  `billed ${String(cost.billableOutputTokens)}), calls ${String(cost.calls)}, retries ${String(retries)}, ` +
  `cost ${usd(cost.usd)}, wall ${(wallMs / 1000).toFixed(1)}s`;

interface Run {
  readonly opts: Options;
  readonly io: CliIo;
  readonly log: (line: string) => void;
  readonly file: string;
  readonly header: Record<string, unknown>;
  readonly env: JobEnv;
  readonly concurrency: number;
}

const projectionLine = (run: Run, model: string, jobs: number): string => {
  const prior = latestCalibration(run.io.resultsDir, run.opts.tier, run.opts.mode, model);
  if (prior === undefined) {
    return `projection: no earlier ${run.opts.tier} run for ${model} (${run.opts.mode}); this run is the calibration (${String(jobs)} jobs)`;
  }
  const scale = jobs / prior.jobs;
  return (
    `projection from ${prior.file}: ${String(jobs)} jobs ≈ ${String(Math.round(prior.calls * scale))} calls, ` +
    `tokens in ${String(Math.round(prior.promptTokens * scale))}, tokens out ${String(Math.round(prior.completionTokens * scale))}, ` +
    `≈ ${usd(prior.usd * scale)}`
  );
};

/** Projection, the cap, then the spend gate. True when the run may go ahead. */
const mayProceed = (run: Run, model: string, jobs: number): boolean => {
  run.log(projectionLine(run, model, jobs));
  run.log(
    `budget: cap ${usd(run.opts.maxUsd ?? 0)}, ${String(run.concurrency)} worker(s) — overshoot at most one call per worker`,
  );
  if (run.opts.yes) return true;
  run.log('not spending: re-run with --yes to call the model');
  return false;
};

interface Finished {
  readonly summary: object;
  readonly spend: Spend;
  readonly jobsRun: number;
  readonly budgetExhausted: boolean;
}

const finish = (run: Run, startedMs: number, done: Finished): number => {
  const wallMs = run.io.now() - startedMs;
  const body = {
    ...run.header,
    finishedAt: run.io.isoNow(),
    wallMs,
    jobsRun: done.jobsRun,
    ...done.summary,
    // Last, so no summary field can shadow the run's cost.
    cost: done.spend.cost,
  };
  const path = writeResult(run.io.resultsDir, run.file, body, redactor(run.io.env[ENV_API_KEY] ?? ''));
  run.log(costLine(done.spend.cost, done.spend.retries, wallMs));
  run.log(`wrote ${path}`);
  if (!done.budgetExhausted) return 0;
  run.log(
    `BUDGET CAP REACHED: spent ${usd(done.spend.cost.usd)} of ${usd(run.opts.maxUsd ?? 0)}; ` +
      'the run stopped early — aborted and skipped jobs are listed in the results and not scored',
  );
  return EXIT_BUDGET;
};

const cellsOf = (opts: Options): readonly Cell[] => selectCells(gridCells(), opts.cells);

const seedsOf = (cells: readonly Cell[]): number[] => [...new Set(cells.map((c) => c.seed))];

const mirrorTier = async (run: Run): Promise<number> => {
  const cells = cellsOf(run.opts);
  const started = run.io.now();
  const cap = run.opts.roundCap ?? MIRROR_SAFETY_CAP;
  const summary = await runMirrorTier(cells, cap, run.io.jobRunner(run.env, run.concurrency));
  for (const c of summary.cells) {
    run.log(`${c.cell.id}  winner=${c.winner ?? '—'}  rounds=${String(c.rounds)}  ${c.outcome.kind}`);
  }
  run.log(
    `median rounds ${String(summary.medianRounds)} → K ${summary.k === null ? '— (a cell hit the cap)' : String(summary.k)}; ` +
      `seat bias: first ${String(summary.seatBias.firstSeatWins)}, second ${String(summary.seatBias.secondSeatWins)}, ` +
      `unfinished ${String(summary.seatBias.unfinished)}; pairs identical ${String(summary.pairsIdentical)}`,
  );
  const spend = { cost: ZERO_COST, retries: 0 };
  return finish(run, started, {
    summary: { seeds: seedsOf(cells), ...summary },
    spend,
    jobsRun: cells.length,
    budgetExhausted: false,
  });
};

const matchesTier = async (run: Run, model: string): Promise<number> => {
  const k = run.opts.roundCap;
  if (k === undefined) throw new Error('matches needs --round-cap K (2 × median mirror length, rounded up to a multiple of 10)');
  const cells = cellsOf(run.opts);
  if (!mayProceed(run, model, cells.length)) return 3;
  const started = run.io.now();
  const summary = await runMatchesTier(cells, k, run.opts.mode, run.io.jobRunner(run.env, run.concurrency));
  for (const c of summary.cells) {
    run.log(
      `${c.cell.id}  ${c.byokPlayer}  ${c.outcome.kind}@r${String(c.rounds)}  score=${fmt(c.score)}  ` +
        `turns=${String(c.byok.turns)} fallbacks=${String(c.byok.fallbacks)}  cost=${usd(c.cost.usd)}` +
        `${c.invalid ? ' INVALID' : ''}${c.lastError === null ? '' : `  lastError=${c.lastError}`}`,
    );
  }
  for (const id of summary.skippedCells) run.log(`${id}  skipped (budget)`);
  run.log(`mean ${fmt(summary.mean)} (valid ${fmt(summary.meanValid)}), fallback rate ${fmt(summary.fallbackRate)}`);
  return finish(run, started, {
    summary: { seeds: seedsOf(cells), ...summary },
    spend: summary.spend,
    jobsRun: summary.cells.length + summary.cells.filter((c) => c.reran).length,
    budgetExhausted: summary.budgetExhausted,
  });
};

const positionsTier = async (run: Run, model: string): Promise<number> => {
  const jobs = positionJobs(run.opts.mode, { ids: run.opts.positions, max: run.opts.maxPositions });
  if (!mayProceed(run, model, jobs.length)) return 3;
  const started = run.io.now();
  const summary = await runPositionsTier(run.opts.mode, jobs, run.io.jobRunner(run.env, run.concurrency));
  run.log(
    `positions ${String(summary.count)}: parse rate ${fmt(summary.parseRate)}, ` +
      `prompt tokens/call ${fmt(summary.meanPromptTokensPerCall, 0)}, interior passes ${String(summary.interiorPasses)}, ` +
      `missed closes ${String(summary.missedCloses)}`,
  );
  return finish(run, started, {
    summary,
    spend: summary.spend,
    jobsRun: summary.positions.length,
    budgetExhausted: summary.budgetExhausted,
  });
};

const makeRun = (opts: Options, io: CliIo, access: ModelAccess | undefined): Run => {
  const redact = redactor(io.env[ENV_API_KEY] ?? '');
  const revision = io.revision();
  const model = access?.model ?? 'heuristic';
  const mode = opts.tier === 'mirror' ? 'none' : opts.mode;
  const concurrency = concurrencyOf(opts);
  const budget = {
    maxUsd: opts.maxUsd ?? null,
    prices: opts.prices,
    reasoningBilledSeparately: opts.reasoningBilledSeparately,
  };
  return {
    opts,
    io,
    log: (line) => {
      io.log(redact(line));
    },
    file: resultFileName({ tier: opts.tier, ...revision, mode, model, tag: opts.tag }),
    header: {
      tier: opts.tier,
      sha: revision.sha,
      dirty: revision.dirty,
      model,
      mode,
      startedAt: io.isoNow(),
      concurrency,
      ...(opts.tier === 'mirror' ? {} : { budget }),
      ...(opts.tag === undefined ? {} : { tag: opts.tag }),
    },
    env: {
      access,
      baseFetch: io.fetch,
      retry: retryOf(opts, io),
      meter: createMeter(opts.maxUsd, opts.prices, opts.reasoningBilledSeparately),
    },
    concurrency,
  };
};

const dispatch = async (opts: Options, io: CliIo): Promise<number> => {
  const callsModel = opts.tier !== 'mirror';
  if (callsModel && opts.maxUsd === undefined) {
    throw new Error(`${opts.tier} calls the model: --max-usd is required`);
  }
  const access = callsModel ? modelAccessFromEnv(io.env) : undefined;
  const run = makeRun(opts, io, access);
  if (resultExists(io.resultsDir, run.file)) {
    run.log(`${run.file} already exists; pass --tag to keep both runs`);
    return 1;
  }
  if (opts.tier === 'mirror') return mirrorTier(run);
  const model = access?.model ?? '';
  return opts.tier === 'matches' ? matchesTier(run, model) : positionsTier(run, model);
};

export const main = async (argv: readonly string[], io: CliIo): Promise<number> => {
  const redact = redactor(io.env[ENV_API_KEY] ?? '');
  let opts: Options;
  try {
    opts = parseOptions(argv, io.env);
  } catch (err) {
    io.log(redact(`${err instanceof Error ? err.message : 'bad arguments'}\n${USAGE}`));
    return 2;
  }
  try {
    return await dispatch(opts, io);
  } catch (err) {
    io.log(redact(`error: ${err instanceof Error ? err.message : 'unknown failure'}`));
    return 1;
  }
};

// ── the real world ───────────────────────────────────────────────────────────

const benchDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_RESULTS_DIR = join(benchDir, 'results');

const git = (args: readonly string[]): string =>
  execFileSync('git', [...args], { cwd: benchDir, encoding: 'utf8' }).trim();

const gitRevision = (): { readonly sha: string; readonly dirty: boolean } => ({
  sha: git(['rev-parse', '--short=12', 'HEAD']),
  dirty: git(['status', '--porcelain']).length > 0,
});

const nodeFetch: FetchLike = (input, init) => fetch(input, init);

const nodeSleep = (ms: number): Promise<void> =>
  new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });

export const nodeIo = (): CliIo => ({
  env: process.env,
  log: (line) => {
    console.log(line);
  },
  fetch: nodeFetch,
  now: () => performance.now(),
  isoNow: () => new Date().toISOString(),
  revision: gitRevision,
  resultsDir: DEFAULT_RESULTS_DIR,
  sleep: nodeSleep,
  jobRunner: (env, concurrency) => childProcessJobs(concurrency, env.retry, env.meter),
});

/** `run.mjs __worker`: jobs on stdin, one marked JSON line on stdout. */
export const workerMain = async (input: string): Promise<number> => {
  const parsed = JSON.parse(input) as WorkerInput;
  const env: JobEnv = {
    access: parsed.jobs.some((job) => job.kind === 'position' || job.chair !== 'heuristic')
      ? modelAccessFromEnv(process.env)
      : undefined,
    baseFetch: nodeFetch,
    retry: { ...parsed.retry, sleep: nodeSleep },
    meter: createMeter(parsed.budget.maxUsd, parsed.budget.prices, parsed.budget.reasoningBilledSeparately),
    progress: (line) => {
      process.stderr.write(`${line}\n`);
    },
  };
  const results = await inProcessJobs(env)(parsed.jobs);
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify(results)}\n`);
  return 0;
};
