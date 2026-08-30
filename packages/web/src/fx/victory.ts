/**
 * Match-over celebration — a reading of frozen GameState for Board / Hud.
 *
 * Discriminant is `state.winner` alone. The banner names the winner and nothing
 * else; it does not read `starvationStreaks`.
 */

import type { ArrowId, GameState, GeometryPort, PlayerId } from '@conquarrow/contracts';
import { styleFor } from '../colors';

export type VictoryFx =
  | { readonly kind: 'playing' }
  | {
      readonly kind: 'over';
      readonly winner: PlayerId;
      readonly banner: string;
      readonly hint: string;
      readonly shineArrows: ReadonlySet<ArrowId>;
      readonly pulseArrows: ReadonlySet<ArrowId>;
    };

export const MATCH_OVER_HINT = 'Match over — pan to look around';

/** Locked absent — Board and Hud add no covering overlay. */
export const MATCH_OVER_OVERLAY: undefined = undefined;

/** Dim opacity for arrows that fail the winner-territory / trail / group test. */
export const MATCH_OVER_DIM_OPACITY = 0.4;

const cmpId = (left: unknown, right: unknown): number => {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

const shineArrowsOf = (
  state: GameState,
  geometry: GeometryPort,
  winner: PlayerId,
): ReadonlySet<ArrowId> => {
  const shine = new Set<ArrowId>();
  for (const vertex of [...state.spawners.keys()].toSorted(cmpId)) {
    for (const arrow of [...geometry.borderArrows(vertex)].toSorted(cmpId)) {
      if (state.territory.get(arrow) === winner) shine.add(arrow);
    }
  }
  return shine;
};

const pulseArrowsOf = (state: GameState, winner: PlayerId): ReadonlySet<ArrowId> => {
  const pulse = new Set<ArrowId>();
  for (const [arrow, group] of [...state.groups].toSorted(([left], [right]) =>
    cmpId(left, right),
  )) {
    if (group.owner === winner) pulse.add(arrow);
  }
  return pulse;
};

export const victoryFx = (state: GameState, geometry: GeometryPort): VictoryFx => {
  const winner = state.winner;
  if (winner === undefined) return { kind: 'playing' };
  return {
    kind: 'over',
    winner,
    banner: `${styleFor(winner).label} wins`,
    hint: MATCH_OVER_HINT,
    shineArrows: shineArrowsOf(state, geometry, winner),
    pulseArrows: pulseArrowsOf(state, winner),
  };
};

export const isMatchOverDimmed = (
  fx: VictoryFx,
  arrow: ArrowId,
  state: GameState,
): boolean => {
  if (fx.kind !== 'over') return false;
  const { winner } = fx;
  if (state.territory.get(arrow) === winner) return false;
  if (state.trails.get(winner)?.has(arrow) === true) return false;
  if (state.groups.get(arrow)?.owner === winner) return false;
  return true;
};

export const yieldSoonAllowed = (fx: VictoryFx): boolean => fx.kind === 'playing';

export const playHighlightsAllowed = (fx: VictoryFx): boolean => fx.kind === 'playing';

/**
 * Whether `fx.kind === 'over'` — P29's reading of the celebration itself.
 *
 * This is not what locks End turn. While the winning move's overlays play
 * out, `victoryAt` deliberately reads *playing*, so wiring the HUD to this would
 * unlock the board for the length of that animation (P38 invariant 12). Hud locks
 * through `matchLocked` in `./celebration`, which reads `state.winner` and ignores
 * the celebration. Kept because P29's spec-derived tests pin the function.
 */
export const controlsLocked = (fx: VictoryFx): boolean => fx.kind === 'over';

export const hasSplash = (fx: VictoryFx): boolean => {
  void fx;
  return false;
};
