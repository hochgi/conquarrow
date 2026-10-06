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

/**
 * Hydration reads a stored position back into a `GameState` and **refuses**
 * (returns `undefined`) anything the engine could not have written: a wrong
 * type, a value outside a range `packages/contracts/src/game-state.ts` states,
 * a player id that is not seated, or a keyed list naming the same key twice.
 * It never clamps, drops or defaults a field (P69).
 */

/** A seated-player test, built once per position from its `players`. */
type Seated = (id: unknown) => id is string;

const seatedIn = (players: readonly string[]): Seated => {
  const seats = new Set(players);
  return (id: unknown): id is string => typeof id === 'string' && seats.has(id);
};

/** A whole number no smaller than `min` — every count the contracts state. */
const isCount = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min;

const stringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined;
  return value as string[];
};

/** Turn order: "Length ≥ 2", each seat once. */
const hydratePlayers = (raw: unknown): PlayerId[] | undefined => {
  const ids = stringList(raw);
  if (ids === undefined || ids.length < 2 || new Set(ids).size !== ids.length) return undefined;
  return ids.map(mintPlayerId);
};

/**
 * A stored keyed list as the `Map` it was written from: one entry per key, so
 * a key seen twice — or any entry `entryOf` refuses — refuses the whole list.
 */
const hydrateKeyed = <K, V>(
  raw: unknown,
  entryOf: (rec: Record<string, unknown>) => readonly [K, V] | undefined,
): Map<K, V> | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const entries = new Map<K, V>();
  for (const item of raw) {
    const rec = asRecord(item);
    const entry = rec === undefined ? undefined : entryOf(rec);
    if (entry === undefined || entries.has(entry[0])) return undefined;
    entries.set(entry[0], entry[1]);
  }
  return entries;
};

/** `heads` at least 1, `spent` whole and ≥ 0, `speedOverride` absent or a `MergeOverride`. */
const groupEntry =
  (seated: Seated) =>
  (rec: Record<string, unknown>): readonly [ArrowId, Group] | undefined => {
    const arrow = rec['arrow'];
    const owner = rec['owner'];
    const heads = rec['heads'];
    const spent = rec['spent'];
    const speedOverride = rec['speedOverride'];
    if (typeof arrow !== 'string' || !seated(owner)) return undefined;
    if (!isCount(heads, 1) || !isCount(spent, 0)) return undefined;
    const group = { owner: mintPlayerId(owner), heads, spent };
    if (speedOverride === undefined) return [mintArrowId(arrow), group];
    if (speedOverride !== 0 && speedOverride !== 1) return undefined;
    return [mintArrowId(arrow), { ...group, speedOverride }];
  };

const trailEntry =
  (seated: Seated) =>
  (rec: Record<string, unknown>): readonly [PlayerId, Set<ArrowId>] | undefined => {
    const player = rec['player'];
    const arrows = stringList(rec['arrows']);
    if (!seated(player) || arrows === undefined) return undefined;
    return [mintPlayerId(player), new Set(arrows.map(mintArrowId))];
  };

const territoryEntry =
  (seated: Seated) =>
  (rec: Record<string, unknown>): readonly [ArrowId, PlayerId] | undefined => {
    const arrow = rec['arrow'];
    const owner = rec['owner'];
    if (typeof arrow !== 'string' || !seated(owner)) return undefined;
    return [mintArrowId(arrow), mintPlayerId(owner)];
  };

/**
 * A stored `num`/`den` pair as a rational, or `undefined` when it is not one.
 * Mirrors `rational`'s contract — integers, `den > 0`, never negative — so a
 * corrupt record is refused like every other malformed field instead of
 * throwing `ContractViolation` out of the parser.
 */
const rationalOf = (num: unknown, den: unknown): Rational | undefined => {
  if (!isCount(num, 0) || !isCount(den, 1)) return undefined;
  return rational(num, den);
};

const accumulatorEntry = (rec: Record<string, unknown>): readonly [ArrowId, Rational] | undefined => {
  const arrow = rec['arrow'];
  const value = rationalOf(rec['num'], rec['den']);
  if (typeof arrow !== 'string' || value === undefined) return undefined;
  return [mintArrowId(arrow), value];
};

/** `phase` is "0..2". */
const spawnerEntry = (rec: Record<string, unknown>): readonly [VertexId, Spawner] | undefined => {
  const vertex = rec['vertex'];
  const force = rationalOf(rec['num'], rec['den']);
  const phase = rec['phase'];
  if (typeof vertex !== 'string' || force === undefined) return undefined;
  if (!isCount(phase, 0) || phase > 2) return undefined;
  return [mintVertexId(vertex), { force, phase }];
};

/** A streak counts full rounds: whole and ≥ 0. */
const streakEntry =
  (seated: Seated) =>
  (rec: Record<string, unknown>): readonly [PlayerId, number] | undefined => {
    const player = rec['player'];
    const streak = rec['streak'];
    if (!seated(player) || !isCount(streak, 0)) return undefined;
    return [mintPlayerId(player), streak];
  };

/**
 * The clock a **pre-P36** snapshot carries, read off the retired
 * `dominationHolder` / `dominationStreak` pair.
 *
 * Dropping it would be a match outcome changed by omission: a seat persisted at
 * 4 of 5 would reload at 0 of 5 and get a free reprieve of up to `dominationN`
 * rounds. A streak of zero seeds nothing, because that is what absence already
 * means, and so does a pair with no holder id or no numeric streak (P36).
 *
 * A pair that *does* seed — a holder id and a streak > 0 — is held to the same
 * checks as a stored streak, a whole count for a seated holder, and refuses
 * the position otherwise (P69 BSSN 5): a ghost holder is unreadable, never a
 * clock for an unseated id.
 */
const seedStreaksFromRetiredPair = (
  rec: Record<string, unknown>,
  seated: Seated,
): Map<PlayerId, number> | undefined => {
  const holder = rec['dominationHolder'];
  const streak = rec['dominationStreak'];
  if (typeof holder !== 'string' || typeof streak !== 'number' || streak <= 0) {
    return new Map();
  }
  if (!seated(holder) || !Number.isInteger(streak)) return undefined;
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
const hydrateStreaks = (
  rec: Record<string, unknown>,
  seated: Seated,
): Map<PlayerId, number> | undefined => {
  const raw = rec['starvationStreaks'];
  if (raw === undefined) return seedStreaksFromRetiredPair(rec, seated);
  return hydrateKeyed(raw, streakEntry(seated));
};

type PositionMaps = Pick<
  GameState,
  'groups' | 'trails' | 'territory' | 'accumulators' | 'spawners' | 'starvationStreaks'
>;

const hydrateMaps = (rec: Record<string, unknown>, seated: Seated): PositionMaps | undefined => {
  const groups = hydrateKeyed(rec['groups'], groupEntry(seated));
  const trails = hydrateKeyed(rec['trails'], trailEntry(seated));
  const territory = hydrateKeyed(rec['territory'], territoryEntry(seated));
  const accumulators = hydrateKeyed(rec['accumulators'], accumulatorEntry);
  const spawners = hydrateKeyed(rec['spawners'], spawnerEntry);
  const starvationStreaks = hydrateStreaks(rec, seated);
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
  return { groups, trails, territory, accumulators, spawners, starvationStreaks };
};

/** `winner` is absent or a seated id; `{ winner }` when it reads, `undefined` when refused. */
const winnerOf = (
  raw: unknown,
  seated: Seated,
): { readonly winner: PlayerId | undefined } | undefined => {
  if (raw === undefined) return { winner: undefined };
  return seated(raw) ? { winner: mintPlayerId(raw) } : undefined;
};

/**
 * `players` is read first: every other player id in the position is checked
 * against it. `dominationN` is a threshold of full rounds — at least 1 (P69).
 */
export const hydrateState = (value: unknown): GameState | undefined => {
  const rec = asRecord(value);
  if (rec === undefined) return undefined;
  const players = hydratePlayers(rec['players']);
  if (players === undefined) return undefined;
  const seated = seatedIn(players);
  const activePlayer = rec['activePlayer'];
  const dominationN = rec['dominationN'];
  const winner = winnerOf(rec['winner'], seated);
  if (!seated(activePlayer) || !isCount(dominationN, 1) || winner === undefined) return undefined;
  const maps = hydrateMaps(rec, seated);
  if (maps === undefined) return undefined;
  return {
    players,
    activePlayer: mintPlayerId(activePlayer),
    ...maps,
    dominationN,
    winner: winner.winner,
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
