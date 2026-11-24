/**
 * EARS invariants for docs/spec/turn-banner/turn-banner.md.
 *
 * The copy invariants run the full product: kind × relation × replay × venue,
 * local read once as hot-seat and once as versus-bot running and not busy.
 * The word "you" is the exact suffix and the hint prefix, never a substring.
 */

import { describe, expect, it } from 'vitest';
import {
  onlineTurnSeat,
  turnBannerCopy,
  type OnlineSeatFact,
  type OnlineTurnSeatInput,
  type OnlineTurnSeatResult,
} from '../src/turnBanner';
import {
  copyInput,
  expectNoOwner,
  isCallerHumanSeat,
  product,
  readTurn,
  rowLabel,
  YOU_SUFFIX,
  YOUR_TURN_PREFIX,
} from './turn-banner.support';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

const CALLER_HASHES = [undefined, 'me', 'them'] as const;

interface SeatWorld {
  readonly name: string;
  readonly seats?: readonly OnlineSeatFact[];
  readonly players: readonly string[];
}

const SEAT_WORLDS: readonly SeatWorld[] = [
  { name: 'missing seats', players: ['A', 'B', 'C'] },
  { name: 'human match', seats: [{ kind: 'human', userHash: 'me' }], players: ['A'] },
  { name: 'human mismatch', seats: [{ kind: 'human', userHash: 'them' }], players: ['A'] },
  { name: 'human unbound', seats: [{ kind: 'human' }], players: ['A'] },
  {
    name: 'agent match',
    seats: [{ kind: 'agent', userHash: 'me', label: 'Agent (Ada)' }],
    players: ['A'],
  },
  {
    name: 'agent mismatch',
    seats: [{ kind: 'agent', userHash: 'them', label: 'Agent (Bea)' }],
    players: ['A'],
  },
  { name: 'agent unbound', seats: [{ kind: 'agent', label: 'Agent (Ada)' }], players: ['A'] },
  { name: 'heuristic', seats: [{ kind: 'heuristic' }], players: ['A'] },
  {
    name: 'short seats',
    seats: [
      { kind: 'human', userHash: 'me' },
      { kind: 'agent', userHash: 'me', label: 'Agent (Ada)' },
    ],
    players: ['A', 'B', 'C'],
  },
];

/** D5: caller-human only when the active chair is proved to be the caller's human seat. */
const provedCallerHuman = (
  seats: readonly OnlineSeatFact[] | undefined,
  userHash: string | undefined,
  players: readonly string[],
  active: string,
): boolean => {
  if (seats === undefined || userHash === undefined) return false;
  const index = players.indexOf(active);
  if (index < 0) return false;
  const seat = seats[index];
  return seat !== undefined && seat.kind === 'human' && seat.userHash === userHash;
};

const derive = (
  seats: readonly OnlineSeatFact[] | undefined,
  userHash: string | undefined,
  players: readonly string[],
  active: string,
): OnlineTurnSeatResult => {
  const input: OnlineTurnSeatInput = { players, active };
  const withSeats = seats === undefined ? input : { ...input, seats };
  const withHash = userHash === undefined ? withSeats : { ...withSeats, userHash };
  return onlineTurnSeat(withHash);
};

const ownerOf = (label: string | undefined, kind: OnlineSeatFact['kind']): OnlineTurnSeatResult => {
  const seat = seatWithLabel(kind, label);
  return onlineTurnSeat({ seats: [seat], players: ['A'], active: 'A' });
};

const seatWithLabel = (kind: OnlineSeatFact['kind'], label: string | undefined): OnlineSeatFact => {
  if (kind === 'heuristic') {
    return label === undefined ? { kind } : { kind, label };
  }
  if (kind === 'agent') {
    return label === undefined ? { kind } : { kind, label };
  }
  return label === undefined ? { kind } : { kind, label };
};

describe('turn-banner invariants', () => {
  it('When the suffix is not exactly " · you", the banner shall not claim the turn with the word you', () => {
    const rows = product();
    expect(rows).toHaveLength(4 * 3 * 2 * 3);
    let sawNonYou = false;
    let sawYourAgent = false;
    for (const row of rows) {
      const copy = turnBannerCopy(copyInput(row));
      if (copy.suffix === YOU_SUFFIX) continue;
      sawNonYou = true;
      const letter = copyInput(row).letter;
      expect(copy.banner, rowLabel(row)).toBe(`Turn: ${letter}${copy.suffix}`);
      expect(copy.banner, rowLabel(row)).not.toBe(`Turn: ${letter}${YOU_SUFFIX}`);
      expect(copy.hint.startsWith(YOUR_TURN_PREFIX), rowLabel(row)).toBe(false);
      if (copy.suffix.includes('your agent') || copy.banner.includes('your agent')) {
        sawYourAgent = true;
        expect(copy.suffix, rowLabel(row)).not.toBe(YOU_SUFFIX);
      }
    }
    expect(sawNonYou).toBe(true);
    expect(sawYourAgent).toBe(true);
  });

  it('When the active seat is not the caller\'s human seat, the hint shall not start with "Your turn"', () => {
    const rows = product();
    expect(rows).toHaveLength(4 * 3 * 2 * 3);
    let sawOther = false;
    for (const row of rows) {
      if (isCallerHumanSeat(row)) continue;
      sawOther = true;
      const copy = turnBannerCopy(copyInput(row));
      expect(copy.hint.startsWith(YOUR_TURN_PREFIX), rowLabel(row)).toBe(false);
    }
    expect(sawOther).toBe(true);
  });

  it('When the venue is online and the active seat is not the caller\'s human seat and no replay is playing, thinking shall be true', () => {
    const rows = product();
    expect(rows).toHaveLength(4 * 3 * 2 * 3);
    let saw = false;
    for (const row of rows) {
      if (row.venue !== 'online' || isCallerHumanSeat(row) || row.replaying) continue;
      saw = true;
      const copy = turnBannerCopy(copyInput(row));
      expect(copy.thinking, rowLabel(row)).toBe(true);
    }
    expect(saw).toBe(true);
  });

  it('While a replay is playing, or the venue is local, thinking shall be false', () => {
    const rows = product();
    expect(rows).toHaveLength(4 * 3 * 2 * 3);
    let sawReplay = false;
    let sawLocal = false;
    for (const row of rows) {
      if (!row.replaying && row.venue !== 'local') continue;
      if (row.replaying) sawReplay = true;
      if (row.venue === 'local') sawLocal = true;
      const copy = turnBannerCopy(copyInput(row));
      expect(copy.thinking, rowLabel(row)).toBe(false);
    }
    expect(sawReplay).toBe(true);
    expect(sawLocal).toBe(true);
  });

  it('When online seat facts cannot prove the active chair is the caller\'s human seat, the derived relation shall not be caller-human', () => {
    let proved = 0;
    let unproved = 0;
    for (const world of SEAT_WORLDS) {
      const actives = [...world.players, 'D'];
      for (const userHash of CALLER_HASHES) {
        for (const active of actives) {
          const canProve = provedCallerHuman(world.seats, userHash, world.players, active);
          const seat = derive(world.seats, userHash, world.players, active);
          const where = `${world.name} hash=${userHash ?? 'missing'} active=${active}`;
          if (canProve) {
            proved += 1;
            expect(seat.relation, where).toBe('caller-human');
          } else {
            unproved += 1;
            expect(seat.relation, where).not.toBe('caller-human');
          }
        }
      }
    }
    expect(proved).toBeGreaterThan(0);
    expect(unproved).toBeGreaterThan(0);
  });

  it('When an online agent label carries a display name, the derived owner name shall be that name; otherwise it shall be absent', () => {
    expect(ownerOf('Agent (Ada)', 'agent').ownerName).toBe('Ada');
    expect(ownerOf('Agent ( Ada )', 'agent').ownerName).toBe('Ada');

    expectNoOwner(ownerOf('Agent', 'agent'));
    expectNoOwner(ownerOf('Agent ()', 'agent'));
    expectNoOwner(ownerOf('Agent ( )', 'agent'));
    expectNoOwner(ownerOf(undefined, 'agent'));
    expectNoOwner(ownerOf('Agent (Ada)', 'human'));
    expectNoOwner(ownerOf('Agent (Ada)', 'heuristic'));
    expectNoOwner(ownerOf('AI', 'heuristic'));
  });

  it('The banner shall name the seat by its letter and shall not contain "Player "', () => {
    const rows = product();
    expect(rows).toHaveLength(4 * 3 * 2 * 3);
    for (const row of rows) {
      const input = copyInput(row);
      const copy = turnBannerCopy(input);
      expect(copy.letter, rowLabel(row)).toBe(input.letter);
      expect(copy.banner, rowLabel(row)).toBe(`Turn: ${input.letter}${copy.suffix}`);
      expect(copy.banner, rowLabel(row)).not.toContain('Player ');
    }

    for (const letter of LETTERS) {
      const yours = readTurn({
        venue: 'online',
        letter,
        kind: 'human',
        relation: 'caller-human',
      });
      expect(yours.letter).toBe(letter);
      expect(yours.banner).toBe(`Turn: ${letter} · you`);
      expect(yours.banner).not.toContain('Player ');

      const theirs = readTurn({
        venue: 'online',
        letter,
        kind: 'human',
        relation: 'other',
      });
      expect(theirs.letter).toBe(letter);
      expect(theirs.banner).toBe(`Turn: ${letter} · ${letter} is playing…`);
      expect(theirs.banner).not.toContain('Player ');
    }
  });
});
