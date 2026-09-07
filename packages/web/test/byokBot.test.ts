import { describe, expect, it, vi } from 'vitest';
import { endTurn, mintArrowId, step } from '@conquarrow/contracts';
import type { Move } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import {
  buildSystemPrompt,
  buildUserPrompt,
  byokCompletionBody,
  formatLegalMoves,
  movesForLlm,
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
  it('formats legal moves with stable indices and does not number endTurn in the offer', () => {
    const from = mintArrowId('a');
    const exit = mintArrowId('b');
    const moves: Move[] = [step(from, exit, 1), endTurn()];
    expect(formatLegalMoves(moves)).toContain('[0] step');
    expect(movesForLlm(moves).map((m) => m.kind)).toEqual(['step']);
    expect(formatLegalMoves(movesForLlm(moves))).not.toMatch(/\[\d+\] endTurn/);
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
    expect(listed).toMatch(/count=1 leave=2 spd=1 spent=0/);
    expect(listed).toMatch(/count=2 leave=1 spd=2 spent=0/);
    expect(buildUserPrompt(geometry, state, me, moves, true, rules)).toContain('spd-spent');
    expect(buildSystemPrompt(me, true)).toContain('leave_home');
    expect(buildSystemPrompt(me, true)).toContain('spawner');
    expect(buildSystemPrompt(me, true)).toMatch(/2\^k/);
    expect(buildSystemPrompt(me, true)).toMatch(/k\+1/);
    expect(buildSystemPrompt(me, true)).toMatch(/leftover/);
  });

  it('keeps spd as speed(count) after a split, and prints inherited spent', () => {
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
    const pair = rules.legalMoves(state).find(
      (m): m is Extract<Move, { kind: 'step' }> => m.kind === 'step' && m.count === 2,
    );
    expect(pair).toBeDefined();
    if (pair === undefined) return;
    const after = rules.apply(state, pair);
    const listed = formatLegalMoves(
      movesForLlm(rules.legalMoves(after)),
      geometry,
      rules,
      after,
      me,
    );
    expect(listed).toMatch(/count=2 spd=2 spent=1/);
    expect(listed).toMatch(/count=1 spd=1 spent=0/);
  });

  it('shows the model steps only — endTurn is not an offer index', () => {
    const from = mintArrowId('a');
    const exit = mintArrowId('b');
    const moves: Move[] = [step(from, exit, 1), endTurn()];
    expect(movesForLlm(moves).map((m) => m.kind)).toEqual(['step']);
    expect(movesForLlm([endTurn()])).toEqual([]);
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
    expect(prompt).toContain('"moves"');
    expect(prompt).not.toContain('Pick one LEGAL_MOVES index');
    expect(prompt).not.toContain('{"move":N');
    expect(prompt).toContain('tipDist=');
    expect(prompt).toMatch(/shares|spawner shares/i);
    expect(buildSystemPrompt(seat, true)).toContain(`seat ${String(seat)}`);
    expect(buildSystemPrompt(seat, true)).toContain('"moves"');
    expect(buildSystemPrompt(seat, true)).toContain('endTurn');
    expect(buildSystemPrompt(seat, true)).not.toContain('{"move":N');
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

});
