/**
 * Fixtures for the online-persistence-parse suites: the records S3 holds
 * (`state.json` envelope, `invite.json`, `meta.json`, `log.jsonl` lines) and
 * the parsers / serialisers that turn them into typed values and back.
 *
 * Every position here is a **real** `GameState` — `makeMatch` plus
 * `makeRules(makeTiling()).apply` — optionally *decorated* with fields that a
 * short opening never reaches on its own (a speed override, a starvation
 * clock, a winner). Decoration only sets values the type admits; the parsers
 * are the system under test, not the rules.
 */

import type { ArrowId, GameState, Group, Move } from '@conquarrow/contracts';
import { endTurn } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { persistEnvelope } from '../src/game-snapshot';
import { openingMatch } from './support';

/**
 * Twelve plies of "first legal step, end the turn every third" from a 3-seat
 * opening: enough for live trails on two seats and accrued accumulators.
 */
export const playedMatch = (): GameState => {
  const rules = makeRules(makeTiling());
  let state = openingMatch(3);
  for (let ply = 0; ply < 12; ply += 1) {
    const found: Move | undefined = rules.legalMoves(state).find((move) => move.kind === 'step');
    state = rules.apply(state, found ?? endTurn());
    if (ply % 3 === 2) state = rules.apply(state, endTurn());
  }
  return state;
};

const withOverrides = (groups: ReadonlyMap<ArrowId, Group>): Map<ArrowId, Group> => {
  const decorated = new Map(groups);
  const [first, second] = [...groups.keys()];
  if (first === undefined || second === undefined) {
    throw new Error('setup: expected at least two groups to decorate');
  }
  const groupAt = (arrow: ArrowId): Group => {
    const group = groups.get(arrow);
    if (group === undefined) throw new Error('setup: group vanished');
    return group;
  };
  decorated.set(first, { ...groupAt(first), speedOverride: 0 });
  decorated.set(second, { ...groupAt(second), speedOverride: 1 });
  return decorated;
};

/**
 * A played position carrying every optional field: speed overrides `0` and `1`,
 * a two-seat starvation clock and a winner. Every map has at least two entries.
 */
export const decoratedMatch = (): GameState => {
  const played = playedMatch();
  const [first, second] = played.players;
  if (first === undefined || second === undefined) throw new Error('setup: expected seats');
  return {
    ...played,
    groups: withOverrides(played.groups),
    starvationStreaks: new Map([
      [second, 2],
      [first, 1],
    ]),
    winner: first,
  };
};

/** The positions every round-trip runs over. */
export const realStates = (): readonly (readonly [string, GameState])[] => [
  ['a 2-seat opening', openingMatch(2)],
  ['a 3-seat opening', openingMatch(3)],
  ['a 6-seat opening', openingMatch(6)],
  ['a played 3-seat position', playedMatch()],
  ['a decorated played position', decoratedMatch()],
];

const reversedMap = <K, V>(map: ReadonlyMap<K, V>): Map<K, V> => new Map([...map].reverse());

/** The same position with every map and trail set inserted in reverse order. */
export const reversedInsertion = (state: GameState): GameState => ({
  ...state,
  groups: reversedMap(state.groups),
  trails: new Map(
    [...state.trails].reverse().map(([player, arrows]) => [player, new Set([...arrows].reverse())]),
  ),
  territory: reversedMap(state.territory),
  accumulators: reversedMap(state.accumulators),
  spawners: reversedMap(state.spawners),
  starvationStreaks: reversedMap(state.starvationStreaks),
});

/** The `state` object of a persisted envelope, as plain JSON data. */
export const storedStateOf = (state: GameState): Record<string, unknown> => {
  const parsed = JSON.parse(persistEnvelope(0, state)) as { readonly state: Record<string, unknown> };
  return parsed.state;
};

/** The first element of a stored list section, as a record to corrupt. */
export const firstItemOf = (
  rec: Record<string, unknown>,
  section: string,
): Record<string, unknown> => {
  const list = rec[section];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`setup: stored section ${section} is empty`);
  }
  return list[0] as Record<string, unknown>;
};

/** `rec` with the first item of `section` replaced by `item`. */
export const withFirstItem = (
  rec: Record<string, unknown>,
  section: string,
  item: unknown,
): Record<string, unknown> => {
  const list: unknown = rec[section];
  if (!Array.isArray(list)) throw new Error(`setup: stored section ${section} is not a list`);
  const rest: readonly unknown[] = list.slice(1);
  return { ...rec, [section]: [item, ...rest] };
};

/** `rec` with the first item of `section` patched field-by-field. */
export const withFirstItemField = (
  rec: Record<string, unknown>,
  section: string,
  field: string,
  value: unknown,
): Record<string, unknown> =>
  withFirstItem(rec, section, { ...firstItemOf(rec, section), [field]: value });

/** `rec` without `field`. */
export const without = (rec: Record<string, unknown>, field: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(rec).filter(([key]) => key !== field));
