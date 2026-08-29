/**
 * Client preferences — one localStorage key, two controls (P48).
 *
 * `parsePrefs` / `serializePrefs` are pure and total: absent, empty, malformed
 * or wrong-typed storage falls back per field to `DEFAULT_PREFS`, and a speed
 * outside the range is clamped rather than rejected (D5). `loadPrefs` /
 * `savePrefs` do the storage touch, following the `seatPlan.ts` precedent.
 *
 * @see docs/spec/spectated-turn-camera/spectated-turn-camera.md
 */

import { clampSpeed } from './spectate';

export const PREFS_STORAGE_KEY = 'conquarrow:prefs';

export interface Prefs {
  readonly autoFocus: boolean;
  readonly playbackSpeed: number;
}

export const DEFAULT_PREFS: Prefs = { autoFocus: true, playbackSpeed: 1 };

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

const asRecord = (raw: string | null): Readonly<Record<string, unknown>> => {
  if (raw === null) return {};
  const parsed = parseJson(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  return parsed as Readonly<Record<string, unknown>>;
};

/** D5: total. Every field falls back independently; a stored speed is clamped. */
export const parsePrefs = (raw: string | null): Prefs => {
  const record = asRecord(raw);
  const autoFocus = record['autoFocus'];
  const speed = record['playbackSpeed'];
  return {
    autoFocus: typeof autoFocus === 'boolean' ? autoFocus : DEFAULT_PREFS.autoFocus,
    playbackSpeed: typeof speed === 'number' ? clampSpeed(speed) : DEFAULT_PREFS.playbackSpeed,
  };
};

export const serializePrefs = (prefs: Prefs): string => JSON.stringify(prefs);

export const loadPrefs = (): Prefs => {
  if (typeof localStorage === 'undefined') return DEFAULT_PREFS;
  return parsePrefs(localStorage.getItem(PREFS_STORAGE_KEY));
};

export const savePrefs = (prefs: Prefs): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PREFS_STORAGE_KEY, serializePrefs(prefs));
};
