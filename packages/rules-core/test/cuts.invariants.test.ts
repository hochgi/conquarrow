/**
 * The EARS invariants of docs/spec/cuts/cuts.md, as properties.
 *
 * Enumerated deterministically over fixture boards — no generator, no seed.
 *
 * @see docs/spec/cuts/cuts.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { makeRules } from '../src/index';
import { endTurn, rational, skip, step } from '@conquarrow/contracts';
import { orderedBorders } from '../src/economy';
import {
  A,
  B,
  MINIMAL,
  MINIMAL_DIAMETER,
  SPACIOUS,
  SPACIOUS_DIAMETER,
  aForkArmCut,
  anInterleaving,
  countingVertices,
  headsOn,
  isTrail,
  onBoard,
  owned,
  ownerOf,
  pick,
  slotsAt,
  stateOf,
  territoryOf,
  totalHeads,
  trailOf,
  vertexReadsOf,
  via,
} from './support';

const BOARDS = [
  { name: 'minimal', description: MINIMAL, diameter: MINIMAL_DIAMETER },
  { name: 'spacious', description: SPACIOUS, diameter: SPACIOUS_DIAMETER },
] as const;

describe('a crossing evaporates the victim’s trail in both directions', () => {
  it.each(BOARDS)('removes trail arrows of a bare spine on $name', ({ description, diameter }) => {
    const table = onBoard(description);
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(table.geometry, diameter);
    const before = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [trailIn, trailOut] },
    });
    expect(table.rules.crossesTrail(before, via(ourIn, ourExit), B)).toBe(true);

    const after = table.rules.apply(before, step(ourIn, ourExit, 1));

    expect(trailOf(after, B).length).toBeLessThan(trailOf(before, B).length);
  });
});

describe('any garrison is a firebreak (P12)', () => {
  it('leaves the first occupied arrow standing with its heads', () => {
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const beyond = pick(table.geometry.outArrows(table.geometry.target(trailOut)), 0);
    const before = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 1 },
        { arrow: trailOut, owner: B, heads: 1 },
        { arrow: beyond, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [ourIn], B: [trailIn, trailOut, beyond] },
      },
    );

    const after = table.rules.apply(before, step(ourIn, ourExit, 1));

    expect(headsOn(after, trailOut)).toBe(1);
    expect(after.groups.get(beyond)?.heads).toBeGreaterThanOrEqual(1);
    expect(isTrail(after, B, beyond)).toBe(true);
  });
});

describe('all-to-all spreads a front into every continuation', () => {
  it('destroys every out-arm of a fork from one cut', () => {
    const table = onBoard();
    const { ins, outs } = slotsAt(
      table.geometry,
      table.geometry.target(pick(table.geometry.outArrows(table.geometry.seedPoint()), 0)),
    );
    const trailIn = pick(ins, 0);
    const armX = pick(outs, 0);
    const armY = pick(outs, 1);
    const cutterIn = pick(ins, 1);
    const before = stateOf([{ arrow: cutterIn, owner: A, heads: 1 }], A, {
      trail: { A: [cutterIn], B: [trailIn, armX, armY] },
    });

    const after = table.rules.apply(before, step(cutterIn, armX, 1));

    expect(isTrail(after, B, armX)).toBe(false);
    expect(isTrail(after, B, armY)).toBe(false);
  });
});

describe('halt is per arrow; territory is a wall; only the victim’s trail changes', () => {
  it('does not remove the victim’s territory arrow', () => {
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const before = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [trailIn, trailOut] },
      territory: [{ arrow: trailIn, owner: B }],
    });

    const after = table.rules.apply(before, step(ourIn, ourExit, 1));

    expect(isTrail(after, B, trailOut)).toBe(false);
    expect(territoryOf(after, trailIn)).toBe(B);
  });

  it('leaves every other player’s trail unchanged by the cut', () => {
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const before = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [trailIn, trailOut] },
    });
    const cutterTrail = trailOf(before, A);

    const after = table.rules.apply(before, step(ourIn, ourExit, 1));

    expect(trailOf(after, B).length).toBeLessThan(trailOf(before, B).length);
    for (const arrow of cutterTrail) {
      expect(trailOf(after, A)).toContain(arrow);
    }
  });
});

describe('surviving fragments demote to stack grade', () => {
  it('reports stack grade on a far fragment after a deep cut', () => {
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const tip = pick(table.geometry.outArrows(table.geometry.target(trailOut)), 0);
    const home = pick(table.geometry.inArrows(table.geometry.origin(trailIn)), 0);
    const before = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 1 },
        { arrow: trailOut, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { A: [ourIn], B: [trailIn, trailOut, tip] },
        territory: [{ arrow: home, owner: B }],
      },
    );

    const after = table.rules.apply(before, step(ourIn, ourExit, 1));

    expect(isTrail(after, B, tip)).toBe(true);
    expect(table.rules.anchorGrade(after, tip, B)).toBe('stack');
  });
});

describe('cut resolution is pure and requests no vertex beyond an idle move', () => {
  it('does not mutate the input trail sets', () => {
    const table = onBoard();
    const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const s0 = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
      trail: { A: [ourIn], B: [trailIn, trailOut] },
    });
    const before = trailOf(s0, B);

    const s1 = table.rules.apply(s0, step(ourIn, ourExit, 1));

    expect(trailOf(s0, B)).toEqual(before);
    expect(trailOf(s1, B).length).toBeLessThan(before.length);
  });

  it('requests no vertex beyond what an idle move requests, on either fixture board', () => {
    for (const { description, diameter } of BOARDS) {
      const base = onBoard(description).geometry;
      const { geometry, vertexReads } = countingVertices(base);
      const rules = makeRules(geometry);
      const { trailIn, trailOut, ourIn, ourExit } = anInterleaving(geometry, diameter);
      const before = stateOf([{ arrow: ourIn, owner: A, heads: 1 }], A, {
        trail: { A: [ourIn], B: [trailIn, trailOut] },
      });
      const idle = vertexReadsOf(vertexReads, () => {
        rules.apply(before, skip(ourIn));
      });
      let after = before;
      const cutting = vertexReadsOf(vertexReads, () => {
        after = rules.apply(before, step(ourIn, ourExit, 1));
      });
      expect(trailOf(after, B).length).toBeLessThan(trailOf(before, B).length);
      // P37: the cut adds no lattice read of its own over an idle move on the same
      // board. Not a hard zero any more, and not because the cut changed: loss
      // resolution sits on the tail of `apply` and counts the *shares* of a seat
      // that owns ground and holds no head, which `stateOf`'s keepalive land makes
      // true of every seat that authored none. See `immediate-loss.md`, *Cost*.
      expect(cutting).toBe(idle);
    }
  });
});

const aBirthOnArm = (table: ReturnType<typeof onBoard>, diameter: number) => {
  const { stem, armX, armY } = aForkArmCut(table.geometry, diameter);
  for (const vertex of table.geometry.flankVertices(armX)) {
    const borders = orderedBorders(table.geometry, vertex);
    const phase = borders.indexOf(armX);
    if (phase < 0) continue;
    const bHome = borders.find((arrow) => arrow !== armX && arrow !== armY && arrow !== stem);
    if (bHome === undefined) continue;
    return { vertex, phase, stem, armX, armY, bHome };
  }
  throw new Error('setup: no spawner vertex flanking arm X without sitting on the fork');
};

describe('a cut that arrives along one fork arm floods every arm (P47)', () => {
  it.each(BOARDS)('removes the sibling arm on $name', ({ description, diameter }) => {
    const table = onBoard(description);
    const { stem, armX, armY, trailOut, cutterIn, interleavingExit } = aForkArmCut(
      table.geometry,
      diameter,
    );
    const before = stateOf([{ arrow: cutterIn, owner: A, heads: 1 }], A, {
      trail: { A: [cutterIn], B: [stem, armX, armY, trailOut] },
    });
    expect(table.rules.crossesTrail(before, via(cutterIn, interleavingExit), B)).toBe(true);

    const after = table.rules.apply(before, step(cutterIn, interleavingExit, 1));

    expect(isTrail(after, B, armX)).toBe(false);
    expect(isTrail(after, B, armY)).toBe(false);
  });

  it.each(BOARDS)(
    'does not treat the cutter’s occupation as a firebreak on $name',
    ({ description, diameter }) => {
      const table = onBoard(description);
      const { stem, armX, armY, trailOut, beyond, cutterIn } = aForkArmCut(
        table.geometry,
        diameter,
      );
      const before = stateOf([{ arrow: cutterIn, owner: A, heads: 1 }], A, {
        trail: { A: [cutterIn], B: [stem, armX, armY, trailOut, beyond] },
      });

      const after = table.rules.apply(before, step(cutterIn, trailOut, 1));

      expect(ownerOf(after, trailOut)).toBe(A);
      expect(isTrail(after, B, trailOut)).toBe(false);
      expect(isTrail(after, B, beyond)).toBe(false);
      expect(isTrail(after, B, armY)).toBe(false);
    },
  );

  it.each(
    BOARDS.flatMap((board) =>
      (['wipe', 'birth'] as const).map((kind) => ({ ...board, kind })),
    ),
  )('takes the sibling from a $kind on one arm of $name', ({ description, diameter, kind }) => {
    const table = onBoard(description);
    if (kind === 'wipe') {
      const { stem, armX, armY, otherIn } = aForkArmCut(table.geometry, diameter);
      const before = stateOf(
        [
          { arrow: otherIn, owner: A, heads: 2 },
          { arrow: armX, owner: B, heads: 1 },
        ],
        A,
        { trail: { A: [otherIn], B: [stem, armX, armY] } },
      );
      const after = table.rules.apply(before, step(otherIn, armX, 1));
      expect(isTrail(after, B, armX)).toBe(false);
      expect(isTrail(after, B, armY)).toBe(false);
      return;
    }
    const { vertex, phase, stem, armX, armY, bHome } = aBirthOnArm(table, diameter);
    const before = stateOf([], A, {
      trail: { B: [stem, armX, armY] },
      territory: [...owned([armX], A), ...owned([bHome], B)],
      accumulators: [[armX, rational(2, 3)]],
      spawners: [[vertex, { force: rational(1, 3), phase }]],
    });
    const after = table.rules.apply(table.rules.apply(before, endTurn()), endTurn());
    expect(ownerOf(after, armX)).toBe(A);
    expect(isTrail(after, B, armX)).toBe(false);
    expect(isTrail(after, B, armY)).toBe(false);
  });

  it.each(BOARDS)(
    'does not change head count on a fork-arm cut on $name',
    ({ description, diameter }) => {
      const table = onBoard(description);
      const { stem, armX, armY, trailOut, cutterIn, interleavingExit } = aForkArmCut(
        table.geometry,
        diameter,
      );
      const before = stateOf([{ arrow: cutterIn, owner: A, heads: 1 }], A, {
        trail: { A: [cutterIn], B: [stem, armX, armY, trailOut] },
      });
      const heads = totalHeads(before);

      const after = table.rules.apply(before, step(cutterIn, interleavingExit, 1));

      expect(isTrail(after, B, armY)).toBe(false);
      expect(totalHeads(after)).toBe(heads);
    },
  );
});
