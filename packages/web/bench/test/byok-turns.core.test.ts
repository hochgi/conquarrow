/**
 * docs/spec/byok-opening-horizon/byok-opening-horizon.core.feature
 * Rule: Bench hygiene — "A benched match records each BYOK turn's plan and why".
 * Scripted `FetchLike` only.
 */

import { describe, expect, it } from 'vitest';
import { runMatch } from '../src/match';
import { createByokSeat } from '../src/seat';
import { access, fastRetry, scriptedModel } from './harness.support';
import { byokTurnStarts, cell, reply } from './byok-turns.support';

describe('P83 byok-opening-horizon core — bench hygiene', () => {
  it('A benched match records each BYOK turn\'s plan and why', async () => {
    // Call i plays row 0 with plan p<i> / why w<i>; even calls keep the turn
    // open, so most seat-turns take two completions.
    const model = scriptedModel((_call, i) => ({
      content: reply({ moves: [0], endTurn: i % 2 === 1, why: `w${String(i)}`, plan: `p${String(i)}` }),
    }));
    const record = await runMatch({
      cell: cell(1, 'first'),
      cap: 2,
      chair: createByokSeat(access, 'reasoning', model.fetch, fastRetry),
    });
    expect(record.byok.fallbacks, 'setup: a scripted turn fell back').toBe(0);
    expect(record.byok.turns, 'setup: no BYOK turn was played').toBeGreaterThan(1);

    // One entry per BYOK seat-turn played …
    expect(record.byokTurns).toHaveLength(record.byok.turns);
    // … each at that seat-turn's first move in `moves` …
    expect(record.byokTurns.map((t) => t.at)).toEqual(byokTurnStarts(record));
    // … holding the plan and why of each completion, in call order.
    const all = model.calls.map((_call, i) => ({ plan: `p${String(i)}`, why: `w${String(i)}` }));
    expect(record.byokTurns.flatMap((t) => t.replies)).toEqual(all);
    expect(record.byokTurns.some((t) => t.replies.length > 1), 'setup: no turn took two completions').toBe(true);
    for (const t of record.byokTurns) expect(t.replies.length).toBeGreaterThan(0);
  });
});
