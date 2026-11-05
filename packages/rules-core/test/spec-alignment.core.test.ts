/**
 * docs/spec/spec-alignment/spec-alignment.core.feature — one test per scenario.
 *
 * The step rulings (R3, D2, R1) run on the `minimal` fixture, where a failure
 * prints. The claim rulings (D1, C2, R2) run on the generated tiling: a claim's
 * pocket is enclosed ground, and only an unbounded board can host enclosure
 * (closure.md). Every configuration is searched for through the port.
 *
 * @see docs/spec/spec-alignment/spec-alignment.md
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  anInterleaving,
  headsOn,
  isTrail,
  onBoard,
  onTiling,
  ownerOf,
  stateOf,
  territoryOf,
  via,
} from './support';
import { aClosing, aShieldedRaider } from './raider-survives-claim.support';
import {
  aFeeding,
  aNeutralRaiderThroughTheClaim,
  anAnchorRing,
  anotherFeederOf,
  outwardOf,
} from './spec-alignment.support';

// ── Rule: A repelled attack does not cut (R3) ─────────────────────────────────

describe('a repelled attack does not cut (R3)', () => {
  /** B's trail `trailIn → trailOut` through P, `trailIn` B's land; B on `exit`. */
  const crossingAttack = (bHeads: number, aHeads: number) => {
    const table = onBoard();
    const { trailIn, trailOut, ourIn: from, ourExit: exit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: aHeads },
        { arrow: exit, owner: B, heads: bHeads },
      ],
      A,
      {
        trail: { A: [from], B: [trailIn, trailOut, exit] },
        territory: [{ arrow: trailIn, owner: B }],
      },
    );
    expect(table.rules.crossesTrail(before, via(from, exit), B)).toBe(true);
    return { table, from, exit, trailOut, before };
  };

  it("leaves the defender's trail when the attack across it is repelled", () => {
    // Scenario: A repelled attack across the defender's trail leaves that trail
    const { table, from, exit, trailOut, before } = crossingAttack(2, 2);

    const after = table.rules.apply(before, step(from, exit, 1));

    expect(ownerOf(after, exit)).toBe(B);
    expect(headsOn(after, exit)).toBe(1);
    expect(isTrail(after, A, exit)).toBe(false);
    expect(isTrail(after, B, trailOut)).toBe(true);
  });

  it("still cuts when the attack across the defender's trail wins", () => {
    // Scenario: A winning attack across the defender's trail still cuts
    const { table, from, exit, trailOut, before } = crossingAttack(1, 3);

    const after = table.rules.apply(before, step(from, exit, 2));

    expect(ownerOf(after, exit)).toBe(A);
    expect(isTrail(after, B, trailOut)).toBe(false);
  });
});

// ── Rule: The convert wipe runs from a converted arrow the claim took (D1) ────

describe('the convert wipe runs from a converted arrow the claim took (D1)', () => {
  it('converts a stack-grade raider on a claimed arrow and evaporates its trail off the claim', () => {
    // Scenario: A stack-grade raider on a claimed arrow converts and its trail off the claim evaporates
    const closing = aClosing();
    const { table } = closing;
    const found = closing.interior
      .map((p) => aShieldedRaider(closing, p))
      .find((s) => s !== undefined);
    if (found === undefined) throw new Error('setup: no interior arrow has a road off the claim');
    const { p, road } = found;
    // No B territory feeds the road: the stretch is stack grade.
    const before = closing.before({ groups: [{ arrow: p, owner: B, heads: 2 }], trail: [p, ...road] });
    expect(closing.claimed.has(p)).toBe(true);
    for (const a of road) {
      expect(closing.claimed.has(a)).toBe(false);
      expect(territoryOf(before, a)).toBeUndefined();
      expect(ownerOf(before, a)).toBeUndefined();
    }
    expect(table.rules.anchorGrade(before, p, B)).toBe('stack');
    expect(table.rules.crossesTrail(before, via(closing.tip, closing.landing), B)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    expect(ownerOf(after, p)).toBe(A);
    expect(headsOn(after, p)).toBe(2);
    for (const a of road) expect(isTrail(after, B, a)).toBe(false);
  });
});

// ── Rule: A claim spares a territory-grade trail carrying its owner's stack ──

describe("a claim spares a territory-grade trail carrying its owner's stack, wherever it stands (C2)", () => {
  it('keeps the claimed part of the trail of a raider on neutral ground', () => {
    // Scenario: A raider on neutral ground keeps the part of its trail the claim takes
    const closing = aClosing();
    const { table } = closing;
    const { n, r, trail, feeder } = aNeutralRaiderThroughTheClaim(closing);
    const before = closing.before({
      groups: [{ arrow: n, owner: B, heads: 1 }],
      trail,
      territory: [feeder],
    });
    expect(closing.claimed.has(n)).toBe(false);
    expect(territoryOf(before, n)).toBeUndefined();
    expect(closing.claimed.has(r)).toBe(true);
    expect(table.rules.anchorGrade(before, n, B)).toBe('territory');

    const after = table.rules.apply(before, closing.close);

    expect(territoryOf(after, r)).toBe(A);
    expect(isTrail(after, B, r)).toBe(true);
    expect(ownerOf(after, n)).toBe(B);
    expect(table.rules.anchorGrade(after, n, B)).toBe('territory');
  });

  it('still strips a territory-grade stretch with no stack on it', () => {
    // Scenario: A territory-grade stretch with no stack on it is still stripped
    const closing = aClosing();
    const { table } = closing;
    const found = closing.interior
      .map((p) => aShieldedRaider(closing, p))
      .find((s) => s !== undefined);
    if (found === undefined) throw new Error('setup: no interior arrow has a road home');
    const before = closing.before({ trail: found.stretch, territory: [found.feeder] });
    expect(table.rules.anchorGrade(before, found.p, B)).toBe('territory');
    expect([...before.groups.values()].some((g) => g.owner === B)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    for (const a of found.stretch) {
      if (closing.claimed.has(a)) expect(isTrail(after, B, a)).toBe(false);
    }
  });
});

// ── Rule: A claim that takes a trail's anchoring land is a territory-root cut (R2)

describe("a claim that takes a trail's anchoring land is a territory-root cut (R2)", () => {
  it('strands a raider on neutral ground when the claim takes its anchor', () => {
    // Scenario: The anchor claimed while the raider stands on neutral ground strands it
    const table = onTiling();
    const { ring, road } = anAnchorRing(table);
    const { e1, e2 } = road;
    const before = ring.before({ groups: [{ arrow: e2, owner: B, heads: 1 }], trail: [e1, e2] });
    const { geometry, rules } = table;
    // f is the only B land feeding P0; e1 leaves P0; neither e1 nor e2 is claimed or land.
    expect(geometry.target(ring.f)).toBe(ring.p0);
    expect(geometry.origin(e1)).toBe(ring.p0);
    expect(geometry.inArrows(ring.p0).filter((a) => territoryOf(before, a) === B)).toEqual([ring.f]);
    for (const a of [e1, e2]) {
      expect(ring.claimed.has(a)).toBe(false);
      expect(territoryOf(before, a)).toBeUndefined();
    }
    expect(rules.anchorGrade(before, e2, B)).toBe('territory');
    expect(rules.crossesTrail(before, via(ring.tip, ring.landing), B)).toBe(false);

    const after = rules.apply(before, ring.close);

    expect(territoryOf(after, ring.f)).toBe(A);
    expect(isTrail(after, B, e1)).toBe(false);
    expect(isTrail(after, B, e2)).toBe(true);
    expect(ownerOf(after, e2)).toBe(B);
    expect(headsOn(after, e2)).toBe(1);
    expect(rules.anchorGrade(after, e2, B)).toBe('stack');
  });

  it("converts a raider on the closer's land when the claim takes its anchor", () => {
    // Scenario: The anchor claimed while the raider stands on the closer's land converts it
    const table = onTiling();
    const { ring } = anAnchorRing(table);
    const e = outwardOf(ring)[0];
    if (e === undefined) throw new Error('setup: nothing leaves the anchor point outward');
    const before = ring.before({
      groups: [{ arrow: e, owner: B, heads: 1 }],
      trail: [e],
      alsoA: [e],
    });
    expect(territoryOf(before, e)).toBe(A);
    expect(ring.claimed.has(e)).toBe(false);
    expect(table.rules.anchorGrade(before, e, B)).toBe('territory');

    const after = table.rules.apply(before, ring.close);

    expect(ownerOf(after, e)).toBe(A);
    expect(headsOn(after, e)).toBe(1);
    expect(isTrail(after, B, e)).toBe(false);
  });

  it('does not cut when another clean feeder of the anchor point stays outside the claim', () => {
    // Scenario: A claim that leaves another clean feeder is not a cut
    const table = onTiling();
    const { ring, road } = anAnchorRing(table);
    const { e1, e2 } = road;
    const g = anotherFeederOf(ring);
    if (g === undefined) throw new Error('setup: the anchor point has no second feeder off the claim');
    const before = ring.before({
      groups: [{ arrow: e2, owner: B, heads: 1 }],
      trail: [e1, e2],
      territory: [g],
    });
    expect(ring.claimed.has(g)).toBe(false);

    const after = table.rules.apply(before, ring.close);

    expect(isTrail(after, B, e1)).toBe(true);
    expect(isTrail(after, B, e2)).toBe(true);
    expect(table.rules.anchorGrade(after, e2, B)).toBe('territory');
  });
});

// ── Rule: Only a clean feeder anchors (D2) ────────────────────────────────────

describe('only a clean feeder anchors (D2)', () => {
  it('grades a stretch stack when its only feeder is in an enemy trail', () => {
    // Scenario: A feeder in an enemy trail does not anchor
    const table = onBoard();
    const { out, p0, feeder } = aFeeding(table);
    const before = stateOf([{ arrow: out, owner: B, heads: 1 }], A, {
      trail: { A: [feeder], B: [out] },
      territory: [{ arrow: feeder, owner: B }],
    });
    expect(table.geometry.inArrows(p0).filter((a) => territoryOf(before, a) === B)).toEqual([feeder]);

    expect(table.rules.anchorGrade(before, out, B)).toBe('stack');
  });

  it('leaves the stack at stack grade after a territory-root cut that halts at once', () => {
    // Scenario: A territory-root cut that halts at once leaves the stack at stack grade
    const table = onBoard();
    const { out, p0, feeder, approach } = aFeeding(table);
    const before = stateOf(
      [
        { arrow: out, owner: B, heads: 1 },
        { arrow: approach, owner: A, heads: 2 },
      ],
      A,
      {
        trail: { B: [out] },
        territory: [
          { arrow: feeder, owner: B },
          { arrow: approach, owner: A },
        ],
      },
    );
    expect(table.geometry.inArrows(p0).filter((a) => territoryOf(before, a) === B)).toEqual([feeder]);
    expect(table.rules.anchorGrade(before, out, B)).toBe('territory');
    expect(table.rules.crossesTrail(before, via(approach, feeder), B)).toBe(false);

    const after = table.rules.apply(before, step(approach, feeder, 1));

    expect(isTrail(after, A, feeder)).toBe(true);
    expect(isTrail(after, B, out)).toBe(true);
    expect(table.rules.anchorGrade(after, out, B)).toBe('stack');
  });
});

// ── Rule: A stack on its owner's land can be attacked by a raider with a lifeline (R1)

describe("a stack on its owner's land can be attacked by a raider with a lifeline (R1)", () => {
  it('lets a stack stepping from its own land attack a stack on enemy land', () => {
    // Scenario: A stack stepping from its own land attacks a stack on enemy land
    const table = onBoard();
    const { ourIn: from, ourExit: exit } = anInterleaving(table.geometry, MINIMAL_DIAMETER);
    const before = stateOf(
      [
        { arrow: from, owner: B, heads: 4 },
        { arrow: exit, owner: A, heads: 1 },
      ],
      B,
      { territory: [{ arrow: from, owner: B }, { arrow: exit, owner: A }] },
    );
    const offered = table.rules
      .legalMoves(before)
      .some((m) => m.kind === 'step' && m.from === from && m.exit === exit);
    expect(offered).toBe(true);

    const after = table.rules.apply(before, step(from, exit, 3));

    expect(ownerOf(after, exit)).toBe(B);
  });
});
