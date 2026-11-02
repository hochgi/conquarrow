/**
 * docs/spec/decision-api-advisor/decision-api-advisor.core.feature
 * One it() per Gherkin scenario. Adapter only — no RTL, no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyMatchSummary, formatMatchSummary, matchSummaryLine, withAdvisorRecords } from '../src/matchLog';
import { ADVISOR_LEGEND, advisorRequestBody, askAdvisor } from '../src/advisor';
import { buildSystemPrompt, buildUserPrompt, movesForLlm } from '../src/byokBot';
import { BYOK_UPSTREAM_HEADER, isAllowedByokUpstream } from '../src/byokConfig';
import { loadSeatPlan, saveSeatPlan, updateSeat, defaultSeatPlan } from '../src/seatPlan';
import {
  ADVISOR_KEY,
  LEGEND,
  LEGAL_MOVES_PREFIX,
  SEAT_KEY,
  SYSTEM_ONE,
  advisorAnswers,
  advisorRecord,
  advisorRequests,
  advisorStatus,
  batchJson,
  chatPrompts,
  chatRequests,
  geometry,
  installMemoryLocalStorage,
  lobbySource,
  matchLogWith,
  offConfig,
  offerRowLines,
  openingBoard,
  plainRun,
  readyAdvisor,
  rowTexts,
  rules,
  runTurn,
  sampleBody,
  scriptedFetch,
  seatConfig,
  statePrefix,
  stripAdvice,
  threeRowBoard,
  twoCompletionBoard,
} from './decision-api-advisor.support';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const P = [0.1, 0.6, 0.3] as const;
const PROBS = { m0: P[0], m1: P[1], m2: P[2] };
const PICK_ONE = [batchJson([1], true)];

describe('Rule: Off changes nothing', () => {
  it('With the advisor off the seat behaves exactly as today', async () => {
    const board = twoCompletionBoard();
    const filledButOff = readyAdvisor({
      enabled: false,
      baseUrl: 'https://api.typesafe.ai/v1',
      apiKey: ADVISOR_KEY,
      model: 'jev-latest',
    });
    const off = await runTurn(board, seatConfig(filledButOff), board.chat, [advisorAnswers(PROBS)]);
    const reference = await runTurn(board, offConfig(), board.chat);

    expect(off.fetch.requests.some((r) => r.upstream.endsWith('/systemone'))).toBe(false);
    expect(off.fetch.requests.map((r) => r.body)).toEqual(reference.fetch.requests.map((r) => r.body));
    expect(off.turn.moves).toEqual(reference.turn.moves);
    expect(off.turn.advisorRecords).toEqual([]);
    expect(off.turn.advisorFailures).toBe(0);
    expect(off.turn.advisorLastError).toBeUndefined();
  });
});

describe('Rule: On, one choice question per completion', () => {
  it('The advisor is asked once before each chat completion', async () => {
    const board = twoCompletionBoard();
    const run = await runTurn(board, seatConfig(), board.chat, [advisorAnswers({ m0: 0.5 })]);

    const kinds = run.fetch.requests.map((r) =>
      r.upstream === SYSTEM_ONE ? '/systemone' : r.upstream.endsWith('/chat/completions') ? '/chat/completions' : r.upstream,
    );
    expect(kinds).toEqual(['/systemone', '/chat/completions', '/systemone', '/chat/completions']);
    for (const r of advisorRequests(run.fetch)) {
      expect(r.headers['authorization']).toBe(`Bearer ${ADVISOR_KEY}`);
      expect(r.headers['content-type']).toBe('application/json');
    }
    for (const r of chatRequests(run.fetch)) {
      expect(r.headers['authorization']).toBe(`Bearer ${SEAT_KEY}`);
    }
  });

  it('The question names the offer rows in engine order', () => {
    const { state, me } = openingBoard();
    const offer = movesForLlm(rules.legalMoves(state));
    const n = offer.length;
    expect(n).toBeGreaterThanOrEqual(2);
    const plain = buildUserPrompt(geometry, state, me, offer, true, rules, []);
    const system = buildSystemPrompt(me, true);

    const body = advisorRequestBody(readyAdvisor({ model: '  jev-latest  ' }), me, system, plain, n);

    expect(Object.keys(body).toSorted()).toEqual(['model', 'questions', 'state']);
    expect(body.model).toBe('jev-latest');
    expect(Object.keys(body.questions)).toEqual(['move']);
    expect(body.questions.move.type).toBe('choice');
    expect(body.questions.move.instructions).toBe(
      `You are advising seat ${String(me)} in Conquarrow. Which single legal step should seat ${String(me)} play next to make the most progress toward winning?`,
    );
    const keys = Array.from({ length: n }, (_, i) => `m${String(i)}`);
    expect(Object.keys(body.questions.move.criteria)).toEqual(keys);
    const texts = rowTexts(plain);
    for (const [i, key] of keys.entries()) {
      expect(body.questions.move.criteria[key]).toBe(texts[i]);
      expect(body.questions.move.criteria[key]).not.toMatch(/^\[\d+\] /);
    }
    expect(body.state).toBe(`${system}\n\n${statePrefix(plain)}`);
    // The teaching body (inside the system prompt) mentions LEGAL_MOVES in prose;
    // what the state must not carry is the offer block, which starts on a line
    // beginning LEGAL_MOVES.
    expect(body.state.split('\n').some((l) => l.startsWith(LEGAL_MOVES_PREFIX))).toBe(false);
  });
});

describe('Rule: The prompt shows probabilities in engine order', () => {
  it('An advised prompt carries the legend and a probability on every row', async () => {
    const board = threeRowBoard();
    const advised = await runTurn(board, seatConfig(), PICK_ONE, [advisorAnswers(PROBS)]);
    const plain = await plainRun(board, PICK_ONE);
    const prompt = chatPrompts(advised.fetch)[0] ?? '';
    const lines = prompt.split('\n');
    const header = lines.findIndex((l) => l.startsWith(LEGAL_MOVES_PREFIX));

    expect(ADVISOR_LEGEND).toBe(LEGEND);
    expect(header).toBeGreaterThanOrEqual(0);
    expect(lines[header + 1]).toBe(LEGEND);
    const rows = offerRowLines(prompt);
    expect(rows.map((r) => r.index).toSorted()).toEqual([0, 1, 2]);
    const byIndex = new Map(rows.map((r) => [r.index, r.line]));
    expect(byIndex.get(0)).toMatch(/ advisor=0\.10$/);
    expect(byIndex.get(1)).toMatch(/ advisor=0\.60$/);
    expect(byIndex.get(2)).toMatch(/ advisor=0\.30$/);
    expect(stripAdvice(prompt)).toBe(chatPrompts(plain.fetch)[0]);
  });

  it('The top pick is the argmax', async () => {
    const fetch = scriptedFetch([], [advisorAnswers(PROBS)]);
    const answer = await askAdvisor(seatConfig(), sampleBody(3), 3, fetch.fetch);
    expect(answer).toMatchObject({ ok: true, top: 1 });
  });
});

describe('Rule: Failure is silence', () => {
  it('A failing advisor leaves the completion unadvised and the turn plays on', async () => {
    const board = threeRowBoard();
    const run = await runTurn(board, seatConfig(), PICK_ONE, [advisorStatus(500)]);
    const plain = await plainRun(board, PICK_ONE);

    expect(chatPrompts(run.fetch)).toEqual(chatPrompts(plain.fetch));
    expect(run.turn.advisorFailures).toBe(1);
    expect(run.turn.advisorLastError).toBe(`HTTP 500 from ${SYSTEM_ONE}`);
    expect(run.turn.llmFallbacks).toBe(0);
    expect(run.turn.advisorRecords).toEqual([]);
    expect(run.turn.moves).toEqual(plain.turn.moves);
  });
});

describe('Rule: Every advised completion leaves a record', () => {
  it("The record carries the advisor's view and the model's pick", async () => {
    const board = threeRowBoard();
    const run = await runTurn(board, seatConfig(), PICK_ONE, [advisorAnswers(PROBS, 'jev-1.14.0')]);

    expect(run.turn.advisorRecords).toEqual([
      {
        seat: board.me,
        turnMoveIndex: 0,
        model: 'jev-1.14.0',
        offerSize: 3,
        top: 1,
        probabilities: [0.1, 0.6, 0.3],
        picked: 1,
      },
    ]);
  });

  it('The match log places records at absolute move indices', () => {
    const { state, me } = openingBoard();
    const steps = movesForLlm(rules.legalMoves(state));
    const seven = Array.from({ length: 7 }, (_, i) => steps[i % steps.length]).filter(
      (m) => m !== undefined,
    );
    const log = matchLogWith(state.players, seven);
    expect(log.moves).toHaveLength(7);
    const first = advisorRecord(me, { turnMoveIndex: 0 });
    const second = advisorRecord(me, { turnMoveIndex: 2, top: 0, picked: 2 });

    const next = withAdvisorRecords(log, [first, second], 7);

    expect(next.advisorRecords).toEqual([
      { ...first, at: 7 },
      { ...second, at: 9 },
    ]);
    expect(next.moves).toEqual(log.moves);
  });

  it('The summary line counts agreement', () => {
    const { me } = openingBoard();
    const records = [
      advisorRecord(me, { top: 1, picked: 1 }),
      advisorRecord(me, { top: 0, picked: 0 }),
      advisorRecord(me, { top: 2, picked: 0 }),
      advisorRecord(me, { top: 2, picked: 2 }),
    ];
    const summary = { ...emptyMatchSummary(), steps: 12, endTurns: 4 };

    expect(formatMatchSummary(summary, records).endsWith(' · advisor agreed 3/4')).toBe(true);
    expect(matchSummaryLine(true, summary, records)?.endsWith(' · advisor agreed 3/4')).toBe(true);
  });
});

describe('Rule: The toggle is in the lobby and keeps its fields', () => {
  /**
   * Seat-plan half: unchecking sets `enabled: false` only, and the kept fields
   * survive the plan's save/load. The UI half (inputs hidden while unchecked,
   * values kept in the inputs) has no React harness here — `Lobby.tsx` is read
   * as source for the fixed labels, and the hide/keep behaviour is a manual
   * check for phase 3 and the reviewer.
   */
  it('Unchecking the advisor hides its fields but keeps them', () => {
    const restore = installMemoryLocalStorage();
    try {
      const filled = readyAdvisor({
        baseUrl: 'https://api.typesafe.ai/v1',
        apiKey: ADVISOR_KEY,
        model: 'jev-latest',
      });
      let plan = updateSeat(defaultSeatPlan(3), 1, (seat) => ({
        ...seat,
        kind: 'byok',
        byok: { ...seat.byok, apiKey: SEAT_KEY, model: 'test-model', advisor: filled },
      }));
      plan = updateSeat(plan, 1, (seat) => ({
        ...seat,
        byok: { ...seat.byok, advisor: { ...seat.byok.advisor, enabled: false } },
      }));
      saveSeatPlan(plan);

      const loaded = loadSeatPlan().seats[1]?.byok.advisor;
      expect(loaded).toEqual({ ...filled, enabled: false });
    } finally {
      restore();
    }

    const lobby = lobbySource();
    expect(lobby).toContain('Advisor (decision API)');
    expect(lobby).toContain('Advisor base URL');
    expect(lobby).toContain('Advisor model');
    const keyLabel = lobby.indexOf('Advisor API key');
    expect(keyLabel).toBeGreaterThanOrEqual(0);
    const keyInput = lobby.slice(keyLabel, lobby.indexOf('</label>', keyLabel));
    expect(keyInput).toContain('type="password"');
  });

  it('The dev relay forwards the advisor', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_BYOK_PROXY', '');
    const fetch = scriptedFetch([], [advisorAnswers(PROBS)]);

    await askAdvisor(seatConfig(readyAdvisor(), { proxyUrl: '' }), sampleBody(3), 3, fetch.fetch);

    expect(fetch.requests).toHaveLength(1);
    expect(fetch.requests[0]?.url).toBe('/__byok');
    expect(fetch.requests[0]?.headers[BYOK_UPSTREAM_HEADER.toLowerCase()]).toBe(SYSTEM_ONE);
    expect(isAllowedByokUpstream(SYSTEM_ONE)).toBe(true);
  });
});
