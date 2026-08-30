/**
 * The board state the movement rules read.
 *
 * SPEC §3 (heads, stacks, allowance and spending), §4 (turn structure). P04
 * decisions D1, D3 and D4.
 *
 * Data and nothing else — no method, no derivation, no board. Geometry stays on
 * `GeometryPort` and every rule stays on `RulesPort`, so a state can be
 * hand-authored by a test (P04 D8) without dragging an engine in with it.
 *
 * P01 deliberately deferred this: a state shape guessed before a rule needed it
 * would have invented trails, territory and closure in type form. What is here
 * is exactly what movement (P04) and trails (P05) read. Later packets grow it — an
 * accumulator per arrow and authored spawners (P08) — and the absence of those
 * fields before P08 was a statement about scope, not an oversight.
 *
 * @see docs/spec/movement/movement.md
 * @see docs/spec/trails/trails.md
 */

import type { ArrowId, PlayerId, VertexId } from './ids';
import type { Rational } from './rational';

/**
 * The §3 price of merging mid-turn, as a speed override for the rest of the turn.
 *
 * `1` for a stack that merged; `0` once **any** group that arrived outnumbered
 * what it joined. Absent means no merge touched the group this turn and its
 * allowance is plain `speed(heads)`.
 *
 * Two values, because §3 prices exactly two cases. A third would be a merge cost
 * the spec does not state. Expressed as an override rather than a special case so
 * that allowance arithmetic stays `spent < effectiveSpeed` everywhere (P04 D4).
 */
export type MergeOverride = 0 | 1;

/**
 * An authored spawner on a vertex (§7). Force and initial phase are setup data
 * (P09 owns the radial table; tests author these directly).
 *
 * `phase` is the index into the vertex's bordering arrows sorted by arrow id —
 * the round-robin cursor (P08 / §11 item 41).
 */
export interface Spawner {
  readonly force: Rational;
  /** 0..2 into `borderArrows(vertex)` sorted by {@link ArrowId}. */
  readonly phase: number;
}

/**
 * A **group**: the heads of one player standing on one arrow (§3).
 *
 * Allowance belongs to the group — not to a head, not to a player — which is why
 * `spent` lives here and not beside `activePlayer`. There is no group identity:
 * a group is *whatever* stands on an arrow right now, so splitting and merging
 * need no births and deaths, only counts (§4, SPEC §11 item 21).
 */
export interface Group {
  readonly owner: PlayerId;
  /**
   * Stack size **is** lives (§3). At least 1 — an arrow holding zero heads is
   * absent from {@link GameState.groups}, not present with a zero.
   */
  readonly heads: number;
  /**
   * Whole steps this group has already taken this turn. Nothing banks: end-turn
   * zeroes it (§3, SPEC §11 item 20).
   */
  readonly spent: number;
  /**
   * Set only by a merge, and only for the rest of the turn (§3). Absent is the
   * ordinary case and means `speed(heads)`. Spawn births do **not** set this
   * (§11 item 41).
   */
  readonly speedOverride?: MergeOverride;
}

/**
 * A whole position: who is to move, and what stands where.
 *
 * Immutable, and `apply` returns a new one (ADR 0001, P01 D5). There is no move
 * log here — a turn is an ordered list of `Move`s held by whatever is replaying
 * it (P10), not state the rules read.
 */
export interface GameState {
  /**
   * Players in turn order (§4). Length ≥ 2. `players[0]` is the full-round
   * marker **whether or not that seat is still playing** (P08, P36): the array is
   * never mutated or reordered, because moving the marker would move or destroy
   * the boundary, and if the removed seat were `players[0]` accrual would stop
   * forever. A seat that is out stays in the rotation and is passed. Setup places
   * them on a hexagon about the origin (§2 / §8).
   */
  readonly players: readonly PlayerId[];
  /** Whose turn it is. Only this player's groups may step (§4). */
  readonly activePlayer: PlayerId;
  /**
   * Occupancy: at most one owner per arrow (P04 D1). An arrow absent from the map
   * is **empty**; an arrow held by the other player is **enemy-occupied**. There
   * is no contested-occupancy shape in P04 — that arrives with combat (P06).
   */
  readonly groups: ReadonlyMap<ArrowId, Group>;
  /**
   * **A trail is a set of arrows** (SPEC §6.1a) — per player, because two of them
   * may mark the same arrow.
   *
   * A set and not a list, tree or walk: nothing records the order it was laid,
   * which heads laid it, or how often one has walked it. Every question the rules
   * ask of a trail — where evaporation stops, whether a crossing happened, what is
   * enclosed, what is still anchored, whether a branch was paid for — is
   * answerable from this plus {@link GameState.groups}. That is load-bearing, not
   * frugal: it is what removes head identity from the engine, and it is why none
   * of §6.1's rules need a resolution order.
   *
   * **Overlap is permitted.** Stepping onto an arrow an enemy trail holds is a
   * crossing (§2, *coincide*), which is legal; what it destroys is P06's. Until
   * evaporation exists the arrow simply stays in both sets, so the type has to
   * allow it either way.
   *
   * Iterate this only through a sorted key. ADR 0001 names ordering, not
   * randomness, as the realistic determinism failure, and a `Set` is exactly where
   * it hides (P05 D1).
   */
  readonly trails: ReadonlyMap<PlayerId, ReadonlySet<ArrowId>>;
  /**
   * Closed ground: **one owner per arrow** (§7). An arrow absent from this map is
   * unclaimed.
   *
   * One owner rather than a set per player, because territory changes hands rather
   * than being shared — an enemy closing a loop inside your land carves that chunk
   * out (§7, *territory is contestable*). A **vertex** is not here at all: a
   * special is owned in thirds by its three bordering arrows (§7, §11 item 34), so
   * vertex ownership is a *reading* of this map and never a second copy of it.
   */
  readonly territory: ReadonlyMap<ArrowId, PlayerId>;
  /**
   * Per-arrow production counters (§7). Absent means {@link ZERO}. Reset to
   * zero when the arrow's territory owner changes (capture). Exact rationals
   * only — never float (ADR 0001).
   */
  readonly accumulators: ReadonlyMap<ArrowId, Rational>;
  /**
   * Spawners on vertices, keyed by vertex. Empty until setup (P09) or a test
   * authors them. Accrual ticks once per full round (§11 item 41).
   */
  readonly spawners: ReadonlyMap<VertexId, Spawner>;
  /**
   * Consecutive full rounds each destitute seat has owned **zero** spawner
   * shares (§9 starvation / P36). Absent means zero.
   *
   * **Per seat**, because the single holder/streak pair P09 carried cannot
   * express two broke players: it advanced only while *exactly one* seat was
   * destitute, so two of them cancelled each other's clocks indefinitely
   * (§11 item 32).
   *
   * A streak is *history* and history is not derivable, which is why this is the
   * only field the losing rule stores. Whether a seat is **lost** is derived from
   * the board — `territoryCount === 0 || (shares === 0 && heads === 0)` — and a
   * flag would be a second copy of something the board already says.
   *
   * Iterate it through {@link players}, never through its own key order: it is a
   * `Map` feeding an ordered decision, which is exactly where ADR 0001's
   * determinism failure hides.
   */
  readonly starvationStreaks: ReadonlyMap<PlayerId, number>;
  /** Starvation threshold *N* (full rounds). Setup data — default 5 (P09). */
  readonly dominationN: number;
  /**
   * Match outcome — the last seat **not lost** (§9, P36). Absent while two or
   * more seats remain.
   *
   * Absent also covers the terminal-but-unwon board a boundary that removes
   * every remaining seat leaves behind. That is **SPEC §11 item 44** and it is
   * recorded as wrong rather than fixed here: `PlayerId | undefined` cannot say
   * "over, nobody won", and picking a representation is a game decision.
   */
  readonly winner: PlayerId | undefined;
}
