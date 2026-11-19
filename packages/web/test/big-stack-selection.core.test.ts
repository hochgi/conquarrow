/**
 * P99 core — `docs/spec/big-stack-selection/big-stack-selection.core.feature`.
 *
 * One test per scenario. The outline's three head counts are one table. The
 * component is `buildRouteOffer` / `reachFrom`. The probe is a counting
 * `RulesPort`, not a scripted fetch.
 */

import { describe, expect, it } from 'vitest';
import { reachFrom } from '../src/reach';
import { buildRouteOffer } from '../src/route';
import {
  a0,
  fullCalls,
  geometry,
  goldenWash,
  inputsAt,
  openField,
  paintedWash,
  rules,
  sortedIds,
  tiling,
  walkedArrows,
  washCalls,
} from './big-stack-selection.support';

describe('P99 core — the wash matches the full-reach golden', () => {
  it.each([8, 16, 32])(
    'An open-field wash at %i heads matches the golden',
    (heads) => {
      const state = openField(a0, heads);
      const inputs = inputsAt(tiling, state, a0, heads);
      const offer = buildRouteOffer(inputs);
      const full = reachFrom(geometry, rules, state, a0);
      const golden = goldenWash(full, heads, inputs.tip, offer.clickable, walkedArrows(inputs));

      expect(sortedIds(offer.reachWash)).toEqual(sortedIds(golden));
      expect(offer.reachWash.size).toBeGreaterThan(0);
      expect(sortedIds(paintedWash(offer, a0, heads, inputs.tipHeads))).toEqual(
        sortedIds(offer.reachWash),
      );
    },
    30_000,
  );
});

describe('P99 core — the wash walks only the carry', () => {
  it('A 16-head wash costs less than walking every portion', () => {
    const wash = washCalls(16);
    const full = fullCalls(16);

    expect(wash).toBeGreaterThan(0);
    expect(wash).toBeLessThan(full);
  }, 30_000);

  it('A 32-head wash costs less than a 16-head full reach', () => {
    const wash = washCalls(32);
    const full = fullCalls(16);

    expect(wash).toBeGreaterThan(0);
    expect(wash).toBeLessThan(full);
  }, 60_000);
});
