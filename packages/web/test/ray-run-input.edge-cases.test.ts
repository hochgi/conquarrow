/**
 * P34 edge cases — `docs/spec/ray-run-input/ray-run-input.edge-cases.feature`.
 *
 * 48 scenarios, 52 cases: two `Scenario Outline`s carry three examples each.
 *
 * Two rules here are the ones phase 1 ratified after phase 2 kicked them back,
 * and both are now tested as stated rather than as read:
 *
 * - **The stay-behind bounds where a run can attack** (§6.2 / §11 item 38). A run
 *   moves the whole carry, so after its first hop `count = heads` at the tip. A
 *   ray therefore ends *before* an enemy-held arrow at distance ≥ 2, and an
 *   adjacent one is walkable only at `count ≤ tipHeads − 1` — which is why, since
 *   P35, the *offer* arms the attack by walking the run at one head fewer.
 * - **Terminal steps end the draft.** A merge, a closure or resolved combat
 *   changes the board the un-applied draft is drawn against, so the clickable set
 *   from that tip is empty: Send or pop, nothing else. Detected by diffing the
 *   scratch state across the hop — the closure case cannot come from
 *   `try apply … else stop`, because the engine accepts the hop after it.
 */

import { describe, expect, it } from 'vitest';
import { endTurn, speed, step } from '@conquarrow/contracts';
import type { GameState } from '@conquarrow/contracts';
import { SPACIOUS, fixtureArrow } from '@conquarrow/geometry-fixtures';
import { playHighlightsAllowed, victoryFx } from '../src/fx/victory';
import { refusedConvertExits } from '../src/refusedConvert';
import { buildRouteOffer, isTerminalStep, routePaint } from '../src/route';
import { selectionPaint } from '../src/selectionChrome';
import { inputsFromPhase } from './count-after-route.support';
import {
  A,
  B,
  acceptedRunLength,
  alongSlots,
  applyOnce,
  arrowAlong,
  blankState,
  clickArrow,
  clickableOf,
  countingRules,
  draftOf,
  draftToTerminalTip,
  exitOf,
  exitsOf,
  fixtureBoard,
  geometry,
  headsOn,
  hopAccepted,
  inputsAfter,
  inputsAt,
  legalSeats,
  openField,
  optionFor,
  pendingOf,
  rayOf,
  raySlotWalk,
  refusedConvertFixture,
  refusingRules,
  routePhaseOf,
  routeSource,
  rules,
  selectOpenField,
  selectRoute,
  shortestRoutes,
  sortedIds,
  sourceArrow,
  stateWith,
  terminalFixtures,
  uniqueRouteSet,
  walkSteps,
  withRouteCount,
} from './ray-run-input.support';

const board = { geometry, rules };
const from = sourceArrow(geometry);
const SLOTS = [0, 1, 2] as const;

const first = arrowAlong(geometry, from, 0, 1);
const second = arrowAlong(geometry, from, 0, 2);
const third = arrowAlong(geometry, from, 0, 3);
const fourth = arrowAlong(geometry, from, 0, 4);

describe('P34 edge — a ray stops where the engine stops, and is never painted past it', () => {
  it('A ray ends before an enemy-held arrow two or more steps out', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [third, { owner: B, heads: 2 }],
    ]);
    // The carry is every head at the tip, so no hop of this run may attack.
    const offer = buildRouteOffer(inputsAt(board, state, from, 8));
    expect((offer.rays[0] ?? []).map(String)).toEqual([String(first), String(second)]);
    expect(offer.clickable.has(third)).toBe(false);
    expect(offer.clickable.has(fourth)).toBe(false);
  });

  it('An enemy-held arrow one step out is offered when a sentry stays behind', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [first, { owner: B, heads: 2 }],
    ]);
    const offer = buildRouteOffer(inputsAt(board, state, from, 7));
    const option = offer.clickable.get(first);
    expect(option).toBeDefined();
    expect(option?.kind).toBe('ray');
    expect(option?.slot).toBe(0);
    expect(option?.steps).toHaveLength(1);
  });

  /**
   * **Revised by P35.** P34 withdrew an adjacent enemy arrow while the carry
   * equalled the heads at the tip, because the carry was chosen *before* the
   * click. P35 removes that gesture, so the offer arms the attack instead: the
   * arrow is clickable because *some* count reaches it, and the run drafts at
   * `heads - 1`. The withdrawal it used to assert would now make attacking
   * unreachable altogether.
   */
  it('An enemy-held arrow one step out is offered at full strength, armed at one head fewer', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [first, { owner: B, heads: 2 }],
    ]);
    const offer = buildRouteOffer(inputsAt(board, state, from, 8));
    expect(offer.clickable.has(first)).toBe(true);
    expect((offer.rays[0] ?? []).map(String)).toEqual([String(first)]);
    // A terminal step, so the ray stops on it and the other two still run.
    expect((offer.rays[1] ?? []).length).toBeGreaterThan(0);
    expect((offer.rays[2] ?? []).length).toBeGreaterThan(0);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, first);
    const drafted = draftOf(snap)[0];
    expect(drafted?.kind).toBe('step');
    if (drafted?.kind !== 'step') return;
    expect(drafted.count).toBe(7);
  });

  /**
   * **Revised by P35.** P34 refused this click and named the stay-behind, because
   * the carry had to be lowered before clicking. P35 arms the attack from the
   * count *after* the click, so the click drafts a run at `heads - 1` and there
   * is nothing to refuse. The `needs-stay-behind` reason is retired with the
   * gesture it described: the states it could still be reached from — a terminal
   * tip, the depth cap — are ones where no count makes the arrow clickable, so it
   * would have named a fix that does not exist. They answer `out-of-reach`.
   */
  it('An adjacent enemy click drafts the attack instead of refusing it', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [first, { owner: B, heads: 2 }],
    ]);
    const selected = selectRoute(board, state, from);
    expect(selected.phase.carry).toBe(8);
    const snap = clickArrow(selected, first);
    expect(snap.refusal).toBeUndefined();
    expect(draftOf(snap)).toHaveLength(1);
    const drafted = draftOf(snap)[0];
    expect(drafted?.kind).toBe('step');
    if (drafted?.kind !== 'step') return;
    expect(drafted.count).toBe(7);
    // Still nothing applied — a drafted attack is a draft.
    expect(pendingOf(snap)).toHaveLength(0);
  });

  it('A ray stops at a merge, and the merge arrow is clickable', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [second, { owner: A, heads: 1 }],
    ]);
    const offer = buildRouteOffer(inputsAt(board, state, from, 8));
    expect((offer.rays[0] ?? []).map(String)).toEqual([String(first), String(second)]);
    expect(offer.clickable.has(second)).toBe(true);
    expect(offer.clickable.has(third)).toBe(false);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, second);
    expect(draftOf(snap)).toHaveLength(2);
    expect(exitsOf(draftOf(snap)).map(String)).toEqual([String(first), String(second)]);
  });

  it('A ray stops where a closure lands mid-path', () => {
    const state = stateWith([[from, { owner: A, heads: 8 }]], {
      territory: new Map([
        [from, A],
        [second, A],
      ]),
      trails: new Map([[A, new Set([from])]]),
    });
    const offer = buildRouteOffer(inputsAt(board, state, from, 8));
    expect((offer.rays[0] ?? []).map(String)).toEqual([String(first), String(second)]);
    expect(offer.clickable.has(third)).toBe(false);
    // The engine takes the next hop; the offer withholds it because the closure
    // already changed the board the draft is drawn against.
    const after = walkSteps(board, state, from, [first, second], 8);
    expect(hopAccepted(board, after.state, second, third, 8)).toBe(true);
  });

  it('A ray stops at enemy territory without territory-grade protection', () => {
    // The trail on the source is what makes "no territory-grade anchor" *askable*:
    // `anchorGrade` refuses an arrow that is not in the trail at all, so a
    // trail-less stack cannot answer the question the scenario's Given asks.
    const state = stateWith([[from, { owner: A, heads: 8 }]], {
      territory: new Map([[second, B]]),
      trails: new Map([[A, new Set([from])]]),
    });
    expect(rules.anchorGrade(state, from, A)).not.toBe('territory');
    const offer = buildRouteOffer(inputsAt(board, state, from, 8));
    expect((offer.rays[0] ?? []).map(String)).toEqual([String(first)]);
    expect(offer.clickable.has(second)).toBe(false);
  });

  it('A ray stops at a refused self-convert exit', () => {
    // Grain-adjacent, because the P28 wash names the source's own exits.
    const { state, from: source, refused } = refusedConvertFixture();
    const offer = buildRouteOffer(inputsAt(board, state, source, 8));
    expect((offer.rays[0] ?? []).map(String)).toEqual([]);
    expect(offer.clickable.has(refused)).toBe(false);
    expect(refusedConvertExits(state, geometry, rules, source).has(refused)).toBe(true);
    expect((offer.rays[1] ?? []).length).toBeGreaterThan(0);
    expect((offer.rays[2] ?? []).length).toBeGreaterThan(0);
  });

  it('A ray stops when allowance runs out', () => {
    const state = openField(from, 4);
    const offer = buildRouteOffer(inputsAt(board, state, from, 4));
    expect(speed(4)).toBe(3);
    for (const slot of SLOTS) {
      const ray = offer.rays[slot] ?? [];
      expect(ray.length, `slot ${String(slot)}`).toBe(
        acceptedRunLength(board, state, from, slot, 4),
      );
    }
  });

  it('Clicking past a ray’s stop refuses', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [third, { owner: B, heads: 2 }],
    ]);
    const selected = selectRoute(board, state, from);
    expect(rayOf(selected.snap, 0)).toHaveLength(2);
    const snap = clickArrow(selected, fourth);
    expect(snap.refusal?.arrow).toBe(fourth);
    expect(snap.refusal?.reason).toBe('out-of-reach');
    expect(draftOf(snap)).toHaveLength(0);
    expect(pendingOf(snap)).toHaveLength(0);
  });

  it('A truncated ray still offers its turn arrows', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [third, { owner: B, heads: 2 }],
    ]);
    const offer = buildRouteOffer(inputsAt(board, state, from, 8));
    for (const m of [1, 2]) {
      const rayArrow = arrowAlong(geometry, from, 0, m);
      for (const turnSlot of [1, 2] as const) {
        const turn = exitOf(geometry, rayArrow, turnSlot);
        const option = offer.clickable.get(turn);
        const where = `turn ${String(turnSlot)} off slot 0@${String(m)}`;
        expect(option, where).toBeDefined();
        expect(option?.kind, where).toBe('turn');
      }
    }
  });

  it('A turn arrow the engine refuses is not offered', () => {
    const turn = alongSlots(geometry, from, [0, 0, 1]);
    const state = stateWith([[from, { owner: A, heads: 8 }]], {
      territory: new Map([[turn, B]]),
    });
    const offer = buildRouteOffer(inputsAt(board, state, from, 8));
    expect((offer.rays[0] ?? []).length).toBe(4);
    expect(offer.clickable.has(turn)).toBe(false);
  });

  it.each(SLOTS)('One ray truncates and the others do not (slot %i)', (blocked) => {
    const blocker = arrowAlong(geometry, from, blocked, 1);
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [blocker, { owner: A, heads: 1 }],
    ]);
    const offer = buildRouteOffer(inputsAt(board, state, from, 8));
    const baseline = buildRouteOffer(inputsAt(board, openField(from, 8), from, 8));
    expect((offer.rays[blocked] ?? []).map(String)).toEqual([String(blocker)]);
    for (const slot of SLOTS) {
      if (slot === blocked) continue;
      expect((offer.rays[slot] ?? []).map(String), `slot ${String(slot)}`).toEqual(
        (baseline.rays[slot] ?? []).map(String),
      );
    }
  });
});

describe('P34 edge — a terminal step ends the draft, because the board it changed is not on screen', () => {
  const fixtures = terminalFixtures();

  it.each(fixtures.map((fixture) => [fixture.label, fixture] as const))(
    'A terminal tip offers nothing further (%s)',
    (_label, fixture) => {
      const { snap } = draftToTerminalTip(fixture);
      const phase = routePhaseOf(snap);
      expect(phase.draft).toHaveLength(fixture.draftLength);
      // The hop was accepted and it is terminal — so the offer stops here.
      const walked = exitsOf(phase.draft);
      const last = walked[walked.length - 1];
      expect(last).toBeDefined();
      if (last === undefined) return;
      expect(phase.tip).toBe(last);
      expect(phase.offer.clickable.size).toBe(0);
      for (const slot of SLOTS) expect(rayOf(snap, slot)).toHaveLength(0);

      // The draft may still be sent…
      const sending = draftToTerminalTip(fixture);
      const sent = pendingOf(sending.selected.mode.send());
      expect(sent).toEqual([...routePhaseOf(sending.snap).draft]);

      // …and may still be popped.
      const popping = draftToTerminalTip(fixture);
      const popped = clickArrow(popping.selected, fixture.popTarget);
      expect(popped.phase.kind).toBe('route');
      expect(draftOf(popped)).toHaveLength(fixture.poppedLength);
    },
  );

  it('A click from a terminal tip refuses', () => {
    const closure = fixtures.find((fixture) => fixture.label === 'completes a closure');
    expect(closure).toBeDefined();
    if (closure === undefined) return;
    const { selected, snap } = draftToTerminalTip(closure);
    const before = [...draftOf(snap)];
    const oneStepOn = exitOf(geometry, routePhaseOf(snap).tip, 0);
    const refused = clickArrow(selected, oneStepOn);
    expect(refused.refusal?.arrow).toBe(oneStepOn);
    expect(refused.refusal?.reason).toBe('out-of-reach');
    expect(draftOf(refused)).toEqual(before);
    expect(pendingOf(refused)).toHaveLength(0);
  });

  it('Sending from a terminal tip emits the whole draft', () => {
    // A two step route whose second step merges.
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [second, { owner: A, heads: 3 }],
    ]);
    const selected = selectRoute(board, state, from);
    const drafted = clickArrow(selected, second);
    const draft = [...draftOf(drafted)];
    expect(draft).toHaveLength(2);
    expect(routePhaseOf(drafted).offer.clickable.size).toBe(0);
    const sent = pendingOf(selected.mode.send());
    expect(sent).toEqual(draft);
  });

  it('Popping off a terminal tip restores a live tip', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [second, { owner: A, heads: 3 }],
    ]);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, second);
    const popped = clickArrow(selected, first);
    expect(draftOf(popped)).toHaveLength(1);
    expect(routePhaseOf(popped).tip).toBe(first);
    expect(clickableOf(popped).size).toBeGreaterThan(0);
  });
});

describe('P34 edge — the clickable set is exactly the unique-route set', () => {
  const openState = openField(from, 8);
  const counts = shortestRoutes(board, openState, from, 8);

  it('An arrow needing two runs is not clickable', () => {
    const twoRuns = withRouteCount(counts, 3, 2);
    const offer = buildRouteOffer(inputsAt(board, openState, from, 8));
    expect(offer.clickable.size).toBeGreaterThan(0);
    expect(offer.clickable.has(twoRuns)).toBe(false);
  });

  it('Every clickable arrow has exactly one shortest route', () => {
    const offer = buildRouteOffer(inputsAt(board, openState, from, 8));
    expect(offer.clickable.size).toBe(30);
    for (const [arrow, option] of offer.clickable) {
      const count = counts.get(arrow);
      expect(count, String(arrow)).toBeDefined();
      expect(count?.routes, String(arrow)).toBe(1);
      expect(option.steps.length, String(arrow)).toBe(count?.distance);
    }
  });

  it('Every unique-route arrow is clickable', () => {
    const offer = buildRouteOffer(inputsAt(board, openState, from, 8));
    const unique = uniqueRouteSet(counts);
    expect(unique.size).toBeGreaterThan(0);
    expect(sortedIds([...unique].filter((arrow) => !offer.clickable.has(arrow)))).toEqual([]);
    expect(sortedIds(offer.clickable.keys())).toEqual(sortedIds(unique));
  });

  it('Clicking a reachable but ambiguous arrow refuses', () => {
    const ambiguous = alongSlots(geometry, from, [0, 0, 1, 1]);
    expect(counts.get(ambiguous)?.routes).toBe(3);
    const selected = selectRoute(board, openField(from, 8), from);
    const snap = clickArrow(selected, ambiguous);
    expect(snap.refusal?.arrow).toBe(ambiguous);
    expect(snap.refusal?.reason).toBe('out-of-reach');
    expect(draftOf(snap)).toHaveLength(0);
  });

  it('The ambiguous arrow becomes clickable after one run is drafted', () => {
    const ambiguous = alongSlots(geometry, from, [0, 0, 1, 1]);
    const selected = selectRoute(board, openField(from, 8), from);
    const snap = clickArrow(selected, second);
    // Its remaining route is one run of two along slot 1.
    const option = optionFor(snap, ambiguous);
    expect(option.kind).toBe('ray');
    expect(option.steps).toHaveLength(2);
  });

  it('An arrow on both a ray and a turn keeps its shorter route', () => {
    // On a fixture board a slot carries no geometry, so `s^2` and `t^2·e` can
    // coincide — which the tiling's linear lattice forbids.
    const fixture = fixtureBoard(SPACIOUS);
    const source = fixtureArrow(SPACIOUS, '0', '1');
    const both = fixtureArrow(SPACIOUS, '2', '3');
    expect(String(arrowAlong(fixture.geometry, source, 0, 2))).toBe(String(both));
    expect(String(alongSlots(fixture.geometry, source, [1, 1, 0]))).toBe(String(both));
    const state: GameState = legalSeats({
      ...blankState(),
      groups: new Map([[source, { owner: A, heads: 4, spent: 0 }]]),
    });
    const offer = buildRouteOffer(inputsAt(fixture, state, source, 4));
    const option = offer.clickable.get(both);
    expect(option).toBeDefined();
    expect(option?.steps).toHaveLength(2);
    expect(option?.kind).toBe('ray');
    expect(option?.slot).toBe(0);
  });

  it('A ray that would revisit one of its own arrows stops', () => {
    const fixture = fixtureBoard(SPACIOUS);
    const source = fixtureArrow(SPACIOUS, '0', '7');
    const state: GameState = legalSeats({
      ...blankState(),
      groups: new Map([[source, { owner: A, heads: 16, spent: 0 }]]),
    });
    // Allowance is five steps, but the fifth hop re-enters the ray's first arrow.
    expect(fixture.rules.effectiveSpeed(state, source)).toBe(5);
    const offer = buildRouteOffer(inputsAt(fixture, state, source, 16));
    const ray = offer.rays[0] ?? [];
    expect(ray).toHaveLength(4);
    expect(new Set(ray).size).toBe(ray.length);
    const repeat = arrowAlong(fixture.geometry, source, 0, 1);
    expect(ray.filter((arrow) => arrow === repeat)).toHaveLength(1);
  });

  it('A ray that would revisit a drafted arrow stops', () => {
    const fixture = fixtureBoard(SPACIOUS);
    const source = fixtureArrow(SPACIOUS, '0', '7');
    const state: GameState = legalSeats({
      ...blankState(),
      groups: new Map([[source, { owner: A, heads: 16, spent: 0 }]]),
    });
    const walked = raySlotWalk(fixture.geometry, source, 0, 2);
    const offer = buildRouteOffer(inputsAfter(fixture, state, source, walked, 16));
    const ray = offer.rays[0] ?? [];
    const drafted = walked[0];
    expect(drafted).toBeDefined();
    if (drafted === undefined) return;
    expect(ray).toHaveLength(2);
    expect(ray.map(String)).not.toContain(String(drafted));
  });
});

describe('P34 edge — popping and extending compose without leaking state', () => {
  /**
   * **Revised by P35.** Four steps off *eight* heads is a forced count and a spent
   * allowance, so the click applies instead of drafting (*Auto-apply — the exact
   * test*). Twelve walks the same four arrows with a count still to choose, which
   * is what these pop scenarios are about.
   */
  const POPS_FROM_FOUR = 12;

  const draftFourThenPop = () => {
    const selected = selectOpenField(POPS_FROM_FOUR);
    const full = clickArrow(selected, fourth);
    const original = [...draftOf(full)];
    const popped = clickArrow(selected, second);
    return { selected, original, popped };
  };

  it('Extending after a pop uses the restored tip', () => {
    const { selected, original } = draftFourThenPop();
    const snap = clickArrow(selected, arrowAlong(geometry, second, 1, 2));
    expect(draftOf(snap)).toHaveLength(4);
    expect(draftOf(snap).slice(0, 2)).toEqual(original.slice(0, 2));
  });

  it('Popping twice returns to an empty draft', () => {
    const { selected } = draftFourThenPop();
    const snap = clickArrow(selected, from);
    expect(draftOf(snap)).toHaveLength(0);
    expect(snap.phase.kind).toBe('route');
  });

  it('Popping then cancelling applies nothing', () => {
    const state = openField(from, POPS_FROM_FOUR);
    const before = openField(from, POPS_FROM_FOUR);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, fourth);
    clickArrow(selected, second);
    const snap = selected.mode.cancel();
    expect(pendingOf(snap)).toHaveLength(0);
    expect(state).toEqual(before);
  });

  it('Popping restores the tip head count from the state after the shorter draft', () => {
    // A two step route whose second step merges into a stack of 3, at a carry of 8.
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [second, { owner: A, heads: 3 }],
    ]);
    const selected = selectRoute(board, state, from);
    const merged = clickArrow(selected, second);
    expect(routePhaseOf(merged).carry).toBe(8);
    expect(routePhaseOf(merged).tipHeads).toBe(11);
    const popped = clickArrow(selected, first);
    expect(draftOf(popped)).toHaveLength(1);
    expect(routePhaseOf(popped).tipHeads).toBe(8);
  });

  /**
   * **Revised by P35.** P34's carry rode across a pop because it was a
   * forward-only choice made before the click. P35's count belongs to the run it
   * was set on, so a pop restores the count of the run it lands in — here the
   * truncated first run, still at the full strength it was drafted with.
   */
  it('A pop restores the count of the run it lands in', () => {
    const selected = selectRoute(board, openField(from, 12), from);
    clickArrow(selected, fourth);
    const popped = clickArrow(selected, second);
    expect(routePhaseOf(popped).carry).toBe(12);
    // The one run it was drafted as, truncated by the pop (P35 `runLengths`).
    expect(routePhaseOf(popped).runLengths).toEqual([2]);
  });
});

/**
 * **Revised by P35.** P34's rule was *forward-only*: a carry change never touched
 * a drafted move. P35 keeps exactly half of that — earlier runs stay
 * byte-identical — and repeals the other half, because the whole feature is that
 * the count addresses the run **behind** the click. The scenarios below are the
 * P34 ones with that one clause moved; the full statements live in
 * `count-after-route.invariants.test.ts` (invariants 7 and 8).
 */
describe('P34 edge — the carry rewrites the last run and nothing earlier', () => {
  it('Lowering the carry mid-route leaves earlier runs alone', () => {
    const selected = selectOpenField(8);
    const drafted = clickArrow(selected, second);
    const original = [...draftOf(drafted)];
    const extended = clickArrow(selected, third);
    expect(draftOf(extended)).toHaveLength(3);
    const lowered = selected.mode.setCarry(4);
    // The first run is untouched…
    expect(draftOf(lowered).slice(0, 2)).toEqual(original);
    // …and the run the count was set on carries the new number.
    const last = draftOf(lowered)[2];
    expect(last?.kind).toBe('step');
    if (last?.kind !== 'step') return;
    expect(last.count).toBe(4);
  });

  it('Lowering the carry mid-route shortens only what is still offered', () => {
    // Sixteen heads, lowered to eight: the tip still has a step left after the
    // rewrite — the point is that the offer *shrinks*, which an empty offer could
    // not show — and the two counts have to straddle an allowance boundary for
    // there to be any shrinking at all, which 12 and 8 do not (`speed` is 4 for
    // both). `speed(16) = 5`, `speed(8) = 4`.
    const selected = selectRoute(board, openField(from, 16), from);
    clickArrow(selected, second);
    const full = clickableOf(clickArrow(selected, third)).size;
    const lowered = selected.mode.setCarry(8);
    const phase = routePhaseOf(lowered);
    expect(phase.tipHeads).toBe(8);
    // Measured against the draft as it now stands — the last run re-emitted at 8.
    const expected = buildRouteOffer(inputsFromPhase(board, selected.state, phase));
    expect(expected.clickable.size).toBeGreaterThan(0);
    expect(expected.clickable.size).toBeLessThan(full);
    expect(sortedIds(clickableOf(lowered).keys())).toEqual(sortedIds(expected.clickable.keys()));
  });

  it("A carry larger than the heads at the run's start is not offerable", () => {
    const selected = selectRoute(board, openField(from, 12), from);
    const snap = clickArrow(selected, first);
    const phase = routePhaseOf(snap);
    expect(phase.tipHeads).toBe(12);
    expect(phase.offer.carries.length).toBeGreaterThan(0);
    // The ceiling is the heads standing where the run began, not at its tip.
    for (const carry of phase.offer.carries) expect(carry).toBeLessThanOrEqual(12);
    const lowered = selected.mode.setCarry(4);
    expect(routePhaseOf(lowered).tipHeads).toBe(4);
    for (const carry of routePhaseOf(lowered).offer.carries) {
      expect(carry).toBeLessThanOrEqual(12);
    }
  });

  it('A carry of every head leaves no sentry', () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    expect(selected.phase.carry).toBe(8);
    clickArrow(selected, first);
    const sent = pendingOf(selected.mode.send());
    let applied = state;
    for (const move of sent) applied = rules.apply(applied, move);
    expect(applied.groups.has(from)).toBe(false);
  });

  it('Splitting twice along one route leaves two sentries', () => {
    // P35 order: click, then count — each run's count set after the click that
    // named it. The emitted list is the one P34 emitted.
    const state = openField(from, 12);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, first);
    selected.mode.setCarry(8);
    clickArrow(selected, second);
    selected.mode.setCarry(4);
    const sent = pendingOf(selected.mode.send());
    expect(sent).toHaveLength(2);
    let applied = state;
    for (const move of sent) applied = rules.apply(applied, move);
    expect(headsOn(applied, from)).toBe(4);
    expect(headsOn(applied, first)).toBe(4);
    expect(headsOn(applied, second)).toBe(4);
  });

  /**
   * **Revised by P35.** The `setCarry(7)` this used to need is gone: the click
   * itself drafts the attack at `heads - 1`, which is the same 7.
   */
  it('Combat on the first hop reduces the tip head count and ends the draft', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [first, { owner: B, heads: 6 }],
    ]);
    const selected = selectRoute(board, state, from);
    const snap = clickArrow(selected, first);
    const phase = routePhaseOf(snap);
    // The surviving count of the attackers that landed, measured by the engine.
    const survivors = headsOn(applyOnce(board, state, from, first, 7), first);
    expect(survivors).toBeLessThan(7);
    expect(phase.tipHeads).toBe(survivors);
    expect(phase.offer.clickable.size).toBe(0);
    const hop = step(from, first, 7);
    expect(isTerminalStep(state, applyOnce(board, state, from, first, 7), hop)).toBe(true);
  });

  it('A merge grows the tip head count above the carry', () => {
    const state = stateWith([
      [from, { owner: A, heads: 8 }],
      [first, { owner: A, heads: 3 }],
    ]);
    const selected = selectRoute(board, state, from);
    expect(selected.phase.carry).toBe(8);
    const snap = clickArrow(selected, first);
    const phase = routePhaseOf(snap);
    expect(phase.tipHeads).toBe(11);
    for (const carry of phase.offer.carries) expect(carry).toBeLessThanOrEqual(11);
  });
});

describe('P34 edge — turn flow and the rest of the app are undisturbed', () => {
  it('Ending the turn discards an open draft', () => {
    const selected = selectOpenField(8);
    clickArrow(selected, second);
    const snap = selected.mode.requestEndTurn();
    expect(pendingOf(snap)).toEqual([endTurn()]);
    expect(snap.phase.kind).toBe('idle');
  });

  it('A sent route reaches the host as one ordered batch', () => {
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    clickArrow(selected, fourth);
    const sent = pendingOf(selected.mode.send());
    expect(sent).toHaveLength(4);
    expect(exitsOf(sent).map(String)).toEqual(raySlotWalk(geometry, from, 0, 4).map(String));
    let applied = state;
    for (const move of sent) applied = rules.apply(applied, move);
    expect(headsOn(applied, fourth)).toBe(8);
  });

  it('Match over drops the route chrome', () => {
    const over: GameState = { ...openField(from, 8), winner: A };
    expect(playHighlightsAllowed(victoryFx(over, geometry))).toBe(false);
    const paint = routePaint({ phase: { kind: 'idle' }, pointer: 'fine' });
    expect(paint.rayArrows.size).toBe(0);
    expect(paint.turnArrows.size).toBe(0);
    expect(paint.draftArrows).toHaveLength(0);
    expect(paint.reachWash.size).toBe(0);
    expect(paint.tip).toBeUndefined();
  });

  it('The refused wash still paints in the route phase', () => {
    const { state, from: source, refused } = refusedConvertFixture();
    const selected = selectRoute(board, state, source);
    expect(refusedConvertExits(state, geometry, rules, source).has(refused)).toBe(true);
    expect(clickableOf(selected.snap).has(refused)).toBe(false);
  });

  it('The selected halo still marks the source', () => {
    const selected = selectOpenField(8);
    expect(selected.snap.highlights.selected).toBe(from);
    const paint = selectionPaint({
      phase: selected.phase,
      highlights: selected.snap.highlights,
      pointer: 'fine',
    });
    expect(paint.selected).toBe(from);
    expect(paint.selectedEmphasis).toBe(true);
  });
});

describe('P34 edge — purity, determinism and cost', () => {
  it('Equal inputs produce an equal clickable set', () => {
    const left = buildRouteOffer(inputsAt(board, openField(from, 8), from, 8));
    const right = buildRouteOffer(inputsAt(board, openField(from, 8), from, 8));
    expect(left.clickable.size).toBeGreaterThan(0);
    expect(sortedIds(left.clickable.keys())).toEqual(sortedIds(right.clickable.keys()));
    for (const [arrow, option] of left.clickable) {
      expect(right.clickable.get(arrow)?.steps.map(String)).toEqual(option.steps.map(String));
      expect(right.clickable.get(arrow)?.kind).toBe(option.kind);
    }
    const state = openField(from, 8);
    const selectedLeft = selectRoute(board, state, from);
    const selectedRight = selectRoute(board, state, from);
    const paintLeft = routePaint({ phase: selectedLeft.phase, pointer: 'fine' });
    const paintRight = routePaint({ phase: selectedRight.phase, pointer: 'fine' });
    expect(sortedIds(paintLeft.rayArrows)).toEqual(sortedIds(paintRight.rayArrows));
    expect(sortedIds(paintLeft.turnArrows)).toEqual(sortedIds(paintRight.turnArrows));
    expect(sortedIds(paintLeft.reachWash)).toEqual(sortedIds(paintRight.reachWash));
  });

  it('The clickable set is built once per change, not per hover', () => {
    const counting = countingRules(rules);
    const instrumented = { geometry, rules: counting.rules };
    const selected = selectRoute(instrumented, openField(from, 8), from);
    expect(counting.calls).toBeGreaterThan(0);
    counting.zero();
    const hovers = [...clickableOf(selected.snap).keys()].slice(0, 6);
    expect(hovers).toHaveLength(6);
    for (const hoverArrow of hovers) {
      routePaint({ phase: selected.phase, pointer: 'fine', hoverArrow });
    }
    expect(counting.calls).toBe(0);
  });

  it('No clock and no randomness', () => {
    const source = routeSource();
    for (const banned of ['Date.now', 'new Date', 'Math.random', 'performance.now', 'crypto']) {
      expect(source.includes(banned), banned).toBe(false);
    }
  });

  it('Offers come from apply, not from speed', () => {
    const state = openField(from, 8);
    const stubborn = {
      geometry,
      rules: refusingRules(rules, (move) => move.exit === second),
    };
    // `speed(8) = 4` would allow four hops; the engine now refuses the second.
    expect(speed(8)).toBe(4);
    expect(acceptedRunLength(board, state, from, 0, 8)).toBe(4);
    const offer = buildRouteOffer(inputsAt(stubborn, state, from, 8));
    expect((offer.rays[0] ?? []).map(String)).toEqual([String(first)]);
    expect(offer.clickable.has(second)).toBe(false);
  });
});
