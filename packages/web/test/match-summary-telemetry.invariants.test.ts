/**
 * EARS invariants for docs/spec/match-summary-telemetry/match-summary-telemetry.md.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check
 * (same style as packages/web/test/victory-fx.invariants.test.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  LAST_MATCH_STORAGE_KEY,
  appendMovesWithSummary,
  emptyMatchSummary,
  foldMatchSummary,
  formatMatchSummary,
  loadLastMatchLog,
  matchSummaryLine,
  serializeMatchLog,
  type MatchSummary,
} from '../src/matchLog';
import {
  A,
  ARROW_0,
  ARROW_1,
  ARROW_2,
  B,
  foldMatchSummarySource,
  gameState,
  installMemoryLocalStorage,
  matchLogSource,
  newLog,
  oneEndTurn,
  oneStep,
  packetTestSource,
  summaryOf,
  zeros,
} from './match-summary-telemetry.support';

describe('match-summary-telemetry invariants', () => {
  it('When the logged batch is empty, the system shall not change the summary or the move list.', () => {
    const boards = [
      { before: gameState(), after: gameState({ territory: [[ARROW_0, A]] }) },
      { before: gameState({ trails: [[B, [ARROW_0]]] }), after: gameState() },
    ] as const;
    const summaries: readonly MatchSummary[] = [
      zeros(),
      summaryOf({ steps: 5, endTurns: 2, closes: 1, cuts: 1, firstCloseAt: 3 }),
    ];
    for (const summary of summaries) {
      for (const { before, after } of boards) {
        const folded = foldMatchSummary(summary, [], before, after, 8);
        expect(folded).toEqual(summary);
        const log = { ...newLog([oneStep(), oneEndTurn()]), summary };
        const next = appendMovesWithSummary(log, [], before, after);
        expect(next.moves).toEqual(log.moves);
        expect(next.summary).toEqual(summary);
      }
    }
  });

  it("When no player's territory count increases, the system shall not increment closes or set firstCloseAt.", () => {
    const cases = [
      {
        label: 'identical boards',
        before: gameState({ territory: [[ARROW_0, A]] }),
        after: gameState({ territory: [[ARROW_0, A]] }),
      },
      {
        label: 'new trail',
        before: gameState(),
        after: gameState({ trails: [[A, [ARROW_0]]] }),
      },
      {
        label: 'enemy trail shrink',
        before: gameState({ trails: [[B, [ARROW_0, ARROW_1]]] }),
        after: gameState({ trails: [[B, [ARROW_1]]] }),
      },
      {
        label: 'A loses a tile to unclaimed',
        before: gameState({ territory: [[ARROW_0, A]] }),
        after: gameState(),
      },
    ] as const;
    for (const row of cases) {
      const fromZero = foldMatchSummary(zeros(), [oneStep()], row.before, row.after, 0);
      expect(fromZero.closes, row.label).toBe(0);
      expect(fromZero.firstCloseAt, row.label).toBeUndefined();

      const prior = summaryOf({ closes: 2, firstCloseAt: 1 });
      const fromPrior = foldMatchSummary(prior, [oneStep()], row.before, row.after, 9);
      expect(fromPrior.closes, `${row.label} prior`).toBe(2);
      expect(fromPrior.firstCloseAt, `${row.label} prior`).toBe(1);
    }
  });

  it("When a player's trail shrinks and that player's territory count increased in the same batch, the system shall not treat that shrink as a cut.", () => {
    const cases = [
      {
        label: 'A claims own trail arrows',
        before: gameState({ trails: [[A, [ARROW_0, ARROW_1]]] }),
        after: gameState({
          territory: [
            [ARROW_0, A],
            [ARROW_1, A],
          ],
          trails: [[A, []]],
        }),
      },
      {
        label: 'A trail shrinks while gaining a different tile',
        before: gameState({
          territory: [[ARROW_0, A]],
          trails: [[A, [ARROW_1, ARROW_2]]],
        }),
        after: gameState({
          territory: [
            [ARROW_0, A],
            [ARROW_1, A],
          ],
          trails: [[A, [ARROW_2]]],
        }),
      },
      {
        label: 'A gains, B trail unchanged',
        before: gameState({
          trails: [
            [A, [ARROW_0]],
            [B, [ARROW_1]],
          ],
        }),
        after: gameState({
          territory: [[ARROW_2, A]],
          trails: [
            [A, []],
            [B, [ARROW_1]],
          ],
        }),
      },
    ] as const;
    for (const row of cases) {
      const folded = foldMatchSummary(zeros(), [oneStep()], row.before, row.after, 0);
      expect(folded.closes, row.label).toBe(1);
      expect(folded.cuts, row.label).toBe(0);
    }
  });

  it("When a player's trail shrinks and that player's territory count did not increase, the system shall increment cuts.", () => {
    const cases = [
      {
        label: 'B trail shrinks, nobody gains',
        before: gameState({ trails: [[B, [ARROW_0, ARROW_1]]] }),
        after: gameState({ trails: [[B, [ARROW_1]]] }),
        closes: 0,
      },
      {
        label: 'B trail evaporates while A closes',
        before: gameState({ trails: [[B, [ARROW_0, ARROW_1]]] }),
        after: gameState({
          territory: [[ARROW_2, A]],
          trails: [[B, []]],
        }),
        closes: 1,
      },
      {
        label: 'missing trail after is size 0',
        before: gameState({ trails: [[A, [ARROW_0]]] }),
        after: gameState(),
        closes: 0,
      },
    ] as const;
    for (const row of cases) {
      const folded = foldMatchSummary(zeros(), [oneStep()], row.before, row.after, 0);
      expect(folded.cuts, row.label).toBe(1);
      expect(folded.closes, row.label).toBe(row.closes);
    }
  });

  it('When firstCloseAt is already set, a later close shall not change it.', () => {
    const pins = [0, 2, 7] as const;
    const before = gameState();
    const after = gameState({ territory: [[ARROW_0, A]] });
    for (const pin of pins) {
      const start = summaryOf({ closes: 1, firstCloseAt: pin });
      const folded = foldMatchSummary(start, [oneStep()], before, after, pin + 10);
      expect(folded.firstCloseAt, `pin=${String(pin)}`).toBe(pin);
      expect(folded.closes, `pin=${String(pin)}`).toBe(2);
    }
  });

  it('When victory.kind is not over, matchSummaryLine shall be undefined.', () => {
    const summaries: readonly (MatchSummary | undefined)[] = [
      undefined,
      zeros(),
      summaryOf({ steps: 12, endTurns: 3, closes: 1, cuts: 1, firstCloseAt: 7 }),
    ];
    for (const summary of summaries) {
      expect(matchSummaryLine(false, summary)).toBeUndefined();
    }
  });

  it('When victory.kind is over and a summary exists, matchSummaryLine shall equal formatMatchSummary.', () => {
    const summaries: readonly MatchSummary[] = [
      zeros(),
      summaryOf({ steps: 2, endTurns: 1 }),
      summaryOf({ steps: 12, endTurns: 3, closes: 1, cuts: 0, firstCloseAt: 7 }),
    ];
    for (const summary of summaries) {
      expect(matchSummaryLine(true, summary)).toBe(formatMatchSummary(summary));
    }
    expect(matchSummaryLine(true, undefined)).toBeUndefined();
  });

  it('Equal (summary, moves, before, after, movesLoggedBefore) shall yield equal folded summaries.', () => {
    const start = summaryOf({ steps: 1, endTurns: 1 });
    const moves = [oneStep(), oneStep(), oneEndTurn()];
    const leftBefore = gameState({
      territory: [
        [ARROW_0, A],
        [ARROW_1, B],
      ],
      trails: [
        [A, [ARROW_2]],
        [B, [ARROW_0, ARROW_1]],
      ],
    });
    const leftAfter = gameState({
      territory: [
        [ARROW_0, A],
        [ARROW_1, B],
        [ARROW_2, A],
      ],
      trails: [[B, [ARROW_1]]],
    });
    const rightBefore = gameState({
      territory: [
        [ARROW_1, B],
        [ARROW_0, A],
      ],
      trails: [
        [B, [ARROW_1, ARROW_0]],
        [A, [ARROW_2]],
      ],
    });
    const rightAfter = gameState({
      territory: [
        [ARROW_2, A],
        [ARROW_1, B],
        [ARROW_0, A],
      ],
      trails: [[B, [ARROW_1]]],
    });
    const first = foldMatchSummary(start, moves, leftBefore, leftAfter, 6);
    const second = foldMatchSummary(start, moves, rightBefore, rightAfter, 6);
    expect(first).toEqual(second);

    const replayLeft = foldMatchSummary(first, [oneStep()], leftAfter, leftAfter, 9);
    const replayRight = foldMatchSummary(second, [oneStep()], rightAfter, rightAfter, 9);
    expect(replayLeft).toEqual(replayRight);
  });

  it('foldMatchSummary shall not call Date.now or Math.random.', () => {
    const src = foldMatchSummarySource();
    expect(src).not.toContain('Date.now');
    expect(src).not.toContain('Math.random');
    expect(src).not.toContain('performance.now');
  });

  it('The rules engine shall be unchanged: no edit to packages/rules-core.', () => {
    expect(matchLogSource()).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
    const files = [
      'match-summary-telemetry.core.test.ts',
      'match-summary-telemetry.edge-cases.test.ts',
      'match-summary-telemetry.invariants.test.ts',
      'match-summary-telemetry.support.ts',
    ] as const;
    for (const file of files) {
      expect(packetTestSource(file), file).not.toMatch(/from ['"]@conquarrow\/rules-core['"]/);
    }
  });

  it('Loading a stored log that lacks summary shall yield empty counters and shall not throw.', () => {
    const restore = installMemoryLocalStorage();
    try {
      const shapes: readonly Record<string, unknown>[] = [
        (() => {
          const stored = JSON.parse(serializeMatchLog(newLog())) as Record<string, unknown>;
          delete stored['summary'];
          return stored;
        })(),
        { version: 1, moves: [] },
      ];
      for (const body of shapes) {
        globalThis.localStorage.setItem(LAST_MATCH_STORAGE_KEY, JSON.stringify(body));
        expect(() => loadLastMatchLog()).not.toThrow();
        const loaded = loadLastMatchLog();
        expect(loaded?.summary).toEqual(emptyMatchSummary());
      }
    } finally {
      restore();
    }
  });
});
