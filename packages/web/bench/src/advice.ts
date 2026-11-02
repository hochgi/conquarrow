/**
 * P72 advisor bookkeeping: what the decision API said, how often the seat's
 * model played its top pick (the **copy rate**), how often it failed, and what
 * it cost. Read from the turn's advisor records and the chair's advisor meter;
 * nothing here reaches the prompt.
 */

import type { LlmBotTurn } from '../../src/byokBot';
import { addCost, ZERO_COST, type CostTotals } from './budget';
import type { ByokSeat } from './seat';

/** One advised completion, as the results file keeps it: no prompt, no probabilities. */
export interface AdvisorPick {
  readonly offerSize: number;
  readonly top: number;
  readonly picked: number | null;
}

export interface AdvisorCounts {
  /** Advised completions (one advisor record each). */
  readonly asked: number;
  /** Records whose `picked` equals `top`: the model played the advisor's top pick. */
  readonly agreed: number;
  /** Completions the advisor left unadvised. Not model fallbacks. */
  readonly failures: number;
  readonly lastError: string | null;
  /** The versioned models that answered, sorted. */
  readonly models: readonly string[];
  readonly picks: readonly AdvisorPick[];
}

export interface AdvisorTotals extends AdvisorCounts {
  /** Advisor POSTs that reached the wire, and transport retries on them. */
  readonly calls: number;
  readonly retries: number;
  readonly cost: CostTotals;
}

export const ZERO_ADVISOR_COUNTS: AdvisorCounts = {
  asked: 0,
  agreed: 0,
  failures: 0,
  lastError: null,
  models: [],
  picks: [],
};

const unionSorted = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])].toSorted();

export const addAdvisorTurn = (counts: AdvisorCounts, turn: LlmBotTurn): AdvisorCounts => {
  const records = turn.advisorRecords;
  return {
    asked: counts.asked + records.length,
    agreed: counts.agreed + records.filter((r) => r.picked === r.top).length,
    failures: counts.failures + turn.advisorFailures,
    lastError: turn.advisorLastError ?? counts.lastError,
    models: unionSorted(counts.models, records.map((r) => r.model)),
    picks: [...counts.picks, ...records.map((r) => ({ offerSize: r.offerSize, top: r.top, picked: r.picked }))],
  };
};

/** Null for an unadvised chair. */
export const advisorTotalsOf = (seat: ByokSeat, counts: AdvisorCounts): AdvisorTotals | null =>
  seat.advisor === undefined
    ? null
    : {
        ...counts,
        calls: seat.advisor.counters.calls,
        retries: seat.advisor.counters.retries,
        cost: seat.advisor.tally.cost,
      };

/** Summed over jobs; null when no job was advised. */
export const sumAdvisorTotals = (items: readonly (AdvisorTotals | null)[]): AdvisorTotals | null => {
  const present = items.filter((t): t is AdvisorTotals => t !== null);
  if (present.length === 0) return null;
  return present.reduce<AdvisorTotals>(
    (acc, t) => ({
      asked: acc.asked + t.asked,
      agreed: acc.agreed + t.agreed,
      failures: acc.failures + t.failures,
      lastError: t.lastError ?? acc.lastError,
      models: unionSorted(acc.models, t.models),
      picks: [...acc.picks, ...t.picks],
      calls: acc.calls + t.calls,
      retries: acc.retries + t.retries,
      cost: addCost(acc.cost, t.cost),
    }),
    { ...ZERO_ADVISOR_COUNTS, calls: 0, retries: 0, cost: ZERO_COST },
  );
};

/** Advised completions where the model played the advisor's top pick. Null when none was advised. */
export const copyRate = (totals: AdvisorCounts | null): number | null =>
  totals === null || totals.asked === 0 ? null : totals.agreed / totals.asked;
