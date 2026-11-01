/**
 * P78 harness correctness — the packet's scenario inventory, one test each, on
 * fixture positions with hand-known outcomes. Each scenario also checks the
 * board `apply` produced, so a fixture that does not set up what it claims
 * fails as a fixture rather than passing as a count.
 */

import { describe, expect, it } from 'vitest';
import { endTurn, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move } from '@conquarrow/contracts';
import { geometry, rules } from '../src/board';
import { emptyReach, foldReach, readStep, reachReport } from '../src/reach';
import { A, B, aRingWithAnInside, aRunFromHome, aStep, headsOn, pathFrom, stateOf } from './reach.support';

const applied = (before: GameState, move: Move): { readonly after: GameState; readonly move: Move } => ({
  after: rules.apply(before, move),
  move,
});

/** A ring closure: A's trail is the wall, the tip lands on territory off the ring. */
const ringClosure = (enemies: readonly { readonly arrow: ArrowId; readonly heads: number }[]) => {
  const { wall, inside } = aRingWithAnInside();
  const tip = wall[5] as ArrowId;
  const offRing = (arrows: readonly ArrowId[]): ArrowId => {
    const hit = arrows.find((a) => !wall.includes(a) && !inside.includes(a));
    if (hit === undefined) throw new Error('setup: no off-ring arrow');
    return hit;
  };
  const home = offRing(geometry.inArrows(geometry.origin(wall[0] as ArrowId)));
  const landing = offRing(geometry.outArrows(geometry.target(tip)));
  const before = stateOf(
    [{ arrow: tip, owner: A, heads: 1 }, ...enemies.map((e) => ({ ...e, owner: B }))],
    { trails: { A: wall }, territory: { A: [home, landing] } },
  );
  return { before, inside, move: step(tip, landing, 1) };
};

describe('P78 reach — what the harness counts', () => {
  it('A step into an occupied enemy arrow is counted as combat, not encirclement', () => {
    const { from, exit } = aStep();
    const before = stateOf([
      { arrow: from, owner: A, heads: 3 },
      { arrow: exit, owner: B, heads: 2 },
    ]);
    const { after, move } = applied(before, step(from, exit, 2));

    // §6.2, A = 2 against D = 2: the attacker loses 1, the defender 2.
    expect(headsOn(after, exit)).toEqual({ owner: 'A', heads: 1 });
    expect(headsOn(after, from)).toEqual({ owner: 'A', heads: 1 });
    const reading = readStep(rules, before, move, after);
    expect(reading.losses).toEqual({ combat: 3, encirclement: 0, evaporation: 0, vanished: 0 });
    expect(reading.attack).toBe(true);
    expect(reading.closure).toBeUndefined();
  });

  it('A head captured by a closure is counted as encirclement, not combat', () => {
    const pocket = aRingWithAnInside().inside[0] as ArrowId;
    const { before: withEnemy, move } = ringClosure([{ arrow: pocket, heads: 1 }]);
    const { after } = applied(withEnemy, move);

    expect(after.territory.get(pocket)).toBe(A);
    expect(headsOn(after, pocket)).toEqual({ owner: 'A', heads: 1 });
    const reading = readStep(rules, withEnemy, move, after);
    expect(reading.losses).toEqual({ combat: 0, encirclement: 1, evaporation: 0, vanished: 0 });
    expect(reading.closure).toEqual({ kind: 'captureWithEnemyHeads', enemyHeads: 1 });
  });

  it('A head killed by an evaporation front is counted as evaporation', () => {
    // §6.1 (P12): evaporation kills nobody, so `apply` never produces this. The
    // after-state is edited by hand to show the bucket exists and is separate.
    const { from, exit } = aStep();
    const far = pathFrom(from, 30);
    const victim = far[25] as ArrowId;
    const before = stateOf(
      [
        { arrow: from, owner: A, heads: 1 },
        { arrow: victim, owner: B, heads: 1 },
      ],
      { trails: { B: [victim, far[26] as ArrowId] } },
    );
    const move = step(from, exit, 1);
    const real = rules.apply(before, move);
    const groups = new Map(real.groups);
    groups.delete(victim);
    const reading = readStep(rules, before, move, { ...real, groups });

    expect(readStep(rules, before, move, real).losses.evaporation).toBe(0);
    expect(reading.losses).toEqual({ combat: 0, encirclement: 0, evaporation: 1, vanished: 0 });
  });

  it('A land-bridge closure is distinguished from an area capture', () => {
    const { home, run, landing } = aRunFromHome(2);
    const tip = run[1] as ArrowId;
    const bridge = stateOf([{ arrow: tip, owner: A, heads: 1 }], { trails: { A: run }, territory: { A: [home, landing] } });
    const bridged = applied(bridge, step(tip, landing, 1));
    const ring = ringClosure([]);
    const ringed = applied(ring.before, ring.move);

    expect(bridged.after.territory.get(tip)).toBe(A);
    expect(readStep(rules, bridge, bridged.move, bridged.after).closure).toEqual({ kind: 'landBridge', enemyHeads: 0 });
    expect(ringed.after.territory.get(ring.inside[0] as ArrowId)).toBe(A);
    expect(readStep(rules, ring.before, ring.move, ringed.after).closure).toEqual({ kind: 'areaCapture', enemyHeads: 0 });
  });

  it('A closure enclosing one enemy head is counted once, not per arrow', () => {
    const { inside } = aRingWithAnInside();
    const { before, move } = ringClosure([{ arrow: inside[0] as ArrowId, heads: 1 }]);
    const { after } = applied(before, move);
    const tally = emptyReach();
    foldReach(rules, tally, before, move, after);
    const report = reachReport(tally);

    const claimed = [...after.territory].filter(([a, o]) => o === A && before.territory.get(a) !== A).length;
    expect(claimed).toBeGreaterThan(6);
    expect(report.closures).toEqual({ landBridge: 0, areaCapture: 0, captureWithEnemyHeads: 1 });
    expect(report.closuresWithEnemyHeads).toBe(1);
    expect(report.enemyHeadsClaimed).toBe(1);
    expect(report.losses.encirclement).toBe(1);
  });

  it('A seat removed by the §9 loss check is counted as vanished, apart from the three', () => {
    // Hand-edited after-state: B holds nothing at all once the move lands.
    const { from, exit } = aStep();
    const before = stateOf([{ arrow: from, owner: A, heads: 1 }]);
    const move = step(from, exit, 1);
    const real = rules.apply(before, move);
    const strip = (state: GameState): GameState => ({
      ...state,
      groups: new Map([...state.groups].filter(([, g]) => g.owner !== B)),
      territory: new Map([...state.territory].filter(([, o]) => o !== B)),
      trails: new Map([...state.trails].filter(([p]) => p !== B)),
    });

    expect(readStep(rules, before, move, strip(real)).losses).toEqual({
      combat: 0,
      encirclement: 0,
      evaporation: 0,
      vanished: 1,
    });
  });

  it('Turns from first contact to first death count end-turns between them', () => {
    const { from, exit } = aStep();
    const far = pathFrom(from, 30);
    const [touchFrom, touchAt] = [far[20] as ArrowId, far[21] as ArrowId];
    let state = stateOf(
      [
        { arrow: from, owner: A, heads: 3 },
        { arrow: exit, owner: B, heads: 1 },
        { arrow: touchFrom, owner: A, heads: 1 },
      ],
      { trails: { B: [touchAt] } },
    );
    const tally = emptyReach();
    for (const move of [step(touchFrom, touchAt, 1), endTurn(), endTurn(), step(from, exit, 2)]) {
      const after = rules.apply(state, move);
      foldReach(rules, tally, state, move, after);
      state = after;
    }
    const report = reachReport(tally);

    expect(report.firstContact).toEqual({ move: 0, turn: 0 });
    expect(report.firstDeath).toEqual({ move: 3, turn: 2, cause: 'combat' });
    expect(report.contactToDeathTurns).toBe(2);
  });
});
