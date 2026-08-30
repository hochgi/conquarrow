/**
 * P35 edge cases — `docs/spec/count-after-route/count-after-route.edge-cases.feature`.
 *
 * One test per scenario, in feature order.
 *
 * The attack scenarios are the ones phase 1 corrected after this suite kicked
 * them back: *full strength* is the **largest count that walks the run**, not
 * every head, so an adjacent enemy arrow is clickable and its run drafts at
 * `heads - 1` (§6.2's stay-behind). The count control is therefore what arms an
 * attack, now that lowering the carry before the click is gone.
 *
 * Multi-run fixtures carry 16 heads and take their counts from the oracle rather
 * than from a literal, because `spent` travels with the movers: a second run of
 * two steps off a tip that has spent two needs 8, not 2.
 *
 * No test here asserts a one-run draft with a forced count and a *live* tip.
 * That state is unreachable — one legal count for a `k` step run means the
 * ceiling is `2^(k-1)`, so the allowance is exactly spent — and the spec says in
 * so many words not to assert it. *An unreachable auto-apply state is not
 * asserted* pins the implication instead.
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import type { GameState } from '@conquarrow/contracts';
import { refusedConvertExits } from '../src/refusedConvert';
import { autoApplies, buildRouteOffer, clickableSet, routePaint } from '../src/route';
import {
  A,
  B,
  acceptedRunLength,
  alongSlots,
  applyOnce,
  arrowAlong,
  carriesOf,
  clickArrow,
  clickRuns,
  clickableOf,
  controlOf,
  controlShown,
  countingRules,
  countsOf,
  countsThatWalk,
  draftOf,
  exitsOf,
  geometry,
  headsOn,
  inputsAt,
  lastRunLengthOf,
  leastCountThatWalks,
  makeMode,
  openField,
  pendingOf,
  rayOf,
  raySlotWalk,
  readSource,
  refusedConvertFixture,
  routePhaseOf,
  rules,
  runInputs,
  runLengthsOf,
  selectOpenField,
  selectRoute,
  sortedIds,
  sourceArrow,
  stateWith,
  walkSteps,
} from './count-after-route.support';

const board = { geometry, rules };
const from = sourceArrow(geometry);
const first = arrowAlong(geometry, from, 0, 1);
const second = arrowAlong(geometry, from, 0, 2);
const third = arrowAlong(geometry, from, 0, 3);

describe('P35 edge — the floor tracks the distance the run actually covers', () => {
  // Twenty-four heads, not sixteen: five steps out of *sixteen* is the allowance
  // exactly, so the floor would *be* the ceiling and the click would auto-apply
  // (invariant 11's `2^(k-1)` walking `k`) — leaving no draft whose floor to read.
  // `speed(24) = 5` walks the same five arrows with a count still to choose, so
  // every row of this table stays a drafted run and the claim is read the same way
  // at all five lengths. Auto-apply has its own scenarios.
  const FLOORS = 24;

  it.each([1, 2, 3, 4, 5])('The floor at run length %i', (steps) => {
    const state = openField(from, FLOORS);
    const selected = selectRoute(board, state, from);
    const run = raySlotWalk(geometry, from, 0, steps);
    const snap = clickArrow(selected, arrowAlong(geometry, from, 0, steps));
    expect(exitsOf(draftOf(snap)).map(String), `run of ${String(steps)}`).toEqual(
      run.map(String),
    );
    expect(carriesOf(snap)[0]).toBe(leastCountThatWalks(rules, state, from, run));
  });

  it('A one-step run floors at one head', () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, first);
    expect(leastCountThatWalks(rules, state, from, [first])).toBe(1);
    expect(carriesOf(snap)[0]).toBe(1);
  });

  it("A truncated ray's floor is read from the run it actually offers", () => {
    const state = stateWith([
      [from, { owner: A, heads: 16 }],
      [third, { owner: B, heads: 2 }],
    ]);
    const selected = selectRoute(board, state, from);
    // The ray ends before the enemy (§6.2 stay-behind, P34), so the run is two.
    expect(rayOf(selected.snap, 0)).toHaveLength(2);
    const snap = clickArrow(selected, second);
    expect(carriesOf(snap)[0]).toBe(
      leastCountThatWalks(rules, state, from, raySlotWalk(geometry, from, 0, 2)),
    );
    expect(carriesOf(snap)[0]).toBe(2);
  });

  it("A turn arrow's floor counts the turn as a step", () => {
    const state = openField(from, 16);
    const selected = selectRoute(board, state, from);
    const turn = alongSlots(geometry, from, [0, 0, 1]);
    const snap = clickArrow(selected, turn);
    const run = [...raySlotWalk(geometry, from, 0, 2), turn];
    expect(draftOf(snap)).toHaveLength(3);
    expect(carriesOf(snap)[0]).toBe(leastCountThatWalks(rules, state, from, run));
    expect(carriesOf(snap)[0]).toBe(4);
  });
});

describe('P35 edge — a terminal run still gets its count, and nothing more', () => {
  const mergeState = (): GameState =>
    stateWith([
      [from, { owner: A, heads: 8 }],
      [second, { owner: A, heads: 3 }],
    ]);

  const closureState = (): GameState =>
    stateWith([[from, { owner: A, heads: 8 }]], {
      territory: new Map([
        [from, A],
        [second, A],
      ]),
      trails: new Map([[A, new Set([from])]]),
    });

  it('A run ending in a merge offers a count and no extension', () => {
    const selected = selectRoute(board, mergeState(), from);
    const snap = clickArrow(selected, second);
    expect(controlShown(snap)).toBe(true);
    expect(clickableOf(snap).size).toBe(0);
  });

  it('A merge does not auto-apply even though the tip is finished', () => {
    const state = mergeState();
    const untouched = mergeState();
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, second);
    // Not forced: seven counts walk a two step run out of eight heads.
    expect(carriesOf(snap).length).toBeGreaterThan(1);
    expect(pendingOf(snap)).toHaveLength(0);
    expect(snap.phase.kind).toBe('route');
    expect(state).toEqual(untouched);
  });

  it('A run ending in a closure offers a count', () => {
    const selected = selectRoute(board, closureState(), from);
    const snap = clickArrow(selected, second);
    expect(controlShown(snap)).toBe(true);
    expect(clickableOf(snap).size).toBe(0);
    expect(carriesOf(snap).length).toBeGreaterThan(0);
  });

  it('An attack run offers only counts that leave a head behind', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [first, { owner: B, heads: 2 }],
    ]);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, first);
    // §6.2's stay-behind is the ceiling here, not the heads on the run's start.
    expect(carriesOf(snap)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(carriesOf(snap)).toEqual(countsThatWalk(rules, state, from, [first]));
    expect(carriesOf(snap).filter((count) => count > 7)).toEqual([]);
    expect(carriesOf(snap)[0]).toBe(1);
    expect(controlShown(snap)).toBe(true);
  });

  it('A lone head is never offered an attack', () => {
    const state = stateWith([
      [from, { owner: A, heads: 1 }],
      [first, { owner: B, heads: 2 }],
    ]);
    const selected = selectRoute(board, state, from);
    expect(clickableOf(selected.snap).has(first)).toBe(false);
    // Non-vacuity: the other two exits are on offer, so this is the rule and not
    // an empty set.
    expect(clickableOf(selected.snap).size).toBeGreaterThan(0);
  });

  it('A one-head stack facing only an enemy reports blocked', () => {
    const exits = geometry.outArrows(geometry.target(from));
    const state = stateWith([
      [from, { owner: A, heads: 1 }],
      ...exits.map((exit) => [exit, { owner: B, heads: 2 }] as const),
    ]);
    const snap = makeMode(board).onArrowClick(from, state, rules);
    expect(snap.phase.kind).toBe('blocked');
    expect(snap.refusal?.reason).toBe('no-exit');
    expect(controlShown(snap)).toBe(false);
  });
});

describe('P35 edge — rewriting the last run re-measures everything downstream of it', () => {
  it("Lowering the last run's count lowers the heads at the tip", () => {
    const selected = selectOpenField(8);
    clickArrow(selected, first);
    const snap = selected.mode.setCarry(3);
    expect(routePhaseOf(snap).tipHeads).toBe(3);
    expect(countsOf(draftOf(snap))).toEqual([3]);
  });

  it("Lowering the last run's count shortens what the tip offers", () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, first);
    const snap = selected.mode.setCarry(2);
    const expected = buildRouteOffer(runInputs(board, state, from, [{ steps: [first], count: 2 }]));
    expect(expected.clickable.size).toBeGreaterThan(0);
    // Two heads arrived, so the offer from the tip is the two-head one.
    expect(countsOf(draftOf(snap))).toEqual([2]);
    expect(routePhaseOf(snap).tipHeads).toBe(2);
    expect(sortedIds(clickableOf(snap).keys())).toEqual(sortedIds(expected.clickable.keys()));
  });

  it("Raising the last run's count lengthens what the tip offers", () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, first);
    const lowered = selected.mode.setCarry(2);
    expect(countsOf(draftOf(lowered))).toEqual([2]);
    const snap = selected.mode.setCarry(8);
    const expected = buildRouteOffer(runInputs(board, state, from, [{ steps: [first], count: 8 }]));
    expect(expected.clickable.size).toBeGreaterThan(0);
    expect(countsOf(draftOf(snap))).toEqual([8]);
    expect(clickableOf(snap).size).toBeGreaterThan(clickableOf(lowered).size);
    expect(sortedIds(clickableOf(snap).keys())).toEqual(sortedIds(expected.clickable.keys()));
  });

  it("Lowering the last run's count leaves a sentry at its start", () => {
    const state = openField(from, 12);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, first);
    selected.mode.setCarry(8);
    const sent = pendingOf(selected.mode.send());
    expect(countsOf(sent)).toEqual([8]);
    let applied = state;
    for (const move of sent) applied = rules.apply(applied, move);
    expect(headsOn(applied, from)).toBe(4);
  });

  it('Two runs at two counts leave two sentries', () => {
    const state = openField(from, 12);
    const selected = selectRoute(board, state, from);
    clickRuns(selected, [
      { arrow: first, count: 8 },
      { arrow: second, count: 4 },
    ]);
    const sent = pendingOf(selected.mode.send());
    expect(countsOf(sent)).toEqual([8, 4]);
    let applied = state;
    for (const move of sent) applied = rules.apply(applied, move);
    expect(headsOn(applied, from)).toBe(4);
    expect(headsOn(applied, first)).toBe(4);
    expect(headsOn(applied, second)).toBe(4);
  });

  it('A merge raises the ceiling on the next run, not on this one', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [first, { owner: A, heads: 3 }],
    ]);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, first);
    expect(routePhaseOf(snap).tipHeads).toBe(11);
    expect(carriesOf(snap).filter((count) => count > 8)).toEqual([]);
    expect(carriesOf(snap)).toEqual(countsThatWalk(rules, state, from, [first]));
  });

  it('Combat lowers the ceiling on the next run', () => {
    // Eight heads attack six: the run drafts at seven (the largest count the
    // stay-behind allows) and five of the seven survive to stand on the tip.
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [first, { owner: B, heads: 6 }],
    ]);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, first);
    expect(countsOf(draftOf(snap))).toEqual([7]);
    const survivors = headsOn(applyOnce(board, state, from, first, 7), first);
    expect(survivors).toBeLessThan(7);
    expect(routePhaseOf(snap).tipHeads).toBe(survivors);
  });
});

describe('P35 edge — popping composes with the count without leaking state', () => {
  /** Sixteen heads, two runs of two steps — see the file header on `spent`. */
  const twoRuns = () => {
    const state = openField(from, 16);
    const selected = selectRoute(board, state, from);
    const secondRun = raySlotWalk(geometry, second, 1, 2);
    const target = secondRun[1];
    if (target === undefined) throw new Error('setup: no two step run off the first');
    const snap = clickRuns(selected, [{ arrow: second }, { arrow: target }]);
    return { state, selected, snap };
  };

  it('Popping restores the earlier run as the last run', () => {
    const { state, selected, snap } = twoRuns();
    const popped = clickArrow(selected, second);
    expect(draftOf(snap)).toHaveLength(4);
    expect(runLengthsOf(popped)).toEqual([2]);
    expect(carriesOf(popped)).toEqual(
      countsThatWalk(rules, state, from, raySlotWalk(geometry, from, 0, 2)),
    );
  });

  it('Popping then rewriting edits the restored run', () => {
    const { selected } = twoRuns();
    clickArrow(selected, second);
    const snap = selected.mode.setCarry(6);
    expect(draftOf(snap)).toHaveLength(2);
    expect(countsOf(draftOf(snap))).toEqual([6, 6]);
  });

  it('Popping to the source empties the draft and hides the control', () => {
    const selected = selectOpenField(8);
    clickArrow(selected, second);
    const snap = clickArrow(selected, from);
    expect(draftOf(snap)).toHaveLength(0);
    expect(snap.phase.kind).toBe('route');
    expect(controlShown(snap)).toBe(false);
  });

  it('Popping twice returns to an empty draft', () => {
    const { selected } = twoRuns();
    clickArrow(selected, second);
    const snap = clickArrow(selected, from);
    expect(draftOf(snap)).toHaveLength(0);
    expect(runLengthsOf(snap)).toEqual([]);
  });

  it('Extending after a pop starts the new run at full strength', () => {
    const { selected } = twoRuns();
    const popped = clickArrow(selected, second);
    expect(routePhaseOf(popped).tipHeads).toBe(16);
    const onward = arrowAlong(geometry, second, 1, 1);
    const snap = clickArrow(selected, onward);
    expect(runLengthsOf(snap)).toEqual([2, 1]);
    expect(countsOf(draftOf(snap))).toEqual([16, 16, 16]);
  });
});

describe('P35 edge — the auto-apply test is exact at its boundaries', () => {
  it('Two legal counts defeat auto-apply even with a finished tip', () => {
    // Three heads: `speed(2) = speed(3) = 2`, so both counts walk two steps while
    // the allowance is spent either way. Two heads would be *one* legal count and
    // would auto-apply — which is the core suite's two-heads scenario.
    const state = openField(from, 3);
    const untouched = openField(from, 3);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, second);
    expect(carriesOf(snap)).toEqual([2, 3]);
    expect(clickableOf(snap).size).toBe(0);
    expect(controlShown(snap)).toBe(true);
    expect(pendingOf(snap)).toHaveLength(0);
    expect(state).toEqual(untouched);
  });

  it('A count that is not forced defeats auto-apply', () => {
    const state = openField(from, 4);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, second);
    expect(carriesOf(snap).length).toBeGreaterThan(1);
    expect(carriesOf(snap)).toEqual(
      countsThatWalk(rules, state, from, raySlotWalk(geometry, from, 0, 2)),
    );
    expect(controlShown(snap)).toBe(true);
    expect(pendingOf(snap)).toHaveLength(0);
  });

  it('An unreachable auto-apply state is not asserted', () => {
    // The implication the spec argues: for a one run draft, one legal count means
    // the ceiling is `2^(k-1)`, the allowance is exactly spent, and nothing can be
    // clickable. Measured over every `k` the board can walk, so no scenario has to
    // claim a forced count beside a live tip — there is no such state to claim.
    for (const k of [1, 2, 3, 4]) {
      const heads = 2 ** (k - 1);
      const state = openField(from, heads);
      const run = raySlotWalk(geometry, from, 0, k);
      expect(countsThatWalk(rules, state, from, run), `k=${String(k)}`).toEqual([heads]);
      const after = walkSteps(board, state, from, run, heads);
      for (const slot of [0, 1, 2]) {
        expect(
          acceptedRunLength(board, after.state, run[k - 1] ?? from, slot, heads),
          `k=${String(k)} slot ${String(slot)}`,
        ).toBe(0);
      }
    }
  });

  it('A forced count on a second run defeats auto-apply', () => {
    const state = openField(from, 8);
    const untouched = openField(from, 8);
    const selected = selectRoute(board, state, from);
    const snap = clickRuns(selected, [
      { arrow: first },
      { arrow: arrowAlong(geometry, from, 0, 4) },
    ]);
    const phase = routePhaseOf(snap);
    expect(phase.offer.carries).toHaveLength(1);
    expect(phase.offer.clickable.size).toBe(0);
    expect(
      autoApplies({
        draftLength: phase.draft.length,
        lastRunLength: lastRunLengthOf(snap),
        counts: phase.offer.carries,
        clickable: phase.offer.clickable.size,
      }),
    ).toBe(false);
    expect(controlShown(snap)).toBe(true);
    expect(pendingOf(snap)).toHaveLength(0);
    expect(state).toEqual(untouched);
  });

  it('An auto-applied move leaves no route phase behind', () => {
    const selected = selectRoute(board, openField(from, 1), from);
    const snap = clickArrow(selected, first);
    expect(snap.phase.kind).toBe('idle');
    const paint = routePaint({ phase: snap.phase, pointer: 'fine' });
    expect(paint.rayArrows.size).toBe(0);
    expect(paint.turnArrows.size).toBe(0);
    expect(paint.draftArrows).toHaveLength(0);
    expect(paint.reachWash.size).toBe(0);
    expect(paint.tip).toBeUndefined();
  });
});

describe('P35 edge — the rest of the app is undisturbed', () => {
  it('Ending the turn discards an open draft', () => {
    const selected = selectOpenField(8);
    clickArrow(selected, second);
    const snap = selected.mode.requestEndTurn();
    expect(pendingOf(snap)).toEqual([endTurn()]);
    expect(snap.phase.kind).toBe('idle');
    expect(controlShown(snap)).toBe(false);
  });

  it('Match over drops the count control', () => {
    const selected = selectOpenField(8);
    const snap = clickArrow(selected, first);
    expect(controlShown(snap)).toBe(true);
    expect(controlShown(snap, { matchOver: true })).toBe(false);
  });

  it('A locked board drops the count control', () => {
    const selected = selectOpenField(8);
    const snap = clickArrow(selected, first);
    expect(controlShown(snap, { inputLocked: true })).toBe(false);
  });

  it('The refused wash still paints', () => {
    const { state, from: source, refused } = refusedConvertFixture();
    const selected = selectRoute(board, state, source);
    expect(refusedConvertExits(state, geometry, rules, source).has(refused)).toBe(true);
    expect(clickableOf(selected.snap).has(refused)).toBe(false);
  });
});

describe('P35 edge — purity, determinism and cost', () => {
  it('Equal inputs produce an equal offer', () => {
    const state = openField(from, 8);
    const left = selectRoute(board, state, from);
    const right = selectRoute(board, state, from);
    const leftSnap = clickArrow(left, second);
    const rightSnap = clickArrow(right, second);
    expect(draftOf(leftSnap)).toEqual(draftOf(rightSnap));
    expect(carriesOf(leftSnap)).toEqual(carriesOf(rightSnap));
    expect(lastRunLengthOf(leftSnap)).toBe(lastRunLengthOf(rightSnap));
    expect(sortedIds(clickableOf(leftSnap).keys())).toEqual(
      sortedIds(clickableOf(rightSnap).keys()),
    );
    expect(controlOf(leftSnap)).toEqual(controlOf(rightSnap));
    const paint = (snap: typeof leftSnap) =>
      routePaint({ phase: routePhaseOf(snap), pointer: 'fine' });
    expect(sortedIds(paint(leftSnap).rayArrows)).toEqual(sortedIds(paint(rightSnap).rayArrows));
  });

  it('The offer is built once per change, not per hover', () => {
    const counting = countingRules(rules);
    const instrumented = { geometry, rules: counting.rules };
    const selected = selectRoute(instrumented, openField(from, 8), from);
    const snap = clickArrow(selected, second);
    const phase = routePhaseOf(snap);
    counting.zero();
    const hovers = [...phase.offer.clickable.keys()].slice(0, 6);
    expect(hovers).toHaveLength(6);
    for (const hoverArrow of hovers) routePaint({ phase, pointer: 'fine', hoverArrow });
    expect(counting.calls).toBe(0);
  });

  it('No clock and no randomness', () => {
    const source = readSource('route.ts');
    expect(source.length).toBeGreaterThan(200);
    for (const banned of [
      'Date.now',
      'new Date',
      'Math.random',
      'performance.now',
      'crypto',
      'fetch(',
      'process.',
    ]) {
      expect(source.includes(banned), banned).toBe(false);
    }
  });

  it('The run boundaries always account for every drafted move', () => {
    const selected = selectRoute(board, openField(from, 16), from);
    const clicks = [second, third, first, from, second];
    let snap = selected.snap;
    let drafted = 0;
    for (const arrow of clicks) {
      snap = clickArrow(selected, arrow);
      if (snap.phase.kind !== 'route') continue;
      const phase = routePhaseOf(snap);
      const sum = phase.runLengths.reduce((total, run) => total + run, 0);
      expect(sum, String(arrow)).toBe(phase.draft.length);
      expect(phase.runLengths.length === 0, String(arrow)).toBe(phase.draft.length === 0);
      if (phase.draft.length > 0) drafted += 1;
      const lowest = phase.offer.carries[0];
      if (lowest === undefined) continue;
      const counted = routePhaseOf(selected.mode.setCarry(lowest));
      expect(
        counted.runLengths.reduce((total, run) => total + run, 0),
        `${String(arrow)} counted`,
      ).toBe(counted.draft.length);
    }
    expect(drafted).toBeGreaterThan(2);
  });

  it('Popping into the middle of a run truncates that run', () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, third);
    const popped = clickArrow(selected, first);
    expect(draftOf(popped)).toHaveLength(1);
    expect(runLengthsOf(popped)).toEqual([1]);
    expect(carriesOf(popped)).toEqual(countsThatWalk(rules, state, from, [first]));
  });

  it('The offer’s cost does not scale with the head count', () => {
    // The spec's cost note, asserted as the shape it can actually prove.
    // `speed(8) = speed(15) = 4`, so the two boards have identical rays and — on
    // an open field — identical *acceptances*: exactly one whole-run walk per ray
    // happens either way, and the count of `rules.apply` calls is the same. An
    // offer that scanned 1..tipHeads instead would cost about twice as much at 15
    // heads as at 8, which is what this kills.
    //
    // It does **not** prove "two walks, never a per-step retry" — no step is
    // refused here, so the second walk never runs. That claim is enforced by
    // *invariants* `4. An arrow shall be in the clickable set if and only if some
    // count … walks the run that reaches it`, where an enemy two steps out is
    // asserted unclickable: a per-step retry at one head fewer would accept that
    // second step and offer an arrow no single count can reach.
    //
    // Measured on `clickableSet` rather than on the whole offer: `runCarries`
    // *is* allowed its one 1..ceiling scan, and `reach.ts`'s wash has always
    // enumerated counts (P34), so neither belongs in this budget.
    const walks = (heads: number): number => {
      const counting = countingRules(rules);
      const instrumented = { geometry, rules: counting.rules };
      clickableSet(inputsAt(instrumented, openField(from, heads), from, heads));
      return counting.calls;
    };
    expect(walks(8)).toBeGreaterThan(0);
    expect(walks(15)).toBe(walks(8));
  });
});
