/**
 * P99 invariants — the EARS lines in
 * `docs/spec/big-stack-selection/big-stack-selection.md` that are not already
 * the body of a scenario.
 *
 * The other eleven are the scenarios:
 * 1, 7, 8 — core cost (the wash walks that carry alone).
 * 2 — core golden, reduced carry, opening board.
 * 3 — no-portion reach still prices every portion.
 * 4 — out-of-range portion.
 * 5 — carry below 1, and a terminal tip.
 * 6 — a refused hop is absent from that portion's reach.
 * 9 — a second identical offer.
 * 12 — a speed override caps the portion walk.
 * 13 — the clickable set does not shrink when the carry drops.
 *
 * No replay fixture: this packet does not touch turn flow.
 */

import { describe, expect, it } from 'vitest';
import { speed } from '@conquarrow/contracts';
import type { ArrowId } from '@conquarrow/contracts';
import type { RoutePhase } from '../src/input/modes';
import { reachFrom } from '../src/reach';
import { buildRouteOffer, routePaint } from '../src/route';
import {
  a0,
  countingRules,
  geometry,
  inputsAt,
  openField,
  rules,
  tiling,
} from './big-stack-selection.support';
import { refusingRules } from './ray-run-input.support';
import type { Board } from './ray-run-input.support';

describe('P99 invariants — not already a scenario', () => {
  it('While painting a hover from an offer already built, the system shall not call rules.apply', () => {
    const counting = countingRules(rules);
    const probed: Board = { geometry, rules: counting.rules };
    const state = openField(a0, 8);
    const offer = buildRouteOffer(inputsAt(probed, state, a0, 8));
    expect(offer.clickable.size).toBeGreaterThan(0);
    const phase: RoutePhase = {
      kind: 'route',
      from: a0,
      tip: offer.tip,
      carry: 8,
      tipHeads: 8,
      draft: [],
      runLengths: [],
      offer,
    };

    counting.zero();
    let painted = 0;
    for (const hoverArrow of offer.clickable.keys()) {
      const paint = routePaint({ phase, pointer: 'fine', hoverArrow });
      if (paint.hoverPreview.size > 0) painted += 1;
    }

    expect(painted).toBeGreaterThan(0);
    expect(counting.calls).toBe(0);
  });

  it('The system shall not derive a wash hop from speed in place of rules.apply', () => {
    const state = openField(a0, 16);
    const offer = buildRouteOffer(inputsAt(tiling, state, a0, 16));
    expect(offer.reachWash.size).toBeGreaterThan(0);
    const full = reachFrom(geometry, rules, state, a0);
    let blocked: ArrowId | undefined;
    let distance = 0;
    for (const arrow of offer.reachWash) {
      const entry = full.get(arrow);
      if (entry === undefined || entry.distance <= distance) continue;
      distance = entry.distance;
      blocked = arrow;
    }
    if (blocked === undefined) throw new Error('setup: no wash arrow is in the full reach');
    // A speed derivation of depth speed(16) would still include this arrow.
    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThanOrEqual(speed(16));

    const stubborn: Board = {
      geometry,
      rules: refusingRules(rules, (move) => move.exit === blocked),
    };
    const refused = buildRouteOffer(inputsAt(stubborn, state, a0, 16));

    expect(refused.reachWash.has(blocked)).toBe(false);
  }, 30_000);
});
