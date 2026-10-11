/**
 * The EARS invariants of docs/spec/encirclement/encirclement.md, as properties.
 *
 * @see docs/spec/encirclement/encirclement.md — "Invariants"
 */

import { describe, expect, it } from 'vitest';
import { speed, step } from '@conquarrow/contracts';
import {
  A,
  B,
  aRunFromHome,
  anArrow,
  anExitFrom,
  arrowAt,
  headsOn,
  onBoard,
  onTiling,
  owned,
  ownerOf,
  pathFrom,
  pick,
  snapshot,
  stateOf,
} from './support';

describe('encirclement converts only unprotected enemy groups on foreign territory', () => {
  it('converts no-trail stacks on enemy land and conserves heads', () => {
    const table = onBoard();
    const tip = anArrow(table.geometry);
    const mover = anExitFrom(table.geometry, tip);
    const before = stateOf(
      [
        { arrow: tip, owner: B, heads: 4 },
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
    const sum = [...before.groups.values()].reduce((s, g) => s + g.heads, 0);

    const after = table.rules.apply(before, step(mover, anExitFrom(table.geometry, mover), 1));

    expect(ownerOf(after, tip)).toBe(A);
    expect(headsOn(after, tip)).toBe(4);
    expect([...after.groups.values()].reduce((s, g) => s + g.heads, 0)).toBe(sum);
  });

  it('does not convert territory-grade or own/neutral occupancy', () => {
    const table = onBoard();
    const bHome = anArrow(table.geometry);
    const path = pathFrom(table.geometry, anExitFrom(table.geometry, bHome), 3);
    const tip = arrowAt(path, 2);
    const stretch = [arrowAt(path, 0), arrowAt(path, 1), tip];
    const mover = pick(
      table.geometry
        .inArrows(table.geometry.seedPoint())
        .filter((a) => a !== bHome && !stretch.includes(a)),
      0,
    );

    const protectedSetup = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        trail: { B: stretch },
        territory: [
          { arrow: bHome, owner: B },
          { arrow: tip, owner: A },
          { arrow: mover, owner: A },
        ],
      },
    );
    expect(table.rules.anchorGrade(protectedSetup, tip, B)).toBe('territory');
    // Step onto A's own ground so we do not paint B's last territory feeder (P13 root cut).
    const safeExit = table.geometry
      .outArrows(table.geometry.target(mover))
      .find((a) => protectedSetup.territory.get(a) !== B);
    if (safeExit === undefined) throw new Error('setup: no safe exit from mover');
    const afterProtected = table.rules.apply(protectedSetup, step(mover, safeExit, 1));
    expect(ownerOf(afterProtected, tip)).toBe(B);

    const ownLand = stateOf(
      [
        { arrow: tip, owner: B, heads: 1 },
        { arrow: mover, owner: A, heads: 1 },
      ],
      A,
      {
        territory: [
          { arrow: tip, owner: B },
          { arrow: mover, owner: A },
        ],
      },
    );
    expect(ownerOf(table.rules.apply(ownLand, step(mover, anExitFrom(table.geometry, mover), 1)), tip)).toBe(
      B,
    );
  });

  it('resets spent on convert and is pure', () => {
    const table = onTiling();
    const { home, run } = aRunFromHome(table.geometry, 3);
    const occupied = arrowAt(run, 0);
    const last = arrowAt(run, 2);
    const landing = anExitFrom(table.geometry, last);
    const s0 = stateOf(
      [
        { arrow: last, owner: A, heads: 1 },
        { arrow: occupied, owner: B, heads: 2, spent: 1 },
      ],
      A,
      { trail: { A: [...run] }, territory: owned([home, landing], A) },
    );
    const before = snapshot(s0);
    const move = step(last, landing, 1);

    const s1 = table.rules.apply(s0, move);

    expect(snapshot(s0)).toEqual(before);
    expect(ownerOf(s1, occupied)).toBe(A);
    expect(s1.groups.get(occupied)?.spent).toBe(speed(2));
    expect(snapshot(table.rules.apply(s0, move))).toEqual(snapshot(s1));
  });
});
