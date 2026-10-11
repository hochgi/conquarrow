/**
 * docs/spec/convert-spent/convert-spent.edge-cases.feature — presentation scenarios.
 *
 * @see docs/spec/convert-spent/convert-spent.md
 */

import { describe, expect, it } from 'vitest';
import {
  CONVERSION_HANDOFF_MS,
  CONVERSION_HOLD_MS,
  conversionFrame,
  stepPlaybackGapMs,
} from '../src/conversionPlayback';
import { FIT_CAP_RADIUS, groupTarget, groupTiming } from '../src/spectate';
import { camera, pt, vp } from './spectated-turn-camera.support';
import {
  animationDecl,
  animationNameOf,
  arrow,
  classFillOpacity,
  convertedEvent,
  inSafeBox,
  keyframeFillOpacities,
  presentConversion,
  stylesCss,
} from './convert-spent.support';

describe('the hold is spectated, and the paint is not a vanish', () => {
  it('Reduced motion holds without the alternation', () => {
    const gap = stepPlaybackGapMs({
      spectated: true,
      converted: true,
      reducedMotion: true,
      speed: 3,
    });
    expect(gap).toBe(CONVERSION_HOLD_MS);
    expect(gap).toBe(500);
  });

  it('A non-spectated converting step does not take the hold', () => {
    const gap = stepPlaybackGapMs({
      spectated: false,
      converted: true,
      reducedMotion: false,
      speed: 1,
    });
    expect(gap).toBe(400);
    expect(gap).toBe(groupTiming({ speed: 1, boundary: false, reducedMotion: false }).gapMs);
  });

  it('Two converted stacks share one fit', () => {
    const viewport = vp();
    const current = camera(0, 0);
    const converted = [pt(7, 0), pt(-7, 0)] as const;
    const stepPoints = [pt(0, 0), pt(1, 0)] as const;
    const frame = conversionFrame({
      viewport,
      camera: current,
      stepPoints,
      convertedPoints: converted,
      speed: 1,
      reducedMotion: false,
    });
    const expected = groupTarget([...stepPoints, ...converted], viewport);
    expect(frame.target).toEqual(expected.target);
    expect(frame.hardCut).toBe(expected.hardCut);
    for (const p of [...stepPoints, ...converted]) {
      expect(inSafeBox(frame.target, viewport, p)).toBe(true);
    }
    const overlays = presentConversion([
      convertedEvent(arrow('a:left'), 1),
      convertedEvent(arrow('a:right'), 1),
    ]);
    expect(overlays.map((o) => o.offsetMs)).toEqual([300, 300]);
    expect(overlays.map((o) => o.durationMs)).toEqual([CONVERSION_HANDOFF_MS, CONVERSION_HANDOFF_MS]);
    expect(frame.ease).toBe(true);
    expect(frame.handoffWaitMs).toBe(
      groupTiming({ speed: 1, boundary: false, reducedMotion: false }).moveMs,
    );
  });

  it('A span past the fit cap hard-cuts', () => {
    const viewport = vp();
    const converted = [pt(0, 0), pt(200, 0)] as const;
    const stepPoints = [pt(0, 0), pt(1, 0)] as const;
    const span = groupTarget([...stepPoints, ...converted], viewport);
    expect(Math.hypot(100 + 1.5, 1.5)).toBeGreaterThan(FIT_CAP_RADIUS);
    expect(span.hardCut).toBe(true);

    const frame = conversionFrame({
      viewport,
      camera: camera(0, 0),
      stepPoints,
      convertedPoints: converted,
      speed: 1,
      reducedMotion: false,
    });
    expect(frame.hardCut).toBe(true);
    expect(frame.target).toEqual(span.target);
  });

  it('The hand-off ends on the new colour and is not a vanish', () => {
    const css = stylesCss();
    const stops = keyframeFillOpacities(css, 'fx-convert-out');
    const at = Object.fromEntries(stops.map((s) => [s.at, s.opacity]));
    expect(at['0%']).toBe(1);
    expect(at['25%']).toBe(0);
    expect(at['50%']).toBe(1);
    expect(at['75%']).toBe(0);
    expect(at['100%']).toBe(0);
    expect(classFillOpacity(css, 'fx-convert-out')).toBe(0);
    expect(animationNameOf(css, 'fx-convert-out')).toBe('fx-convert-out');
    expect(animationNameOf(css, 'fx-convert-out')).not.toBe('fx-seat-vanish-fill');
    expect(animationDecl(css, 'fx-convert-out', 'animation-fill-mode')).toBe('forwards');
    expect(animationDecl(css, 'fx-convert-out', 'animation-timing-function')).toBe('step-end');
    expect(css).not.toContain('fx-convert-in');
    const vanishStops = keyframeFillOpacities(css, 'fx-seat-vanish-fill').map((s) => s.at);
    expect(vanishStops).toContain('12%');
    expect(stops.map((s) => s.at)).not.toContain('12%');
  });
});
