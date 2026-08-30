/**
 * The EARS invariants of docs/spec/closure/closure.md, as properties.
 *
 * Enumerated deterministically on the generated tiling — fill needs a plane, so
 * these cannot run on a fixture (§11 items 4, 30, 36).
 *
 * @see docs/spec/closure/closure.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import { makeRules } from '../src/index';
import {
  A,
  B,
  aRingWithAnInside,
  aRunFromHome,
  anExitFrom,
  arrowAt,
  claimKeys,
  exitsFrom,
  countingVertices,
  isTrail,
  onTiling,
  owned,
  pick,
  stateOf,
  territoryOf,
  trailOf,
  vertexReadsOf,
} from './support';

describe('a step onto own territory while trailing is a closure', () => {
  it('claims the backward-reachable trail and nothing downstream', () => {
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

    const claim = table.rules.closureOf(state, step(armX, landing, 1), A);

    expect(claim).toBeDefined();
    if (claim === undefined) return;

    expect(claimKeys(claim).path).toEqual([stem, armX].map(String).toSorted());
    expect(claimKeys(claim).path).not.toContain(String(armY));
  });

  it('claims nothing when the departed arrow is not trail — the opposite of a closure', () => {
    // Pairs the negative core scenario with its positive neighbour.
    const table = onTiling();
    const { home } = aRunFromHome(table.geometry, 1);
    const t2 = anExitFrom(table.geometry, home);
    const state = stateOf([{ arrow: home, owner: A, heads: 1 }], A, {
      territory: owned([home, t2], A),
    });

    expect(table.rules.closureOf(state, step(home, t2, 1), A)).toBeUndefined();
  });

  it('is not a closure when the destination is enemy territory — the opposite of landing home', () => {
    const table = onTiling();
    const { run } = aRunFromHome(table.geometry, 2);
    const last = arrowAt(run, 1);
    const enemy = anExitFrom(table.geometry, last);
    const state = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([enemy], B),
    });

    expect(table.rules.closureOf(state, step(last, enemy, 1), A)).toBeUndefined();
  });
});

describe('the backward walk takes every merge in-arrow and stops at its root', () => {
  it('claims every trail in-arrow at a merge', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const first = arrowAt(run, 0);
    const onward = arrowAt(run, 1);
    const second = pick(
      table.geometry.inArrows(table.geometry.target(first)).filter((a) => a !== first),
      0,
    );
    const landing = anExitFrom(table.geometry, onward);
    const state = stateOf([{ arrow: onward, owner: A, heads: 1 }], A, {
      trail: { A: [first, second, onward] },
      territory: owned([home, landing], A),
    });

    const claim = table.rules.closureOf(state, step(onward, landing, 1), A);

    expect(claim).toBeDefined();
    if (claim === undefined) return;

    expect(claimKeys(claim).path).toContain(String(first));
    expect(claimKeys(claim).path).toContain(String(second));
  });

  it('stops at a stack anchor and still claims the walked path', () => {
    const table = onTiling();
    const { run } = aRunFromHome(table.geometry, 3);
    const tip = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, tip);
    const state = stateOf([{ arrow: tip, owner: A, heads: 2 }], A, {
      trail: { A: [...run] },
      territory: owned([landing], A),
    });

    const claim = table.rules.closureOf(state, step(tip, landing, 2), A);

    expect(claim).toBeDefined();
    if (claim === undefined) return;
    expect(claimKeys(claim).path).toEqual(run.map(String).toSorted());
  });
});

describe('commit writes territory and strips every trail on claimed arrows', () => {
  it('removes claimed arrows from the mover’s and the enemy’s trails', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const last = arrowAt(run, 1);
    const landing = anExitFrom(table.geometry, last);
    const state = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run], B: [arrowAt(run, 0)] },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(state, step(last, landing, 1));

    expect(trailOf(after, A)).toEqual([]);
    expect(isTrail(after, B, arrowAt(run, 0))).toBe(false);
  });

  it('overwrites whoever held a claimed arrow and converts unprotected heads', () => {
    const table = onTiling();
    const ring = aRingWithAnInside(table.geometry);
    const tip = arrowAt(ring.wall, 5);
    const landing = anExitFrom(table.geometry, tip);
    const occupied = ring.inside;
    const home = pick(
      table.geometry.inArrows(table.geometry.origin(arrowAt(ring.wall, 0))),
      0,
    );
    const state = stateOf(
      [
        { arrow: tip, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 2 },
      ],
      A,
      {
        trail: { A: [...ring.wall] },
        territory: owned([home, landing], A).concat(
          [{ arrow: occupied, owner: B }],
        ),
      },
    );

    const after = table.rules.apply(state, step(tip, landing, 1));

    expect(territoryOf(after, occupied)).toBe(A);
    expect(after.groups.get(occupied)?.owner).toBe(A);
    expect(after.groups.get(occupied)?.heads).toBe(2);
  });

  it('requests no vertex beyond what a non-closing move requests, and does not mutate its input', () => {
    const base = onTiling().geometry;
    const { geometry, vertexReads } = countingVertices(base);
    const rules = makeRules(geometry);
    const { home, run } = aRunFromHome(geometry, 2);
    const last = arrowAt(run, 1);
    const landing = anExitFrom(geometry, last);
    const s0 = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });
    const before = trailOf(s0, A);

    // No move does nothing (P51), so the baseline is a step that lands nowhere
    // this seat owns — the same work minus the closure.
    const open = exitsFrom(geometry, last).find((exit) => exit !== landing && exit !== home);
    if (open === undefined) throw new Error('setup: the last arrow has no non-landing exit');
    // The baseline must genuinely not close, or the delta is zero for the wrong
    // reason: a step onto A's own ground would claim and strip the trail too.
    expect(trailOf(rules.apply(s0, step(last, open, 1)), A)).not.toEqual([]);
    const idle = vertexReadsOf(vertexReads, () => {
      rules.apply(s0, step(last, open, 1));
    });
    let s1 = s0;
    const closing = vertexReadsOf(vertexReads, () => {
      s1 = rules.apply(s0, step(last, landing, 1));
    });

    expect(trailOf(s0, A)).toEqual(before);
    expect(trailOf(s1, A)).toEqual([]);
    // P37: the closure adds no lattice read of its own over a non-closing move on the same
    // board. Not a hard zero any more, and not because the rule changed: loss
    // resolution sits on the tail of `apply` and counts the *shares* of a seat that
    // owns ground and holds no head, which `stateOf`'s keepalive land makes true of
    // every seat that authored none. See `immediate-loss.md`, *Cost*.
    expect(closing).toBe(idle);
  });
});
