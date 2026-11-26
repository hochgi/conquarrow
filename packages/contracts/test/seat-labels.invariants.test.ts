/**
 * EARS 2, 3 and 5-ish for docs/spec/seat-labels/seat-labels.md — the table.
 * The expected value is computed by an independent restatement of the table,
 * so a mutant in any row disagrees somewhere in the product.
 */

import { describe, expect, it } from 'vitest';
import type { InviteSeat } from '../src/index';
import { labelInviteChair, seatLabel, seatLetter, usableSeatName } from '../src/index';

const KINDS = ['human', 'agent', 'heuristic', 'byok'] as const;
const RELATIONS = ['caller-human', 'caller-agent', 'other'] as const;
const BOUND = [undefined, true, false] as const;
const NAMES = [undefined, '', '  ', 'Bob', '  Ada  ', 'you', 'YOU', 'Your Agent', 'ai', 'Waiting', 'Player C', 'player a', 'Players', 'Agent', 'Player Bob', 'Ex player b', 'Player G'] as const;
const SAY = [false, true] as const;

const RESERVED = new Set(['you', 'your agent', 'ai', 'waiting']);
const expectedName = (name: string | undefined): string | undefined => {
  const t = (name ?? '').trim();
  if (t === '') return undefined;
  const lower = t.toLowerCase();
  if (RESERVED.has(lower)) return undefined;
  if (/^player [a-f]$/.test(lower)) return undefined;
  return t;
};

const expectedLabel = (
  letter: string,
  kind: (typeof KINDS)[number],
  relation: (typeof RELATIONS)[number],
  bound: boolean | undefined,
  name: string | undefined,
  sayYou: boolean,
): string => {
  if (kind === 'heuristic' || kind === 'byok') return 'AI';
  if (bound === false) return 'waiting';
  if (sayYou && relation === 'caller-human' && kind === 'human') return 'you';
  if (relation === 'caller-agent' && kind === 'agent') return 'your agent';
  const usable = expectedName(name);
  if (kind === 'agent') return usable === undefined ? 'Agent' : `${usable}'s agent`;
  return usable ?? `Player ${letter}`;
};

describe('seat-labels invariants — the table', () => {
  it('seatLabel agrees with the table for every input', () => {
    for (const kind of KINDS) {
      for (const relation of RELATIONS) {
        for (const bound of BOUND) {
          for (const name of NAMES) {
            for (const sayYou of SAY) {
              const got = seatLabel({
                letter: 'B',
                kind,
                relation,
                sayYou,
                ...(bound === undefined ? {} : { bound }),
                ...(name === undefined ? {} : { ownerName: name }),
              });
              const want = expectedLabel('B', kind, relation, bound, name, sayYou);
              expect(got, JSON.stringify({ kind, relation, bound, name, sayYou })).toBe(want);
            }
          }
        }
      }
    }
  });

  it('EARS 2: no usable name is a reserved word or another seat fallback', () => {
    for (const name of NAMES) expect(usableSeatName(name), String(name)).toBe(expectedName(name));
    // Only the whole name `Player <A–F>` poses as a fallback; a longer name is a name.
    expect(usableSeatName('Player Bob')).toBe('Player Bob');
    expect(usableSeatName('Ex player b')).toBe('Ex player b');
    expect(usableSeatName('Player G')).toBe('Player G');
    expect(usableSeatName(' player f ')).toBeUndefined();
  });

  it('EARS 3: "you" and "your agent" only for the caller', () => {
    for (const kind of KINDS) {
      for (const relation of RELATIONS) {
        for (const name of NAMES) {
          const got = seatLabel({ letter: 'C', kind, relation, sayYou: true, ...(name === undefined ? {} : { ownerName: name }) });
          if (got === 'you') expect({ kind, relation }).toEqual({ kind: 'human', relation: 'caller-human' });
          if (got === 'your agent') expect({ kind, relation }).toEqual({ kind: 'agent', relation: 'caller-agent' });
        }
      }
    }
  });

  it('labelInviteChair derives relation and bound from the chair', () => {
    const me = 'me-hash';
    const other = 'other-hash';
    const chairs: readonly InviteSeat[] = [
      { kind: 'heuristic' },
      { kind: 'human' },
      { kind: 'agent' },
      { kind: 'human', userHash: me },
      { kind: 'agent', userHash: me },
      { kind: 'human', userHash: other },
      { kind: 'agent', userHash: other },
      { kind: 'human', userHash: other, name: 'Bob' },
      { kind: 'agent', userHash: other, name: 'Ada' },
      { kind: 'human', userHash: me, name: 'Gilad' },
      { kind: 'agent', userHash: me, name: 'Gilad' },
    ];
    for (const userHash of [undefined, me]) {
      for (const chair of chairs) {
        const bound = chair.kind === 'heuristic' ? undefined : chair.userHash !== undefined;
        const mine = chair.kind !== 'heuristic' && userHash !== undefined && chair.userHash === userHash;
        const relation = !mine ? 'other' : chair.kind === 'agent' ? 'caller-agent' : 'caller-human';
        const name = chair.kind === 'heuristic' ? undefined : chair.name;
        const want = expectedLabel('B', chair.kind, relation, bound, name, true);
        expect(labelInviteChair({ letter: 'B', chair, ...(userHash === undefined ? {} : { userHash }) }), JSON.stringify({ chair, userHash })).toBe(want);
      }
    }
  });

  it('seatLetter maps seat indexes to the board letters', () => {
    expect([0, 1, 2, 3, 4, 5].map(seatLetter)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(seatLetter(6)).toBe('');
    expect(seatLetter(-1)).toBe('');
  });
});
