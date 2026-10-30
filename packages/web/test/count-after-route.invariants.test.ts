/**
 * P35 invariants — the twenty-three EARS statements in
 * `docs/spec/count-after-route/count-after-route.md`, one property test each.
 *
 * Properties run over a bank of boards and drafts rather than one example: the
 * generated tiling at three stack sizes, a truncated ray, a merge, an adjacent
 * enemy, and **both** fixture boards, each driven through one- and two-run
 * drafts. A case's clicks are read off the offer itself (`ray N of slot S`)
 * rather than hard-coded, so the same plan is meaningful on an abstract fixture
 * board where a slot carries no geometry.
 *
 * Every count claim is checked against {@link countsThatWalk}, which walks
 * `rules.apply` at 1, 2, 3 … heads and consults `speed()` nowhere. That is the
 * point of "the floor is measured, never derived": if the offer and the engine
 * disagree, the test says which numbers.
 *
 * Each property asserts **non-vacuity** first. An unimplemented helper that
 * returns an empty list satisfies almost every "nothing exceeds" claim, and the
 * one that matters most here — *the control is absent* — is satisfied by a
 * control that is never drawn at all.
 *
 * Invariant 15 is the one the spec explicitly narrows: the overlap of the docked
 * strip with the clickable set needs a real renderer and is a browser check
 * before the PR. What is asserted here is the part that makes it true by
 * construction — the control's model carries no viewport, stage or tip
 * coordinate, and is identical at every width.
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId, GameState, Move } from '@conquarrow/contracts';
import { MINIMAL, SPACIOUS, fixtureArrow } from '@conquarrow/geometry-fixtures';
import type { InputSnapshot, RoutePhase } from '../src/input/modes';
import { lastRunLength, routePaint, runCarries, runMoves } from '../src/route';
import {
  A,
  B,
  acceptedRunLength,
  arrowAlong,
  blankState,
  carriesOf,
  clickArrow,
  controlOf,
  controlShown,
  countsOf,
  countsThatWalk,
  draftOf,
  earlierMovesOf,
  exitsOf,
  fixtureBoard,
  geometry,
  headsOn,
  inputsFromPhase,
  largestCountThatWalks,
  lastRunMovesOf,
  legalSeats,
  openField,
  optionFor,
  pendingOf,
  rayOf,
  raySlotWalk,
  reachedBySomeCount,
  readSource,
  routePhaseOf,
  rules,
  runLengthsOf,
  runStartOf,
  selectRoute,
  sortedIds,
  sourceArrow,
  stateWith,
} from './count-after-route.support';
import type { Board, Selected } from './count-after-route.support';

const board: Board = { geometry, rules };
const from = sourceArrow(geometry);
const SLOTS = [0, 1, 2] as const;

const spacious = fixtureBoard(SPACIOUS);
const minimal = fixtureBoard(MINIMAL);
const spaciousFrom = fixtureArrow(SPACIOUS, '0', '7');
const minimalFrom = fixtureArrow(MINIMAL, '0', '1');

const soloOn = (arrow: ArrowId, heads: number): GameState => (legalSeats({
  ...blankState(),
  groups: new Map([[arrow, { owner: A, heads, spent: 0 }]]),
}));

/** One leg of a plan: take the ray arrow at `index` along `slot` from the tip. */
interface Leg {
  readonly slot: 0 | 1 | 2;
  readonly index: number;
}

interface Case {
  readonly label: string;
  readonly board: Board;
  readonly state: GameState;
  readonly from: ArrowId;
  /** Clicks, expressed against the offer so they work on any board. */
  readonly plan: readonly Leg[];
}

const CASES: readonly Case[] = [
  { label: 'tiling, 8 heads, one run of two', board, state: openField(from, 8), from, plan: [{ slot: 0, index: 1 }] },
  { label: 'tiling, 8 heads, one run of one', board, state: openField(from, 8), from, plan: [{ slot: 1, index: 0 }] },
  { label: 'tiling, 12 heads, two runs', board, state: openField(from, 12), from, plan: [{ slot: 0, index: 0 }, { slot: 1, index: 0 }] },
  {
    label: 'tiling, 16 heads, two runs of two',
    board,
    state: openField(from, 16),
    from,
    plan: [
      { slot: 0, index: 1 },
      { slot: 1, index: 1 },
    ],
  },
  {
    label: 'tiling, 16 heads, ray truncated by an enemy at three',
    board,
    state: stateWith([
      [from, { owner: A, heads: 16 }],
      [arrowAlong(geometry, from, 0, 3), { owner: B, heads: 2 }],
    ]),
    from,
    plan: [{ slot: 0, index: 1 }],
  },
  {
    label: 'tiling, 8 heads, a run ending in a merge',
    board,
    state: stateWith([
      [from, { owner: A, heads: 8 }],
      [arrowAlong(geometry, from, 0, 2), { owner: A, heads: 3 }],
    ]),
    from,
    plan: [{ slot: 0, index: 1 }],
  },
  {
    // The attack path: full strength is refused, `heads - 1` is not.
    label: 'tiling, 8 heads, a run onto an adjacent enemy',
    board,
    state: stateWith([
      [from, { owner: A, heads: 8 }],
      [arrowAlong(geometry, from, 0, 1), { owner: B, heads: 2 }],
    ]),
    from,
    plan: [{ slot: 0, index: 0 }],
  },
  {
    label: 'spacious fixture, 16 heads, two runs',
    board: spacious,
    state: soloOn(spaciousFrom, 16),
    from: spaciousFrom,
    plan: [
      { slot: 0, index: 1 },
      { slot: 1, index: 0 },
    ],
  },
  {
    label: 'minimal fixture, 8 heads, one run',
    board: minimal,
    state: soloOn(minimalFrom, 8),
    from: minimalFrom,
    plan: [{ slot: 0, index: 0 }],
  },
];

interface Walked {
  readonly selected: Selected;
  readonly snap: InputSnapshot;
  readonly phase: RoutePhase;
  /** How many legs of the plan actually landed. */
  readonly runs: number;
}

/**
 * Drive a case's plan through the input mode, stopping if the phase leaves
 * `route` or the ray it names is shorter than the plan.
 */
const walkPlan = (item: Case, plan: readonly Leg[] = item.plan): Walked => {
  const selected = selectRoute(item.board, item.state, item.from);
  let snap = selected.snap;
  let runs = 0;
  for (const leg of plan) {
    if (snap.phase.kind !== 'route') break;
    const target = rayOf(snap, leg.slot)[leg.index];
    if (target === undefined) break;
    // P77: a click on an own stack selects it; a merge is drafted through the
    // strip's Merge button, which is `mergeInto`.
    const merge = item.state.groups.get(target)?.owner === item.state.activePlayer;
    snap = merge ? selected.mode.mergeInto(target) : clickArrow(selected, target);
    if (snap.phase.kind !== 'route') break;
    runs += 1;
  }
  return { selected, snap, phase: routePhaseOf(snap), runs };
};

/** The editable run's length, derived from the boundaries as the spec says. */
const runLength = (phase: RoutePhase): number => lastRunLength(phase.runLengths);

/** The cases whose whole plan lands in the route phase — most properties want these. */
const drafted = (): readonly (Walked & { readonly label: string })[] =>
  CASES.map((item) => ({ ...walkPlan(item), label: item.label })).filter(
    (walked) => walked.runs > 0,
  );

describe('P35 invariants', () => {
  it('1. While the draft is empty, the adapter shall render no count control.', () => {
    let checked = 0;
    for (const item of CASES) {
      const selected = selectRoute(item.board, item.state, item.from);
      expect(controlShown(selected.snap), `${item.label}: fresh`).toBe(false);
      const walked = walkPlan(item);
      if (walked.runs > 0) {
        // …and again after a pop back to the source, which is also an empty draft.
        const popped = clickArrow(walked.selected, item.from);
        expect(draftOf(popped), `${item.label}: popped`).toHaveLength(0);
        expect(controlShown(popped), `${item.label}: popped`).toBe(false);
        // Non-vacuity: with a run drafted the control *is* drawn.
        expect(controlShown(walked.snap), item.label).toBe(true);
      }
      checked += 1;
    }
    expect(checked).toBe(CASES.length);
  });

  it('2. While the draft is empty, `offer.carries` shall be empty and `runLengths` shall be empty.', () => {
    for (const item of CASES) {
      const selected = selectRoute(item.board, item.state, item.from);
      expect(carriesOf(selected.snap), item.label).toEqual([]);
      expect(runLengthsOf(selected.snap), item.label).toEqual([]);
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      expect(carriesOf(walked.snap).length, `${item.label}: drafted`).toBeGreaterThan(0);
      expect(runLengthsOf(walked.snap).length, `${item.label}: drafted`).toBeGreaterThan(0);
    }
  });

  it('3. When a run is appended, the adapter shall set that run’s count to the largest count that walks the whole run, never exceeding the heads standing on the tip the run started from.', () => {
    let runs = 0;
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const start = runStartOf(item.board, item.state, walked.phase);
      const steps = exitsOf(lastRunMovesOf(walked.snap));
      const counts = countsOf(lastRunMovesOf(walked.snap));
      // Non-vacuity: a run with no moves in it satisfies any claim about them.
      expect(runLength(walked.phase), `${item.label}: no run recorded`).toBeGreaterThan(0);
      expect(counts.length, item.label).toBe(runLength(walked.phase));
      const largest = largestCountThatWalks(item.board.rules, start.state, start.start, steps);
      expect(largest, `${item.label}: over the tip's heads`).toBeLessThanOrEqual(start.heads);
      for (const count of counts) expect(count, `${item.label}: run count`).toBe(largest);
      runs += 1;
    }
    expect(runs).toBeGreaterThan(6);
    // And where the run attacks, the largest is one short of every head.
    const attack = stateWith([
      [from, { owner: A, heads: 8 }],
      [arrowAlong(geometry, from, 0, 1), { owner: B, heads: 2 }],
    ]);
    const enemy = arrowAlong(geometry, from, 0, 1);
    const selected = selectRoute(board, attack, from);
    expect(countsOf(draftOf(clickArrow(selected, enemy)))).toEqual([7]);
  });

  it('4. An arrow shall be in the clickable set if and only if some count not exceeding the tip’s heads walks the run that reaches it.', () => {
    // On the open field nothing else truncates, so the geometric words plus
    // `rules.apply` are an independent oracle for the whole set.
    for (const heads of [2, 4, 8, 16]) {
      const state = openField(from, heads);
      const selected = selectRoute(board, state, from);
      const reached = reachedBySomeCount(board, state, from, 6);
      expect(reached.size, `${String(heads)} heads`).toBeGreaterThan(0);
      expect(sortedIds(selected.phase.offer.clickable.keys()), `${String(heads)} heads`).toEqual(
        sortedIds(reached),
      );
      // The rays are the same measurement, read per slot.
      for (const slot of SLOTS) {
        expect(rayOf(selected.snap, slot).length, `${String(heads)} heads slot ${String(slot)}`).toBe(
          acceptedRunLength(board, state, from, slot, heads),
        );
      }
    }
    // The two directions that matter, on a board where a count decides:
    const enemy = arrowAlong(geometry, from, 0, 1);
    const far = arrowAlong(geometry, from, 0, 2);
    const adjacent = stateWith([
      [from, { owner: A, heads: 8 }],
      [enemy, { owner: B, heads: 2 }],
    ]);
    // some count reaches it (7) -> clickable
    expect(countsThatWalk(rules, adjacent, from, [enemy]).length).toBeGreaterThan(0);
    expect(selectRoute(board, adjacent, from).phase.offer.clickable.has(enemy)).toBe(true);
    // no count reaches it (a mid-run attack empties whatever carried it) -> not
    const beyond = stateWith([
      [from, { owner: A, heads: 8 }],
      [far, { owner: B, heads: 2 }],
    ]);
    expect(countsThatWalk(rules, beyond, from, [enemy, far])).toEqual([]);
    expect(selectRoute(board, beyond, from).phase.offer.clickable.has(far)).toBe(false);
    // and a lone head cannot attack at any count.
    const lone = stateWith([
      [from, { owner: A, heads: 1 }],
      [enemy, { owner: B, heads: 2 }],
    ]);
    expect(countsThatWalk(rules, lone, from, [enemy])).toEqual([]);
    expect(selectRoute(board, lone, from).phase.offer.clickable.has(enemy)).toBe(false);
  });

  it('5. `offer.carries` shall list exactly the counts for which every step of the last run is accepted by `rules.apply`, ascending.', () => {
    let compared = 0;
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const start = runStartOf(item.board, item.state, walked.phase);
      const steps = exitsOf(lastRunMovesOf(walked.snap));
      const oracle = countsThatWalk(item.board.rules, start.state, start.start, steps);
      expect(oracle.length, `${item.label}: oracle`).toBeGreaterThan(0);
      expect(carriesOf(walked.snap), item.label).toEqual(oracle);
      expect([...carriesOf(walked.snap)].toSorted((a, b) => a - b), item.label).toEqual([
        ...carriesOf(walked.snap),
      ]);
      // The helper answers the same as the phase, asked about the same run.
      expect(
        runCarries(inputsFromPhase(item.board, item.state, walked.phase)),
        `${item.label}: helper`,
      ).toEqual(oracle);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(6);
  });

  it('6. `offer.carries` shall never contain a count exceeding the heads standing on the arrow the last run started from.', () => {
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const start = runStartOf(item.board, item.state, walked.phase);
      expect(carriesOf(walked.snap).length, item.label).toBeGreaterThan(0);
      for (const count of carriesOf(walked.snap)) {
        expect(count, `${item.label}: ${String(count)} > ${String(start.heads)}`).toBeLessThanOrEqual(
          start.heads,
        );
      }
      const control = controlOf(walked.snap);
      expect(control?.ceiling, item.label).toBe(start.heads);
    }
  });

  it('7. Where the last run’s final step attacks an enemy-held arrow, `offer.carries` shall not contain the heads standing on the run’s start.', () => {
    let attacks = 0;
    for (const heads of [2, 4, 8, 16]) {
      for (const slot of SLOTS) {
        const enemy = arrowAlong(geometry, from, slot, 1);
        const state = stateWith([
          [from, { owner: A, heads }],
          [enemy, { owner: B, heads: 2 }],
        ]);
        const selected = selectRoute(board, state, from);
        const where = `${String(heads)} heads, slot ${String(slot)}`;
        expect(selected.phase.offer.clickable.has(enemy), where).toBe(true);
        const snap = clickArrow(selected, enemy);
        // P77: a lone-count attack no longer auto-applies — it is drafted like any run.
        expect(snap.phase.kind, where).toBe('route');
        expect(pendingOf(snap), where).toHaveLength(0);
        expect(carriesOf(snap), where).not.toContain(heads);
        expect(carriesOf(snap)[carriesOf(snap).length - 1], where).toBe(heads - 1);
        expect(carriesOf(snap)[0], where).toBe(1);
        attacks += 1;
      }
    }
    expect(attacks).toBe(12);
  });

  it('8. When the count of the last run is changed, the adapter shall leave every earlier run’s moves byte-identical.', () => {
    let changed = 0;
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const earlier: readonly Move[] = [...earlierMovesOf(walked.snap)];
      // Non-vacuity: with no run boundary recorded, "earlier" would be the whole
      // draft and the claim would be P34's repealed one.
      expect(runLength(walked.phase), `${item.label}: no run recorded`).toBeGreaterThan(0);
      for (const count of carriesOf(walked.snap)) {
        const snap = walked.selected.mode.setCarry(count);
        expect(earlierMovesOf(snap), `${item.label} at ${String(count)}`).toEqual(earlier);
        changed += 1;
      }
    }
    expect(changed).toBeGreaterThan(20);
  });

  it('9. When the count of the last run is changed, the adapter shall re-emit exactly the moves of that run and no others.', () => {
    let changed = 0;
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const length = walked.phase.draft.length;
      const boundaries = [...walked.phase.runLengths];
      const runLengthNow = runLength(walked.phase);
      expect(runLengthNow, item.label).toBeGreaterThan(0);
      for (const count of carriesOf(walked.snap)) {
        const snap = walked.selected.mode.setCarry(count);
        const phase = routePhaseOf(snap);
        expect(phase.draft, `${item.label} at ${String(count)}`).toHaveLength(length);
        expect(phase.runLengths, `${item.label} at ${String(count)}`).toEqual(boundaries);
        expect(countsOf(lastRunMovesOf(snap)), `${item.label} at ${String(count)}`).toEqual(
          Array.from({ length: runLengthNow }, () => count),
        );
        changed += 1;
      }
    }
    expect(changed).toBeGreaterThan(20);
  });

  it('10. Where a count is not in `offer.carries`, the adapter shall ignore the request to set it.', () => {
    let refused = 0;
    let belowFloor = 0;
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const before = [...walked.phase.draft];
      const carries = carriesOf(walked.snap);
      const ceiling = runStartOf(item.board, item.state, walked.phase).heads;
      const wrong = [0, -1, ceiling + 1, ceiling + 7].filter(
        (count) => !carries.includes(count),
      );
      // Plus every count under the floor, which is where a derived offer drifts.
      for (let count = 1; count < (carries[0] ?? 1); count += 1) {
        wrong.push(count);
        belowFloor += 1;
      }
      for (const count of wrong) {
        const snap = walked.selected.mode.setCarry(count);
        expect(draftOf(snap), `${item.label} at ${String(count)}`).toEqual(before);
        refused += 1;
      }
    }
    expect(refused).toBeGreaterThan(10);
    // Non-vacuity: a floor above one is where a derived offer drifts, so at least
    // one case in the bank has to have counts below its floor to refuse.
    expect(belowFloor).toBeGreaterThan(0);
  });

  // P35 invariants 11 and 13 are superseded by P77 (board-selection-model,
  // invariant 1): no click applies a move. Both are kept inverted — the forced
  // count is still drafted and asked, and Send emits exactly what the click drew.
  it('11 (inverted by P77). When a click yields a one-run draft with one legal count and an empty clickable set, the adapter shall draft it, render the control and apply nothing.', () => {
    // `2^(k-1)` heads walking exactly `k` steps: the count is forced and the
    // allowance is spent, for k = 1, 2, 3, 4.
    for (const k of [1, 2, 3, 4]) {
      const heads = 2 ** (k - 1);
      const state = openField(from, heads);
      const target = arrowAlong(geometry, from, 0, k);
      // The premise, measured: exactly one count walks the whole run.
      expect(
        countsThatWalk(rules, state, from, raySlotWalk(geometry, from, 0, k)),
        `k=${String(k)}`,
      ).toEqual([heads]);
      const selected = selectRoute(board, state, from);
      const snap = clickArrow(selected, target);
      expect(snap.phase.kind, `k=${String(k)}`).toBe('route');
      expect(pendingOf(snap), `k=${String(k)}`).toHaveLength(0);
      expect(draftOf(snap), `k=${String(k)}`).toHaveLength(k);
      expect(controlShown(snap), `k=${String(k)}`).toBe(true);
    }
  });

  it('12. When a click yields a draft failing any of those three conditions, the adapter shall render the control and apply nothing.', () => {
    const failing: readonly { readonly label: string; readonly heads: number; readonly plan: readonly Leg[] }[] = [
      { label: 'several legal counts', heads: 8, plan: [{ slot: 0, index: 0 }] },
      { label: 'a count that is not forced', heads: 4, plan: [{ slot: 0, index: 1 }] },
      { label: 'two runs', heads: 8, plan: [{ slot: 0, index: 0 }, { slot: 0, index: 2 }] },
    ];
    for (const item of failing) {
      const state = openField(from, item.heads);
      const untouched = openField(from, item.heads);
      const walked = walkPlan(
        { label: item.label, board, state, from, plan: item.plan },
        item.plan,
      );
      expect(walked.runs, item.label).toBe(item.plan.length);
      expect(controlShown(walked.snap), item.label).toBe(true);
      expect(pendingOf(walked.snap), item.label).toHaveLength(0);
      expect(state, item.label).toEqual(untouched);
    }
  });

  it('13 (inverted by P77). After a forced-count click, Send shall place in `pending` exactly the moves the click drafted.', () => {
    for (const k of [1, 2, 3, 4]) {
      const heads = 2 ** (k - 1);
      const state = openField(from, heads);
      const target = arrowAlong(geometry, from, 0, k);
      const selected = selectRoute(board, state, from);
      // The run the offer named, at the count the click drafts it with.
      const expected = runMoves(from, optionFor(selected.snap, target).steps, heads);
      expect(pendingOf(clickArrow(selected, target)), `k=${String(k)}`).toHaveLength(0);
      expect(pendingOf(selected.mode.send()), `k=${String(k)}`).toEqual(expected);
    }
  });

  it('14. While the match is over or input is locked, the adapter shall render no count control.', () => {
    let checked = 0;
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      expect(controlShown(walked.snap), `${item.label}: playing`).toBe(true);
      expect(controlShown(walked.snap, { matchOver: true }), `${item.label}: over`).toBe(false);
      expect(controlShown(walked.snap, { inputLocked: true }), `${item.label}: locked`).toBe(false);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('15. The count control’s model shall carry no viewport, stage or tip coordinate, and shall be identical at every viewport width.', () => {
    const walked = walkPlan({
      label: 'one run of two',
      board,
      state: openField(from, 8),
      from,
      plan: [{ slot: 0, index: 1 }],
    });
    const control = controlOf(walked.snap);
    expect(control).toBeDefined();
    expect(Object.keys(control ?? {}).toSorted()).toEqual([
      'ceiling',
      'count',
      'counts',
      'draftLength',
      // P77: where the last run began — an arrow, not a coordinate.
      'start',
    ]);
    // `countControl` takes no viewport, so "identical at every width" is a
    // property of its signature; asserted here as the same model twice over.
    const again = controlOf(walkPlan({
      label: 'one run of two',
      board,
      state: openField(from, 8),
      from,
      plan: [{ slot: 0, index: 1 }],
    }).snap);
    expect(control).toEqual(again);
    const dock = readSource('RouteDock.tsx');
    // Whole words: P77's `leftoverNote` is copy, not a position (board-selection-model).
    for (const positional of ['x:', 'y:', 'left', 'top', 'toScreen', 'viewport', 'stage']) {
      expect(dock, positional).not.toMatch(new RegExp(`\\b${positional}(?![a-z])`));
    }
    const route = readSource('route.ts');
    for (const positional of ['toScreen', 'viewport', 'Viewport']) {
      expect(route, positional).not.toContain(positional);
    }
  });

  it('16. Send shall emit the draft in order regardless of how many runs it holds.', () => {
    let sent = 0;
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const draft = [...walked.phase.draft];
      const after = walked.selected.mode.send();
      expect(pendingOf(after), item.label).toEqual(draft);
      expect(after.phase.kind, item.label).toBe('idle');
      sent += 1;
    }
    expect(sent).toBeGreaterThan(6);
  });

  it('17. Cancel and a background click shall leave the game state unchanged.', () => {
    for (const item of CASES) {
      const before = structuredClone(item.state);
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const cancelled = walked.selected.mode.cancel();
      expect(pendingOf(cancelled), item.label).toHaveLength(0);
      expect(item.state, item.label).toEqual(before);
      const second = walkPlan(item);
      const background = second.selected.mode.onBackgroundClick();
      expect(pendingOf(background), item.label).toHaveLength(0);
      expect(item.state, item.label).toEqual(before);
    }
  });

  it('18. The entries of `runLengths` shall sum to `draft.length`.', () => {
    let checked = 0;
    let positive = 0;
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const seen: InputSnapshot[] = [walked.snap];
      // Every pop along the draft, and a count change at each stop.
      for (const arrow of exitsOf(walked.phase.draft)) {
        seen.push(clickArrow(walked.selected, arrow));
        const carries = carriesOf(seen[seen.length - 1] ?? walked.snap);
        const lowest = carries[0];
        if (lowest !== undefined) seen.push(walked.selected.mode.setCarry(lowest));
      }
      for (const snap of seen) {
        if (snap.phase.kind !== 'route') continue;
        const phase = routePhaseOf(snap);
        const sum = phase.runLengths.reduce((total, run) => total + run, 0);
        expect(sum, item.label).toBe(phase.draft.length);
        for (const run of phase.runLengths) expect(run, item.label).toBeGreaterThan(0);
        if (phase.runLengths.length > 0) positive += 1;
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(15);
    // Non-vacuity: an always-empty list sums to zero and never disagrees.
    expect(positive).toBeGreaterThan(10);
  });

  it('19. `runLengths` shall be empty if and only if the draft is empty.', () => {
    let checked = 0;
    for (const item of CASES) {
      const selected = selectRoute(item.board, item.state, item.from);
      expect(runLengthsOf(selected.snap), `${item.label}: fresh`).toEqual([]);
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      expect(walked.phase.runLengths.length, item.label).toBeGreaterThan(0);
      const popped = clickArrow(walked.selected, item.from);
      expect(draftOf(popped), item.label).toHaveLength(0);
      expect(runLengthsOf(popped), item.label).toEqual([]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('20. After a pop to a walked arrow, the last entry of `runLengths` shall describe the run ending at that arrow, truncated where the arrow falls inside a run.', () => {
    let popped = 0;
    for (const item of CASES) {
      if (item.plan.length < 2) continue;
      const firstLeg = walkPlan(item, item.plan.slice(0, 1));
      if (firstLeg.runs === 0) continue;
      const boundary = firstLeg.phase.tip;
      const firstRunLength = runLength(firstLeg.phase);
      expect(firstRunLength, `${item.label}: no run recorded`).toBeGreaterThan(0);
      const both = walkPlan(item);
      if (both.runs < 2) continue;
      const back = clickArrow(both.selected, boundary);
      expect(routePhaseOf(back).tip, item.label).toBe(boundary);
      expect(runLengthsOf(back), item.label).toEqual([firstRunLength]);
      // …and the counts on offer are the first run's again.
      expect(carriesOf(back), item.label).toEqual(carriesOf(firstLeg.snap));
      popped += 1;
    }
    expect(popped).toBeGreaterThan(1);
    // A pop *inside* a run truncates it: three steps, back to the first.
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, arrowAlong(geometry, from, 0, 3));
    const inside = clickArrow(selected, arrowAlong(geometry, from, 0, 1));
    expect(runLengthsOf(inside)).toEqual([1]);
    expect(carriesOf(inside)).toEqual(
      countsThatWalk(rules, state, from, [arrowAlong(geometry, from, 0, 1)]),
    );
  });

  it('21. `runCarries` shall account for the allowance already spent by the movers, by measuring on the scratch state rather than from a formula.', () => {
    // Two steps, then two more. A formula on the count alone would floor the
    // second run at 2 (`speed(2) = 2`); the engine floors it at 8, because the
    // movers arrive having already spent two.
    const state = openField(from, 16);
    const selected = selectRoute(board, state, from);
    const second = arrowAlong(geometry, from, 0, 2);
    const onward = raySlotWalk(geometry, second, 1, 2);
    const target = onward[1];
    expect(target).toBeDefined();
    if (target === undefined) return;
    clickArrow(selected, second);
    const snap = clickArrow(selected, target);
    const start = runStartOf(board, state, routePhaseOf(snap));
    expect(start.heads).toBe(16);
    expect(carriesOf(snap)).toEqual(countsThatWalk(rules, start.state, start.start, onward));
    expect(carriesOf(snap)[0]).toBe(8);
    // The same two steps from an unspent tip floor at 2, which is the difference.
    expect(countsThatWalk(rules, state, from, raySlotWalk(geometry, from, 0, 2))[0]).toBe(2);
  });

  // The auto-apply verdict left this invariant with `autoApplies` (P77).
  it('22. Equal inputs shall produce an equal offer and an equal paint.', () => {
    for (const item of CASES) {
      const left = walkPlan(item);
      const right = walkPlan(item);
      if (left.runs === 0) continue;
      expect(left.phase.draft, item.label).toEqual(right.phase.draft);
      expect(left.phase.runLengths, item.label).toEqual(right.phase.runLengths);
      expect(carriesOf(left.snap), item.label).toEqual(carriesOf(right.snap));
      expect(controlOf(left.snap), item.label).toEqual(controlOf(right.snap));
      expect(sortedIds(left.phase.offer.clickable.keys()), item.label).toEqual(
        sortedIds(right.phase.offer.clickable.keys()),
      );
      const paintOf = (phase: RoutePhase) => routePaint({ phase, pointer: 'fine' });
      expect(sortedIds(paintOf(left.phase).rayArrows), item.label).toEqual(
        sortedIds(paintOf(right.phase).rayArrows),
      );
      expect(paintOf(left.phase).draftArrows.map(String), item.label).toEqual(
        paintOf(right.phase).draftArrows.map(String),
      );
    }
  });

  it('23. `route.ts` shall reference neither a clock nor a random source.', () => {
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
});

describe('P35 invariants — the case bank is non-vacuous', () => {
  it('every case drafts at least one run and offers at least one count', () => {
    const thin: string[] = [];
    for (const walked of drafted()) {
      if (carriesOf(walked.snap).length === 0) thin.push(walked.label);
    }
    expect(drafted()).toHaveLength(CASES.length);
    expect(thin).toEqual([]);
  });

  it('heads are conserved by the drafts the bank walks', () => {
    for (const item of CASES) {
      const walked = walkPlan(item);
      if (walked.runs === 0) continue;
      const sent = pendingOf(walked.selected.mode.send());
      let applied = item.state;
      for (const move of sent) applied = item.board.rules.apply(applied, move);
      const mine = (state: GameState): number =>
        [...state.groups.values()]
          .filter((group) => group.owner === A)
          .reduce((sum, group) => sum + group.heads, 0);
      // The bank's only fight is 7 against 2, which the attacker wins intact
      // (§6.2's threat weighting), so every head that set out is still standing.
      expect(mine(applied), item.label).toBe(mine(item.state));
      expect(headsOn(applied, walked.phase.tip), item.label).toBeGreaterThan(0);
    }
  });
});
