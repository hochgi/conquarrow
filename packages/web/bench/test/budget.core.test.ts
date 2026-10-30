/**
 * P79 budget: the spend meter, the price table and the hard `--max-usd` cap.
 * Scripted `FetchLike` returning `usage`; no network, no key.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { describe, expect, it } from 'vitest';
import { clearByokPlans } from '../../src/byokBot';
import { clearTargetLocks } from '../../src/targets';
import { createMeter, DEFAULT_PRICES, readUsage, usdOf } from '../src/budget';
import { main, type CliIo } from '../src/cli';
import { corpusLog, corpusPositions } from '../src/corpus';
import { cellId, matchConfigFor, type Cell } from '../src/grid';
import { runMatch } from '../src/match';
import { createByokSeat, playByokSeatTurn } from '../src/seat';
import { inProcessJobs, runMatchesTier } from '../src/tiers';
import {
  SECRET_KEY,
  access,
  batch,
  fastRetry,
  noSleep,
  scriptedModel,
  tempDir,
  type ScriptedModel,
} from './harness.support';

const cell = (seed: number, byokSeat: 'first' | 'second'): Cell => ({
  id: cellId(seed, byokSeat),
  seed,
  byokSeat,
});

/** 10k in, 1k out at the default prices: 0.020 + 0.006 = $0.026 a call. */
const PRICEY = { prompt_tokens: 10_000, completion_tokens: 1_000, total_tokens: 11_000 };
const PRICEY_USD = 0.026;

const priceyModel = (): ScriptedModel => scriptedModel(() => ({ content: batch([0], true), usage: PRICEY }));

const testIo = (dir: string, model: ScriptedModel, lines: string[]): CliIo => ({
  env: { BYOK_BASE_URL: access.baseUrl, BYOK_MODEL: access.model, BYOK_API_KEY: SECRET_KEY },
  log: (line) => {
    lines.push(line);
  },
  fetch: model.fetch,
  now: () => 0,
  isoNow: () => '2026-10-30T00:00:00.000Z',
  revision: () => ({ sha: 'abc1234', dirty: false }),
  resultsDir: dir,
  sleep: noSleep,
  jobRunner: (env) => inProcessJobs(env),
});

const onlyResult = (dir: string): Record<string, unknown> => {
  const files = readdirSync(dir);
  expect(files).toHaveLength(1);
  return JSON.parse(readFileSync(join(dir, files[0] ?? ''), 'utf8')) as Record<string, unknown>;
};

describe('P79 budget — cost math', () => {
  it('prices uncached input, cached input and output separately', () => {
    const plain = readUsage({ usage: { prompt_tokens: 1000, completion_tokens: 200 } }, true);
    expect(plain).toEqual({
      promptTokens: 1000,
      cachedTokens: 0,
      completionTokens: 200,
      reasoningTokens: 0,
      billableOutputTokens: 200,
    });
    expect(usdOf(plain, DEFAULT_PRICES)).toBeCloseTo((1000 * 2 + 200 * 6) / 1e6, 12);

    const cached = readUsage(
      { usage: { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 600 }, completion_tokens: 200 } },
      true,
    );
    expect(cached.cachedTokens).toBe(600);
    expect(usdOf(cached, DEFAULT_PRICES)).toBeCloseTo((400 * 2 + 600 * 0.5 + 200 * 6) / 1e6, 12);
  });

  it('does not double-count reasoning already inside completion_tokens (total = P + O)', () => {
    const u = readUsage(
      {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          completion_tokens_details: { reasoning_tokens: 300 },
          total_tokens: 1500,
        },
      },
      true,
    );
    expect(u.reasoningTokens).toBe(300);
    expect(u.billableOutputTokens).toBe(500);
  });

  it('adds reasoning billed on top of completion_tokens (total = P + O + R, or O < R)', () => {
    const byTotal = readUsage(
      {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          completion_tokens_details: { reasoning_tokens: 300 },
          total_tokens: 1800,
        },
      },
      false,
    );
    expect(byTotal.billableOutputTokens).toBe(800);
    const bySize = readUsage(
      { usage: { prompt_tokens: 1000, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 900 } } },
      false,
    );
    expect(bySize.billableOutputTokens).toBe(920);
  });

  it('falls back to the flag when the shape cannot tell, defaulting to over-counting', () => {
    const body = {
      usage: { prompt_tokens: 1000, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 300 } },
    };
    expect(readUsage(body, true).billableOutputTokens).toBe(800);
    expect(readUsage(body, false).billableOutputTokens).toBe(500);
    expect(createMeter(1).reasoningBilledSeparately).toBe(true);
  });

  it('reads an absent usage as zero and clamps cached to prompt', () => {
    expect(usdOf(readUsage({}, true), DEFAULT_PRICES)).toBe(0);
    const clamped = readUsage({ usage: { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 50 } } }, true);
    expect(clamped.cachedTokens).toBe(10);
  });

  it('meters from a clone: the adapter still parses the reply and sees the same usage', async () => {
    clearByokPlans();
    clearTargetLocks();
    const meter = createMeter(10);
    const seat = createByokSeat(access, 'reasoning', priceyModel().fetch, fastRetry, meter);
    const turn = await playByokSeatTurn(seat, makeMatch(matchConfigFor(1)));
    expect(turn.llmHits).toBe(1);
    expect(turn.promptTokens).toBe(10_000);
    expect(meter.total.calls).toBe(1);
    expect(meter.total.usd).toBeCloseTo(PRICEY_USD, 12);
    expect(seat.tally.cost.usd).toBeCloseTo(PRICEY_USD, 12);
  });
});

describe('P79 budget — the cap', () => {
  it('stops before exceeding the cap and records the in-flight match as aborted_budget', async () => {
    const model = priceyModel();
    const meter = createMeter(0.1);
    const record = await runMatch({
      cell: cell(1, 'first'),
      cap: 50,
      chair: createByokSeat(access, 'reasoning', model.fetch, fastRetry, meter),
    });
    // 0.03 estimate, then 0.026 a call: 0.026, 0.052, 0.078 — a fourth would reach 0.104.
    expect(model.calls).toHaveLength(3);
    expect(meter.exhausted).toBe(true);
    expect(meter.total.usd).toBeLessThanOrEqual(0.1);
    expect(record.outcome.kind).toBe('aborted_budget');
    expect(record.cost.usd).toBeCloseTo(3 * PRICEY_USD, 12);
    // The refused turn (a heuristic fallback) is not counted or folded in.
    expect(record.byok.turns).toBe(3);
    expect(record.byok.fallbacks).toBe(0);
  });

  it('overshoots by at most one call when calls get dearer than the estimate', async () => {
    let n = 0;
    const model = scriptedModel(() => {
      n += 1;
      return { content: batch([0], true), usage: { prompt_tokens: 5_000 * n, completion_tokens: 0 } };
    });
    const meter = createMeter(0.1);
    await runMatch({
      cell: cell(2, 'first'),
      cap: 50,
      chair: createByokSeat(access, 'reasoning', model.fetch, fastRetry, meter),
    });
    const lastCall = (5_000 * n * 2) / 1e6;
    expect(meter.exhausted).toBe(true);
    expect(meter.total.usd).toBeLessThanOrEqual(0.1 + lastCall);
  });

  it('excludes an aborted match from scoring and skips the cells after it', async () => {
    const model = priceyModel();
    const env = { access, baseFetch: model.fetch, retry: fastRetry, meter: createMeter(0.04) };
    const result = await runMatchesTier(
      [cell(1, 'first'), cell(1, 'second'), cell(2, 'first')],
      1,
      'reasoning',
      inProcessJobs(env),
    );
    expect(result.cells.map((c) => c.outcome.kind)).toEqual(['capped', 'aborted_budget']);
    expect(result.cells[1]?.score).toBeNull();
    expect(result.mean).toBe(result.cells[0]?.score);
    expect(result.abortedCells).toEqual(['s1-second']);
    expect(result.skippedCells).toEqual(['s2-first']);
    expect(result.budgetExhausted).toBe(true);
    expect(result.spend.cost.usd).toBeCloseTo(PRICEY_USD, 12);
  });
});

describe('P79 budget — the CLI', () => {
  it('refuses a model tier without --max-usd, before any call', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = priceyModel();
    expect(await main(['positions', '--max-positions', '1', '--yes'], testIo(dir, model, lines))).not.toBe(0);
    expect(model.calls).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/--max-usd is required/);
  });

  it('writes what it has, prints the cap and exits non-zero when the budget runs out', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = priceyModel();
    const code = await main(
      ['matches', '--cells', 's1-first,s1-second,s2-first', '--round-cap', '1', '--max-usd', '0.04', '--yes'],
      testIo(dir, model, lines),
    );
    expect(code).toBe(4);
    const body = onlyResult(dir);
    expect(body['abortedCells']).toEqual(['s1-second']);
    expect(body['skippedCells']).toEqual(['s2-first']);
    expect(body['concurrency']).toBe(1);
    expect((body['cost'] as { usd: number }).usd).toBeCloseTo(PRICEY_USD, 12);
    expect((body['budget'] as { maxUsd: number }).maxUsd).toBe(0.04);
    const text = lines.join('\n');
    expect(text).toMatch(/BUDGET CAP REACHED/);
    expect(text).toMatch(/cost \$0\.0260/);
  });

  it('runs a single short calibration match: --cells and --round-cap', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = priceyModel();
    const code = await main(
      ['matches', '--cells', 's2-second', '--round-cap', '1', '--max-usd', '5', '--yes'],
      testIo(dir, model, lines),
    );
    expect(code).toBe(0);
    const body = onlyResult(dir);
    expect(body['k']).toBe(1);
    expect(body['concurrency']).toBe(4);
    const cells = body['cells'] as { cell: { id: string }; rounds: number; cost: { calls: number; usd: number } }[];
    expect(cells.map((c) => c.cell.id)).toEqual(['s2-second']);
    expect(cells[0]?.rounds).toBe(1);
    expect(cells[0]?.cost.calls).toBe(model.calls.length);
  });

  it('runs only the named positions, in the order named', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = priceyModel();
    const playtest = corpusPositions(corpusLog('playtest-2026-10-29'))[3];
    if (playtest === undefined) throw new Error('setup: playtest log has too few positions');
    const ids = [`final-match-log#${String(playtest.moveIndex)}`, 'grok-2026-09-10T0657#0'];
    const code = await main(['positions', '--positions', ids.join(','), '--max-usd', '1', '--yes'], testIo(dir, model, lines));
    expect(code).toBe(0);
    const positions = onlyResult(dir)['positions'] as { id: string }[];
    expect(positions.map((p) => p.id)).toEqual([
      `playtest-2026-10-29#${String(playtest.moveIndex)}`,
      'grok-2026-09-10T0657#0',
    ]);
  });

  it('rejects a position id that names no position, before any call', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = priceyModel();
    const code = await main(['positions', '--positions', 'grok-2026-09-10T0657#1', '--max-usd', '1', '--yes'], testIo(dir, model, lines));
    expect(code).not.toBe(0);
    expect(model.calls).toHaveLength(0);
  });
});
