/**
 * docs/spec/encirclement/encirclement.edge-cases.feature — one test per scenario.
 *
 * @see docs/spec/encirclement/encirclement.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import {
  A,
  B,
  SPACIOUS,
  SPACIOUS_DIAMETER,
  aRunFromHome,
  allArrows,
  anExitFrom,
  anArrow,
  arrowAt,
  headsOn,
  isTrail,
  onBoard,
  onTiling,
  owned,
  ownerOf,
  pathFrom,
  snapshot,
  stateOf,
} from './support';
import type { ArrowId } from './support';

const totalHeads = (state: ReturnType<typeof stateOf>): number =>
  [...state.groups.values()].reduce((sum, g) => sum + g.heads, 0);

// ── Rule: neutral stranded is not capture ────────────────────────────────────

describe('neutral stranded is not capture', () => {
  it('does not convert a stack-grade fragment on neutral ground', () => {
    const table = onBoard();
    const tip = anArrow(table.geometry);
    const stem = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, stem);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: [tip, stem] },
        territory: [{ arrow: mover, owner: A }],
      },
    );
    expect(table.rules.anchorGrade(before, tip, B)).toBe('stack');

    const exit = anExitFrom(table.geometry, mover);
    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(ownerOf(after, tip)).toBe(B);
  });

  it('never converts a stack on its own territory', () => {
    const table = onBoard();
    const home = anArrow(table.geometry);
    const mover = anExitFrom(table.geometry, home);
    const before = stateOf(
      [
        { arrow: home, owner: B, heads: 2 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        territory: [
          { arrow: home, owner: B },
          { arrow: mover, owner: A },
        ],
      },
    );

    const exit = anExitFrom(table.geometry, mover);
    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(ownerOf(after, home)).toBe(B);
    expect(headsOn(after, home)).toBe(2);
  });
});

// ── Rule: conversion wipes the connected trail (P33) ─────────────────────────

describe('conversion wipes the connected trail', () => {
  it('leaves victim trail on a different component after convert wipe', () => {
    // encirclement.edge: "Victim trail on a different component survives convert wipe"
    const table = onBoard(SPACIOUS);
    const tip = anArrow(table.geometry);
    const stem = anExitFrom(table.geometry, tip);
    const mover = anExitFrom(table.geometry, stem);
    const reserved = [tip, stem, mover];
    const other = aPointDisjointPath(table, reserved, 2);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: [tip, stem, ...other] },
        territory: [
          { arrow: tip, owner: A },
          { arrow: mover, owner: A },
        ],
      },
    );

    const exit = anExitFrom(table.geometry, mover);
    const after = table.rules.apply(before, step(mover, exit, 1));

    expect(ownerOf(after, tip)).toBe(A);
    expect(isTrail(after, B, tip)).toBe(false);
    expect(isTrail(after, B, stem)).toBe(false);
    for (const arrow of other) expect(isTrail(after, B, arrow)).toBe(true);
  });
});

// ── Rule: head conservation and purity ───────────────────────────────────────

describe('head conservation and purity', () => {
  it('conserves total heads when conversion alone changes ownership', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 3 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );
    const headsBefore = totalHeads(before);

    const after = table.rules.apply(before, step(last, landing, 1));

    expect(totalHeads(after)).toBe(headsBefore);
  });

  it('does not mutate the input state', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const s0 = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 2 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );
    const before = snapshot(s0);

    const s1 = table.rules.apply(s0, step(last, landing, 1));

    expect(snapshot(s0)).toEqual(before);
    expect(snapshot(s1)).not.toEqual(before);
  });

  it('yields equal outcomes from equal inputs', () => {
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
    const move = step(last, landing, 1);

    expect(snapshot(table.rules.apply(state, move))).toEqual(
      snapshot(table.rules.apply(state, move)),
    );
  });
});

// ── Rule: order and seams ────────────────────────────────────────────────────

describe('order and seams', () => {
  it('converts on the P05b claimed-arrow seam', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const before = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 2 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );

    const after = table.rules.apply(before, step(last, landing, 1));

    expect(ownerOf(after, occupied)).toBe(A);
    expect(headsOn(after, occupied)).toBe(2);
  });

  it('does not convert when nobody steps', () => {
    const table = onBoard();
    const tip = anArrow(table.geometry);
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

    // Conversion is resolved inside a step. Nothing stepped, so nothing converted.
    const after = table.rules.apply(before, endTurn());

    expect(snapshot(after).groups).toEqual(snapshot(before).groups);
    expect(snapshot(after).territory).toEqual(snapshot(before).territory);
    expect(ownerOf(after, tip)).toBe(B);
  });
});

const aPointDisjointPath = (
  table: ReturnType<typeof onBoard>,
  reserved: readonly ArrowId[],
  length: number,
): readonly ArrowId[] => {
  const points = new Set(
    reserved.flatMap((a) => [String(table.geometry.origin(a)), String(table.geometry.target(a))]),
  );
  const sharesPoint = (a: ArrowId): boolean =>
    points.has(String(table.geometry.origin(a))) || points.has(String(table.geometry.target(a)));
  for (const start of allArrows(table.geometry, SPACIOUS_DIAMETER)) {
    if (sharesPoint(start)) continue;
    try {
      const path = pathFrom(table.geometry, start, length, reserved);
      if (path.some(sharesPoint)) continue;
      return path;
    } catch {
      continue;
    }
  }
  throw new Error('setup: no point-disjoint trail component');
};
