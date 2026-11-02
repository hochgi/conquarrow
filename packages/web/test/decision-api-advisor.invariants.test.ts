/**
 * docs/spec/decision-api-advisor/decision-api-advisor.md — EARS invariants 1–9
 * as properties, plus the spec's decision tables (readiness, URL, parsing)
 * that no single scenario reaches.
 *
 * Invariant 10 (pure core untouched) is not a test: no suite here reads
 * `git diff`. It is a reviewer check — no file under `packages/rules-core`,
 * `packages/contracts` or `packages/geometry-*` changes on this branch.
 *
 * Property inputs come from a seeded LCG and from a sample of the P79 corpus
 * turn starts (real offers, 3–6 seats, every tag the prompt prints).
 */

import { makeMatch } from '@conquarrow/geometry-tiling';
import { replay } from '@conquarrow/rules-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORPUS_NAMES, corpusLog, corpusPositions } from '../bench/src/corpus';
import {
  ADVISOR_LEGEND,
  ADVISOR_MAX_OPTIONS,
  ADVISOR_TIMEOUT_MS,
  adviseUserPrompt,
  advisorRequestBody,
  askAdvisor,
} from '../src/advisor';
import { buildSystemPrompt, buildUserPrompt, movesForLlm } from '../src/byokBot';
import { DEFAULT_ADVISOR, DEFAULT_BYOK, isAdvisorReady, systemOneUrl } from '../src/byokConfig';
import type { AdvisorConfig } from '../src/byokConfig';
import { serializeMatchLog, withAdvisorRecords } from '../src/matchLog';
import type { MatchLog } from '../src/matchLog';
import {
  SEAT_PLAN_STORAGE_KEY,
  byokConfigForSeat,
  byokFieldsFromConfig,
  loadSeatPlan,
  defaultSeat,
} from '../src/seatPlan';
import {
  ADVISOR_KEY,
  LEGAL_MOVES_PREFIX,
  SEAT_KEY,
  SYSTEM_ONE,
  THREE_MATCH,
  advisorAnswers,
  advisorHonoursSignal,
  advisorJson,
  advisorRequests,
  advisorStatus,
  advisorText,
  advisorThrows,
  appSource,
  argmaxLowest,
  atCapBoard,
  batchJson,
  bodyOf,
  chatMessage,
  chatPrompts,
  chatRequests,
  chatStatus,
  fireTimeoutsImmediately,
  geometry,
  installMemoryLocalStorage,
  lcg,
  matchLogWith,
  offConfig,
  offerRowLines,
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
  type AdvisorStep,
} from './decision-api-advisor.support';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every 12th corpus turn start: real offers of every size the corpus has. */
const corpusSample = () =>
  CORPUS_NAMES.flatMap((name) => corpusPositions(corpusLog(name))).filter((_, i) => i % 12 === 0);

const plainPromptAt = (state: Parameters<typeof buildUserPrompt>[1], seat: Parameters<typeof buildUserPrompt>[2]) => {
  const offer = movesForLlm(rules.legalMoves(state));
  return { offer, plain: buildUserPrompt(geometry, state, seat, offer, true, rules, []) };
};

const notReady: readonly { readonly name: string; readonly advisor: AdvisorConfig }[] = [
  { name: 'DEFAULT_ADVISOR', advisor: DEFAULT_ADVISOR },
  { name: 'toggled off, fields filled', advisor: readyAdvisor({ enabled: false }) },
  { name: 'enabled, empty key', advisor: readyAdvisor({ apiKey: '' }) },
  { name: 'enabled, blank key', advisor: readyAdvisor({ apiKey: '   ' }) },
  { name: 'enabled, blank base URL', advisor: readyAdvisor({ baseUrl: '  ' }) },
  { name: 'enabled, empty model', advisor: readyAdvisor({ model: '' }) },
];

describe('I1 Off is identity', () => {
  it('isAdvisorReady: enabled, and base URL, key and model all non-empty after trimming', () => {
    for (const { name, advisor } of notReady) expect(isAdvisorReady(advisor), name).toBe(false);
    expect(isAdvisorReady(readyAdvisor())).toBe(true);
    expect(isAdvisorReady(readyAdvisor({ model: ' jev ', baseUrl: ' https://x.example/v1 ' }))).toBe(true);
    expect(DEFAULT_BYOK.advisor).toEqual(DEFAULT_ADVISOR);
    expect(DEFAULT_ADVISOR).toEqual({
      enabled: false,
      baseUrl: 'https://api.typesafe.ai/v1',
      apiKey: '',
      model: 'jev-latest',
    });
  });

  it('WHILE the advisor is not ready, chat bodies, prompts and moves equal a config with no advisor, and no advisor POST is made', async () => {
    const board = twoCompletionBoard();
    const reference = await runTurn(board, offConfig(), board.chat);
    for (const { name, advisor } of notReady) {
      const run = await runTurn(board, seatConfig(advisor), board.chat, [advisorAnswers({ m0: 1 })]);
      expect(advisorRequests(run.fetch), name).toHaveLength(0);
      expect(run.fetch.requests.map((r) => r.body), name).toEqual(reference.fetch.requests.map((r) => r.body));
      expect(run.turn.moves, name).toEqual(reference.turn.moves);
      expect(run.turn.advisorRecords, name).toEqual([]);
      expect(run.turn.advisorFailures, name).toBe(0);
      expect(run.turn.advisorLastError, name).toBeUndefined();
    }
  });
});

describe('I2 Order kept', () => {
  it('the advised prompt differs from the plain one only by the legend line and one advisor=d.dd per row', () => {
    const next = lcg(72);
    const positions = corpusSample();
    expect(positions.length).toBeGreaterThan(5);
    for (const pos of positions) {
      const { offer, plain } = plainPromptAt(pos.state, pos.seat);
      const p = offer.map(() => Math.round(next() * 1000) / 1000);
      const advised = adviseUserPrompt(plain, p);
      const where = `${pos.log}#${String(pos.moveIndex)}`;

      const plainLines = plain.split('\n');
      const advisedLines = advised.split('\n');
      const header = plainLines.findIndex((l) => l.startsWith(LEGAL_MOVES_PREFIX));
      expect(advisedLines, where).toHaveLength(plainLines.length + 1);
      expect(advisedLines.slice(0, header + 1), where).toEqual(plainLines.slice(0, header + 1));
      expect(advisedLines[header + 1], where).toBe(ADVISOR_LEGEND);
      expect(stripAdvice(advised), where).toBe(plain);

      const before = offerRowLines(plain);
      const after = offerRowLines(advised);
      expect(after.map((r) => r.index), where).toEqual(before.map((r) => r.index));
      for (const [k, row] of after.entries()) {
        expect(row.line, where).toBe(`${before[k]?.line ?? ''} advisor=${(p[row.index] ?? NaN).toFixed(2)}`);
      }
    }
  });
});

describe('I3 One call per completion', () => {
  it('WHEN ready and the offer has at most 255 rows, exactly one advisor POST precedes each chat POST', async () => {
    const board = twoCompletionBoard();
    const run = await runTurn(board, seatConfig(), board.chat, [advisorAnswers({ m0: 0.4, m1: 0.6 })]);
    const pattern = run.fetch.requests.map((r) => (r.upstream === SYSTEM_ONE ? 'A' : 'C')).join('');
    expect(pattern).toBe('ACAC');
    expect(ADVISOR_MAX_OPTIONS).toBe(255);
  });

  it('an offer of exactly 255 rows is still asked', async () => {
    const board = atCapBoard();
    const run = await runTurn(board, seatConfig(), [batchJson([0], true)], [advisorAnswers({ m254: 1 })]);
    expect(run.fetch.requests.map((r) => (r.upstream === SYSTEM_ONE ? 'A' : 'C')).join('')).toBe('AC');
    expect(run.turn.advisorRecords[0]?.offerSize).toBe(255);
    expect(run.turn.advisorRecords[0]?.top).toBe(254);
  });

  it('every advisor request is a POST to the System One URL with a 10 s timeout signal', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const board = threeRowBoard();
    const run = await runTurn(board, seatConfig(), [batchJson([1], true)], [advisorAnswers({ m1: 1 })]);
    expect(ADVISOR_TIMEOUT_MS).toBe(10_000);
    expect(timeout).toHaveBeenCalledWith(ADVISOR_TIMEOUT_MS);
    const [request] = advisorRequests(run.fetch);
    expect(request?.upstream).toBe(SYSTEM_ONE);
    expect(request?.method).toBe('POST');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('systemOneUrl trims whitespace and trailing slashes', () => {
    expect(systemOneUrl('https://api.typesafe.ai/v1')).toBe(SYSTEM_ONE);
    expect(systemOneUrl('https://api.typesafe.ai/v1/')).toBe(SYSTEM_ONE);
    expect(systemOneUrl('  https://api.typesafe.ai/v1//  ')).toBe(SYSTEM_ONE);
    expect(systemOneUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/systemone');
  });
});

describe('I4 Options are the offer', () => {
  it('criteria keys are exactly m0..m<n−1>, each the row text; state is system + blank line + state prefix', () => {
    for (const pos of corpusSample()) {
      const { offer, plain } = plainPromptAt(pos.state, pos.seat);
      const system = buildSystemPrompt(pos.seat, false);
      const body = advisorRequestBody(readyAdvisor(), pos.seat, system, plain, offer.length);
      const where = `${pos.log}#${String(pos.moveIndex)}`;
      const texts = rowTexts(plain);
      const keys = offer.map((_, i) => `m${String(i)}`);

      expect(Object.keys(body.questions.move.criteria), where).toEqual(keys);
      expect(keys.map((k) => body.questions.move.criteria[k]), where).toEqual(texts);
      expect(body.state, where).toBe(`${system}\n\n${statePrefix(plain)}`);
      expect(Object.keys(body.questions.move).toSorted(), where).toEqual(['criteria', 'instructions', 'type']);
    }
  });

  it("each completion's posted question is its own offer, and its state carries the system prompt the chat call sends", async () => {
    const board = twoCompletionBoard();
    for (const reasoning of [true, false]) {
      const run = await runTurn(board, seatConfig(readyAdvisor(), { reasoning }), board.chat, [
        advisorAnswers({ m0: 0.5 }),
      ]);
      const asked = advisorRequests(run.fetch).map(bodyOf);
      const chats = chatRequests(run.fetch);
      expect(asked).toHaveLength(2);
      for (const [k, chat] of chats.entries()) {
        const plain = stripAdvice(chatMessage(chat, 'user'));
        const system = chatMessage(chat, 'system');
        const expected = advisorRequestBody(
          readyAdvisor(),
          board.me,
          buildSystemPrompt(board.me, reasoning),
          plain,
          rowTexts(plain).length,
        );
        expect(system).toBe(buildSystemPrompt(board.me, reasoning));
        expect(asked[k]).toEqual(JSON.parse(JSON.stringify(expected)));
      }
    }
  });
});

const failureModes: readonly { readonly name: string; readonly step: AdvisorStep; readonly timeout?: true }[] = [
  { name: 'throw', step: advisorThrows('boom') },
  { name: 'timeout', step: advisorHonoursSignal, timeout: true },
  { name: 'HTTP 500', step: advisorStatus(500) },
  { name: 'HTTP 401', step: advisorStatus(401) },
  { name: 'not JSON', step: advisorText('<html>') },
  { name: 'no answers', step: advisorJson({ model: 'jev' }) },
  { name: 'answers.move without probabilities', step: advisorJson({ answers: { move: {} } }) },
  { name: 'probabilities not an object', step: advisorJson({ answers: { move: { probabilities: 3 } } }) },
  { name: 'no usable probability', step: advisorAnswers({ m0: null, m1: 'NaN', x: 1 }) },
];

describe('I5 Failure is silent', () => {
  it('IF an advisor call fails, THEN moves and llmFallbacks equal the unadvised run against the same replies', async () => {
    const board = twoCompletionBoard();
    const plain = await runTurn(board, offConfig(), board.chat);
    for (const mode of failureModes) {
      const timeout = mode.timeout === true ? fireTimeoutsImmediately() : undefined;
      const run = await runTurn(board, seatConfig(), board.chat, [mode.step]);
      timeout?.mockRestore();
      expect(run.turn.advisorFailures, mode.name).toBe(2);
      expect(run.turn.moves, mode.name).toEqual(plain.turn.moves);
      expect(run.turn.llmFallbacks, mode.name).toBe(plain.turn.llmFallbacks);
      expect(run.turn.llmHits, mode.name).toBe(plain.turn.llmHits);
      expect(run.turn.lastError, mode.name).toBe(plain.turn.lastError);
      expect(chatPrompts(run.fetch), mode.name).toEqual(chatPrompts(plain.fetch));
    }
  });
});

describe('I6 Deterministic top', () => {
  it('top is the argmax of the read probabilities, ties to the lowest index; missing and non-finite read as 0', async () => {
    const next = lcg(6);
    for (let trial = 0; trial < 200; trial += 1) {
      const n = 1 + Math.floor(next() * 12);
      const reply: Record<string, unknown> = {};
      const expected: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const roll = next();
        // Quantized so ties are common.
        const value = Math.floor(next() * 5) / 4;
        if (roll < 0.15) {
          expected.push(0);
        } else if (roll < 0.25) {
          reply[`m${String(i)}`] = 'NaN';
          expected.push(0);
        } else {
          reply[`m${String(i)}`] = value;
          expected.push(value);
        }
      }
      reply['m0'] = typeof reply['m0'] === 'number' ? reply['m0'] : 0;
      expected[0] = reply['m0'] as number;
      reply[`m${String(n + 3)}`] = 9; // outside the offer: ignored
      const fetch = scriptedFetch([], [advisorAnswers(reply), advisorAnswers(reply)]);
      const first = await askAdvisor(seatConfig(), sampleBody(n), n, fetch.fetch);
      const again = await askAdvisor(seatConfig(), sampleBody(n), n, fetch.fetch);
      expect(first, `trial ${String(trial)}`).toEqual({
        ok: true,
        model: 'jev-latest',
        probabilities: expected,
        top: argmaxLowest(expected),
      });
      expect(again).toEqual(first);
    }
  });
});

describe('Decision 8: a probabilities value that is not a JSON object', () => {
  // JSON's object and array are distinct types: an array (or null, a number, a
  // string) is "not an object", so it fails with the spec's missing-object
  // reason rather than reading as an object with no m<i> keys.
  const shapes: readonly { readonly name: string; readonly probabilities: unknown }[] = [
    { name: 'array', probabilities: [0.1, 0.6, 0.3] },
    { name: 'null', probabilities: null },
    { name: 'number', probabilities: 0.6 },
    { name: 'string', probabilities: 'm1' },
  ];
  it('fails with "missing answers.move.probabilities"', async () => {
    for (const { name, probabilities } of shapes) {
      const fetch = scriptedFetch([], [advisorJson({ answers: { move: { probabilities } } })]);
      const answer = await askAdvisor(seatConfig(), sampleBody(3), 3, fetch.fetch);
      expect(answer, name).toEqual({ ok: false, reason: 'missing answers.move.probabilities' });
    }
  });
});

describe('I7 Records match advice', () => {
  const ok = advisorAnswers({ m0: 0.25, m1: 0.75 }, 'jev-1.14.0');
  const bad = advisorStatus(502);
  const sequences: readonly (readonly AdvisorStep[])[] = [
    [ok, ok],
    [bad, ok],
    [ok, bad],
    [bad, bad],
  ];

  it("the turn's record count equals its advised completions, in completion order", async () => {
    const board = twoCompletionBoard();
    for (const [s, seq] of sequences.entries()) {
      const run = await runTurn(board, seatConfig(), board.chat, seq);
      const advised = seq.flatMap((step, k) => (step === ok ? [k] : []));
      const where = `sequence ${String(s)}`;
      expect(run.turn.advisorRecords, where).toHaveLength(advised.length);
      expect(run.turn.advisorFailures, where).toBe(seq.length - advised.length);
      // Completion k starts after k applied moves on this board (lump, then split).
      expect(run.turn.advisorRecords.map((r) => r.turnMoveIndex), where).toEqual(advised);
      for (const record of run.turn.advisorRecords) {
        expect(record.seat, where).toBe(board.me);
        expect(record.probabilities, where).toHaveLength(record.offerSize);
        expect(record.picked, where).toEqual(expect.any(Number));
      }
    }
  });

  it('records round probabilities to 3 decimals and keep the configured model when the reply has none', async () => {
    const board = threeRowBoard();
    const run = await runTurn(board, seatConfig(), [batchJson([2], true)], [
      advisorAnswers({ m0: 0.123456, m1: 0.6667, m2: 0.2098 }),
    ]);
    expect(run.turn.advisorRecords).toEqual([
      {
        seat: board.me,
        turnMoveIndex: 0,
        model: 'jev-latest',
        offerSize: 3,
        top: 1,
        probabilities: [0.123, 0.667, 0.21],
        picked: 2,
      },
    ]);
  });

  it('a failed chat fetch after a usable advisor answer still records, with picked null', async () => {
    const board = threeRowBoard();
    const run = await runTurn(board, seatConfig(), [chatStatus(500)], [advisorAnswers({ m0: 0.9 })]);
    expect(run.turn.llmFallbacks).toBe(1);
    expect(run.turn.advisorRecords).toHaveLength(1);
    expect(run.turn.advisorRecords[0]?.picked).toBeNull();
  });
});

describe('I8 No secrets', () => {
  it('no advisor or seat key appears in a record, the log, advisorLastError or any prompt, across every failure mode', async () => {
    const board = twoCompletionBoard();
    const good = advisorAnswers({ m0: 0.5, m1: 0.5 }, 'jev-1.14.0');
    for (const mode of failureModes) {
      const timeout = mode.timeout === true ? fireTimeoutsImmediately() : undefined;
      const run = await runTurn(board, seatConfig(), board.chat, [mode.step, good]);
      timeout?.mockRestore();
      const log = withAdvisorRecords(matchLogWith(board.state.players, run.turn.moves), run.turn.advisorRecords, 0);
      const serialized = serializeMatchLog(log);
      expect(run.turn.advisorFailures, mode.name).toBe(1);
      for (const key of [SEAT_KEY, ADVISOR_KEY]) {
        expect(serialized, mode.name).not.toContain(key);
        expect(run.turn.advisorLastError ?? '', mode.name).not.toContain(key);
        expect(JSON.stringify(run.turn.advisorRecords), mode.name).not.toContain(key);
        for (const chat of chatRequests(run.fetch)) {
          expect(chatMessage(chat, 'user'), mode.name).not.toContain(key);
          expect(chatMessage(chat, 'system'), mode.name).not.toContain(key);
        }
      }
    }
  });
});

describe('I9 Replay ignores advice', () => {
  it('a log with advisorRecords replays to the same final state as without, and to the turn it recorded', async () => {
    const board = twoCompletionBoard();
    const run = await runTurn(board, seatConfig(), board.chat, [advisorAnswers({ m0: 0.2, m1: 0.8 })]);
    expect(run.turn.advisorRecords.length).toBeGreaterThan(0);

    const bare = matchLogWith(board.state.players, run.turn.moves);
    const advised = withAdvisorRecords(bare, run.turn.advisorRecords, 0);
    const reloaded = JSON.parse(serializeMatchLog(advised)) as MatchLog;

    expect(reloaded.advisorRecords?.map((r) => r.at)).toEqual(run.turn.advisorRecords.map((r) => r.turnMoveIndex));
    const opening = makeMatch(THREE_MATCH);
    expect(opening).toEqual(board.state);
    const withAdvice = replay(rules, makeMatch(reloaded.config), reloaded.moves);
    const without = replay(rules, makeMatch(bare.config), bare.moves);
    expect(withAdvice).toEqual(without);
    expect(withAdvice).toEqual(run.turn.state);
  });
});

describe('Configuration persists (Decision 1) and is threaded (Seams)', () => {
  it('a saved advisor parses with defaults: non-boolean enabled is off, a non-string field takes its default', () => {
    const restore = installMemoryLocalStorage();
    try {
      const seat = (advisor: unknown) => ({
        kind: 'byok',
        byok: { baseUrl: 'https://api.x.ai/v1', apiKey: SEAT_KEY, model: 'grok', advisor },
      });
      globalThis.localStorage.setItem(
        SEAT_PLAN_STORAGE_KEY,
        JSON.stringify({
          playerCount: 3,
          seats: [
            seat({ enabled: 'yes', baseUrl: 5, apiKey: ADVISOR_KEY, model: null }),
            seat({ enabled: true, baseUrl: 'https://openrouter.ai/api/v1', apiKey: 7, model: 'jev-x' }),
            seat('not an object'),
          ],
        }),
      );
      const plan = loadSeatPlan();
      expect(plan.seats[0]?.byok.advisor).toEqual({ ...DEFAULT_ADVISOR, apiKey: ADVISOR_KEY });
      expect(plan.seats[1]?.byok.advisor).toEqual({
        enabled: true,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: '',
        model: 'jev-x',
      });
      expect(plan.seats[2]?.byok.advisor).toEqual(DEFAULT_ADVISOR);
    } finally {
      restore();
    }
  });

  it('byokFieldsFromConfig and byokConfigForSeat carry the advisor', () => {
    const advisor = readyAdvisor({ model: 'jev-1.14.0' });
    expect(byokFieldsFromConfig(seatConfig(advisor)).advisor).toEqual(advisor);
    const seat = { ...defaultSeat('byok'), byok: { ...defaultSeat('byok').byok, advisor } };
    expect(byokConfigForSeat(seat).advisor).toEqual(advisor);
  });

  it('App threads a BYOK turn’s records into the log and the summary line', () => {
    const app = appSource();
    expect(app).toMatch(/withAdvisorRecords\(/);
    expect(app).toMatch(/matchSummaryLine\([^;]*advisorRecords/);
  });
});
