/**
 * docs/spec/boundary-convert-mutual-wipe/boundary-convert-mutual-wipe.core.feature —
 * one test per scenario.
 *
 * All five on the `minimal` fixture; every configuration is searched for through
 * the port. Packet P89, SPEC §6.2 (both wiped), §6.3, §7.
 *
 * @see docs/spec/boundary-convert-mutual-wipe/boundary-convert-mutual-wipe.md
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  anArrow,
  anExitFrom,
  anInterleaving,
  arrowAt,
  headsOn,
  isTrail,
  onBoard,
  owned,
  ownerOf,
  pathFrom,
  stateOf,
  territoryOf,
  via,
} from './support';
import {
  END_TURN,
  FIRST_SEAT,
  aBoundaryRaid,
  ownership,
} from './boundary-convert-mutual-wipe.support';

// ── Rule: Both wiped is A = 0 ────────────────────────────────────────────────

describe('both wiped is A = 0', () => {
  it("does not cut the defender's trail when a mutual wipe crosses it", () => {
    // Scenario: A mutual wipe across the defender's trail does not cut it
    const table = onBoard();
    const { trailIn, trailOut, ourIn: from, ourExit: exit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    expect(table.rules.combatLosses(2, 3)).toEqual({ attacker: 2, defender: 3 });
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 3 },
        { arrow: exit, owner: B, heads: 3 },
      ],
      A,
      {
        trail: { B: [trailIn, trailOut] },
        territory: [{ arrow: trailIn, owner: B }],
      },
    );
    expect(isTrail(before, B, exit)).toBe(false);
    expect(table.rules.crossesTrail(before, via(from, exit), B)).toBe(true);

    const after = table.rules.apply(before, step(from, exit, 2));

    expect(ownerOf(after, exit)).toBeUndefined();
    expect(isTrail(after, A, exit)).toBe(false);
    expect(isTrail(after, B, trailOut)).toBe(true);
    expect(ownerOf(after, from)).toBe(A);
    expect(headsOn(after, from)).toBe(1);
  });

  it('evaporates from the wiped arrow when a mutual wipe takes a defender on its own trail', () => {
    // Scenario: A mutual wipe of a defender on its own trail evaporates from the wiped arrow
    const table = onBoard();
    const from = anArrow(table.geometry);
    const exit = anExitFrom(table.geometry, from);
    const beyond = arrowAt(pathFrom(table.geometry, exit, 2, [from]), 1);
    expect(table.rules.combatLosses(2, 3)).toEqual({ attacker: 2, defender: 3 });
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 3 },
        { arrow: exit, owner: B, heads: 3 },
      ],
      A,
      { trail: { B: [exit, beyond] } },
    );
    expect(headsOn(before, beyond)).toBe(0);
    expect(territoryOf(before, beyond)).toBeUndefined();

    const after = table.rules.apply(before, step(from, exit, 2));

    expect(ownerOf(after, exit)).toBeUndefined();
    expect(isTrail(after, B, exit)).toBe(false);
    expect(isTrail(after, B, beyond)).toBe(false);
    expect(isTrail(after, A, exit)).toBe(false);
  });

  it("claims nothing when a mutual wipe steps from trail onto the attacker's own territory", () => {
    // Scenario: A mutual wipe from trail onto the attacker's own territory claims nothing
    const table = onBoard();
    const from = anArrow(table.geometry);
    const exit = anExitFrom(table.geometry, from);
    expect(table.rules.combatLosses(2, 3)).toEqual({ attacker: 2, defender: 3 });
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 3 },
        { arrow: exit, owner: B, heads: 3 },
      ],
      A,
      { trail: { A: [from] }, territory: owned([exit], A) },
    );
    expect(table.rules.closureOf(before, step(from, exit, 2), A)).toBeDefined();

    const after = table.rules.apply(before, step(from, exit, 2));

    expect(territoryOf(after, from)).toBeUndefined();
    expect(isTrail(after, A, from)).toBe(true);
  });
});

// ── Rule: Conversion at the round boundary ───────────────────────────────────

describe('conversion at the round boundary', () => {
  it('converts a raider demoted by a birth-cut at that boundary', () => {
    // Scenario: A raider demoted by a birth-cut at the round boundary converts at that boundary
    const table = onBoard();
    const raid = aBoundaryRaid(table, MINIMAL_DIAMETER);
    const before = raid.before(2);
    expect(territoryOf(before, raid.raider)).toBe(A);
    expect(table.rules.anchorGrade(before, raid.raider, B)).toBe('territory');
    expect(before.players.at(-1)).toBe(before.activePlayer);

    const after = table.rules.apply(before, END_TURN);

    // The boundary ran: the birth landed on the road and cut it there.
    expect(after.activePlayer).toBe(FIRST_SEAT);
    expect(ownerOf(after, raid.x)).toBe(A);
    expect(isTrail(after, B, raid.x)).toBe(false);
    // ...and the raider it demoted converts at that same boundary.
    expect(ownerOf(after, raid.raider)).toBe(A);
    expect(headsOn(after, raid.raider)).toBe(2);
    expect(isTrail(after, B, raid.raider)).toBe(false);
    // Its new owner moves first in the new round, and a converted stack is spent
    // for that turn (ADR 0005).
    expect(
      table.rules
        .legalMoves(after)
        .some((move) => move.kind === 'step' && move.from === raid.raider),
    ).toBe(false);
  });

  it('converts nothing when an endTurn does not close a round', () => {
    // Scenario: An endTurn that does not close a round converts nothing
    const table = onBoard();
    const raider = anArrow(table.geometry);
    const before = stateOf([{ arrow: raider, owner: B, heads: 2 }], FIRST_SEAT, {
      territory: owned([raider], A),
    });
    expect(isTrail(before, B, raider)).toBe(false);
    expect(before.players[0]).toBe(before.activePlayer);

    const after = table.rules.apply(before, END_TURN);

    expect(after.activePlayer).toBe(B);
    expect(ownership(after)).toEqual(ownership(before));
  });
});
