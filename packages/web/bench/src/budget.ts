/**
 * Spend metering and the hard `--max-usd` cap.
 *
 * Every chat-completions response is read **from a clone** for its `usage`, so
 * the body `playLlmBotTurn` parses is untouched. Cost per call, USD:
 *
 *   (prompt − cached) × in  +  cached × cached-price  +  billable output × out
 *
 * **Reasoning tokens.** Some providers count `completion_tokens_details.
 * reasoning_tokens` *inside* `completion_tokens` (a breakdown); xAI bills them as
 * output on top. The shape decides when it can: `total_tokens = P + O + R` means
 * separate, `= P + O` means included, and `O < R` can only be separate. When the
 * shape cannot tell, `reasoningBilledSeparately` decides — default true, the
 * over-counting choice.
 *
 * **The cap.** Before each call: if `spent + estimate > max`, the call is refused
 * and the meter is exhausted. The estimate is the mean cost of the calls so far,
 * or {@link FIRST_CALL_ESTIMATE_USD} before any. So one meter overshoots by at
 * most one call. The refusal is a thrown error inside `fetch`; the match runner
 * sees `exhausted` and aborts the match rather than scoring the heuristic's
 * fallback moves.
 */

import type { FetchLike } from '../../src/byokBot';

/** USD per 1M tokens. */
export interface Prices {
  readonly in: number;
  readonly cached: number;
  readonly out: number;
}

/** grok-4.7 list prices. */
export const DEFAULT_PRICES: Prices = { in: 2.0, cached: 0.5, out: 6.0 };

export const FIRST_CALL_ESTIMATE_USD = 0.03;

export interface CallUsage {
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
  /** `completionTokens`, plus `reasoningTokens` when those are billed on top. */
  readonly billableOutputTokens: number;
}

export interface CostTotals extends CallUsage {
  readonly calls: number;
  readonly usd: number;
}

export const ZERO_COST: CostTotals = {
  calls: 0,
  promptTokens: 0,
  cachedTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  billableOutputTokens: 0,
  usd: 0,
};

export const addCost = (a: CostTotals, b: CostTotals): CostTotals => ({
  calls: a.calls + b.calls,
  promptTokens: a.promptTokens + b.promptTokens,
  cachedTokens: a.cachedTokens + b.cachedTokens,
  completionTokens: a.completionTokens + b.completionTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  billableOutputTokens: a.billableOutputTokens + b.billableOutputTokens,
  usd: a.usd + b.usd,
});

const obj = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const reasoningIsSeparate = (
  usage: Record<string, unknown>,
  parts: { readonly p: number; readonly o: number; readonly r: number },
  fallback: boolean,
): boolean => {
  if (parts.r === 0) return false;
  if (parts.o < parts.r) return true;
  const total = usage['total_tokens'];
  if (typeof total === 'number') {
    if (total === parts.p + parts.o + parts.r) return true;
    if (total === parts.p + parts.o) return false;
  }
  return fallback;
};

/** Read one response body's `usage`. Absent fields are zero. */
export const readUsage = (body: unknown, reasoningBilledSeparately: boolean): CallUsage => {
  const usage = obj(obj(body)['usage']);
  const p = count(usage['prompt_tokens']);
  const cached = Math.min(p, count(obj(usage['prompt_tokens_details'])['cached_tokens']));
  const o = count(usage['completion_tokens']);
  const r = count(obj(usage['completion_tokens_details'])['reasoning_tokens']);
  const separate = reasoningIsSeparate(usage, { p, o, r }, reasoningBilledSeparately);
  return {
    promptTokens: p,
    cachedTokens: cached,
    completionTokens: o,
    reasoningTokens: r,
    billableOutputTokens: o + (separate ? r : 0),
  };
};

export const usdOf = (usage: CallUsage, prices: Prices): number =>
  ((usage.promptTokens - usage.cachedTokens) * prices.in +
    usage.cachedTokens * prices.cached +
    usage.billableOutputTokens * prices.out) /
  1e6;

/** One process's budget. Mutable by design: it is the running tally. */
export interface SpendMeter {
  /** Undefined = unmetered (mirror, and the harness's own tests by default). */
  readonly maxUsd: number | undefined;
  readonly prices: Prices;
  readonly reasoningBilledSeparately: boolean;
  total: CostTotals;
  /** Set when a call was refused; nothing further starts in this process. */
  exhausted: boolean;
}

export const createMeter = (
  maxUsd: number | undefined,
  prices: Prices = DEFAULT_PRICES,
  reasoningBilledSeparately = true,
): SpendMeter => ({ maxUsd, prices, reasoningBilledSeparately, total: ZERO_COST, exhausted: false });

export const nextCallEstimate = (meter: SpendMeter): number =>
  meter.total.calls === 0 ? FIRST_CALL_ESTIMATE_USD : meter.total.usd / meter.total.calls;

/** May one more call start? Refusing exhausts the meter for good. */
export const admit = (meter: SpendMeter): boolean => {
  if (meter.exhausted) return false;
  if (meter.maxUsd === undefined) return true;
  if (meter.total.usd + nextCallEstimate(meter) > meter.maxUsd) {
    meter.exhausted = true;
    return false;
  }
  return true;
};

export const BUDGET_REFUSAL = 'budget cap reached: call not started';

/** A per-match tally the seat keeps beside the process meter. */
export interface CostTally {
  cost: CostTotals;
}

const readClonedUsage = async (response: Response, meter: SpendMeter): Promise<CallUsage> => {
  try {
    const body: unknown = await response.clone().json();
    return readUsage(body, meter.reasoningBilledSeparately);
  } catch {
    return readUsage(undefined, meter.reasoningBilledSeparately);
  }
};

/**
 * Admit, call, then charge whatever `usage` the response reports — to the
 * process meter and to the seat's own tally. Wrap it *outside* the retry layer:
 * one admission per completion, however many transport retries it takes.
 */
export const meteredFetch =
  (base: FetchLike, meter: SpendMeter, tally: CostTally): FetchLike =>
  async (input, init) => {
    if (!admit(meter)) throw new Error(BUDGET_REFUSAL);
    const response = await base(input, init);
    const usage = response.ok ? await readClonedUsage(response, meter) : readUsage(undefined, true);
    // Only a priced reply counts as a call: a failed one would drag the estimate down.
    const charged: CostTotals = { ...usage, calls: response.ok ? 1 : 0, usd: usdOf(usage, meter.prices) };
    meter.total = addCost(meter.total, charged);
    tally.cost = addCost(tally.cost, charged);
    return response;
  };
