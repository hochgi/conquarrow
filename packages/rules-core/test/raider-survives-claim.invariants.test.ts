/**
 * The EARS invariants of docs/spec/raider-survives-claim/raider-survives-claim.md,
 * as properties over a family of closures.
 *
 * The family: several directed 6-rings near the tiling's seed, every arrow of each
 * ring's pocket as the raider's arrow, and every shape of B's side the overview
 * distinguishes — a shielded raider, the same raider on ground already the closer's,
 * a stack-grade raider, a trail-less head, a raider whose anchoring territory the
 * claim carves out, a territory-grade stretch with nobody on it, and (C2, P88) the
 * same stretch with its stack off the claim on neutral ground.
 *
 * The expected outcome is never hard-coded per shape. It is read from two oracles in
 * the support file that only ask the port: the post-claim board (claimed arrows
 * written as A's, every trail kept) and `anchorGrade` on it.
 *
 * @see docs/spec/raider-survives-claim/raider-survives-claim.md
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId, GameState } from '@conquarrow/contracts';
import { A, B, isTrail, onTiling, ownerOf, snapshot, territoryOf, totalHeads, via } from './support';
import {
  aShieldedRaider,
  closings,
  postClaimBoard,
  shieldingArrows,
} from './raider-survives-claim.support';
import type { Closing } from './raider-survives-claim.support';

type Shape =
  | 'shielded'
  | 'alreadyA'
  | 'stack'
  | 'noTrail'
  | 'carveOut'
  | 'bareGraded'
  | 'neutralRaider';

interface Case {
  readonly name: string;
  readonly shape: Shape;
  readonly closing: Closing;
  readonly p: ArrowId;
  readonly before: GameState;
}

const casesFor = (closing: Closing): readonly Case[] => {
  const { geometry } = closing.table;
  const cases: Case[] = [];
  const add = (shape: Shape, p: ArrowId, before: GameState): void => {
    cases.push({ name: `${shape} on ${String(p)} in ring ${String(closing.tip)}`, shape, closing, p, before });
  };
  for (const p of closing.interior) {
    const raider = [{ arrow: p, owner: B, heads: 2 }];
    add('stack', p, closing.before({ groups: raider, trail: [p] }));
    add('noTrail', p, closing.before({ groups: raider }));
    const shielded = aShieldedRaider(closing, p);
    if (shielded !== undefined) {
      const side = { trail: shielded.stretch, territory: [shielded.feeder] };
      add('shielded', p, closing.before({ ...side, groups: raider }));
      add('alreadyA', p, closing.before({ ...side, groups: raider, alsoA: [p] }));
      add('bareGraded', p, closing.before(side));
      // C2 (SPEC §7, P88): the stack on the first road arrow, off the claim on
      // neutral ground — its stretch through p is shielding all the same.
      const off = shielded.road[0];
      if (off !== undefined) {
        add('neutralRaider', p, closing.before({ ...side, groups: [{ arrow: off, owner: B, heads: 1 }] }));
      }
    }
    const carve = closing.interior.find(
      (f) => f !== p && geometry.target(f) === geometry.origin(p),
    );
    if (carve !== undefined) {
      add('carveOut', p, closing.before({ groups: raider, trail: [p], territory: [carve] }));
    }
  }
  // Only closures that cut nothing: the step's cut is P12's business, not this one.
  return cases.filter(
    (c) => !closing.table.rules.crossesTrail(c.before, via(closing.tip, closing.landing), B),
  );
};

const table = onTiling();
const family: readonly Case[] = closings(table, 4).flatMap(casesFor);
const after = new Map<Case, GameState>(
  family.map((c) => [c, c.closing.table.rules.apply(c.before, c.closing.close)] as const),
);
const afterOf = (c: Case): GameState => {
  const state = after.get(c);
  if (state === undefined) throw new Error('setup: that case was not applied');
  return state;
};

const shieldingOf = (c: Case): ReadonlySet<ArrowId> =>
  shieldingArrows(c.closing.table, c.before, c.closing.claimed, A, B);

const bMarks = (state: GameState): readonly ArrowId[] => [...(state.trails.get(B) ?? [])];

/** B groups whose owner the apply changed. */
const conversions = (c: Case): readonly ArrowId[] =>
  [...c.before.groups]
    .filter(([arrow, group]) => group.owner === B && ownerOf(afterOf(c), arrow) !== B)
    .map(([arrow]) => arrow);

describe('the family is not vacuous', () => {
  it('holds shielded raiders and converting raiders on several rings', () => {
    expect(new Set(family.map((c) => String(c.closing.tip))).size).toBeGreaterThan(1);
    expect(family.filter((c) => c.shape === 'shielded').length).toBeGreaterThan(1);
    expect(family.filter((c) => c.shape === 'stack').length).toBeGreaterThan(1);
    expect(family.filter((c) => c.shape === 'carveOut').length).toBeGreaterThan(0);
    expect(family.filter((c) => shieldingOf(c).size > 0).length).toBeGreaterThan(1);
    expect(family.filter((c) => c.shape === 'neutralRaider').length).toBeGreaterThan(0);
  });
});

describe('invariant 1 — every claimed arrow becomes the closer’s territory', () => {
  it.each(family)('$name', (c) => {
    for (const arrow of c.closing.claimed) expect(territoryOf(afterOf(c), arrow)).toBe(A);
  });
});

describe('invariant 2 — a shielding stretch keeps every arrow of its trail', () => {
  it.each(family.filter((c) => shieldingOf(c).size > 0))('$name', (c) => {
    for (const arrow of shieldingOf(c)) expect(isTrail(afterOf(c), B, arrow)).toBe(true);
  });
});

describe('invariant 3 — enemy trail on a claimed arrow outside a shielding stretch is removed', () => {
  it.each(family)('$name', (c) => {
    const shielding = shieldingOf(c);
    for (const arrow of bMarks(c.before)) {
      if (!c.closing.claimed.has(arrow) || shielding.has(arrow)) continue;
      expect(isTrail(afterOf(c), B, arrow)).toBe(false);
    }
  });
});

describe('invariant 4 — enemy trail off the claim is untouched when nothing converts', () => {
  it.each(family)('$name', (c) => {
    if (conversions(c).length > 0) return;
    const off = (state: GameState): readonly string[] =>
      bMarks(state)
        .filter((arrow) => !c.closing.claimed.has(arrow))
        .map(String)
        .toSorted();
    expect(off(afterOf(c))).toEqual(off(c.before));
  });
});

describe('invariant 5 — a group on a claimed arrow converts iff no territory-grade stretch holds it on the post-claim board', () => {
  it.each(family.filter((c) => c.before.groups.get(c.p)?.owner === B))('$name', (c) => {
    const board = postClaimBoard(c.before, c.closing.claimed, A);
    const protectedByGrade =
      isTrail(board, B, c.p) && c.closing.table.rules.anchorGrade(board, c.p, B) === 'territory';
    expect(ownerOf(afterOf(c), c.p)).toBe(protectedByGrade ? B : A);
    expect(afterOf(c).groups.get(c.p)?.heads).toBe(c.before.groups.get(c.p)?.heads);
  });
});

describe('invariant 6 — the outcome does not depend on whether the arrow was already the closer’s', () => {
  const pairs = family
    .filter((c) => c.shape === 'shielded')
    .flatMap((claimedNow) => {
      const alreadyA = family.find(
        (c) => c.shape === 'alreadyA' && c.closing === claimedNow.closing && c.p === claimedNow.p,
      );
      return alreadyA === undefined ? [] : [{ name: claimedNow.name, claimedNow, alreadyA }];
    });

  it.each(pairs)('$name', ({ claimedNow, alreadyA }) => {
    const left = afterOf(claimedNow);
    const right = afterOf(alreadyA);
    expect(left.groups.get(claimedNow.p)).toEqual(right.groups.get(alreadyA.p));
    expect(territoryOf(left, claimedNow.p)).toBe(territoryOf(right, alreadyA.p));
    expect(isTrail(left, B, claimedNow.p)).toBe(isTrail(right, B, alreadyA.p));
    expect(bMarks(left).map(String).toSorted()).toEqual(bMarks(right).map(String).toSorted());
  });
});

describe('invariant 7 — a closure with no combat conserves heads', () => {
  it.each(family)('$name', (c) => {
    expect(totalHeads(afterOf(c))).toBe(totalHeads(c.before));
  });
});

describe('invariant 8 — apply is pure and deterministic', () => {
  it.each(family)('$name', (c) => {
    const pictured = snapshot(c.before);
    const again = c.closing.table.rules.apply(c.before, c.closing.close);
    expect(snapshot(again)).toEqual(snapshot(afterOf(c)));
    expect(snapshot(c.before)).toEqual(pictured);
  });
});
