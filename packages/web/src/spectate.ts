/**
 * Spectated-turn camera — pure decisions for a turn decided elsewhere.
 *
 * P48. Web adapter only: no game rule is read, written, or implied. Pure —
 * no clock, no rAF, no DOM, no localStorage, no layout import. App owns the
 * clock and the tween runner; every decision the runner consumes lives here.
 *
 * D1: this module speaks lattice points, not arrows-plus-layout. App maps
 * `ArrowId -> {x, y}` through `arrowCentroid` and passes points in.
 *
 * @see docs/spec/spectated-turn-camera/spectated-turn-camera.md
 */

import type { ArrowId, Move } from '@conquarrow/contracts';
import type { SeatKind } from './seatPlan';
import { clampZoom, toScreen } from './viewport';
import type { Viewport } from './viewport';

export interface CameraTarget {
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
}

export interface LatticeBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export interface HopTiming {
  readonly easeOutMs: number;
  readonly easeInMs: number;
  readonly holdMs: number;
  readonly gapMs: number;
}

export interface Fit {
  readonly target: CameraTarget;
  readonly hardCut: boolean;
}

export interface Hop {
  readonly wide: CameraTarget | undefined;
  readonly close: CameraTarget;
  readonly hardCut: boolean;
}

/** Lattice units of slack around a fit; > 0, so a zero-extent bounds is well defined. */
export const FIT_PADDING = 1.5;
/** Beyond this padded half-diagonal, hard-cut instead of dollying. */
export const FIT_CAP_RADIUS = 24;
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;
export const BASE_TIMING = {
  easeOutMs: 260,
  easeInMs: 300,
  holdMs: 150,
  seatHoldMs: 400,
  gapMs: 400,
} as const;
/** Mirrors App's post-move nudge margin. */
export const OFFSCREEN_MARGIN_FRACTION = 0.16;

const midpoint = (min: number, max: number): number => (min + max) / 2;

const paddedHalf = (min: number, max: number): number => (max - min) / 2 + FIT_PADDING;

/** Whose seat the online seat to move is (P49 D6). Unknown defaults to ours. */
export type OwnSeat = 'ours' | 'theirs';

/**
 * Is the seat to move driven by somebody other than whoever is at this keyboard?
 *
 * P48 D2: `online` is a distinct parameter precisely so P49 can add its clause
 * here. P49 D6: online, a seat that is not this client's is spectated; `ownSeat`
 * unknown defaults to *ours*, so an online game with no `/me` yet behaves as it
 * did before P49.
 */
export const isSpectatedSeat = (args: {
  readonly seatKind: SeatKind;
  readonly online: boolean;
  readonly tutorial: boolean;
  readonly ownSeat?: OwnSeat;
}): boolean => {
  if (args.tutorial) return false;
  if (args.online) return args.ownSeat === 'theirs';
  return args.seatKind !== 'human';
};

/**
 * D4: `paused` is accepted and deliberately unused — bot pause stops credit
 * burn, it does not hand the camera back. The toggle is the escape hatch.
 */
export const cameraLocked = (args: {
  readonly spectating: boolean;
  readonly autoFocus: boolean;
  readonly inReplayWindow: boolean;
  readonly paused: boolean;
}): boolean => args.spectating && args.autoFocus && args.inReplayWindow;

/** A step names the two arrows worth looking at; an endTurn names none. */
export const arrowsOfMove = (move: Move): readonly ArrowId[] =>
  move.kind === 'step' ? [move.from, move.exit] : [];

export const boundsOf = (points: readonly Pt[]): LatticeBounds | undefined =>
  points.reduce<LatticeBounds | undefined>(
    (acc, p) =>
      acc === undefined
        ? { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
        : {
            minX: Math.min(acc.minX, p.x),
            minY: Math.min(acc.minY, p.y),
            maxX: Math.max(acc.maxX, p.x),
            maxY: Math.max(acc.maxY, p.y),
          },
    undefined,
  );

/**
 * Frame `bounds` inside `viewport`. `FIT_PADDING > 0` keeps a zero-extent
 * bounds well defined, so there is no division by zero even for a single point.
 */
export const fitViewport = (
  bounds: LatticeBounds,
  viewport: Viewport,
  cap: number = FIT_CAP_RADIUS,
): Fit => {
  const halfW = paddedHalf(bounds.minX, bounds.maxX);
  const halfH = paddedHalf(bounds.minY, bounds.maxY);
  return {
    target: {
      cx: midpoint(bounds.minX, bounds.maxX),
      cy: midpoint(bounds.minY, bounds.maxY),
      scale: clampZoom(Math.min(viewport.width / (2 * halfW), viewport.height / (2 * halfH))),
    },
    hardCut: Math.hypot(halfW, halfH) > cap,
  };
};

/**
 * The camera work for one move: a bridging fit over the previous beat and the
 * upcoming one, then a close fit over the upcoming one alone.
 *
 * D3: past the cap the bridge is dropped entirely rather than dollied — a seat
 * that has fled the field is cut to.
 */
export const hopTargets = (
  prev: readonly Pt[],
  next: readonly Pt[],
  viewport: Viewport,
  cap: number = FIT_CAP_RADIUS,
): Hop | undefined => {
  const closeBounds = boundsOf(next);
  if (closeBounds === undefined) return undefined;
  const close = fitViewport(closeBounds, viewport, cap).target;
  const wideBounds = boundsOf([...prev, ...next]);
  if (wideBounds === undefined || prev.length === 0) {
    return { wide: undefined, close, hardCut: false };
  }
  const bridge = fitViewport(wideBounds, viewport, cap);
  return bridge.hardCut
    ? { wide: undefined, close, hardCut: true }
    : { wide: bridge.target, close, hardCut: false };
};

/**
 * The arrow the restore nudges to: the selection at commit, then this turn's
 * step exits latest-first, then the lowest owned `ArrowId`. The final fallback
 * sorts rather than reading `Set` order, which would be a defect.
 */
export const focusArrow = (args: {
  readonly selectedAtCommit?: ArrowId;
  readonly turnExits: readonly ArrowId[];
  readonly owned: ReadonlySet<ArrowId>;
}): ArrowId | undefined => {
  const chain: readonly ArrowId[] = [
    ...(args.selectedAtCommit === undefined ? [] : [args.selectedAtCommit]),
    ...[...args.turnExits].reverse(),
  ];
  const survivor = chain.find((id) => args.owned.has(id));
  if (survivor !== undefined) return survivor;
  return [...args.owned].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))[0];
};

/**
 * Restore the saved camera exactly, re-centring only when the target stack is
 * off screen — the existing post-move policy, which keeps the saved scale.
 */
export const restoreTarget = (
  saved: CameraTarget,
  focus: Pt | undefined,
  viewport: Viewport,
): CameraTarget => {
  if (focus === undefined) return saved;
  const s = toScreen(
    { ...viewport, cx: saved.cx, cy: saved.cy, scale: saved.scale },
    focus.x,
    focus.y,
  );
  const margin = Math.min(viewport.width, viewport.height) * OFFSCREEN_MARGIN_FRACTION;
  const visible =
    s.x > margin &&
    s.x < viewport.width - margin &&
    s.y > margin &&
    s.y < viewport.height - margin;
  return visible ? saved : { cx: focus.x, cy: focus.y, scale: saved.scale };
};

/**
 * `NaN` — a stored value that is not a number at all — falls back to 1;
 * everything ordered, including an infinity, clamps into range.
 */
export const clampSpeed = (n: number): number => {
  if (Number.isNaN(n)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, n));
};

/**
 * D6: reduced motion zeroes the tween durations only. The holds and the move
 * gap stay, because they are reading time, not motion.
 */
export const hopTiming = (args: {
  readonly speed: number;
  readonly seatBoundary: boolean;
  readonly reducedMotion: boolean;
}): HopTiming => {
  const s = clampSpeed(args.speed);
  const scale = (ms: number): number => Math.round(ms / s);
  return {
    easeOutMs: args.reducedMotion ? 0 : scale(BASE_TIMING.easeOutMs),
    easeInMs: args.reducedMotion ? 0 : scale(BASE_TIMING.easeInMs),
    holdMs: scale(args.seatBoundary ? BASE_TIMING.seatHoldMs : BASE_TIMING.holdMs),
    gapMs: scale(BASE_TIMING.gapMs),
  };
};

/* -------------------------------------------------------------------------- *
 * P52 — camera grouping. Tuning block; every number here is a knob, not a
 * finding, and is expected to move after the first play-test.
 * @see docs/spec/spectated-camera-grouping/spectated-camera-grouping.md
 * -------------------------------------------------------------------------- */

/** Floor: how far out grouping will zoom to *collect* moves. Governs collection, not display (D5). */
export const SPECTATE_ZOOM_MIN = 30;
/** Ceiling: how far in a tight group may punch. */
export const SPECTATE_ZOOM_MAX = 56;
/** Fraction of each viewport dimension a group's beats must fit inside. */
export const SAFE_BOX = 0.72;
/** Suppression: pan threshold as a fraction of the shorter viewport side. */
export const GROUP_MOVE_PAN_EPS = 0.04;
/** Suppression: scale-ratio threshold. */
export const GROUP_MOVE_SCALE_EPS = 0.03;

/** A maximal run of consecutive beats framed in a single shot. */
export interface CameraGroup {
  /** Inclusive index into the turn's beats. */
  readonly from: number;
  /** Exclusive. */
  readonly to: number;
  readonly target: CameraTarget;
  readonly hardCut: boolean;
}

export interface GroupTiming {
  readonly moveMs: number;
  readonly holdMs: number;
  readonly gapMs: number;
}

/** Split a replay window after every `endTurn`; a trailing run is its own turn. */
export const splitTurns = (_moves: readonly Move[]): readonly (readonly Move[])[] => [];

/** The largest scale at which every point fits the safe box. Uncapped, unclamped. */
export const groupScale = (_points: readonly Pt[], _viewport: Viewport): number => 0;

/** The display target for a group: centred on the midpoint, capped at the ceiling. */
export const groupTarget = (_points: readonly Pt[], _viewport: Viewport): Fit => ({
  target: { cx: 0, cy: 0, scale: 0 },
  hardCut: false,
});

/** Pass 1 fixes `k`; pass 2 redistributes into exactly `k` leximaxmin-best groups. */
export const planGroups = (
  _beats: readonly (readonly Pt[])[],
  _viewport: Viewport,
): readonly CameraGroup[] => [];

/** Is the next target indistinguishable from where the camera stands? */
export const suppressed = (
  _current: CameraTarget,
  _next: CameraTarget,
  _viewport: Viewport,
): boolean => false;

/** D14: P48's ease-out and ease-in merged into one duration. Reading rhythm unchanged. */
export const groupTiming = (_args: {
  readonly speed: number;
  readonly boundary: boolean;
  readonly reducedMotion: boolean;
}): GroupTiming => ({ moveMs: 0, holdMs: 0, gapMs: 0 });
