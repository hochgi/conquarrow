/**
 * The EARS invariants of docs/spec/refuse-self-convert/refuse-self-convert.md,
 * as properties over the fixture board. Enumerated deterministically — every
 * grain step on `minimal`. No generator and no seed.
 *
 * Web presentation (refused target / tooltip) is in packages/web.
 *
 * @see docs/spec/refuse-self-convert/refuse-self-convert.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { ContractViolation, endTurn, step } from '@conquarrow/contracts';
import type { Move, StepMove } from '@conquarrow/contracts';
import { makeRules } from '../src/index';
import {
  A,
  B,
  MINIMAL_DIAMETER,
  aRunFromHome,
  allArrows,
  anArrow,
  anExitFrom,
  anInterleaving,
  arrowAt,
  countingVertices,
  exitsFrom,
  headsOn,
  onBoard,
  onTiling,
  owned,
  ownerOf,
  pick,
  snapshot,
  stateOf,
  territoryOf,
  vertexReadsOf,
} from './support';
import type { ArrowId, GameState } from './support';

const WOULD_CONVERT =
  'step onto enemy territory without a territory-grade trail would convert';

const stepsOnto = (
  moves: readonly Move[],
  from: ArrowId,
  exit: ArrowId,
): readonly StepMove[] =>
  moves.filter((m): m is StepMove => m.kind === 'step' && m.from === from && m.exit === exit);

const messageOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ContractViolation);
    return (error as ContractViolation).message;
  }
  throw new Error('expected ContractViolation; apply accepted a self-convert step');
};

describe('self-convert steps are omitted from legalMoves', () => {
  it('omits every count of every unprotected grain step onto foreign territory', () => {
    const table = onBoard();
    for (const from of allArrows(table.geometry, MINIMAL_DIAMETER)) {
      for (const exit of exitsFrom(table.geometry, from)) {
        const marked = stateOf([{ arrow: from, owner: A, heads: 2 }], A, {
          trail: { A: [from] },
          territory: [{ arrow: exit, owner: B }],
        });
        expect(table.rules.anchorGrade(marked, from, A)).toBe('stack');
        expect(stepsOnto(table.rules.legalMoves(marked), from, exit)).toEqual([]);

        const unmarked = stateOf([{ arrow: from, owner: A, heads: 2 }], A, {
          territory: [{ arrow: exit, owner: B }],
        });
        expect(stepsOnto(table.rules.legalMoves(unmarked), from, exit)).toEqual([]);
      }
    }
  });
});

describe('refused apply does not mutate occupancy, trails, territory, or owners', () => {
  it('throws the stable message and leaves the input pictured state intact', () => {
    const table = onBoard();
    for (const from of allArrows(table.geometry, MINIMAL_DIAMETER)) {
      for (const exit of exitsFrom(table.geometry, from)) {
        const state = stateOf([{ arrow: from, owner: A, heads: 1 }], A, {
          trail: { A: [from] },
          territory: [{ arrow: exit, owner: B }],
        });
        const before = snapshot(state);
        expect(messageOf(() => table.rules.apply(state, step(from, exit, 1)))).toBe(WOULD_CONVERT);
        expect(snapshot(state)).toEqual(before);
        expect(ownerOf(state, from)).toBe(A);
        expect(territoryOf(state, exit)).toBe(B);
      }
    }
  });
});

describe('territory-grade protection still raids', () => {
  it('offers grain steps onto foreign territory from home and from a territory-grade trail', () => {
    const table = onBoard();
    for (const from of allArrows(table.geometry, MINIMAL_DIAMETER)) {
      for (const exit of exitsFrom(table.geometry, from)) {
        const offHome = stateOf([{ arrow: from, owner: A, heads: 1 }], A, {
          territory: [
            { arrow: from, owner: A },
            { arrow: exit, owner: B },
          ],
        });
        expect(stepsOnto(table.rules.legalMoves(offHome), from, exit).length).toBeGreaterThan(0);
        const landedHome = table.rules.apply(offHome, step(from, exit, 1));
        expect(ownerOf(landedHome, exit)).toBe(A);
        expect(territoryOf(landedHome, exit)).toBe(B);

        const home = pick(table.geometry.inArrows(table.geometry.origin(from)), 0);
        if (home === exit) continue;
        const raiding = stateOf([{ arrow: from, owner: A, heads: 1 }], A, {
          trail: { A: [from] },
          territory: [
            { arrow: home, owner: A },
            { arrow: exit, owner: B },
          ],
        });
        expect(table.rules.anchorGrade(raiding, from, A)).toBe('territory');
        expect(stepsOnto(table.rules.legalMoves(raiding), from, exit).length).toBeGreaterThan(0);
        const landedRaid = table.rules.apply(raiding, step(from, exit, 1));
        expect(ownerOf(landedRaid, exit)).toBe(A);
        expect(territoryOf(landedRaid, exit)).toBe(B);
      }
    }
  });
});

describe('unclaimed ground is not this refusal', () => {
  it('still offers a stack-grade step onto an exit with no territory owner', () => {
    const table = onBoard();
    for (const from of allArrows(table.geometry, MINIMAL_DIAMETER)) {
      for (const exit of exitsFrom(table.geometry, from)) {
        const state = stateOf([{ arrow: from, owner: A, heads: 1 }], A, {
          trail: { A: [from] },
        });
        expect(territoryOf(state, exit)).toBeUndefined();
        expect(stepsOnto(table.rules.legalMoves(state), from, exit).length).toBeGreaterThan(0);
        expect(ownerOf(table.rules.apply(state, step(from, exit, 1)), exit)).toBe(A);
      }
    }
  });
});

describe('own territory is not this refusal', () => {
  it('still offers a stack-grade step onto the mover’s own territory', () => {
    const table = onBoard();
    for (const from of allArrows(table.geometry, MINIMAL_DIAMETER)) {
      for (const exit of exitsFrom(table.geometry, from)) {
        const state = stateOf([{ arrow: from, owner: A, heads: 1 }], A, {
          trail: { A: [from] },
          territory: [{ arrow: exit, owner: A }],
        });
        expect(table.rules.anchorGrade(state, from, A)).toBe('stack');
        expect(stepsOnto(table.rules.legalMoves(state), from, exit).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('opponent-caused conversion still runs', () => {
  it('still converts on cut demotion and on closure around a garrison', () => {
    const cutTable = onBoard();
    const { trailIn, trailOut: mid, ourIn, ourExit } = anInterleaving(
      cutTable.geometry,
      MINIMAL_DIAMETER,
    );
    const tip = anExitFrom(cutTable.geometry, mid);
    const home = pick(cutTable.geometry.inArrows(cutTable.geometry.origin(trailIn)), 0);
    const cutBefore = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 1 },
        { arrow: tip, owner: B, heads: 2 },
      ],
      A,
      {
        trail: { A: [ourIn], B: [trailIn, mid, tip] },
        territory: [
          { arrow: home, owner: B },
          { arrow: tip, owner: A },
        ],
      },
    );
    expect(cutTable.rules.anchorGrade(cutBefore, tip, B)).toBe('territory');
    const cutAfter = cutTable.rules.apply(cutBefore, step(ourIn, ourExit, 1));
    expect(ownerOf(cutAfter, tip)).toBe(A);
    expect(headsOn(cutAfter, tip)).toBe(2);

    const closeTable = onTiling();
    const { home: closeHome, run } = aRunFromHome(closeTable.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(closeTable.geometry, last);
    const closeBefore = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 1 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([closeHome, landing], A) },
    );
    const closeAfter = closeTable.rules.apply(closeBefore, step(last, landing, 1));
    expect(ownerOf(closeAfter, occupied)).toBe(A);
  });
});

describe('not stepping does not convert', () => {
  it('returns the authored encircled group unchanged', () => {
    const table = onBoard();
    const tip = anArrow(table.geometry);
    const mover = anExitFrom(table.geometry, tip);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 3 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        territory: [
          { arrow: tip, owner: A },
          { arrow: mover, owner: A },
        ],
      },
    );
    const pictured = snapshot(before);
    const after = snapshot(table.rules.apply(before, endTurn()));
    expect(after.groups).toEqual(pictured.groups);
    expect(after.territory).toEqual(pictured.territory);
    expect(after.trails).toEqual(pictured.trails);
    expect(ownerOf(before, tip)).toBe(B);
  });
});

describe('self-convert is refused before combat', () => {
  it('does not land a contact fight on foreign territory from an unprotected stack', () => {
    const table = onBoard();
    for (const from of allArrows(table.geometry, MINIMAL_DIAMETER)) {
      for (const exit of exitsFrom(table.geometry, from)) {
        const state = stateOf(
          [
            { arrow: from, owner: A, heads: 4 },
            { arrow: exit, owner: B, heads: 3 },
          ],
          A,
          {
            trail: { A: [from] },
            territory: [{ arrow: exit, owner: B }],
          },
        );
        const defenders = headsOn(state, exit);
        expect(stepsOnto(table.rules.legalMoves(state), from, exit)).toEqual([]);
        expect(messageOf(() => table.rules.apply(state, step(from, exit, 3)))).toBe(WOULD_CONVERT);
        expect(headsOn(state, exit)).toBe(defenders);
        expect(ownerOf(state, exit)).toBe(B);
      }
    }
  });
});

describe('everything legalMoves offers, apply accepts', () => {
  it('applies every offered move on a stack-grade fragment neighbouring enemy land', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const exit = anExitFrom(table.geometry, from);
    const state = stateOf([{ arrow: from, owner: A, heads: 4 }], A, {
      trail: { A: [from] },
      territory: [{ arrow: exit, owner: B }],
    });
    expect(territoryOf(state, exit)).toBe(B);
    for (const move of table.rules.legalMoves(state)) {
      expect(() => table.rules.apply(state, move)).not.toThrow();
    }
  });
});

describe('purity: input intact, equal outputs, equal illegal messages', () => {
  it('does not mutate inputs and throws the same message for equal illegal copies', () => {
    const table = onBoard();
    const from = anArrow(table.geometry);
    const exit = anExitFrom(table.geometry, from);
    const ground = {
      trail: { A: [from] } as const,
      territory: [{ arrow: exit, owner: B }] as const,
    };
    const s1: GameState = stateOf([{ arrow: from, owner: A, heads: 1 }], A, ground);
    const s2: GameState = stateOf([{ arrow: from, owner: A, heads: 1 }], A, ground);
    const pictured = snapshot(s1);
    const move = step(from, exit, 1);

    const first = messageOf(() => table.rules.apply(s1, move));
    const second = messageOf(() => table.rules.apply(s2, move));
    expect(first).toBe(second);
    expect(first).toBe(WOULD_CONVERT);
    expect(snapshot(s1)).toEqual(pictured);
    expect(snapshot(s2)).toEqual(pictured);

    const home = pick(table.geometry.inArrows(table.geometry.origin(from)), 0);
    const raid = stateOf([{ arrow: from, owner: A, heads: 1 }], A, {
      trail: { A: [from] },
      territory: [
        { arrow: home, owner: A },
        { arrow: exit, owner: B },
      ],
    });
    const raidBefore = snapshot(raid);
    const once = snapshot(table.rules.apply(raid, step(from, exit, 1)));
    const twice = snapshot(table.rules.apply(raid, step(from, exit, 1)));
    expect(once).toEqual(twice);
    expect(snapshot(raid)).toEqual(raidBefore);
  });
});

describe('the system enumerates no vertex', () => {
  it('reads no flankVertices or borderArrows while listing or refusing a self-convert step', () => {
    const base = onBoard().geometry;
    const { geometry, vertexReads } = countingVertices(base);
    const rules = makeRules(geometry);
    const from = anArrow(geometry);
    const exit = anExitFrom(geometry, from);
    const state = stateOf([{ arrow: from, owner: A, heads: 1 }], A, {
      trail: { A: [from] },
      territory: [{ arrow: exit, owner: B }],
    });

    const listingAndRefusing = vertexReadsOf(vertexReads, () => {
      rules.legalMoves(state);
      try {
        rules.apply(state, step(from, exit, 1));
      } catch {
        // Refusal is the expected path; it happens before any loss resolves.
      }
    });
    const home = pick(geometry.inArrows(geometry.origin(from)), 0);
    const raid = stateOf([{ arrow: from, owner: A, heads: 1 }], A, {
      trail: { A: [from] },
      territory: [
        { arrow: home, owner: A },
        { arrow: exit, owner: B },
      ],
    });
    // P37 resolves losses at the tail of `apply`, and the last thing that needs for
    // a seat which owns ground and holds no head is a *share* count, which walks the
    // lattice — and `stateOf`'s keepalive land makes exactly that seat exist here. So
    // the permitted raid is measured as a delta over a step that raids nothing on the
    // same board — no move does nothing any more (P51).
    // Listing moves and refusing a self-convert never reach resolution, so their zero
    // stays hard. See `immediate-loss.md`, *Cost*.
    const open = exitsFrom(geometry, from).find((candidate) => candidate !== exit);
    if (open === undefined) throw new Error('setup: the raider has only one exit');
    const idle = vertexReadsOf(vertexReads, () => {
      rules.apply(raid, step(from, open, 1));
    });
    const raiding = vertexReadsOf(vertexReads, () => {
      rules.legalMoves(raid);
      rules.apply(raid, step(from, exit, 1));
    });

    expect(listingAndRefusing).toBe(0);
    expect(raiding).toBe(idle);
  });
});
