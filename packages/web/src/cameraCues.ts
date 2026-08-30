/**
 * P52 — the bridge between a window of `Move`s and the camera plan.
 *
 * Pure: no clock, no rAF, no DOM. `spectate.ts` deliberately never sees a
 * `Move` or a centroid (D2), so the mapping lives here, one step out. Both
 * drivers — online `playBatch` and local bot playback — call this, which is
 * what makes invariant 28 structural rather than a convention.
 *
 * @see docs/spec/spectated-camera-grouping/spectated-camera-grouping.md
 */

import type { ArrowId, Move } from '@conquarrow/contracts';
import type { CameraTarget, Pt } from './spectate';
import { arrowsOfMove, planGroups, turnRanges } from './spectate';
import type { Viewport } from './viewport';

/** What the camera does before the move at this index plays. */
export interface CameraCue {
  readonly target: CameraTarget;
  readonly hardCut: boolean;
  /** The group opens a turn, so the hold is `seatHoldMs` rather than `holdMs`. */
  readonly boundary: boolean;
}

/**
 * One cue per move of `moves`, or `undefined` where the camera stays put: on a
 * move that names no arrow, and on every move of a group but its first.
 *
 * Indices line up with `moves` itself, so a driver can look a cue up by the
 * playback index it already has. Turns are planned one at a time (D4) and never
 * merged, including a seat's consecutive turns.
 */
export const cameraCues = (
  moves: readonly Move[],
  centroid: (id: ArrowId) => Pt,
  viewport: Viewport,
): readonly (CameraCue | undefined)[] => {
  const cues: (CameraCue | undefined)[] = moves.map(() => undefined);
  for (const range of turnRanges(moves)) {
    // Where each of this turn's beats sits in `moves`, in play order. The range
    // is arithmetic into `moves`, so there is no matching a turn back by
    // identity and no assumption that the turns tile the window without gaps.
    const indices: number[] = [];
    const beats: (readonly Pt[])[] = [];
    for (let at = range.from; at < range.to; at += 1) {
      const move = moves[at];
      const ids = move === undefined ? [] : arrowsOfMove(move);
      if (ids.length > 0) {
        indices.push(at);
        beats.push(ids.map(centroid));
      }
    }
    for (const [n, group] of planGroups(beats, viewport).entries()) {
      const index = indices[group.from];
      if (index === undefined) continue;
      // D16: the first group of every turn is a turn boundary, the first turn
      // of a replay window included.
      cues[index] = { target: group.target, hardCut: group.hardCut, boundary: n === 0 };
    }
  }
  return cues;
};
