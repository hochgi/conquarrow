/**
 * P99 edge cases — `docs/spec/big-stack-selection/big-stack-selection.edge-cases.feature`.
 *
 * One test per scenario. Each outline is a table, and every example is asserted.
 * A portion query is compared to the full reach's plans for that portion: the
 * ignored-option skeleton still walks 1..heads, so "the map has no other keys"
 * would fail a characterization the engine already gets right.
 */

import { describe, expect, it } from 'vitest';
import { speed, step } from '@conquarrow/contracts';
import type { ArrowId, GameState } from '@conquarrow/contracts';
import { reachFrom } from '../src/reach';
import type { Reach } from '../src/reach';
import { buildRouteOffer } from '../src/route';
import type { RouteInputs } from '../src/route';
import {
  a0,
  arrowsWithPlan,
  countingRules,
  geometry,
  goldenWash,
  inputsAt,
  openField,
  openingBoard,
  rules,
  sortedIds,
  tiling,
  walkedArrows,
} from './big-stack-selection.support';
import { arrowAlong, exitOf } from './ray-run-input.support';
import type { Board } from './ray-run-input.support';

const SLOW = 60_000;

/** Plans for portion 16, not the map's keys. See the file header. */
const portionPlans = (reach: Reach): readonly ArrowId[] => arrowsWithPlan(reach, 16);

const assertPortionMatchesFull = (state: GameState, from: ArrowId): readonly ArrowId[] => {
  const asked = reachFrom(geometry, rules, state, from, { portion: 16 });
  const full = reachFrom(geometry, rules, state, from);
  const reached = portionPlans(asked);
  expect(sortedIds(reached)).toEqual(sortedIds(portionPlans(full)));
  expect(reached.length).toBeGreaterThan(0);
  const outs = new Set(geometry.outArrows(geometry.target(from)).map(String));
  for (const arrow of reached) {
    expect(asked.get(arrow)?.plans.get(16)?.length, String(arrow)).toBe(1);
    expect(outs.has(String(arrow)), String(arrow)).toBe(true);
  }
  return reached;
};

describe('P99 edge — the wash follows the carry, not the head count', () => {
  it.each([1, 4, 16])(
    'A reduced carry of %i washes that portion, not the whole stack',
    (carry) => {
      const state = openField(a0, 32);
      const inputs = inputsAt(tiling, state, a0, carry);
      expect(inputs.tipHeads).toBe(32);
      expect(inputs.draft).toEqual([]);
      const offer = buildRouteOffer(inputs);
      const atWholeStack = buildRouteOffer(inputsAt(tiling, state, a0, 32));
      const full = reachFrom(geometry, rules, state, a0);
      const walked = walkedArrows(inputs);
      const golden = goldenWash(full, carry, inputs.tip, offer.clickable, walked);
      const goldenWhole = goldenWash(full, 32, inputs.tip, offer.clickable, walked);

      expect(sortedIds(goldenWhole).length).toBeGreaterThan(0);
      expect(sortedIds(offer.reachWash)).toEqual(sortedIds(golden));
      expect(sortedIds(offer.reachWash)).not.toEqual(sortedIds(goldenWhole));
      expect(sortedIds(offer.clickable.keys())).toEqual(sortedIds(atWholeStack.clickable.keys()));
      for (const [arrow, option] of offer.clickable) {
        const other = atWholeStack.clickable.get(arrow);
        expect(other?.kind).toBe(option.kind);
        expect(other?.slot).toBe(option.slot);
        expect(other?.count).toBe(option.count);
        expect(other?.steps.map(String)).toEqual(option.steps.map(String));
      }
    },
    SLOW,
  );

  it('The opening board\'s wash matches the golden at 16 and at 32', () => {
    for (const heads of [16, 32]) {
      const { state, from } = openingBoard(heads);
      const inputs = inputsAt(tiling, state, from, heads);
      expect(inputs.draft, String(heads)).toEqual([]);
      expect(inputs.carry, String(heads)).toBe(heads);
      expect(inputs.tipHeads, String(heads)).toBe(heads);
      const offer = buildRouteOffer(inputs);
      const full = reachFrom(geometry, rules, state, from);
      const golden = goldenWash(full, heads, inputs.tip, offer.clickable, walkedArrows(inputs));

      expect(golden.size, String(heads)).toBeGreaterThan(0);
      expect(sortedIds(offer.reachWash), String(heads)).toEqual(sortedIds(golden));
    }
  }, SLOW);
});

describe('P99 edge — a portion outside 1..heads is not walked', () => {
  it.each([0, -1, 17, 1.5])(
    'An out-of-range portion %s returns an empty reach and calls apply zero times',
    (portion) => {
      const state = openField(a0, 16);
      const counting = countingRules(rules);
      counting.zero();
      const reach = reachFrom(geometry, counting.rules, state, a0, { portion });

      expect(reach.size, `portion ${String(portion)}`).toBe(0);
      expect(counting.calls, `portion ${String(portion)}`).toBe(0);
    },
  );
});

describe('P99 edge — a refused hop is absent from that portion\'s reach', () => {
  it('A full-stack portion does not reach an adjacent enemy the engine refuses', () => {
    const enemy = exitOf(geometry, a0, 0);
    const field = openField(a0, 8);
    const foe = field.players.find((player) => player !== field.activePlayer);
    if (foe === undefined) throw new Error('setup: the open field has no second seat');
    if (field.groups.has(enemy)) throw new Error('setup: the enemy arrow already holds a group');
    const groups = new Map(field.groups);
    groups.set(enemy, { owner: foe, heads: 3, spent: 0 });
    const state: GameState = { ...field, groups };

    expect(() => rules.apply(state, step(a0, enemy, 8))).toThrow();
    expect(() => rules.apply(state, step(a0, enemy, 1))).not.toThrow();
    const full = reachFrom(geometry, rules, state, a0);
    expect(arrowsWithPlan(full, 8).map(String)).not.toContain(String(enemy));
    expect(arrowsWithPlan(full, 1).map(String)).toContain(String(enemy));

    const portion8 = reachFrom(geometry, rules, state, a0, { portion: 8 });
    const portion1 = reachFrom(geometry, rules, state, a0, { portion: 1 });

    expect(portion8.has(enemy), 'portion 8 must not contain the refused enemy arrow').toBe(false);
    expect(portion1.has(enemy)).toBe(true);
    expect(sortedIds(portion8.keys())).toEqual(sortedIds(arrowsWithPlan(full, 8)));
    expect(sortedIds(portion1.keys())).toEqual(sortedIds(arrowsWithPlan(full, 1)));
  });
});

describe('P99 edge — allowance left is the engine\'s', () => {
  it('A stack with one step left reaches only what apply accepts', () => {
    const field = openField(a0, 16);
    const group = field.groups.get(a0);
    if (group === undefined) throw new Error('setup: the open field has no stack');
    const spent = speed(16) - 1;
    expect(spent).toBeGreaterThanOrEqual(0);
    const groups = new Map(field.groups);
    groups.set(a0, { owner: group.owner, heads: group.heads, spent });
    const state: GameState = { ...field, groups };
    const two = arrowAlong(geometry, a0, 0, 2);
    expect(geometry.outArrows(geometry.target(a0)).includes(two)).toBe(false);

    const reached = assertPortionMatchesFull(state, a0);

    expect(reached.map(String)).not.toContain(String(two));
  });

  it('A speed override of 1 caps the portion walk as it caps the full walk', () => {
    const field = openField(a0, 16);
    const group = field.groups.get(a0);
    if (group === undefined) throw new Error('setup: the open field has no stack');
    const groups = new Map(field.groups);
    groups.set(a0, {
      owner: group.owner,
      heads: group.heads,
      spent: group.spent,
      speedOverride: 1,
    });
    const state: GameState = { ...field, groups };

    assertPortionMatchesFull(state, a0);
  });
});

describe('P99 edge — the short-circuit stays', () => {
  it('A carry below 1 paints an empty wash and does not walk a reach', () => {
    const state = openField(a0, 16);
    const counting = countingRules(rules);
    const probed: Board = { geometry, rules: counting.rules };

    counting.zero();
    const atZero = buildRouteOffer(inputsAt(probed, state, a0, 0));
    const zeroCalls = counting.calls;
    counting.zero();
    const atNegative = buildRouteOffer(inputsAt(probed, state, a0, -1));
    const negativeCalls = counting.calls;
    counting.zero();
    buildRouteOffer(inputsAt(probed, state, a0, 16));
    const fullOfferCalls = counting.calls;

    expect(atZero.reachWash.size).toBe(0);
    expect(atNegative.reachWash.size).toBe(0);
    expect(zeroCalls).toBe(negativeCalls);
    expect(zeroCalls).toBeLessThan(fullOfferCalls);
  }, 30_000);

  it('A terminal tip paints an empty wash and does not walk a reach', () => {
    const state = openField(a0, 16);
    const counting = countingRules(rules);
    const probed: Board = { geometry, rules: counting.rules };
    const inputs: RouteInputs = {
      ...inputsAt(probed, state, a0, 16),
      terminal: true,
    };
    expect(inputs.draft).toEqual([]);
    expect(inputs.lastRun).toBeUndefined();

    counting.zero();
    const offer = buildRouteOffer(inputs);

    expect(offer.reachWash.size).toBe(0);
    expect(offer.clickable.size).toBe(0);
    expect(counting.calls).toBe(0);
  });
});

describe('P99 edge — the full walk and the empty tip stay', () => {
  it('Asking reachFrom with no portion still prices every portion', () => {
    const state = openField(a0, 8);
    const reach = reachFrom(geometry, rules, state, a0);
    let farthest = 0;
    for (const entry of reach.values()) {
      if (entry.distance > farthest) farthest = entry.distance;
    }
    const near = [...reach.values()].filter((entry) => entry.distance === 1);
    const atSpeed = [...reach.values()].filter((entry) => entry.distance === speed(8));

    expect(farthest).toBe(speed(8));
    expect(near.length).toBeGreaterThan(0);
    for (const entry of near) expect(entry.maxCount).toBe(8);
    expect(atSpeed.length).toBeGreaterThan(0);
    expect(atSpeed.some((entry) => entry.plans.has(8))).toBe(true);
  });

  it('A portion query on an arrow the active player does not hold is empty', () => {
    const state = openField(a0, 8);
    const empty = exitOf(geometry, a0, 0);
    expect(state.groups.has(empty)).toBe(false);
    const counting = countingRules(rules);
    counting.zero();
    const queried = reachFrom(geometry, counting.rules, state, empty, { portion: 4 });
    const bare = reachFrom(geometry, counting.rules, state, empty);

    expect(queried.size).toBe(0);
    expect(bare.size).toBe(0);
    expect(counting.calls).toBe(0);
  });
});

describe('P99 edge — no cache, and the louder tiers stay louder', () => {
  it('A second identical offer costs the same number of apply calls', () => {
    const state = openField(a0, 32);
    const counting = countingRules(rules);
    const probed: Board = { geometry, rules: counting.rules };
    const inputs = inputsAt(probed, state, a0, 32);

    counting.zero();
    const first = buildRouteOffer(inputs);
    const firstCalls = counting.calls;
    counting.zero();
    const second = buildRouteOffer(inputs);

    expect(firstCalls).toBeGreaterThan(0);
    expect(sortedIds(first.reachWash)).toEqual(sortedIds(second.reachWash));
    expect(counting.calls).toBe(firstCalls);
  }, SLOW);

  it('A clickable arrow is not in the wash', () => {
    const state = openField(a0, 16);
    const inputs = inputsAt(tiling, state, a0, 16);
    const offer = buildRouteOffer(inputs);
    const portion = reachFrom(geometry, rules, state, a0, { portion: 16 });

    expect(offer.reachWash.size).toBeGreaterThan(0);
    for (const arrow of offer.clickable.keys()) {
      expect(offer.reachWash.has(arrow), String(arrow)).toBe(false);
    }
    expect(offer.reachWash.has(a0)).toBe(false);
    for (const arrow of offer.reachWash) {
      expect(portion.has(arrow), String(arrow)).toBe(true);
    }
  }, 30_000);
});
