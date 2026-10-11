/**
 * Spectated conversion hold and framing (P70).
 *
 * Pure: no clock, no DOM, no rAF. Overlay duration still lives on the
 * conversion overlay; this module only answers the gap before the next
 * spectated step and whether the camera must look at the converted stacks
 * before the hand-off starts.
 *
 * @see docs/spec/convert-spent/convert-spent.md
 */

import type { ArrowId, GameState, Move } from '@conquarrow/contracts';
import type { GameEvent } from './fx/events';
import { resolveEvents } from './fx/events';
import { FX_MS, FX_OFFSET_MS } from './fx/timing';
import type { CameraTarget, Fit, Pt } from './spectate';
import { arrowsOfMove, groupTarget, groupTiming, SAFE_BOX } from './spectate';
import { toScreen, type Viewport } from './viewport';

/** Four equal beats of the conversion hand-off (ms). Same as `FX_MS.converted`. */
export const CONVERSION_HANDOFF_MS = FX_MS.converted;
/** Stillness after the hand-off has settled. Spectated playback only (ms). */
export const CONVERSION_HOLD_MS = 500;
/** Offset + hand-off + hold. Unscaled. */
export const CONVERSION_SPECTATED_GAP_MS =
  FX_OFFSET_MS.converted + CONVERSION_HANDOFF_MS + CONVERSION_HOLD_MS;

export interface StepPlaybackGapArgs {
  readonly spectated: boolean;
  readonly converted: boolean;
  readonly reducedMotion: boolean;
  readonly speed: number;
}

export interface ConversionFrameArgs {
  readonly viewport: Viewport;
  readonly camera: CameraTarget;
  readonly stepPoints: readonly Pt[];
  readonly convertedPoints: readonly Pt[];
  readonly speed: number;
  readonly reducedMotion: boolean;
}

export interface ConversionFrame extends Fit {
  /** Ease to {@link ConversionFrame.target} before the hand-off. */
  readonly ease: boolean;
  /**
   * How long the hand-off waits for that ease (ms). Zero when the camera
   * stays put. Scales with playback speed, like every other camera move.
   */
  readonly handoffWaitMs: number;
}

export type ConversionEvent = Extract<GameEvent, { kind: 'unitsConverted' }>;

/** `unitsConverted` events of one applied step, in resolve order. */
export const conversionsOf = (
  before: GameState,
  after: GameState,
  move: Move,
): readonly ConversionEvent[] =>
  resolveEvents({ before, after, move }).filter(
    (event): event is ConversionEvent => event.kind === 'unitsConverted',
  );

/**
 * Gap before the next spectated step. A converting spectated step waits out
 * the hand-off and the hold, unscaled; everything else keeps today's scaled
 * ordinary gap.
 */
export const stepPlaybackGapMs = ({
  spectated,
  converted,
  reducedMotion,
  speed,
}: StepPlaybackGapArgs): number => {
  if (spectated && converted) {
    return reducedMotion ? CONVERSION_HOLD_MS : CONVERSION_SPECTATED_GAP_MS;
  }
  return groupTiming({ speed, boundary: false, reducedMotion }).gapMs;
};

const inSafeBox = (target: CameraTarget, viewport: Viewport, p: Pt): boolean => {
  const s = toScreen(
    { ...viewport, cx: target.cx, cy: target.cy, scale: target.scale },
    p.x,
    p.y,
  );
  const mx = (viewport.width * (1 - SAFE_BOX)) / 2;
  const my = (viewport.height * (1 - SAFE_BOX)) / 2;
  return (
    s.x >= mx - 1e-9 &&
    s.x <= viewport.width - mx + 1e-9 &&
    s.y >= my - 1e-9 &&
    s.y <= viewport.height - my + 1e-9
  );
};

const standingCamera = (viewport: Viewport): CameraTarget => ({
  cx: viewport.cx,
  cy: viewport.cy,
  scale: viewport.scale,
});

/**
 * Frame converted centroids that sit outside the current safe box. Several
 * stacks converted by one step share one `groupTarget` fit. Already-inside
 * leaves the camera put, so the hand-off can start at once.
 */
export const conversionFrame = (args: ConversionFrameArgs): ConversionFrame => {
  const stay: ConversionFrame = {
    target: args.camera,
    hardCut: false,
    ease: false,
    handoffWaitMs: 0,
  };
  const outside = args.convertedPoints.some(
    (p) => !inSafeBox(args.camera, args.viewport, p),
  );
  if (!outside) return stay;
  const fit = groupTarget([...args.stepPoints, ...args.convertedPoints], args.viewport);
  const moveMs = groupTiming({
    speed: args.speed,
    boundary: false,
    reducedMotion: args.reducedMotion,
  }).moveMs;
  return {
    target: fit.target,
    hardCut: fit.hardCut,
    ease: true,
    handoffWaitMs: fit.hardCut ? 0 : moveMs,
  };
};

export interface SpectatedConversionArgs {
  readonly before: GameState;
  readonly after: GameState;
  readonly move: Move;
  readonly spectated: boolean;
  readonly reducedMotion: boolean;
  readonly speed: number;
  readonly viewport: Viewport;
  readonly centroid: (id: ArrowId) => Pt;
}

export interface SpectatedConversion {
  readonly gapMs: number;
  readonly frame: ConversionFrame;
}

/** Gap and conversion framing for one applied playback step. */
export const spectatedConversion = (args: SpectatedConversionArgs): SpectatedConversion => {
  const converted = conversionsOf(args.before, args.after, args.move);
  return {
    gapMs: stepPlaybackGapMs({
      spectated: args.spectated,
      converted: converted.length > 0,
      reducedMotion: args.reducedMotion,
      speed: args.speed,
    }),
    frame: conversionFrame({
      viewport: args.viewport,
      camera: standingCamera(args.viewport),
      stepPoints: arrowsOfMove(args.move).map(args.centroid),
      convertedPoints: converted.map((event) => args.centroid(event.arrow)),
      speed: args.speed,
      reducedMotion: args.reducedMotion,
    }),
  };
};
