/**
 * docs/spec/crossings/crossings.core.feature — one test per scenario.
 *
 * The subtlest logic in the game, and the one place a wrong-but-plausible
 * implementation passes a casual reading. Two traps, both tested here directly:
 *
 * 1. **A point presents `i × o` chords, not one.** An engine that tests only the
 *    first passes every spine and quietly fails every knot.
 * 2. **Two predicates.** `chordsCross` (interleave or coincide) for an enemy trail,
 *    `chordsInterleave` for your own — differing exactly by coincidence, because
 *    coincidence cannot invert a lobe §7 has not enclosed yet.
 *
 * Every chord endpoint is asked of `slotOf`, never inferred from an arrow id. An
 * engine that parsed an id would pass on the tiling and fail on a fixture.
 *
 * @see docs/spec/crossings/crossings.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  anArrow,
  anInterleaving,
  chordKeys,
  chordOf,
  exitsByCrossing,
  onBoard,
  pick,
  slotsAt,
  stateOf,
  via,
} from './support';
import type { ArrowId, PointId } from './support';

/** A point of the board, with its ins and outs, to build a trail shape at. */
const junction = (
  table: ReturnType<typeof onBoard>,
): { point: PointId; ins: readonly ArrowId[]; outs: readonly ArrowId[] } =>
  slotsAt(table.geometry, table.geometry.target(anArrow(table.geometry)));

// ── Rule: a player's trail presents i × o chords at a point ──────────────────

describe('a player’s trail presents i × o chords at a point', () => {
  const shapes = [
    { shape: 'spine', i: 1, o: 1, chords: 1 },
    { shape: 'join', i: 2, o: 1, chords: 2 },
    { shape: 'split', i: 1, o: 2, chords: 2 },
    { shape: 'crossover', i: 2, o: 2, chords: 4 },
    { shape: 'triple crossover', i: 3, o: 3, chords: 9 },
  ] as const;

  it.each(shapes)('gives a $shape $chords chords', ({ i, o, chords }) => {
    // §6.1a: where a trail uses i in-arrows and o out-arrows at a point, that point
    // is a join followed by a split and every in feeds every out. The count is the
    // product, not the maximum.
    const table = onBoard();
    const { point, ins, outs } = junction(table);
    const marked = [...ins.slice(0, i), ...outs.slice(0, o)];
    const state = stateOf([], A, { trail: { A: marked } });

    const found = table.rules.trailChordsAt(state, point, A);

    expect(found.length).toBe(chords);
    expect(new Set(chordKeys(found)).size).toBe(chords);
  });

  it('pairs every in-arrow with every out-arrow exactly once', () => {
    // No pairing is recovered because the set holds none (§11 item 26): a walk that
    // went a→a, b→b and one that went a→b, b→a leave the identical arrow set.
    const table = onBoard();
    const { point, ins, outs } = junction(table);
    const state = stateOf([], A, { trail: { A: [...ins.slice(0, 2), ...outs.slice(0, 2)] } });

    const found = table.rules.trailChordsAt(state, point, A);

    const expected = ins
      .slice(0, 2)
      .flatMap((into) => outs.slice(0, 2).map((out) => chordOf(table.geometry, via(into, out))));
    expect(chordKeys(found)).toEqual(chordKeys(expected));
  });

  it('presents no chord where the trail only arrives', () => {
    // The tip of a trail. It owns the arrow it stands on, but it has not transited
    // the point ahead of it, so there is nothing to cross yet.
    const table = onBoard();
    const { point, ins } = junction(table);
    const state = stateOf([], A, { trail: { A: [pick(ins, 0)] } });

    expect(table.rules.trailChordsAt(state, point, A)).toEqual([]);
  });

  it('reads every chord endpoint through slotOf', () => {
    // The port exposes slotOf rather than an opaque verdict precisely so this is
    // checkable — and a chord is normalized, so a faithful comparison is possible.
    const table = onBoard();
    const { point, ins, outs } = junction(table);
    const into = pick(ins, 0);
    const out = pick(outs, 0);
    const state = stateOf([], A, { trail: { A: [into, out] } });

    const found = table.rules.trailChordsAt(state, point, A);

    expect(chordKeys(found)).toEqual(chordKeys([chordOf(table.geometry, via(into, out))]));
  });
});

// ── Rule: a traversal crosses an enemy trail on interleave or coincidence ────

describe('a traversal crosses an enemy trail on interleave or on coincidence', () => {
  it('reports a crossing when the traversal threads between two enemy arrows', () => {
    // Interleave: A's pair separates B's around the circle of six slots. Which
    // (in, out) pairs interleave depends on the point's rotation system, which is
    // authored and free (§11 item 29) — so the configuration is searched for
    // rather than assumed.
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const state = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [trailIn, trailOut] },
    });

    expect(table.rules.crossesTrail(state, via(ourIn, ourExit), B)).toBe(true);
  });

  it('reports a crossing when the traversal lands on one of the enemy’s own arrows', () => {
    // Coincidence. This is what subsumes the tile rule for free (§2): an enemy
    // cannot stand on your trail arrow without entering through its tail point,
    // which your trail also uses.
    const table = onBoard();
    const { ins, outs } = junction(table);
    const theirIn = pick(ins, 0);
    const theirOut = pick(outs, 0);
    const ourIn = pick(ins, 1);
    const state = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [theirIn, theirOut] },
    });

    expect(table.rules.crossesTrail(state, via(ourIn, theirOut), B)).toBe(true);
  });

  it('reports a crossing when landing on a trail stub with no in-arrow at the point', () => {
    // SPEC §2: coincide means the exit *is* a trail arrow. A dormant fragment's
    // tail presents no chord (`i = 0`); landing on that out is still a crossing.
    const table = onBoard();
    const { ins, outs } = junction(table);
    const theirOut = pick(outs, 0);
    const aside = pick(outs, 1);
    const ourIn = pick(ins, 0);
    const state = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [theirOut] },
    });

    expect(table.rules.crossesTrail(state, via(ourIn, theirOut), B)).toBe(true);
    expect(table.rules.crossesTrail(state, via(ourIn, aside), B)).toBe(false);
  });

  it('reports no crossing when the traversal turns aside', () => {
    // §2: a chord that stays on one side — turning aside rather than through — is
    // not a crossing. This is what makes shadowing possible at all.
    const table = onBoard();
    const { point, ins, outs } = junction(table);
    const theirIn = pick(ins, 0);
    const theirOut = pick(outs, 0);
    const ourIn = pick(ins, 1);
    const state = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [theirIn, theirOut] },
    });
    const theirs = chordOf(table.geometry, via(theirIn, theirOut));
    const { aside } = exitsByCrossing(table.geometry, point, ourIn, theirs);
    if (aside.length === 0) throw new Error('setup: this point offers no aside exit');

    for (const exit of aside) {
      expect(table.rules.crossesTrail(state, via(ourIn, exit), B)).toBe(false);
    }
  });

  it('tests the traversal against every chord the trail presents', () => {
    // One chord is enough. An implementation that tested only the first would pass a
    // spine and quietly fail a knot — which is the failure this whole file exists
    // to catch.
    const table = onBoard();
    const { point, ins, outs } = junction(table);
    const theirs = [pick(ins, 0), pick(ins, 1), pick(outs, 0), pick(outs, 1)];
    const ourIn = pick(ins, 2);
    const state = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: theirs },
    });

    const crossed = table.geometry
      .outArrows(point)
      .filter((exit) => table.rules.crossesTrail(state, via(ourIn, exit), B));

    expect(crossed.length).toBeGreaterThan(0);
  });
});

// ── Rule: against your own trail, only an interleave counts ──────────────────

describe('against your own trail, only an interleave counts', () => {
  it('does not self-cross when re-traversing your own arrow', () => {
    // Coincidence cannot invert anything: the arrow is already in the set, so
    // re-traversing leaves the set unchanged (§6.1a) and §7's even-odd has nothing
    // to flip.
    const table = onBoard();
    const { ins, outs } = junction(table);
    const ourIn = pick(ins, 0);
    const ourOut = pick(outs, 0);
    const state = stateOf([{ arrow: pick(ins, 1), owner: A, heads: 1 }], A, {
      trail: { A: [ourIn, ourOut, pick(ins, 1)] },
    });

    expect(table.rules.selfCrosses(state, via(pick(ins, 1), ourOut), A)).toBe(false);
  });

  it('self-crosses when looping back through its own point', () => {
    // §7: crossing your own trail flips which lobes count as enclosed when the path
    // eventually lands. *What* it flips is P05b's; *that* it happened is here.
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const state = stateOf([{ arrow: ourIn, owner: A, heads: 2 }], A, {
      trail: { A: [trailIn, trailOut, ourIn] },
    });

    expect(table.rules.selfCrosses(state, via(ourIn, ourExit), A)).toBe(true);
  });

  it('can cross an enemy and not self-cross on the same traversal', () => {
    // The predicate is shared and the question is not: §6.1 takes the full verdict,
    // §7 takes the interleave half alone.
    const table = onBoard();
    const { point, ins, outs } = junction(table);
    const ourIn = pick(ins, 0);
    const ourOut = pick(outs, 0);
    const theirIn = pick(ins, 1);
    const state = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn, ourOut], B: [theirIn, pick(outs, 1)] },
    });
    // Departing onto our own out-arrow: coincidence with ours, and whatever it is
    // against theirs. Only the pair where it interleaves with theirs is the case.
    const theirs = chordOf(table.geometry, via(theirIn, pick(outs, 1)));
    const ourChord = chordOf(table.geometry, via(ourIn, ourOut));
    const crossesThem = exitsByCrossing(table.geometry, point, ourIn, theirs).interleaving;

    expect(table.rules.selfCrosses(state, via(ourIn, ourOut), A)).toBe(false);
    if (crossesThem.includes(ourOut)) {
      expect(table.rules.crossesTrail(state, via(ourIn, ourOut), B)).toBe(true);
    }
    expect(chordKeys([ourChord]).length).toBe(1);
  });
});

// ── Rule: crossing is a decision, not a tripwire ─────────────────────────────

describe('crossing is a decision, not a tripwire', () => {
  it('reports nothing for a head merely standing at a trail point', () => {
    // No step is ever compelled (§6.2), which is what makes declining always legal
    // — and what makes shadowing, holding a point and racing in parallel possible
    // at all. Standing still crosses nothing.
    const table = onBoard();
    const { ins, outs } = junction(table);
    const ourIn = pick(ins, 1);
    const before = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [pick(ins, 0), pick(outs, 0)] },
    });

    const after = table.rules.apply(before, endTurn());

    expect(after.groups.get(ourIn)?.heads).toBe(1);
    expect(table.rules.trailChordsAt(after, table.geometry.target(ourIn), B).length).toBe(1);
  });

  it('never crosses while shadowing an enemy trail point after point', () => {
    // A head can travel beside an enemy trail indefinitely, choosing its moment. At
    // each point the aside exits are the ones that decline, and there is always one.
    const table = onBoard();
    const { point, ins, outs } = junction(table);
    const theirs = chordOf(table.geometry, via(pick(ins, 0), pick(outs, 0)));
    const ourIn = pick(ins, 1);
    const state = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [pick(ins, 0), pick(outs, 0)] },
    });
    const { aside } = exitsByCrossing(table.geometry, point, ourIn, theirs);

    expect(aside.length).toBeGreaterThan(0);
    for (const exit of aside) {
      expect(table.rules.crossesTrail(state, via(ourIn, exit), B)).toBe(false);
    }
  });

  it('reports a crossing only at the point where one of them turns', () => {
    // Two trails race through one corridor, mutually aware and mutually
    // unobligated — until one of them turns (§2).
    //
    // The trail's chord is searched for rather than picked, for the same reason the
    // edge cases search for one: a chord on two **adjacent** slots interleaves with
    // nothing, because no slot lies strictly between its ends. So `(ins[0],
    // outs[0])` offers no exit that threads it and the turning half of this
    // scenario would have nothing to assert against.
    const table = onBoard();
    const { point, trailIn, trailOut, ourIn } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const state = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [trailIn, trailOut] },
    });
    const theirs = chordOf(table.geometry, via(trailIn, trailOut));
    const { aside, interleaving } = exitsByCrossing(table.geometry, point, ourIn, theirs);

    expect(table.rules.crossesTrail(state, via(ourIn, pick(aside, 0)), B)).toBe(false);
    expect(table.rules.crossesTrail(state, via(ourIn, pick(interleaving, 0)), B)).toBe(true);
  });
});
