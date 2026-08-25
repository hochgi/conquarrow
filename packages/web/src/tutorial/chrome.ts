/**
 * Lesson chrome logic (P43) — pure decisions the shells render.
 *
 * React stays out of vitest; these are the functions the Lobby card, the dots
 * and the HUD label consume, tested headlessly.
 */

import { DEFAULT_MATCH_CONFIG } from '@conquarrow/contracts';
import type { MatchConfig } from '@conquarrow/contracts';
import type { ProgressStore } from './storage';

/** The first-run card shows iff no completion record exists and it was not dismissed. */
export const firstRunCardVisible = (store: ProgressStore): boolean =>
  store.completions().size === 0 && !store.cardDismissed();

export type DotState = 'complete' | 'current' | 'locked';

/**
 * Dot states for the ordered lesson ids: everything below the furthest
 * incomplete lesson is complete, that lesson is current, the rest locked.
 */
export const progressDots = (
  ids: readonly string[],
  completions: ReadonlySet<string>,
  current: string | undefined,
): readonly DotState[] =>
  ids.map((id) => {
    if (completions.has(id)) return 'complete';
    if (id === current) return 'current';
    return 'locked';
  });

const CONFIG_KEYS = Object.keys(DEFAULT_MATCH_CONFIG) as readonly (keyof MatchConfig)[];

/** True iff `config` differs from `DEFAULT_MATCH_CONFIG` in any field. */
export const practiceBoard = (config: MatchConfig): boolean =>
  CONFIG_KEYS.some((key) => config[key] !== DEFAULT_MATCH_CONFIG[key]);
