/**
 * docs/spec/match-summary-telemetry/match-summary-telemetry.core.feature
 * One it() per Gherkin scenario. Pure helpers + source reads — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import {
  appendMovesWithSummary,
  createMatchLog,
  emptyMatchSummary,
  foldMatchSummary,
  formatMatchSummary,
  matchSummaryLine,
} from '../src/matchLog';
import {
  A,
  ARROW_0,
  ARROW_1,
  B,
  gameState,
  hudSource,
  newLog,
  oneEndTurn,
  oneStep,
  summaryOf,
  zeros,
} from './match-summary-telemetry.support';

describe('Match summary telemetry — counters and the over line', () => {
  it('New log starts at zero counters', () => {
    const seed = newLog();
    const log = createMatchLog({
      config: seed.config,
      vsBot: false,
      botMode: 'human-hotseat',
      seats: seed.seats,
      humanSeat: A,
      botSeat: undefined,
      startedAt: '2026-08-16T00:00:00.000Z',
    });
    expect(log.summary).toEqual(emptyMatchSummary());
    expect(log.summary.steps).toBe(0);
    expect(log.summary.endTurns).toBe(0);
    expect(log.summary.closes).toBe(0);
    expect(log.summary.cuts).toBe(0);
    expect(log.summary.firstCloseAt).toBeUndefined();
  });

  it('A step increments steps', () => {
    const board = gameState();
    const folded = foldMatchSummary(zeros(), [oneStep()], board, board, 0);
    expect(folded.steps).toBe(1);
    expect(folded.endTurns).toBe(0);
    expect(folded.closes).toBe(0);
    expect(folded.cuts).toBe(0);
    expect(folded.firstCloseAt).toBeUndefined();
  });

  it('An end-turn increments end-turns', () => {
    const board = gameState();
    const folded = foldMatchSummary(zeros(), [oneEndTurn()], board, board, 0);
    expect(folded.endTurns).toBe(1);
    expect(folded.steps).toBe(0);
  });

  it('Territory gain is a close', () => {
    const before = gameState();
    const after = gameState({ territory: [[ARROW_0, A]] });
    const loggedBefore = 3;
    const folded = foldMatchSummary(zeros(), [oneStep()], before, after, loggedBefore);
    expect(folded.closes).toBe(1);
    expect(folded.cuts).toBe(0);
    expect(folded.firstCloseAt).toBe(loggedBefore);
  });

  it('Enemy trail shrink without that player gaining territory is a cut', () => {
    const before = gameState({ trails: [[B, [ARROW_0, ARROW_1]]] });
    const after = gameState({ trails: [[B, [ARROW_1]]] });
    const folded = foldMatchSummary(zeros(), [oneStep()], before, after, 0);
    expect(folded.cuts).toBe(1);
    expect(folded.closes).toBe(0);
    expect(folded.firstCloseAt).toBeUndefined();
  });

  it('firstCloseAt is the batch-start index', () => {
    const padded = newLog([oneStep(), oneStep(), oneStep(), oneStep()]);
    expect(padded.moves).toHaveLength(4);
    const before = gameState();
    const after = gameState({ territory: [[ARROW_0, A]] });
    const next = appendMovesWithSummary(padded, [oneStep()], before, after);
    expect(next.summary.firstCloseAt).toBe(4);
    expect(next.moves).toHaveLength(5);
  });

  it('Format is the locked one-line string', () => {
    const summary = summaryOf({
      steps: 12,
      endTurns: 3,
      closes: 1,
      cuts: 0,
      firstCloseAt: 7,
    });
    expect(formatMatchSummary(summary)).toBe(
      '12 steps · 3 end-turns · 1 closes · 0 cuts · first close @ move 7',
    );
  });

  it('Empty list is a no-op', () => {
    const summary = summaryOf({
      steps: 4,
      endTurns: 1,
      closes: 1,
      cuts: 1,
      firstCloseAt: 0,
    });
    const before = gameState({ territory: [[ARROW_0, A]] });
    const after = gameState({ territory: [[ARROW_0, A], [ARROW_1, A]] });
    const folded = foldMatchSummary(summary, [], before, after, 9);
    expect(folded).toEqual(summary);
    expect(folded).toBe(summary);

    const log = { ...newLog([oneStep()]), summary };
    const next = appendMovesWithSummary(log, [], before, after);
    expect(next).toBe(log);
    expect(next.moves).toEqual(log.moves);
    expect(next.summary).toEqual(summary);
  });

  it('Match over shows the summary line', () => {
    const summary = summaryOf({ steps: 2, endTurns: 1 });
    expect(matchSummaryLine(true, summary)).toBe(
      '2 steps · 1 end-turns · 0 closes · 0 cuts',
    );
    expect(hudSource()).toContain('className="meta match-summary"');
  });

  it('In play the summary line is unset', () => {
    const summary = summaryOf({ steps: 8, endTurns: 2, closes: 1, cuts: 1, firstCloseAt: 3 });
    expect(matchSummaryLine(false, summary)).toBeUndefined();
  });
});
