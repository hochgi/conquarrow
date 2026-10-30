/**
 * P35 core scenarios — `docs/spec/count-after-route/count-after-route.core.feature`.
 *
 * One test per scenario, in feature order. Scenarios about the *content* of an
 * offer go through the pure helpers (`runCarries`, `countControl`);
 * scenarios about the *order of the questions* go through the input mode, because
 * that ordering is the whole feature: a click names the run, and only then is its
 * count asked.
 *
 * Every count in here is measured with {@link countsThatWalk} — walking
 * `rules.apply` at 1, 2, 3 … heads — never derived from `speed(N)`. Where a
 * literal appears it is a *checked* literal: the oracle is asserted alongside it,
 * so a rule change moves the test rather than silently disagreeing with it.
 *
 * *Full strength* is the **largest count that walks the run**, not every head:
 * §6.2's stay-behind refuses `count = heads` for an attack, so an adjacent enemy
 * arrow drafts at `heads - 1`. Everywhere else the two readings coincide, which
 * is why most scenarios below still say 8 out of 8.
 *
 * Two numbers worth stating once, because several scenarios lean on them
 * (measured, not assumed — see the assertions):
 *
 * - a run of `k` steps needs `2^(k-1)` heads, so 8 heads walk 4 and 16 walk 5;
 * - `spent` travels with the movers, so a second run of two steps off a tip that
 *   has already spent two needs 8 heads, not 2. This is why the multi-run
 *   fixtures here carry 16 rather than the feature's illustrative 8.
 */

import { describe, expect, it } from 'vitest';
import { step } from '@conquarrow/contracts';
import type { ArrowId } from '@conquarrow/contracts';
import { routePaint, runMoves } from '../src/route';
import { selectionPaint } from '../src/selectionChrome';
import { createViewport, toScreen } from '../src/viewport';
import {
  A,
  B,
  acceptedRunLength,
  arrowAlong,
  carriesOf,
  clickArrow,
  clickRuns,
  clickableOf,
  controlOf,
  controlShown,
  countsOf,
  countsThatWalk,
  draftOf,
  earlierMovesOf,
  exitsOf,
  geometry,
  largestCountThatWalks,
  lastRunLengthOf,
  lastRunMovesOf,
  leastCountThatWalks,
  openField,
  optionFor,
  pendingOf,
  rayOf,
  raySlotWalk,
  readSource,
  reachedBySomeCount,
  refusingRules,
  routePhaseOf,
  rules,
  runInputs,
  runLengthsOf,
  selectOpenField,
  selectRoute,
  sortedIds,
  sourceArrow,
  stateWith,
} from './count-after-route.support';

const board = { geometry, rules };
const from = sourceArrow(geometry);
const SLOTS = [0, 1, 2] as const;

const along = (slot: number, steps: number): ArrowId =>
  arrowAlong(geometry, from, slot, steps);

const first = along(0, 1);
const second = along(0, 2);
const third = along(0, 3);
const fourth = along(0, 4);

describe('P35 core — nothing is asked before a route exists', () => {
  it('Selecting a stack renders no count control', () => {
    const selected = selectOpenField(8);
    expect(selected.phase.kind).toBe('route');
    expect(selected.phase.draft).toHaveLength(0);
    expect(controlShown(selected.snap)).toBe(false);
  });

  it('The offerable counts are empty with an empty draft', () => {
    const selected = selectOpenField(8);
    expect(carriesOf(selected.snap)).toEqual([]);
  });

  it('The run boundaries are empty with an empty draft', () => {
    const selected = selectOpenField(8);
    expect(runLengthsOf(selected.snap)).toEqual([]);
    expect(lastRunLengthOf(selected.snap)).toBe(0);
  });

  it("The rays are measured at the tip's full head count", () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    for (const slot of SLOTS) {
      const full = acceptedRunLength(board, state, from, slot, 8);
      expect(full, `slot ${String(slot)} is not worth measuring`).toBeGreaterThan(0);
      expect(rayOf(selected.snap, slot), `slot ${String(slot)}`).toHaveLength(full);
    }
  });

  it('An arrow is clickable when some count reaches it', () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    // The oracle is geometric words plus `rules.apply`, not a second ray walk:
    // every `s^m` and `s^m·e` out of a0, kept when *some* count of 8 or fewer
    // walks the whole word.
    const reached = reachedBySomeCount(board, state, from, 5);
    expect(reached.size).toBe(30);
    expect(sortedIds(clickableOf(selected.snap).keys())).toEqual(sortedIds(reached));
  });

  it('An adjacent enemy arrow is clickable, armed by the count below full', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [first, { owner: B, heads: 2 }],
    ]);
    const selected = selectRoute(board, state, from);
    // Full strength cannot take it — the stay-behind refuses an emptying attack —
    // and seven can, so the offer arms it.
    expect(countsThatWalk(rules, state, from, [first])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(clickableOf(selected.snap).has(first)).toBe(true);
    const snap = clickArrow(selected, first);
    expect(countsOf(draftOf(snap))).toEqual([7]);
    expect(routePhaseOf(snap).carry).toBe(7);
  });
});

describe('P35 core — a click drafts the run at the largest count that walks it', () => {
  it('A run carries every head when nothing refuses that count', () => {
    const selected = selectOpenField(8);
    const state = openField(from, 8);
    const snap = clickArrow(selected, second);
    expect(largestCountThatWalks(rules, state, from, raySlotWalk(geometry, from, 0, 2))).toBe(8);
    expect(countsOf(draftOf(snap))).toEqual([8, 8]);
    expect(lastRunLengthOf(snap)).toBe(2);
    expect(runLengthsOf(snap)).toEqual([2]);
  });

  it('A second run carries every head that arrived', () => {
    const selected = selectRoute(board, openField(from, 12), from);
    const snap = clickRuns(selected, [{ arrow: first, count: 8 }, { arrow: second }]);
    expect(countsOf(draftOf(snap))).toEqual([8, 8]);
    expect(routePhaseOf(snap).carry).toBe(8);
    expect(runLengthsOf(snap)).toEqual([1, 1]);
  });

  it('The drafted run is the run that was painted', () => {
    const state = openField(from, 8);
    const untouched = openField(from, 8);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, third);
    expect(exitsOf(draftOf(snap)).map(String)).toEqual(
      raySlotWalk(geometry, from, 0, 3).map(String),
    );
    expect(pendingOf(snap)).toHaveLength(0);
    expect(state).toEqual(untouched);
  });
});

describe('P35 core — the count control edits the run just drafted', () => {
  it('The control appears after the click, not before', () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    expect(controlShown(selected.snap)).toBe(false);
    const snap = clickArrow(selected, first);
    const control = controlOf(snap);
    expect(control).toBeDefined();
    expect(control?.counts).toEqual(countsThatWalk(rules, state, from, [first]));
  });

  it('Lowering the count rewrites the last run', () => {
    const selected = selectOpenField(8);
    clickArrow(selected, first);
    const snap = selected.mode.setCarry(5);
    expect(countsOf(draftOf(snap))).toEqual([5]);
  });

  it('Lowering the count leaves earlier runs untouched', () => {
    const selected = selectOpenField(8);
    const drafted = clickRuns(selected, [{ arrow: second }, { arrow: third }]);
    const earlier = [...earlierMovesOf(drafted)];
    expect(earlier).toHaveLength(2);
    const snap = selected.mode.setCarry(4);
    expect(earlierMovesOf(snap)).toEqual(earlier);
    expect(countsOf(lastRunMovesOf(snap))).toEqual([4]);
  });

  it('Rewriting re-emits exactly the last run', () => {
    // Sixteen heads: two steps, then two more. `spent` travels with the movers,
    // so the second run's floor is 8 — the feature's illustrative 4 is a count
    // the engine refuses for a run in that position.
    const state = openField(from, 16);
    const selected = selectRoute(board, state, from);
    const secondRun = raySlotWalk(geometry, second, 1, 2);
    const target = secondRun[1];
    expect(target).toBeDefined();
    if (target === undefined) return;
    const drafted = clickRuns(selected, [{ arrow: second }, { arrow: target }]);
    expect(draftOf(drafted)).toHaveLength(4);
    const before = [...draftOf(drafted)];
    const lowered = leastCountThatWalks(
      rules,
      runInputs(board, state, from, [{ steps: raySlotWalk(geometry, from, 0, 2), count: 16 }]).state,
      second,
      secondRun,
    );
    expect(lowered).toBeLessThan(16);
    const snap = selected.mode.setCarry(lowered);
    const draft = draftOf(snap);
    expect(draft).toHaveLength(4);
    expect(draft.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(countsOf(draft.slice(2))).toEqual([lowered, lowered]);
  });

  it('A count below the floor is not offerable', () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, third);
    const floor = leastCountThatWalks(rules, state, from, raySlotWalk(geometry, from, 0, 3));
    expect(floor).toBe(4);
    expect(carriesOf(snap).filter((count) => count < floor)).toEqual([]);
    expect(carriesOf(snap)[0]).toBe(floor);
  });

  it("A count above the heads at the run's start is not offerable", () => {
    const selected = selectOpenField(8);
    const snap = clickArrow(selected, first);
    expect(carriesOf(snap).length).toBeGreaterThan(0);
    expect(carriesOf(snap).filter((count) => count > 8)).toEqual([]);
  });

  it('Setting a count that is not offerable is ignored', () => {
    const selected = selectOpenField(8);
    const drafted = clickArrow(selected, third);
    const before = [...draftOf(drafted)];
    const belowFloor = 3;
    expect(carriesOf(drafted)).not.toContain(belowFloor);
    const snap = selected.mode.setCarry(belowFloor);
    expect(draftOf(snap)).toEqual(before);
  });

  it('The floor is measured by the engine, not derived from speed', () => {
    // A rule change that refuses anything under six heads. `speed(4) = 3` would
    // still allow a three step run at four, so a derived floor would offer it.
    const state = openField(from, 8);
    const stubborn = { geometry, rules: refusingRules(rules, (move) => move.count < 6) };
    const run = raySlotWalk(geometry, from, 0, 3);
    expect(countsThatWalk(rules, state, from, run)[0]).toBe(4);
    const selected = selectRoute(stubborn, state, from);
    const snap = clickArrow(selected, third);
    expect(carriesOf(snap)).not.toContain(4);
    expect(carriesOf(snap)[0]).toBe(6);
  });
});

/**
 * P35's *A click with nothing left to decide applies the move* is superseded by
 * P77 (`@superseded-P77` in the feature): every move is drafted and then sent.
 * The four scenarios are kept **inverted** — the same clicks now draft, draw the
 * control and wait — so the boundary they used to pin is still pinned, from the
 * other side. docs/spec/board-selection-model/board-selection-model.md
 */
describe('P35 core — a click with nothing left to decide still waits for Send (P77)', () => {
  it('A two head stack walking two steps drafts and waits', () => {
    // `2^k` heads walking `k+1` steps: the count is forced — and still asked.
    const state = openField(from, 2);
    const untouched = openField(from, 2);
    const selected = selectRoute(board, state, from);
    expect(countsThatWalk(rules, state, from, raySlotWalk(geometry, from, 0, 2))).toEqual([2]);
    const snap = clickArrow(selected, second);
    expect(pendingOf(snap)).toHaveLength(0);
    expect(countsOf(draftOf(snap))).toEqual([2, 2]);
    expect(controlShown(snap)).toBe(true);
    expect(state).toEqual(untouched);
  });

  it('A single head walking one step drafts and waits', () => {
    const selected = selectRoute(board, openField(from, 1), from);
    const snap = clickArrow(selected, first);
    expect(pendingOf(snap)).toHaveLength(0);
    expect(draftOf(snap)).toEqual([step(from, first, 1)]);
    expect(snap.phase.kind).toBe('route');
    expect(controlOf(snap)?.counts).toEqual([1]);
  });

  it('A power-of-two stack spending its whole allowance drafts and waits', () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, fourth);
    expect(countsThatWalk(rules, state, from, raySlotWalk(geometry, from, 0, 4))).toEqual([8]);
    expect(pendingOf(snap)).toHaveLength(0);
    expect(exitsOf(draftOf(snap)).map(String)).toEqual(
      raySlotWalk(geometry, from, 0, 4).map(String),
    );
    expect(countsOf(draftOf(snap))).toEqual([8, 8, 8, 8]);
    expect(controlShown(snap)).toBe(true);
  });

  it('Send after a forced-count click emits exactly the run the click drafted', () => {
    const selected = selectRoute(board, openField(from, 1), from);
    // What a click drafts, from the offer the click read.
    const option = optionFor(selected.snap, first);
    const drafted = runMoves(from, option.steps, 1);
    expect(pendingOf(clickArrow(selected, first))).toHaveLength(0);
    expect(pendingOf(selected.mode.send())).toEqual(drafted);
  });

  it.each([
    [8, 1, 'eight legal counts remain'],
    [2, 1, 'two legal counts remain'],
    [8, 2, 'the tip can still be extended'],
  ])('A click that still has a decision left renders the control (%i heads, %i steps)', (
    heads,
    steps,
    why,
  ) => {
    const state = openField(from, heads);
    const untouched = openField(from, heads);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, along(0, steps));
    expect(controlShown(snap), why).toBe(true);
    expect(pendingOf(snap), why).toHaveLength(0);
    expect(state, why).toEqual(untouched);
  });

  it('A multi-run draft never auto-applies', () => {
    // One step, then three: the second run's count is forced to 8 and the tip has
    // spent its whole allowance — every part of the auto-apply test but the first.
    const state = openField(from, 8);
    const untouched = openField(from, 8);
    const selected = selectRoute(board, state, from);
    const snap = clickRuns(selected, [{ arrow: first }, { arrow: fourth }]);
    const phase = routePhaseOf(snap);
    expect(phase.draft).toHaveLength(4);
    expect(phase.runLengths).toEqual([1, 3]);
    expect(phase.offer.carries).toHaveLength(1);
    expect(phase.offer.clickable.size).toBe(0);
    expect(controlShown(snap)).toBe(true);
    expect(pendingOf(snap)).toHaveLength(0);
    expect(state).toEqual(untouched);
  });
});

describe('P35 core — the control lives below the board, never on it', () => {
  it('The strip is a sibling of the stage', () => {
    const app = readSource('App.tsx');
    const stage = app.indexOf('<div className="stage"');
    expect(stage).toBeGreaterThan(-1);
    // The stage's own closing tag, at the indentation it was opened at.
    const closed = app.indexOf('\n      </div>', stage);
    const dock = app.indexOf('<RouteDock');
    expect(dock, 'App renders no RouteDock').toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(-1);
    expect(dock, 'the dock is inside the stage').toBeGreaterThan(closed);
    // And it is not anchored on anything: no stage pixels reach it.
    expect(app.slice(dock, dock + 400)).not.toContain('tipScreen');
    const dockSource = readSource('RouteDock.tsx');
    // Whole words: P77's `leftoverNote` is copy, not a position (board-selection-model).
    for (const positional of ['left', 'top', 'toScreen', 'tipScreen', 'viewport']) {
      expect(dockSource, positional).not.toMatch(new RegExp(`\\b${positional}\\b`));
    }
  });

  it.each([375, 768, 1280])(
    'The strip overlaps no clickable arrow (%i px)',
    (width) => {
      // A clickable arrow's stage position depends on the viewport…
      expect(toScreen(createViewport(width, 800), 1, 1).x).toBe(1 * 48 + width / 2);
      // …and the control's model depends on none of it: no coordinate, and the
      // same model at 375, 768 and 1280, so there is no rectangle over the board
      // for a clickable arrow to intersect. The *rendered* rectangle needs a real
      // renderer and is checked in the browser (spec: *Not a unit invariant*).
      const selected = selectOpenField(8);
      const snap = clickArrow(selected, first);
      const control = controlOf(snap);
      expect(control).toBeDefined();
      expect(Object.keys(control ?? {}).toSorted()).toEqual([
        'ceiling',
        'count',
        'counts',
        'draftLength',
        // P77: where the last run began — an arrow, not a coordinate.
        'start',
      ]);
      const atDefault = controlOf(clickArrow(selectOpenField(8), first));
      expect(control).toEqual(atDefault);
    },
  );

  it('The tip keeps its halo while the control is docked', () => {
    const selected = selectOpenField(8);
    const snap = clickArrow(selected, first);
    const phase = routePhaseOf(snap);
    expect(controlShown(snap)).toBe(true);
    expect(routePaint({ phase, pointer: 'fine' }).tip).toBe(phase.tip);
    const paint = selectionPaint({ phase, highlights: snap.highlights, pointer: 'fine' });
    expect(paint.selected).toBe(from);
    expect(paint.selectedEmphasis).toBe(true);
  });

  it('Changing the count repaints the rays live', () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, first);
    const snap = selected.mode.setCarry(2);
    const expected = runInputs(board, state, from, [{ steps: [first], count: 2 }]);
    expect(routePhaseOf(snap).tipHeads).toBe(2);
    for (const slot of SLOTS) {
      expect(rayOf(snap, slot), `slot ${String(slot)}`).toHaveLength(
        acceptedRunLength(board, expected.state, first, slot, 2),
      );
    }
  });
});

describe('P35 core — send, cancel and pop are unchanged', () => {
  /** Sixteen heads, two runs of two steps: four moves the engine accepts. */
  const twoRuns = () => {
    const state = openField(from, 16);
    const selected = selectRoute(board, state, from);
    const secondRun = raySlotWalk(geometry, second, 1, 2);
    const target = secondRun[1];
    if (target === undefined) throw new Error('setup: no two step run off the first');
    const snap = clickRuns(selected, [{ arrow: second }, { arrow: target }]);
    return { state, selected, snap, secondRun };
  };

  it('Send emits every run in draft order', () => {
    const { selected, snap } = twoRuns();
    const draft = [...draftOf(snap)];
    expect(draft).toHaveLength(4);
    const sent = selected.mode.send();
    expect(pendingOf(sent)).toEqual(draft);
    expect(sent.phase.kind).toBe('idle');
  });

  it('Cancel applies nothing', () => {
    const state = openField(from, 8);
    const untouched = openField(from, 8);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, third);
    const snap = selected.mode.cancel();
    expect(pendingOf(snap)).toHaveLength(0);
    expect(state).toEqual(untouched);
  });

  it("Popping to a walked arrow restores that run's count control", () => {
    const { selected, snap } = twoRuns();
    const secondExit = exitsOf(draftOf(snap))[1];
    expect(secondExit).toBeDefined();
    if (secondExit === undefined) return;
    const popped = clickArrow(selected, secondExit);
    expect(draftOf(popped)).toHaveLength(2);
    // The second move ends the first run, so the first run is the editable one.
    expect(runLengthsOf(popped)).toEqual([2]);
    expect(lastRunLengthOf(popped)).toBe(2);
    expect(clickableOf(popped).size).toBeGreaterThan(0);
  });
});
