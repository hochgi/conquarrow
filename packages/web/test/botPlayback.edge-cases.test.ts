/**
 * docs/spec/ai-move-playback/ai-move-playback.edge-cases.feature
 * One it() per Gherkin scenario. Pure helper only — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import {
  applyMovesSequentially,
  localAiChairKey,
} from '../src/botPlayback';
import {
  activeId,
  botPlaybackSource,
  isAiSeatOf,
  localAiOpts,
  openingState,
  playbackOpts,
  plannedMoves,
  recorder,
  stubRules,
  threeMoves,
  withWinner,
} from './botPlayback.support';

describe('Local AI move playback — cancel and seams', () => {
  it('Cancel before first apply leaves start unchanged', async () => {
    const start = openingState();
    const moves = plannedMoves(2);
    const { rules, applyCalls } = stubRules();
    const rec = recorder({ cancelled: true });
    const result = await applyMovesSequentially(rules, start, moves, playbackOpts(rec));
    expect(rec.applied).toHaveLength(0);
    expect(rec.sleeps).toHaveLength(0);
    expect(applyCalls).toHaveLength(0);
    expect(result).toBe(start);
  });

  it('Cancel during a gap does not apply later moves', async () => {
    const start = openingState();
    const moves = threeMoves();
    const { rules, applyCalls } = stubRules();
    const rec = recorder({ cancelOnSleep: true });
    await applyMovesSequentially(rules, start, moves, playbackOpts(rec));
    expect(rec.applied).toHaveLength(1);
    expect(rec.applied[0]?.move).toEqual(moves[0]);
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls.map((call) => call.move)).toEqual([moves[0]]);
  });

  it('Online play has no local AI chair', () => {
    const state = openingState();
    expect(state.winner).toBeUndefined();
    expect(
      localAiChairKey(state, { online: true, isAiSeat: isAiSeatOf(activeId(state)) }),
    ).toBeNull();
  });

  it('Winner has no local AI chair', () => {
    const opening = openingState();
    const winner = opening.players[0];
    expect(winner).toBeDefined();
    if (winner === undefined) return;
    const state = withWinner(opening, winner);
    expect(state.winner).toBe(winner);
    expect(localAiChairKey(state, localAiOpts(state))).toBeNull();
  });

  it('Human seat has no local AI chair', () => {
    const state = openingState();
    expect(state.winner).toBeUndefined();
    expect(localAiChairKey(state, { online: false, isAiSeat: () => false })).toBeNull();
  });

  it('Sleep is injected; helper does not call a clock', () => {
    const src = botPlaybackSource();
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('setTimeout');
  });

  it('Equal start and moves yield equal intermediate states', async () => {
    const start = openingState();
    const moves = threeMoves();
    const { rules } = stubRules();
    const first = recorder();
    const second = recorder();
    const left = await applyMovesSequentially(rules, start, moves, playbackOpts(first));
    const right = await applyMovesSequentially(rules, start, moves, playbackOpts(second));
    expect(first.applied.map((event) => event.after)).toEqual(
      second.applied.map((event) => event.after),
    );
    expect(left).toEqual(right);
    let folded = start;
    for (const move of moves) {
      folded = rules.apply(folded, move);
    }
    expect(left).toEqual(folded);
  });
});
