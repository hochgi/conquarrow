/**
 * The movement engine — allowance, splitting, merging and the turn loop.
 *
 * SPEC §3 (speed, merge cost, spending), §4 (turn structure), §2 (movement
 * follows the grain), §11 items 19–22 and 33. P04 decisions D1–D9.
 *
 * Pure: every function here is a function of `(state, move)` and the board it was
 * built over. No clock, no randomness, no I/O, and no mutation of an input state
 * (AGENTS.md, ADR 0001) — a copy of the occupancy map is made before anything is
 * written to it, and a move that changes nothing returns the state it was given.
 *
 * The board arrives as a `GeometryPort` and nothing else, so the grain is asked
 * for rather than assumed and a fixture board (P02) and the generated tiling
 * (P03) satisfy these rules unchanged.
 *
 * @see docs/spec/movement/movement.md
 */

import { ContractViolation, endTurn, isSatisfiableBy, speed, step } from '@conquarrow/contracts';
import type {
  ArrowId,
  GameState,
  GeometryPort,
  Group,
  MergeOverride,
  Move,
  PlayerId,
  RulesPort,
  StepMove,
} from '@conquarrow/contracts';
import { makeCombatRules, resolveBattle } from './combat';
import { makeClosureRules } from './closure';
import { makeCutRules } from './cuts';
import { convertEncircled } from './encirclement';
import { accrueRound } from './economy';
import { compareArrows } from './order';
import { isSelfConvertStep, SELF_CONVERT_MESSAGE } from './selfConvert';
import { makeTrailRules } from './trails';
import { resolveLosses, tickStarvation } from './victory';

/**
 * Refuse a move. An illegal move is never a plausible no-op (P04 D2, D9): a
 * wrong step must not become a silent wrong board state.
 *
 * Local rather than imported: `reject` is internal to `@conquarrow/contracts`, and
 * the error type is the part of it that is public.
 */
const reject = (message: string): never => {
  throw new ContractViolation(message);
};

/**
 * A group, with `speedOverride` present only when there is one to carry.
 *
 * `exactOptionalPropertyTypes` makes the distinction real: absent means plain
 * `speed(heads)`, and an explicit `undefined` is not the same thing.
 */
const asGroup = (
  owner: PlayerId,
  heads: number,
  spent: number,
  override?: MergeOverride,
): Group =>
  override === undefined
    ? { owner, heads, spent }
    : { owner, heads, spent, speedOverride: override };

/**
 * The one refusal that says nothing about the board (P38, §11 item 46).
 *
 * A won match is terminal: `legalMoves` offers nothing and `apply` refuses
 * everything. The message names the match and the winner and *never* the move,
 * because the gate sits above `dispatch` and has not looked at it — a caller who
 * mistook a finished match for a live one is told that, rather than handed a
 * movement diagnostic about an arrow nobody read.
 */
/** A record naming a kind the vocabulary does not have — a stale `skip`, say. */
const unknownMove = (move: never): string =>
  `no such move kind: ${String((move as { readonly kind?: unknown }).kind)}`;

const matchOver = (winner: PlayerId): string =>
  `the match is over: ${String(winner)} has won`;

/**
 * The offer list of a won match: nothing, not even the pass.
 *
 * The one state where an empty list is the answer rather than a deadlock. A
 * **lost** seat is offered exactly the pass (P37 invariant 4) because
 * `players[0]` is the round-boundary marker and the round still has to advance
 * through a dead seat's slot. A **won** match has no next turn to advance to, so
 * there is nothing for a pass to mean.
 *
 * Shared and empty, so asking is O(1) and allocates nothing.
 */
const NO_MOVES: readonly Move[] = [];

/**
 * Next seat in turn order (§4). **Nobody is ever skipped** (§9 / P36): a lost
 * seat, and a seat with a share but no heads, still receive the chair — they can
 * only `endTurn`, and the hot-seat adapter auto-passes them. Passing them over would move
 * or destroy the `players[0]` boundary marker that accrual depends on.
 *
 * Module level rather than a closure: turn order is a function of the state's own
 * seat list and asks the board nothing.
 */
const nextPlayer = (state: GameState): PlayerId => {
  const start = state.players.indexOf(state.activePlayer);
  if (start < 0) {
    return reject(`${String(state.activePlayer)} is not one of this match's players`);
  }
  const next = state.players[(start + 1) % state.players.length];
  if (next === undefined) {
    return reject('match has no players');
  }
  return next;
};

/**
 * Build the movement rules over a board.
 *
 * The board arrives as a port and nothing else — the engine never learns which
 * implementation it got, so a hand-authored fixture (P02) and the generated
 * tiling (P03) satisfy the same rules unchanged.
 */
export const makeRules = (geometry: GeometryPort): RulesPort => {
  // P05's half of the port: what a step marks and who crossed whom. Movement asks
  // `markStep` as a step is written and exposes the rest unchanged. (P22: no branch toll.)
  const trails = makeTrailRules(geometry);
  // P05b's half: what a landing claims, and what the claimed ground rings.
  const closure = makeClosureRules(geometry);
  // P06: contact-combat losses (query) and cut evaporation after a step.
  const combat = makeCombatRules(geometry);
  const cuts = makeCutRules(geometry, trails.crossesTrail);
  // P07: conversion after the rest of the step (§6.3).

  /**
   * How far the group may go this turn: `speed(heads)`, unless a merge set an
   * override for the rest of the turn (§3, D4). Stated as an override so every
   * allowance question stays `spent < allowance`.
   */
  const allowanceOf = (group: Group): number => group.speedOverride ?? speed(group.heads);

  /**
   * The group standing on `arrow`, or a refusal.
   *
   * `target` is asked first and its answer thrown away: it is the board's own
   * check that this arrow exists, so a foreign id fails loudly rather than
   * reading as an empty arrow (P04 D9).
   */
  const groupOn = (state: GameState, arrow: ArrowId): Group => {
    geometry.target(arrow);
    return state.groups.get(arrow) ?? reject(`no group stands on ${String(arrow)}`);
  };

  const requireActive = (state: GameState, arrow: ArrowId): Group => {
    const group = groupOn(state, arrow);
    if (group.owner !== state.activePlayer) {
      reject(`${String(arrow)} is held by ${String(group.owner)}, not the active player`);
    }
    return group;
  };

  /** Movement follows the grain (§2): the only exits are the target's out-arrows. */
  const exitsFrom = (arrow: ArrowId): readonly ArrowId[] =>
    geometry.outArrows(geometry.target(arrow));

  /**
   * What stands on the destination once the step has landed on empty ground or
   * the mover's own group.
   *
   * Empty ground: the movers carry their own `spent`, one more for this step, and
   * they carry any merge override **with them** — an override travels with the
   * heads, not with the arrow it was set on (SPEC §11 item 33, resolved).
   *
   * A merge: the arrivals' spending is discarded and the destination's is kept,
   * and the override is computed fresh here from arrival against joined. *Any*
   * majority arrival bars the merged group for the rest of the turn, so a
   * barred destination stays barred however small the next arrival is (§3).
   */
  const landing = (movers: Group, count: number, joined: Group | undefined): Group => {
    if (joined === undefined) {
      return asGroup(movers.owner, count, movers.spent + 1, movers.speedOverride);
    }
    const barred = joined.speedOverride === 0 || count > joined.heads;
    return asGroup(joined.owner, joined.heads + count, joined.spent, barred ? 0 : 1);
  };

  /**
   * The group a step moves, or a refusal — every reason P04 D2 gives, in one
   * place, so no caller can take a step past a check by accident.
   *
   * Enemy-occupied destinations are legal here: contact combat (§6.2) resolves
   * them inside `applyStep` rather than refusing the step. P28 self-convert
   * steps are refused here, before stay-behind or occupancy writes.
   */
  const moversFor = (state: GameState, move: StepMove): Group => {
    const movers = requireActive(state, move.from);
    const allowance = allowanceOf(movers);
    if (!exitsFrom(move.from).includes(move.exit)) {
      reject(
        `${String(move.exit)} is not an out-arrow of the target of ${String(move.from)} — movement follows the grain`,
      );
    }
    if (!isSatisfiableBy(move, movers.heads)) {
      reject(
        `${String(move.from)} holds ${String(movers.heads)} heads, so ${String(move.count)} cannot step`,
      );
    }
    if (movers.spent >= allowance) {
      reject(
        `the group on ${String(move.from)} has spent ${String(movers.spent)} of its ${String(allowance)}`,
      );
    }
    if (isSelfConvertStep(state, move.from, move.exit, movers.owner, trails.anchorGrade)) {
      reject(SELF_CONVERT_MESSAGE);
    }
    return movers;
  };

  /**
   * §6.2 / item 38: an attack may not empty `from` — stay-behind ≥ 1. A lone
   * head therefore cannot attack. Refuse rather than silently capping.
   */
  const requireStayBehind = (movers: Group, move: StepMove, contact: Group): void => {
    if (movers.heads < 2 || move.count > movers.heads - 1) {
      reject(
        `attack from ${String(move.from)} onto ${String(contact.owner)} on ${String(move.exit)} must leave at least one head behind (heads=${String(movers.heads)}, count=${String(move.count)})`,
      );
    }
  };

  /**
   * Write the split remainder on `from` after `count` heads leave (or die).
   */
  const leaveRemainder = (
    groups: Map<ArrowId, Group>,
    from: ArrowId,
    movers: Group,
    count: number,
  ): void => {
    const remainder = movers.heads - count;
    if (remainder === 0) {
      groups.delete(from);
    } else {
      groups.set(from, asGroup(movers.owner, remainder, movers.spent, movers.speedOverride));
    }
  };

  /**
   * A step: occupancy (ordinary or contact combat), then the mark it leaves,
   * then cut evaporation, then closure, then conversion.
   *
   * P06 D6: combat (when contact) first, then cut against the trail set, then
   * closure. `evaporate` / `commit` are no-ops when the step is neither.
   */
  const applyStep = (state: GameState, move: StepMove): GameState => {
    const movers = moversFor(state, move);
    const groups = new Map(state.groups);
    const standing = state.groups.get(move.exit);
    const contact =
      standing !== undefined && standing.owner !== movers.owner ? standing : undefined;

    /** Arrows whose occupant was wiped to 0 this step — evaporate after mark. */
    const wiped: { readonly owner: PlayerId; readonly arrow: ArrowId }[] = [];

    let landed = true;
    if (contact !== undefined) {
      requireStayBehind(movers, move, contact);
      const { aRem, dRem } = resolveBattle(move.count, contact.heads);
      leaveRemainder(groups, move.from, movers, move.count);
      if (dRem === 0) {
        wiped.push({ owner: contact.owner, arrow: move.exit });
        landed = true;
        if (aRem === 0) {
          wiped.push({ owner: movers.owner, arrow: move.exit });
          groups.delete(move.exit);
        } else {
          groups.set(move.exit, asGroup(movers.owner, aRem, movers.spent + 1, movers.speedOverride));
        }
      } else {
        landed = false;
        groups.set(move.exit, asGroup(contact.owner, dRem, contact.spent, contact.speedOverride));
        if (aRem === 0) {
          // Attackers on the destination are gone; stay-behind remains on from.
          // No destination wipe of attacker trail — they never marked exit.
        }
      }
    } else {
      leaveRemainder(groups, move.from, movers, move.count);
      groups.set(move.exit, landing(movers, move.count, standing));
    }

    let stepped: GameState = {
      ...state,
      groups,
      trails: landed ? trails.markStep(state, move, movers.owner) : state.trails,
    };

    // Combat wipes evaporate trail from emptied arrows (P12).
    for (const { owner, arrow } of wiped) {
      stepped = cuts.evaporateFromArrow(stepped, owner, arrow);
    }

    // Crossing cuts, then territory-root feeder cuts on the marked arrow.
    let afterCut = cuts.evaporate(stepped, move, movers.owner);
    if (landed) {
      afterCut = cuts.territoryRootCuts(afterCut, movers.owner, move.exit);
    }

    const afterClosure = closure.commit(afterCut, move, movers.owner);
    // P33: flip, then wipe victim trail from converted arrows (halt-at-first).
    const afterConvert = convertEncircled(
      afterClosure,
      trails.anchorGrade,
      cuts.evaporateFromArrow,
    );
    // P36: no loss is evaluated inside a step or a convert — the round
    // boundary owns it (§9, invariants 11-12). A turn stays atomic with respect
    // to removals.
    return afterConvert;
  };

  /**
   * The turn ends only here (D6). Nothing survives the boundary: every `spent`
   * counter is zeroed and every merge override is dropped (§3, §11 item 20).
   * Ending with allowance unspent is ordinary play, so no exhaustion is required.
   *
   * P08: when the next seat is `players[0]`, a full round has closed and every
   * spawner accrues one round-robin step (§7 / §11 item 41). P40: a birth onto
   * another player's open trail cuts that trail from the birth arrow.
   *
   * P36: that same boundary is where the starvation clocks advance, and P37 left
   * the order intact — accrue, advance the clocks, and then `apply`'s tail
   * resolves the losses. A streak counts *rounds*, so the tick stays here even
   * though the resolution no longer does. `players[0]` is the marker whether or
   * not that seat is still playing; there is no *first living player* reading of
   * the boundary (§9).
   */
  const applyEndTurn = (state: GameState): GameState => {
    const next = nextPlayer(state);
    const handed: GameState = {
      ...state,
      activePlayer: next,
      groups: new Map(
        [...state.groups].map(([arrow, group]) => [arrow, asGroup(group.owner, group.heads, 0)]),
      ),
    };
    const roundStart = handed.players[0];
    if (roundStart === undefined || next !== roundStart) return handed;
    // Full round (§9 / P36): accrue, then tick starvation. Losses resolve on the
    // tail of `apply` (P37), which is *after* this returns, so the boundary order
    // accrue -> tick -> resolve is preserved without stating it twice.
    // Tick-before-resolve is load-bearing: a seat is lost on the round its streak
    // reaches dominationN, not the round after. Accrue-first cannot rescue a lost
    // or destitute seat — they own no share (share theorem).
    return tickStarvation(accrueRound(handed, geometry, cuts.evaporateFromArrow), geometry);
  };

  /**
   * The active player's groups that still have a whole step left, in arrow-id
   * order.
   *
   * Sorted rather than taken as the map hands them over: ADR 0001 names ordering,
   * not randomness, as the realistic determinism failure, and an engine that read
   * an insertion-ordered map into an ordered answer would pass every example here
   * and drift in replay.
   */
  const movable = (state: GameState): readonly (readonly [ArrowId, Group])[] =>
    [...state.groups]
      .filter(([, group]) => group.owner === state.activePlayer && group.spent < allowanceOf(group))
      .toSorted(([left], [right]) => compareArrows(left, right));

  /**
   * Every move the active player may make.
   *
   * A group with allowance offers each portion of itself down each landable exit
   * — splitting, merging and forking are all a step with a different `count`
   * (§4, contracts/move.ts). A group is simply not named when it has nothing it
   * can do: declining is the absence of a move, not a move (P51). When no
   * group has a whole step left, that leaves `endTurn` alone (D6, confirmed):
   * exhaustion restricts the offer rather than advancing the player behind their
   * back.
   *
   * P22: branching is free and a sole stack-grade tip may vacate — no toll filter,
   * no size-1 freeze.
   */
  const legalMoves = (state: GameState): readonly Move[] => {
    // P38: a won match offers nothing. First, so a won state is *cheaper* to ask
    // than a live one — one `undefined` check on a field already in hand, before
    // any arrow, vertex or map of the state is read.
    if (state.winner !== undefined) return NO_MOVES;
    const moves: Move[] = [];
    for (const [arrow, group] of movable(state)) {
      for (const exit of exitsFrom(arrow)) {
        if (isSelfConvertStep(state, arrow, exit, group.owner, trails.anchorGrade)) continue;
        const standing = state.groups.get(exit);
        const isAttack = standing !== undefined && standing.owner !== group.owner;
        const maxCount = isAttack ? group.heads - 1 : group.heads;
        for (let count = 1; count <= maxCount; count += 1) {
          moves.push(step(arrow, exit, count));
        }
      }
    }
    moves.push(endTurn());
    return moves;
  };

  const dispatch = (state: GameState, move: Move): GameState => {
    switch (move.kind) {
      case 'step':
        return applyStep(state, move);
      case 'endTurn':
        return applyEndTurn(state);
      default:
        return reject(unknownMove(move));
    }
  };

  /**
   * One move, then the losses it caused (P37) — unless the match is already over
   * (P38).
   *
   * The gate is at the **top**, above `dispatch`, and that placement is the whole
   * of the packet's other half: the deciding move itself is never affected, so it
   * resolves every effect it causes — the closure, the fill, the conversion, the
   * evaporation, the loser vanishing — and only the move *after* it is refused.
   * A gate anywhere near `resolveLosses` on the tail would refuse the move for the
   * win that move caused.
   *
   * Refusing rather than returning the input unchanged is deliberate and its cost
   * is accepted (a record that runs past the win now throws): a caller handed back
   * an unchanged state cannot tell "the match is over" from "that move was a
   * no-op", and the engine would be absorbing a caller bug in silence.
   *
   * Resolution sits here rather than inside `applyEndTurn` so that the match ends
   * on the move that decides it: encircling the last enemy territory used to leave
   * the winner unset until the round closed, with the dead seat taking a turn in
   * between. Turn atomicity is given up deliberately — a step that costs another
   * seat its last territory changes the board mid-turn, which is the honest
   * reading of what that step did.
   *
   * Cheap enough to run per move because `resolveLosses` takes one census pass and
   * reads no vertex unless some seat owns ground and holds no head — see
   * victory.ts.
   */
  const apply = (state: GameState, move: Move): GameState => {
    if (state.winner !== undefined) reject(matchOver(state.winner));
    return resolveLosses(dispatch(state, move), geometry);
  };

  return {
    legalMoves,
    apply,
    effectiveSpeed: (state: GameState, arrow: ArrowId): number =>
      allowanceOf(groupOn(state, arrow)),
    trailChordsAt: trails.trailChordsAt,
    crossesTrail: trails.crossesTrail,
    selfCrosses: trails.selfCrosses,
    anchorGrade: trails.anchorGrade,
    closureOf: closure.closureOf,
    enclosedBy: closure.enclosedBy,
    combatLosses: combat.combatLosses,
  };
};
