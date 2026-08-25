/**
 * Lesson copy (P43).
 *
 * Tunable numbers in copy are parameters filled from the lesson's config at
 * render time — a future retune (§11 item 25 expects one) must not leave the
 * tutorial lying. Only structural constants (girth 3, speed(2)=2, three
 * shares) may be literal, because they are theorems, not tuning values.
 */

import type { MatchConfig } from '@conquarrow/contracts';

const TEMPLATES: Record<string, (config: MatchConfig) => string> = {
  'starvation-rounds': (c) =>
    `Hold no spawner share for ${String(c.dominationN)} full rounds and your seat is lost.`,
  girth: () =>
    'The smallest pinwheel is 3 arrows around one vertex — and it captures that whole spawner.',
  'speed-pair': () => 'Two heads move as fast as two singles: doubling a stack adds one step.',
};

/** Render the copy template `key` against `config`. */
export const renderCopy = (key: string, config: MatchConfig): string => {
  const template = TEMPLATES[key];
  if (template === undefined) throw new Error(`tutorial: unknown copy key '${key}'`);
  return template(config);
};
