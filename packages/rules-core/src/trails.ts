/**
 * Trails and crossings.
 *
 * SPEC §5 (safety rule; branching is free under P22), §6.1a (a trail is a set,
 * all-to-all points), §6.1 (anchor grades, including legal dormant), §2 (the
 * chord test). P05 decisions D1–D9; P22 withdraws the branch toll.
 *
 * Purity applies from the first line: no clock, no randomness, no I/O, no mutation
 * of an input state. The realistic risk here is not `Math.random` but **iteration
 * order** — a trail is a `Set` and a chord list is an ordered answer derived from
 * one, which is the exact shape ADR 0001 warns about. Two habits keep it out:
 *
 * - Every list of trail arrows is read off `GeometryPort` and *filtered* by the
 *   set, never iterated from it. The port's order is authored and stable, so a
 *   chord list is a function of the board rather than of how a test happened to
 *   build its state.
 * - Every trail set this file returns is rebuilt **sorted**, unconditionally.
 *   Iteration order is observable, so two states that differ only in insertion
 *   order would otherwise yield outputs that differ only in iteration order —
 *   which passes every unit test and surfaces as replay drift.
 *
 * Nothing here reads a vertex. A special is owned in thirds by its three bordering
 * arrows (§7, §11 item 34), so vertex ownership is a *reading* of tile ownership,
 * and this packet owns no tiles.
 *
 * @see docs/spec/trails/trails.md
 * @see docs/spec/crossings/crossings.md
 */

import { ContractViolation, chord, chordsCross, chordsInterleave } from '@conquarrow/contracts';
import type {
  AnchorGrade,
  ArrowId,
  Chord,
  GameState,
  GeometryPort,
  PlayerId,
  PointId,
  StepMove,
  Traversal,
} from '@conquarrow/contracts';
import { compareArrows } from './order';
import { stretchGrade, stretchOf } from './stretch';

/**
 * Refuse. Local rather than imported for the same reason as in `movement.ts`:
 * `reject` is internal to `@conquarrow/contracts` and the error *type* is the public
 * part of it.
 */
const reject = (message: string): never => {
  throw new ContractViolation(message);
};

/** A player with no trail. Shared so the empty case allocates nothing and reads once. */
const NO_TRAIL: ReadonlySet<ArrowId> = new Set<ArrowId>();

/** The `RulesPort` trail methods P05 adds, plus the mark hook `apply` needs. */
export interface TrailRules {
  /**
   * The trail after a step has landed: the destination is marked unless it is
   * already the mover's own territory (§5, P05 D3).
   */
  readonly markStep: (state: GameState, move: StepMove, mover: PlayerId) => GameState['trails'];
  readonly trailChordsAt: (
    state: GameState,
    point: PointId,
    player: PlayerId,
  ) => readonly Chord[];
  readonly crossesTrail: (state: GameState, traversal: Traversal, victim: PlayerId) => boolean;
  readonly selfCrosses: (state: GameState, traversal: Traversal, mover: PlayerId) => boolean;
  readonly anchorGrade: (state: GameState, arrow: ArrowId, player: PlayerId) => AnchorGrade;
}

/**
 * Build the trail rules over a board.
 *
 * The board arrives as a `GeometryPort` and nothing else, so `slotOf` is asked for
 * every chord endpoint rather than inferred from an arrow id — which is the one
 * thing that would pass on the generated tiling and fail on a fixture.
 */
export const makeTrailRules = (geometry: GeometryPort): TrailRules => {
  const trailOf = (state: GameState, player: PlayerId): ReadonlySet<ArrowId> =>
    state.trails.get(player) ?? NO_TRAIL;

  /** A set rebuilt in arrow-id order, deduplicated — a trail is a set (§6.1a). */
  const canonical = (arrows: readonly ArrowId[]): ReadonlySet<ArrowId> =>
    new Set([...new Set(arrows)].toSorted(compareArrows));

  // ── marking ────────────────────────────────────────────────────────────────

  /**
   * What a step marks: the **destination**, unless the destination is already the
   * mover's own territory (§5's safety rule, P05 D3).
   *
   * One test on one arrow covers every combination without a case analysis —
   * territory → territory marks nothing, territory → neutral starts a trail,
   * trail → neutral extends it, trail → own territory marks nothing, and stepping
   * onto your own trail adds nothing because a set holds no duplicates. Enemy
   * territory is *not* exempt: it is hostile ground, enterable and exposing (§7).
   *
   * **The closure seam lives on the `undefined` branch.** Landing on your own
   * territory while trailing is a closure (§7) and P05 does not implement one: the
   * trail stays open and nothing is claimed. That is deliberately visible rather
   * than approximated — a closure that claimed "the path only" would look like
   * §7's land bridge and be wrong in every case that encloses something (P05 D8).
   */
  const marked = (state: GameState, move: StepMove, mover: PlayerId): ArrowId | undefined =>
    state.territory.get(move.exit) === mover ? undefined : move.exit;

  const markStep = (state: GameState, move: StepMove, mover: PlayerId): GameState['trails'] => {
    const addition = marked(state, move, mover);
    const rebuilt = new Map<PlayerId, ReadonlySet<ArrowId>>();
    for (const [player, arrows] of state.trails) {
      rebuilt.set(
        player,
        canonical(player === mover && addition !== undefined ? [...arrows, addition] : [...arrows]),
      );
    }
    if (addition !== undefined && !rebuilt.has(mover)) {
      rebuilt.set(mover, canonical([addition]));
    }
    return rebuilt;
  };

  // ── chords ─────────────────────────────────────────────────────────────────

  /**
   * The chord two arrows draw at a point, both endpoints asked of `slotOf`.
   *
   * Never inferred from an identifier: ids are opaque (P01 D1), and an engine that
   * parsed one would pass on the generated tiling and fail on a fixture — which is
   * the whole reason the port exposes `slotOf` rather than an opaque verdict (D9).
   */
  const chordAt = (point: PointId, into: ArrowId, out: ArrowId): Chord =>
    chord(geometry.slotOf(point, into), geometry.slotOf(point, out));

  /**
   * A player's trail chords at a point — **`i × o` of them**, one per (trail
   * in-arrow, trail out-arrow) pair (§2, §6.1a).
   *
   * No pairing is recovered because the set holds none (§11 item 26): the point
   * simply *is* a join followed by a split, every in feeding every out. Reading the
   * two sides off the port and filtering by the trail — rather than iterating the
   * trail — is what makes the order a fact about the board.
   */
  const trailChordsAt = (
    state: GameState,
    point: PointId,
    player: PlayerId,
  ): readonly Chord[] => {
    const trail = trailOf(state, player);
    const ins = geometry.inArrows(point).filter((a) => trail.has(a));
    const outs = geometry.outArrows(point).filter((a) => trail.has(a));
    return ins.flatMap((into) => outs.map((out) => chordAt(point, into, out)));
  };

  /**
   * The point a traversal transits, and the one chord it draws there.
   *
   * A traversal that does not follow the grain is not a traversal, and answering
   * `false` would hide the caller's bug rather than report it (P04 D9).
   */
  const transit = (traversal: Traversal): { point: PointId; drawn: Chord } => {
    const point = geometry.target(traversal.from);
    if (!geometry.outArrows(point).includes(traversal.exit)) {
      reject(
        `${String(traversal.exit)} is not an out-arrow of the point ${String(traversal.from)} transits — movement follows the grain`,
      );
    }
    return { point, drawn: chordAt(point, traversal.from, traversal.exit) };
  };

  /**
   * Every chord the trail presents, not only the first — the failure the crossings
   * suite exists to catch. An engine that tested one chord passes every spine and
   * quietly fails every knot.
   */
  const crosses = (
    state: GameState,
    traversal: Traversal,
    player: PlayerId,
    predicate: (ours: Chord, theirs: Chord) => boolean,
  ): boolean => {
    const { point, drawn } = transit(traversal);
    return trailChordsAt(state, point, player).some((theirs) => predicate(drawn, theirs));
  };

  // ── anchor grade ───────────────────────────────────────────────────────────

  /**
   * What holds a stretch of trail live (§6.1, P05 D7).
   *
   * Connectivity over the trail set is **undirected** — two trail arrows are one
   * stretch when they share a point, whichever way either points. §7's pincer says
   * outright that enclosure is a property of the curve and not of the flow along
   * it, and §6.1 re-attaches a fragment by laying a fresh path *to* it, against the
   * direction the fragment was laid; a grade computed along the grain refuses both.
   *
   * **What counts as reaching territory is the departure**, and that is directional
   * because §7 makes it so: a closure is *departing your own territory and landing
   * back on it*, so the anchor a trail rests on is the ground it left. §6.1 says the
   * same from the other side — a deep cut takes "the region touching the victim's
   * territory" and everything beyond it survives with "the territory anchor gone",
   * which is only a demotion if the anchor was the departure. So a stretch is
   * territory grade only while some arrow of it leaves a point a clean feeder
   * feeds (§6.1), and re-attachment (§6.1) is the ordinary case of that:
   * lay a road from home to the fragment and the whole component is promoted.
   *
   * A trail that merely *runs into* territory it never left is **stack grade** —
   * §6.3 is explicit that a raider's trail does not earn a territory anchor however
   * well it is garrisoned, and stack grade is exactly "drivable home for a land
   * bridge, encloses nothing".
   *
   * The flood's visit order is not observable: both answers are existence questions
   * over a connected component, and a component does not depend on how it was walked.
   * The flood and the grading live in `stretch.ts`, shared with the closure strip (P87).
   */
  const anchorGrade = (state: GameState, arrow: ArrowId, player: PlayerId): AnchorGrade => {
    const trail = trailOf(state, player);
    if (!trail.has(arrow)) {
      reject(
        `${String(arrow)} is not in ${String(player)}'s trail, so it has no anchor grade`,
      );
    }
    return stretchGrade(geometry, state, stretchOf(geometry, trail, arrow), player);
  };

  return {
    markStep,
    trailChordsAt,
    /**
     * The **full** verdict — interleave or coincide — which §6.1's cut and §6.2's
     * combat both take. SPEC §2's coincide is the tile rule: the exit *is* one of
     * the victim's trail arrows. That holds even when the trail presents no chord
     * at the point (a stub out, `i = 0`), which `i × o` extraction alone would miss.
     * Self-crossing stays interleave-only — re-traversing your own arrow must not
     * invert fill.
     */
    crossesTrail: (state, traversal, victim) =>
      trailOf(state, victim).has(traversal.exit) ||
      crosses(state, traversal, victim, chordsCross),
    /**
     * The **narrow** verdict — interleave only — which §7's even-odd takes.
     * Coincidence cannot invert anything: re-traversing an arrow already in the set
     * leaves the set unchanged (§6.1a), so there is nothing for fill to flip.
     */
    selfCrosses: (state, traversal, mover) => crosses(state, traversal, mover, chordsInterleave),
    anchorGrade,
  };
};
