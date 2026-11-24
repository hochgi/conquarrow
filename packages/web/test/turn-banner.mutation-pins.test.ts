/**
 * Pins for mutants the feature suite does not reach.
 *
 * D5: a label is kept only when it is a non-empty string on an agent.
 * An owner name exists only between `Agent (` and the last `)`.
 * Other parse behaviour is unchanged: a non-string hash is absent, an unknown
 * kind fails the list.
 */

import { describe, expect, it } from 'vitest';
import { parseSeats } from '../src/online-parse';
import { onlineTurnSeat, type OnlineSeatFact } from '../src/turnBanner';
import { expectNoOwner } from './turn-banner.support';

const labelOf = (seat: object): string | undefined => {
  if (!Object.hasOwn(seat, 'label')) return undefined;
  const value = (seat as Record<string, unknown>)['label'];
  return typeof value === 'string' ? value : undefined;
};

describe('turn-banner mutation pins', () => {
  it('keeps an agent label only when it is a non-empty string, with or without a hash', () => {
    const empty = parseSeats([{ kind: 'agent', userHash: 'me', label: '' }]);
    const emptySeat = empty?.[0];
    if (emptySeat === undefined) throw new Error('setup: empty-label agent did not parse');
    expect(emptySeat.kind).toBe('agent');
    expect(Object.hasOwn(emptySeat, 'label')).toBe(false);
    expect(Object.hasOwn(emptySeat, 'userHash')).toBe(true);

    const numeric = parseSeats([{ kind: 'agent', userHash: 'me', label: 1 }]);
    const numericSeat = numeric?.[0];
    if (numericSeat === undefined) throw new Error('setup: numeric-label agent did not parse');
    expect(Object.hasOwn(numericSeat, 'label')).toBe(false);
    expect(labelOf(numericSeat)).toBeUndefined();

    const labelOnly = parseSeats([{ kind: 'agent', label: 'Agent (Ada)' }]);
    expect(labelOnly?.[0]).toEqual({ kind: 'agent', label: 'Agent (Ada)' });
    expect(Object.hasOwn(labelOnly?.[0] ?? {}, 'userHash')).toBe(false);

    const hashOnly = parseSeats([{ kind: 'agent', userHash: 'me' }]);
    expect(hashOnly?.[0]).toEqual({ kind: 'agent', userHash: 'me' });
    expect(Object.hasOwn(hashOnly?.[0] ?? {}, 'label')).toBe(false);

    const neither = parseSeats([{ kind: 'agent' }]);
    expect(neither?.[0]).toEqual({ kind: 'agent' });
    expect(Object.hasOwn(neither?.[0] ?? {}, 'label')).toBe(false);
    expect(Object.hasOwn(neither?.[0] ?? {}, 'userHash')).toBe(false);
  });

  it('does not invent a hash, a label, or a chair the body did not name', () => {
    const bareHuman = parseSeats([{ kind: 'human' }]);
    expect(bareHuman?.[0]).toEqual({ kind: 'human' });
    expect(Object.hasOwn(bareHuman?.[0] ?? {}, 'userHash')).toBe(false);

    const badHash = parseSeats([{ kind: 'human', userHash: 1 }]);
    expect(badHash?.[0]).toEqual({ kind: 'human' });
    expect(Object.hasOwn(badHash?.[0] ?? {}, 'userHash')).toBe(false);

    const badAgentHash = parseSeats([{ kind: 'agent', userHash: 1, label: 'Agent (Ada)' }]);
    expect(badAgentHash?.[0]).toEqual({ kind: 'agent', label: 'Agent (Ada)' });
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

  it('an agent label that is not Agent (name) has no owner name', () => {
    const weird = onlineTurnSeat({
      seats: [{ kind: 'agent', label: 'abcdefg)Zed' }],
      players: ['A'],
      active: 'A',
    });
    expectNoOwner(weird);

    const open = onlineTurnSeat({
      seats: [{ kind: 'agent', label: 'Agent (Ada' }],
      players: ['A'],
      active: 'A',
    });
    expectNoOwner(open);
  });
});
