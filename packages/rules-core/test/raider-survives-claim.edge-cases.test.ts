/**
 * docs/spec/raider-survives-claim/raider-survives-claim.edge-cases.feature — one test
 * per scenario.
 *
 * All on the generated tiling (the pocket is enclosed ground). A closes a 6-ring of
 * trail; B's side is authored per scenario through the port-searched helpers in
 * `raider-survives-claim.support.ts`.
 *
 * @see docs/spec/raider-survives-claim/raider-survives-claim.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, rational, step } from '@conquarrow/contracts';
import type { ArrowId } from '@conquarrow/contracts';
import {
  A,
  B,
  byId,
  exitsFrom,
  headsOn,
  isTrail,
  ownerOf,
  snapshot,
  territoryOf,
  via,
} from './support';
import {
  aClosing,
  aRoadThroughThePocket,
  aShieldedRaider,
  aSpawnerBy,
  firstShielded,
  touches,
} from './raider-survives-claim.support';
import type { Closing, Shielded } from './raider-survives-claim.support';

const isClaimed = (closing: Closing, arrow: ArrowId): boolean => closing.claimed.has(arrow);

/** The state where B x`heads` stands on `p` with its shielding road, before A closes. */
const shieldedBefore = (closing: Closing, shielded: Shielded, heads = 1) =>
  closing.before({
    groups: [{ arrow: shielded.p, owner: B, heads }],
    trail: shielded.stretch,
    territory: [shielded.feeder],
  });

// ── Rule: The whole shielding stretch stays (decision 2) ──────────────────────

describe('the whole shielding stretch stays (decision 2)', () => {
  it("keeps a raider's road home through the claim with it", () => {
    // Scenario: A raider's road home through the claim stays with it
    const closing = aClosing();
    const { table } = closing;
    const { p, r, stretch, feeder } = aRoadThroughThePocket(closing);
    const before = closing.before({
      groups: [{ arrow: p, owner: B, heads: 1 }],
      trail: stretch,
      territory: [feeder],
    });
    expect(isClaimed(closing, p)).toBe(true);
    expect(isClaimed(closing, r)).toBe(true);
    expect(table.rules.anchorGrade(before, p, B)).toBe('territory');
    // Without r, p would be cut off from home: the grade passes through r.
    const withoutR = closing.before({
      groups: [{ arrow: p, owner: B, heads: 1 }],
      trail: stretch.filter((a) => a !== r),
      territory: [feeder],
    });
    expect(table.rules.anchorGrade(withoutR, p, B)).not.toBe('territory');

    const after = table.rules.apply(before, closing.close);

    expect(territoryOf(after, p)).toBe(A);
    expect(territoryOf(after, r)).toBe(A);
    expect(isTrail(after, B, p)).toBe(true);
    expect(isTrail(after, B, r)).toBe(true);
    expect(ownerOf(after, p)).toBe(B);
  });

  it('still strips a separate bare stretch of the same player', () => {
    // Scenario: A separate bare stretch of the same player is still stripped
    const closing = aClosing();
    const { table } = closing;
    const shielded = firstShielded(closing);
    const withSecond = (second: ArrowId) =>
      closing.before({
        groups: [{ arrow: shielded.p, owner: B, heads: 1 }],
        trail: [...shielded.stretch, second],
        territory: [shielded.feeder],
      });
    // A claimed arrow sharing no point with the shielding stretch, off the closing
    // traversal so the closing step cuts nothing.
    const s = [...closing.claimed]
      .toSorted(byId)
      .find(
        (c) =>
          !shielded.stretch.includes(c) &&
          shielded.stretch.every((a) => !touches(table.geometry, a, c)) &&
          !table.rules.crossesTrail(withSecond(c), via(closing.tip, closing.landing), B),
      );
    if (s === undefined) throw new Error('setup: no claimed arrow is clear of the stretch and the close');
    const before = withSecond(s);
    expect(table.rules.crossesTrail(before, via(closing.tip, closing.landing), B)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    expect(isTrail(after, B, shielded.p)).toBe(true);
    expect(isTrail(after, B, s)).toBe(false);
  });

  it('strips a territory-grade stretch with no head on it', () => {
    // Scenario: A territory-grade stretch with no head on it is stripped
    const closing = aClosing();
    const { table } = closing;
    const shielded = firstShielded(closing);
    const before = closing.before({ trail: shielded.stretch, territory: [shielded.feeder] });
    expect(table.rules.anchorGrade(before, shielded.p, B)).toBe('territory');

    const after = table.rules.apply(before, closing.close);

    for (const c of closing.claimed) expect(isTrail(after, B, c)).toBe(false);
  });
});

// ── Rule: Grade is judged on the board the claim leaves (decision 3) ──────────

describe('grade is judged on the board the claim leaves (decision 3)', () => {
  it("converts a raider whose anchoring territory the closure carves out", () => {
    // Scenario: A closure that carves out the raider's anchoring territory converts it
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
      groups: [{ arrow: p, owner: B, heads: 2 }],
      trail: [p],
      territory: [f],
    });
    expect(table.rules.anchorGrade(before, p, B)).toBe('territory');
    expect(isClaimed(closing, f)).toBe(true);

    const after = table.rules.apply(before, closing.close);

    expect(territoryOf(after, f)).toBe(A);
    expect(territoryOf(after, p)).toBe(A);
    expect(ownerOf(after, p)).toBe(A);
    expect(headsOn(after, p)).toBe(2);
    expect(isTrail(after, B, p)).toBe(false);
  });
});

// ── Rule: Only a stretch keeping a group from conversion is spared (decision 4)
//
// Superseded by C2 (the human, 2026-11-05; SPEC §7, P88): a claim alone never
// removes a territory-grade stretch carrying its owner's stack, wherever the stack
// stands. The pinned outcome flips: r stays in B's trail.

describe('only a stretch keeping a group from conversion is spared (decision 4, superseded by C2)', () => {
  it('keeps the claimed part of the trail of a raider on neutral ground', () => {
    // Scenario: A raider on neutral ground loses the part of its trail the claim takes
    // (superseded by C2 — see spec-alignment.core.feature, "A raider on neutral ground
    // keeps the part of its trail the claim takes")
    const closing = aClosing();
    const { table } = closing;
    const { geometry } = table;
    const avoid = new Set<ArrowId>([...closing.claimed, closing.landing, closing.far]);
    const found = [...closing.claimed]
      .toSorted(byId)
      .flatMap((r) =>
        [geometry.origin(r), geometry.target(r)]
          .filter((point) => point !== closing.closePoint)
          .flatMap((point) => [...geometry.inArrows(point), ...geometry.outArrows(point)])
          .filter((n) => !avoid.has(n))
          .toSorted(byId)
          .flatMap((n) =>
            [...geometry.inArrows(geometry.origin(n))]
              .filter((f) => !avoid.has(f) && f !== n)
              .toSorted(byId)
              .map((f) => ({ r, n, f })),
          ),
      )
      .find(({ r, n, f }) => {
        const state = closing.before({
          groups: [{ arrow: n, owner: B, heads: 1 }],
          trail: [n, r],
          territory: [f],
        });
        return (
          table.rules.anchorGrade(state, n, B) === 'territory' &&
          !table.rules.crossesTrail(state, via(closing.tip, closing.landing), B)
        );
      });
    if (found === undefined) throw new Error('setup: no neutral raider beside the claim');
    const { r, n, f } = found;
    const before = closing.before({
      groups: [{ arrow: n, owner: B, heads: 1 }],
      trail: [n, r],
      territory: [f],
    });
    expect(territoryOf(before, n)).toBeUndefined();
    expect(isClaimed(closing, n)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    expect(territoryOf(after, r)).toBe(A);
    expect(isTrail(after, B, r)).toBe(true);
    expect(ownerOf(after, n)).toBe(B);
  });
});

// ── Rule: Every claimed arrow changes owner (invariant 1) ─────────────────────

describe('every claimed arrow changes owner (invariant 1)', () => {
  it('makes the arrow under a surviving raider the closer’s land and resets its accumulator', () => {
    // Scenario: An arrow under a surviving raider is the closer's land, and counts as captured
    const closing = aClosing();
    const { table } = closing;
    const shielded = firstShielded(closing);
    const { p } = shielded;
    // p is neutral before the claim; its share carries a nonzero accumulator that the
    // capture must reset (§7, resetAccumulatorsOnCapture).
    const before = closing.before({
      groups: [{ arrow: p, owner: B, heads: 1 }],
      trail: shielded.stretch,
      territory: [shielded.feeder],
      accumulators: [[p, rational(1, 3)]],
      spawners: [
        aSpawnerBy(table.geometry, p),
        aSpawnerBy(table.geometry, closing.landing),
        aSpawnerBy(table.geometry, closing.far),
      ],
    });
    expect(before.accumulators.get(p)?.num).toBe(1);

    const after = table.rules.apply(before, closing.close);

    expect(territoryOf(after, p)).toBe(A);
    expect(after.accumulators.get(p)?.num ?? 0).toBe(0);
  });
});

// ── Rule: The surviving raider is ordinary trail on enemy land afterwards ─────

describe('the surviving raider is ordinary trail on enemy land afterwards', () => {
  it("converts the surviving raider on the apply whose cut drops its grade", () => {
    // Scenario: A cut that drops the surviving raider's grade converts it on that apply
    const closing = aClosing();
    const { table } = closing;
    const { geometry } = table;
    const shielded = firstShielded(closing);
    const used = new Set<ArrowId>([
      ...closing.claimed,
      ...shielded.stretch,
      shielded.feeder,
      closing.landing,
      closing.far,
    ]);
    // A second A head that steps onto the road — coinciding with B's trail is a cut (§2).
    const cut = shielded.road
      .flatMap((a) =>
        [...geometry.inArrows(geometry.origin(a))]
          .filter((x) => !used.has(x))
          .toSorted(byId)
          .map((x) => ({ x, a })),
      )
      .at(0);
    if (cut === undefined) throw new Error('setup: no free arrow steps onto the road');
    const before = closing.before({
      groups: [{ arrow: shielded.p, owner: B, heads: 2 }],
      trail: shielded.stretch,
      territory: [shielded.feeder],
      moreA: [{ arrow: cut.x, owner: A, heads: 1 }],
    });

    const survived = table.rules.apply(before, closing.close);
    expect(ownerOf(survived, shielded.p)).toBe(B);
    expect(isTrail(survived, B, shielded.p)).toBe(true);
    expect(table.rules.crossesTrail(survived, via(cut.x, cut.a), B)).toBe(true);

    const after = table.rules.apply(survived, step(cut.x, cut.a, 1));

    expect(ownerOf(after, shielded.p)).toBe(A);
    expect(headsOn(after, shielded.p)).toBe(2);
    expect(isTrail(after, B, shielded.p)).toBe(false);
  });

  it("lets the surviving raider's owner claim its arrow back", () => {
    // Scenario: The surviving raider's owner can claim its arrow back
    const closing = aClosing();
    const { table } = closing;
    const used = (s: Shielded): ReadonlySet<ArrowId> =>
      new Set([...closing.claimed, ...s.stretch, s.feeder, closing.landing, closing.far]);
    const found = closing.interior
      .map((p) => aShieldedRaider(closing, p))
      .flatMap((s) =>
        s === undefined
          ? []
          : exitsFrom(table.geometry, s.p)
              .filter((g) => !used(s).has(g))
              .map((g) => ({ s, g })),
      )
      .at(0);
    if (found === undefined) throw new Error('setup: no raider has a free exit to make B land');
    const { s, g } = found;
    const before = closing.before({
      groups: [{ arrow: s.p, owner: B, heads: 1 }],
      trail: s.stretch,
      territory: [s.feeder, g],
    });

    const survived = table.rules.apply(before, closing.close);
    expect(ownerOf(survived, s.p)).toBe(B);
    expect(territoryOf(survived, s.p)).toBe(A);
    expect(isTrail(survived, B, s.p)).toBe(true);
    const bToMove = table.rules.apply(survived, endTurn());
    expect(bToMove.activePlayer).toBe(B);

    const after = table.rules.apply(bToMove, step(s.p, g, 1));

    expect(territoryOf(after, s.p)).toBe(B);
  });
});

// ── Rule: Purity ──────────────────────────────────────────────────────────────

describe('purity', () => {
  it('yields equal outputs for equal inputs and does not mutate the input', () => {
    // Scenario: Equal inputs yield equal outputs, and the input is not mutated
    const closing = aClosing();
    const { table } = closing;
    const s0 = shieldedBefore(closing, firstShielded(closing), 2);
    const pictured = snapshot(s0);

    const once = table.rules.apply(s0, closing.close);
    const twice = table.rules.apply(s0, closing.close);

    expect(snapshot(once)).toEqual(snapshot(twice));
    expect(snapshot(s0)).toEqual(pictured);
  });
});

// ── Who a stretch shields (phase 3: the guards the scenarios above leave open) ─

describe('who a stretch shields', () => {
  it("strips the closer's own trail even when it carries the closer onto enemy land", () => {
    // §7 / P13 D6: the closer's path becomes territory, so its trail there goes.
    // Only *enemy* trail is ever shielded (§7, P87) — here A's own fork arm runs onto
    // B's land with an A head on it, and A's stretch is territory grade.
    const closing = aClosing();
    const { table, wall } = closing;
    const { geometry } = table;
    const ringPoint = (point: unknown): boolean => closing.ringPoints.has(String(point));
    const arm = wall
      .map((w) => geometry.target(w))
      .filter((point) => point !== closing.closePoint)
      .flatMap((point) => [...geometry.outArrows(point)].toSorted(byId))
      .find(
        (x) =>
          !isClaimed(closing, x) &&
          x !== closing.landing &&
          x !== closing.far &&
          !ringPoint(geometry.target(x)),
      );
    if (arm === undefined) throw new Error('setup: no arm leaves the ring');
    const base = closing.before({
      moreA: [{ arrow: arm, owner: A, heads: 1 }],
      territory: [arm],
    });
    const before = { ...base, trails: new Map(base.trails).set(A, new Set([...wall, arm])) };
    expect(territoryOf(before, arm)).toBe(B);

    const after = table.rules.apply(before, closing.close);

    for (const w of wall) {
      expect(territoryOf(after, w)).toBe(A);
      expect(isTrail(after, A, w)).toBe(false);
    }
    expect(isTrail(after, A, arm)).toBe(true);
    expect(ownerOf(after, arm)).toBe(A);
  });

  it('does not let a head off its own trail shield the stretch beside it', () => {
    // A stretch *carries* a group only when the group stands on it (§7). B's head on
    // `p` has no mark there, so B's road through the pocket shields no one: its
    // claimed part is stripped and the head converts (§6.3).
    const closing = aClosing();
    const { table } = closing;
    const { p, r, road, feeder } = aRoadThroughThePocket(closing);
    const before = closing.before({
      groups: [{ arrow: p, owner: B, heads: 1 }],
      trail: [r, ...road],
      territory: [feeder],
    });
    expect(isTrail(before, B, p)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    expect(isTrail(after, B, r)).toBe(false);
    expect(ownerOf(after, p)).toBe(A);
  });

  it('strips a stack-grade stretch past the firebreak that halts the convert wipe', () => {
    // §6.3: stack grade does not protect, so the claim strips the stretch (§7). B's
    // raider stands on A's existing land outside the ring; its trail runs through a
    // B head on neutral ground into the pocket. The convert wipe (P33) halts at that
    // head and would leave the claimed arrow beyond it marked; the strip removes it.
    const closing = aClosing();
    const { table } = closing;
    const { geometry } = table;
    const ends = (a: ArrowId): readonly string[] =>
      [geometry.origin(a), geometry.target(a)].map(String);
    const outside = (a: ArrowId): boolean =>
      !isClaimed(closing, a) &&
      a !== closing.landing &&
      a !== closing.far &&
      !ends(a).includes(String(closing.closePoint));
    const neighbours = (a: ArrowId): readonly ArrowId[] =>
      [geometry.origin(a), geometry.target(a)]
        .flatMap((point) => [...geometry.inArrows(point), ...geometry.outArrows(point)])
        .toSorted(byId);
    /** Shortest run of outside arrows from one touching `p` to one touching `r`. */
    const pathBetween = (p: ArrowId, r: ArrowId): readonly ArrowId[] | undefined => {
      const parent = new Map<ArrowId, ArrowId | undefined>();
      const queue = neighbours(p).filter((a) => a !== p && outside(a));
      for (const seed of queue) parent.set(seed, undefined);
      for (let i = 0; i < queue.length && i < 200; i += 1) {
        const here = queue[i];
        if (here === undefined) break;
        if (touches(geometry, here, r)) {
          const path: ArrowId[] = [];
          for (let at: ArrowId | undefined = here; at !== undefined; at = parent.get(at)) {
            path.unshift(at);
          }
          return path;
        }
        for (const next of neighbours(here).filter((a) => a !== p && outside(a))) {
          if (parent.has(next)) continue;
          parent.set(next, here);
          queue.push(next);
        }
      }
      return undefined;
    };
    const near = [...geometry.window(geometry.origin(closing.landing), 3).arrows]
      .filter(outside)
      .toSorted(byId);
    const found = near
      .flatMap((p) =>
        closing.interior
          .filter((r) => !touches(geometry, p, r))
          .flatMap((r) => {
            const path = pathBetween(p, r);
            const n = path?.[0];
            if (path === undefined || n === undefined) return [];
            const before = closing.before({
              groups: [
                { arrow: p, owner: B, heads: 1 },
                { arrow: n, owner: B, heads: 1 },
              ],
              trail: [p, ...path, r],
              alsoA: [p],
            });
            return [{ p, r, n, before }];
          }),
      )
      .find(
        ({ r, n, before }) =>
          table.rules.anchorGrade(before, r, B) === 'stack' &&
          !table.rules.crossesTrail(before, via(closing.tip, closing.landing), B) &&
          territoryOf(before, n) === undefined,
      );
    if (found === undefined) throw new Error('setup: no stack-grade raider reaches the pocket past a firebreak');
    const { p, r, n, before } = found;

    const after = table.rules.apply(before, closing.close);

    expect(territoryOf(after, r)).toBe(A);
    expect(ownerOf(after, p)).toBe(A);
    expect(ownerOf(after, n)).toBe(B);
    expect(isTrail(after, B, n)).toBe(true);
    expect(isTrail(after, B, r)).toBe(false);
  });
});
