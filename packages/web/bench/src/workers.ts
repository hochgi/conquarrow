/**
 * Parallel jobs, one process per worker (P79 concurrency).
 *
 * `byokBot.ts` and `targets.ts` keep per-seat state at module level, keyed by
 * seat id. Two matches interleaving their awaits in one process would read each
 * other's plans and locks, so parallelism lives *between* processes: jobs are
 * dealt round-robin to at most `cap` workers, each worker runs its share in
 * order through `inProcessJobs`, and the results are reassembled in job order.
 *
 * A worker is `run.mjs __worker`: it reads `{jobs}` on stdin, takes model access
 * from the inherited environment, and prints one marked JSON line on stdout.
 * Its logs go to stderr.
 *
 * **Budget across workers.** Each worker meters its own process, so the cap is
 * dealt out: a worker gets `maxUsd / workers` and refuses calls past its share.
 * Each meter overshoots by at most one call, so a run overshoots `maxUsd` by at
 * most one call per worker — the reason the CLI defaults to one worker when the
 * cap is under $3. A worker that spends its share skips its remaining jobs while
 * the others carry on.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkRoundRobin, runPool, unchunk } from './pool';
import type { Job, JobResult, RunJobs } from './tiers';
import { addCost, type Prices, type SpendMeter } from './budget';
import type { RetryOptions } from './transport';

export interface BudgetShare {
  readonly maxUsd: number | undefined;
  readonly prices: Prices;
  readonly reasoningBilledSeparately: boolean;
}

/** What a worker reads on stdin. The retry policy travels; `sleep` is the worker's own. */
export interface WorkerInput {
  readonly jobs: readonly Job[];
  readonly retry: Omit<RetryOptions, 'sleep'>;
  readonly budget: BudgetShare;
}

export const RESULT_MARKER = '@@P79-RESULT@@';

const runMjs = resolve(dirname(fileURLToPath(import.meta.url)), '../run.mjs');

const lastMarked = (stdout: string): string | undefined =>
  stdout
    .split('\n')
    .findLast((line) => line.startsWith(RESULT_MARKER))
    ?.slice(RESULT_MARKER.length);

const runWorker = (input: WorkerInput): Promise<readonly JobResult[]> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [runMjs, '__worker'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: process.env,
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const payload = lastMarked(stdout);
      if (code !== 0 || payload === undefined) {
        reject(new Error(`bench worker exited with code ${String(code)}`));
        return;
      }
      resolvePromise(JSON.parse(payload) as readonly JobResult[]);
    });
    child.stdin.end(JSON.stringify(input));
  });

/** Split what is left of the parent's cap evenly across `workers`. */
export const budgetShare = (meter: SpendMeter, workers: number): BudgetShare => ({
  maxUsd: meter.maxUsd === undefined ? undefined : Math.max(0, meter.maxUsd - meter.total.usd) / workers,
  prices: meter.prices,
  reasoningBilledSeparately: meter.reasoningBilledSeparately,
});

export const childProcessJobs =
  (cap: number, retry: RetryOptions, meter: SpendMeter): RunJobs =>
  async (jobs) => {
    if (jobs.length === 0) return [];
    const policy = { maxRetries: retry.maxRetries, baseDelayMs: retry.baseDelayMs, timeoutMs: retry.timeoutMs };
    const chunks = chunkRoundRobin(jobs, cap);
    const budget = budgetShare(meter, chunks.length);
    const results = await runPool(chunks, cap, (chunk) => runWorker({ jobs: chunk, retry: policy, budget }));
    const merged = unchunk(results, jobs.length);
    chargeParent(meter, merged);
    return merged;
  };

/** Book the workers' spend on the parent meter, so a later round (a rerun) sees it. */
const chargeParent = (meter: SpendMeter, results: readonly JobResult[]): void => {
  for (const result of results) {
    if (result.kind === 'skipped') {
      meter.exhausted = true;
      continue;
    }
    meter.total = addCost(meter.total, result.record.cost);
    const aborted =
      result.kind === 'match'
        ? result.record.outcome.kind === 'aborted_budget'
        : result.record.parse === 'aborted_budget';
    if (aborted) meter.exhausted = true;
  }
};
