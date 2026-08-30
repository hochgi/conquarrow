/**
 * Resolved events → timed, spatially anchored overlays.
 *
 * This is where the effect *vocabulary* lives. There are eleven metaphors and every
 * event maps onto one of them, which is the only reason a player can learn the
 * language without being told it:
 *
 *   | metaphor      | overlay                        | means                    |
 *   |---------------|--------------------------------|--------------------------|
 *   | completion    | `loopPulse`                    | the loop closed          |
 *   | spatial fill  | `captureFill` / `captureFresh` | this ground became mine  |
 *   | retraction    | `lossRetract`                  | this ground is not mine  |
 *   | severing      | `cutSnap` + `evaporate`        | a trail was cut          |
 *   | impact        | `combat`                       | heads fought here        |
 *   | divergence    | `divergence` / `sentry`        | one stack became two     |
 *   | convergence   | `convergence`                  | two stacks became one    |
 *   | emergence     | `emergence`                    | heads were produced      |
 *   | transfer      | `conversion`                   | heads changed owner      |
 *   | motion        | `advance` / `trailLaid`         | a routine step           |
 *   | disappearance | `seatVanish`                   | the seat left            |
 *
 * A new event kind picks an existing metaphor or it does not ship — except
 * disappearance. Reusing `evaporate` would teach a vanished seat as a cut.
 *
 * Pure. The clock arrives from the adapter when an overlay is queued, never here.
 */

import type { ArrowId, GeometryPort, PlayerId } from '@conquarrow/contracts';
import type { AppliedStep, GameEvent } from './events';
import { resolveEvents } from './events';
import { borderOf, staggerFrom } from './spatial';
import {
  FX_MS,
  FX_OFFSET_MS,
  FX_STAGGER_CAP_MS,
  FX_STAGGER_MS,
  tierOf,
  type FxTier,
} from './timing';

/** Why a click did nothing. Localized feedback, never a modal (Event 11). */
export type RefusalReason =
  | 'not-yours'
  | 'out-of-reach'
  | 'no-exit'
  | 'would-convert';
// P34's `needs-stay-behind` is **retired by P35**. It told the player to lower the
// carry before clicking, and that gesture is gone: the offer now arms the attack
// itself, walking the run at the tip's heads and again at one fewer, so an
// attackable adjacent arrow is simply clickable. Nothing left the reason could
// truthfully describe — the states it still reached were a terminal tip and the
// depth cap, where no count makes the arrow clickable and "an attack must leave a
// head behind" would have been a lie. Those fall through to `out-of-reach`.

export const REFUSAL_TEXT: Readonly<Record<RefusalReason, string>> = {
  'not-yours': 'Not your stack',
  'out-of-reach': 'Too far this turn',
  'no-exit': 'Nowhere to go from here',
  'would-convert': 'No trail home — those heads would flip',
};

/** One arrow inside an overlay, with its own delay from the overlay's origin. */
export interface FxCell {
  readonly arrow: ArrowId;
  readonly delayMs: number;
}

interface FxBase {
  /** Deterministic given (sequence number, kind, anchor). */
  readonly id: string;
  /** When this link of the causal chain starts, relative to the move (ms). */
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly tier: FxTier;
}

export type FxOverlay =
  | (FxBase & {
      readonly kind: 'loopPulse';
      readonly player: PlayerId;
      readonly cells: readonly FxCell[];
      readonly closingArrow: ArrowId | undefined;
    })
  | (FxBase & {
      readonly kind: 'captureFill';
      readonly player: PlayerId;
      readonly cells: readonly FxCell[];
      readonly takenFrom: readonly PlayerId[];
    })
  | (FxBase & {
      readonly kind: 'captureFresh';
      readonly player: PlayerId;
      readonly cells: readonly FxCell[];
    })
  | (FxBase & {
      readonly kind: 'lossRetract';
      readonly player: PlayerId;
      readonly to: PlayerId | undefined;
      readonly cells: readonly FxCell[];
    })
  | (FxBase & {
      readonly kind: 'evaporate';
      readonly victim: PlayerId;
      readonly attacker: PlayerId;
      readonly cutArrow: ArrowId | undefined;
      readonly cells: readonly FxCell[];
    })
  | (FxBase & {
      readonly kind: 'cutSnap';
      readonly arrow: ArrowId;
      readonly victim: PlayerId;
      readonly attacker: PlayerId;
    })
  | (FxBase & {
      readonly kind: 'combat';
      readonly arrow: ArrowId;
      readonly attacker: PlayerId;
      readonly defender: PlayerId;
      readonly attackerLost: number;
      readonly defenderLost: number;
      readonly holder: PlayerId | undefined;
      readonly heavy: boolean;
    })
  | (FxBase & {
      readonly kind: 'divergence';
      readonly player: PlayerId;
      readonly from: ArrowId;
      readonly to: ArrowId;
      readonly moved: number;
      readonly stayed: number;
    })
  | (FxBase & {
      readonly kind: 'convergence';
      readonly player: PlayerId;
      readonly from: ArrowId;
      readonly to: ArrowId;
      readonly total: number;
    })
  | (FxBase & {
      readonly kind: 'sentry';
      readonly player: PlayerId;
      readonly arrow: ArrowId;
      readonly heads: number;
    })
  | (FxBase & {
      readonly kind: 'emergence';
      readonly player: PlayerId;
      readonly arrow: ArrowId;
      readonly amount: number;
    })
  | (FxBase & {
      readonly kind: 'conversion';
      readonly arrow: ArrowId;
      readonly from: PlayerId;
      readonly to: PlayerId;
      readonly heads: number;
    })
  | (FxBase & {
      readonly kind: 'seatVanish';
      readonly player: PlayerId;
      readonly cells: readonly FxCell[];
    })
  | (FxBase & {
      readonly kind: 'trailLaid';
      readonly player: PlayerId;
      readonly cells: readonly FxCell[];
    })
  | (FxBase & {
      readonly kind: 'advance';
      readonly player: PlayerId;
      readonly from: ArrowId;
      readonly to: ArrowId;
      readonly heads: number;
    })
  | (FxBase & {
      readonly kind: 'refusal';
      readonly arrow: ArrowId;
      readonly reason: RefusalReason;
    })
  | (FxBase & {
      readonly kind: 'turnHandover';
      readonly from: PlayerId;
      readonly to: PlayerId;
    });

export type FxOverlayKind = FxOverlay['kind'];

/**
 * Ceiling on cells in one overlay. A hundred-tile capture reads exactly as well
 * with the near hundred-and-twenty animated and the rest simply arriving as
 * territory — which they do, because the board renders state, not the overlay.
 */
export const MAX_FX_CELLS = 120;

/** Extra offset per step of a multi-step trip, so a trip reads as a sequence. */
export const FX_STEP_GAP_MS = 130;
const FX_STEP_GAP_CAP_MS = 520;

export interface PresentOptions {
  /** Needed for spatial staggering; without it every cell fires together. */
  readonly geometry?: GeometryPort | undefined;
  /** Monotonic counter for ids. Never a clock — ids must be reproducible. */
  readonly seq: number;
}

const cellsFor = (
  arrows: readonly ArrowId[],
  geometry: GeometryPort | undefined,
  seed: ArrowId | undefined,
  stepMs: number,
): readonly FxCell[] => {
  const kept = arrows.slice(0, MAX_FX_CELLS);
  const delays = staggerFrom(geometry, seed, kept, stepMs, FX_STAGGER_CAP_MS);
  return kept.map((arrow) => ({ arrow, delayMs: delays.get(String(arrow)) ?? 0 }));
};

/** Cells in one line, no spatial walk — for effects that are already a single place. */
const flatCells = (arrows: readonly ArrowId[]): readonly FxCell[] =>
  arrows.slice(0, MAX_FX_CELLS).map((arrow) => ({ arrow, delayMs: 0 }));

/** The outline of a region, for the marker that says "this area is new". */
const outlineCells = (
  arrows: readonly ArrowId[],
  geometry: GeometryPort | undefined,
): readonly FxCell[] =>
  flatCells(geometry === undefined ? arrows : borderOf(geometry, arrows));

interface Counter {
  seq: number;
  produced: number;
}

const idFor = (counter: Counter, kind: string, anchor: string): string => {
  counter.seq += 1;
  return `fx-${String(counter.seq)}-${kind}-${anchor}`;
};

const base = (
  counter: Counter,
  kind: FxOverlayKind,
  anchor: string,
  offsetMs: number,
  durationMs: number,
): FxBase => ({
  id: idFor(counter, kind, anchor),
  offsetMs,
  durationMs,
  tier: tierOf(kind),
});

// One function per metaphor family, so no single switch grows past reading size.

const presentStack = (
  event: GameEvent,
  counter: Counter,
): readonly FxOverlay[] => {
  switch (event.kind) {
    case 'moved':
      return [
        {
          ...base(counter, 'advance', String(event.to), FX_OFFSET_MS.closing, FX_MS.moved),
          kind: 'advance',
          player: event.player,
          from: event.from,
          to: event.to,
          heads: event.heads,
        },
      ];
    case 'stackSplit':
      return [
        {
          ...base(counter, 'divergence', String(event.to), FX_OFFSET_MS.closing, FX_MS.split),
          kind: 'divergence',
          player: event.player,
          from: event.from,
          to: event.to,
          moved: event.moved,
          stayed: event.stayed,
        },
      ];
    case 'sentryLeft':
      return [
        {
          ...base(counter, 'sentry', String(event.arrow), 60, FX_MS.sentry),
          kind: 'sentry',
          player: event.player,
          arrow: event.arrow,
          heads: event.heads,
        },
      ];
    case 'stackMerged':
      return [
        {
          ...base(counter, 'convergence', String(event.to), FX_OFFSET_MS.closing, FX_MS.merge),
          kind: 'convergence',
          player: event.player,
          from: event.from,
          to: event.to,
          total: event.total,
        },
      ];
    case 'combat': {
      const heavy = event.attackerLost + event.defenderLost >= 3;
      return [
        {
          ...base(
            counter,
            'combat',
            String(event.arrow),
            FX_OFFSET_MS.closing,
            heavy ? FX_MS.combatHeavy : FX_MS.combat,
          ),
          kind: 'combat',
          arrow: event.arrow,
          attacker: event.attacker,
          defender: event.defender,
          attackerLost: event.attackerLost,
          defenderLost: event.defenderLost,
          holder: event.holder,
          heavy,
        },
      ];
    }
    default:
      return [];
  }
};

const presentGround = (
  event: GameEvent,
  counter: Counter,
  geometry: GeometryPort | undefined,
): readonly FxOverlay[] => {
  switch (event.kind) {
    case 'trailLaid':
      return [
        {
          ...base(
            counter,
            'trailLaid',
            String(event.arrows[0] ?? 'none'),
            FX_OFFSET_MS.closing,
            FX_MS.trailLaid,
          ),
          kind: 'trailLaid',
          player: event.player,
          cells: flatCells(event.arrows),
        },
      ];
    case 'enclosureClosed': {
      // The pulse follows the loop's own geometry from the closing arrow — a
      // screen-centre flash would not say *which* loop closed.
      const cells = cellsFor(event.boundary, geometry, event.closingArrow, FX_STAGGER_MS.loop);
      if (cells.length === 0) return [];
      return [
        {
          ...base(
            counter,
            'loopPulse',
            String(event.closingArrow ?? event.boundary[0] ?? 'none'),
            FX_OFFSET_MS.loop,
            FX_MS.closed,
          ),
          kind: 'loopPulse',
          player: event.player,
          cells,
          closingArrow: event.closingArrow,
        },
      ];
    }
    case 'territoryCaptured': {
      const anchor = String(event.fromArrow ?? event.arrows[0] ?? 'none');
      return [
        {
          ...base(counter, 'captureFill', anchor, FX_OFFSET_MS.captureFill, FX_MS.captured),
          kind: 'captureFill',
          player: event.player,
          cells: cellsFor(event.arrows, geometry, event.fromArrow, FX_STAGGER_MS.captureFill),
          takenFrom: event.takenFrom,
        },
        {
          ...base(counter, 'captureFresh', anchor, FX_OFFSET_MS.captureFresh, FX_MS.captureFresh),
          kind: 'captureFresh',
          player: event.player,
          // The outline, not every tile: one region reading as one event.
          cells: outlineCells(event.arrows, geometry),
        },
      ];
    }
    case 'territoryLost':
      return [
        {
          ...base(
            counter,
            'lossRetract',
            String(event.atArrow ?? event.arrows[0] ?? 'none'),
            FX_OFFSET_MS.lost,
            FX_MS.lost,
          ),
          kind: 'lossRetract',
          player: event.player,
          to: event.to,
          cells: cellsFor(event.arrows, geometry, event.atArrow, FX_STAGGER_MS.lost),
        },
      ];
    default:
      return [];
  }
};

const presentDestruction = (
  event: GameEvent,
  counter: Counter,
  geometry: GeometryPort | undefined,
): readonly FxOverlay[] => {
  if (event.kind !== 'trailCut') return [];
  const out: FxOverlay[] = [];
  if (event.cutArrow !== undefined) {
    out.push({
      ...base(counter, 'cutSnap', String(event.cutArrow), FX_OFFSET_MS.closing, FX_MS.cut * 0.6),
      kind: 'cutSnap',
      arrow: event.cutArrow,
      victim: event.victim,
      attacker: event.attacker,
    });
  }
  out.push({
    ...base(
      counter,
      'evaporate',
      String(event.cutArrow ?? event.arrows[0] ?? 'none'),
      FX_OFFSET_MS.cut,
      FX_MS.cut,
    ),
    kind: 'evaporate',
    victim: event.victim,
    attacker: event.attacker,
    cutArrow: event.cutArrow,
    cells: cellsFor(event.arrows, geometry, event.cutArrow, FX_STAGGER_MS.cut),
  });
  return out;
};

const presentArrivals = (event: GameEvent, counter: Counter): readonly FxOverlay[] => {
  switch (event.kind) {
    case 'unitsProduced': {
      // Several births in one batch emerge one after another — ten simultaneous
      // spawn flashes read as noise, a short cascade reads as a count.
      const extra = Math.min(counter.produced * FX_STAGGER_MS.produced, FX_STAGGER_CAP_MS);
      counter.produced += 1;
      return [
        {
          ...base(
            counter,
            'emergence',
            String(event.arrow),
            FX_OFFSET_MS.produced + extra,
            FX_MS.produced,
          ),
          kind: 'emergence',
          player: event.player,
          arrow: event.arrow,
          amount: event.amount,
        },
      ];
    }
    case 'unitsConverted':
      return [
        {
          ...base(
            counter,
            'conversion',
            String(event.arrow),
            FX_OFFSET_MS.converted,
            FX_MS.converted,
          ),
          kind: 'conversion',
          arrow: event.arrow,
          from: event.from,
          to: event.to,
          heads: event.heads,
        },
      ];
    case 'turnPassed':
      return [
        {
          ...base(counter, 'turnHandover', String(event.to), FX_OFFSET_MS.closing, FX_MS.turn),
          kind: 'turnHandover',
          from: event.from,
          to: event.to,
        },
      ];
    default:
      return [];
  }
};

/** Disappearance: remnants flicker together. Do not reuse evaporate. */
const presentVanish = (event: GameEvent, counter: Counter): readonly FxOverlay[] => {
  if (event.kind !== 'seatVanished' || event.arrows.length === 0) return [];
  return [
    {
      ...base(
        counter,
        'seatVanish',
        String(event.arrows[0] ?? event.player),
        FX_OFFSET_MS.vanish,
        FX_MS.vanish,
      ),
      kind: 'seatVanish',
      player: event.player,
      cells: flatCells(event.arrows),
    },
  ];
};

/** Map a resolved event list onto overlays. Order in, order out. */
export const presentEvents = (
  events: readonly GameEvent[],
  options: PresentOptions,
): readonly FxOverlay[] => {
  const counter: Counter = { seq: options.seq, produced: 0 };
  const out: FxOverlay[] = [];
  for (const event of events) {
    out.push(
      ...presentStack(event, counter),
      ...presentGround(event, counter, options.geometry),
      ...presentDestruction(event, counter, options.geometry),
      ...presentArrivals(event, counter),
      ...presentVanish(event, counter),
    );
  }
  return out;
};

/**
 * Resolve and present a batch of applied steps, offsetting each step.
 *
 * A trip is several `apply` calls and the engine has already run all of them; the
 * gap here is purely so the eye can follow the order they happened in.
 */
export const presentSteps = (
  steps: readonly AppliedStep[],
  options: PresentOptions,
): readonly FxOverlay[] => {
  const out: FxOverlay[] = [];
  let seq = options.seq;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step === undefined) continue;
    const gap = Math.min(i * FX_STEP_GAP_MS, FX_STEP_GAP_CAP_MS);
    const overlays = presentEvents(resolveEvents(step), { ...options, seq });
    for (const overlay of overlays) {
      out.push({ ...overlay, offsetMs: overlay.offsetMs + gap });
    }
    seq += overlays.length + 1;
  }
  return out;
};

/** A refusal is not a state transition — input reports it directly (Event 11). */
export const presentRefusal = (
  arrow: ArrowId,
  reason: RefusalReason,
  seq: number,
): Extract<FxOverlay, { kind: 'refusal' }> => ({
  id: `fx-${String(seq)}-refusal-${String(arrow)}`,
  offsetMs: 0,
  durationMs: FX_MS.refused,
  tier: tierOf('refusal'),
  kind: 'refusal',
  arrow,
  reason,
});

/** Total wall-clock this overlay occupies, offset and slowest cell included. */
export const overlayLifetimeMs = (overlay: FxOverlay): number => {
  let cellMax = 0;
  if ('cells' in overlay) {
    for (const cell of overlay.cells) cellMax = Math.max(cellMax, cell.delayMs);
  }
  return overlay.offsetMs + cellMax + overlay.durationMs;
};
