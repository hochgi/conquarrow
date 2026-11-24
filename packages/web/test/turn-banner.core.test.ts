/**
 * docs/spec/turn-banner/turn-banner.core.feature
 *
 * One it() per Gherkin scenario. Pure helpers — no DOM, no test-kit.
 */

import { describe, expect, it } from 'vitest';
import { onlineTurnSeat } from '../src/turnBanner';
import { expectNoOwner, readTurn } from './turn-banner.support';

describe('The turn banner says who is playing', () => {
  describe('Online, only the caller\'s human seat is "you"', () => {
    it('The caller\'s own turn says you and Your turn, with no spinner', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'A',
        kind: 'human',
        relation: 'caller-human',
        replaying: false,
        phase: 'idle',
        movableCount: 1,
      });

      expect(copy.banner).toBe('Turn: A · you');
      expect(copy.hint).toBe('Your turn — gold-outlined stacks can still move');
      expect(copy.thinking).toBe(false);
    });

    it('The caller\'s own agent does not say you', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'C',
        kind: 'agent',
        relation: 'caller-agent',
        replaying: false,
      });

      expect(copy.banner).toBe('Turn: C · your agent is playing…');
      expect(copy.hint).toBe('Waiting for C…');
      expect(copy.thinking).toBe(true);
      expect(copy.hint.startsWith('Your turn')).toBe(false);
      expect(copy.suffix).not.toBe(' · you');
    });

    it('Another seat\'s named agent uses the owner name', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'B',
        kind: 'agent',
        relation: 'other',
        ownerName: 'Ada',
        replaying: false,
      });

      expect(copy.banner).toBe("Turn: B · Ada's agent is playing…");
      expect(copy.hint).toBe('Waiting for B…');
      expect(copy.thinking).toBe(true);
    });

    it('Another seat\'s unnamed agent uses the letter', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'B',
        kind: 'agent',
        relation: 'other',
        replaying: false,
      });

      expect(copy.banner).toBe("Turn: B · B's agent is playing…");
      expect(copy.hint).toBe('Waiting for B…');
      expect(copy.thinking).toBe(true);
    });

    it('A heuristic seat says the AI is playing', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'C',
        kind: 'heuristic',
        relation: 'other',
        replaying: false,
      });

      expect(copy.banner).toBe('Turn: C · AI is playing…');
      expect(copy.hint).toBe('Waiting for C…');
      expect(copy.thinking).toBe(true);
    });

    it('Another human says that seat is playing', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'B',
        kind: 'human',
        relation: 'other',
        replaying: false,
      });

      expect(copy.banner).toBe('Turn: B · B is playing…');
      expect(copy.hint).toBe('Waiting for B…');
      expect(copy.thinking).toBe(true);
    });
  });

  describe('A replay hides the spinner and keeps the words', () => {
    it('A replay of someone else\'s turn does not spin', () => {
      const copy = readTurn({
        venue: 'online',
        letter: 'C',
        kind: 'agent',
        relation: 'caller-agent',
        replaying: true,
      });

      expect(copy.banner).toBe('Turn: C · your agent is playing…');
      expect(copy.hint).toBe('Waiting for C…');
      expect(copy.thinking).toBe(false);
    });
  });

  describe('Local matches keep their conditions', () => {
    it('A local hot-seat turn has no you and no spinner', () => {
      // Hot-seat ignores kind. caller-human is the case that must still not say you.
      const copy = readTurn({
        venue: 'local',
        letter: 'A',
        kind: 'human',
        relation: 'caller-human',
        vsBot: false,
        phase: 'idle',
        movableCount: 1,
      });

      expect(copy.banner).toBe('Turn: A');
      expect(copy.hint).toBe('Gold-outlined stacks can still move');
      expect(copy.thinking).toBe(false);
      expect(copy.banner).not.toContain('Player ');
    });

    it('A local versus-bot human turn still says you', () => {
      const copy = readTurn({
        venue: 'local',
        letter: 'A',
        kind: 'human',
        relation: 'caller-human',
        vsBot: true,
        pause: 'running',
        botBusy: false,
        phase: 'idle',
        movableCount: 1,
      });

      expect(copy.banner).toBe('Turn: A · you');
      expect(copy.hint).toBe('Your turn — gold-outlined stacks can still move');
      expect(copy.thinking).toBe(false);
    });
  });

  describe('Online facts come from the game seats', () => {
    it('A three-seat game derives you, your agent, and the AI', () => {
      const seats = [
        { kind: 'human' as const, userHash: 'me' },
        { kind: 'agent' as const, userHash: 'me', label: 'Agent (Ada)' },
        { kind: 'heuristic' as const },
      ];
      const players = ['A', 'B', 'C'];
      const derived = (active: string) =>
        onlineTurnSeat({ seats, userHash: 'me', players, active });

      const a = derived('A');
      expect(a.letter).toBe('A');
      expect(a.kind).toBe('human');
      expect(a.relation).toBe('caller-human');
      expectNoOwner(a);

      const b = derived('B');
      expect(b.letter).toBe('B');
      expect(b.kind).toBe('agent');
      expect(b.relation).toBe('caller-agent');
      expect(b.ownerName).toBe('Ada');

      const c = derived('C');
      expect(c.letter).toBe('C');
      expect(c.kind).toBe('heuristic');
      expect(c.relation).toBe('other');
      expectNoOwner(c);
    });
  });
});
