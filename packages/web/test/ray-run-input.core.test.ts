/**
 * P34 core scenarios — `docs/spec/ray-run-input/ray-run-input.core.feature`.
 *
 * One test per scenario. Scenarios about the *content* of the offer go through
 * the pure helper (`buildRouteOffer`), which is what the spec's pseudocode
 * declares; scenarios about the *state machine* go through the input mode. The
 * invariants suite ties the two together.
 *
 * Eight heads walk four steps (§3, `speed(8) = 4`), so on the open field the
 * offer is 3 + 9 + 9 + 9 = 30 arrows: 12 ray arrows and 18 turn arrows. The turns
 * off the *last* ray arrow are not offered — they would be a fifth step, and the
 * engine refuses it. That is measured here rather than assumed.
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import type { ArrowId, GameState, PlayerId } from '@conquarrow/contracts';
import {
  ROUTE_HINT_DRAFTED,
  ROUTE_HINT_EMPTY,
  ROUTE_HINT_FINISHED,
  buildRouteOffer,
  routeHint,
  routePaint,
} from '../src/route';
import {
  A,
  B,
  alongSlots,
  arrowAlong,
  blankState,
  clickArrow,
  clickableOf,
  draftClicks,
  draftOf,
  exitOf,
  exitsOf,
  geometry,
  headsOn,
  inputsAfter,
  inputsAt,
  legalSeats,
  makeMode,
  openField,
  pendingOf,
  rayOf,
  raySlotWalk,
  reachForCarry,
  routePhaseOf,
  rules,
  selectOpenField,
  selectRoute,
  shortestRoutes,
  sortedIds,
  sourceArrow,
  walkSteps,
} from './ray-run-input.support';

const board = { geometry, rules };
const from = sourceArrow(geometry);
const SLOTS = [0, 1, 2] as const;

/** Eight heads walk four steps. */
const HEADS = 8;

/**
 * Twelve heads walk four steps **with a count still to choose**.
 *
 * **Revised by P35.** A four step click off eight heads is now
 * `2^(k-1)` walking `k`: one legal count, a spent allowance, and therefore an
 * *auto-apply* (`count-after-route.md`, *Auto-apply — the exact test*). The four
 * step scenarios below are about drafting and popping, not about that rule, so
 * they take a stack whose count is not forced. Twelve keeps `speed(12) = 4`, so
 * the route is the same four arrows.
 */
const DRAFTS_FOUR = 12;

const offerAt = (state: GameState, carry: number) =>
  buildRouteOffer(inputsAt(board, state, from, carry));

describe('P34 core — selecting a stack opens the route phase with an empty draft', () => {
  it('Clicking an own stack enters the route phase', () => {
    const state = openField(from, HEADS);
    const before = openField(from, HEADS);
    const { phase } = selectRoute(board, state, from);
    expect(phase.kind).toBe('route');
    expect(phase.draft).toHaveLength(0);
    expect(phase.tip).toBe(from);
    // Nothing applied: the board the click was made against is untouched.
    expect(state).toEqual(before);
  });

  it('The carry defaults to every head on the source', () => {
    const { phase } = selectOpenField(HEADS);
    expect(phase.carry).toBe(HEADS);
    expect(phase.tipHeads).toBe(HEADS);
  });

  it('A stack with nothing clickable reports blocked', () => {
    const stuck = arrowAlong(geometry, from, 1, 4);
    const territory = new Map<ArrowId, PlayerId>();
    for (const exit of geometry.outArrows(geometry.target(stuck))) territory.set(exit, B);
    const state: GameState = legalSeats({
      ...blankState(),
      groups: new Map([[stuck, { owner: A, heads: 4, spent: 0 }]]),
      territory,
    });
    const snap = makeMode(board).onArrowClick(stuck, state, rules);
    expect(snap.phase.kind).toBe('blocked');
    expect(snap.refusal?.reason).toBe('no-exit');
    expect(pendingOf(snap)).toHaveLength(0);
  });

  it('Clicking an arrow that is not the active player’s refuses', () => {
    const theirs = arrowAlong(geometry, from, 2, 3);
    const state: GameState = legalSeats({
      ...blankState(),
      groups: new Map([
        [from, { owner: A, heads: HEADS, spent: 0 }],
        [theirs, { owner: B, heads: 3, spent: 0 }],
      ]),
    });
    const snap = makeMode(board).onArrowClick(theirs, state, rules);
    expect(snap.refusal?.arrow).toBe(theirs);
    expect(snap.refusal?.reason).toBe('not-yours');
    expect(snap.phase.kind).toBe('idle');
  });
});

describe('P34 core — the three rays are the primary offer', () => {
  it('Three rays are offered from the tip', () => {
    const offer = offerAt(openField(from, HEADS), HEADS);
    expect(offer.rays).toHaveLength(3);
    for (const slot of SLOTS) {
      const ray = offer.rays[slot] ?? [];
      expect(ray.length, `slot ${String(slot)}`).toBeGreaterThan(0);
      const head = ray[0];
      if (head === undefined) continue;
      expect(offer.clickable.get(head)?.kind).toBe('ray');
      expect(offer.clickable.get(head)?.slot).toBe(slot);
    }
  });

  it('A ray follows one slot repeatedly', () => {
    const offer = offerAt(openField(from, HEADS), HEADS);
    for (const slot of SLOTS) {
      const ray = offer.rays[slot] ?? [];
      expect(ray.length, `slot ${String(slot)}`).toBeGreaterThan(0);
      expect(ray.map(String)).toEqual(raySlotWalk(geometry, from, slot, ray.length).map(String));
    }
  });

  it('Every ray arrow is clickable', () => {
    const offer = offerAt(openField(from, HEADS), HEADS);
    let seen = 0;
    for (const slot of SLOTS) {
      const ray = offer.rays[slot] ?? [];
      for (let m = 0; m < ray.length; m += 1) {
        const arrow = ray[m];
        if (arrow === undefined) continue;
        const option = offer.clickable.get(arrow);
        expect(option?.kind, `slot ${String(slot)} step ${String(m + 1)}`).toBe('ray');
        expect(option?.slot).toBe(slot);
        expect(option?.steps).toHaveLength(m + 1);
        seen += 1;
      }
    }
    expect(seen).toBe(12);
  });

  it('A turn arrow is offered off every ray arrow', () => {
    const state = openField(from, HEADS);
    const offer = offerAt(state, HEADS);
    let offered = 0;
    for (const slot of SLOTS) {
      const ray = offer.rays[slot] ?? [];
      for (let m = 0; m < ray.length; m += 1) {
        const rayArrow = ray[m];
        if (rayArrow === undefined) continue;
        const prefix = walkSteps(board, state, from, ray.slice(0, m + 1), HEADS);
        for (const turnSlot of SLOTS) {
          if (turnSlot === slot) continue;
          const turnArrow = exitOf(geometry, rayArrow, turnSlot);
          // Measured, not derived: the turn is offered iff the engine takes it.
          let accepted = true;
          try {
            rules.apply(prefix.state, step(rayArrow, turnArrow, HEADS));
          } catch {
            accepted = false;
          }
          const option = offer.clickable.get(turnArrow);
          const where = `turn ${String(turnSlot)} off slot ${String(slot)}@${String(m + 1)}`;
          if (!accepted) continue;
          expect(option, where).toBeDefined();
          expect(option?.kind, where).toBe('turn');
          expect(option?.slot, where).toBe(slot);
          expect(option?.steps, where).toHaveLength(m + 2);
          offered += 1;
        }
      }
    }
    // Three slots × three ray arrows with a step left × two turns.
    expect(offered).toBe(18);
  });

  it('Nine arrows are clickable at each distance of two or more', () => {
    const offer = offerAt(openField(from, HEADS), HEADS);
    const byDistance = new Map<number, number>();
    for (const option of offer.clickable.values()) {
      byDistance.set(option.steps.length, (byDistance.get(option.steps.length) ?? 0) + 1);
    }
    expect(byDistance.get(2)).toBe(9);
    expect(byDistance.get(3)).toBe(9);
    expect(byDistance.get(4)).toBe(9);
  });

  it('Every arrow within two steps is clickable', () => {
    const state = openField(from, HEADS);
    const offer = offerAt(state, HEADS);
    const counts = shortestRoutes(board, state, from, HEADS);
    const near = [...counts.entries()]
      .filter(([, count]) => count.distance <= 2)
      .map(([arrow]) => arrow);
    expect(near).toHaveLength(12);
    expect(sortedIds(near.filter((arrow) => !offer.clickable.has(arrow)))).toEqual([]);
  });
});

describe('P34 core — a click appends a run to the draft', () => {
  it('Clicking a ray arrow appends that whole run', () => {
    const state = openField(from, HEADS);
    const before = openField(from, HEADS);
    const selected = selectRoute(board, state, from);
    const target = arrowAlong(geometry, from, 0, 3);
    const snap = clickArrow(selected, target);
    const draft = draftOf(snap);
    expect(draft).toHaveLength(3);
    expect(draft.every((move) => move.kind === 'step')).toBe(true);
    expect(exitsOf(draft).map(String)).toEqual(raySlotWalk(geometry, from, 0, 3).map(String));
    expect(routePhaseOf(snap).tip).toBe(target);
    expect(state).toEqual(before);
    expect(pendingOf(snap)).toHaveLength(0);
  });

  it('Clicking a turn arrow appends the run and the turn', () => {
    const selected = selectOpenField(HEADS);
    const turn = alongSlots(geometry, from, [0, 0, 1]);
    const snap = clickArrow(selected, turn);
    const exits = exitsOf(draftOf(snap));
    expect(exits).toHaveLength(3);
    expect(exits.slice(0, 2).map(String)).toEqual(raySlotWalk(geometry, from, 0, 2).map(String));
    expect(String(exits[2])).toBe(String(turn));
  });

  it('A second click extends from the new tip', () => {
    const selected = selectOpenField(HEADS);
    const first = arrowAlong(geometry, from, 0, 2);
    clickArrow(selected, first);
    const second = arrowAlong(geometry, first, 1, 2);
    const snap = clickArrow(selected, second);
    expect(draftOf(snap)).toHaveLength(4);
    expect(routePhaseOf(snap).tip).toBe(second);
    const exits = exitsOf(draftOf(snap));
    expect(String(exits[exits.length - 1])).toBe(String(second));
  });

  it('A straight route of any length is one click', () => {
    const selected = selectOpenField(DRAFTS_FOUR);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, 4));
    expect(draftOf(snap)).toHaveLength(4);
  });

  it('A dogleg route is two clicks', () => {
    const selected = selectOpenField(HEADS);
    const corner = arrowAlong(geometry, from, 0, 2);
    const snap = draftClicks(selected, [corner, arrowAlong(geometry, corner, 1, 2)]);
    expect(draftOf(snap)).toHaveLength(4);
  });

  it('The carry travels with every move of the run', () => {
    const selected = selectOpenField(HEADS);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, 3));
    const draft = draftOf(snap);
    expect(draft).toHaveLength(3);
    for (const move of draft) {
      expect(move.kind).toBe('step');
      if (move.kind !== 'step') continue;
      expect(move.count).toBe(HEADS);
    }
  });
});

describe('P34 core — nothing is applied until Send', () => {
  it('Send emits the draft as pending', () => {
    const selected = selectOpenField(HEADS);
    const drafted = clickArrow(selected, arrowAlong(geometry, from, 0, 3));
    const draft = [...draftOf(drafted)];
    const sent = selected.mode.send();
    expect(pendingOf(sent)).toEqual(draft);
    expect(pendingOf(sent)).toHaveLength(3);
    expect(sent.phase.kind).toBe('idle');
  });

  it('Cancel applies nothing', () => {
    const state = openField(from, HEADS);
    const before = openField(from, HEADS);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, arrowAlong(geometry, from, 0, 3));
    const cancelled = selected.mode.cancel();
    expect(pendingOf(cancelled)).toHaveLength(0);
    expect(cancelled.phase.kind).toBe('idle');
    expect(state).toEqual(before);
  });

  it('A background click discards the draft', () => {
    const selected = selectOpenField(HEADS);
    clickArrow(selected, arrowAlong(geometry, from, 0, 2));
    const snap = selected.mode.onBackgroundClick();
    expect(pendingOf(snap)).toHaveLength(0);
    expect(snap.phase.kind).toBe('idle');
  });

  it('The game state is untouched while drafting', () => {
    const state = openField(from, DRAFTS_FOUR);
    const before = openField(from, DRAFTS_FOUR);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, 4));
    expect(draftOf(snap)).toHaveLength(4);
    expect(state).toEqual(before);
  });
});

describe('P34 core — clicking a walked arrow pops the draft back to it', () => {
  const draftFour = () => {
    const selected = selectOpenField(DRAFTS_FOUR);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, 4));
    return { selected, snap, second: arrowAlong(geometry, from, 0, 2) };
  };

  it('Popping truncates the draft', () => {
    const { selected, second } = draftFour();
    const popped = clickArrow(selected, second);
    expect(draftOf(popped)).toHaveLength(2);
    expect(routePhaseOf(popped).tip).toBe(second);
  });

  it('Popping keeps every move before the clicked arrow', () => {
    const { selected, snap, second } = draftFour();
    const original = [...draftOf(snap)];
    const popped = clickArrow(selected, second);
    expect(draftOf(popped)).toEqual(original.slice(0, 2));
  });

  it('Popping repaints the rays from the restored tip', () => {
    const { selected, second } = draftFour();
    const popped = clickArrow(selected, second);
    const expected = buildRouteOffer(
      inputsAfter(board, selected.state, from, raySlotWalk(geometry, from, 0, 2), DRAFTS_FOUR),
    );
    expect(sortedIds(clickableOf(popped).keys())).toEqual(sortedIds(expected.clickable.keys()));
    for (const slot of SLOTS) {
      expect(rayOf(popped, slot).map(String)).toEqual((expected.rays[slot] ?? []).map(String));
    }
  });

  it('Popping to the source leaves an empty draft, still in route', () => {
    const selected = selectOpenField(HEADS);
    clickArrow(selected, arrowAlong(geometry, from, 0, 2));
    const popped = clickArrow(selected, from);
    expect(draftOf(popped)).toHaveLength(0);
    expect(popped.phase.kind).toBe('route');
    expect(routePhaseOf(popped).tip).toBe(from);
  });

  // @superseded-P77: clicking the selected stack re-selects it (draft cleared,
  // still selected). Deselect is a background click, Escape / Cancel, or the
  // Next stack lap's *none* step. docs/spec/board-selection-model.
  it('Clicking the source with an empty draft keeps it selected (P77)', () => {
    const selected = selectOpenField(HEADS);
    expect(selected.phase.draft).toHaveLength(0);
    const snap = clickArrow(selected, from);
    expect(snap.phase.kind).toBe('route');
    expect(snap.highlights.selected).toBe(from);
    expect(draftOf(snap)).toHaveLength(0);
  });
});

/**
 * **Revised by P35.** P34 chose the carry *before* the click, so these four
 * scenarios drove `setCarry` on an empty draft and read the rays it shortened.
 * P35 repeals that: with an empty draft there is nothing to count
 * (`offer.carries` is empty and the control is absent), and the count edits the
 * run **behind** the click. The scenarios are kept, in their new order — click,
 * then count — because what they are about is unchanged: heads buy distance, and
 * the heads left behind are the sentry (§5).
 */
describe('P34 core — the carry repaints the rays (P35: chosen after the click)', () => {
  it('Lowering the carry shortens the rays', () => {
    const selected = selectOpenField(HEADS);
    const drafted = clickArrow(selected, arrowAlong(geometry, from, 0, 1));
    const full = SLOTS.map((slot) => rayOf(drafted, slot).length);
    const lowered = selected.mode.setCarry(2);
    for (const slot of SLOTS) {
      expect(rayOf(lowered, slot).length, `slot ${String(slot)}`).toBeLessThan(full[slot] ?? 0);
    }
  });

  it('Raising the carry lengthens the rays', () => {
    const selected = selectOpenField(HEADS);
    clickArrow(selected, arrowAlong(geometry, from, 0, 1));
    const lowered = selected.mode.setCarry(2);
    const short = SLOTS.map((slot) => rayOf(lowered, slot).length);
    const raised = selected.mode.setCarry(HEADS);
    for (const slot of SLOTS) {
      expect(rayOf(raised, slot).length, `slot ${String(slot)}`).toBeGreaterThan(short[slot] ?? 0);
    }
  });

  it('Only carries that can move are offerable', () => {
    const selected = selectOpenField(HEADS);
    // P35: nothing is offered before a destination exists.
    expect(selected.phase.offer.carries).toEqual([]);
    const drafted = clickArrow(selected, arrowAlong(geometry, from, 0, 1));
    const { carries } = routePhaseOf(drafted).offer;
    expect(carries.length).toBeGreaterThan(0);
    for (const carry of carries) {
      const hops = geometry.outArrows(geometry.target(from)).filter((exit) => {
        try {
          rules.apply(selected.state, step(from, exit, carry));
          return true;
        } catch {
          return false;
        }
      });
      expect(hops.length, `carry ${String(carry)}`).toBeGreaterThan(0);
    }
  });

  it('Heads not carried stay behind as a sentry', () => {
    const state = openField(from, 12);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, arrowAlong(geometry, from, 0, 2));
    selected.mode.setCarry(8);
    const sent = pendingOf(selected.mode.send());
    expect(sent).toHaveLength(2);
    for (const move of sent) {
      expect(move.kind).toBe('step');
      if (move.kind !== 'step') continue;
      expect(move.count).toBe(8);
    }
    let applied = state;
    for (const move of sent) applied = rules.apply(applied, move);
    expect(headsOn(applied, from)).toBe(4);
  });

  it('A new tip defaults its carry to the heads standing there', () => {
    const state = openField(from, 12);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, arrowAlong(geometry, from, 0, 1));
    selected.mode.setCarry(8);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, 2));
    expect(routePhaseOf(snap).carry).toBe(8);
    expect(routePhaseOf(snap).tipHeads).toBe(8);
  });
});

describe('P34 core — paint reads draft loudest, rays primary, reach faintest', () => {
  it('The three tiers are disjoint', () => {
    const selected = selectOpenField(HEADS);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, 2));
    const phase = routePhaseOf(snap);
    const paint = routePaint({ phase, pointer: 'fine' });
    const tiers: readonly (readonly [string, ReadonlySet<ArrowId>])[] = [
      ['draft', new Set(paint.draftArrows)],
      ['ray', paint.rayArrows],
      ['turn', paint.turnArrows],
      ['reach', paint.reachWash],
    ];
    expect(paint.rayArrows.size).toBeGreaterThan(0);
    expect(paint.draftArrows).toHaveLength(2);
    for (const [leftName, left] of tiers) {
      for (const [rightName, right] of tiers) {
        if (leftName === rightName) continue;
        const shared = [...left].filter((arrow) => right.has(arrow));
        expect(sortedIds(shared), `${leftName} and ${rightName} overlap`).toEqual([]);
      }
    }
    // The tip belongs to no *offer* tier — it is where the run starts, not
    // somewhere to click. It is the last arrow the draft walks, though, so the
    // draft tier does contain it: `The draft is painted as walked` pins
    // `draftArrows` to every arrow the draft walks, in order, and the spec's paint
    // block says the same. The tip's own mark (`paint.tip`) sits on top of it.
    for (const [name, tier] of tiers) {
      if (name === 'draft') continue;
      expect(tier.has(phase.tip), `tip painted as ${name}`).toBe(false);
    }
  });

  it('The draft is painted as walked', () => {
    const selected = selectOpenField(HEADS);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, 3));
    const paint = routePaint({ phase: routePhaseOf(snap), pointer: 'fine' });
    expect(paint.draftArrows.map(String)).toEqual(exitsOf(draftOf(snap)).map(String));
  });

  it('Turn arrows are subordinate to their rays', () => {
    const selected = selectOpenField(HEADS);
    const paint = routePaint({ phase: selected.phase, pointer: 'fine' });
    expect(paint.rayArrows.size).toBe(12);
    expect(paint.turnArrows.size).toBe(18);
    const shared = [...paint.rayArrows].filter((arrow) => paint.turnArrows.has(arrow));
    expect(sortedIds(shared)).toEqual([]);
  });

  it('The reach wash carries what is reachable but not clickable', () => {
    const selected = selectOpenField(HEADS);
    const paint = routePaint({ phase: selected.phase, pointer: 'fine' });
    const clickable = clickableOf(selected.snap);
    const expected = [...reachForCarry(board, selected.state, from, HEADS)].filter(
      (arrow) => !clickable.has(arrow) && arrow !== selected.phase.tip,
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(sortedIds(paint.reachWash)).toEqual(sortedIds(expected));
  });

  it('Hovering a clickable arrow previews what it would offer', () => {
    const selected = selectOpenField(HEADS);
    const walk = raySlotWalk(geometry, from, 0, 2);
    const hovered = arrowAlong(geometry, from, 0, 2);
    const paint = routePaint({ phase: selected.phase, pointer: 'fine', hoverArrow: hovered });
    const after = walkSteps(board, selected.state, from, walk, HEADS);
    const counts = shortestRoutes(
      board,
      after.state,
      hovered,
      HEADS,
      new Set([from, ...walk.slice(0, -1)]),
    );
    const unique = [...counts.entries()]
      .filter(([, count]) => count.routes === 1)
      .map(([arrow]) => arrow);
    expect(unique.length).toBeGreaterThan(0);
    expect(sortedIds(paint.hoverPreview)).toEqual(sortedIds(unique));
    // A coarse pointer discloses nothing: every clickable arrow is unambiguous.
    const coarse = routePaint({ phase: selected.phase, pointer: 'coarse', hoverArrow: hovered });
    expect(coarse.hoverPreview.size).toBe(0);
  });

  // Hint strings: P77's normative copy (board-selection-model *Route hints*).
  it('The route phase hint names extend, go back, and send', () => {
    const selected = selectOpenField(HEADS);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, 2));
    expect(routeHint(routePhaseOf(snap))).toBe(
      'Click to extend · click a walked arrow to go back · Send to move',
    );
    expect(ROUTE_HINT_DRAFTED).toBe(
      'Click to extend · click a walked arrow to go back · Send to move',
    );
  });

  it('A tip with nothing clickable says the run can go no further', () => {
    // A 3-stack has speed 2, so a two-step run spends the lot: the tip is live
    // (not terminal) but has no hop left, and "click to extend" would be a lie.
    const selected = selectOpenField(3);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, 2));
    const phase = routePhaseOf(snap);
    expect(phase.draft).toHaveLength(2);
    expect(phase.offer.clickable.size).toBe(0);
    expect(routeHint(phase)).toBe(
      'This run can go no further · click a walked arrow to go back · Send to move',
    );
    expect(ROUTE_HINT_FINISHED).toBe(
      'This run can go no further · click a walked arrow to go back · Send to move',
    );
  });

  it('The empty draft hint names the ray and the free turn', () => {
    const selected = selectOpenField(HEADS);
    expect(selected.phase.draft).toHaveLength(0);
    expect(routeHint(selected.phase)).toBe(
      'Click a lit arrow to draft a run · one turn at the end is free · dashed = needs more than one run',
    );
    expect(ROUTE_HINT_EMPTY).toBe(
      'Click a lit arrow to draft a run · one turn at the end is free · dashed = needs more than one run',
    );
  });
});
