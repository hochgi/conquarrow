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
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '@conquarrow/contracts';
import { parsePersistedEnvelope, persistEnvelope } from '../src/game-snapshot';
import {
  decoratedMatch,
  realStates,
  reversedInsertion,
  storedStateOf,
  withFirstItemField,
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
