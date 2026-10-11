/**
 * Presentation EARS invariants of docs/spec/convert-spent/convert-spent.md.
 *
 * @see docs/spec/convert-spent/convert-spent.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import {
  CONVERSION_HOLD_MS,
  CONVERSION_SPECTATED_GAP_MS,
  conversionFrame,
  stepPlaybackGapMs,
} from '../src/conversionPlayback';
import { SPEED_MAX, SPEED_MIN, groupTiming } from '../src/spectate';
import { camera, pt, vp } from './spectated-turn-camera.support';
import {
  animationNameOf,
  classFillOpacity,
  inSafeBox,
  keyframeFillOpacities,
  stylesCss,
} from './convert-spent.support';

const SPEEDS = [SPEED_MIN, 1, 1.5, 2, SPEED_MAX] as const;

describe('P70 presentation invariants', () => {
  it('7. A spectated converting step does not start the next step until the hand-off and hold have elapsed', () => {
    for (const speed of SPEEDS) {
      expect(
        stepPlaybackGapMs({
          spectated: true,
          converted: true,
          reducedMotion: false,
          speed,
        }),
        `speed=${String(speed)}`,
      ).toBe(CONVERSION_SPECTATED_GAP_MS);
      expect(
        stepPlaybackGapMs({
          spectated: true,
          converted: true,
          reducedMotion: true,
          speed,
        }),
        `reduced speed=${String(speed)}`,
      ).toBe(CONVERSION_HOLD_MS);
    }
  });

  it('8. When a converted group lies outside the shot, the system frames it before the hand-off begins', () => {
    const viewport = vp();
    const current = camera(0, 0);
    const converted = pt(7, 0);
    expect(inSafeBox(current, viewport, converted)).toBe(false);
    const frame = conversionFrame({
      viewport,
      camera: current,
      stepPoints: [pt(0, 0), pt(1, 0)],
      convertedPoints: [converted],
      speed: 2,
      reducedMotion: false,
    });
    expect(inSafeBox(frame.target, viewport, converted)).toBe(true);
    expect(frame.ease).toBe(true);
    expect(frame.handoffWaitMs).toBe(
      groupTiming({ speed: 2, boundary: false, reducedMotion: false }).moveMs,
    );
    expect(frame.handoffWaitMs).toBeGreaterThan(0);
  });

  it('9. The system shall not present a conversion as flicker-then-fade', () => {
    const css = stylesCss();
    expect(animationNameOf(css, 'fx-convert-out')).toBe('fx-convert-out');
    expect(classFillOpacity(css, 'fx-convert-out')).toBe(0);
    const last = keyframeFillOpacities(css, 'fx-convert-out').find((s) => s.at === '100%');
    expect(last?.opacity).toBe(0);
    expect(keyframeFillOpacities(css, 'fx-convert-out').map((s) => s.at)).not.toEqual(
      keyframeFillOpacities(css, 'fx-seat-vanish-fill').map((s) => s.at),
    );
  });
});
