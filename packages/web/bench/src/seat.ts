/**
 * One BYOK chair as the bench drives it: the browser's `ByokConfig` and the
 * real `playLlmBotTurn`, with a Node `fetch` behind the retry and relay leaves.
 * Nothing about the prompt is reimplemented here.
 */

import type { GameState } from '@conquarrow/contracts';
import { playLlmBotTurn, type FetchLike, type LlmBotTurn } from '../../src/byokBot';
import { DEFAULT_ADVISOR, DEFAULT_BYOK, type AdvisorConfig, type ByokConfig } from '../../src/byokConfig';
import { geometry, rules } from './board';
import { createMeter, meteredFetch, readAdvisorUsage, ZERO_COST, type CostTally, type SpendMeter } from './budget';
import { relayFetch, retryingFetch, type RetryOptions, type TransportCounters } from './transport';

/** The lobby's Reasoning flag: on = `BYOK_REASONING_MAX_TOKENS`, off = `BYOK_FAST_MAX_TOKENS`. */
export type BenchMode = 'reasoning' | 'fast';

export const BENCH_MODES: readonly BenchMode[] = ['reasoning', 'fast'];

export interface ModelAccess {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

/** Decision APIs the bench can seat as a P72 advisor. */
export type AdvisorName = 'jev';

export const ADVISOR_NAMES: readonly AdvisorName[] = ['jev'];

/** One advisor's access, read from the environment like {@link ModelAccess}. */
export interface AdvisorAccess {
  readonly name: AdvisorName;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

/** The advisor's side of a chair: its own counters, tally and meter, apart from the model's. */
export interface AdvisorSide {
  readonly counters: TransportCounters;
  readonly tally: CostTally;
  readonly meter: SpendMeter;
}

export interface ByokSeat {
  readonly kind: 'byok';
  readonly config: ByokConfig;
  readonly fetchImpl: FetchLike;
  /** The model's completions only; advisor calls count under `advisor`. */
  readonly counters: TransportCounters;
  /** This chair's own spend, beside the process-wide meter. */
  readonly tally: CostTally;
  readonly meter: SpendMeter;
  /** Present when the chair is advised (P72). */
  readonly advisor: AdvisorSide | undefined;
}

const advisorConfigFor = (advisor: AdvisorAccess | undefined): AdvisorConfig =>
  advisor === undefined
    ? DEFAULT_ADVISOR
    : { enabled: true, baseUrl: advisor.baseUrl, apiKey: advisor.apiKey, model: advisor.model };

/** What the lobby would build for a BYOK chair, minus the relay and turn-runner options. */
export const byokConfigFor = (access: ModelAccess, mode: BenchMode, advisor?: AdvisorAccess): ByokConfig => ({
  ...DEFAULT_BYOK,
  enabled: true,
  baseUrl: access.baseUrl,
  apiKey: access.apiKey,
  model: access.model,
  proxyUrl: '',
  reasoning: mode === 'reasoning',
  useTurnRunner: false,
  turnRunnerUrl: '',
  advisor: advisorConfigFor(advisor),
});

/** The adapter posts the advisor to `${baseUrl}/systemone`; everything else is a chat completion. */
export const isAdvisorTarget = (url: string): boolean => /\/systemone$/.test(url);

/** After the relay has resolved the real URL: advisor calls one way, completions the other. */
const routeByTarget =
  (chat: FetchLike, advisor: FetchLike | undefined): FetchLike =>
  (input, init) =>
    advisor !== undefined && isAdvisorTarget(input) ? advisor(input, init) : chat(input, init);

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
  advisor?: { readonly access: AdvisorAccess; readonly meter: SpendMeter },
): ByokSeat => {
  const counters: TransportCounters = { calls: 0, retries: 0 };
  const tally: CostTally = { cost: ZERO_COST };
  const chat = meteredFetch(retryingFetch(baseFetch, retry, counters), meter, tally);
  const side: AdvisorSide | undefined =
    advisor === undefined
      ? undefined
      : { counters: { calls: 0, retries: 0 }, tally: { cost: ZERO_COST }, meter: advisor.meter };
  const advise =
    side === undefined
      ? undefined
      : meteredFetch(retryingFetch(baseFetch, retry, side.counters), side.meter, side.tally, readAdvisorUsage);
  return {
    kind: 'byok',
    config: byokConfigFor(access, mode, advisor?.access),
    // relay → (advisor | model) → meter (one admission per call) → retries → the wire
    fetchImpl: relayFetch(routeByTarget(chat, advise)),
    counters,
    tally,
    meter,
    advisor: side,
  };
};

/** Either meter refused a call: the chair's turn is not a measurement any more. */
export const seatBudgetSpent = (seat: ByokSeat): boolean =>
  seat.meter.exhausted || (seat.advisor?.meter.exhausted ?? false);

/** One BYOK seat-turn for the seat to move. */
export const playByokSeatTurn = (seat: ByokSeat, state: GameState): Promise<LlmBotTurn> =>
  playLlmBotTurn(geometry, rules, state, state.activePlayer, seat.config, seat.fetchImpl);

export const ENV_BASE_URL = 'BYOK_BASE_URL';
export const ENV_MODEL = 'BYOK_MODEL';
export const ENV_API_KEY = 'BYOK_API_KEY';

export const ENV_JEV_API_KEY = 'JEV_API_KEY';
export const ENV_JEV_BASE_URL = 'JEV_BASE_URL';
export const ENV_JEV_MODEL = 'JEV_MODEL';
export const JEV_DEFAULT_BASE_URL = 'https://api.typesafe.ai/v1';
export const JEV_DEFAULT_MODEL = 'jev-latest';

/** Every key the bench may hold, for the redactor. */
export const ENV_SECRET_KEYS: readonly string[] = [ENV_API_KEY, ENV_JEV_API_KEY];

/** Read one advisor's access from the environment. Errors name a variable, never a value. */
export const advisorAccessFromEnv = (
  name: AdvisorName,
  env: Readonly<Record<string, string | undefined>>,
): AdvisorAccess => {
  const apiKey = env[ENV_JEV_API_KEY]?.trim() ?? '';
  if (apiKey.length === 0) throw new Error(`${ENV_JEV_API_KEY} is not set (source it from ~/.env)`);
  const baseUrl = env[ENV_JEV_BASE_URL]?.trim() ?? '';
  const model = env[ENV_JEV_MODEL]?.trim() ?? '';
  return {
    name,
    baseUrl: baseUrl.length > 0 ? baseUrl : JEV_DEFAULT_BASE_URL,
    model: model.length > 0 ? model : JEV_DEFAULT_MODEL,
    apiKey,
  };
};

/** Read model access from the environment. Errors name a variable, never a value. */
export const modelAccessFromEnv = (env: Readonly<Record<string, string | undefined>>): ModelAccess => {
  const read = (name: string): string => {
    const value = env[name]?.trim() ?? '';
    if (value.length === 0) throw new Error(`${name} is not set (source it from ~/.env)`);
    return value;
  };
  return { baseUrl: read(ENV_BASE_URL), model: read(ENV_MODEL), apiKey: read(ENV_API_KEY) };
};
