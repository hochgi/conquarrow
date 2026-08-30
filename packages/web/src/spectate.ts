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
import { bestPartition, greedyGroupCount } from './cameraGroups';
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

export interface Fit {
  readonly target: CameraTarget;
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

/** A turn's slice of a replay window, as indices into it. */
export interface TurnRange {
  /** Inclusive index into the window's moves. */
  readonly from: number;
  /** Exclusive. */
  readonly to: number;
}

/**
 * Where each turn of a replay window starts and ends: split after every
 * `endTurn`, with a trailing run its own turn.
 *
 * D15: a run that names no arrow is dropped wherever it sits, so no empty turn
 * is ever emitted and a window of nothing but `endTurn` yields no turn at all.
 *
 * This index form is the segmentation; `splitTurns` is its slice. A caller that
 * needs to map a turn back onto the window it came from takes the ranges and
 * keeps arithmetic, rather than matching moves back by identity — a reference
 * comparison on a value type has no place on a determinism-critical path.
 */
export const turnRanges = (moves: readonly Move[]): readonly TurnRange[] => {
  const out: TurnRange[] = [];
  let from = 0;
  const flush = (to: number): void => {
    const run = moves.slice(from, to);
    if (run.some((m) => arrowsOfMove(m).length > 0)) out.push({ from, to });
    from = to;
  };
  for (const [at, move] of moves.entries()) {
    if (move.kind === 'endTurn') flush(at + 1);
  }
  flush(moves.length);
  return out;
};

/** Split a replay window after every `endTurn`; a trailing run is its own turn. */
export const splitTurns = (moves: readonly Move[]): readonly (readonly Move[])[] =>
  turnRanges(moves).map((range) => moves.slice(range.from, range.to));

/** A zero-extent bounds at the origin, so every fit below is total. */
const ORIGIN_BOUNDS: LatticeBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * The largest scale at which every point fits the safe box. Uncapped and
 * unclamped: this is the *collection* scale pass 1 tests against the floor.
 */
export const groupScale = (points: readonly Pt[], viewport: Viewport): number => {
  const b = boundsOf(points) ?? ORIGIN_BOUNDS;
  const halfW = paddedHalf(b.minX, b.maxX);
  const halfH = paddedHalf(b.minY, b.maxY);
  return Math.min(
    (SAFE_BOX * viewport.width) / (2 * halfW),
    (SAFE_BOX * viewport.height) / (2 * halfH),
  );
};

/**
 * The display target for a group: centred on the midpoint of its beats, capped
 * at the ceiling and then globally clamped.
 *
 * D5: the floor governs collection, not display — there is no clamp against
 * `SPECTATE_ZOOM_MIN` here, so a singleton the camera had no choice about
 * showing zooms out past it rather than being cropped.
 */
export const groupTarget = (points: readonly Pt[], viewport: Viewport): Fit => {
  const b = boundsOf(points) ?? ORIGIN_BOUNDS;
  const halfW = paddedHalf(b.minX, b.maxX);
  const halfH = paddedHalf(b.minY, b.maxY);
  return {
    target: {
      cx: midpoint(b.minX, b.maxX),
      cy: midpoint(b.minY, b.maxY),
      scale: clampZoom(Math.min(groupScale(points, viewport), SPECTATE_ZOOM_MAX)),
    },
    hardCut: Math.hypot(halfW, halfH) > FIT_CAP_RADIUS,
  };
};

/**
 * Pass 1 fixes `k`, the number of camera movements the turn costs; pass 2
 * redistributes the beats into exactly `k` leximaxmin-best groups. Greedy's own
 * membership is discarded (D7), and the DP scores *display* scale, so surplus
 * zoom above the ceiling buys the allocation nothing (D9).
 */
export const planGroups = (
  beats: readonly (readonly Pt[])[],
  viewport: Viewport,
): readonly CameraGroup[] => {
  const n = beats.length;
  if (n === 0) return [];
  const pointsOf = (from: number, to: number): readonly Pt[] => beats.slice(from, to).flat();
  const k = greedyGroupCount(
    n,
    (from, to) => groupScale(pointsOf(from, to), viewport) >= SPECTATE_ZOOM_MIN,
  );
  const edges = bestPartition(n, k, (from, to) => {
    return groupTarget(pointsOf(from, to), viewport).target.scale;
  });
  const groups: CameraGroup[] = [];
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const from = edges[i] ?? 0;
    const to = edges[i + 1] ?? 0;
    const fit = groupTarget(pointsOf(from, to), viewport);
    groups.push({ from, to, target: fit.target, hardCut: fit.hardCut });
  }
  return groups;
};

/**
 * Is the next target indistinguishable from where the camera stands? Measured
 * against the camera *as it stands*, so suppression never accumulates drift.
 */
export const suppressed = (
  current: CameraTarget,
  next: CameraTarget,
  viewport: Viewport,
): boolean => {
  const panPx = Math.hypot(next.cx - current.cx, next.cy - current.cy) * current.scale;
  const panLimit = GROUP_MOVE_PAN_EPS * Math.min(viewport.width, viewport.height);
  const ratio = Math.max(next.scale / current.scale, current.scale / next.scale);
  return panPx <= panLimit && ratio - 1 <= GROUP_MOVE_SCALE_EPS;
};

/**
 * D14: P48's ease-out and ease-in merged into one duration, so a group boundary
 * reads as one gesture. The reading rhythm — gap, hold, turn-boundary hold — is
 * unchanged in value and in meaning, and reduced motion zeroes the tween only.
 */
export const groupTiming = (args: {
  readonly speed: number;
  readonly boundary: boolean;
  readonly reducedMotion: boolean;
}): GroupTiming => {
  const s = clampSpeed(args.speed);
  const scale = (ms: number): number => Math.round(ms / s);
  return {
    moveMs: args.reducedMotion ? 0 : scale(BASE_TIMING.easeOutMs + BASE_TIMING.easeInMs),
    holdMs: scale(args.boundary ? BASE_TIMING.seatHoldMs : BASE_TIMING.holdMs),
    gapMs: scale(BASE_TIMING.gapMs),
  };
};
