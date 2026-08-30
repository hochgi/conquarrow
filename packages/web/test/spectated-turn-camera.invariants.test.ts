/**
 * EARS invariants for docs/spec/spectated-turn-camera/spectated-turn-camera.md.
 * Property tests over deterministic generators — no `Math.random` anywhere.
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import type { ArrowId, Move } from '@conquarrow/contracts';
import type { SeatKind } from '../src/seatPlan';
import { DEFAULT_PREFS, PREFS_STORAGE_KEY, parsePrefs, serializePrefs } from '../src/prefs';
import {
  BASE_TIMING,
  OFFSCREEN_MARGIN_FRACTION,
  SPEED_MAX,
  SPEED_MIN,
  arrowsOfMove,
  boundsOf,
  cameraLocked,
  clampSpeed,
  fitViewport,
  focusArrow,
  groupTarget,
  groupTiming,
  isSpectatedSeat,
  restoreTarget,
} from '../src/spectate';
import { ZOOM, toScreen } from '../src/viewport';
import {
  arrow,
  camera,
  codeOf,
  pointCloud,
  prefsSource,
  pt,
  showsPoint,
  spectateSource,
  vp,
} from './spectated-turn-camera.support';

const SEAT_KINDS: readonly SeatKind[] = ['human', 'heuristic', 'byok'];
const BOOLS = [false, true] as const;
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233] as const;

describe('Trigger', () => {
  it('1: spectated exactly when not tutorial, not online, and not human', () => {
    for (const seatKind of SEAT_KINDS) {
      for (const online of BOOLS) {
        for (const tutorial of BOOLS) {
          expect(isSpectatedSeat({ seatKind, online, tutorial })).toBe(
            !tutorial && !online && seatKind !== 'human',
          );
        }
      }
    }
  });

  it('2: a running tutorial spectates no seat', () => {
    for (const seatKind of SEAT_KINDS) {
      for (const online of BOOLS) {
        expect(isSpectatedSeat({ seatKind, online, tutorial: true })).toBe(false);
      }
    }
  });

  it('3: an online match spectates no seat', () => {
    for (const seatKind of SEAT_KINDS) {
      expect(isSpectatedSeat({ seatKind, online: true, tutorial: false })).toBe(false);
    }
  });
});

describe('Lock', () => {
  it('4-7: the lock is exactly spectating and auto-focus and in-window', () => {
    for (const spectating of BOOLS) {
      for (const autoFocus of BOOLS) {
        for (const inReplayWindow of BOOLS) {
          for (const paused of BOOLS) {
            expect(cameraLocked({ spectating, autoFocus, inReplayWindow, paused })).toBe(
              spectating && autoFocus && inReplayWindow,
            );
          }
        }
      }
    }
  });

  it('6: pause never changes the lock', () => {
    for (const spectating of BOOLS) {
      for (const autoFocus of BOOLS) {
        for (const inReplayWindow of BOOLS) {
          const args = { spectating, autoFocus, inReplayWindow };
          expect(cameraLocked({ ...args, paused: true })).toBe(
            cameraLocked({ ...args, paused: false }),
          );
        }
      }
    }
  });
});

describe('Hops and fits', () => {
  const moves = (i: number): Move =>
    i % 2 === 0 ? step(arrow(`f${String(i)}`), arrow(`x${String(i)}`), 1) : endTurn();

  it('8: a step earns a hop, an endTurn does not', () => {
    for (let i = 0; i < 9; i += 1) {
      const move = moves(i);
      expect(arrowsOfMove(move).length).toBe(move.kind === 'step' ? 2 : 0);
    }
  });

  it('9: every fit scale lies within the zoom clamps', () => {
    for (const seed of SEEDS) {
      const bounds = boundsOf(pointCloud(seed, 4));
      if (bounds === undefined) throw new Error('generator produced no points');
      const { target } = fitViewport(bounds, vp());
      expect(target.scale).toBeGreaterThanOrEqual(ZOOM.min);
      expect(target.scale).toBeLessThanOrEqual(ZOOM.max);
    }
  });

  it('10: every fit contains every point it was asked to fit', () => {
    for (const seed of SEEDS) {
      const points = pointCloud(seed, 4);
      const bounds = boundsOf(points);
      if (bounds === undefined) throw new Error('generator produced no points');
      const { target, hardCut } = fitViewport(bounds, vp(), Number.POSITIVE_INFINITY);
      expect(hardCut).toBe(false);
      for (const p of points) expect(showsPoint(target, vp(), p)).toBe(true);
    }
  });

  // 11 and 12 were `hopTargets` invariants — the bridging tween and the empty
  // previous beat — and P52 deleted both along with the per-move hop. The cap
  // itself is still asserted above, and on a group in the P52 suite.
  it('11: past the cap the camera cuts rather than dollies', () => {
    for (const seed of SEEDS) {
      const far = pointCloud(seed, 2).map((p) => pt(p.x + 400, p.y + 400));
      expect(groupTarget([pt(0, 0), ...far], vp()).hardCut).toBe(true);
    }
  });

  it('12: a group is framed on its own beats alone', () => {
    for (const seed of SEEDS) {
      const next = pointCloud(seed, 2);
      const bounds = boundsOf(next);
      if (bounds === undefined) continue;
      const { target } = groupTarget(next, vp());
      expect(target.cx).toBeCloseTo(fitViewport(bounds, vp()).target.cx, 10);
      expect(target.cy).toBeCloseTo(fitViewport(bounds, vp()).target.cy, 10);
    }
  });

  it('13: a turn boundary holds for seatHoldMs, an ordinary group for holdMs', () => {
    expect(groupTiming({ speed: 1, boundary: true, reducedMotion: false }).holdMs).toBe(
      BASE_TIMING.seatHoldMs,
    );
    expect(groupTiming({ speed: 1, boundary: false, reducedMotion: false }).holdMs).toBe(
      BASE_TIMING.holdMs,
    );
  });
});

describe('Restore', () => {
  it('14, 16: the restore is one pure function of the one saved camera', () => {
    // No per-seat state: the same saved camera and focus always restore alike,
    // however many spectated seats ran in between.
    const saved = camera(2, -3, 48);
    const first = restoreTarget(saved, pt(30, 30), vp());
    const again = restoreTarget(saved, pt(30, 30), vp());
    expect(again).toEqual(first);
    expect(restoreTarget(first, pt(30, 30), vp())).toEqual(first);
  });

  it('15: spectate.ts holds no captured camera of its own', () => {
    expect(/^(let|var)\s/m.test(codeOf(spectateSource()))).toBe(false);
  });

  it('17: a visible target restores the saved camera unchanged', () => {
    const saved = camera(0, 0, 48);
    for (const seed of SEEDS) {
      const [p] = pointCloud(seed, 1);
      if (p === undefined) continue;
      const focus = pt(p.x / 20, p.y / 20);
      const s = toScreen({ ...vp(), cx: saved.cx, cy: saved.cy, scale: saved.scale }, focus.x, focus.y);
      const margin = Math.min(vp().width, vp().height) * OFFSCREEN_MARGIN_FRACTION;
      const visible =
        s.x > margin && s.x < vp().width - margin && s.y > margin && s.y < vp().height - margin;
      if (!visible) continue;
      expect(restoreTarget(saved, focus, vp())).toEqual(saved);
    }
  });

  it('18: an off-screen target re-centres and keeps the saved scale', () => {
    const saved = camera(0, 0, 48);
    for (const seed of SEEDS) {
      const [p] = pointCloud(seed, 1);
      if (p === undefined) continue;
      const focus = pt(p.x + 100, p.y + 100);
      expect(restoreTarget(saved, focus, vp())).toEqual({
        cx: focus.x,
        cy: focus.y,
        scale: saved.scale,
      });
    }
  });

  it('19: no target stack restores the saved camera unchanged', () => {
    for (const seed of SEEDS) {
      const [p] = pointCloud(seed, 1);
      if (p === undefined) continue;
      const saved = camera(p.x, p.y, 48);
      expect(restoreTarget(saved, undefined, vp())).toEqual(saved);
    }
  });
});

describe('Target stack', () => {
  const owned = (...ids: readonly string[]): ReadonlySet<ArrowId> => new Set(ids.map(arrow));

  it('20: the first still-owned of selection then exits in reverse play order', () => {
    const exits = [arrow('e1'), arrow('e2'), arrow('e3')];
    const chain: readonly ArrowId[] = [arrow('s1'), arrow('e3'), arrow('e2'), arrow('e1')];
    for (let cut = 0; cut < chain.length; cut += 1) {
      const survivor = chain[cut];
      if (survivor === undefined) continue;
      expect(
        focusArrow({ selectedAtCommit: arrow('s1'), turnExits: exits, owned: new Set([survivor]) }),
      ).toBe(survivor);
    }
  });

  it('21: nothing from the turn owned falls back to the lowest owned ArrowId', () => {
    const ids = ['m5', 'a2', 'z9', 'b0'];
    const expected = [...ids].sort()[0];
    if (expected === undefined) throw new Error('fixture');
    expect(
      focusArrow({
        selectedAtCommit: arrow('s1'),
        turnExits: [arrow('e1')],
        owned: owned(...ids),
      }),
    ).toBe(arrow(expected));
    expect(focusArrow({ turnExits: [], owned: owned() })).toBeUndefined();
  });

  it('22: the pick never depends on Set insertion order', () => {
    const ids = ['m5', 'a2', 'z9', 'b0', 'a10'];
    const picks = new Set<string>();
    for (let rot = 0; rot < ids.length; rot += 1) {
      const rotated = [...ids.slice(rot), ...ids.slice(0, rot)];
      const pick = focusArrow({ turnExits: [arrow('e1')], owned: owned(...rotated) });
      picks.add(String(pick));
    }
    expect(picks.size).toBe(1);
  });
});

describe('Determinism and timing', () => {
  it('23: equal inputs yield equal targets, timings and target stacks', () => {
    for (const seed of SEEDS) {
      const prev = pointCloud(seed, 2);
      const next = pointCloud(seed + 1000, 2);
      expect(groupTarget([...prev, ...next], vp())).toEqual(
        groupTarget([...prev, ...next], vp()),
      );
      const timing = { speed: 1.75, boundary: seed % 2 === 0, reducedMotion: false };
      expect(groupTiming(timing)).toEqual(groupTiming(timing));
      const args = { turnExits: [arrow('e1')], owned: new Set([arrow('e1')]) };
      expect(focusArrow(args)).toBe(focusArrow(args));
    }
  });

  it('24: speed scales the group tween, hold and gap together', () => {
    for (const speed of [0.5, 0.75, 1, 1.5, 2, 3] as const) {
      const t = groupTiming({ speed, boundary: false, reducedMotion: false });
      expect(t).toEqual({
        moveMs: Math.round((BASE_TIMING.easeOutMs + BASE_TIMING.easeInMs) / speed),
        holdMs: Math.round(BASE_TIMING.holdMs / speed),
        gapMs: Math.round(BASE_TIMING.gapMs / speed),
        restoreMs: Math.round(BASE_TIMING.easeInMs / speed),
      });
    }
  });

  // P52 D18 / invariant 25a. The restore is not a group boundary: it keeps P48
  // D8's ease-in alone, so merging the boundary's two tweens must not have
  // doubled it. 300 ms at speed 1, never 560.
  it('25a: the restore runs for the ease-in alone, not the merged boundary tween', () => {
    for (const speed of [0.5, 1, 2, 3] as const) {
      const t = groupTiming({ speed, boundary: false, reducedMotion: false });
      expect(t.restoreMs).toBe(Math.round(BASE_TIMING.easeInMs / speed));
      expect(t.restoreMs).toBeLessThan(t.moveMs);
    }
    expect(groupTiming({ speed: 1, boundary: false, reducedMotion: false }).restoreMs).toBe(300);
    expect(groupTiming({ speed: 1, boundary: false, reducedMotion: true }).restoreMs).toBe(0);
  });

  it('25: playback speed is clamped to [0.5, 3]', () => {
    for (const n of [-5, 0, 0.1, 0.5, 1, 3, 9, 1e9]) {
      const c = clampSpeed(n);
      expect(c).toBeGreaterThanOrEqual(SPEED_MIN);
      expect(c).toBeLessThanOrEqual(SPEED_MAX);
    }
    expect(clampSpeed(Number.NaN)).toBe(1);
    expect(clampSpeed(Number.POSITIVE_INFINITY)).toBe(SPEED_MAX);
  });

  it('26: reduced motion zeroes the tween and still produces a group target', () => {
    for (const speed of [0.5, 1, 3] as const) {
      const t = groupTiming({ speed, boundary: false, reducedMotion: true });
      expect(t.moveMs).toBe(0);
      expect(t.holdMs).toBe(Math.round(BASE_TIMING.holdMs / speed));
      expect(t.gapMs).toBe(Math.round(BASE_TIMING.gapMs / speed));
    }
    expect(groupTarget([pt(3, 0), pt(4, 0)], vp()).target).toBeDefined();
  });

  it('27: spectate.ts does not scale or reference the fx timing budgets', () => {
    expect(codeOf(spectateSource())).not.toMatch(/fx\/timing/);
  });
});

describe('Preferences', () => {
  it('28: exactly one storage key, and it is conquarrow:prefs', () => {
    expect(PREFS_STORAGE_KEY).toBe('conquarrow:prefs');
    const keys = prefsSource().match(/'conquarrow:[^']*'/g) ?? [];
    expect(new Set(keys)).toEqual(new Set(["'conquarrow:prefs'"]));
  });

  it('29: absent or malformed preferences fall back to the defaults without throwing', () => {
    const raws: readonly (string | null)[] = [
      null,
      '',
      '   ',
      'not json',
      '[]',
      'null',
      '0',
      '"prefs"',
      '{',
      '{"autoFocus":"yes"}',
      '{"playbackSpeed":"fast"}',
      '{"playbackSpeed":null}',
      '{"autoFocus":1,"playbackSpeed":{}}',
    ];
    for (const raw of raws) {
      expect(() => parsePrefs(raw)).not.toThrow();
      expect(parsePrefs(raw)).toEqual(DEFAULT_PREFS);
    }
    expect(parsePrefs(serializePrefs(DEFAULT_PREFS))).toEqual(DEFAULT_PREFS);
  });

  it('30: neither module reaches for a clock, a random source, or the DOM', () => {
    const src = codeOf(spectateSource());
    for (const banned of [/\bDate\b/, /Math\.random/, /performance\./, /\bdocument\b/, /\bwindow\b/, /localStorage/, /requestAnimationFrame/]) {
      expect(src).not.toMatch(banned);
    }
    const prefs = codeOf(prefsSource());
    for (const banned of [/\bDate\b/, /Math\.random/, /\bdocument\b/]) {
      expect(prefs).not.toMatch(banned);
    }
    // `parsePrefs` itself must touch no storage — only load/save may.
    const parser = prefs.slice(prefs.indexOf('export const parsePrefs'), prefs.indexOf('export const loadPrefs'));
    expect(parser).not.toMatch(/localStorage/);
  });

  it('31: spectate.ts alters no move, order or GameState', () => {
    const src = codeOf(spectateSource());
    expect(src).not.toMatch(/rules-core/);
    expect(src).not.toMatch(/GameState/);
    expect(src).not.toMatch(/\.apply\(/);
  });
});
