import { describe, expect, it, vi } from 'vitest';
import { endTurn, mintArrowId, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import {
  buildSystemPrompt,
  buildUserPrompt,
  byokCompletionBody,
  chooseLlmMove,
  fetchLlmMoveIndex,
  formatLegalMoves,
  movesForLlm,
  parseMoveIndex,
  playLlmBotTurn,
  postChatCompletions,
  snapshotForPrompt,
  testByokConnection,
  type FetchLike,
} from '../src/byokBot';
import {
  DEFAULT_BYOK,
  BYOK_UPSTREAM_HEADER,
  chatCompletionsUrl,
  isAllowedByokUpstream,
  isByokReady,
  type ByokConfig,
} from '../src/byokConfig';
import {
  defaultSeatPlan,
  resizeSeatPlan,
  seatPlanReady,
  summarizeDrivers,
  updateSeat,
} from '../src/seatPlan';

const readyConfig = (over: Partial<ByokConfig> = {}): ByokConfig => ({
  ...DEFAULT_BYOK,
  enabled: true,
  apiKey: 'sk-test',
  model: 'test-model',
  ...over,
});

const jsonResponse = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('byokConfig', () => {
  it('requires enabled url key and model', () => {
    expect(isByokReady(DEFAULT_BYOK)).toBe(false);
    expect(isByokReady(readyConfig())).toBe(true);
    expect(isByokReady(readyConfig({ apiKey: '  ' }))).toBe(false);
  });

  it('joins chat completions without a double slash', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });

  it('allowlists common OpenAI-compatible hosts', () => {
    expect(isAllowedByokUpstream('https://api.openai.com/v1/chat/completions')).toBe(true);
    expect(isAllowedByokUpstream('https://api.x.ai/v1/chat/completions')).toBe(true);
    expect(isAllowedByokUpstream('https://integrate.api.nvidia.com/v1/chat/completions')).toBe(
      true,
    );
    expect(isAllowedByokUpstream('http://localhost:4000/v1/chat/completions')).toBe(true);
    expect(isAllowedByokUpstream('http://127.0.0.1:4000/chat/completions')).toBe(true);
    expect(isAllowedByokUpstream('http://evil.example/v1/chat/completions')).toBe(false);
    expect(isAllowedByokUpstream('https://evil.example/v1/chat/completions')).toBe(false);
  });
});

describe('seatPlan', () => {
  it('defaults to 3 seats with A human and the rest heuristic', () => {
    const plan = defaultSeatPlan(3);
    expect(plan.playerCount).toBe(3);
    expect(plan.seats.map((s) => s.kind)).toEqual(['human', 'heuristic', 'heuristic']);
    expect(seatPlanReady(plan)).toBe(true);
    expect(summarizeDrivers(plan)).toBe('heuristic');
  });

  it('resizes to 6 and blocks Start when a BYOK seat is incomplete', () => {
    let plan = resizeSeatPlan(defaultSeatPlan(3), 6);
    expect(plan.seats).toHaveLength(6);
    plan = updateSeat(plan, 2, { kind: 'byok' });
    expect(seatPlanReady(plan)).toBe(false);
    plan = updateSeat(plan, 2, {
      kind: 'byok',
      byok: {
        baseUrl: 'http://localhost:4000/v1',
        apiKey: 'sk-x',
        model: 'local',
        proxyUrl: '',
        reasoning: true,
        useTurnRunner: false,
        turnRunnerUrl: '',
      },
    });
    expect(seatPlanReady(plan)).toBe(true);
    expect(summarizeDrivers(plan)).toBe('mixed');
  });
});

describe('byokBot parsing', () => {
  it('formats legal moves with stable indices', () => {
    const from = mintArrowId('a');
    const exit = mintArrowId('b');
    const moves: Move[] = [step(from, exit, 1), endTurn()];
    expect(formatLegalMoves(moves)).toContain('[0] step');
    expect(formatLegalMoves(moves)).toContain('[1] endTurn');
  });

  it('annotates steps with tipDist and outcome tags', () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const state = makeMatch({
      dominationN: 5,
      R: 7,
      homeOffset: 5,
      playerCount: 3,
      spawnerSeed: 1,
    });
    const me = state.activePlayer;
    const moves = movesForLlm(rules.legalMoves(state));
    const listed = formatLegalMoves(moves, geometry, rules, state, me);
    expect(listed).toMatch(/tipDist=\d+→\d+/);
    expect(listed).toContain('trailLen=');
    expect(listed).toMatch(/leave_home|home_mill|onto_home/);
    expect(buildSystemPrompt(me, true)).toContain('leave_home');
    expect(buildSystemPrompt(me, true)).toContain('spawner');
  });

  it('parses strict index replies and ignores digits inside arrow prose', () => {
    expect(parseMoveIndex('3', 5)).toBe(3);
    expect(parseMoveIndex('{"move":2,"why":"step"}', 4)).toBe(2);
    expect(parseMoveIndex('thinking...\n<<<MOVE:2>>>\n', 4)).toBe(2);
    expect(parseMoveIndex('ANSWER: 2', 4)).toBe(2);
    expect(parseMoveIndex('INDEX: 1', 4)).toBe(1);
    // Truncated Nemotron prose with tiling ids must NOT become a false hit.
    expect(
      parseMoveIndex(
        'We are seat B. We have groups:\n- B group at tiling:a:-4,6,0 with ',
        20,
      ),
    ).toBeUndefined();
    expect(parseMoveIndex('ramble 0 then answer 3', 4)).toBeUndefined();
    expect(parseMoveIndex('99', 3)).toBeUndefined();
    expect(parseMoveIndex('nope', 3)).toBeUndefined();
  });

  it('hides skip from the model while any step remains', () => {
    const from = mintArrowId('a');
    const exit = mintArrowId('b');
    const moves: Move[] = [step(from, exit, 1), { kind: 'skip', from }, endTurn()];
    expect(movesForLlm(moves).map((m) => m.kind)).toEqual(['step', 'endTurn']);
    expect(movesForLlm([{ kind: 'skip', from }, endTurn()]).map((m) => m.kind)).toEqual([
      'skip',
      'endTurn',
    ]);
  });

  it('builds a strategy-aware prompt that lists every offered move', () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const state = makeMatch({
      dominationN: 5,
      R: 7,
      homeOffset: 5,
      playerCount: 3,
      spawnerSeed: 1,
    });
    const seat = state.activePlayer;
    const moves = rules.legalMoves(state);
    const prompt = buildUserPrompt(geometry, state, seat, moves, true, rules);
    expect(prompt).toContain('LEGAL_MOVES');
    expect(prompt).toContain('[0]');
    expect(prompt).toContain('{"move":N');
    expect(prompt).toContain('tipDist=');
    expect(prompt).toMatch(/shares|spawner shares/i);
    expect(buildSystemPrompt(seat, true)).toContain(`seat ${String(seat)}`);
    expect(buildSystemPrompt(seat, true)).toContain('{"move":N');
    expect(buildSystemPrompt(seat, true)).toContain('leave_home');
    const snap = snapshotForPrompt(geometry, state, seat);
    expect(typeof snap).toBe('object');
    expect(snap).not.toBeNull();
    if (typeof snap === 'object' && snap !== null && 'shareCounts' in snap) {
      expect(typeof snap.shareCounts).toBe('object');
    }
    expect(moves.length).toBeGreaterThan(0);
  });
});

describe('byokBot fetch + fallback', () => {
  it('posts via proxy URL and sets the upstream header', async () => {
    const spy = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(jsonResponse('0'));
    });
    await postChatCompletions(
      readyConfig({ proxyUrl: 'https://relay.example/byok' }),
      { model: 'x' },
      spy,
    );
    expect(spy).toHaveBeenCalledOnce();
    const call = spy.mock.calls[0];
    expect(call?.[0]).toBe('https://relay.example/byok');
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers[BYOK_UPSTREAM_HEADER]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('reads an index from a chat-completions response', async () => {
    const fetchImpl: FetchLike = () => Promise.resolve(jsonResponse('{"move":1,"why":"ok"}'));
    const spy = vi.fn(fetchImpl);
    const opening = makeMatch();
    const result = await fetchLlmMoveIndex(
      readyConfig(),
      'prompt',
      4,
      opening.activePlayer,
      spy,
    );
    expect(result).toEqual({ ok: true, index: 1 });
    expect(spy).toHaveBeenCalledOnce();
    const rawBody = spy.mock.calls[0]?.[1]?.body;
    expect(typeof rawBody).toBe('string');
    if (typeof rawBody !== 'string') return;
    const body = JSON.parse(rawBody) as {
      max_tokens: number;
      response_format: { type: string };
      chat_template_kwargs?: { enable_thinking: boolean };
    };
    expect(body.max_tokens).toBe(512);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.chat_template_kwargs).toEqual(
      expect.objectContaining({ enable_thinking: false }),
    );
  });

  it('builds a completion body with json_object and thinking forced off', () => {
    const body = byokCompletionBody(readyConfig(), [{ role: 'user', content: '0' }]);
    expect(body['response_format']).toEqual({ type: 'json_object' });
    expect(body['max_tokens']).toBe(512);
    expect(body['chat_template_kwargs']).toEqual(
      expect.objectContaining({ enable_thinking: false }),
    );
  });

  it('uses a smaller token budget for fast seats', () => {
    const body = byokCompletionBody(readyConfig({ reasoning: false }), [
      { role: 'user', content: '0' },
    ]);
    expect(body['max_tokens']).toBe(64);
  });

  it('retries with a fast extract when the first reply is unusable prose', async () => {
    const prose =
      'Let me analyze. Group at tiling:a:-5,5,0. I think move 0 toward center is best because...';
    const spy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(prose))
      .mockResolvedValueOnce(jsonResponse('{"move":0}'));
    const opening = makeMatch();
    const result = await fetchLlmMoveIndex(
      readyConfig(),
      'prompt',
      4,
      opening.activePlayer,
      spy,
    );
    expect(result).toEqual({ ok: true, index: 0 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('routes picks through the turn runner when enabled', async () => {
    const spy = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, move: 2, why: 'plan' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const opening = makeMatch();
    const result = await fetchLlmMoveIndex(
      readyConfig({
        useTurnRunner: true,
        turnRunnerUrl: 'http://127.0.0.1:4010',
      }),
      'STATE_JSON…',
      4,
      opening.activePlayer,
      spy,
    );
    expect(result).toEqual({ ok: true, index: 2 });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4010/v1/pick');
    const rawBody = spy.mock.calls[0]?.[1]?.body;
    expect(typeof rawBody).toBe('string');
    if (typeof rawBody !== 'string') return;
    const body = JSON.parse(rawBody) as {
      moveCount: number;
      plan: boolean;
      upstream: string;
    };
    expect(body.moveCount).toBe(4);
    expect(body.plan).toBe(true);
    expect(body.upstream).toBe('https://api.openai.com/v1');
  });

  it('falls back to the heuristic when the model is unreachable', async () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const opening = makeMatch();
    const me = opening.activePlayer;
    const fetchImpl: FetchLike = () => Promise.reject(new Error('network'));
    const choice = await chooseLlmMove(geometry, rules, opening, me, readyConfig(), fetchImpl);
    expect(choice.source).toBe('heuristic');
    expect(choice.reason).toMatch(/fetch failed/);
    expect(['step', 'endTurn', 'skip']).toContain(choice.move.kind);
  });

  it('probes the connection with a tiny completion', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(jsonResponse('{"move":0,"why":"probe"}'));
    const result = await testByokConnection(readyConfig(), fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sample).toContain('move');
  });

  it('treats HTTP 200 with reasoning_content and empty content as connected', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '', reasoning_content: 'chain of thought' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    const result = await testByokConnection(readyConfig(), fetchImpl);
    expect(result.ok).toBe(true);
  });

  it('treats HTTP 200 with an empty assistant message as connected', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const result = await testByokConnection(readyConfig(), fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sample).toContain('200');
  });

  it('reports HTTP 401 from the probe', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    const result = await testByokConnection(readyConfig(), fetchImpl);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('HTTP 401');
    expect(result.reason).toContain('Incorrect API key');
  });

  it('plays a full LLM turn using mocked endTurn picks then hands the seat back', async () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const opening = makeMatch();
    const A = opening.players[0];
    const B = opening.players[1];
    expect(A).toBeDefined();
    expect(B).toBeDefined();
    if (A === undefined || B === undefined) return;

    const afterA = rules.apply(opening, endTurn());
    expect(afterA.activePlayer).toBe(B);

    const fetchImpl: FetchLike = (_url, init) => {
      const bodyUnknown: unknown = init?.body;
      const raw = typeof bodyUnknown === 'string' ? bodyUnknown : '';
      const match = /\[(\d+)\] endTurn/.exec(raw);
      return Promise.resolve(jsonResponse(`{"move":${match?.[1] ?? '0'}}`));
    };
    const spy = vi.fn(fetchImpl);

    const { state, moves, llmHits, llmFallbacks } = await playLlmBotTurn(
      geometry,
      rules,
      afterA,
      B,
      readyConfig(),
      spy,
    );
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((m) => m.kind === 'endTurn')).toBe(true);
    expect(state.activePlayer).toBe(A);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(llmHits).toBeGreaterThan(0);
    expect(llmFallbacks).toBe(0);
  });
});
