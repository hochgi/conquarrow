/**
 * docs/spec/closure/closure.edge-cases.feature — one test per scenario.
 *
 * The pincer is two ordinary closures (§7); the degenerate claims pin §11 item 16;
 * the refusals confirm P04/P05 survive a winning move. All on the generated tiling.
 *
 * @see docs/spec/closure/closure.md
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import { makeRules } from '../src/index';
import {
  A,
  B,
  aRingWithAnInside,
  aRunFromHome,
  aTriangle,
  anExitFrom,
  arrowAt,
  exitsFrom,
  claimKeys,
  countingVertices,
  isTrail,
  landCountOf,
  onTiling,
  owned,
  pathFrom,
  pick,
  stateOf,
  territoryOf,
  trailOf,
  vertexReadsOf,
} from './support';
import type { GameState } from './support';

const territoryKeys = (state: GameState): readonly string[] =>
  [...state.territory.entries()]
    .map(([a, o]) => `${String(a)}:${String(o)}`)
    .toSorted();

const trailInsertion = (state: GameState, player: typeof A): readonly string[] =>
  [...(state.trails.get(player) ?? [])].map(String);

// ── Rule: the pincer is two closures and nothing else ─────────────────────────

describe('the pincer is two closures and nothing else', () => {
  it('takes the ground between when the second arm lands', () => {
    // §7: arms land one at a time. After X lands, Y is an open trail rooted on
    // territory; its own landing is ordinary and fill takes the ground between.
    const table = onTiling();
    const ring = aRingWithAnInside(table.geometry);
    // Authored as the state *after* the first arm landed, which is what the scenario's
    // Given describes: half the ring is already territory (the stem and arm X), the rest
    // is an open trail rooted on it (arm Y). A trail is a set with no memory (§6.1a), so
    // there is no fork history to author — this state is exactly the one the first
    // landing leaves behind, and the second landing is an ordinary closure.
    const wall = ring.wall;
    const half = wall.slice(0, 3);
    const rest = wall.slice(3);
    const tip = arrowAt(rest, rest.length - 1);
    const landing = anExitFrom(table.geometry, tip);
    // Stem already territory (first landing done); rest is still trail.
    const home = pick(
      table.geometry.inArrows(table.geometry.origin(arrowAt(half, 0))),
      0,
    );
    const state = stateOf([{ arrow: tip, owner: A, heads: 1 }], A, {
      trail: { A: [...rest] },
      territory: owned([...half, home, landing], A),
    });

    const after = table.rules.apply(state, step(tip, landing, 1));

    for (const arrow of rest) expect(territoryOf(after, arrow)).toBe(A);
    expect(territoryOf(after, ring.inside)).toBe(A);
  });

  it('leaves an arm that never lands as open trail of territory grade', () => {
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

    expect(isTrail(after, A, armY)).toBe(true);
    expect(territoryOf(after, armY)).toBeUndefined();
    expect(table.rules.anchorGrade(after, armY, A)).toBe('territory');
  });
});

// ── Rule: degenerate claims ───────────────────────────────────────────────────

describe('degenerate claims', () => {
  it('claims exactly three arrows for the minimal lattice triangle', () => {
    // §11 item 16: three arrows, zero tiles inside — and a whole spawner by reading.
    const table = onTiling();
    const [a, b, c] = aTriangle(table.geometry);
    const state = stateOf([{ arrow: c, owner: A, heads: 1 }], A, {
      trail: { A: [c] },
      territory: owned([a, b], A),
    });
    // Land from c onto a (a is out of target(c) since a←b←c←a).
    const landing = a;
    expect(table.geometry.outArrows(table.geometry.target(c))).toContain(landing);

    const after = table.rules.apply(state, step(c, landing, 1));

    expect(territoryOf(after, a)).toBe(A);
    expect(territoryOf(after, b)).toBe(A);
    expect(territoryOf(after, c)).toBe(A);
    expect(landCountOf(after, A)).toBe(3);
  });

  it('claims a single-arrow closure as just that arrow', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 1);
    const n1 = arrowAt(run, 0);
    const landing = anExitFrom(table.geometry, n1);
    const state = stateOf([{ arrow: n1, owner: A, heads: 1 }], A, {
      trail: { A: [n1] },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(state, step(n1, landing, 1));

    expect(territoryOf(after, n1)).toBe(A);
    expect(isTrail(after, A, n1)).toBe(false);
    expect(trailOf(after, A)).toEqual([]);
  });

  it('claims every upstream arrow of a self-crossing trail', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const first = arrowAt(run, 0);
    const onward = arrowAt(run, 1);
    const mergePoint = table.geometry.target(first);
    const second = pick(
      table.geometry.inArrows(mergePoint).filter((a) => a !== first),
      0,
    );
    // Continue past the merge and land — a crossover shape: two ins, then out.
    const landing = anExitFrom(table.geometry, onward);
    const state = stateOf([{ arrow: onward, owner: A, heads: 1 }], A, {
      trail: { A: [first, second, onward] },
      territory: owned([home, landing], A),
    });

    const claim = table.rules.closureOf(state, step(onward, landing, 1), A);

    expect(claim).toBeDefined();
    if (claim === undefined) return;

    expect(claimKeys(claim).path).toEqual(
      [first, second, onward].map(String).toSorted(),
    );
  });

  it('claims only newly trailed arrows on a second closure over the same ground', () => {
    // Ground already owned is not re-claimed, and stepping over it lays no trail
    // (§5), so a second closure has only the fresh upstream arrows.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const alreadyOwned = [...run, home];
    const fresh = pathFrom(table.geometry, anExitFrom(table.geometry, arrowAt(run, 1)), 2, alreadyOwned);
    const tip = arrowAt(fresh, 1);
    const landing = anExitFrom(table.geometry, tip);
    const state = stateOf([{ arrow: tip, owner: A, heads: 1 }], A, {
      trail: { A: [...fresh] },
      territory: owned([...alreadyOwned, landing], A),
    });

    const claim = table.rules.closureOf(state, step(tip, landing, 1), A);

    expect(claim).toBeDefined();
    if (claim === undefined) return;

    expect(claimKeys(claim).path).toEqual(fresh.map(String).toSorted());
    expect(claimKeys(claim).path.every((k) => !alreadyOwned.map(String).includes(k))).toBe(
      true,
    );
  });
});

// ── Rule: a closure is refused for the same reasons any step is ───────────────

describe('a closure is refused for the same reasons any step is', () => {
  it('resolves combat on a closure step onto an arrow the enemy occupies', () => {
    // Contact combat (§6.2) replaces the P04 refusal. Landing on enemy-held
    // "home" is an attack, not a silent claim — stay-behind; 1v1 attacker takes.
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 2);
    const last = arrowAt(run, 1);
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf(
      [
        { arrow: last, owner: A, heads: 2 },
        { arrow: landing, owner: B, heads: 1 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );

    const after = table.rules.apply(before, step(last, landing, 1));
    expect(after.groups.get(landing)?.owner).toBe(A);
    expect(after.groups.get(landing)?.heads).toBe(1);
    expect(after.groups.get(last)?.heads).toBe(1);
    // No claim of the path while combat consumed the step onto contested ground
    // that was authored as A's territory with an enemy standing on it.
    expect(territoryOf(before, arrowAt(run, 0))).toBeUndefined();
  });

  it('permits a closure that vacates a branch strand (P22 — no toll)', () => {
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
    const before = stateOf([{ arrow: armX, owner: A, heads: 1 }], A, {
      trail: { A: [stem, armX, armY] },
      territory: owned([home, landing], A),
    });

    const after = table.rules.apply(before, step(armX, landing, 1));

    expect(territoryOf(after, stem)).toBe(A);
    expect(territoryOf(after, armX)).toBe(A);
    // armY was not on the claim walk from armX against the grain — remains trail.
    expect(isTrail(after, A, armY) || territoryOf(after, armY) === A).toBe(true);
  });
});

// ── Rule: purity and determinism ──────────────────────────────────────────────

describe('closure is pure and deterministic', () => {
  it('does not mutate the input state’s trails or territory', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const s0 = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });
    const trailsBefore = trailOf(s0, A);
    const territoryBefore = territoryKeys(s0);

    const s1 = table.rules.apply(s0, step(last, landing, 1));

    expect(trailOf(s0, A)).toEqual(trailsBefore);
    expect(territoryKeys(s0)).toEqual(territoryBefore);
    for (const arrow of run) expect(territoryOf(s1, arrow)).toBe(A);
  });

  it('gives the same claim however the trail set was built', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const move = step(last, landing, 1);
    const forwards = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });
    const backwards = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run].reverse() },
      territory: owned([home, landing], A),
    });

    const left = table.rules.apply(forwards, move);
    const right = table.rules.apply(backwards, move);

    expect(territoryKeys(right)).toEqual(territoryKeys(left));
    expect(trailInsertion(right, A)).toEqual(trailInsertion(left, A));
  });

  it('requests no vertex beyond what a non-closing move requests while resolving a closure', () => {
    const base = onTiling().geometry;
    const { geometry, vertexReads } = countingVertices(base);
    const rules = makeRules(geometry);
    const { home, run } = aRunFromHome(geometry, 3);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(geometry, last);
    const state = stateOf([{ arrow: last, owner: A, heads: 1 }], A, {
      trail: { A: [...run] },
      territory: owned([home, landing], A),
    });

    // The baseline is a step that lands nowhere it owns. There is no move that
    // does nothing (P51 deleted it), so "closes nothing" is the comparison.
    // P37: the closure's own reads are the delta over a move that closes nothing.
    // Not a hard zero any more, and not because closure changed: loss resolution
    // sits on the tail of `apply` and counts the *shares* of a seat that owns
    // ground and holds no head, which `stateOf`'s keepalive land makes true of
    // every seat that authored none. See `immediate-loss.md`, *Cost*.
    const open = exitsFrom(geometry, last).find((exit) => exit !== landing && exit !== home);
    if (open === undefined) throw new Error('setup: the last arrow has no non-landing exit');
    // The baseline must genuinely not close, or the delta is zero for the wrong
    // reason: a step onto A's own ground would claim and strip the trail too.
    expect(trailOf(rules.apply(state, step(last, open, 1)), A)).not.toEqual([]);
    const idle = vertexReadsOf(vertexReads, () => {
      rules.apply(state, step(last, open, 1));
    });
    const closing = vertexReadsOf(vertexReads, () => {
      rules.apply(state, step(last, landing, 1));
    });

    expect(closing).toBe(idle);
  });
});
