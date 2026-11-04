/**
 * docs/spec/raider-survives-claim/raider-survives-claim.core.feature — one test per
 * scenario.
 *
 * The two playtest scenarios replay the committed 2026-11-04 log; the rest run on the
 * generated tiling, because the claim's pocket is enclosed ground and only an
 * unbounded board can host enclosure (closure.md). No arrow outside the log is named
 * literally.
 *
 * @see docs/spec/raider-survives-claim/raider-survives-claim.md
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId } from '@conquarrow/contracts';
import { A, B, headsOn, isTrail, ownerOf, territoryOf, via } from './support';
import {
  C,
  aClosing,
  firstShielded,
  playtest20261104,
  stateAt,
} from './raider-survives-claim.support';

const arrow = mintArrowId;

// The log is folded once for the file (~0.5 s) and shared by both playtest scenarios.
const log = playtest20261104(345);

// ── Rule: The playtest case is fixed (playtest 2026-11-04, move #345) ─────────

describe('the playtest case is fixed (move #345)', () => {
  it("A's raider on the arrow C's close claims stays A", () => {
    // Scenario: A's raider on the arrow C's close claims stays A
    const raider = arrow('tiling:a:2,2,2');
    const feeder = arrow('tiling:a:2,3,2');
    const claimed = ['tiling:a:2,1,0', 'tiling:a:2,2,2', 'tiling:a:3,1,1'].map(arrow);
    const before = stateAt(log.states, 345);
    const move = log.moves[345];
    expect(move).toEqual({
      kind: 'step',
      from: arrow('tiling:a:3,1,1'),
      exit: arrow('tiling:a:2,2,1'),
      count: 2,
    });

    // Given: A x1 on 2,2,2, A's trail exactly {2,2,2}, territory grade via 2,3,2.
    expect(ownerOf(before, raider)).toBe(A);
    expect(headsOn(before, raider)).toBe(1);
    expect([...(before.trails.get(A) ?? [])].map(String)).toEqual([String(raider)]);
    expect(territoryOf(before, feeder)).toBe(A);
    expect(log.table.geometry.target(feeder)).toBe(log.table.geometry.origin(raider));
    expect(log.table.rules.anchorGrade(before, raider, A)).toBe('territory');

    const after = stateAt(log.states, 346);

    for (const c of claimed) expect(territoryOf(after, c)).toBe(C);
    expect(ownerOf(after, raider)).toBe(A);
    expect(headsOn(after, raider)).toBe(1);
    expect(isTrail(after, A, raider)).toBe(true);
    expect(log.table.rules.anchorGrade(after, raider, A)).toBe('territory');
    for (const c of claimed) expect(isTrail(after, C, c)).toBe(false);
  });
});

// ── Rule: The contrast case is unchanged (moves #329 to #331) ─────────────────

describe('the contrast case is unchanged (moves #329 to #331)', () => {
  it("B's raider on C's existing land survives a close and converts on the cut", () => {
    // Scenario: B's raider on C's existing land survives a close and converts on the cut
    const raider = arrow('tiling:a:-1,1,2');
    const road = arrow('tiling:a:-1,2,2');
    const before = stateAt(log.states, 329);
    expect(ownerOf(before, raider)).toBe(B);
    expect(headsOn(before, raider)).toBe(2);
    expect(territoryOf(before, raider)).toBe(C);

    const afterClose = stateAt(log.states, 330);
    expect(ownerOf(afterClose, raider)).toBe(B);
    expect(headsOn(afterClose, raider)).toBe(2);

    // Move 331: C steps onto B's trail arrow -1,2,2.
    const cut = log.moves[331];
    expect(cut?.kind === 'step' ? cut.exit : undefined).toBe(road);
    const afterCut = stateAt(log.states, 332);
    expect(ownerOf(afterCut, raider)).toBe(C);
    expect(headsOn(afterCut, raider)).toBe(2);
    expect(isTrail(afterCut, B, raider)).toBe(false);
    expect(isTrail(afterCut, B, road)).toBe(false);
  });
});

// ── Rule: A territory-grade raider on a claimed arrow is not converted ────────

describe('a territory-grade raider on a claimed arrow is not converted', () => {
  it("keeps a raider in the pocket a closure rings, with its arrow's trail and its owner", () => {
    // Scenario: A raider in the pocket a closure rings keeps its arrow's trail and its owner
    const closing = aClosing();
    const { table } = closing;
    const { p, stretch, feeder } = firstShielded(closing);
    const before = closing.before({
      groups: [{ arrow: p, owner: B, heads: 1 }],
      trail: stretch,
      territory: [feeder],
    });
    expect(closing.claimed.has(p)).toBe(true);
    for (const a of [...stretch.slice(1), feeder]) expect(closing.claimed.has(a)).toBe(false);
    expect(table.rules.anchorGrade(before, p, B)).toBe('territory');
    expect(table.rules.crossesTrail(before, via(closing.tip, closing.landing), B)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    expect(territoryOf(after, p)).toBe(A);
    expect(ownerOf(after, p)).toBe(B);
    expect(headsOn(after, p)).toBe(1);
    expect(isTrail(after, B, p)).toBe(true);
    expect(table.rules.anchorGrade(after, p, B)).toBe('territory');
  });

  it("gives the same outcome whether or not the raider's arrow was already the closer's", () => {
    // Scenario: The outcome does not depend on whether the raider's arrow was already the closer's
    const closing = aClosing();
    const { table } = closing;
    const { p, stretch, feeder } = firstShielded(closing);
    const raid = {
      groups: [{ arrow: p, owner: B, heads: 2 }],
      trail: stretch,
      territory: [feeder],
    } as const;
    const claimedNow = closing.before(raid);
    const alreadyA = closing.before({ ...raid, alsoA: [p] });
    expect(territoryOf(claimedNow, p)).toBeUndefined();
    expect(territoryOf(alreadyA, p)).toBe(A);
    expect(table.rules.anchorGrade(claimedNow, p, B)).toBe('territory');
    expect(table.rules.anchorGrade(alreadyA, p, B)).toBe('territory');

    const afterClaimed = table.rules.apply(claimedNow, closing.close);
    const afterAlready = table.rules.apply(alreadyA, closing.close);

    for (const after of [afterAlready, afterClaimed]) {
      expect(ownerOf(after, p)).toBe(B);
      expect(headsOn(after, p)).toBe(2);
      expect(territoryOf(after, p)).toBe(A);
      expect(isTrail(after, B, p)).toBe(true);
    }
  });
});

// ── Rule: Without a territory-grade stretch, a claim still converts and still strips

describe('without a territory-grade stretch, a claim still converts and still strips', () => {
  it('strips bare enemy trail on claimed arrows', () => {
    // Scenario: Bare enemy trail on claimed arrows is stripped
    const closing = aClosing();
    const { table } = closing;
    const bare = [...closing.interior, ...closing.wall.slice(1, 3)];
    const before = closing.before({ trail: bare });
    for (const a of bare) expect(closing.claimed.has(a)).toBe(true);

    const after = table.rules.apply(before, closing.close);

    for (const a of closing.claimed) {
      expect(isTrail(after, B, a)).toBe(false);
      expect(territoryOf(after, a)).toBe(A);
    }
  });

  it('converts a stack-grade raider on a claimed arrow and wipes its trail', () => {
    // Scenario: A stack-grade raider on a claimed arrow converts and its trail is wiped
    const closing = aClosing();
    const { table } = closing;
    const q = closing.interior[0];
    if (q === undefined) throw new Error('setup: that ring has no interior');
    const before = closing.before({ groups: [{ arrow: q, owner: B, heads: 2 }], trail: [q] });
    expect(table.rules.anchorGrade(before, q, B)).toBe('stack');

    const after = table.rules.apply(before, closing.close);

    expect(ownerOf(after, q)).toBe(A);
    expect(headsOn(after, q)).toBe(2);
    expect(isTrail(after, B, q)).toBe(false);
  });

  it('converts an enemy head with no trail on a claimed arrow', () => {
    // Scenario: An enemy head with no trail on a claimed arrow converts
    const closing = aClosing();
    const { table } = closing;
    const q = closing.interior[0];
    if (q === undefined) throw new Error('setup: that ring has no interior');
    const before = closing.before({ groups: [{ arrow: q, owner: B, heads: 3 }] });
    expect(isTrail(before, B, q)).toBe(false);

    const after = table.rules.apply(before, closing.close);

    expect(ownerOf(after, q)).toBe(A);
    expect(headsOn(after, q)).toBe(3);
  });
});
