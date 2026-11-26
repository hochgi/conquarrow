/**
 * Pins for mutants the feature suite does not reach.
 *
 * P105: a `name` is kept only when it is a non-empty string, on a human or an
 * agent; `label` is never kept. The banner's owner is a usable agent name.
 * Other parse behaviour is unchanged: a non-string hash is absent, an unknown
 * kind fails the list.
 */

import { describe, expect, it } from 'vitest';
import { parseSeats } from '../src/online-parse';
import { onlineTurnSeat, type OnlineSeatFact } from '../src/turnBanner';
import { expectNoOwner } from './turn-banner.support';

const nameOf = (seat: object): string | undefined => {
  if (!Object.hasOwn(seat, 'name')) return undefined;
  const value = (seat as Record<string, unknown>)['name'];
  return typeof value === 'string' ? value : undefined;
};

describe('turn-banner mutation pins', () => {
  it('keeps a name only when it is a non-empty string, with or without a hash', () => {
    for (const kind of ['agent', 'human'] as const) {
      const empty = parseSeats([{ kind, userHash: 'me', name: '' }]);
      expect(empty?.[0]).toStrictEqual({ kind, userHash: 'me' });

      const numeric = parseSeats([{ kind, userHash: 'me', name: 1 }]);
      expect(numeric?.[0]).toStrictEqual({ kind, userHash: 'me' });
      expect(nameOf(numeric?.[0] ?? {})).toBeUndefined();

      const nameOnly = parseSeats([{ kind, name: 'Ada', label: 'Agent (Ada)' }]);
      expect(nameOnly?.[0]).toStrictEqual({ kind, name: 'Ada' });

      const hashOnly = parseSeats([{ kind, userHash: 'me' }]);
      expect(hashOnly?.[0]).toStrictEqual({ kind, userHash: 'me' });

      const neither = parseSeats([{ kind }]);
      expect(neither?.[0]).toStrictEqual({ kind });
    }
  });

  it('does not invent a hash, a label, or a chair the body did not name', () => {
    const bareHuman = parseSeats([{ kind: 'human' }]);
    expect(bareHuman?.[0]).toEqual({ kind: 'human' });
    expect(Object.hasOwn(bareHuman?.[0] ?? {}, 'userHash')).toBe(false);

    const badHash = parseSeats([{ kind: 'human', userHash: 1 }]);
    expect(badHash?.[0]).toEqual({ kind: 'human' });
    expect(Object.hasOwn(badHash?.[0] ?? {}, 'userHash')).toBe(false);

    const badAgentHash = parseSeats([{ kind: 'agent', userHash: 1, name: 'Ada' }]);
    expect(badAgentHash?.[0]).toStrictEqual({ kind: 'agent', name: 'Ada' });
    expect(Object.hasOwn(badAgentHash?.[0] ?? {}, 'userHash')).toBe(false);

    expect(parseSeats([{ kind: 'byok' }])).toBeUndefined();
  });

  it('a heuristic chair is other even when a hash is hanging off the object', () => {
    const hung = { kind: 'heuristic' as const, userHash: 'me' } as OnlineSeatFact;
    const seat = onlineTurnSeat({
      seats: [hung],
      userHash: 'me',
      players: ['A'],
      active: 'A',
    });
    expect(seat.kind).toBe('heuristic');
    expect(seat.relation).toBe('other');
    expectNoOwner(seat);
  });

  it('an agent name that is blank or a reserved seat word has no owner name', () => {
    for (const name of [' ', 'You', 'your agent', 'AI', 'Waiting', 'player a']) {
      expectNoOwner(onlineTurnSeat({ seats: [{ kind: 'agent', name }], players: ['A'], active: 'A' }));
    }
  });

  it('a named human chair carries no owner name (only agents feed the banner)', () => {
    const seat = onlineTurnSeat({ seats: [{ kind: 'human', userHash: 'x', name: 'Bob' }], players: ['A'], active: 'A' });
    expect(seat).toStrictEqual({ letter: 'A', kind: 'human', relation: 'other' });
  });

  it('an unusable agent name leaves no ownerName key at all', () => {
    const seat = onlineTurnSeat({ seats: [{ kind: 'agent', userHash: 'x', name: 'you' }], players: ['A'], active: 'A' });
    expect(seat).toStrictEqual({ letter: 'A', kind: 'agent', relation: 'other' });
  });
});
