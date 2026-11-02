/**
 * P83 I9 and Decision 10 — docs/spec/byok-opening-horizon/byok-opening-horizon.md.
 * Scripted `FetchLike` only.
 */

import { makeMatch } from '@conquarrow/geometry-tiling';
import { describe, expect, it } from 'vitest';
import { clearByokPlans } from '../../src/byokBot';
import { clearTargetLocks } from '../../src/targets';
import { main, type CliIo } from '../src/cli';
import { matchConfigFor } from '../src/grid';
import { runMatch, type MatchRecord } from '../src/match';
import { createByokSeat, playByokSeatTurn } from '../src/seat';
import { inProcessJobs } from '../src/tiers';
import {
  SECRET_KEY,
  access,
  fastRetry,
  filesUnder,
  noSleep,
  scriptedModel,
  tempDir,
  type Script,
  type ScriptedModel,
} from './harness.support';
import { byokTurnStarts, cell, isRecordedText, reply } from './byok-turns.support';

/** Mixed replies: strings, a long multi-line plan, missing and non-string keys, an unusable reply. */
const mixedScript: Script = (_call, i) => {
  switch (i % 5) {
    case 0:
      return { content: reply({ moves: [0], endTurn: false, why: 'open', plan: `go\n${'z'.repeat(700)}` }) };
    case 1:
      return { content: reply({ moves: [0], endTurn: true, why: ['not', 'a', 'string'] }) };
    case 2:
      return { content: reply({ moves: [0], endTurn: true, plan: 7 }) };
    case 3:
      return { content: 'no json here' };
    default:
      return { content: reply({ moves: [0, 1], endTurn: true, why: 'w', plan: 'p' }) };
  }
};

const testIo = (dir: string, model: ScriptedModel): CliIo => ({
  env: { BYOK_BASE_URL: access.baseUrl, BYOK_MODEL: access.model, BYOK_API_KEY: SECRET_KEY },
  log: () => undefined,
  fetch: model.fetch,
  now: () => 0,
  isoNow: () => '2026-11-02T00:00:00.000Z',
  revision: () => ({ sha: 'abc1234', dirty: false }),
  resultsDir: dir,
  sleep: noSleep,
  jobRunner: (env) => inProcessJobs(env),
});

describe('P83 byok-opening-horizon invariants — the bench record', () => {
  it('I9 — every byokTurns[i].at starts a BYOK seat-turn; every reply text is null or one line of at most PLAN_CAP', async () => {
    const records: MatchRecord[] = [];
    for (const seat of ['first', 'second'] as const) {
      const model = scriptedModel(mixedScript);
      records.push(
        await runMatch({
          cell: cell(2, seat),
          cap: 3,
          chair: createByokSeat(access, 'reasoning', model.fetch, fastRetry),
        }),
      );
    }
    let entries = 0;
    let texts = 0;
    for (const record of records) {
      expect(record.byokTurns.length, record.cell.id).toBe(record.byok.turns);
      expect(record.byokTurns.map((t) => t.at), record.cell.id).toEqual(byokTurnStarts(record));
      for (const t of record.byokTurns) {
        entries += 1;
        for (const r of t.replies) {
          texts += 2;
          expect(isRecordedText(r.plan), `${record.cell.id} plan ${String(r.plan)}`).toBe(true);
          expect(isRecordedText(r.why), `${record.cell.id} why ${String(r.why)}`).toBe(true);
        }
      }
    }
    expect(entries).toBeGreaterThan(3);
    expect(texts).toBeGreaterThan(4);
  });

  it('Decision 10 — LlmBotTurn.replies: one entry per usable completion, in call order; a failed fetch adds none', async () => {
    clearByokPlans();
    clearTargetLocks();
    const model = scriptedModel((_call, i) =>
      i === 0
        ? { content: reply({ moves: [0], endTurn: false, why: 'first', plan: 'one' }) }
        : { error: new Error('connect refused') },
    );
    const start = makeMatch(matchConfigFor(1));
    const turn = await playByokSeatTurn(createByokSeat(access, 'reasoning', model.fetch, fastRetry), start);
    expect(model.calls.length, 'setup: the second completion was never requested').toBeGreaterThan(1);
    expect(turn.llmFallbacks, 'setup: the failed fetch did not fall back').toBe(1);
    expect(turn.replies).toEqual([{ plan: 'one', why: 'first' }]);
  });

  it('Decision 10 — the results file carries the replies, no prompt text, and the key redacted', async () => {
    const dir = tempDir();
    const model = scriptedModel(() => ({
      content: reply({ moves: [0], endTurn: true, why: 'keep it', plan: `remember ${SECRET_KEY}` }),
    }));
    const code = await main(
      ['matches', '--cells', 's1-first', '--round-cap', '1', '--mode', 'fast', '--max-usd', '5', '--yes'],
      testIo(dir, model),
    );
    expect(code).toBe(0);
    const files = filesUnder(dir);
    expect(files).toHaveLength(1);
    const file = files[0] ?? '';
    expect(file).toContain('"byokTurns"');
    expect(file).toContain('"why": "keep it"');
    expect(file).toContain('remember [redacted]');
    expect(file).not.toContain(SECRET_KEY);
    expect(file).not.toContain('LEGAL_MOVES');
    expect(file).not.toContain('STATE_JSON');
    expect(file).not.toContain('Exposed tips');
  });
});
