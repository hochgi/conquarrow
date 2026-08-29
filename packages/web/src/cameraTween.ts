/**
 * The rAF tween runner for the spectated-turn camera (P48).
 *
 * A thin clock owner with no decision in it: every target it interpolates
 * towards is a `spectate.ts` value, and every duration is a `hopTiming` one.
 * Deliberately untested — see the "Deliberately untested" section of
 * docs/spec/spectated-turn-camera/spectated-turn-camera.md.
 */

import type { CameraTarget } from './spectate';
import type { Viewport } from './viewport';

export interface CameraTween {
  /** Ease to `target` over `ms`; `ms <= 0` is a hard cut. Resolves when done. */
  readonly run: (target: CameraTarget, ms: number) => Promise<void>;
  /** Drop an in-flight tween, leaving the camera wherever it got to. */
  readonly cancel: () => void;
}

/** Smoothstep — no overshoot, so a hop never sails past its own fit. */
const ease = (k: number): number => k * k * (3 - 2 * k);

const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export const createCameraTween = (
  read: () => Viewport,
  write: (target: CameraTarget) => void,
): CameraTween => {
  let frame: number | undefined;
  let settle: (() => void) | undefined;

  const finish = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    const done = settle;
    settle = undefined;
    done?.();
  };

  const run = (target: CameraTarget, ms: number): Promise<void> => {
    finish();
    if (ms <= 0) {
      write(target);
      return Promise.resolve();
    }
    const from = read();
    const started = performance.now();
    return new Promise<void>((resolve) => {
      settle = resolve;
      const tick = (now: number): void => {
        const k = Math.min(1, (now - started) / ms);
        const e = ease(k);
        write({
          cx: mix(from.cx, target.cx, e),
          cy: mix(from.cy, target.cy, e),
          scale: mix(from.scale, target.scale, e),
        });
        if (k < 1) {
          frame = requestAnimationFrame(tick);
          return;
        }
        finish();
      };
      frame = requestAnimationFrame(tick);
    });
  };

  return { run, cancel: finish };
};
