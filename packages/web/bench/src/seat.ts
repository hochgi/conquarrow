/**
 * One BYOK chair as the bench drives it: the browser's `ByokConfig` and the
 * real `playLlmBotTurn`, with a Node `fetch` behind the retry and relay leaves.
 * Nothing about the prompt is reimplemented here.
 */

import type { GameState } from '@conquarrow/contracts';
import { playLlmBotTurn, type FetchLike, type LlmBotTurn } from '../../src/byokBot';
import { DEFAULT_BYOK, type ByokConfig } from '../../src/byokConfig';
import { geometry, rules } from './board';
import { createMeter, meteredFetch, ZERO_COST, type CostTally, type SpendMeter } from './budget';
import { relayFetch, retryingFetch, type RetryOptions, type TransportCounters } from './transport';

/** The lobby's Reasoning flag: on = `BYOK_REASONING_MAX_TOKENS`, off = `BYOK_FAST_MAX_TOKENS`. */
export type BenchMode = 'reasoning' | 'fast';

export const BENCH_MODES: readonly BenchMode[] = ['reasoning', 'fast'];

export interface ModelAccess {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export interface ByokSeat {
  readonly kind: 'byok';
  readonly config: ByokConfig;
  readonly fetchImpl: FetchLike;
  readonly counters: TransportCounters;
  /** This chair's own spend, beside the process-wide meter. */
  readonly tally: CostTally;
  readonly meter: SpendMeter;
}

/** What the lobby would build for a BYOK chair, minus the relay and turn-runner options. */
export const byokConfigFor = (access: ModelAccess, mode: BenchMode): ByokConfig => ({
  ...DEFAULT_BYOK,
  enabled: true,
  baseUrl: access.baseUrl,
  apiKey: access.apiKey,
  model: access.model,
  proxyUrl: '',
  reasoning: mode === 'reasoning',
  useTurnRunner: false,
  turnRunnerUrl: '',
});

/**
 * A fresh chair: its own counters and tally, so one match's calls never count
 * toward another's. The meter is the process's, shared across its jobs; an
 * unmetered one by default.
 */
export const createByokSeat = (
  access: ModelAccess,
  mode: BenchMode,
  baseFetch: FetchLike,
  retry: RetryOptions,
  meter: SpendMeter = createMeter(undefined),
): ByokSeat => {
  const counters: TransportCounters = { calls: 0, retries: 0 };
  const tally: CostTally = { cost: ZERO_COST };
  return {
    kind: 'byok',
    config: byokConfigFor(access, mode),
    // relay → meter (one admission per completion) → retries → the wire
    fetchImpl: relayFetch(meteredFetch(retryingFetch(baseFetch, retry, counters), meter, tally)),
    counters,
    tally,
    meter,
  };
};

/** One BYOK seat-turn for the seat to move. */
export const playByokSeatTurn = (seat: ByokSeat, state: GameState): Promise<LlmBotTurn> =>
  playLlmBotTurn(geometry, rules, state, state.activePlayer, seat.config, seat.fetchImpl);

export const ENV_BASE_URL = 'BYOK_BASE_URL';
export const ENV_MODEL = 'BYOK_MODEL';
export const ENV_API_KEY = 'BYOK_API_KEY';

/** Read model access from the environment. Errors name a variable, never a value. */
export const modelAccessFromEnv = (env: Readonly<Record<string, string | undefined>>): ModelAccess => {
  const read = (name: string): string => {
    const value = env[name]?.trim() ?? '';
    if (value.length === 0) throw new Error(`${name} is not set (source it from ~/.env)`);
    return value;
  };
  return { baseUrl: read(ENV_BASE_URL), model: read(ENV_MODEL), apiKey: read(ENV_API_KEY) };
};
