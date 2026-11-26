/**
 * Resolved gameplay events — the vocabulary of a *reading* of one `apply`
 * (P107: moved here from `packages/web/src/fx/events.ts` so web, server and
 * agent context share one type). The resolver is `resolveEvents` in
 * `@conquarrow/rules-core`; the compact form the server's match log writes is
 * {@link LogEvent}.
 *
 * @see docs/spec/match-log-v2/match-log-v2.md
 */

import type { GameState } from './game-state';
import type { ArrowId, PlayerId } from './ids';
import type { Move } from './move';

export type GameEvent =
  /** A portion walked one arrow onto empty or own-but-unoccupied ground. Tier 3. */
  | {
      readonly kind: 'moved';
      readonly player: PlayerId;
      readonly from: ArrowId;
      readonly to: ArrowId;
      readonly heads: number;
    }
  /** Arrows that joined the mover's open trail — the exposed part of an expansion. */
  | { readonly kind: 'trailLaid'; readonly player: PlayerId; readonly arrows: readonly ArrowId[] }
  /** The stack divided: `moved` went on, `stayed` did not. Tier 2. */
  | {
      readonly kind: 'stackSplit';
      readonly player: PlayerId;
      readonly from: ArrowId;
      readonly to: ArrowId;
      readonly moved: number;
      readonly stayed: number;
    }
  /** Heads the player chose to leave behind (§5 sentry). Always paired with a split. */
  | {
      readonly kind: 'sentryLeft';
      readonly player: PlayerId;
      readonly arrow: ArrowId;
      readonly heads: number;
    }
  /** Arriving heads joined heads already standing there. Convergence, not conflict. */
  | {
      readonly kind: 'stackMerged';
      readonly player: PlayerId;
      readonly from: ArrowId;
      readonly to: ArrowId;
      readonly arriving: number;
      readonly existing: number;
      readonly total: number;
    }
  /** Contact combat on one arrow (§6.2). `holder` is whoever is left standing. */
  | {
      readonly kind: 'combat';
      readonly arrow: ArrowId;
      readonly attacker: PlayerId;
      readonly defender: PlayerId;
      readonly attackerSent: number;
      readonly defenderBefore: number;
      readonly attackerLost: number;
      readonly defenderLost: number;
      readonly holder: PlayerId | undefined;
    }
  /**
   * The loop closed. `boundary` is the trail that became territory — the actual
   * geometry of the loop, not a bounding box — and `claimed` is everything the
   * closure took.
   */
  | {
      readonly kind: 'enclosureClosed';
      readonly player: PlayerId;
      readonly closingArrow: ArrowId | undefined;
      readonly boundary: readonly ArrowId[];
      readonly claimed: readonly ArrowId[];
    }
  /** Ground that changed to this player. `fromArrow` anchors the fill in space. */
  | {
      readonly kind: 'territoryCaptured';
      readonly player: PlayerId;
      readonly arrows: readonly ArrowId[];
      readonly fromArrow: ArrowId | undefined;
      readonly takenFrom: readonly PlayerId[];
    }
  /** Ground this player no longer holds — a separate consequence from losing heads. */
  | {
      readonly kind: 'territoryLost';
      readonly player: PlayerId;
      readonly to: PlayerId | undefined;
      readonly arrows: readonly ArrowId[];
      readonly atArrow: ArrowId | undefined;
    }
  /** Trail destroyed by someone crossing it (§6.1). Severing, not damage. */
  | {
      readonly kind: 'trailCut';
      readonly victim: PlayerId;
      readonly attacker: PlayerId;
      readonly cutArrow: ArrowId | undefined;
      readonly arrows: readonly ArrowId[];
    }
  /** Encircled heads changed owner without moving (§6.3). */
  | {
      readonly kind: 'unitsConverted';
      readonly arrow: ArrowId;
      readonly from: PlayerId;
      readonly to: PlayerId;
      readonly heads: number;
    }
  /** Heads that appeared where no move put them — a spawner share paid out (§7). */
  | {
      readonly kind: 'unitsProduced';
      readonly player: PlayerId;
      readonly arrow: ArrowId;
      readonly amount: number;
    }
  /**
   * A seat that had pieces before this step and has none after (P39).
   * `arrows` is the remnant set — empty when the last land was captured.
   * Adapter-only; the engine still clears without a §6.1 trigger.
   */
  | {
      readonly kind: 'seatVanished';
      readonly player: PlayerId;
      readonly arrows: readonly ArrowId[];
    }
  | { readonly kind: 'turnPassed'; readonly from: PlayerId; readonly to: PlayerId }
  | { readonly kind: 'matchWon'; readonly player: PlayerId };

export type GameEventKind = GameEvent['kind'];

/** One applied move and the states either side of it. */
export interface AppliedStep {
  readonly before: GameState;
  readonly after: GameState;
  readonly move: Move;
}

