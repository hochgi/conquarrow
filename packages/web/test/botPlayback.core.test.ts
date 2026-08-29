/**
 * docs/spec/ai-move-playback/ai-move-playback.core.feature
 * One it() per Gherkin scenario. Pure helper only — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import {
  applyMovesSequentially,
  BOT_PLAYBACK_GAP_MS,
  localAiChairKey,
} from '../src/botPlayback';
import { playBotTurn } from '../src/opponent';
import {
  activeId,
  localAiOpts,
  occupancyShifted,
  openingState,
  playbackOpts,
  plannedMoves,
  recorder,
  stubRules,
  threeMoves,
} from './botPlayback.support';

describe('Local AI move playback — order with a gap', () => {
  it('Planned moves apply in listed order', async () => {
    const start = openingState();
    const moves = threeMoves();
    const { rules, applyCalls } = stubRules();
    const rec = recorder();
    await applyMovesSequentially(rules, start, moves, playbackOpts(rec));
    expect(rec.applied).toHaveLength(3);
    expect(rec.applied.map((event) => event.move)).toEqual([...moves]);
    expect(rec.applied.map((event) => event.index)).toEqual([0, 1, 2]);
    expect(applyCalls.map((call) => call.move)).toEqual([...moves]);
  });

  it('Sleep between consecutive moves, not after the last', async () => {
    const start = openingState();
    const moves = threeMoves();
    const { rules } = stubRules();
    const rec = recorder();
    expect(BOT_PLAYBACK_GAP_MS).toBe(400);
    await applyMovesSequentially(rules, start, moves, playbackOpts(rec, 400));
    expect(rec.sleeps).toEqual([400, 400]);
    expect(rec.timeline.at(-1)).toEqual({ kind: 'onApplied', index: 2 });
    expect(rec.timeline).toEqual([
      { kind: 'onApplied', index: 0 },
      { kind: 'sleep', ms: 400 },
      { kind: 'onApplied', index: 1 },
      { kind: 'sleep', ms: 400 },
      { kind: 'onApplied', index: 2 },
    ]);
  });

  it('First move applies before any inter-move sleep', async () => {
    const start = openingState();
    const moves = plannedMoves(2);
    const { rules } = stubRules();
    const rec = recorder();
    await applyMovesSequentially(rules, start, moves, playbackOpts(rec));
    expect(rec.timeline[0]).toEqual({ kind: 'onApplied', index: 0 });
    const firstSleep = rec.timeline.findIndex((event) => event.kind === 'sleep');
    expect(firstSleep).toBeGreaterThan(0);
  });

  it('Empty list is a no-op', async () => {
    const start = openingState();
    const { rules, applyCalls } = stubRules();
    const rec = recorder();
    const result = await applyMovesSequentially(rules, start, [], playbackOpts(rec));
    expect(rec.applied).toHaveLength(0);
    expect(rec.sleeps).toHaveLength(0);
    expect(applyCalls).toHaveLength(0);
    expect(result).toBe(start);
  });

  it('Single-move turn does not sleep', async () => {
    const start = openingState();
    const moves = [endTurn()];
    const { rules } = stubRules();
    const rec = recorder();
    await applyMovesSequentially(rules, start, moves, playbackOpts(rec));
    expect(rec.applied).toHaveLength(1);
    expect(rec.applied[0]?.move).toEqual(endTurn());
    expect(rec.sleeps).toHaveLength(0);
  });

  it('Local AI chair key is the active AI player', () => {
    const state = openingState();
    expect(state.winner).toBeUndefined();
    expect(localAiChairKey(state, localAiOpts(state))).toBe(activeId(state));
  });

  it('Occupancy change does not change the chair key', () => {
    const left = openingState();
    const right = occupancyShifted(left);
    expect(left.activePlayer).toBe(right.activePlayer);
    expect(left.winner).toBeUndefined();
    expect(right.winner).toBeUndefined();
    expect([...left.groups.keys()].map(String).toSorted()).not.toEqual(
      [...right.groups.keys()].map(String).toSorted(),
    );
    const opts = localAiOpts(left);
    const keyLeft = localAiChairKey(left, opts);
    const keyRight = localAiChairKey(right, opts);
    expect(keyLeft).toBe(activeId(left));
    expect(keyRight).toBe(activeId(right));
    expect(keyLeft).toBe(keyRight);
  });

  it('Playback of a planned turn matches folding apply', async () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const opening = makeMatch();
    const bot = opening.players[1];
    expect(bot).toBeDefined();
    if (bot === undefined) return;
    const start = rules.apply(opening, endTurn());
    const planned = playBotTurn(geometry, rules, start, bot);
    expect(planned.moves.length).toBeGreaterThan(0);
    const rec = recorder();
    const played = await applyMovesSequentially(
      rules,
      start,
      planned.moves,
      playbackOpts(rec),
    );
    let folded = start;
    for (const move of planned.moves) {
      folded = rules.apply(folded, move);
    }
    expect(played).toEqual(folded);
    expect(played).toEqual(planned.state);
  });
});

describe('Camera choreography hook (P48)', () => {
  it('beforeApply runs for every move, ahead of its apply', async () => {
    const start = openingState();
    const moves = threeMoves();
    const { rules, applyCalls } = stubRules();
    const rec = recorder();
    const order: string[] = [];
    await applyMovesSequentially(rules, start, moves, {
      ...playbackOpts(rec),
      beforeApply: (_move, index) => {
        order.push(`hop:${String(index)}`);
        return Promise.resolve();
      },
      onApplied: (move, after, index) => {
        order.push(`apply:${String(index)}`);
        rec.onApplied(move, after, index);
      },
    });
    expect(order).toEqual(['hop:0', 'apply:0', 'hop:1', 'apply:1', 'hop:2', 'apply:2']);
    expect(applyCalls.map((call) => call.move)).toEqual([...moves]);
  });

  it('A throwing beforeApply cannot change the applied-move sequence', async () => {
    const start = openingState();
    const moves = threeMoves();
    const { rules, applyCalls } = stubRules();
    const rec = recorder();
    await applyMovesSequentially(rules, start, moves, {
      ...playbackOpts(rec),
      beforeApply: (_move, index) =>
        index === 1 ? Promise.reject(new Error('camera fault')) : Promise.resolve(),
    });
    expect(applyCalls.map((call) => call.move)).toEqual([...moves]);
    expect(rec.applied.map((event) => event.index)).toEqual([0, 1, 2]);
  });

  it('Cancellation during a hop stops before that move applies', async () => {
    const start = openingState();
    const moves = threeMoves();
    const { rules, applyCalls } = stubRules();
    const rec = recorder();
    let cancel = false;
    await applyMovesSequentially(rules, start, moves, {
      ...playbackOpts(rec),
      cancelled: () => cancel,
      beforeApply: (_move, index) => {
        if (index === 1) cancel = true;
        return Promise.resolve();
      },
    });
    expect(applyCalls).toHaveLength(1);
    expect(rec.applied.map((event) => event.index)).toEqual([0]);
  });
});
