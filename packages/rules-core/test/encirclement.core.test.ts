/**
 * docs/spec/encirclement/encirclement.core.feature — one test per scenario.
 *
 * @see docs/spec/encirclement/encirclement.md
 */

import { describe, expect, it } from 'vitest';
import { speed, step } from '@conquarrow/contracts';
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
  exitsFrom,
  headsOn,
  isTrail,
  onBoard,
  onTiling,
  owned,
  ownerOf,
  pathFrom,
  pick,
  spentOn,
  stateOf,
  territoryOf,
} from './support';

// ── Rule: closure converts enclosed enemy stacks intact ──────────────────────

describe('closure converts enclosed enemy stacks intact', () => {
  it('converts a lone enemy head on a claimed arrow', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 1 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );

    const after = table.rules.apply(before, step(last, landing, 1));

    expect(territoryOf(after, occupied)).toBe(A);
    expect(ownerOf(after, occupied)).toBe(A);
    expect(headsOn(after, occupied)).toBe(1);
    expect(spentOn(after, occupied)).toBe(speed(1));
  });

  it.each([1, 2, 3] as const)('converts a %i-stack intact', (n) => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: n },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );

    const after = table.rules.apply(before, step(last, landing, 1));

    expect(ownerOf(after, occupied)).toBe(A);
    expect(headsOn(after, occupied)).toBe(n);
  });

  it('sets spent to speed and drops merge override on convert', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 3, spent: 1, speedOverride: 0 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );

    const after = table.rules.apply(before, step(last, landing, 1));

    expect(ownerOf(after, occupied)).toBe(A);
    expect(headsOn(after, occupied)).toBe(3);
    expect(spentOn(after, occupied)).toBe(speed(3));
    expect(after.groups.get(occupied)?.speedOverride).toBeUndefined();
  });
});

// ── Rule: territory grade protects; lesser grades do not ─────────────────────

describe('territory grade protects; lesser grades do not', () => {
  it('does not convert a territory-grade trail into enemy land', () => {
    const table = onBoard();
    const bHome = anArrow(table.geometry);
    const path = pathFrom(table.geometry, anExitFrom(table.geometry, bHome), 3);
    const tip = arrowAt(path, 2);
    const stretch = [arrowAt(path, 0), arrowAt(path, 1), tip];
    const reserved = new Set([bHome, ...stretch]);
    const safeHome = pick(
      allArrows(table.geometry, MINIMAL_DIAMETER).filter((a) => !reserved.has(a)),
      0,
    );
    const safeExit = pick(
      exitsFrom(table.geometry, safeHome).filter((a) => !reserved.has(a)),
      0,
    );
    const before = stateOf(
      [
        { arrow: safeHome, owner: A, heads: 1 },
        { arrow: tip, owner: B, heads: 1 },
      ],
      A,
      {
        trail: { B: stretch },
        territory: [
          { arrow: bHome, owner: B },
          { arrow: tip, owner: A },
          { arrow: safeHome, owner: A },
          { arrow: safeExit, owner: A },
        ],
      },
    );
    expect(territoryOf(before, bHome)).toBe(B);
    expect(table.rules.anchorGrade(before, tip, B)).toBe('territory');

    const after = table.rules.apply(before, step(safeHome, safeExit, 1));
    expect(ownerOf(after, tip)).toBe(B);
  });

  it('converts a stack-grade raider inside enemy territory', () => {
    const table = onBoard();
    const tip = pick(table.geometry.inArrows(table.geometry.seedPoint()), 0);
    const stem = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, stem);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 2 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: [tip, stem] },
        territory: [
          { arrow: tip, owner: A },
          { arrow: mover, owner: A },
        ],
      },
    );
    expect(table.rules.anchorGrade(before, tip, B)).toBe('stack');

    const exit = anExitFrom(table.geometry, mover);
    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(ownerOf(after, tip)).toBe(A);
    expect(headsOn(after, tip)).toBe(2);
  });

  it('converts a head with no trail on enemy territory', () => {
    const table = onBoard();
    const tip = pick(table.geometry.inArrows(table.geometry.seedPoint()), 0);
    const mover = anExitFrom(table.geometry, tip);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
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

    const exit = anExitFrom(table.geometry, mover);
    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(ownerOf(after, tip)).toBe(A);
  });
});

// ── Rule: cut demotion then conversion ───────────────────────────────────────

describe('cut demotion then conversion on the same step', () => {
  it('converts after a cut drops territory grade inside enemy land', () => {
    // P12: halt at tip; empty mid-trail is cleared so tip loses territory grade
    // and converts on A's land; convert then strips B's trail from tip.
    const table = onBoard();
    const { trailIn, trailOut: mid, ourIn, ourExit } = anInterleaving(
      table.geometry,
      MINIMAL_DIAMETER,
    );
    const tip = anExitFrom(table.geometry, mid);
    const home = pick(table.geometry.inArrows(table.geometry.origin(trailIn)), 0);

    const before = stateOf(
      [
        { arrow: ourIn, owner: A, heads: 1 },
        { arrow: tip, owner: B, heads: 1 },
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
    expect(table.rules.anchorGrade(before, tip, B)).toBe('territory');

    const after = table.rules.apply(before, step(ourIn, ourExit, 1));

    expect(ownerOf(after, tip)).toBe(A);
    expect(headsOn(after, tip)).toBe(1);
    expect(isTrail(after, B, tip)).toBe(false);
  });
});
