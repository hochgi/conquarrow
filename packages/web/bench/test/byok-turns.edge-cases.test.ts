/**
 * docs/spec/byok-opening-horizon/byok-opening-horizon.edge-cases.feature
 * Rule: The bench record — one it() per scenario. Scripted `FetchLike` only.
 */

import { describe, expect, it } from 'vitest';
import { PLAN_CAP } from '../../src/byokBot';
import { runMatch } from '../src/match';
import { createByokSeat } from '../src/seat';
import { access, fastRetry, scriptedModel } from './harness.support';
import { byokTurnStarts, cell, reply, sanitised } from './byok-turns.support';

describe('P83 byok-opening-horizon edge cases — the bench record', () => {
  it('An unusable reply adds no entry, and a non-string plan records null', async () => {
    // Seat-turn 1: one usable completion with no plan key and a numeric why.
    // Seat-turn 2 (and later): an unusable reply — the heuristic finishes it.
    const model = scriptedModel((_call, i) =>
      i === 0
        ? { content: reply({ moves: [0], endTurn: true, why: 42 }) }
        : { content: 'I would like to think about this some more.' },
    );
    const record = await runMatch({
      cell: cell(1, 'first'),
      cap: 2,
      chair: createByokSeat(access, 'reasoning', model.fetch, fastRetry),
    });
    expect(record.byok.turns, 'setup: fewer than two BYOK turns').toBeGreaterThanOrEqual(2);
    expect(record.byok.fallbacks, 'setup: the second turn did not fall back').toBe(record.byok.turns - 1);

    expect(record.byokTurns).toHaveLength(record.byok.turns);
    expect(record.byokTurns.map((t) => t.at)).toEqual(byokTurnStarts(record));
    expect(record.byokTurns[0]?.replies).toEqual([{ plan: null, why: null }]);
    expect(record.byokTurns[1]?.replies).toEqual([]);
  });

  it('Recorded texts are one line and capped', async () => {
    const plan = `walk home first\n${'x'.repeat(600)}`;
    const why = `close\r\nnow ${'y'.repeat(600)}`;
    const model = scriptedModel(() => ({ content: reply({ moves: [0], endTurn: true, why, plan }) }));
    const record = await runMatch({
      cell: cell(1, 'first'),
      cap: 1,
      chair: createByokSeat(access, 'reasoning', model.fetch, fastRetry),
    });
    const first = record.byokTurns[0]?.replies[0];
    expect(first, 'no reply recorded').toBeDefined();
    expect(first?.plan).toBe(sanitised(plan));
    expect(first?.plan).not.toMatch(/[\n\r]/);
    expect(first?.plan?.length).toBeLessThanOrEqual(PLAN_CAP);
    expect(first?.why).toBe(sanitised(why));
    expect(first?.why?.length).toBeLessThanOrEqual(PLAN_CAP);
  });
});
