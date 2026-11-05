/**
 * Closure and fill.
 *
 * SPEC §7 (closure, *which arrows the landing claims*, the land bridge, the pincer,
 * territory is contestable), §6.1a (a trail is a set, all-to-all points), §2 (the
 * chord test), §11 items 16, 34, 36. P05b decisions D1–D9.
 *
 * Two passes, and keeping them apart is the point (§11 item 36):
 *
 * 1. **The claim** — follow the trail backwards along the grain from the closing
 *    arrow until territory, or until an arrow with no trail predecessor (the stack
 *    anchor the trail starts from). Everything reached is claimed; nothing
 *    downstream is, which is what leaves a fork's other arm open.
 * 2. **The pocket** — with the path now the player's ground, any arrow from which no
 *    walk escapes is enclosed. **Not even-odd.** A claim is bounded by the trail on
 *    one side and by existing territory on the other, so it is not a closed curve to
 *    take a parity of; item 36 has the whole argument.
 *
 * Purity applies from the first line. The realistic risk here is not `Math.random`
 * but **iteration order**: the claim and the pocket are both ordered answers derived
 * from a `Set`, and the sweep enumerates a `window()` as well. Every returned list is
 * sorted on a total key.
 *
 * Nothing here enumerates a vertex. A special's ownership is a *reading* of its three
 * bordering arrows (§7, §11 item 34), so a fill that touched one would be a second
 * copy of a fact it is supposed to derive.
 *
 * **The strip (P13, P87, P88).** `commit` writes the claim as the closer's territory,
 * then removes trail from the claimed arrows — except an enemy's **shielding
 * stretch**: one that is territory grade on the post-claim board and carries that
 * enemy's group, wherever the group stands (§7). A claimed arrow that holds a
 * group of the mark's owner keeps that mark even when the stretch is not
 * shielding, so the convert wipe can start there (§6.3). Conversion itself is
 * not decided here: `convertEncircled` runs after `commit` and reads the grade.
 *
 * @see docs/spec/closure/closure.md
 * @see docs/spec/fill/fill.md
 * @see docs/spec/raider-survives-claim/raider-survives-claim.md
 */

import { ContractViolation, chord, chordsInterleave } from '@conquarrow/contracts';
import type {
  ArrowId,
  BoardWindow,
  Claim,
  Chord,
  GameState,
  GeometryPort,
  Move,
  PlayerId,
  PointId,
  StepMove,
} from '@conquarrow/contracts';
import { resetAccumulatorsOnCapture } from './economy';
import { compareArrows, comparePlayers } from './order';
import { stretchGrade, stretchOf } from './stretch';

const reject = (message: string): never => {
  throw new ContractViolation(message);
};

/** A player with no trail, or none to keep. */
const NO_TRAIL: ReadonlySet<ArrowId> = new Set<ArrowId>();

/** Rebuild a trail set sorted, so iteration order never rests on insertion luck. */
const canonical = (arrows: readonly ArrowId[]): ReadonlySet<ArrowId> =>
  new Set([...new Set(arrows)].toSorted(compareArrows));

/** The two `RulesPort` methods P05b adds, plus the hook `apply` needs. */
export interface ClosureRules {
  /**
   * What a closing step would claim, or `undefined` when the step is not a closure
   * (§7, D1–D3).
   */
  readonly closureOf: (state: GameState, move: Move, mover: PlayerId) => Claim | undefined;
  /**
   * The arrows a player's ground rings — every arrow from which no walk escapes
   * (§7, §11 item 36, D4).
   */
  readonly enclosedBy: (
    ground: ReadonlySet<ArrowId>,
    player: PlayerId,
  ) => readonly ArrowId[];
  /**
   * The state after a closure has been committed: territory gains the claim, and every
   * trail loses it (D6, D7, P13) except an enemy's shielding stretch (P87, P88)
   * and a mark under that enemy's group (P88).
   *
   * Returns the state unchanged when the step is not a closure, so `apply` can call it
   * unconditionally and the non-closure path stays a single expression.
   */
  readonly commit: (state: GameState, move: Move, mover: PlayerId) => GameState;
  /**
   * Commit a claim already computed by `closureOf`. The fill sweep runs in
   * `closureOf`; this only writes it, so a closing step pays for the sweep once.
   */
  readonly commitClaim: (state: GameState, claim: Claim, mover: PlayerId) => GameState;
}

/**
 * The arrows of `player`'s **shielding stretches** on the post-claim board —
 * stretches that are territory grade and carry at least one group of `player`,
 * wherever that group stands (§7). Keeping the whole stretch is what lets the
 * grade check see a trail-connected raider and spare it from conversion.
 *
 * Groups are visited in arrow-id order; the answer is a set, so the order is not
 * observable, but nothing here rests on map insertion order either.
 */
const shieldingOf = (
  geometry: GeometryPort,
  board: GameState,
  player: PlayerId,
  trail: ReadonlySet<ArrowId>,
): ReadonlySet<ArrowId> => {
  const shielding = new Set<ArrowId>();
  // The answer is a set, so visit order is unobservable; the sort only keeps the walk
  // off map insertion order (the default sort orders the same tuples the same way).
  // Stryker disable next-line ArrowFunction
  for (const [arrow, group] of [...board.groups].toSorted(([a], [b]) => compareArrows(a, b))) {
    // Unreachable for another player's group: stepping onto P's trail cuts it (§2), a
    // birth onto it cuts it (P40) and a convert wipes it (P33).
    // Stryker disable next-line ConditionalExpression
    if (group.owner !== player) continue;
    if (!trail.has(arrow) || shielding.has(arrow)) continue;
    const stretch = stretchOf(geometry, trail, arrow);
    if (stretchGrade(geometry, board, stretch, player) !== 'territory') continue;
    for (const a of stretch) shielding.add(a);
  }
  return shielding;
};

/**
 * The trails after a claim (P13, P87, P88): every mark on a claimed arrow is
 * removed, except another player's marks in a shielding stretch and a mark under
 * that player's group. The closer's own trail on the claim is always removed —
 * it has just become territory. `board` is the post-claim board: claimed arrows
 * already the closer's, every trail still in place.
 */
const stripClaim = (
  geometry: GeometryPort,
  board: GameState,
  taken: ReadonlySet<ArrowId>,
  mover: PlayerId,
): GameState['trails'] => {
  const trails = new Map<PlayerId, ReadonlySet<ArrowId>>();
  // Default sort orders `[player, set]` tuples by player as well, so the comparator
  // mutant is equivalent.
  // Stryker disable next-line ArrowFunction
  for (const [player, arrows] of [...board.trails].toSorted(([a], [b]) => comparePlayers(a, b))) {
    const shielding = player === mover ? NO_TRAIL : shieldingOf(geometry, board, player, arrows);
    const kept = [...arrows].filter((arrow) => {
      if (!taken.has(arrow)) return true;
      if (player === mover) return false;
      // D1: leave the mark under a converting stack so the wipe can start there.
      return shielding.has(arrow) || board.groups.get(arrow)?.owner === player;
    });
    if (kept.length > 0) trails.set(player, canonical(kept));
  }
  return trails;
};

/**
 * Write an already-computed claim: territory first, then the strip reads the
 * post-claim board. The fill that found the claim is not repeated here.
 */
const writeClaim = (
  geometry: GeometryPort,
  state: GameState,
  claim: Claim,
  mover: PlayerId,
): GameState => {
  const taken = new Set<ArrowId>([...claim.path, ...claim.enclosed]);
  const territory = new Map(state.territory);
  for (const arrow of [...taken].toSorted(compareArrows)) {
    territory.set(arrow, mover);
  }
  const trails = stripClaim(geometry, { ...state, territory }, taken, mover);
  const accumulators = resetAccumulatorsOnCapture(state, taken, state.territory, mover);
  return { ...state, territory, trails, accumulators };
};

/** The most a window is ever grown before the wall has to be inside it (see below). */
const radiusCeiling = (wallSize: number): number => 2 * wallSize;

/**
 * Build the closure rules over a board.
 *
 * The board arrives as a `GeometryPort` and nothing else. `window()` is the only way
 * to enumerate a bounded region of an unbounded lattice (§11 item 4).
 */
export const makeClosureRules = (geometry: GeometryPort): ClosureRules => {
  const chordAt = (point: PointId, into: ArrowId, out: ArrowId): Chord =>
    chord(geometry.slotOf(point, into), geometry.slotOf(point, out));

  /**
   * Chords the player's ground presents at a point — `i × o`, every in feeding every
   * out (§6.1a). Same shape as trail chords; coincidence cannot arise for a walk on
   * non-ground, so `chordsInterleave` is the block predicate (§7).
   */
  const groundChordsAt = (point: PointId, ground: ReadonlySet<ArrowId>): readonly Chord[] => {
    const ins = geometry.inArrows(point).filter((a) => ground.has(a));
    const outs = geometry.outArrows(point).filter((a) => ground.has(a));
    return ins.flatMap((into) => outs.map((out) => chordAt(point, into, out)));
  };

  /**
   * Blocked when the walk chord interleaves with a ground chord.
   *
   * `chordsInterleave`, not `chordsCross`: coincidence cannot arise for a walk on
   * non-ground (fill.md), so the two agree here — the narrow predicate is kept for
   * consistency with §7's other caller. A behavioural mutation to `chordsCross`
   * therefore passes the suite; that is the documented equivalence, not a gap.
   */
  const blocked = (
    from: ArrowId,
    to: ArrowId,
    point: PointId,
    ground: ReadonlySet<ArrowId>,
  ): boolean => {
    const drawn = chord(geometry.slotOf(point, from), geometry.slotOf(point, to));
    return groundChordsAt(point, ground).some((wall) => chordsInterleave(drawn, wall));
  };

  /** Non-ground arrows reachable from `arrow` in one unblocked step. */
  const neighbours = (arrow: ArrowId, ground: ReadonlySet<ArrowId>): readonly ArrowId[] => {
    const next: ArrowId[] = [];
    for (const point of [geometry.origin(arrow), geometry.target(arrow)]) {
      for (const other of [...geometry.inArrows(point), ...geometry.outArrows(point)]) {
        if (other === arrow || ground.has(other)) continue;
        if (!blocked(arrow, other, point, ground)) next.push(other);
      }
    }
    return next;
  };

  /**
   * Trail arrows reachable from `root` against the grain: `Y` precedes `X` when `Y`
   * is trail and `target(Y) === origin(X)`. At a merge, every in-arrow — the set
   * holds no pairing (§11 item 26).
   *
   * P42: occupation is not a stop. Firebreaks halt evaporation, not the claim
   * walk. The departure `root` is always claimed; every against-grain trail
   * predecessor is too.
   */
  const walkBack = (root: ArrowId, trail: ReadonlySet<ArrowId>): readonly ArrowId[] => {
    const reached = new Set<ArrowId>();
    const pending: ArrowId[] = [root];
    for (let here = pending.pop(); here !== undefined; here = pending.pop()) {
      if (reached.has(here)) continue;
      reached.add(here);
      for (const pred of geometry.inArrows(geometry.origin(here))) {
        if (!trail.has(pred) || reached.has(pred)) continue;
        pending.push(pred);
      }
    }
    return [...reached].toSorted(compareArrows);
  };

  const moverGround = (state: GameState, mover: PlayerId): Set<ArrowId> => {
    const owned = new Set<ArrowId>();
    for (const [arrow, owner] of state.territory) {
      if (owner === mover) owned.add(arrow);
    }
    return owned;
  };

  /**
   * The player's ground split into walls that touch — arrows sharing a point.
   *
   * A pocket is ringed by **one** closed run of ground: two runs that share no point
   * have a gap between them for a walk to leave by. So each wall gets its own window,
   * sized and centred on itself. Sweeping the whole set in one window instead let a
   * distant second holding drag the centre away from the closure that had just
   * happened, and a plainly ringed pocket then read as escaping.
   */
  const wallsOf = (ground: ReadonlySet<ArrowId>): readonly (readonly ArrowId[])[] => {
    const seen = new Set<ArrowId>();
    const walls: ArrowId[][] = [];
    for (const seed of [...ground].toSorted(compareArrows)) {
      if (seen.has(seed)) continue;
      seen.add(seed);
      const wall: ArrowId[] = [];
      const pending: ArrowId[] = [seed];
      for (let here = pending.pop(); here !== undefined; here = pending.pop()) {
        wall.push(here);
        for (const point of [geometry.origin(here), geometry.target(here)]) {
          for (const other of [...geometry.inArrows(point), ...geometry.outArrows(point)]) {
            if (!ground.has(other) || seen.has(other)) continue;
            seen.add(other);
            pending.push(other);
          }
        }
      }
      walls.push(wall.toSorted(compareArrows));
    }
    return walls;
  };

  /**
   * The smallest window that holds the whole wall, plus one step.
   *
   * **The sweep's bound, derived here and nowhere else** (§7: *fill is bounded by the
   * trail, not by the board* — there is no board extent to read, §11 item 4). The
   * window is grown until the wall is inside it rather than sized from a formula,
   * because the only extent the port will answer is membership.
   *
   * Enough: everything the wall rings is inside that window. An arrow further out than
   * the whole wall can walk away from the centre and never meet it, so it escapes and
   * is not ringed — the Jordan argument §7 leans on, and the reason the plane is
   * load-bearing. Too small a window does not crash; it reports a ringed pocket as
   * escaping, which is this file's whole failure mode (fill.md).
   *
   * Terminates: two arrows sharing a point have endpoints at most 2 points apart, so a
   * wall held together by *n* arrows is inside radius `2n`.
   */
  const windowAround = (wall: readonly ArrowId[], centre: PointId): BoardWindow => {
    const ceiling = radiusCeiling(wall.length);
    for (let radius = 1; radius < ceiling; radius += 1) {
      const arrows = new Set(geometry.window(centre, radius).arrows);
      if (wall.every((arrow) => arrows.has(arrow))) return geometry.window(centre, radius + 1);
    }
    return geometry.window(centre, ceiling + 1);
  };

  /**
   * The arrows one wall rings — every non-ground arrow of its window that the escape
   * flood never reaches. The wall is `ground` entire, because a walk is stopped by any
   * of the player's arrows and not only by the wall being swept.
   */
  const ringedBy = (
    wall: readonly ArrowId[],
    ground: ReadonlySet<ArrowId>,
  ): readonly ArrowId[] => {
    const first = wall[0];
    if (first === undefined) return [];
    const win = windowAround(wall, geometry.origin(first));
    const inWindow = new Set(win.arrows);

    // Escape: flood from every non-ground window arrow that can step *outside* the
    // window. Whatever the flood never reaches cannot reach infinity.
    const escaped = new Set<ArrowId>();
    const pending: ArrowId[] = [];
    for (const arrow of win.arrows) {
      if (ground.has(arrow)) continue;
      for (const n of neighbours(arrow, ground)) {
        if (!inWindow.has(n)) {
          escaped.add(arrow);
          pending.push(arrow);
          break;
        }
      }
    }
    for (let here = pending.pop(); here !== undefined; here = pending.pop()) {
      for (const n of neighbours(here, ground)) {
        if (ground.has(n) || escaped.has(n) || !inWindow.has(n)) continue;
        escaped.add(n);
        pending.push(n);
      }
    }

    return win.arrows
      .filter((a) => !ground.has(a) && !escaped.has(a))
      .toSorted(compareArrows);
  };

  const enclosedBy = (
    ground: ReadonlySet<ArrowId>,
    _player: PlayerId,
  ): readonly ArrowId[] => {
    if (ground.size === 0) return [];

    // Refuse unknown arrows loudly (P04 D9) — `origin` throws ContractViolation.
    for (const arrow of [...ground].toSorted(compareArrows)) {
      geometry.origin(arrow);
    }

    const ringed = new Set<ArrowId>();
    for (const wall of wallsOf(ground)) {
      for (const arrow of ringedBy(wall, ground)) ringed.add(arrow);
    }
    return [...ringed].toSorted(compareArrows);
  };

  const asStep = (move: Move): StepMove => {
    if (move.kind !== 'step') {
      return reject(`closureOf expects a step, got ${move.kind}`);
    }
    return move;
  };

  const closureOf = (state: GameState, move: Move, mover: PlayerId): Claim | undefined => {
    const stepMove = asStep(move);
    // D1: destination must already be the mover's own territory.
    if (state.territory.get(stepMove.exit) !== mover) return undefined;
    // And the departed arrow must be trail — free movement inside land claims nothing.
    const trail = state.trails.get(mover);
    if (trail === undefined || !trail.has(stepMove.from)) return undefined;

    // P42: the claim walk never stops for an owner-occupied trail arrow.
    const path = walkBack(stepMove.from, trail);
    const ground = moverGround(state, mover);
    for (const arrow of path) ground.add(arrow);
    return { path, enclosed: enclosedBy(ground, mover) };
  };

  const commitClaim = (state: GameState, claim: Claim, mover: PlayerId): GameState =>
    writeClaim(geometry, state, claim, mover);

  const commit = (state: GameState, move: Move, mover: PlayerId): GameState => {
    const claim = closureOf(state, move, mover);
    return claim === undefined ? state : commitClaim(state, claim, mover);
  };

  return { closureOf, enclosedBy, commit, commitClaim };
};
