/**
 * docs/spec/trails/trails.core.feature — one test per scenario.
 *
 * States are hand-authored over a P02 fixture board, and **trail is authored
 * separately from occupancy**: P05 D2 says the arrow a head stands on is trail, but
 * that is a consequence of *stepping*, so a test must be able to say "a head here,
 * nothing marked" (every P04 scenario does) and "a marked stretch with no head on
 * it" (§6.1a's headless trail). Deriving either from the other makes both unsayable.
 *
 * No test names an arrow literally. Every relationship is asked of `GeometryPort`,
 * so the same scenarios run on `minimal`, on `spacious`, and on the tiling.
 *
 * @see docs/spec/trails/trails.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  aThreeCycle,
  anArrow,
  anExitFrom,
  arrowAt,
  headsOn,
  isTrail,
  onBoard,
  ownerOf,
  pathFrom,
  pick,
  slotsAt,
  stateOf,
  territoryOf,
  trailOf,
} from './support';

// ── Rule: a step marks its destination unless it is already your territory ────

describe('a step marks its destination unless that destination is your territory', () => {
  it('starts a trail when a head steps off its own territory', () => {
    // "Stepping off your own territory starts a trail". §5's safety rule: the
    // moment you step off, you are trailing and you are vulnerable.
    const table = onBoard();
    const t1 = anArrow(table.geometry);
    const n1 = anExitFrom(table.geometry, t1);
    const before = stateOf([{ arrow: t1, owner: A, heads: 1 }], A, {
      territory: [{ arrow: t1, owner: A }],
    });

    const after = table.rules.apply(before, step(t1, n1, 1));

    expect(trailOf(after, A)).toEqual([String(n1)]);
    expect(territoryOf(after, t1)).toBe(A);
    expect(isTrail(after, A, t1)).toBe(false);
  });

  it('extends the trail onto the next neutral arrow', () => {
    // "A trail extends onto the next neutral arrow". The arrow the head vacated
    // stays trail — a trail is where you have been, not where you are.
    const table = onBoard();
    const n1 = anArrow(table.geometry);
    const n2 = anExitFrom(table.geometry, n1);
    const before = stateOf([{ arrow: n1, owner: A, heads: 1 }], A, {
      trail: { A: [n1] },
    });

    const after = table.rules.apply(before, step(n1, n2, 1));

    expect(trailOf(after, A)).toEqual([String(n1), String(n2)].toSorted());
  });

  it('marks nothing when a head moves inside its own territory', () => {
    // "Moving inside your own territory marks nothing" — free, trail-less, safe
    // movement (§5). This is the clause every other rule in the packet leans on.
    const table = onBoard();
    const t1 = anArrow(table.geometry);
    const t2 = anExitFrom(table.geometry, t1);
    const before = stateOf([{ arrow: t1, owner: A, heads: 2 }], A, {
      territory: [
        { arrow: t1, owner: A },
        { arrow: t2, owner: A },
      ],
    });

    const after = table.rules.apply(before, step(t1, t2, 2));

    expect(trailOf(after, A)).toEqual([]);
    expect(headsOn(after, t2)).toBe(2);

    // Paired with its opposite, so this cannot pass merely because nothing marks
    // yet: the *same* departure onto ground that is not the mover's territory does.
    const neutral = anExitFrom(table.geometry, t1);
    const exposed = table.rules.apply(
      stateOf([{ arrow: t1, owner: A, heads: 2 }], A, { territory: [{ arrow: t1, owner: A }] }),
      step(t1, neutral, 2),
    );
    expect(trailOf(exposed, A)).toEqual([String(neutral)]);
  });

  it('marks trail when a head steps into enemy territory', () => {
    // "Stepping into enemy territory marks trail". §7 / P28: enterable from own
    // territory or a territory-grade trail, and exposing while you are on it.
    // Territory-grade lifeline so conversion does not strip the mark (P13).
    const table = onBoard();
    const n1 = anArrow(table.geometry);
    const e1 = anExitFrom(table.geometry, n1);
    const home = pick(table.geometry.inArrows(table.geometry.origin(n1)), 0);
    const before = stateOf([{ arrow: n1, owner: A, heads: 1 }], A, {
      trail: { A: [n1] },
      territory: [
        { arrow: e1, owner: B },
        { arrow: home, owner: A },
      ],
    });

    const after = table.rules.apply(before, step(n1, e1, 1));

    expect(isTrail(after, A, e1)).toBe(true);
    expect(territoryOf(after, e1)).toBe(B);
  });

  it('leaves the arrow a head stands on marked', () => {
    // "The arrow a head stands on is trail" (P05 D2). §6.1 halts a front when it
    // meets a head "on the arrow it is entering", and heads stand on trail.
    const table = onBoard();
    const t1 = anArrow(table.geometry);
    const n1 = anExitFrom(table.geometry, t1);
    const before = stateOf([{ arrow: t1, owner: A, heads: 1 }], A, {
      territory: [{ arrow: t1, owner: A }],
    });

    const after = table.rules.apply(before, step(t1, n1, 1));

    expect(headsOn(after, n1)).toBe(1);
    expect(ownerOf(after, n1)).toBe(A);
    expect(isTrail(after, A, n1)).toBe(true);
  });
});

// ── Rule: a trail is a set ───────────────────────────────────────────────────

describe('a trail is a set', () => {
  it('adds nothing when a head re-traverses an arrow it already holds', () => {
    // "Re-traversing an arrow you already hold adds nothing" — §6.1a invariant 2.
    // Legal, and it adds nothing, which is what makes fill read the same boundary
    // however many times a head walked it.
    const table = onBoard();
    // A genuine directed 3-cycle, so the head really loops back onto its own start
    // rather than merely stepping onto a marked arrow. Girth is 3 on every
    // conformant board (§2, §11 items 3 and 5), so one exists.
    const [n1, n2, n3] = aThreeCycle(table.geometry, MINIMAL_DIAMETER);
    const before = stateOf([{ arrow: n3, owner: A, heads: 1 }], A, {
      trail: { A: [n1, n2, n3] },
    });

    const after = table.rules.apply(before, step(n3, n1, 1));

    expect(trailOf(after, A)).toEqual([n1, n2, n3].map(String).toSorted());
    expect(headsOn(after, n1)).toBe(1);
  });

  it('does not treat a lagging group as re-tracing', () => {
    // "A lagging group standing on ground the front group laid is not re-tracing"
    // (§11 item 22). Invariant 2 constrains the arrow set, not where heads walk —
    // this is how a spearhead brings its firebreaks along.
    const table = onBoard();
    const path = pathFrom(table.geometry, anArrow(table.geometry), 3);
    const [n1, n2, n3] = [arrowAt(path, 0), arrowAt(path, 1), arrowAt(path, 2)];
    // Three heads, not two: the front group has to take *two* steps, and a lone
    // head has speed(1) = 1, so the front must leave as a pair (P04 §3).
    let state = stateOf([{ arrow: n1, owner: A, heads: 3 }], A, { trail: { A: [n1] } });

    state = table.rules.apply(state, step(n1, n2, 2));
    state = table.rules.apply(state, step(n2, n3, 2));
    state = table.rules.apply(state, step(n1, n2, 1));

    expect(trailOf(state, A)).toEqual([n1, n2, n3].map(String).toSorted());
    expect(headsOn(state, n2)).toBe(1);
    expect(headsOn(state, n3)).toBe(2);
  });

  it('records no order and no laying history', () => {
    // "Two different walks over the same arrows leave the same trail". A set is the
    // representation, so two walks that touched the same arrows are indistinguishable
    // — which is what removes head identity from the engine (§6.1a).
    const table = onBoard();
    const path = pathFrom(table.geometry, anArrow(table.geometry), 3);
    const arrows = [arrowAt(path, 0), arrowAt(path, 1), arrowAt(path, 2)];
    const forwards = stateOf([], A, { trail: { A: arrows } });
    const backwards = stateOf([], A, { trail: { A: [...arrows].reverse() } });

    expect(trailOf(forwards, A)).toEqual(trailOf(backwards, A));
  });
});

// ── Rule: branching is free (P22 — supersedes P13 branch toll) ───────────────

describe('branching is free — joins and splits cost nothing (P22)', () => {
  it('lets a join through when a head stays on the arrow it arrived by', () => {
    const table = onBoard();
    const { point, ins, outs } = slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));
    const already = pick(ins, 0);
    const arriving = pick(ins, 1);
    const away = pick(outs, 0);
    const before = stateOf([{ arrow: arriving, owner: A, heads: 2 }], A, {
      trail: { A: [already, arriving] },
    });

    const after = table.rules.apply(before, step(arriving, away, 1));

    expect(headsOn(after, arriving)).toBe(1);
    expect(headsOn(after, away)).toBe(1);
    expect(isTrail(after, A, away)).toBe(true);
    expect(String(point)).toBe(String(table.geometry.target(arriving)));
  });

  it('lets a join formed by the whole stack', () => {
    // P22: no branch toll — vacating the join strand is legal.
    const table = onBoard();
    const { ins, outs } = slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));
    const already = pick(ins, 0);
    const arriving = pick(ins, 1);
    const away = pick(outs, 0);
    const before = stateOf([{ arrow: arriving, owner: A, heads: 2 }], A, {
      trail: { A: [already, arriving] },
    });

    const after = table.rules.apply(before, step(arriving, away, 2));

    expect(headsOn(after, arriving)).toBe(0);
    expect(headsOn(after, away)).toBe(2);
    expect(isTrail(after, A, arriving)).toBe(true);
  });

  it('lets a split through without leaving a sentry', () => {
    const table = onBoard();
    const { ins, outs } = slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));
    const arriving = pick(ins, 0);
    const firstArm = pick(outs, 0);
    const secondArm = pick(outs, 1);
    const before = stateOf([{ arrow: arriving, owner: A, heads: 1 }], A, {
      trail: { A: [arriving, firstArm] },
    });

    const after = table.rules.apply(before, step(arriving, secondArm, 1));

    expect(headsOn(after, secondArm)).toBe(1);
    expect(isTrail(after, A, secondArm)).toBe(true);
    expect(isTrail(after, A, firstArm)).toBe(true);
  });

  it('lets a whole stack cross a crossover', () => {
    // P22: crossover is free — no join/split toll.
    const table = onBoard();
    const { ins, outs } = slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));
    const arriving = pick(ins, 1);
    const away = pick(outs, 1);
    const before = stateOf([{ arrow: arriving, owner: A, heads: 2 }], A, {
      trail: { A: [pick(ins, 0), pick(outs, 0), arriving] },
    });

    const after = table.rules.apply(before, step(arriving, away, 2));

    expect(headsOn(after, arriving)).toBe(0);
    expect(headsOn(after, away)).toBe(2);
    expect(isTrail(after, A, arriving)).toBe(true);
  });

  it('lets a lone head form a join', () => {
    // P22: a lone head may branch.
    const table = onBoard();
    const { ins, outs } = slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));
    const arriving = pick(ins, 1);
    const away = pick(outs, 0);
    const before = stateOf([{ arrow: arriving, owner: A, heads: 1 }], A, {
      trail: { A: [pick(ins, 0), arriving] },
    });

    const after = table.rules.apply(before, step(arriving, away, 1));

    expect(headsOn(after, arriving)).toBe(0);
    expect(headsOn(after, away)).toBe(1);
    expect(isTrail(after, A, arriving)).toBe(true);
  });
});

// ── Rule: territory grade, stack grade, dormant ──────────────────────────────

describe('a trail is held live by territory, or by a stack, or by nothing', () => {
  it('reports territory grade for a trail reaching its own closed ground', () => {
    // "A trail reaching your own territory is territory grade" (§6.1). Fully live:
    // it can close and claim, and heads on it are not encircled.
    const table = onBoard();
    const t1 = anArrow(table.geometry);
    const path = pathFrom(table.geometry, anExitFrom(table.geometry, t1), 3);
    const stretch = [arrowAt(path, 0), arrowAt(path, 1), arrowAt(path, 2)];
    const state = stateOf([], A, {
      trail: { A: stretch },
      territory: [{ arrow: t1, owner: A }],
    });

    expect(table.rules.anchorGrade(state, arrowAt(path, 2), A)).toBe('territory');
  });

  it('reports stack grade for a trail reaching only its own stack', () => {
    // "A trail reaching only your own stack is stack grade" (§6.1): a fragment that
    // survived a cut is anchored on its own stack — live, not dormant, and worth a
    // land bridge if it can be driven home.
    const table = onBoard();
    const path = pathFrom(table.geometry, anArrow(table.geometry), 3);
    const state = stateOf([{ arrow: arrowAt(path, 1), owner: A, heads: 2 }], A, {
      trail: { A: [arrowAt(path, 0), arrowAt(path, 1), arrowAt(path, 2)] },
    });

    expect(table.rules.anchorGrade(state, arrowAt(path, 2), A)).toBe('stack');
  });

  it('reports dormant for headless trail touching nothing', () => {
    // "A trail reaching neither is dormant" (§6.1a): headless trail is ordinary — a
    // wall that claims nothing, charges nothing, and can be walked onto again.
    const table = onBoard();
    const path = pathFrom(table.geometry, anArrow(table.geometry), 3);
    const state = stateOf([], A, {
      trail: { A: [arrowAt(path, 0), arrowAt(path, 1), arrowAt(path, 2)] },
    });

    expect(table.rules.anchorGrade(state, arrowAt(path, 2), A)).toBe('dormant');
  });

  it('computes grade without regard to the grain', () => {
    // "Grade ignores the grain". §7's pincer: enclosure is a property of the curve,
    // not of the flow along it — and §6.1 re-attaches a fragment by laying a path
    // *to* it, against the direction it was laid.
    const table = onBoard();
    const t1 = anArrow(table.geometry);
    const path = pathFrom(table.geometry, anExitFrom(table.geometry, t1), 3);
    const state = stateOf([], A, {
      trail: { A: [arrowAt(path, 0), arrowAt(path, 1), arrowAt(path, 2)] },
      territory: [{ arrow: t1, owner: A }],
    });

    expect(table.rules.anchorGrade(state, arrowAt(path, 0), A)).toBe('territory');
    expect(table.rules.anchorGrade(state, arrowAt(path, 2), A)).toBe('territory');
  });
});

// ── Rule: trail and territory outlive the turn ───────────────────────────────

describe('trail and territory outlive the turn', () => {
  it('clears spent on end-turn without clearing the board’s memory', () => {
    // "End-turn clears spent, not the board's memory". P04 zeroes spent and drops
    // merge overrides at the boundary; trail and territory are state, not per-turn
    // accounting.
    const table = onBoard();
    const path = pathFrom(table.geometry, anArrow(table.geometry), 2);
    const t1 = arrowAt(path, 0);
    const n1 = arrowAt(path, 1);
    const before = stateOf([{ arrow: n1, owner: A, heads: 2, spent: 1 }], A, {
      trail: { A: [n1] },
      territory: [{ arrow: t1, owner: A }],
    });

    const after = table.rules.apply(before, endTurn());

    expect(trailOf(after, A)).toEqual([String(n1)]);
    expect(territoryOf(after, t1)).toBe(A);
    for (const group of after.groups.values()) expect(group.spent).toBe(0);
  });

  it('leaves trail untouched when nothing steps', () => {
    // Trail is marked by a step and by nothing else. Standing still is the absence
    // of a move (P51), so a turn nobody stepped in marks no arrow.
    const table = onBoard();
    const n1 = anArrow(table.geometry);
    const before = stateOf([{ arrow: n1, owner: A, heads: 1 }], A, { trail: { A: [n1] } });

    const after = table.rules.apply(before, endTurn());

    expect(trailOf(after, A)).toEqual([String(n1)]);
  });
});
