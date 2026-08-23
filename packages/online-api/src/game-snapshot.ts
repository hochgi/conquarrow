import type {
  ArrowId,
  GameState,
  Group,
  MergeOverride,
  PlayerId,
  Rational,
  Spawner,
  VertexId,
} from '@conquarrow/contracts';
import { mintArrowId, mintPlayerId, mintVertexId, rational } from '@conquarrow/contracts';
import { compareStrings } from './hashing';
import { asRecord } from './invite-record';

export type StateSnapshot = {
  readonly players: readonly string[];
  readonly activePlayer: string;
  readonly groups: readonly {
    readonly arrow: string;
    readonly owner: string;
    readonly heads: number;
    readonly spent: number;
    readonly speedOverride?: MergeOverride;
  }[];
  readonly trails: readonly { readonly player: string; readonly arrows: readonly string[] }[];
  readonly territory: readonly { readonly arrow: string; readonly owner: string }[];
  readonly accumulators: readonly {
    readonly arrow: string;
    readonly num: number;
    readonly den: number;
  }[];
  readonly spawners: readonly {
    readonly vertex: string;
    readonly num: number;
    readonly den: number;
    readonly phase: number;
  }[];
  readonly starvationStreaks: readonly {
    readonly player: string;
    readonly streak: number;
  }[];
  readonly dominationN: number;
  readonly winner?: string;
};

export const snapshotState = (state: GameState): StateSnapshot => {
  const snap: {
    players: readonly string[];
    activePlayer: string;
    groups: StateSnapshot['groups'];
    trails: StateSnapshot['trails'];
    territory: StateSnapshot['territory'];
    accumulators: StateSnapshot['accumulators'];
    spawners: StateSnapshot['spawners'];
    starvationStreaks: StateSnapshot['starvationStreaks'];
    dominationN: number;
    winner?: string;
  } = {
    players: [...state.players].map(String),
    activePlayer: String(state.activePlayer),
    groups: [...state.groups.entries()]
      .map(([arrow, group]) =>
        group.speedOverride === undefined
          ? {
              arrow: String(arrow),
              owner: String(group.owner),
              heads: group.heads,
              spent: group.spent,
            }
          : {
              arrow: String(arrow),
              owner: String(group.owner),
              heads: group.heads,
              spent: group.spent,
              speedOverride: group.speedOverride,
            },
      )
      .toSorted((left, right) => compareStrings(left.arrow, right.arrow)),
    trails: [...state.trails.entries()]
      .map(([player, arrows]) => ({
        player: String(player),
        arrows: [...arrows].map(String).toSorted(),
      }))
      .toSorted((left, right) => compareStrings(left.player, right.player)),
    territory: [...state.territory.entries()]
      .map(([arrow, owner]) => ({ arrow: String(arrow), owner: String(owner) }))
      .toSorted((left, right) => compareStrings(left.arrow, right.arrow)),
    accumulators: [...state.accumulators.entries()]
      .map(([arrow, r]) => ({ arrow: String(arrow), num: r.num, den: r.den }))
      .toSorted((left, right) => compareStrings(left.arrow, right.arrow)),
    spawners: [...state.spawners.entries()]
      .map(([vertex, spawner]) => ({
        vertex: String(vertex),
        num: spawner.force.num,
        den: spawner.force.den,
        phase: spawner.phase,
      }))
      .toSorted((left, right) => compareStrings(left.vertex, right.vertex)),
    starvationStreaks: [...state.starvationStreaks.entries()]
      .map(([player, streak]) => ({ player: String(player), streak }))
      .toSorted((left, right) => compareStrings(left.player, right.player)),
    dominationN: state.dominationN,
  };
  if (state.winner !== undefined) {
    snap.winner = String(state.winner);
  }
  return snap;
};

export const persistEnvelope = (version: number, state: GameState): string =>
  JSON.stringify({ version, state: snapshotState(state) });

const stringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined;
  return value as string[];
};

const mergeOverrideOf = (value: unknown): MergeOverride | undefined => {
  if (value === 0 || value === 1) return value;
  return undefined;
};

const hydrateGroups = (raw: unknown): Map<ArrowId, Group> | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const groups = new Map<ArrowId, Group>();
  for (const item of raw) {
    const rec = asRecord(item);
    if (rec === undefined) return undefined;
    const arrow = rec['arrow'];
    const owner = rec['owner'];
    const heads = rec['heads'];
    const spent = rec['spent'];
    if (typeof arrow !== 'string' || typeof owner !== 'string') return undefined;
    if (typeof heads !== 'number' || typeof spent !== 'number') return undefined;
    const speedOverride = mergeOverrideOf(rec['speedOverride']);
    groups.set(
      mintArrowId(arrow),
      speedOverride === undefined
        ? { owner: mintPlayerId(owner), heads, spent }
        : { owner: mintPlayerId(owner), heads, spent, speedOverride },
    );
  }
  return groups;
};

const hydrateTrails = (raw: unknown): Map<PlayerId, Set<ArrowId>> | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const trails = new Map<PlayerId, Set<ArrowId>>();
  for (const item of raw) {
    const rec = asRecord(item);
    if (rec === undefined) return undefined;
    const player = rec['player'];
    const arrows = stringList(rec['arrows']);
    if (typeof player !== 'string' || arrows === undefined) return undefined;
    trails.set(mintPlayerId(player), new Set(arrows.map(mintArrowId)));
  }
  return trails;
};

const hydrateTerritory = (raw: unknown): Map<ArrowId, PlayerId> | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const territory = new Map<ArrowId, PlayerId>();
  for (const item of raw) {
    const rec = asRecord(item);
    if (rec === undefined) return undefined;
    const arrow = rec['arrow'];
    const owner = rec['owner'];
    if (typeof arrow !== 'string' || typeof owner !== 'string') return undefined;
    territory.set(mintArrowId(arrow), mintPlayerId(owner));
  }
  return territory;
};

const hydrateAccumulators = (raw: unknown): Map<ArrowId, Rational> | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const accumulators = new Map<ArrowId, Rational>();
  for (const item of raw) {
    const rec = asRecord(item);
    if (rec === undefined) return undefined;
    const arrow = rec['arrow'];
    const num = rec['num'];
    const den = rec['den'];
    if (typeof arrow !== 'string' || typeof num !== 'number' || typeof den !== 'number') {
      return undefined;
    }
    accumulators.set(mintArrowId(arrow), rational(num, den));
  }
  return accumulators;
};

const hydrateSpawners = (raw: unknown): Map<VertexId, Spawner> | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const spawners = new Map<VertexId, Spawner>();
  for (const item of raw) {
    const rec = asRecord(item);
    if (rec === undefined) return undefined;
    const vertex = rec['vertex'];
    const num = rec['num'];
    const den = rec['den'];
    const phase = rec['phase'];
    if (typeof vertex !== 'string' || typeof num !== 'number') return undefined;
    if (typeof den !== 'number' || typeof phase !== 'number') return undefined;
    spawners.set(mintVertexId(vertex), { force: rational(num, den), phase });
  }
  return spawners;
};

/**
 * The clock a **pre-P36** snapshot carries, read off the retired
 * `dominationHolder` / `dominationStreak` pair.
 *
 * Dropping it would be a match outcome changed by omission: a seat persisted at
 * 4 of 5 would reload at 0 of 5 and get a free reprieve of up to `dominationN`
 * rounds. A streak of zero seeds nothing, because that is what absence already
 * means.
 */
const seedStreaksFromRetiredPair = (rec: Record<string, unknown>): Map<PlayerId, number> => {
  const holder = rec['dominationHolder'];
  const streak = rec['dominationStreak'];
  if (typeof holder !== 'string' || typeof streak !== 'number' || streak <= 0) {
    return new Map();
  }
  return new Map([[mintPlayerId(holder), streak]]);
};

/**
 * P36: `starvationStreaks` replaces the `dominationStreak` / `dominationHolder`
 * pair. **Absent is accepted as empty** — "absent means zero" is the field's own
 * semantics, so a snapshot written without the field still loads — *unless* the
 * retired pair is there with a live streak, in which case the clock is seeded
 * from it ({@link seedStreaksFromRetiredPair}).
 *
 * The shape of the record is the only thing to read here: the envelope's
 * `version` is the optimistic-concurrency revision (`game-handlers.ts`), not a
 * schema version, so it cannot gate a migration.
 */
const hydrateStreaks = (rec: Record<string, unknown>): Map<PlayerId, number> | undefined => {
  const raw = rec['starvationStreaks'];
  if (raw === undefined) return seedStreaksFromRetiredPair(rec);
  if (!Array.isArray(raw)) return undefined;
  const streaks = new Map<PlayerId, number>();
  for (const item of raw) {
    const entry = asRecord(item);
    if (entry === undefined) return undefined;
    const player = entry['player'];
    const streak = entry['streak'];
    if (typeof player !== 'string' || typeof streak !== 'number') return undefined;
    streaks.set(mintPlayerId(player), streak);
  }
  return streaks;
};

export const hydrateState = (value: unknown): GameState | undefined => {
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  const playersRaw = stringList(rec['players']);
  const activePlayer = rec['activePlayer'];
  const dominationN = rec['dominationN'];
  if (playersRaw === undefined || typeof activePlayer !== 'string') return undefined;
  if (typeof dominationN !== 'number') return undefined;
  const starvationStreaks = hydrateStreaks(rec);
  const groups = hydrateGroups(rec['groups']);
  const trails = hydrateTrails(rec['trails']);
  const territory = hydrateTerritory(rec['territory']);
  const accumulators = hydrateAccumulators(rec['accumulators']);
  const spawners = hydrateSpawners(rec['spawners']);
  if (
    groups === undefined ||
    trails === undefined ||
    territory === undefined ||
    accumulators === undefined ||
    spawners === undefined ||
    starvationStreaks === undefined
  ) {
    return undefined;
  }
  const winnerRaw = rec['winner'];
  return {
    players: playersRaw.map(mintPlayerId),
    activePlayer: mintPlayerId(activePlayer),
    groups,
    trails,
    territory,
    accumulators,
    spawners,
    starvationStreaks,
    dominationN,
    winner: typeof winnerRaw === 'string' ? mintPlayerId(winnerRaw) : undefined,
  };
};

export const parsePersistedEnvelope = (
  raw: string,
): { readonly version: number; readonly state: unknown; readonly game: GameState } | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(parsed);
  if (rec === undefined) return undefined;
  const version = rec['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return undefined;
  const game = hydrateState(rec['state']);
  if (game === undefined) return undefined;
  return { version, state: rec['state'], game };
};
