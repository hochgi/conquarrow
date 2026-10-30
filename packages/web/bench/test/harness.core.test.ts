/**
 * P79 scenario inventory — matches, scoring, fallbacks, retries, seat order.
 * Scripted `FetchLike` only.
 */

import { describe, expect, it } from 'vitest';
import { chooseTurnGreedy } from '../../src/botSearch';
import { clearByokPlans } from '../../src/byokBot';
import { clearTargetLocks } from '../../src/targets';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { geometry, rules } from '../src/board';
import { createMeter } from '../src/budget';
import { cellId, matchConfigFor, type Cell } from '../src/grid';
import { runMatch } from '../src/match';
import { landOf, totalLand } from '../src/metrics';
import { scoreOutcome } from '../src/score';
import { createByokSeat, playByokSeatTurn } from '../src/seat';
import { inProcessJobs, runMatchesTier, runMirrorTier } from '../src/tiers';
import { parseMove } from '../src/moves';
import { mintArrowId } from '@conquarrow/contracts';
import {
  access,
  batch,
  fastRetry,
  firstRowModel,
  scriptedModel,
  seatNamedIn,
  unparseableModel,
} from './harness.support';

const cell = (seed: number, byokSeat: 'first' | 'second'): Cell => ({
  id: cellId(seed, byokSeat),
  seed,
  byokSeat,
});

describe('P79 harness — matches', () => {
  it('A match with a scripted model runs to the cap deterministically, and two runs are byte-identical', async () => {
    const run = async (): Promise<string> => {
      const model = firstRowModel();
      const seat = createByokSeat(access, 'reasoning', model.fetch, fastRetry);
      const record = await runMatch({ cell: cell(1, 'first'), cap: 2, chair: seat });
      return JSON.stringify(record);
    };
    const a = await run();
    const b = await run();
    const parsed = JSON.parse(a) as { outcome: { kind: string; round: number }; rounds: number };
    expect(['won', 'eliminated', 'capped']).toContain(parsed.outcome.kind);
    expect(parsed.rounds).toBeLessThanOrEqual(2);
    expect(b).toBe(a);
  });

  it('A mirror cell run twice produces identical results', async () => {
    const env = { access: undefined, baseFetch: firstRowModel().fetch, retry: fastRetry, meter: createMeter(undefined) };
    const cells = [cell(2, 'second')];
    const a = await runMirrorTier(cells, 2, inProcessJobs(env));
    const b = await runMirrorTier(cells, 2, inProcessJobs(env));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.cells[0]?.driver).toBe('heuristic');
  });

  it('The round cap ends a match and scores it by land share', async () => {
    const model = firstRowModel();
    const seat = createByokSeat(access, 'reasoning', model.fetch, fastRetry);
    const record = await runMatch({ cell: cell(1, 'second'), cap: 1, chair: seat });
    expect(record.outcome.kind).toBe('capped');
    expect(record.rounds).toBe(1);
    if (record.outcome.kind !== 'capped') throw new Error('unreachable');
    // Independently: replay the recorded moves and read the land off the board.
    let at = makeMatch(matchConfigFor(1));
    for (const [i, move] of record.moves.entries()) at = rules.apply(at, parseMove(move, `move ${String(i)}`));
    const me = at.players[1];
    if (me === undefined) throw new Error('setup: no seat B');
    expect(record.outcome.land).toBe(landOf(at, me));
    expect(record.outcome.totalLand).toBe(totalLand(at));
    expect(scoreOutcome(record.outcome, 1)).toBe(landOf(at, me) / totalLand(at));
  });

  it('A win at round r scores 1 + (K − r)/K; elimination scores 0', () => {
    expect(scoreOutcome({ kind: 'won', round: 13 }, 40)).toBe(1 + 27 / 40);
    expect(scoreOutcome({ kind: 'won', round: 0 }, 40)).toBe(2);
    expect(scoreOutcome({ kind: 'won', round: 39 }, 40)).toBeGreaterThan(1);
    expect(scoreOutcome({ kind: 'eliminated', round: 7 }, 40)).toBe(0);
    expect(scoreOutcome({ kind: 'capped', round: 40, land: 30, totalLand: 40 }, 40)).toBe(0.75);
    expect(scoreOutcome({ kind: 'capped', round: 40, land: 40, totalLand: 40 }, 40)).toBe(1);
  });

  it('A scripted unparseable reply is counted as a fallback, and the heuristic plays that turn', async () => {
    clearByokPlans();
    clearTargetLocks();
    const model = unparseableModel();
    const seat = createByokSeat(access, 'reasoning', model.fetch, fastRetry);
    const start = makeMatch(matchConfigFor(1));
    const expected = chooseTurnGreedy(geometry, rules, start, start.activePlayer);
    const turn = await playByokSeatTurn(seat, start);
    expect(turn.llmFallbacks).toBe(1);
    expect(turn.llmHits).toBe(0);
    expect(turn.moves).toEqual(expected);
    expect(model.calls).toHaveLength(1);

    const record = await runMatch({
      cell: cell(1, 'first'),
      cap: 1,
      chair: createByokSeat(access, 'reasoning', unparseableModel().fetch, fastRetry),
    });
    expect(record.byok.fallbacks).toBe(record.byok.turns);
    expect(record.byok.turns).toBeGreaterThan(0);
  });

  it('A scripted 429 is retried, not counted as a fallback', async () => {
    clearByokPlans();
    clearTargetLocks();
    const model = scriptedModel((_call, index) =>
      index === 0 ? { status: 429 } : index === 1 ? { status: 503 } : { content: batch([0], true) },
    );
    const seat = createByokSeat(access, 'reasoning', model.fetch, fastRetry);
    const start = makeMatch(matchConfigFor(1));
    const turn = await playByokSeatTurn(seat, start);
    expect(turn.llmFallbacks).toBe(0);
    expect(turn.llmHits).toBe(1);
    expect(seat.counters.retries).toBe(2);
    expect(seat.counters.calls).toBe(1);
    expect(model.calls).toHaveLength(3);
  });

  it('A cell over the fallback threshold is marked invalid, after one rerun', async () => {
    const model = unparseableModel();
    const env = { access, baseFetch: model.fetch, retry: fastRetry, meter: createMeter(undefined) };
    const result = await runMatchesTier([cell(1, 'first')], 1, 'reasoning', inProcessJobs(env));
    const only = result.cells[0];
    expect(only?.invalid).toBe(true);
    expect(only?.reran).toBe(true);
    expect(result.invalidCells).toEqual(['s1-first']);
    expect(result.meanValid).toBeNull();
    // Two full runs of the cell reached the model.
    const turns = only?.byok.turns ?? 0;
    expect(model.calls.length).toBe(2 * turns);
  });

  it('Seat order is honoured: in a "BYOK second" cell, BYOK is the second player to move', async () => {
    const model = firstRowModel();
    const seat = createByokSeat(access, 'reasoning', model.fetch, fastRetry);
    const record = await runMatch({ cell: cell(3, 'second'), cap: 1, chair: seat });
    expect(record.players).toEqual(['A', 'B']);
    expect(record.byokPlayer).toBe('B');
    const firstCall = model.calls[0];
    expect(firstCall).toBeDefined();
    expect(seatNamedIn(firstCall?.user ?? '')).toBe('B');
    for (const call of model.calls) expect(seatNamedIn(call.user)).toBe('B');
    // Seat A (heuristic) opened the match: the first logged move is A's.
    const opening = makeMatch(matchConfigFor(3));
    expect(String(opening.activePlayer)).toBe('A');
    const firstMove = record.moves[0];
    if (firstMove?.kind === 'step') {
      expect(String(opening.groups.get(mintArrowId(firstMove.from))?.owner)).toBe('A');
    } else {
      expect(firstMove?.kind).toBe('endTurn');
    }

    const firstModel = firstRowModel();
    const firstSeat = createByokSeat(access, 'reasoning', firstModel.fetch, fastRetry);
    const firstRecord = await runMatch({ cell: cell(3, 'first'), cap: 1, chair: firstSeat });
    expect(firstRecord.byokPlayer).toBe('A');
    expect(seatNamedIn(firstModel.calls[0]?.user ?? '')).toBe('A');
  });
});
