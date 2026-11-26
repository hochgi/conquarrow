/**
 * docs/spec/seat-labels/seat-labels.core.feature — Rule "One table words every seat".
 */

import { describe, expect, it } from 'vitest';
import { labelInviteChair } from '../src/index';

const ME = 'alice-hash';

describe('One table words every seat', () => {
  it('My own seats', () => {
    expect(labelInviteChair({ letter: 'A', chair: { kind: 'human', userHash: ME, name: 'Alice' }, userHash: ME })).toBe('you');
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'agent', userHash: ME, name: 'Alice' }, userHash: ME })).toBe('your agent');
  });

  it("Other people's seats, with names", () => {
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'human', userHash: 'bob', name: 'Bob' }, userHash: ME })).toBe('Bob');
    expect(labelInviteChair({ letter: 'C', chair: { kind: 'agent', userHash: 'ada', name: 'Ada' }, userHash: ME })).toBe("Ada's agent");
  });

  it("Other people's seats, without names", () => {
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'human', userHash: 'bob' }, userHash: ME })).toBe('Player B');
    expect(labelInviteChair({ letter: 'C', chair: { kind: 'agent', userHash: 'ada' }, userHash: ME })).toBe('Agent');
  });

  it('Unbound and AI seats', () => {
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'human' }, userHash: ME })).toBe('waiting');
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'agent' }, userHash: ME })).toBe('waiting');
    expect(labelInviteChair({ letter: 'C', chair: { kind: 'heuristic' }, userHash: ME })).toBe('AI');
  });

  it('Signed out: nobody is you', () => {
    expect(labelInviteChair({ letter: 'A', chair: { kind: 'human', userHash: ME } })).toBe('Player A');
    expect(labelInviteChair({ letter: 'B', chair: { kind: 'agent', userHash: ME } })).toBe('Agent');
  });

  it('A reserved word as a name falls back', () => {
    for (const name of ['you', 'You', 'your agent', 'AI', 'waiting', '', 'Player A']) {
      expect(labelInviteChair({ letter: 'B', chair: { kind: 'human', userHash: 'bob', name }, userHash: ME })).toBe('Player B');
      expect(labelInviteChair({ letter: 'C', chair: { kind: 'agent', userHash: 'bob', name }, userHash: ME })).toBe('Agent');
    }
  });
});
