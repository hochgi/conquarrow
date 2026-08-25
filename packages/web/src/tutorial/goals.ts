/**
 * Goal predicates (P43) — pure functions on committed states.
 *
 * Where a goal is about *what happened*, the predicate reads the states around
 * one committed batch (`before`, `after`, `moves`) rather than re-deriving
 * semantics from raw diffs. One namer, not two: the fx presenter already owns
 * event naming for presentation; these predicates are the headless twin.
 */

import type { ArrowId, GameState, Move, PlayerId } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import type { GoalDef } from './types';

const geometry = makeTiling();

/** Every arrow of territory `player` holds in `state`. */
const ownedArrows = (state: GameState, player: PlayerId): ReadonlySet<ArrowId> => {
  const arrows = new Set<ArrowId>();
  for (const [arrow, owner] of state.territory) {
    if (owner === player) arrows.add(arrow);
  }
  return arrows;
};

/** The mover of a batch — the owner of its first step's source, else active. */
const moverOf = (state: GameState, moves: readonly Move[]): PlayerId => {
  const first = moves.find((move): move is Extract<Move, { kind: 'step' }> => move.kind === 'step');
  if (first === undefined) return state.activePlayer;
  return state.groups.get(first.from)?.owner ?? state.activePlayer;
};

const others = (state: GameState, player: PlayerId): readonly PlayerId[] =>
  state.players.filter((candidate) => candidate !== player);

const trailShrink = (
  before: GameState,
  after: GameState,
  victims: readonly PlayerId[],
): boolean =>
  victims.some(
    (victim) =>
      (after.trails.get(victim)?.size ?? 0) < (before.trails.get(victim)?.size ?? 0),
  );

const cutEnemyTrail: GoalDef = {
  holds: (before, after, moves) => {
    const mover = moverOf(before, moves);
    return trailShrink(before, after, others(before, mover));
  },
  candidates: (state) => {
    const arrows: ArrowId[] = [];
    for (const victim of others(state, state.activePlayer)) {
      for (const arrow of state.trails.get(victim) ?? []) arrows.push(arrow);
    }
    return arrows;
  },
};

const closedAnyLoop: GoalDef = {
  holds: (before, after, moves) => {
    const mover = moverOf(before, moves);
    return ownedArrows(after, mover).size > ownedArrows(before, mover).size;
  },
};

/** Encirclement flips a group's owner to the claimer on the very arrow it stood. */
const convertedEnemyStack: GoalDef = {
  holds: (before, after, moves) => {
    const mover = moverOf(before, moves);
    for (const [arrow, group] of after.groups) {
      const was = before.groups.get(arrow);
      if (was === undefined) continue;
      if (group.owner === mover && was.owner !== mover) return true;
    }
    return false;
  },
};

/** Shares held = spawner-border arrows the player owns as territory (§7). */
const sharesHeld = (state: GameState, player: PlayerId): number => {
  let count = 0;
  for (const [arrow, owner] of state.territory) {
    if (owner !== player) continue;
    for (const vertex of geometry.flankVertices(arrow)) {
      if (state.spawners.has(vertex)) {
        count += 1;
        break;
      }
    }
  }
  return count;
};

const capturedShare: GoalDef = {
  holds: (before, after, moves) => {
    const mover = moverOf(before, moves);
    return sharesHeld(after, mover) > sharesHeld(before, mover);
  },
};

export const GOALS: Record<string, GoalDef> = {
  closedAnyLoop,
  cutEnemyTrail,
  convertedEnemyStack,
  capturedShare,
};
