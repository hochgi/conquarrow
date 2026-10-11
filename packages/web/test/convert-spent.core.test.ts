/**
 * docs/spec/convert-spent/convert-spent.core.feature — presentation scenarios.
 *
 * @see docs/spec/convert-spent/convert-spent.md
 */

import { describe, expect, it } from 'vitest';
import {
  CONVERSION_HANDOFF_MS,
  CONVERSION_SPECTATED_GAP_MS,
  conversionFrame,
  stepPlaybackGapMs,
} from '../src/conversionPlayback';
import { FX_OFFSET_MS } from '../src/fx/timing';
import { groupTiming, groupTarget } from '../src/spectate';
import { camera, pt, vp } from './spectated-turn-camera.support';
import {
  A,
  B,
  arrow,
  convertedEvent,
  inSafeBox,
  presentConversion,
} from './convert-spent.support';

describe('the hand-off sits on the tile', () => {
  it('One conversion plays a 700 ms hand-off after the cut', () => {
    const overlays = presentConversion([convertedEvent(arrow('a:convert'), 3)]);
    expect(overlays).toHaveLength(1);
    const overlay = overlays[0];
    expect(overlay?.kind).toBe('conversion');
    expect(overlay?.arrow).toBe(arrow('a:convert'));
    expect(overlay?.offsetMs).toBe(FX_OFFSET_MS.converted);
    expect(FX_OFFSET_MS.converted).toBe(300);
    expect(overlay?.durationMs).toBe(CONVERSION_HANDOFF_MS);
    expect(overlay?.heads).toBe(3);
    expect(overlay?.from).toBe(B);
    expect(overlay?.to).toBe(A);
  });

  it('Two conversions on one step share the hand-off', () => {
    const overlays = presentConversion([
      convertedEvent(arrow('a:one'), 1),
      convertedEvent(arrow('a:two'), 2),
    ]);
    expect(overlays).toHaveLength(2);
    for (const overlay of overlays) {
      expect(overlay.offsetMs).toBe(300);
      expect(overlay.durationMs).toBe(CONVERSION_HANDOFF_MS);
    }
  });

  it.each([1, 2, 3] as const)(
    'A spectated converting step waits out the hand-off and the hold (speed %i)',
    (speed) => {
      const gap = stepPlaybackGapMs({
        spectated: true,
        converted: true,
        reducedMotion: false,
        speed,
      });
      expect(gap).toBe(CONVERSION_SPECTATED_GAP_MS);
      expect(gap).toBe(1500);
    },
  );

  it('A spectated step that converts nothing keeps the ordinary gap', () => {
    const gap = stepPlaybackGapMs({
      spectated: true,
      converted: false,
      reducedMotion: false,
      speed: 2,
    });
    expect(gap).toBe(200);
    expect(gap).toBe(groupTiming({ speed: 2, boundary: false, reducedMotion: false }).gapMs);
  });
});

describe('the camera looks at the stack before the colours trade', () => {
  it('A converted stack outside the shot is framed first', () => {
    const viewport = vp();
    const current = camera(0, 0);
    const converted = pt(7, 0);
    const stepPoints = [pt(0, 0), pt(1, 0)] as const;
    expect(inSafeBox(current, viewport, converted)).toBe(false);

    const frame = conversionFrame({
      viewport,
      camera: current,
      stepPoints,
      convertedPoints: [converted],
      speed: 1,
      reducedMotion: false,
    });

    expect(inSafeBox(frame.target, viewport, converted)).toBe(true);
    for (const p of stepPoints) expect(inSafeBox(frame.target, viewport, p)).toBe(true);
    expect(frame.ease).toBe(true);
    expect(frame.handoffWaitMs).toBe(
      groupTiming({ speed: 1, boundary: false, reducedMotion: false }).moveMs,
    );
    expect(frame.target).toEqual(groupTarget([...stepPoints, converted], viewport).target);
  });

  it('A converted stack already in the shot does not move the camera', () => {
    const viewport = vp();
    const current = camera(0, 0);
    const converted = pt(0, 0);
    expect(inSafeBox(current, viewport, converted)).toBe(true);

    const frame = conversionFrame({
      viewport,
      camera: current,
      stepPoints: [pt(0.4, 0), pt(0.5, 0)],
      convertedPoints: [converted],
      speed: 1,
      reducedMotion: false,
    });

    expect(frame.target).toEqual(current);
    expect(frame.ease).toBe(false);
    expect(frame.handoffWaitMs).toBe(0);
  });
});
