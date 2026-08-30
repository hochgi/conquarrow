/**
 * docs/spec/match-summary-telemetry/match-summary-telemetry.edge-cases.feature
 * One it() per Gherkin scenario. Pure helpers + source reads — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import {
  LAST_MATCH_STORAGE_KEY,
  emptyMatchSummary,
  foldMatchSummary,
  formatMatchSummary,
  loadLastMatchLog,
  serializeMatchLog,
} from '../src/matchLog';
import {
  A,
  ARROW_0,
  ARROW_1,
  ARROW_2,
  B,
  appMainExists,
  appSource,
  foldMatchSummarySource,
  gameState,
  installMemoryLocalStorage,
  matchLogSource,
  newLog,
  oneStep,
  packetTestSource,
  summaryOf,
  zeros,
} from './match-summary-telemetry.support';

describe('Match summary telemetry — close vs cut, load, seams', () => {
  it('Own-trail claim on close is not a cut', () => {
    const before = gameState({
      trails: [[A, [ARROW_0, ARROW_1]]],
    });
    const after = gameState({
      territory: [
        [ARROW_0, A],
        [ARROW_1, A],
      ],
      trails: [[A, []]],
    });
    const folded = foldMatchSummary(zeros(), [oneStep()], before, after, 0);
    expect(folded.closes).toBe(1);
    expect(folded.cuts).toBe(0);
  });

  it('Close and enemy cut in one batch count both', () => {
    const before = gameState({
      trails: [[B, [ARROW_0, ARROW_1]]],
    });
    const after = gameState({
      territory: [[ARROW_2, A]],
      trails: [[B, [ARROW_1]]],
    });
    const folded = foldMatchSummary(zeros(), [oneStep()], before, after, 0);
    expect(folded.closes).toBe(1);
    expect(folded.cuts).toBe(1);
  });

  it('Owner-swap that grows B is a close', () => {
    const before = gameState({ territory: [[ARROW_0, A]] });
    const after = gameState({ territory: [[ARROW_0, B]] });
    const folded = foldMatchSummary(zeros(), [oneStep()], before, after, 0);
    expect(folded.closes).toBe(1);
    expect(folded.cuts).toBe(0);
  });

  it('New trail is not a cut', () => {
    const before = gameState();
    const after = gameState({ trails: [[A, [ARROW_0, ARROW_1]]] });
    const folded = foldMatchSummary(zeros(), [oneStep()], before, after, 0);
    expect(folded.cuts).toBe(0);
    expect(folded.closes).toBe(0);
  });

  it('firstCloseAt is sticky', () => {
    const start = summaryOf({ closes: 1, firstCloseAt: 2 });
    const before = gameState();
    const after = gameState({ territory: [[ARROW_0, A]] });
    const folded = foldMatchSummary(start, [oneStep()], before, after, 9);
    expect(folded.firstCloseAt).toBe(2);
    expect(folded.closes).toBe(2);
  });

  it('The format is end-turns then closes, with no counter between them', () => {
    // P51 removed the `n skips` clause the format used to splice in here; the
    // line is the four counters and nothing else.
    const text = formatMatchSummary(summaryOf({ steps: 3, endTurns: 1, closes: 0, cuts: 0 }));
    expect(text).not.toContain('skip');
    expect(text).not.toContain('first close');
    expect(text).toBe('3 steps · 1 end-turns · 0 closes · 0 cuts');
    expect(text.indexOf('closes')).toBeGreaterThan(text.indexOf('end-turns'));
  });

  it('Load of a log missing summary uses empty counters', () => {
    const restore = installMemoryLocalStorage();
    try {
      const stored = JSON.parse(serializeMatchLog(newLog())) as Record<string, unknown>;
      delete stored['summary'];
      globalThis.localStorage.setItem(LAST_MATCH_STORAGE_KEY, `${JSON.stringify(stored)}\n`);
      const loaded = loadLastMatchLog();
      expect(loaded).toBeDefined();
      expect(loaded?.summary).toEqual(emptyMatchSummary());
      expect(loaded?.summary.steps).toBe(0);
      expect(loaded?.summary.endTurns).toBe(0);
      expect(loaded?.summary.closes).toBe(0);
      expect(loaded?.summary.cuts).toBe(0);
      expect(loaded?.summary.firstCloseAt).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('Load of malformed JSON returns undefined', () => {
    const restore = installMemoryLocalStorage();
    try {
      globalThis.localStorage.setItem(LAST_MATCH_STORAGE_KEY, 'not-json{{');
      expect(loadLastMatchLog()).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('Serialize includes summary', () => {
    const log = { ...newLog(), summary: summaryOf({ closes: 1 }) };
    const parsed: unknown = JSON.parse(serializeMatchLog(log));
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
    const record = parsed as { summary: { closes: number } };
    expect(record.summary.closes).toBe(1);
  });

  it('App still mounts Board and Hud', () => {
    const src = appSource();
    expect.soft(src.includes('App restore incomplete'), 'App.tsx must not be the restore stub').toBe(
      false,
    );
    expect.soft(/<Board\b/.test(src), 'App.tsx must render <Board').toBe(true);
    expect.soft(/<Hud\b/.test(src), 'App.tsx must render <Hud').toBe(true);
    expect.soft(appMainExists(), 'packages/web/src/AppMain.tsx must not exist').toBe(false);
  });

  it('Online record folds when before is known', () => {
    expect(
      /record\(\s*applied\s*,\s*game\s*,\s*before\b/.test(appSource()),
      'online submit path must call record(applied, game, before)',
    ).toBe(true);
  });

  it('Equal fold inputs yield equal summaries', () => {
    const start = zeros();
    const moves = [oneStep()];
    const leftBefore = gameState({
      territory: [
        [ARROW_0, A],
        [ARROW_1, A],
      ],
      trails: [
        [A, [ARROW_0]],
        [B, [ARROW_1, ARROW_2]],
      ],
    });
    const leftAfter = gameState({
      territory: [
        [ARROW_0, A],
        [ARROW_1, A],
        [ARROW_2, A],
      ],
      trails: [
        [B, [ARROW_1, ARROW_2]],
        [A, [ARROW_0]],
      ],
    });
    const rightBefore = gameState({
      territory: [
        [ARROW_1, A],
        [ARROW_0, A],
      ],
      trails: [
        [B, [ARROW_2, ARROW_1]],
        [A, [ARROW_0]],
      ],
    });
    const rightAfter = gameState({
      territory: [
        [ARROW_2, A],
        [ARROW_1, A],
        [ARROW_0, A],
      ],
      trails: [
        [A, [ARROW_0]],
        [B, [ARROW_2, ARROW_1]],
      ],
    });
    const left = foldMatchSummary(start, moves, leftBefore, leftAfter, 4);
    const right = foldMatchSummary(start, moves, rightBefore, rightAfter, 4);
    expect(left).toEqual(right);
  });

  it('Fold helper has no clock or random', () => {
    const src = foldMatchSummarySource();
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
  });

  it('Rules-core is unchanged', () => {
    expect(matchLogSource()).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
    const files = [
      'match-summary-telemetry.core.test.ts',
      'match-summary-telemetry.edge-cases.test.ts',
      'match-summary-telemetry.invariants.test.ts',
      'match-summary-telemetry.support.ts',
    ] as const;
    for (const file of files) {
      const src = packetTestSource(file);
      expect(src, file).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
    }
  });
});
