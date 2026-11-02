/**
 * Playtest seat roster — who sits where, and how each chair is driven.
 *
 * Restricted to 3 or 6: those counts sit on the tiling's order-3 rotational
 * symmetry (SPEC §2), so every home has the same grain relationship to the
 * centre. Two-player mirror play felt directionally unfair in local BYOK tests.
 */

import { mintPlayerId, type PlayerId } from '@conquarrow/contracts';
import {
  DEFAULT_ADVISOR,
  DEFAULT_BYOK,
  isByokReady,
  loadByokConfig,
  type AdvisorConfig,
  type ByokConfig,
} from './byokConfig';

export const SEAT_PLAN_STORAGE_KEY = 'conquarrow:seat-plan';

/** Playtest lobby only offers rotationally fair counts. */
export const PLAYTEST_PLAYER_COUNTS = [3, 6] as const;
export type PlaytestPlayerCount = (typeof PLAYTEST_PLAYER_COUNTS)[number];

export type SeatKind = 'human' | 'heuristic' | 'byok';

export interface SeatByokFields {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly proxyUrl: string;
  /** Default true — reasoning models need this for non-stupid play. */
  readonly reasoning: boolean;
  /** Local plan→commit runner (tools/byok-turn-runner). */
  readonly useTurnRunner: boolean;
  readonly turnRunnerUrl: string;
  /** Decision-API advisor (P72). An older save without it parses to DEFAULT_ADVISOR. */
  readonly advisor: AdvisorConfig;
}

export interface SeatConfig {
  readonly kind: SeatKind;
  /** Edited whenever kind is byok; ignored otherwise. */
  readonly byok: SeatByokFields;
}

export interface SeatPlan {
  readonly playerCount: PlaytestPlayerCount;
  readonly seats: readonly SeatConfig[];
}

export const PLAYER_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const emptyByokFields = (): SeatByokFields => ({
  baseUrl: DEFAULT_BYOK.baseUrl,
  apiKey: '',
  model: DEFAULT_BYOK.model,
  proxyUrl: '',
  reasoning: true,
  useTurnRunner: false,
  turnRunnerUrl: '',
  advisor: DEFAULT_ADVISOR,
});

export const byokFieldsFromConfig = (config: ByokConfig): SeatByokFields => ({
  baseUrl: config.baseUrl,
  apiKey: config.apiKey,
  model: config.model,
  proxyUrl: config.proxyUrl,
  reasoning: config.reasoning,
  useTurnRunner: config.useTurnRunner,
  turnRunnerUrl: config.turnRunnerUrl,
  advisor: config.advisor,
});

export const byokConfigForSeat = (seat: SeatConfig): ByokConfig => ({
  enabled: seat.kind === 'byok',
  ...seat.byok,
});

export const defaultSeat = (kind: SeatKind = 'heuristic'): SeatConfig => ({
  kind,
  byok: emptyByokFields(),
});

export const defaultSeatPlan = (playerCount: PlaytestPlayerCount = 3): SeatPlan => {
  const seats: SeatConfig[] = [];
  for (let i = 0; i < playerCount; i += 1) {
    seats.push(defaultSeat(i === 0 ? 'human' : 'heuristic'));
  }
  return { playerCount, seats };
};

/** Local → Online: seats 0 and 1 become `human`; leftover `byok` becomes `heuristic`. */
export const coerceOnlineSeatPlan = (plan: SeatPlan): SeatPlan => ({
  playerCount: plan.playerCount,
  seats: plan.seats.map((seat, index) => {
    if (index === 0 || index === 1) return { ...seat, kind: 'human' };
    if (seat.kind === 'byok') return { ...seat, kind: 'heuristic' };
    return seat;
  }),
});

/** Online: a `human` → `heuristic` change is applied only when the plan has ≥ 3 `human` chairs. */
export const onlineSeatKindAllowed = (
  plan: SeatPlan,
  index: number,
  nextKind: SeatKind,
): boolean => {
  const current = plan.seats[index];
  if (current?.kind === 'human' && nextKind === 'heuristic') {
    return plan.seats.filter((seat) => seat.kind === 'human').length >= 3;
  }
  return true;
};

export const resizeSeatPlan = (plan: SeatPlan, playerCount: PlaytestPlayerCount): SeatPlan => {
  const seats = [...plan.seats];
  while (seats.length < playerCount) seats.push(defaultSeat('heuristic'));
  return { playerCount, seats: seats.slice(0, playerCount) };
};

export const updateSeat = (
  plan: SeatPlan,
  index: number,
  patch: Partial<SeatConfig> | ((prev: SeatConfig) => SeatConfig),
): SeatPlan => {
  const seats = plan.seats.map((seat, i) => {
    if (i !== index) return seat;
    return typeof patch === 'function' ? patch(seat) : { ...seat, ...patch };
  });
  return { ...plan, seats };
};

export const seatPlayerId = (index: number): PlayerId => {
  const label = PLAYER_LABELS[index];
  if (label === undefined) throw new Error(`seatPlan: bad seat index ${String(index)}`);
  return mintPlayerId(label);
};

/** Ready for Start: every byok seat has url/key/model filled. */
export const seatPlanReady = (plan: SeatPlan): boolean => {
  if (plan.seats.length !== plan.playerCount) return false;
  for (const seat of plan.seats) {
    if (seat.kind === 'byok' && !isByokReady(byokConfigForSeat(seat))) return false;
  }
  return true;
};

export const hasAiSeat = (plan: SeatPlan): boolean =>
  plan.seats.some((s) => s.kind !== 'human');

export const hasByokSeat = (plan: SeatPlan): boolean =>
  plan.seats.some((s) => s.kind === 'byok');

export const firstHumanSeat = (plan: SeatPlan): PlayerId | undefined => {
  const i = plan.seats.findIndex((s) => s.kind === 'human');
  if (i < 0) return undefined;
  return seatPlayerId(i);
};

export const aiSeatIds = (plan: SeatPlan): readonly PlayerId[] =>
  plan.seats.flatMap((seat, i) => (seat.kind === 'human' ? [] : [seatPlayerId(i)]));

export type SeatDriverSummary = 'human-hotseat' | 'heuristic' | 'byok' | 'mixed';

export const summarizeDrivers = (plan: SeatPlan): SeatDriverSummary => {
  const kinds = new Set(plan.seats.map((s) => s.kind));
  if (kinds.size === 1 && kinds.has('human')) return 'human-hotseat';
  if (kinds.size === 1 && kinds.has('heuristic')) return 'heuristic';
  if (kinds.size === 1 && kinds.has('byok')) return 'byok';
  if (!kinds.has('human') && kinds.has('heuristic') && !kinds.has('byok')) return 'heuristic';
  if (!kinds.has('human') && kinds.has('byok') && !kinds.has('heuristic')) return 'byok';
  if (kinds.has('human') && kinds.size === 2 && kinds.has('heuristic')) return 'heuristic';
  if (kinds.has('human') && kinds.size === 2 && kinds.has('byok')) return 'byok';
  return 'mixed';
};

const asRecord = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

const stringOr = (o: Record<string, unknown>, key: string, fallback: string): string => {
  const value = o[key];
  return typeof value === 'string' ? value : fallback;
};

/** P72 Decision 1: absent → off; non-boolean `enabled` → off; a non-string field → its default. */
const parseAdvisor = (raw: unknown): AdvisorConfig => {
  const o = asRecord(raw);
  return {
    enabled: o['enabled'] === true,
    baseUrl: stringOr(o, 'baseUrl', DEFAULT_ADVISOR.baseUrl),
    apiKey: stringOr(o, 'apiKey', DEFAULT_ADVISOR.apiKey),
    model: stringOr(o, 'model', DEFAULT_ADVISOR.model),
  };
};

const parseByokFields = (raw: unknown): SeatByokFields => {
  const o = asRecord(raw);
  return {
    baseUrl: stringOr(o, 'baseUrl', DEFAULT_BYOK.baseUrl),
    apiKey: stringOr(o, 'apiKey', ''),
    model: stringOr(o, 'model', DEFAULT_BYOK.model),
    proxyUrl: stringOr(o, 'proxyUrl', ''),
    reasoning: o['reasoning'] !== false,
    useTurnRunner: o['useTurnRunner'] === true,
    turnRunnerUrl: stringOr(o, 'turnRunnerUrl', ''),
    advisor: parseAdvisor(o['advisor']),
  };
};

const parseSeat = (raw: unknown): SeatConfig | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const kind = o['kind'];
  if (kind !== 'human' && kind !== 'heuristic' && kind !== 'byok') return undefined;
  return { kind, byok: parseByokFields(o['byok']) };
};

export const loadSeatPlan = (): SeatPlan => {
  const store =
    typeof localStorage !== 'undefined'
      ? localStorage
      : typeof sessionStorage !== 'undefined'
        ? sessionStorage
        : undefined;
  if (store !== undefined) {
    try {
      const raw = store.getItem(SEAT_PLAN_STORAGE_KEY);
      if (raw !== null && raw !== '') {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          const o = parsed as Record<string, unknown>;
          const count = o['playerCount'];
          if (count === 3 || count === 6) {
            const seatsRaw = o['seats'];
            if (Array.isArray(seatsRaw)) {
              const seats = seatsRaw.map(parseSeat).filter((s): s is SeatConfig => s !== undefined);
              if (seats.length === count) return { playerCount: count, seats };
            }
          }
        }
      }
    } catch {
      // fall through
    }
  }

  // Migrate the older single-opponent BYOK blob onto seat B of a 3-player plan.
  const legacy = loadByokConfig();
  const plan = defaultSeatPlan(3);
  if (legacy.enabled || legacy.apiKey.trim().length > 0) {
    return updateSeat(plan, 1, {
      kind: legacy.enabled ? 'byok' : 'heuristic',
      byok: byokFieldsFromConfig(legacy),
    });
  }
  return plan;
};

export const saveSeatPlan = (plan: SeatPlan): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SEAT_PLAN_STORAGE_KEY, JSON.stringify(plan));
};
