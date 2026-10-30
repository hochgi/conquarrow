/**
 * P79 scenario inventory — the positions metrics, key hygiene and the spend gate.
 * Scripted `FetchLike` only.
 */

import { readdirSync } from 'node:fs';
import type { ArrowId, GameState, Group, PlayerId, StepMove } from '@conquarrow/contracts';
import { speed } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { describe, expect, it } from 'vitest';
import { annotateMove, clearByokPlans, movesForLlm } from '../../src/byokBot';
import { clearTargetLocks } from '../../src/targets';
import { geometry, rules } from '../src/board';
import { main, type CliIo } from '../src/cli';
import { corpusLog, corpusPositions } from '../src/corpus';
import { matchConfigFor } from '../src/grid';
import { isInteriorPass, isMissedClose, shareCloseRows } from '../src/metrics';
import { createByokSeat, playByokSeatTurn } from '../src/seat';
import { inProcessJobs } from '../src/tiers';
import { relayFetch } from '../src/transport';
import { BYOK_UPSTREAM_HEADER } from '../../src/byokConfig';
import {
  SECRET_KEY,
  access,
  batch,
  fastRetry,
  filesUnder,
  noSleep,
  scriptedModel,
  seatNamedIn,
  tempDir,
  type ScriptedModel,
} from './harness.support';

const fresh = (): void => {
  clearByokPlans();
  clearTargetLocks();
};

const spentOut = (state: GameState, me: PlayerId): GameState => {
  const groups = new Map<ArrowId, Group>();
  for (const [arrow, group] of state.groups) {
    groups.set(arrow, group.owner === me ? { ...group, spent: speed(group.heads) } : group);
  }
  return { ...state, groups };
};

const tags = (row: string): readonly string[] => /\btags=(\S+)/.exec(row)?.[1]?.split(',') ?? [];

/** First playtest position whose offer has a `closes` row carrying `share+N`. */
const positionWithShareClose = (): {
  readonly state: GameState;
  readonly closeIndex: number;
  readonly otherIndex: number;
} => {
  for (const position of corpusPositions(corpusLog('playtest-2026-10-29'))) {
    const me = position.state.activePlayer;
    const offer = movesForLlm(rules.legalMoves(position.state));
    let closeIndex = -1;
    let otherIndex = -1;
    offer.forEach((move, index) => {
      const rowTags = tags(annotateMove(geometry, rules, position.state, me, move));
      const shareClose = rowTags.includes('closes') && rowTags.some((t) => /^share\+[1-9]\d*$/.test(t));
      if (shareClose && closeIndex < 0) closeIndex = index;
      if (!rowTags.includes('closes') && !rowTags.includes('land_bridge') && otherIndex < 0) {
        otherIndex = index;
      }
    });
    if (closeIndex >= 0 && otherIndex >= 0) return { state: position.state, closeIndex, otherIndex };
  }
  throw new Error('setup: no corpus position offers a share-gaining close');
};

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

describe('P79 harness — interior pass', () => {
  it('is counted for an empty endTurn batch while a stack can move', async () => {
    fresh();
    const start = makeMatch(matchConfigFor(1));
    const model = scriptedModel(() => ({ content: batch([], true) }));
    const turn = await playByokSeatTurn(createByokSeat(access, 'reasoning', model.fetch, fastRetry), start);
    expect(turn.llmFallbacks).toBe(0);
    expect(turn.moves.every((m) => m.kind === 'endTurn')).toBe(true);
    expect(isInteriorPass(start, turn)).toBe(true);
  });

  it('is not counted for a seat with no legal step', async () => {
    fresh();
    const opening = makeMatch(matchConfigFor(1));
    const start = spentOut(opening, opening.activePlayer);
    expect(rules.legalMoves(start).some((m) => m.kind === 'step')).toBe(false);
    const model = scriptedModel(() => ({ content: batch([], true) }));
    const turn = await playByokSeatTurn(createByokSeat(access, 'reasoning', model.fetch, fastRetry), start);
    expect(model.calls).toHaveLength(0);
    expect(isInteriorPass(start, turn)).toBe(false);
  });

  it('is not counted when the batch plays a step', async () => {
    fresh();
    const start = makeMatch(matchConfigFor(1));
    const model = scriptedModel(() => ({ content: batch([0], true) }));
    const turn = await playByokSeatTurn(createByokSeat(access, 'reasoning', model.fetch, fastRetry), start);
    expect(isInteriorPass(start, turn)).toBe(false);
  });
});

describe('P79 harness — missed close', () => {
  it('is counted when the offer had a share+N close and the batch played none, and not when it played one', async () => {
    const { state, closeIndex, otherIndex } = positionWithShareClose();
    const rows = shareCloseRows(state);
    const offer = movesForLlm(rules.legalMoves(state));
    const close = offer[closeIndex] as StepMove;
    expect(rows.some((r) => r.from === close.from && r.exit === close.exit && r.count === close.count)).toBe(true);

    fresh();
    const played = scriptedModel(() => ({ content: batch([closeIndex], true) }));
    const playedTurn = await playByokSeatTurn(createByokSeat(access, 'reasoning', played.fetch, fastRetry), state);
    expect(playedTurn.llmFallbacks).toBe(0);
    expect(isMissedClose(rows, playedTurn)).toBe(false);

    fresh();
    const missed = scriptedModel(() => ({ content: batch([otherIndex], true) }));
    const missedTurn = await playByokSeatTurn(createByokSeat(access, 'reasoning', missed.fetch, fastRetry), state);
    expect(missedTurn.llmFallbacks).toBe(0);
    expect(isMissedClose(rows, missedTurn)).toBe(true);
  });

  it('is not counted when the offer has no share+N close', async () => {
    fresh();
    const start = makeMatch(matchConfigFor(1));
    expect(shareCloseRows(start)).toEqual([]);
    const model = scriptedModel(() => ({ content: batch([0], true) }));
    const turn = await playByokSeatTurn(createByokSeat(access, 'reasoning', model.fetch, fastRetry), start);
    expect(isMissedClose(shareCloseRows(start), turn)).toBe(false);
  });
});

describe('P79 harness — hygiene and spend', () => {
  it('The configured API key string appears in no results file and no captured log line', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    // Seat A's chair (s1-first) only ever gets transport errors that quote the
    // key: it falls back, is rerun, falls back again and is reported invalid with
    // that error. Seat B's chair (s1-second) gets one retried 500, then replies
    // that echo the key back in their plan.
    let served500 = false;
    const model = scriptedModel((call) => {
      if (seatNamedIn(call.user) === 'A') {
        return { error: new Error(`connect refused; auth was Bearer ${SECRET_KEY}`) };
      }
      if (!served500) {
        served500 = true;
        return { status: 500 };
      }
      return { content: `${batch([0], true, `remember ${SECRET_KEY}`)} ${call.headers['authorization'] ?? ''}` };
    });
    const code = await main(
      ['matches', '--cells', 's1-first,s1-second', '--round-cap', '1', '--mode', 'fast', '--max-usd', '5', '--yes'],
      testIo(dir, model, lines),
    );
    expect(code).toBe(0);
    // The key did go out — on the Authorization header, and nowhere else.
    expect(model.calls[0]?.headers['authorization']).toBe(`Bearer ${SECRET_KEY}`);
    const files = filesUnder(dir);
    expect(files).toHaveLength(1);
    expect(files.join('\n')).toContain('[redacted]');
    for (const file of files) expect(file).not.toContain(SECRET_KEY);
    for (const line of lines) expect(line).not.toContain(SECRET_KEY);
    expect(lines.join('\n')).toContain('tokens in');
    expect(lines.join('\n')).toContain('INVALID');
  });

  it('A matches run without --yes prints the projection and makes no model call', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = scriptedModel(() => ({ content: batch([0], true) }));
    const code = await main(['matches', '--round-cap', '40', '--max-usd', '5'], testIo(dir, model, lines));
    expect(code).not.toBe(0);
    expect(model.calls).toHaveLength(0);
    expect(readdirSync(dir)).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/--yes/);
  });

  it('A run refuses to overwrite an existing results file, before spending anything', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const model = scriptedModel(() => ({ content: batch([0], true) }));
    const args = ['positions', '--max-positions', '1', '--max-usd', '1', '--yes'];
    expect(await main(args, testIo(dir, model, lines))).toBe(0);
    const calls = model.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(readdirSync(dir)).toEqual(['positions-abc1234-reasoning-grok-scripted.json']);
    expect(await main(args, testIo(dir, model, lines))).not.toBe(0);
    expect(model.calls).toHaveLength(calls);
    expect(await main([...args, '--tag', 'run2'], testIo(dir, model, lines))).toBe(0);
    expect(readdirSync(dir).toSorted()).toEqual([
      'positions-abc1234-reasoning-grok-scripted-run2.json',
      'positions-abc1234-reasoning-grok-scripted.json',
    ]);
  });
});

describe('P79 harness — the Node stand-in for the dev relay', () => {
  it('forwards a `/__byok` request to its upstream header, without that header', async () => {
    const model = scriptedModel(() => ({ content: batch([0], true) }));
    const upstream = 'https://api.x.ai/v1/chat/completions';
    await relayFetch(model.fetch)('/__byok', {
      method: 'POST',
      headers: { Authorization: 'Bearer k', [BYOK_UPSTREAM_HEADER]: upstream },
      body: JSON.stringify({ messages: [] }),
    });
    expect(model.calls[0]?.url).toBe(upstream);
    expect(model.calls[0]?.headers['authorization']).toBe('Bearer k');
    expect(model.calls[0]?.headers[BYOK_UPSTREAM_HEADER.toLowerCase()]).toBeUndefined();
  });

  it('refuses an upstream outside the adapter allowlist', async () => {
    const model = scriptedModel(() => ({ content: batch([0], true) }));
    await expect(
      relayFetch(model.fetch)('/__byok', {
        method: 'POST',
        headers: { [BYOK_UPSTREAM_HEADER]: 'https://evil.example/v1/chat/completions' },
      }),
    ).rejects.toThrow(/no allowed upstream/);
    expect(model.calls).toHaveLength(0);
  });
});
