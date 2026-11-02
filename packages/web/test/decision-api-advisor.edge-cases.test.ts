/**
 * docs/spec/decision-api-advisor/decision-api-advisor.edge-cases.feature
 * One it() per Gherkin scenario (the outline: one it() per example row).
 * Adapter only — no RTL, no jsdom.
 */

import { endTurn } from '@conquarrow/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADVISOR_TIMEOUT_MS, askAdvisor } from '../src/advisor';
import { DEFAULT_ADVISOR } from '../src/byokConfig';
import {
  emptyMatchSummary,
  formatMatchSummary,
  matchSummaryLine,
  serializeMatchLog,
  withAdvisorRecords,
  withByokStats,
} from '../src/matchLog';
import { SEAT_PLAN_STORAGE_KEY, defaultSeatPlan, loadSeatPlan, saveSeatPlan, updateSeat } from '../src/seatPlan';
import {
  ADVISOR_KEY,
  SEAT_KEY,
  SYSTEM_ONE,
  TIMEOUT_MESSAGE,
  advisorAnswers,
  advisorHonoursSignal,
  advisorJson,
  advisorRequests,
  advisorStatus,
  advisorText,
  advisorThrows,
  batchJson,
  chatPrompts,
  chatRequests,
  fireTimeoutsImmediately,
  installMemoryLocalStorage,
  matchLogWith,
  offerRowLines,
  overCapBoard,
  plainRun,
  readyAdvisor,
  runTurn,
  sampleBody,
  scriptedFetch,
  seatConfig,
  threeRowBoard,
  twoCompletionBoard,
  type AdvisorStep,
} from './decision-api-advisor.support';

afterEach(() => {
  vi.restoreAllMocks();
});

const PICK_ONE = [batchJson([1], true)];

describe('Rule: Every failure mode is silent', () => {
  const examples: readonly {
    readonly response: string;
    readonly step: AdvisorStep;
    readonly reason: string;
    readonly timeout?: true;
  }[] = [
    { response: 'a thrown network error "boom"', step: advisorThrows('boom'), reason: 'fetch failed: boom' },
    {
      response: 'an abort from the 10 s timeout',
      step: advisorHonoursSignal,
      reason: `fetch failed: ${TIMEOUT_MESSAGE}`,
      timeout: true,
    },
    { response: 'HTTP 429', step: advisorStatus(429), reason: `HTTP 429 from ${SYSTEM_ONE}` },
    { response: 'HTTP 200 with body "not json"', step: advisorText('not json'), reason: 'response was not JSON' },
    {
      response: 'HTTP 200 with {"answers":{}}',
      step: advisorJson({ answers: {} }),
      reason: 'missing answers.move.probabilities',
    },
    {
      response: 'HTTP 200 with probabilities {"m0":"x","zz":0.9}',
      step: advisorAnswers({ m0: 'x', zz: 0.9 }),
      reason: 'no usable probabilities',
    },
  ];

  for (const example of examples) {
    it(`A broken advisor answer leaves the completion unadvised: ${example.response}`, async () => {
      const timeout = example.timeout === true ? fireTimeoutsImmediately() : undefined;
      const board = threeRowBoard();
      const run = await runTurn(board, seatConfig(), PICK_ONE, [example.step]);
      // Read before restoring: mockRestore clears recorded calls.
      const timeoutsAsked = timeout?.mock.calls.map((call) => call[0]);
      timeout?.mockRestore();
      const plain = await plainRun(board, PICK_ONE);

      expect(advisorRequests(run.fetch)).toHaveLength(1);
      if (timeoutsAsked !== undefined) {
        expect(timeoutsAsked).toContain(ADVISOR_TIMEOUT_MS);
        expect(advisorRequests(run.fetch)[0]?.signal).toBeDefined();
      }
      expect(chatPrompts(run.fetch)).toEqual(chatPrompts(plain.fetch));
      expect(run.turn.advisorFailures).toBe(1);
      expect(run.turn.advisorLastError).toBe(example.reason);
      expect(run.turn.advisorRecords).toEqual([]);
      expect(run.turn.llmFallbacks).toBe(0);
    });
  }

  it('An offer over the choice cap is never sent', async () => {
    const board = overCapBoard();
    const run = await runTurn(board, seatConfig(), [batchJson([0], true)], [advisorAnswers({ m0: 1 })]);

    expect(board.offerSize).toBeGreaterThan(255);
    expect(advisorRequests(run.fetch)).toHaveLength(0);
    expect(chatRequests(run.fetch)).toHaveLength(1);
    expect(run.turn.advisorFailures).toBe(1);
    expect(run.turn.advisorLastError).toBe(`offer too large (${String(board.offerSize)} > 255)`);
    expect(run.turn.advisorRecords).toEqual([]);
  });

  it('A failed advisor never triggers the greedy fallback', async () => {
    const board = twoCompletionBoard();
    const run = await runTurn(board, seatConfig(), board.chat, [advisorStatus(503)]);
    const plain = await plainRun(board, board.chat);

    expect(advisorRequests(run.fetch)).toHaveLength(2);
    expect(run.turn.moves).toEqual(plain.turn.moves);
    expect(run.turn.llmFallbacks).toBe(plain.turn.llmFallbacks);
    expect(run.turn.llmFallbacks).toBe(0);
  });
});

describe('Rule: Reading the answer', () => {
  it('Ties go to the lowest index', async () => {
    const fetch = scriptedFetch([], [advisorAnswers({ m0: 0.2, m1: 0.4, m2: 0.4 })]);
    const answer = await askAdvisor(seatConfig(), sampleBody(3), 3, fetch.fetch);
    expect(answer).toMatchObject({ ok: true, top: 1 });
  });

  it('Missing or non-finite options read as zero', async () => {
    const reply = { m0: 0.7, m2: 'NaN' };
    const fetch = scriptedFetch([], [advisorAnswers(reply)]);
    const answer = await askAdvisor(seatConfig(), sampleBody(3), 3, fetch.fetch);
    expect(answer).toEqual({ ok: true, model: 'jev-latest', probabilities: [0.7, 0, 0], top: 0 });

    const board = threeRowBoard();
    const run = await runTurn(board, seatConfig(), PICK_ONE, [advisorAnswers(reply)]);
    const rows = new Map(offerRowLines(chatPrompts(run.fetch)[0] ?? '').map((r) => [r.index, r.line]));
    expect(rows.get(0)).toMatch(/ advisor=0\.70$/);
    expect(rows.get(1)).toMatch(/ advisor=0\.00$/);
    expect(rows.get(2)).toMatch(/ advisor=0\.00$/);
  });

  it("The reply's model is optional", async () => {
    const board = threeRowBoard();
    const advisor = readyAdvisor({ model: 'jev-configured' });
    const run = await runTurn(board, seatConfig(advisor), PICK_ONE, [
      advisorAnswers({ m0: 0.1, m1: 0.6, m2: 0.3 }),
    ]);

    expect(run.turn.advisorRecords).toHaveLength(1);
    expect(run.turn.advisorRecords[0]?.model).toBe('jev-configured');
  });
});

describe("Rule: Records describe the model's pick truthfully", () => {
  it('An unusable model reply records picked null', async () => {
    const board = threeRowBoard();
    const unusable = ['I would play row one, it looks strong.'];
    const run = await runTurn(board, seatConfig(), unusable, [advisorAnswers({ m0: 0.2, m1: 0.5, m2: 0.3 })]);
    const plain = await plainRun(board, unusable);

    expect(run.turn.advisorRecords).toHaveLength(1);
    expect(run.turn.advisorRecords[0]?.picked).toBeNull();
    expect(run.turn.llmFallbacks).toBe(1);
    expect(plain.turn.llmFallbacks).toBe(1);
    expect(run.turn.moves).toEqual(plain.turn.moves);
  });

  it('An end-turn-only reply records picked null', async () => {
    const board = threeRowBoard();
    const run = await runTurn(board, seatConfig(), [batchJson([], true)], [
      advisorAnswers({ m0: 0.2, m1: 0.5, m2: 0.3 }),
    ]);

    expect(run.turn.advisorRecords).toHaveLength(1);
    expect(run.turn.advisorRecords[0]?.picked).toBeNull();
    expect(run.turn.moves).toEqual([endTurn()]);
  });
});

describe('Rule: Configuration persists and stays local', () => {
  it('An older seat plan loads with the advisor off', () => {
    const restore = installMemoryLocalStorage();
    try {
      const older = {
        playerCount: 3,
        seats: [
          { kind: 'human', byok: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' } },
          {
            kind: 'byok',
            byok: {
              baseUrl: 'https://api.x.ai/v1',
              apiKey: SEAT_KEY,
              model: 'grok',
              proxyUrl: '',
              reasoning: true,
              useTurnRunner: false,
              turnRunnerUrl: '',
            },
          },
          { kind: 'heuristic', byok: {} },
        ],
      };
      globalThis.localStorage.setItem(SEAT_PLAN_STORAGE_KEY, JSON.stringify(older));

      const plan = loadSeatPlan();

      expect(plan.seats[1]?.kind).toBe('byok');
      expect(plan.seats[1]?.byok.apiKey).toBe(SEAT_KEY);
      expect(plan.seats[1]?.byok.advisor).toEqual(DEFAULT_ADVISOR);
    } finally {
      restore();
    }
  });

  it('An advisor config survives save and load', () => {
    const restore = installMemoryLocalStorage();
    try {
      const advisor = readyAdvisor({
        enabled: true,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: ADVISOR_KEY,
        model: 'jev-1.14.0',
      });
      const plan = updateSeat(defaultSeatPlan(3), 1, (seat) => ({
        ...seat,
        kind: 'byok',
        byok: { ...seat.byok, apiKey: SEAT_KEY, advisor },
      }));
      saveSeatPlan(plan);

      expect(loadSeatPlan().seats[1]?.byok.advisor).toEqual(advisor);
    } finally {
      restore();
    }
  });

  it('A log without advice is unchanged', () => {
    const board = threeRowBoard();
    const log = matchLogWith(board.state.players, []);

    const next = withAdvisorRecords(log, [], 0);

    expect('advisorRecords' in next).toBe(false);
    expect(serializeMatchLog(next)).toBe(serializeMatchLog(log));
    const summary = emptyMatchSummary();
    expect(formatMatchSummary(summary, [])).not.toContain('advisor agreed');
    expect(formatMatchSummary(summary, [])).toBe(formatMatchSummary(summary));
    expect(matchSummaryLine(true, summary, next.advisorRecords)).not.toContain('advisor agreed');
  });
});

describe('Rule: Keys never leak', () => {
  it('No key appears in records, logs or errors', async () => {
    const board = twoCompletionBoard();
    const run = await runTurn(board, seatConfig(), board.chat, [
      advisorStatus(401),
      advisorAnswers({ m0: 0.3, m1: 0.7 }, 'jev-1.14.0'),
    ]);
    expect(run.turn.advisorFailures).toBe(1);
    expect(run.turn.advisorRecords).toHaveLength(1);

    const logged = withByokStats(
      withAdvisorRecords(matchLogWith(board.state.players, run.turn.moves), run.turn.advisorRecords, 0),
      {
        llmHits: run.turn.llmHits,
        llmFallbacks: run.turn.llmFallbacks,
        lastError: run.turn.lastError,
      },
      board.me,
    );
    const serialized = serializeMatchLog(logged);

    for (const key of [SEAT_KEY, ADVISOR_KEY]) {
      expect(serialized).not.toContain(key);
      expect(run.turn.advisorLastError ?? '').not.toContain(key);
      expect(JSON.stringify(run.turn.advisorRecords)).not.toContain(key);
      for (const chat of chatRequests(run.fetch)) expect(chat.body).not.toContain(key);
    }
    for (const r of run.fetch.requests) {
      const inHeaders = Object.values(r.headers).some((v) => v.includes(ADVISOR_KEY));
      expect(inHeaders).toBe(r.upstream === SYSTEM_ONE);
      expect(r.body).not.toContain(ADVISOR_KEY);
    }
    for (const r of advisorRequests(run.fetch)) {
      expect(JSON.stringify(r.headers)).not.toContain(SEAT_KEY);
      expect(r.body).not.toContain(SEAT_KEY);
    }
  });
});
