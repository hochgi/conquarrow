/**
 * Playtest seat roster — who sits where, and how each chair is driven.
 *
 * Restricted to 3 or 6: those counts sit on the tiling's order-3 rotational
 * symmetry (SPEC §2), so every home has the same grain relationship to the
 * centre. Two-player mirror play felt directionally unfair in local BYOK tests.
 */

import { mintPlayerId, type PlayerId } from '@conquarrow/contracts';
import {
  DEFAULT_BYOK,
  isByokReady,
  loadByokConfig,
  type ByokConfig,
} from './byokConfig';

export const SEAT_PLAN_STORAGE_KEY = 'conquarrow:seat-plan';

/** Playtest lobby only offers rotationally fair counts. */
export const PLAYTEST_PLAYER_COUNTS = [3, 6] as const;
export type PlaytestPlayerCount = (typeof PLAYTEST_PLAYER_COUNTS)[number];

/** How a seat is driven in a match (local play, logs, banners). */
export type SeatKind = 'human' | 'heuristic' | 'byok' | 'agent';

/**
 * A lobby pick (P106): a driver kind, or one of the online-only choices
 * `creator` (Player (you)) and `creator-agent` (Agent (yours)).
 */
export type LobbySeatKind = SeatKind | 'creator' | 'creator-agent';

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
}

export interface SeatConfig {
  readonly kind: LobbySeatKind;
  /** Edited whenever kind is byok; ignored otherwise. */
  readonly byok: SeatByokFields;
}

/** A seat as a match drives it: the lobby pick mapped by `driverSeat`. */
export interface DriverSeatConfig extends Omit<SeatConfig, 'kind'> {
  readonly kind: SeatKind;
}

/** P106: `creator` drives as `human`, `creator-agent` as `agent`; every other kind as itself. */
export const driverSeat = (seat: SeatConfig): DriverSeatConfig => {
  if (seat.kind === 'creator') return { ...seat, kind: 'human' };
  if (seat.kind === 'creator-agent') return { ...seat, kind: 'agent' };
  return { ...seat, kind: seat.kind };
};

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
});

export const byokFieldsFromConfig = (config: ByokConfig): SeatByokFields => ({
  baseUrl: config.baseUrl,
  apiKey: config.apiKey,
  model: config.model,
  proxyUrl: config.proxyUrl,
  reasoning: config.reasoning,
  useTurnRunner: config.useTurnRunner,
  turnRunnerUrl: config.turnRunnerUrl,
});

export const byokConfigForSeat = (seat: SeatConfig): ByokConfig => ({
  enabled: seat.kind === 'byok',
  ...seat.byok,
});

export const defaultSeat = (kind: LobbySeatKind = 'heuristic'): SeatConfig => ({
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

const hasAgentChair = (plan: SeatPlan): boolean =>
  plan.seats.some((seat) => seat.kind === 'agent' || seat.kind === 'creator-agent');

/**
 * Local → Online: seats 0 and 1 become `human` unless an agent chair is
 * already there. Never picks `creator`: the creator picks their own seat (P106).
 */
export const coerceOnlineSeatPlan = (plan: SeatPlan): SeatPlan => ({
  playerCount: plan.playerCount,
  seats: plan.seats.map((seat, index) => {
    if (!hasAgentChair(plan) && (index === 0 || index === 1)) return { ...seat, kind: 'human' };
    if (seat.kind === 'byok') return { ...seat, kind: 'heuristic' };
    return seat;
  }),
});

/** P106, Online → Local: `creator` → `human`; both agent choices → `heuristic`. */
export const coerceLocalSeatPlan = (plan: SeatPlan): SeatPlan => ({
  playerCount: plan.playerCount,
  seats: plan.seats.map((seat) => {
    if (seat.kind === 'creator') return { ...seat, kind: 'human' };
    if (seat.kind === 'agent' || seat.kind === 'creator-agent') return { ...seat, kind: 'heuristic' };
    return seat;
  }),
});

/**
 * P106: one online pick. `creator` moves Player (you): the seat that held it
 * becomes `human`. Any other pick changes only that seat; none is refused.
 */
export const pickOnlineSeat = (plan: SeatPlan, index: number, kind: LobbySeatKind): SeatPlan => ({
  playerCount: plan.playerCount,
  seats: plan.seats.map((seat, i) => {
    if (i === index) return { ...seat, kind };
    if (kind === 'creator' && seat.kind === 'creator') return { ...seat, kind: 'human' };
    return seat;
  }),
});

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

const parseSeat = (raw: unknown): SeatConfig | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const kind = o['kind'];
  if (kind !== 'human' && kind !== 'heuristic' && kind !== 'byok') return undefined;
  const byokRaw = o['byok'];
  const byokObj =
    typeof byokRaw === 'object' && byokRaw !== null
      ? (byokRaw as Record<string, unknown>)
      : {};
  return {
    kind,
    byok: {
      baseUrl: typeof byokObj['baseUrl'] === 'string' ? byokObj['baseUrl'] : DEFAULT_BYOK.baseUrl,
      apiKey: typeof byokObj['apiKey'] === 'string' ? byokObj['apiKey'] : '',
      model: typeof byokObj['model'] === 'string' ? byokObj['model'] : DEFAULT_BYOK.model,
      proxyUrl: typeof byokObj['proxyUrl'] === 'string' ? byokObj['proxyUrl'] : '',
      reasoning: byokObj['reasoning'] !== false,
      useTurnRunner: byokObj['useTurnRunner'] === true,
      turnRunnerUrl:
        typeof byokObj['turnRunnerUrl'] === 'string' ? byokObj['turnRunnerUrl'] : '',
    },
  };
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
