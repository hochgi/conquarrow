/**
 * `@conquarrow/rules-core` — the pure engine behind `RulesPort`.
 *
 * ```
 * makeRules(geometry): RulesPort
 * ```
 *
 * Depends on `@conquarrow/contracts` and nothing else. No clock, no randomness, no
 * I/O, no mutation of an input state (AGENTS.md, ADR 0001) — the whole appeal of
 * the design is that an attentive player, an AI search and a replay all compute
 * the same next state.
 *
 * P04 lands movement: allowance, splitting, merging and the turn loop.
 * Trails (P05), combat (P06), territory (P07) and the economy (P08) grow the same
 * `apply`.
 */

export { makeRules } from './movement';
export { compareArrows, comparePlayers, compareVertices } from './order';
export {
  headsOf,
  isLost,
  resolveLosses,
  shareCountOf,
  territoryCountOf,
  tickStarvation,
} from './victory';
export { replay, replayIsDeterministic } from './replay';
export type { ReplayOptions } from './replay';
