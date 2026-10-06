/**
 * Invariants of the persisted `state.json`:
 *
 * 1. **Canonical bytes.** The stored form of a position does not depend on the
 *    order its maps and trail sets were filled in. Two equal positions persist
 *    to identical text — the property that keeps a stored state, and anything
 *    compared or replayed against it, free of iteration-order drift.
 * 2. **Persist is a fixed point of parse.** Re-persisting a parsed state
 *    reproduces the stored text exactly.
 * 3. **Hydration only yields values the type admits**, even from a record
 *    another writer corrupted: a speed override is `0`, `1` or absent, and a
 *    winner is a seat id or absent.
 *
 * P69 (docs/spec/online-hardening/online-hardening.md, Invariants):
 *
 * - **[NO-THROW]** a fixed catalogue of corruptions at every position of a
 *   stored record — no randomness — never throws out of the parser.
 * - **[ROUND-TRIP]** is the `state.json round-trips` block of the core suite,
 *   over every fixture in `realStates`.
 * - **[RANGES]**, **[MEMBERSHIP]** and one-entry-per-key, over every fixture
 *   that carries the section, with more values than the edge-case tables.
 * - **[SCHEME]** lives with the verifier, in `google-tokeninfo.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '@conquarrow/contracts';
import { parsePersistedEnvelope, persistEnvelope } from '../src/game-snapshot';
import {
  KEYED_SECTIONS,
  UNSEATED,
  decoratedMatch,
  envelopeOf,
  listOf,
  realStates,
  reversedInsertion,
  seatAt,
  seatsOf,
  storedStateOf,
  withFirstEntryRepeated,
  withFirstItem,
  withFirstItemField,
  withRetiredStreakPair,
  without,
} from './online-persistence-parse.support';

const parsedGame = (raw: string): GameState | undefined => parsePersistedEnvelope(raw)?.game;

describe('canonical bytes', () => {
  for (const [name, state] of realStates()) {
    it(`persists ${name} identically whatever its insertion order`, () => {
      const reversed = reversedInsertion(state);

      expect(reversed).toStrictEqual(state);
      expect(persistEnvelope(4, reversed)).toBe(persistEnvelope(4, state));
    });

    it(`re-persists a parsed ${name} to the same text`, () => {
      const stored = persistEnvelope(4, state);
      const game = parsedGame(stored);
      if (game === undefined) throw new Error('setup: the stored state did not parse');

      expect(persistEnvelope(4, game)).toBe(stored);
    });
  }
});

describe('hydration yields only admissible values', () => {
  const valid = storedStateOf(decoratedMatch());
  const strays: readonly unknown[] = [2, -1, '1', true, null];

  for (const stray of strays) {
    it(`never hydrates a speed override of ${JSON.stringify(stray)}`, () => {
      const game = parsedGame(
        JSON.stringify({ version: 1, state: withFirstItemField(valid, 'groups', 'speedOverride', stray) }),
      );

      const overrides = [...(game?.groups.values() ?? [])].map((group) => group.speedOverride);
      for (const override of overrides) {
        expect([undefined, 0, 1]).toContain(override);
      }
    });

    it(`never hydrates a winner of ${JSON.stringify(stray)}`, () => {
      const game = parsedGame(JSON.stringify({ version: 1, state: { ...valid, winner: stray } }));

      expect(game === undefined || game.winner === undefined || typeof game.winner === 'string').toBe(
        true,
      );
    });
  }
});

type Corruption = (stored: Record<string, unknown>) => Record<string, unknown>;

/** A corruption of one stored field, by name, that applies only when its section has an entry. */
interface Case {
  readonly name: string;
  readonly section?: string;
  readonly corrupt: Corruption;
}

const hasEntry = (stored: Record<string, unknown>, section: string | undefined): boolean =>
  section === undefined || listOf(stored, section).length > 0;

/** Every (fixture, case) pair the fixture can express; a case no fixture expresses is a setup error. */
const overFixtures = (
  cases: readonly Case[],
): readonly (readonly [string, Record<string, unknown>])[] => {
  const fixtures = realStates().map(([name, state]) => [name, storedStateOf(state)] as const);
  const rows: (readonly [string, Record<string, unknown>])[] = [];
  for (const { name, section, corrupt } of cases) {
    const applicable = fixtures.filter(([, stored]) => hasEntry(stored, section));
    if (applicable.length === 0) throw new Error(`setup: no fixture can express ${name}`);
    for (const [fixture, stored] of applicable) rows.push([`${name}, in ${fixture}`, corrupt(stored)]);
  }
  return rows;
};

const field =
  (section: string, key: string, value: unknown): Corruption =>
  (stored) =>
    withFirstItemField(stored, section, key, value);

const topLevel =
  (key: string, value: unknown): Corruption =>
  (stored) => ({ ...stored, [key]: value });

const show = (value: unknown): string => JSON.stringify(value);

describe('[NO-THROW] a corrupted position is refused or read, never thrown', () => {
  const strays: readonly unknown[] = [
    null,
    true,
    false,
    -1,
    0,
    0.5,
    1,
    2,
    3,
    1e308,
    -1e308,
    '',
    '0',
    '1',
    UNSEATED,
    [],
    [7],
    {},
    { num: 1, den: 0 },
  ];
  const valid = storedStateOf(decoratedMatch());
  const locations: (readonly [string, (value: unknown) => Record<string, unknown>])[] = [
    ['a player', (value) => ({ ...valid, players: [value, ...seatsOf(valid).slice(1)] })],
    ['the retired holder', (value) => withRetiredStreakPair(valid, value, 3)],
    ['the retired streak', (value) => withRetiredStreakPair(valid, seatAt(valid, 1), value)],
  ];
  for (const key of Object.keys(valid)) {
    locations.push([`the field ${key}`, (value) => ({ ...valid, [key]: value })]);
  }
  for (const section of KEYED_SECTIONS) {
    locations.push([`the first ${section} entry`, (value) => withFirstItem(valid, section, value)]);
    const first = listOf(valid, section)[0];
    for (const key of Object.keys(first as Record<string, unknown>)) {
      locations.push([`${section}[0].${key}`, (value) => withFirstItemField(valid, section, key, value)]);
    }
  }

  it.each(locations)('never throws whatever %s holds', (_location, corrupt) => {
    for (const stray of strays) {
      expect(() => parsePersistedEnvelope(envelopeOf(corrupt(stray))), show(stray)).not.toThrow();
    }
  });

  it.each(Object.keys(valid))('never throws when the field %s is absent', (key) => {
    expect(() => parsePersistedEnvelope(envelopeOf(without(valid, key)))).not.toThrow();
  });
});

describe('[RANGES] a field outside its contract range is refused, never clamped, dropped or defaulted', () => {
  const values = (
    label: string,
    section: string | undefined,
    corruptions: readonly (readonly [unknown, Corruption])[],
  ): Case[] =>
    corruptions.map(([value, corrupt]) =>
      section === undefined
        ? { name: `${label} ${show(value)}`, corrupt }
        : { name: `${label} ${show(value)}`, section, corrupt },
    );
  const inSection = (section: string, key: string, strays: readonly unknown[]): Case[] =>
    values(
      `${section}[0].${key} =`,
      section,
      strays.map((stray) => [stray, field(section, key, stray)] as const),
    );
  const atTop = (key: string, strays: readonly unknown[]): Case[] =>
    values(
      `${key} =`,
      undefined,
      strays.map((stray) => [stray, topLevel(key, stray)] as const),
    );

  const cases: readonly Case[] = [
    { name: 'no players', corrupt: topLevel('players', []) },
    { name: 'one player', corrupt: (stored) => ({ ...stored, players: [seatAt(stored, 0)] }) },
    {
      name: 'a seat listed twice',
      corrupt: (stored) => ({ ...stored, players: [...seatsOf(stored), seatAt(stored, 0)] }),
    },
    ...inSection('groups', 'heads', [0, -1, 1.5, 0.5]),
    ...inSection('groups', 'spent', [-1, 0.5, -0.5]),
    ...inSection('groups', 'speedOverride', [2, -1, 0.5, '0', '1', true, false]),
    ...inSection('spawners', 'phase', [-1, 3, 0.5, 1.5, 2.5]),
    ...inSection('starvationStreaks', 'streak', [-1, 0.5, 2.5]),
    ...atTop('dominationN', [0, -1, 0.5, 2.5]),
    ...atTop('winner', [7, true, {}, []]),
    ...[0.5, 2.5].map(
      (streak): Case => ({
        name: `a retired streak of ${show(streak)}`,
        corrupt: (stored) => withRetiredStreakPair(stored, seatAt(stored, 1), streak),
      }),
    ),
  ];

  it.each(overFixtures(cases))('refuses %s', (_name, corrupted) => {
    expect(parsePersistedEnvelope(envelopeOf(corrupted))).toBeUndefined();
  });

  it.each([0, -1])('reads a retired streak of %s as seeding nothing, as P36 documents', (streak) => {
    const valid = storedStateOf(decoratedMatch());

    const parsed = parsePersistedEnvelope(
      envelopeOf(withRetiredStreakPair(valid, seatAt(valid, 1), streak)),
    );

    expect(parsed?.game.starvationStreaks.size).toBe(0);
  });
});

describe('[MEMBERSHIP] no position loads naming a player who is not seated', () => {
  const cases: readonly Case[] = [
    { name: 'the active player', corrupt: topLevel('activePlayer', UNSEATED) },
    { name: 'the winner', corrupt: topLevel('winner', UNSEATED) },
    { name: "a group's owner", section: 'groups', corrupt: field('groups', 'owner', UNSEATED) },
    {
      name: "a territory arrow's owner",
      section: 'territory',
      corrupt: field('territory', 'owner', UNSEATED),
    },
    { name: "a trail's player", section: 'trails', corrupt: field('trails', 'player', UNSEATED) },
    {
      name: "a streak's player",
      section: 'starvationStreaks',
      corrupt: field('starvationStreaks', 'player', UNSEATED),
    },
    {
      name: 'the holder of a retired streak pair',
      corrupt: (stored) => withRetiredStreakPair(stored, UNSEATED, 3),
    },
  ];

  it.each(overFixtures(cases))(`refuses ${UNSEATED} as %s`, (_name, corrupted) => {
    expect(parsePersistedEnvelope(envelopeOf(corrupted))).toBeUndefined();
  });
});

describe('one entry per key: a keyed list naming a key twice is refused', () => {
  const cases: readonly Case[] = KEYED_SECTIONS.map((section) => ({
    name: `${section} repeating its first entry`,
    section,
    corrupt: (stored) => withFirstEntryRepeated(stored, section),
  }));

  it.each(overFixtures(cases))('refuses %s', (_name, corrupted) => {
    expect(parsePersistedEnvelope(envelopeOf(corrupted))).toBeUndefined();
  });
});
