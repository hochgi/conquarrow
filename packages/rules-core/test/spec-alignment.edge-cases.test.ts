/**
 * docs/spec/spec-alignment/spec-alignment.edge-cases.feature — one test per scenario.
 *
 * R3 and D2 on the `minimal` fixture; D1, C2 and R2 on the generated tiling, through
 * P87's closing (`raider-survives-claim.support.ts`). Every configuration is
 * searched for through the port.
 *
 * @see docs/spec/spec-alignment/spec-alignment.md
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  byId,
  anArrow,
  anExitFrom,
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
import { aClosing, firstShielded } from './raider-survives-claim.support';
import {
  aFeeding,
  aLongRoad,
  anAnchorRing,
  anAsideArm,
  longRoads,
  marksOf,
} from './spec-alignment.support';

// ── Rule: Landing decides the cut (R3) ────────────────────────────────────────

describe('landing decides the cut (R3)', () => {
  it('neither cuts nor marks when a mutual wipe does not land', () => {
    // Scenario: A mutual wipe neither cuts nor marks
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
        // `exit` is off B's trail, so B's combat wipe there evaporates nothing
        // and only a crossing cut could take `trailOut`.
        trail: { B: [trailIn, trailOut] },
        territory: [{ arrow: trailIn, owner: B }],
      },
    );
    expect(table.rules.crossesTrail(before, via(from, exit), B)).toBe(true);

    const after = table.rules.apply(before, step(from, exit, 2));

    expect(ownerOf(after, exit)).toBeUndefined();
    expect(isTrail(after, B, trailOut)).toBe(true);
    expect(isTrail(after, A, exit)).toBe(false);
    expect(headsOn(after, from)).toBe(1);
  });

  it("leaves the defender's other arms when an attack onto its trail arrow is repelled", () => {
    // Scenario: A repelled attack onto the defender's trail arrow leaves the other arms
    const table = onBoard();
    // The step does not interleave the other arm: it crosses B's trail only by
    // coinciding on `exit`.
    const { point, from, exit, armIn, armOut } = anAsideArm(table.geometry, MINIMAL_DIAMETER);
    expect(table.geometry.target(from)).toBe(point);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 2 },
        { arrow: exit, owner: B, heads: 2 },
      ],
      A,
      { trail: { B: [armIn, armOut, exit] } },
    );
    expect(table.rules.crossesTrail(before, via(from, exit), B)).toBe(true);

    const after = table.rules.apply(before, step(from, exit, 1));

    expect(ownerOf(after, exit)).toBe(B);
    expect(marksOf(after, B)).toEqual(marksOf(before, B));
  });
});

// ── Rule: The convert wipe and the strip (D1, decision 2) ─────────────────────

describe('the convert wipe and the strip (D1, decision 2)', () => {
  it('halts the convert wipe at the next victim stack on neutral ground', () => {
    // Scenario: The convert wipe halts at the next victim stack on neutral ground
    const closing = aClosing();
    const { table } = closing;
    const { p, r1, r2 } = aLongRoad(closing);
    const before = closing.before({
      groups: [
        { arrow: p, owner: B, heads: 2 },
        { arrow: r2, owner: B, heads: 1 },
      ],
      trail: [p, r1, r2],
    });
    expect(closing.claimed.has(p)).toBe(true);
    for (const a of [r1, r2]) {
      expect(closing.claimed.has(a)).toBe(false);
      expect(territoryOf(before, a)).toBeUndefined();
    }
    expect(table.rules.anchorGrade(before, p, B)).toBe('stack');

    const after = table.rules.apply(before, closing.close);

    expect(ownerOf(after, p)).toBe(A);
    expect(isTrail(after, B, r1)).toBe(false);
    expect(isTrail(after, B, r2)).toBe(true);
    expect(ownerOf(after, r2)).toBe(B);
  });

  it('removes bare claimed trail with no stack and converts nothing', () => {
    // Scenario: Bare claimed trail with no stack is removed and nothing converts
    const closing = aClosing();
    const { table } = closing;
    const bare = [...closing.interior, ...closing.wall.slice(1, 3)];
    // B's only group stands on its own distant land, off the claim.
    const before = closing.before({ trail: bare, groups: [{ arrow: closing.far, owner: B, heads: 2 }] });
    for (const a of bare) expect(closing.claimed.has(a)).toBe(true);
    expect(closing.claimed.has(closing.far)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    for (const a of bare) expect(isTrail(after, B, a)).toBe(false);
    expect(ownerOf(after, closing.far)).toBe(B);
    expect(headsOn(after, closing.far)).toBe(2);
    expect([...after.groups.values()].filter((g) => g.owner === A).map((g) => g.heads)).toEqual([1]);
  });
});

// ── Rule: The claim spares a stretch, not a stack (C2) ────────────────────────

describe('the claim spares a stretch, not a stack (C2)', () => {
  it('keeps the whole trail of a raider two neutral arrows from the claim', () => {
    // Scenario: A raider deeper in neutral ground keeps the same road
    const closing = aClosing();
    const { table } = closing;
    const { geometry, rules } = table;
    // p claimed; r1 touches p; r2 touches r1 but no ring point; B's land g feeds r2.
    const found = longRoads(closing)
      .flatMap(({ p, r1, r2 }) =>
        geometry
          .inArrows(geometry.origin(r2))
          .filter(
            (g) =>
              ![p, r1, r2, closing.landing, closing.far].includes(g) &&
              !closing.claimed.has(g) &&
              !closing.ringPoints.has(String(geometry.origin(g))),
          )
          .toSorted(byId)
          .map((g) => ({ p, r1, r2, g })),
      )
      .map((c) => ({
        ...c,
        before: closing.before({
          groups: [{ arrow: c.r2, owner: B, heads: 1 }],
          trail: [c.p, c.r1, c.r2],
          territory: [c.g],
        }),
      }))
      .find((c) => !rules.crossesTrail(c.before, via(closing.tip, closing.landing), B));
    if (found === undefined) throw new Error('setup: no territory-grade road reaches two arrows off the claim');
    const { p, r2: deep, before } = found;
    expect(closing.claimed.has(p)).toBe(true);
    expect(closing.claimed.has(deep)).toBe(false);
    expect(territoryOf(before, deep)).toBeUndefined();
    expect(table.rules.anchorGrade(before, deep, B)).toBe('territory');
    expect(table.rules.crossesTrail(before, via(closing.tip, closing.landing), B)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    expect(marksOf(after, B)).toEqual(marksOf(before, B));
  });

  it('leaves a territory-grade raider on a claimed arrow unchanged', () => {
    // Scenario: A territory-grade raider on a claimed arrow is still unchanged
    const closing = aClosing();
    const { table } = closing;
    const { p, stretch, feeder } = firstShielded(closing);
    const before = closing.before({
      groups: [{ arrow: p, owner: B, heads: 1 }],
      trail: stretch,
      territory: [feeder],
    });
    expect(closing.claimed.has(p)).toBe(true);
    expect(closing.claimed.has(feeder)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    expect(ownerOf(after, p)).toBe(B);
    expect(table.rules.anchorGrade(after, p, B)).toBe('territory');
  });
});

// ── Rule: The claim root cut is the ordinary cut (R2) ─────────────────────────

describe('the claim root cut is the ordinary cut (R2)', () => {
  it('converts a raider when the anchor-carving claim also encloses it', () => {
    // Scenario: The anchor-carving claim that also encloses the raider converts it
    const closing = aClosing();
    const { table } = closing;
    const pair = closing.interior
      .flatMap((p) =>
        closing.interior
          .filter((f) => f !== p && table.geometry.target(f) === table.geometry.origin(p))
          .map((f) => ({ p, f })),
      )
      .at(0);
    if (pair === undefined) throw new Error('setup: no interior arrow feeds another');
    const { p, f } = pair;
    const before = closing.before({
      groups: [{ arrow: p, owner: B, heads: 1 }],
      trail: [p],
      territory: [f],
    });
    expect(table.rules.anchorGrade(before, p, B)).toBe('territory');
    expect(closing.claimed.has(f)).toBe(true);

    const after = table.rules.apply(before, closing.close);

    expect(ownerOf(after, p)).toBe(A);
    expect(headsOn(after, p)).toBe(1);
    expect(isTrail(after, B, p)).toBe(false);
  });
});

// ── Rule: The clean-feeder predicate is shared (D2) ───────────────────────────

describe('the clean-feeder predicate is shared (D2)', () => {
  it('grades a stretch territory when its only feeder is clean', () => {
    // Scenario: A clean feeder anchors
    const table = onBoard();
    const { out, p0, feeder } = aFeeding(table);
    const before = stateOf([{ arrow: out, owner: B, heads: 1 }], A, {
      trail: { B: [out] },
      territory: [{ arrow: feeder, owner: B }],
    });
    expect(table.geometry.inArrows(p0).filter((a) => territoryOf(before, a) === B)).toEqual([feeder]);
    expect(isTrail(before, A, feeder)).toBe(false);

    expect(table.rules.anchorGrade(before, out, B)).toBe('territory');
  });
});

// ── Rule: A step that does not land claims nothing (R3, review B2) ────────────

describe('a step that does not land claims nothing (R3)', () => {
  it('does not close when an attack from trail onto own territory is repelled', () => {
    // Scenario: A repelled attack from trail onto the attacker's own territory does not close
    const { geometry, rules } = onBoard();
    const from = anArrow(geometry);
    const exit = anExitFrom(geometry, from);
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 2 },
        { arrow: exit, owner: B, heads: 2 },
      ],
      A,
      { trail: { A: [from], B: [exit] }, territory: [{ arrow: exit, owner: A }] },
    );
    expect(rules.closureOf(before, step(from, exit, 1), A)).toBeDefined();

    const after = rules.apply(before, step(from, exit, 1));

    // A is repelled (1 v 2): its stay-behind is still on its trail tip, unclaimed.
    expect(headsOn(after, from)).toBe(1);
    expect(territoryOf(after, from)).toBeUndefined();
    expect(isTrail(after, A, from)).toBe(true);
  });
});

// ── Rule: Only a clean feeder taken is a cut (R2, review B1) ──────────────────

describe('only a clean feeder taken is a cut (R2)', () => {
  it('does not cut when the claimed anchor was already in an enemy trail', () => {
    // Scenario: A claim that takes a feeder already in an enemy trail is not a cut
    const table = onTiling();
    const { ring, road } = anAnchorRing(table);
    const { e1, e2 } = road;
    const base = ring.before({ groups: [{ arrow: e2, owner: B, heads: 1 }], trail: [e1, e2] });
    const trailA = new Set([...(base.trails.get(A) ?? []), ring.f]);
    const before = { ...base, trails: new Map([...base.trails, [A, trailA]]) };
    expect(table.rules.anchorGrade(before, e2, B)).toBe('stack');

    const after = table.rules.apply(before, ring.close);

    expect(territoryOf(after, ring.f)).toBe(A);
    expect(isTrail(after, B, e1)).toBe(true);
    expect(isTrail(after, B, e2)).toBe(true);
  });
});
