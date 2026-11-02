/**
 * P72 advisor arm of the P79 harness: `--advisor jev`.
 *
 * Advisor calls are routed by target (`…/systemone`) to their own retry layer,
 * counters and meter, so they never count as model completions or as model
 * spend. The copy rate is read from the turn's advisor records. The advisor's
 * key is redacted exactly like the seat's.
 */

import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../../src/byokBot';
import { createMeter, JEV_PRICES } from '../src/budget';
import { main, type CliIo } from '../src/cli';
import { corpusPosition, CORPUS_NAMES, corpusLog, corpusPositions } from '../src/corpus';
import { createByokSeat, isAdvisorTarget, playByokSeatTurn, type AdvisorAccess } from '../src/seat';
import { inProcessJobs } from '../src/tiers';
import { redactor } from '../src/transport';
import { access, batch, fastRetry, filesUnder, noSleep, SECRET_KEY, tempDir } from './harness.support';

const JEV_SECRET = 'jev-P72-SECRET-do-not-leak-7d21aa';

const jev: AdvisorAccess = {
  name: 'jev',
  baseUrl: 'https://api.typesafe.ai/v1',
  model: 'jev-latest',
  apiKey: JEV_SECRET,
};

interface Seen {
  readonly url: string;
  readonly auth: string | null;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Option count of a System One body: its `criteria` keys. */
const optionCount = (init: RequestInit | undefined): number => {
  const raw = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  const questions = raw['questions'] as { move?: { criteria?: Record<string, string> } } | undefined;
  return Object.keys(questions?.move?.criteria ?? {}).length;
};

/**
 * jev puts all its weight on `m<top>` and reports `input_tokens`; the model
 * plays `modelPick` and ends its turn. `advisorStatus` ≠ 200 makes jev fail.
 */
const scripted = (opts: {
  readonly top: number;
  readonly modelPick: number;
  readonly advisorStatus?: number;
  readonly echoKeyInError?: boolean;
}): { readonly fetch: FetchLike; readonly seen: Seen[] } => {
  const seen: Seen[] = [];
  const fetch: FetchLike = (url, init) => {
    seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
    if (isAdvisorTarget(url)) {
      if (opts.advisorStatus !== undefined && opts.advisorStatus !== 200) {
        const error = opts.echoKeyInError === true ? `bad key ${JEV_SECRET}` : 'scripted';
        return Promise.resolve(json({ error }, opts.advisorStatus));
      }
      const n = optionCount(init);
      const probabilities = Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`m${String(i)}`, i === opts.top ? 0.9 : 0.1 / Math.max(1, n - 1)]),
      );
      return Promise.resolve(
        json({ model: 'jev-1.14.0', answers: { move: { probabilities } }, usage: { input_tokens: 10_000 } }),
      );
    }
    return Promise.resolve(
      json({
        choices: [{ finish_reason: 'stop', message: { content: batch([opts.modelPick], true) } }],
        usage: { prompt_tokens: 1000, completion_tokens: 10 },
      }),
    );
  };
  return { fetch, seen };
};

const firstPosition = (): ReturnType<typeof corpusPosition> => {
  const name = CORPUS_NAMES[0];
  if (name === undefined) throw new Error('empty corpus');
  const first = corpusPositions(corpusLog(name))[0];
  if (first === undefined) throw new Error('corpus log has no position');
  return corpusPosition(name, first.moveIndex);
};

const testIo = (dir: string, fetch: FetchLike, lines: string[], env: Record<string, string> = {}): CliIo => ({
  env: {
    BYOK_BASE_URL: access.baseUrl,
    BYOK_MODEL: access.model,
    BYOK_API_KEY: SECRET_KEY,
    JEV_API_KEY: JEV_SECRET,
    ...env,
  },
  log: (line) => {
    lines.push(line);
  },
  fetch,
  now: () => 0,
  isoNow: () => '2026-11-02T00:00:00.000Z',
  revision: () => ({ sha: 'abc1234', dirty: false }),
  resultsDir: dir,
  sleep: noSleep,
  jobRunner: (env) => inProcessJobs(env),
});

describe('P72 advisor arm — the seat', () => {
  it('routes advisor calls to their own counters and meter, priced at jev rates', async () => {
    const model = scripted({ top: 0, modelPick: 0 });
    const chatMeter = createMeter(5);
    const advisorMeter = createMeter(0.5, JEV_PRICES, false);
    const seat = createByokSeat(access, 'fast', model.fetch, fastRetry, chatMeter, { access: jev, meter: advisorMeter });
    const turn = await playByokSeatTurn(seat, firstPosition().state);

    const advisorCalls = model.seen.filter((c) => isAdvisorTarget(c.url));
    const chatCalls = model.seen.filter((c) => !isAdvisorTarget(c.url));
    expect(advisorCalls.length).toBeGreaterThan(0);
    expect(advisorCalls.every((c) => c.auth === `Bearer ${JEV_SECRET}`)).toBe(true);
    expect(chatCalls.every((c) => c.auth === `Bearer ${SECRET_KEY}`)).toBe(true);

    expect(seat.counters.calls).toBe(chatCalls.length);
    expect(seat.advisor?.counters.calls).toBe(advisorCalls.length);
    expect(chatMeter.total.calls).toBe(chatCalls.length);
    expect(advisorMeter.total.calls).toBe(advisorCalls.length);
    expect(advisorMeter.total.usd).toBeCloseTo((advisorCalls.length * 10_000 * 0.042) / 1e6, 12);
    expect(turn.advisorRecords).toHaveLength(advisorCalls.length);
  });

  it('an unadvised seat never calls the advisor and has no advisor side', async () => {
    const model = scripted({ top: 0, modelPick: 0 });
    const seat = createByokSeat(access, 'fast', model.fetch, fastRetry);
    await playByokSeatTurn(seat, firstPosition().state);
    expect(model.seen.some((c) => isAdvisorTarget(c.url))).toBe(false);
    expect(seat.advisor).toBeUndefined();
  });
});

describe('P72 advisor arm — the CLI', () => {
  it('positions --advisor jev reports the copy rate and writes advisor totals', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = scripted({ top: 0, modelPick: 0 });
    const code = await main(
      ['positions', '--max-positions', '2', '--max-usd', '1', '--advisor', 'jev', '--advisor-max-usd', '0.5', '--yes'],
      testIo(dir, model.fetch, lines),
    );
    expect(code).toBe(0);
    const [file] = filesUnder(dir);
    const body = JSON.parse(file ?? '{}') as {
      advisorConfig?: { name: string; model: string };
      copyRate: number | null;
      advisorSpend: { calls: number; agreed: number; asked: number; cost: { usd: number } } | null;
    };
    expect(body.advisorConfig?.name).toBe('jev');
    expect(body.copyRate).toBe(1);
    expect(body.advisorSpend?.asked).toBe(body.advisorSpend?.agreed);
    expect(body.advisorSpend?.calls).toBeGreaterThan(0);
    expect(lines.join('\n')).toMatch(/advisor: copied \d+\/\d+ \(1\.000\)/);
    expect(lines.join('\n')).toMatch(/advisor: tokens in \d+, calls \d+/);
  });

  it('counts a model pick away from the advisor top as not copied', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    // jev favours row 1; the model plays row 0.
    const model = scripted({ top: 1, modelPick: 0 });
    await main(
      ['positions', '--max-positions', '1', '--max-usd', '1', '--advisor', 'jev', '--advisor-max-usd', '0.5', '--yes'],
      testIo(dir, model.fetch, lines),
    );
    const body = JSON.parse(filesUnder(dir)[0] ?? '{}') as { copyRate: number | null };
    expect(body.copyRate).toBe(0);
  });

  it('refuses --advisor without --advisor-max-usd, before any call', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = scripted({ top: 0, modelPick: 0 });
    const code = await main(
      ['positions', '--max-positions', '1', '--max-usd', '1', '--advisor', 'jev', '--yes'],
      testIo(dir, model.fetch, lines),
    );
    expect(code).not.toBe(0);
    expect(model.seen).toHaveLength(0);
    expect(lines.join('\n')).toContain('--advisor-max-usd is required');
  });

  it('refuses --advisor when JEV_API_KEY is unset, naming the variable', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = scripted({ top: 0, modelPick: 0 });
    const code = await main(
      ['positions', '--max-positions', '1', '--max-usd', '1', '--advisor', 'jev', '--advisor-max-usd', '0.5', '--yes'],
      testIo(dir, model.fetch, lines, { JEV_API_KEY: '' }),
    );
    expect(code).not.toBe(0);
    expect(model.seen).toHaveLength(0);
    expect(lines.join('\n')).toContain('JEV_API_KEY is not set');
  });

  it('redacts the advisor key exactly like the seat key, even when an error echoes it', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = scripted({ top: 0, modelPick: 0, advisorStatus: 401, echoKeyInError: true });
    const code = await main(
      ['positions', '--max-positions', '1', '--max-usd', '1', '--advisor', 'jev', '--advisor-max-usd', '0.5', '--yes'],
      testIo(dir, model.fetch, lines),
    );
    expect(code).toBe(0);
    const files = filesUnder(dir);
    expect(files).toHaveLength(1);
    for (const text of [...files, ...lines]) {
      expect(text).not.toContain(JEV_SECRET);
      expect(text).not.toContain(SECRET_KEY);
    }
    // The advisor failed, so nothing was advised and the turn still played.
    const body = JSON.parse(files[0] ?? '{}') as { advisorSpend: { failures: number; asked: number } };
    expect(body.advisorSpend.asked).toBe(0);
    expect(body.advisorSpend.failures).toBeGreaterThan(0);
  });
});

describe('P72 advisor arm — redactor', () => {
  it('scrubs every key it is given, a longer key containing a shorter one included', () => {
    const redact = redactor('abc', 'xxabcxx', '');
    expect(redact('k1 abc k2 xxabcxx')).toBe('k1 [redacted] k2 [redacted]');
  });
});
