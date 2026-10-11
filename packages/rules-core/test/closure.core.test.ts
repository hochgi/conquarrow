/**
 * docs/spec/closure/closure.core.feature — one test per scenario.
 *
 * **These run on the generated tiling, and that is not a preference.** P05b is the
 * first packet a fixture board cannot host: *enclosed* means cannot reach infinity
 * (SPEC §11 item 36), and a finite board has no infinity to fail to reach. The P05
 * suites stay on the fixtures, where a failure prints.
 *
 * No test names an arrow literally. Every relationship is asked of `GeometryPort`, so
 * a second implementation would satisfy the same scenarios.
 *
 * @see docs/spec/closure/closure.md
 */

import { describe, expect, it } from 'vitest';
import { speed, step } from '@conquarrow/contracts';
import {
  A,
  B,
  aRingWithAnInside,
  aRunFromHome,
  anExitFrom,
  arrowAt,
  exitsFrom,
  isTrail,
  landCountOf,
  onTiling,
  owned,
  pathFrom,
  pick,
  stateOf,
  territoryOf,
  trailOf,
} from './support';

// ── Rule: a closure is an ordinary step onto your own territory ───────────────

describe('a closure is an ordinary step onto your own territory', () => {
  it('claims the trail when a head lands on its own territory', () => {
    // §7: depart from your own territory, land back on it. No close action, no
    // declaration — P05 left this exact branch of the safety rule empty.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const last = arrowAt(run, 2);
    // A territory arrow leaving the point the run's tip feeds, so the tip can land.
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(before, step(last, landing, 1));

    for (const arrow of run) expect(territoryOf(after, arrow)).toBe(A);
    expect(trailOf(after, A)).toEqual([]);
  });

  it('claims nothing when a head moves inside its own territory', () => {
    // §5's free movement. The departed arrow is not trail, so there is no path to
    // claim — the clause every other rule in the packet leans on.
    const table = onTiling();
    const { home } = aRunFromHome(table.geometry, 1);
    const t2 = anExitFrom(table.geometry, home);
    const before = stateOf([{ arrow: home, owner: A, heads: 1 }], A, {
      territory: owned([home, t2], A),
    });

    const after = table.rules.apply(before, step(home, t2, 1));

    expect(trailOf(after, A)).toEqual([]);
    expect(territoryOf(after, t2)).toBe(A);
    // A's own ground, not the whole map: since P37 every authored seat owns the
    // minimum that keeps it legal, so B's home is on the board too.
    expect(landCountOf(after, A)).toBe(2);
  });

  it('does not treat a landing on enemy territory as a closure', () => {
    // §7 / P28: enterable from own territory or a territory-grade trail, and
    // exposing while you are there. Marking is trails' rule. Keep a territory-grade
    // lifeline so conversion does not strip the mark (P13).
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const last = arrowAt(run, 1);
    const enemy = anExitFrom(table.geometry, last);
    const before = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: [...owned([home], A), ...owned([enemy], B)],
    });

    const after = table.rules.apply(before, step(last, enemy, 1));

    expect(isTrail(after, A, enemy)).toBe(true);
    expect(territoryOf(after, enemy)).toBe(B);
    expect(territoryOf(after, arrowAt(run, 0))).toBeUndefined();
  });

  it('claims nothing when the closing head was not trailing', () => {
    // A head can reach its own border without trailing. Nothing was drawn, so nothing
    // closes — and the claim is empty rather than the whole board.
    const table = onTiling();
    const { home } = aRunFromHome(table.geometry, 1);
    const n1 = anExitFrom(table.geometry, home);
    const landing = anExitFrom(table.geometry, n1);
    const before = stateOf([{ arrow: n1, owner: A, heads: 1 }], A, {
      territory: owned([home, landing], A),
    });

    expect(table.rules.closureOf(before, step(n1, landing, 1), A)).toBeUndefined();
  });
});

// ── Rule: the claim is the trail walked backwards along the grain ─────────────

describe('the claim is the trail walked backwards along the grain', () => {
  it('claims a straight run home to its whole length', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const state = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });

    const claim = table.rules.closureOf(state, step(last, landing, 1), A);

    expect(claim?.path.map(String).toSorted()).toEqual(run.map(String).toSorted());
  });

  it('does not claim a fork’s other arm, because it is downstream', () => {
    // The pincer's first half, and the reason the walk runs backwards: arm Y is
    // downstream of the fork, so it stays an open trail with something left to ring.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const stem = arrowAt(run, 0);
    const armX = arrowAt(run, 1);
    const forkPoint = table.geometry.target(stem);
    const armY = pick(
      table.geometry.outArrows(forkPoint).filter((a) => a !== armX),
      0,
    );
    const landing = anExitFrom(table.geometry, armX);
    // A head on arm Y as well: the fork is a split of A's trail, and §5's toll wants
    // one of A's heads among its out-arrows before arm X may be vacated (§11 item 35).
    // That head is also what makes the second arm a *live* arm rather than a stub.
    const state = stateOf(
      [
        { arrow: armX, owner: A, heads: 1 },
        { arrow: armY, owner: A, heads: 1 },
      ],
      A,
      { trail: { A: [stem, armX, armY] }, territory: owned([home, landing], A) },
    );

    const after = table.rules.apply(state, step(armX, landing, 1));

    expect(territoryOf(after, stem)).toBe(A);
    expect(territoryOf(after, armX)).toBe(A);
    expect(territoryOf(after, armY)).toBeUndefined();
    expect(isTrail(after, A, armY)).toBe(true);
  });

  it('claims every upstream in-arrow at a merge', () => {
    // §6.1a: a point is all-to-all and the set holds no pairing to prefer one by
    // (§11 item 26), so the walk takes both — the reading evaporation takes too.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const first = arrowAt(run, 0);
    const onward = arrowAt(run, 1);
    const mergePoint = table.geometry.target(first);
    const second = pick(
      table.geometry.inArrows(mergePoint).filter((a) => a !== first),
      0,
    );
    const landing = anExitFrom(table.geometry, onward);
    const state = stateOf([{ arrow: onward, owner: A, heads: 1 }], A, {
      trail: { A: [first, second, onward] },
      territory: owned([home, landing], A),
    });

    const claim = table.rules.closureOf(state, step(onward, landing, 1), A);

    expect(claim?.path.map(String)).toContain(String(first));
    expect(claim?.path.map(String)).toContain(String(second));
  });

  it('claims a dead-end spur that feeds a point the walk transits', () => {
    // Upstream is upstream. Being a dead end does not exempt it — which is exactly
    // what makes §7's salvage of a cut fragment work.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const middle = arrowAt(run, 1);
    const last = arrowAt(run, 2);
    const spur = pick(
      table.geometry.inArrows(table.geometry.origin(last)).filter((a) => a !== middle),
      0,
    );
    const landing = anExitFrom(table.geometry, last);
    const state = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run, spur] },
      territory: owned([home, landing], A),
    });

    const claim = table.rules.closureOf(state, step(last, landing, 1), A);

    expect(claim?.path.map(String)).toContain(String(spur));
  });
});

// ── Rule: the path is claimed either way, and fill finds what it rings ────────

describe('the path is claimed either way, and fill finds what it rings', () => {
  it('claims a strip that rings nothing, and nothing besides', () => {
    // §7's land bridge, and §11 item 36's point that it needs no branch: the path is
    // claimed, and fill simply finds no pocket.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const state = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });

    const claim = table.rules.closureOf(state, step(last, landing, 1), A);

    expect(claim?.enclosed).toEqual([]);
    expect(claim?.path.length).toBe(run.length);
  });

  it('claims a fragment driven home even though its walk stops at a stack anchor', () => {
    // §7: a stack anchor pays the path. The walk stops at the arrow with no trail
    // predecessor, and a bare strip rings nothing.
    const table = onTiling();
    const { home } = aRunFromHome(table.geometry, 1);
    // A stretch that touches no territory of A's, then a fresh run to A's ground.
    const fragment = pathFrom(table.geometry, pick(exitsFrom(table.geometry, home), 1), 3);
    const tip = arrowAt(fragment, 2);
    const landing = anExitFrom(table.geometry, tip);
    const state = stateOf([{ arrow: tip, owner: A, heads: 2 }], A, {
      trail: { A: [...fragment] },
      territory: owned([landing], A),
    });

    const claim = table.rules.closureOf(state, step(tip, landing, 2), A);

    expect(claim?.path.map(String).toSorted()).toEqual(fragment.map(String).toSorted());
    expect(claim?.enclosed).toEqual([]);
  });

  it('claims the interior a loop rings', () => {
    // §11 item 36: the path becomes ground and fill finds the pocket.
    const table = onTiling();
    const ring = aRingWithAnInside(table.geometry);
    const tip = arrowAt(ring.wall, 5);
    const landing = anExitFrom(table.geometry, tip);
    const home = pick(
      table.geometry.inArrows(table.geometry.origin(arrowAt(ring.wall, 0))),
      0,
    );
    const state = stateOf([{ arrow: tip, owner: A, heads: 1 }], A, {
      trail: { A: [...ring.wall] },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(state, step(tip, landing, 1));

    expect(territoryOf(after, ring.inside)).toBe(A);
    for (const arrow of ring.wall) expect(territoryOf(after, arrow)).toBe(A);
  });
});

// ── Rule: a closure moves ground, whoever held it ─────────────────────────────

describe('a closure moves ground, whoever held it', () => {
  it('carves a chunk out of enemy territory', () => {
    const table = onTiling();
    const ring = aRingWithAnInside(table.geometry);
    const tip = arrowAt(ring.wall, 5);
    const landing = anExitFrom(table.geometry, tip);
    const home = pick(
      table.geometry.inArrows(table.geometry.origin(arrowAt(ring.wall, 0))),
      0,
    );
    const state = stateOf([{ arrow: tip, owner: A, heads: 1 }], A, {
      trail: { A: [...ring.wall] },
      territory: [...owned([home, landing], A), { arrow: ring.inside, owner: B }],
    });

    const after = table.rules.apply(state, step(tip, landing, 1));

    expect(territoryOf(after, ring.inside)).toBe(A);
  });

  it('strips an enemy trail from arrows the closure claims', () => {
    // P13: claimed tiles are no longer enemy trail paint — convert alone missed
    // bare trail without a stack on the tile.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const last = arrowAt(run, 1);
    const landing = anExitFrom(table.geometry, last);
    const state = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run], B: [arrowAt(run, 0)] },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(state, step(last, landing, 1));

    expect(territoryOf(after, arrowAt(run, 0))).toBe(A);
    expect(isTrail(after, B, arrowAt(run, 0))).toBe(false);
  });

  it('converts an enemy head standing on a claimed arrow', () => {
    // **P07.** §7 grants "everything standing on them — enemy heads, converted
    // (§6.3)". Claiming the tile converts when the stack has no territory-grade trail.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const state = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 2 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );

    const after = table.rules.apply(state, step(last, landing, 1));

    expect(territoryOf(after, occupied)).toBe(A);
    expect(after.groups.get(occupied)?.owner).toBe(A);
    expect(after.groups.get(occupied)?.heads).toBe(2);
    expect(after.groups.get(occupied)?.spent).toBe(speed(2));
  });
});

// ── Rule: claimed arrows leave the claiming player's trail ────────────────────

describe('claimed arrows leave the claiming player’s trail', () => {
  it('empties the trail of every arrow it claimed', () => {
    // trails' invariant: an arrow is never both a player's own territory and their own
    // trail. A closure is the first thing in the engine that removes trail.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const state = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(state, step(last, landing, 1));

    for (const arrow of run) expect(isTrail(after, A, arrow)).toBe(false);
    expect(trailOf(after, A)).toEqual([]);
  });

  it('leaves the arm it did not claim in the trail', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const stem = arrowAt(run, 0);
    const armX = arrowAt(run, 1);
    const armY = pick(
      table.geometry.outArrows(table.geometry.target(stem)).filter((a) => a !== armX),
      0,
    );
    const landing = anExitFrom(table.geometry, armX);
    const state = stateOf(
      [
        { arrow: armX, owner: A, heads: 1 },
        { arrow: armY, owner: A, heads: 1 },
      ],
      A,
      { trail: { A: [stem, armX, armY] }, territory: owned([home, landing], A) },
    );

    const after = table.rules.apply(state, step(armX, landing, 1));

    expect(trailOf(after, A)).toEqual([String(armY)]);
  });
});
