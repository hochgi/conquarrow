/**
 * P79 scenario inventory — isolation between matches, scheduling independence,
 * and the bench staying out of `pnpm test`.
 */

import { readdirSync } from 'node:fs';
import { dirname, join, matchesGlob, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import benchConfig from '../vitest.config';
import { clearByokPlans } from '../../src/byokBot';
import { clearTargetLocks } from '../../src/targets';
import { cellId, type Cell } from '../src/grid';
import { runMatch } from '../src/match';
import { chunkRoundRobin, runPool, unchunk } from '../src/pool';
import { createByokSeat } from '../src/seat';
import { access, fastRetry, firstRowModel } from './harness.support';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const cell = (seed: number, byokSeat: 'first' | 'second'): Cell => ({
  id: cellId(seed, byokSeat),
  seed,
  byokSeat,
});

/** A later BYOK prompt in the same match echoes the plan the first reply set. */
const planEchoed = (prompts: readonly string[]): boolean =>
  prompts.slice(1).some((p) => p.includes('Plan: PLAN-ALPHA keep walking north'));

describe('P79 harness — match isolation', () => {
  it('Byok plans and target locks from match 1 do not affect match 2', async () => {
    const matchTwo = async (): Promise<{ readonly prompts: readonly string[]; readonly record: string }> => {
      const model = firstRowModel();
      const record = await runMatch({
        cell: cell(2, 'first'),
        cap: 2,
        chair: createByokSeat(access, 'reasoning', model.fetch, fastRetry),
      });
      return { prompts: model.calls.map((c) => c.user), record: JSON.stringify(record) };
    };
    const matchOne = async (): Promise<readonly string[]> => {
      const model = firstRowModel('PLAN-ALPHA keep walking north');
      await runMatch({
        cell: cell(1, 'first'),
        cap: 2,
        chair: createByokSeat(access, 'reasoning', model.fetch, fastRetry),
      });
      return model.calls.map((c) => c.user);
    };

    // Precondition: within a match the plan *is* carried, so its absence below means something.
    expect(planEchoed(await matchOne())).toBe(true);

    const contaminated = await matchTwo();
    for (const prompt of contaminated.prompts) expect(prompt).not.toContain('PLAN-ALPHA');

    await matchOne();
    clearByokPlans();
    clearTargetLocks();
    const clean = await matchTwo();
    expect(contaminated.prompts).toEqual(clean.prompts);
    expect(contaminated.record).toBe(clean.record);
  });
});

describe('P79 harness — scheduling', () => {
  it('Results do not depend on the order jobs finish in', async () => {
    const jobs = [0, 1, 2, 3, 4, 5, 6];
    const finishOrder: number[] = [];
    const results = await runPool(jobs, 4, async (job) => {
      // Later jobs finish first.
      await new Promise((r) => setTimeout(r, (jobs.length - job) * 3));
      finishOrder.push(job);
      return job * 10;
    });
    expect(results).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(finishOrder).not.toEqual(jobs);
  });

  it('Never runs more than the cap at once', async () => {
    let live = 0;
    let peak = 0;
    await runPool([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 2));
      live -= 1;
      return 0;
    });
    expect(peak).toBe(3);
  });

  it('Chunking jobs across workers and reassembling keeps job order', () => {
    const jobs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const chunks = chunkRoundRobin(jobs, 3);
    expect(chunks).toHaveLength(3);
    expect(chunks.flat().toSorted()).toEqual(jobs);
    // Workers return their chunk's results in chunk order; reassembly restores job order.
    expect(unchunk(chunks.map((chunk) => chunk.map((j) => j.toUpperCase())), jobs.length)).toEqual(
      jobs.map((j) => j.toUpperCase()),
    );
    expect(chunkRoundRobin(jobs, 20)).toHaveLength(jobs.length);
  });
});

/**
 * The root config's `test.include`. Loaded at run time: it sits outside the web
 * package's `rootDir`, so a static import would not typecheck.
 */
const rootInclude = async (): Promise<readonly string[]> => {
  const mod: unknown = await import(pathToFileURL(join(repoRoot, 'vitest.config.ts')).href);
  const config = (mod as { readonly default?: { readonly test?: { readonly include?: unknown } } }).default;
  const include = config?.test?.include;
  if (!Array.isArray(include) || !include.every((p): p is string => typeof p === 'string')) {
    throw new Error('setup: root vitest.config.ts has no test.include');
  }
  return include;
};

describe('P79 harness — outside pnpm test', () => {
  it('`pnpm test` does not run the bench suite', async () => {
    const rootPatterns = await rootInclude();
    const benchInclude = benchConfig.test?.include ?? [];
    expect(rootPatterns.length).toBeGreaterThan(0);
    const benchTests = readdirSync(here)
      .filter((name) => name.endsWith('.test.ts'))
      .map((name) => relative(repoRoot, join(here, name)));
    expect(benchTests.length).toBeGreaterThan(0);
    for (const file of benchTests) {
      for (const pattern of rootPatterns) expect(matchesGlob(file, pattern)).toBe(false);
      const fromBench = relative(resolve(here, '..'), join(repoRoot, file));
      expect(benchInclude.some((pattern) => matchesGlob(fromBench, pattern))).toBe(true);
    }
  });
});
