/**
 * One test per scenario in:
 *   docs/spec/move/move.core.feature
 *   docs/spec/move/move.edge-cases.feature
 *
 * A move takes a portion of one arrow's heads one step along an out-arrow.
 * Three variants and no others — splitting, merging, forking and dropping a
 * sentry are all the same move with a different count.
 *
 * Legality is deliberately absent. Whether an exit is really an out-arrow,
 * whether allowance remains, whether a crossing is won, is P04 and later.
 */

import { describe, expect, it } from 'vitest';
import {
  ContractViolation,
  endTurn,
  isSatisfiableBy,
  MOVE_KINDS,
  mintArrowId,
  movesEqual,
  speed,
  step,
  turnsEqual,
} from '../src/index';
import type { Turn } from '../src/index';

const a1 = mintArrowId('a1');
const a2 = mintArrowId('a2');
const a3 = mintArrowId('a3');

describe('move — a step names a source, an exit and a count', () => {
  it('carries exactly three fields and nothing else', () => {
    const m = step(a1, a2, 2);
    expect(Object.keys(m).toSorted()).toEqual(['count', 'exit', 'from', 'kind']);
    expect(m.from).toBe(a1);
    expect(m.exit).toBe(a2);
    expect(m.count).toBe(2);
  });

  it.each([
    { held: 1, count: 1, manoeuvre: 'moving a lone head' },
    { held: 3, count: 3, manoeuvre: 'moving the whole stack' },
    { held: 3, count: 1, manoeuvre: 'sending a scout, leaving a 2-sentry' },
    { held: 3, count: 2, manoeuvre: 'advancing, leaving one head behind' },
  ])('expresses $manoeuvre with one move type', ({ held, count }) => {
    const m = step(a1, a2, count);
    expect(isSatisfiableBy(m, held)).toBe(true);
  });

  it('makes a fork out of two moves from the same source', () => {
    const left = step(a1, a2, 1);
    const right = step(a1, a3, 1);
    expect(isSatisfiableBy(left, 3)).toBe(true);
    expect(isSatisfiableBy(right, 3)).toBe(true);
    expect(movesEqual(left, right)).toBe(false);
  });
});

describe('move — a count must be a positive portion of what is there', () => {
  // ContractViolation, not any throw: a bare `.toThrow()` passes against the
  // phase-2 skeleton and keeps passing in phase 3 without the check existing.
  it.each([0, -1, 1.5])('rejects a count of %s at construction', (count) => {
    expect(() => step(a1, a2, count)).toThrow(ContractViolation);
  });

  it('rejects sending more heads than the source holds', () => {
    expect(isSatisfiableBy(step(a1, a2, 3), 2)).toBe(false);
  });
});

describe('move — end-turn is first-class', () => {
  it('ends a turn without naming an arrow', () => {
    const m = endTurn();
    expect(Object.keys(m)).toEqual(['kind']);
  });

  it('is how a turn ends when no stack was ever named', () => {
    // Declining is the absence of a move (P51): a turn in which nothing moved
    // is a turn holding nothing but its ending.
    const declined: Turn = [endTurn()];
    expect(turnsEqual(declined, [endTurn()])).toBe(true);
    expect(turnsEqual(declined, [step(a1, a2, 1), endTurn()])).toBe(false);
  });

  it('accepts a turn that is empty but for its ending', () => {
    const turn: Turn = [endTurn()];
    expect(turnsEqual(turn, turn)).toBe(true);
  });
});

describe('move — a turn is an ordered list, and order is data', () => {
  it('preserves the order moves were made in', () => {
    const turn: Turn = [step(a1, a2, 1), step(a2, a3, 1), endTurn()];
    expect(turn.map((m) => m.kind)).toEqual(['step', 'step', 'endTurn']);
  });

  it('treats structurally identical moves as equal', () => {
    expect(movesEqual(step(a1, a2, 2), step(a1, a2, 2))).toBe(true);
  });

  it('treats two turns differing only in order as unequal', () => {
    const first: Turn = [step(a1, a2, 1), step(a2, a3, 1)];
    const second: Turn = [step(a2, a3, 1), step(a1, a2, 1)];
    expect(turnsEqual(first, second)).toBe(false);
  });

  it('imposes no limit on how many moves name the same stack', () => {
    const turn: Turn = [step(a1, a2, 1), step(a1, a3, 1), step(a1, a2, 1)];
    expect(turnsEqual(turn, turn)).toBe(true);
  });

  it('lets moves from different stacks be interleaved', () => {
    // SPEC §4: a 3-stack at 11/6 does not have to spend its steps consecutively,
    // and the order the player chose is data the replay carries. a1, a2, a1 is
    // not the same turn as a1, a1, a2 even though both stacks moved twice.
    const interleaved: Turn = [step(a1, a2, 1), step(a2, a3, 1), step(a1, a3, 1)];
    const consecutive: Turn = [step(a1, a2, 1), step(a1, a3, 1), step(a2, a3, 1)];
    expect(interleaved.map((m) => m.kind)).toEqual(['step', 'step', 'step']);
    expect(turnsEqual(interleaved, consecutive)).toBe(false);
  });

  it('leaves the remainder of a split able to act', () => {
    // SPEC §3: on a split both parts inherit `spent`, so only the portion that
    // moved has paid. The DTO must not treat a1 as spent.
    const scout = step(a1, a2, 1);
    const rest = step(a1, a3, 2);
    expect(isSatisfiableBy(scout, 3)).toBe(true);
    expect(isSatisfiableBy(rest, 3)).toBe(true);
  });

  it('lets a rear group step onto an arrow the front group laid', () => {
    // SPEC §6.1a invariant 2: a trail is a set of arrows, so stepping onto one
    // it already holds is legal. A lagging group is ordinary play.
    const front = step(a1, a2, 1);
    const rear = step(a1, a2, 1);
    expect(movesEqual(front, rear)).toBe(true);
    expect(isSatisfiableBy(rear, 2)).toBe(true);
  });
});

describe('move — illegal shapes are unrepresentable', () => {
  it('refuses a step whose source and exit are the same arrow', () => {
    expect(() => step(a1, a1, 2)).toThrow(ContractViolation);
  });

  it.each([
    { field: 'source', build: () => step(undefined as unknown as typeof a1, a2, 1) },
    { field: 'exit', build: () => step(a1, undefined as unknown as typeof a2, 1) },
    { field: 'count', build: () => step(a1, a2, undefined as unknown as number) },
  ])('refuses a step constructed without the $field', ({ build }) => {
    // TypeScript already blocks these at the call site; the runtime guard is for
    // everything that reaches the core across a boundary the compiler cannot see
    // — a replay file, a saved fixture, an adapter. Three fields, all required.
    expect(build).toThrow(ContractViolation);
  });

  it('admits exactly two variants', () => {
    expect([...MOVE_KINDS].toSorted()).toEqual(['endTurn', 'step']);
    expect(MOVE_KINDS).toHaveLength(2);
  });

  it.each([1, 5, 6])('accepts count %i against a 6-stack', (count) => {
    expect(isSatisfiableBy(step(a1, a2, count), 6)).toBe(true);
  });

  it('accepts taking every head off an arrow', () => {
    expect(isSatisfiableBy(step(a1, a2, 1), 1)).toBe(true);
  });
});

describe('move — allowance is a whole number of steps', () => {
  it.each([
    { heads: 1, steps: 1 },
    { heads: 2, steps: 2 },
    { heads: 3, steps: 2 },
    { heads: 4, steps: 3 },
    { heads: 7, steps: 3 },
    { heads: 8, steps: 4 },
    { heads: 15, steps: 4 },
    { heads: 16, steps: 5 },
  ])('gives a group of $heads exactly $steps steps', ({ heads, steps }) => {
    expect(speed(heads)).toBe(steps);
  });

  it('never lets a group outpace splitting into single heads', () => {
    // SPEC §3's founding constraint. Equality only at 1 and 2, which is what
    // makes the pair free and therefore the game's natural atom (§5).
    for (let n = 1; n <= 64; n += 1) {
      expect(speed(n)).toBeLessThanOrEqual(n);
    }
    expect(speed(1)).toBe(1);
    expect(speed(2)).toBe(2);
    expect(speed(3)).toBeLessThan(3);
  });

  it('is monotonic and never jumps by more than one', () => {
    // A doubling adds exactly one step. A gap of two would mean some stack size
    // is strictly better than the one above it, which no rule intends.
    for (let n = 2; n <= 64; n += 1) {
      const d = speed(n) - speed(n - 1);
      expect(d === 0 || d === 1).toBe(true);
    }
  });

  it.each([0, -1, 1.5])('rejects a group size of %s', (heads) => {
    expect(() => speed(heads)).toThrow(ContractViolation);
  });
});
