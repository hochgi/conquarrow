/**
 * docs/spec/spectated-turn-camera/spectated-turn-camera.edge-cases.feature
 * One it() per Gherkin scenario. Pure-module level only.
 */

import { describe, expect, it } from 'vitest';
import type { Move } from '@conquarrow/contracts';
import { applyMovesSequentially } from '../src/botPlayback';
import { DEFAULT_PREFS, parsePrefs, serializePrefs } from '../src/prefs';
import {
  FIT_CAP_RADIUS,
  FIT_PADDING,
  arrowsOfMove,
  boundsOf,
  cameraLocked,
  fitViewport,
  focusArrow,
  groupTarget,
  isSpectatedSeat,
  restoreTarget,
} from '../src/spectate';
import type { LatticeBounds } from '../src/spectate';
import { ZOOM } from '../src/viewport';
import { arrow, camera, ownedSet, pt, showsPoint, vp } from './spectated-turn-camera.support';
import {
  openingState,
  playbackOpts,
  recorder,
  stubRules,
  threeMoves,
} from './botPlayback.support';

const boundsAround = (halfW: number, halfH: number): LatticeBounds => ({
  minX: -(halfW - FIT_PADDING),
  maxX: halfW - FIT_PADDING,
  minY: -(halfH - FIT_PADDING),
  maxY: halfH - FIT_PADDING,
});

/** Half extents whose diagonal is exactly `FIT_CAP_RADIUS`. */
const capHalf = FIT_CAP_RADIUS / Math.SQRT2;
const capRadius = Math.hypot(capHalf, capHalf);

describe('Contexts where spectating is off entirely', () => {
  it('The tutorial owns its own camera', () => {
    expect(isSpectatedSeat({ seatKind: 'heuristic', online: false, tutorial: true })).toBe(false);
  });

  it('Online is out of scope until P49', () => {
    expect(isSpectatedSeat({ seatKind: 'heuristic', online: true, tutorial: false })).toBe(false);
  });

  it('Tutorial wins even over an online heuristic seat', () => {
    expect(isSpectatedSeat({ seatKind: 'heuristic', online: true, tutorial: true })).toBe(false);
  });
});

describe('A seat that has fled the field is cut to, not dollied to', () => {
  // P52 deleted the per-move bridging fit. A group past the cap is still cut to
  // — see spectated-camera-grouping.edge-cases, "A lone move beyond the fit cap".

  it('A fit exactly at the cap radius is not a hard cut', () => {
    const fit = fitViewport(boundsAround(capHalf, capHalf), vp(), capRadius);
    expect(fit.hardCut).toBe(false);
  });

  it('A fit one step past the cap radius is a hard cut', () => {
    const fit = fitViewport(boundsAround(capHalf + 0.5, capHalf + 0.5), vp(), capRadius);
    expect(fit.hardCut).toBe(true);
  });
});

describe('Degenerate geometry is well defined', () => {
  it('A single point still fits', () => {
    const bounds = boundsOf([pt(2, -3)]);
    expect(bounds).toEqual({ minX: 2, maxX: 2, minY: -3, maxY: -3 });
    if (bounds === undefined) return;
    const fit = fitViewport(bounds, vp());
    expect(fit.target.cx).toBeCloseTo(2, 10);
    expect(fit.target.cy).toBeCloseTo(-3, 10);
    expect(Number.isFinite(fit.target.scale)).toBe(true);
    expect(fit.target.scale).toBeGreaterThanOrEqual(ZOOM.min);
    expect(fit.target.scale).toBeLessThanOrEqual(ZOOM.max);
  });

  it('A move whose from and exit share a centroid still fits', () => {
    const { target } = groupTarget([pt(4, 4), pt(4, 4)], vp());
    expect(target.cx).toBeCloseTo(4, 10);
    expect(target.cy).toBeCloseTo(4, 10);
  });

  // P52: "no upcoming arrows means no hop" and "an empty previous beat" both
  // asked about `hopTargets`. A turn that names no arrow now plans no group —
  // spectated-camera-grouping.edge-cases, "A turn with nothing to look at".

  it('Negative lattice coordinates fit the same as positive ones', () => {
    const bounds = boundsOf([pt(-7, -9), pt(-4, -6)]);
    if (bounds === undefined) throw new Error('fixture: empty bounds');
    const fit = fitViewport(bounds, vp());
    expect(fit.target.cx).toBeCloseTo(-5.5, 10);
    expect(fit.target.cy).toBeCloseTo(-7.5, 10);
    expect(showsPoint(fit.target, vp(), pt(-7, -9))).toBe(true);
    expect(showsPoint(fit.target, vp(), pt(-4, -6))).toBe(true);
  });
});

describe('Sequential opponents restore once, at the end', () => {
  it('No restore between two spectated seats', () => {
    // The window stays open across the seat boundary: still locked, and the
    // boundary is an ordinary two-point fit from B's last move to C's first.
    expect(
      cameraLocked({ spectating: true, autoFocus: true, inReplayWindow: true, paused: false }),
    ).toBe(true);
    // P52: the boundary is one movement to seat C's first group, framed on
    // that group's beats alone — B's last move is not bridged from.
    const { target } = groupTarget([pt(4, 2), pt(5, 2)], vp());
    for (const p of [pt(4, 2), pt(5, 2)]) {
      expect(showsPoint(target, vp(), p)).toBe(true);
    }
    expect(showsPoint(target, vp(), pt(-40, 0))).toBe(false);
  });

  it('Restore when control returns to this client', () => {
    const saved = camera(0, 0, 48);
    const once = restoreTarget(saved, pt(40, 40), vp());
    // Restoring is idempotent: the single restore at the end of the run is the
    // whole of the movement, whatever the sequence of seats before it.
    expect(restoreTarget(saved, pt(40, 40), vp())).toEqual(once);
    expect(once).toEqual({ cx: 40, cy: 40, scale: 48 });
  });

  it('The camera is free while the next seat is deciding', () => {
    expect(
      cameraLocked({ spectating: true, autoFocus: true, inReplayWindow: false, paused: false }),
    ).toBe(false);
  });
});

describe('Pause holds; it does not free the camera', () => {
  it('The lock survives a pause', () => {
    expect(
      cameraLocked({ spectating: true, autoFocus: true, inReplayWindow: true, paused: true }),
    ).toBe(true);
  });

  it('The toggle is the escape hatch, not the pause', () => {
    expect(
      cameraLocked({ spectating: true, autoFocus: false, inReplayWindow: true, paused: true }),
    ).toBe(false);
  });
});

describe('The target stack chain bottoms out safely', () => {
  it('Nothing from this turn survived, so the lowest owned arrow wins', () => {
    expect(
      focusArrow({
        selectedAtCommit: arrow('s1'),
        turnExits: [arrow('e1'), arrow('e2')],
        owned: ownedSet('z9', 'a2', 'm5'),
      }),
    ).toBe(arrow('a2'));
  });

  it('The pick is reproducible whatever order the owned set was built in', () => {
    const forward = focusArrow({
      turnExits: [arrow('e1')],
      owned: ownedSet('z9', 'a2', 'm5'),
    });
    const backward = focusArrow({
      turnExits: [arrow('e1')],
      owned: ownedSet('m5', 'a2', 'z9'),
    });
    expect(forward).toBe(backward);
  });

  it('A player with no units gets no target', () => {
    const focus = focusArrow({
      selectedAtCommit: arrow('s1'),
      turnExits: [arrow('e1'), arrow('e2')],
      owned: ownedSet(),
    });
    expect(focus).toBeUndefined();
    const saved = camera(3, 4, 48);
    expect(restoreTarget(saved, undefined, vp())).toEqual(saved);
  });

  it('A turn in which nothing stepped contributes no exits', () => {
    expect(focusArrow({ turnExits: [], owned: ownedSet('k1') })).toBe(arrow('k1'));
  });

  it('A target exactly on the nudge margin counts as off screen', () => {
    // margin = min(800, 600) * 0.16 = 96 px; (0 - -4.25) * 48 = 204 up from the
    // screen centre, landing the target exactly on the top margin.
    const saved = camera(0, 0, 48);
    expect(restoreTarget(saved, pt(0, -4.25), vp())).toEqual({ cx: 0, cy: -4.25, scale: 48 });
  });
});

describe('Preferences are total and clamped', () => {
  it('A missing key gives the defaults', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toEqual({ autoFocus: true, playbackSpeed: 1 });
  });

  it('Malformed storage falls back rather than throwing', () => {
    for (const raw of ['', 'not json', '[]', '{"autoFocus":"yes"}']) {
      expect(() => parsePrefs(raw)).not.toThrow();
      expect(parsePrefs(raw)).toEqual({ autoFocus: true, playbackSpeed: 1 });
    }
  });

  it('Speed is clamped into range', () => {
    const rows = [
      { stored: '0.1', speed: 0.5 },
      { stored: '9', speed: 3 },
      { stored: '2.5', speed: 2.5 },
      { stored: 'null', speed: 1 },
    ] as const;
    for (const row of rows) {
      expect(parsePrefs(`{"autoFocus":true,"playbackSpeed":${row.stored}}`).playbackSpeed).toBe(
        row.speed,
      );
    }
  });

  it('Round-tripping preferences preserves them', () => {
    const prefs = { autoFocus: false, playbackSpeed: 2.5 };
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });
});

describe('The camera changes nothing about the game', () => {
  it('A spectated replay applies the same moves as an unspectated one', async () => {
    const moves: readonly Move[] = threeMoves();
    const run = async (withCamera: boolean): Promise<readonly Move[]> => {
      const { rules, applyCalls } = stubRules();
      const rec = recorder();
      const base = playbackOpts(rec);
      await applyMovesSequentially(rules, openingState(), moves, {
        ...base,
        onApplied: (move, after, index) => {
          if (withCamera) {
            // The camera reads the move; it never rewrites one.
            groupTarget(arrowsOfMove(move).map((_, k) => pt(index + k, 0)), vp());
          }
          base.onApplied(move, after, index);
        },
      });
      return applyCalls.map((call) => call.move);
    };
    const spectated = await run(true);
    const plain = await run(false);
    expect(spectated).toEqual(plain);
    expect(plain).toEqual([...moves]);
  });
});
