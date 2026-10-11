/**
 * Encirclement / conversion — enemy heads inside your territory without a
 * territory-grade trail flip owner (§6.3, §11 items 9, 28, **40** / P33).
 *
 * P33: after ownership flips, wipe the victim's trail from each converted
 * arrow under halt-at-first (`evaporateFromArrow`). Do not pre-strip those
 * arrows — a prior strip would no-op the wipe and leave the encircled path.
 *
 * @see docs/spec/encirclement/encirclement.md
 * @see docs/spec/encircled-path/encircled-path.md
 */

import { speed } from '@conquarrow/contracts';
import type { AnchorGrade, ArrowId, GameState, PlayerId } from '@conquarrow/contracts';
import { compareArrows } from './order';

const hasTerritoryGrade = (
  state: GameState,
  arrow: ArrowId,
  player: PlayerId,
  gradeOf: (state: GameState, arrow: ArrowId, player: PlayerId) => AnchorGrade,
): boolean => {
  const trail = state.trails.get(player);
  if (trail === undefined || !trail.has(arrow)) return false;
  return gradeOf(state, arrow, player) === 'territory';
};

/**
 * Flip every encircled group to the territory owner. Head count intact;
 * `spent = speed(heads)`; merge override dropped (P70 / ADR 0005). Then
 * evaporate the victim's trail from each converted arrow in arrow-id order
 * (P33). Converted stacks are already the claimer's, so they are not victim
 * firebreaks.
 */
export const convertEncircled = (
  state: GameState,
  gradeOf: (state: GameState, arrow: ArrowId, player: PlayerId) => AnchorGrade,
  evaporateFromArrow: (
    state: GameState,
    victim: PlayerId,
    emptied: ArrowId,
  ) => GameState,
): GameState => {
  const converted: { readonly victim: PlayerId; readonly arrow: ArrowId }[] = [];
  const groups = new Map(state.groups);

  for (const [arrow, group] of [...state.groups].toSorted(([a], [b]) => compareArrows(a, b))) {
    const landOwner = state.territory.get(arrow);
    if (landOwner === undefined || landOwner === group.owner) continue;
    if (hasTerritoryGrade(state, arrow, group.owner, gradeOf)) continue;

    converted.push({ victim: group.owner, arrow });
    groups.set(arrow, { owner: landOwner, heads: group.heads, spent: speed(group.heads) });
  }

  if (converted.length === 0) return state;

  // `converted` is already arrow-id order from the scan above.
  let next: GameState = { ...state, groups };
  for (const { victim, arrow } of converted) {
    next = evaporateFromArrow(next, victim, arrow);
  }
  return next;
};
