/**
 * P34 invariants — the EARS statements in
 * `docs/spec/ray-run-input/ray-run-input.md`, one property test each.
 *
 * Twenty of the twenty-one live here. The twenty-first — *while the draft is
 * non-empty and nothing is clickable, show the run-can-go-no-further hint* — is a
 * single string on a single measured tip, so it is asserted where it reads best,
 * in `ray-run-input.core.test.ts`'s *A tip with nothing clickable says the run can
 * go no further*.
 *
 * Properties run over a bank of states rather than one example: the open field at
 * several carries, every truncation the spec names, a drafted prefix, and both
 * fixture boards. Each property asserts non-vacuity first, because an
 * unimplemented helper that returns an empty map satisfies almost any
 * "nothing overlaps" claim.
 *
 * The oracle for "the clickable set is the unique-route set" is an independent
 * enumeration of every walk the engine accepts (`shortestRoutes`), **not** a
 * second copy of the ray construction — otherwise the property would prove
 * nothing. It is asserted on the generated tiling only: on an abstract fixture
 * board a slot carries no geometry, so two different two-letter words can land on
 * the same arrow, and uniqueness is a property of the lattice rather than of the
 * rule.
 *
 * Four of the twenty came out of phase 2's kickback and need their guards most:
 * the stay-behind bound on where a run may attack, the handling of an adjacent
 * enemy arrow the whole carry cannot take, the empty offer at a terminal tip, and
 * the refusal a click on it earns. A terminal tip's offer is *supposed* to be
 * empty, so that property pops the draft back and insists the offer returns —
 * otherwise an unimplemented helper satisfies it by doing nothing.
 */

import { describe, expect, it } from 'vitest';
import { speed, step } from '@conquarrow/contracts';
import type { ArrowId, GameState } from '@conquarrow/contracts';
import { MINIMAL, SPACIOUS, fixtureArrow } from '@conquarrow/geometry-fixtures';
import type { RoutePhase } from '../src/input/modes';
import { buildRouteOffer, clickableSet, isTerminalStep, rayArrows, routePaint } from '../src/route';
import type { RouteInputs, RouteOffer } from '../src/route';
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
  exitsOf,
  fixtureBoard,
  geometry,
  headsOn,
  inputsAfter,
  inputsAt,
  legalSeats,
  openField,
  pendingOf,
  raySlotWalk,
  reachForCarry,
  refusedConvertFixture,
  routePhaseOf,
  routeSource,
  rules,
  selectRoute,
  shortestRoutes,
  sortedIds,
  sourceArrow,
  stateWith,
  terminalFixtures,
  uniqueRouteSet,
  walkSteps,
} from './ray-run-input.support';
import type { Board } from './ray-run-input.support';

const board: Board = { geometry, rules };
const from = sourceArrow(geometry);
const SLOTS = [0, 1, 2] as const;

const spacious = fixtureBoard(SPACIOUS);
const minimal = fixtureBoard(MINIMAL);
const spaciousFrom = fixtureArrow(SPACIOUS, '0', '7');
const minimalFrom = fixtureArrow(MINIMAL, '0', '1');

const soloOn = (owner: typeof A, arrow: ArrowId, heads: number): GameState => (legalSeats({
  ...blankState(),
  groups: new Map([[arrow, { owner, heads, spent: 0 }]]),
}));

interface Case {
  readonly label: string;
  readonly board: Board;
  readonly state: GameState;
  readonly from: ArrowId;
  readonly carry: number;
  /** A drafted prefix, walked at `carry`. Empty for a fresh selection. */
  readonly steps: readonly ArrowId[];
}

const mergeState = (): GameState => (legalSeats({
  ...blankState(),
  groups: new Map([
    [from, { owner: A, heads: 8, spent: 0 }],
    [arrowAlong(geometry, from, 0, 2), { owner: A, heads: 3, spent: 0 }],
  ]),
}));

const enemyState = (): GameState => (legalSeats({
  ...blankState(),
  groups: new Map([
    [from, { owner: A, heads: 12, spent: 0 }],
    [arrowAlong(geometry, from, 1, 1), { owner: B, heads: 2, spent: 0 }],
  ]),
}));

const enemyLandState = (): GameState => ({
  ...openField(from, 8),
  territory: new Map([[arrowAlong(geometry, from, 0, 2), B]]),
});

const closureState = (): GameState => ({
  ...openField(from, 8),
  territory: new Map([
    [from, A],
    [arrowAlong(geometry, from, 0, 2), A],
  ]),
  trails: new Map([[A, new Set([from])]]),
});

/** Open field on the tiling — nothing truncates but allowance. */
const OPEN_CASES: readonly Case[] = [1, 2, 4, 8, 16].map((heads) => ({
  label: `open field, ${String(heads)} heads`,
  board,
  state: openField(from, heads),
  from,
  carry: heads,
  steps: [],
}));

const CASES: readonly Case[] = [
  ...OPEN_CASES,
  { label: 'sentry left behind, 12 heads carrying 8', board, state: openField(from, 12), from, carry: 8, steps: [] },
  { label: 'own group two along slot 0 (merge)', board, state: mergeState(), from, carry: 8, steps: [] },
  { label: 'enemy stack one along slot 1', board, state: enemyState(), from, carry: 8, steps: [] },
  { label: 'enemy territory two along slot 0', board, state: enemyLandState(), from, carry: 8, steps: [] },
  { label: 'closure lands two along slot 0', board, state: closureState(), from, carry: 8, steps: [] },
  {
    label: 'two steps drafted along slot 0',
    board,
    state: openField(from, 8),
    from,
    carry: 8,
    steps: raySlotWalk(geometry, from, 0, 2),
  },
  { label: 'refused self-convert exit', board, state: refusedConvertFixture().state, from, carry: 8, steps: [] },
  {
    label: 'spacious fixture, 16 heads',
    board: spacious,
    state: soloOn(A, spaciousFrom, 16),
    from: spaciousFrom,
    carry: 16,
    steps: [],
  },
  {
    label: 'spacious fixture, two steps drafted',
    board: spacious,
    state: soloOn(A, spaciousFrom, 16),
    from: spaciousFrom,
    carry: 16,
    steps: raySlotWalk(spacious.geometry, spaciousFrom, 0, 2),
  },
  {
    label: 'minimal fixture, 8 heads',
    board: minimal,
    state: soloOn(A, minimalFrom, 8),
    from: minimalFrom,
    carry: 8,
    steps: [],
  },
];

const inputsOf = (item: Case): RouteInputs =>
  item.steps.length === 0
    ? inputsAt(item.board, item.state, item.from, item.carry)
    : inputsAfter(item.board, item.state, item.from, item.steps, item.carry);

const offerOf = (item: Case): RouteOffer => buildRouteOffer(inputsOf(item));

const walkedOf = (item: Case): ReadonlySet<ArrowId> =>
  new Set<ArrowId>([item.from, ...item.steps]);

describe('P34 invariants', () => {
  it('The system shall offer a hop only after `rules.apply` accepted it on a scratch state.', () => {
    let offered = 0;
    for (const item of CASES) {
      const inputs = inputsOf(item);
      const offer = buildRouteOffer(inputs);
      for (const [arrow, option] of offer.clickable) {
        const where = `${item.label}: ${String(arrow)}`;
        expect(option.steps.length, where).toBeGreaterThan(0);
        expect(String(option.steps[option.steps.length - 1]), where).toBe(String(arrow));
        // Throws if the engine would not take one of the hops on offer.
        expect(
          () => walkSteps(item.board, inputs.state, inputs.tip, option.steps, item.carry),
          where,
        ).not.toThrow();
        offered += 1;
      }
    }
    expect(offered).toBeGreaterThan(100);
  });

  it('The system shall paint no ray arrow beyond the first hop the engine refuses or the first terminal step.', () => {
    let checked = 0;
    for (const item of CASES) {
      const inputs = inputsOf(item);
      const offer = buildRouteOffer(inputs);
      for (const slot of SLOTS) {
        const ray = offer.rays[slot] ?? [];
        const accepted = acceptedRunLength(item.board, inputs.state, inputs.tip, slot, item.carry);
        expect(ray.length, `${item.label} slot ${String(slot)}`).toBeLessThanOrEqual(accepted);
        checked += 1;
      }
    }
    // On the open field the two agree exactly: only allowance stops a ray.
    for (const item of OPEN_CASES) {
      const inputs = inputsOf(item);
      const offer = buildRouteOffer(inputs);
      for (const slot of SLOTS) {
        expect((offer.rays[slot] ?? []).length, `${item.label} slot ${String(slot)}`).toBe(
          acceptedRunLength(item.board, inputs.state, inputs.tip, slot, item.carry),
        );
      }
    }
    expect(checked).toBe(CASES.length * 3);
  });

  it('The system shall end a ray before an arrow holding enemy heads at a distance of two or more from the tip.', () => {
    let checked = 0;
    for (const slot of SLOTS) {
      for (const distance of [2, 3, 4]) {
        // Both a carry that empties the tip and one that leaves a sentry: a run
        // moves the whole carry, so neither can attack after its first hop.
        for (const carry of [8, 6]) {
          const enemy = arrowAlong(geometry, from, slot, distance);
          const state = stateWith([
            [from, { owner: A, heads: 8 }],
            [enemy, { owner: B, heads: 2 }],
          ]);
          const ray = rayArrows(inputsAt(board, state, from, carry), slot);
          const where = `slot ${String(slot)} enemy at ${String(distance)} carry ${String(carry)}`;
          expect(ray.map(String), where).not.toContain(String(enemy));
          // Measured: the run ends on the last arrow before the enemy, every time.
          expect(ray.length, where).toBe(distance - 1);
          expect(ray.length, where).toBe(
            acceptedRunLength(board, state, from, slot, carry),
          );
          checked += 1;
        }
      }
    }
    expect(checked).toBe(18);
  });

  /**
   * **Revised by P35.** P34's statement was *while the carry equals the heads at
   * the tip, no enemy arrow is offered* — true of a carry chosen before the
   * click, and fatal after it, because there is no lower carry to choose any
   * more. The corrected rule is by **distance**: an adjacent enemy arrow is
   * offered (armed at `heads - 1`), and one at distance two or more is not,
   * because no single count walks a run whose later step attacks. See
   * `count-after-route.invariants.test.ts` invariants 4 and 7.
   */
  it('The system shall offer an adjacent enemy-held arrow and no more distant one.', () => {
    let checked = 0;
    for (const heads of [2, 4, 8]) {
      for (const slot of SLOTS) {
        for (const distance of [1, 2]) {
          const enemy = arrowAlong(geometry, from, slot, distance);
          const state = stateWith([
            [from, { owner: A, heads }],
            [enemy, { owner: B, heads: 2 }],
          ]);
          const where = `${String(heads)} heads, slot ${String(slot)}, distance ${String(distance)}`;
          const full = clickableSet(inputsAt(board, state, from, heads));
          expect(full.has(enemy), where).toBe(distance === 1);
          if (distance === 1) {
            // The same arrow, measured with a head already left behind.
            const armed = clickableSet(inputsAt(board, state, from, heads - 1));
            expect(armed.has(enemy), `${where} armed`).toBe(true);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBe(18);
    // A lone head still cannot attack at any count.
    const lone = stateWith([
      [from, { owner: A, heads: 1 }],
      [arrowAlong(geometry, from, 0, 1), { owner: B, heads: 2 }],
    ]);
    expect(clickableSet(inputsAt(board, lone, from, 1)).has(arrowAlong(geometry, from, 0, 1))).toBe(
      false,
    );
  });

  it('When a hop merges, closes, or resolves combat, the system shall offer nothing further from that tip.', () => {
    const fixtures = terminalFixtures();
    expect(fixtures).toHaveLength(3);
    for (const fixture of fixtures) {
      const { snap } = draftToTerminalTip(fixture);
      const phase = routePhaseOf(snap);
      expect(phase.draft, fixture.label).toHaveLength(fixture.draftLength);
      expect(phase.offer.clickable.size, fixture.label).toBe(0);
      for (const slot of SLOTS) {
        expect(phase.offer.rays[slot] ?? [], `${fixture.label} slot ${String(slot)}`).toHaveLength(0);
      }

      // The predicate agrees on the hop that ended it.
      const last = phase.draft[phase.draft.length - 1];
      expect(last?.kind, fixture.label).toBe('step');
      if (last === undefined || last.kind !== 'step') continue;
      const prefix = exitsOf(phase.draft.slice(0, -1));
      const before = walkSteps(fixture.board, fixture.state, fixture.from, prefix, fixture.carry);
      const after = fixture.board.rules.apply(before.state, last);
      expect(isTerminalStep(before.state, after, last), fixture.label).toBe(true);

      // Non-vacuity: an empty offer is not the helper being empty — pop back and
      // the offer returns.
      const popping = draftToTerminalTip(fixture);
      const popped = clickArrow(popping.selected, fixture.popTarget);
      expect(clickableOf(popped).size, `${fixture.label} popped`).toBeGreaterThan(0);
    }
    // And an ordinary hop is not terminal.
    const open = openField(from, 8);
    const plain = arrowAlong(geometry, from, 0, 1);
    expect(
      isTerminalStep(open, applyOnce(board, open, from, plain, 8), step(from, plain, 8)),
    ).toBe(false);
  });

  /**
   * **Revised by P35.** The antecedent — *an adjacent enemy arrow unofferable
   * only because an attack would empty the tip* — is now unreachable: such an
   * arrow is offerable, and the click drafts the attack at `heads - 1`. So the
   * P34 implication is vacuously true, and the reason it named is retired. What
   * is asserted instead is the behaviour that replaced it, over the same bank: the
   * click drafts, refuses nothing, and applies nothing.
   */
  it('An adjacent enemy-held arrow shall be drafted at one head fewer rather than refused.', () => {
    let checked = 0;
    for (const heads of [2, 4, 8]) {
      for (const slot of SLOTS) {
        const enemy = arrowAlong(geometry, from, slot, 1);
        const state = stateWith([
          [from, { owner: A, heads }],
          [enemy, { owner: B, heads: 2 }],
        ]);
        const untouched = stateWith([
          [from, { owner: A, heads }],
          [enemy, { owner: B, heads: 2 }],
        ]);
        const selected = selectRoute(board, state, from);
        const where = `${String(heads)} heads, slot ${String(slot)}`;
        expect(selected.phase.carry, where).toBe(heads);
        const snap = clickArrow(selected, enemy);
        expect(snap.refusal, where).toBeUndefined();
        const drafted = (snap.pending ?? draftOf(snap))[0];
        expect(drafted?.kind, where).toBe('step');
        if (drafted?.kind === 'step') expect(drafted.count, where).toBe(heads - 1);
        expect(state, where).toEqual(untouched);
        checked += 1;
      }
    }
    expect(checked).toBe(9);
    // An enemy arrow no count can reach is still `out-of-reach`.
    const far = arrowAlong(geometry, from, 0, 3);
    const farState = stateWith([
      [from, { owner: A, heads: 8 }],
      [far, { owner: B, heads: 2 }],
    ]);
    const farSelected = selectRoute(board, farState, from);
    expect(clickArrow(farSelected, far).refusal?.reason).toBe('out-of-reach');
  });

  it('While in the route phase, the system shall apply nothing to the game state until Send.', () => {
    const state = openField(from, 12);
    const untouched = openField(from, 12);
    const selected = selectRoute(board, state, from);
    const snaps = [
      selected.snap,
      selected.mode.setCarry(8),
      clickArrow(selected, arrowAlong(geometry, from, 0, 2)),
      clickArrow(selected, alongSlots(geometry, from, [0, 0, 1])),
      clickArrow(selected, arrowAlong(geometry, from, 0, 1)),
      selected.mode.setCarry(4),
      clickArrow(selected, from),
    ];
    for (const [index, snap] of snaps.entries()) {
      expect(pendingOf(snap), `snapshot ${String(index)}`).toHaveLength(0);
      expect(state, `snapshot ${String(index)}`).toEqual(untouched);
    }
    // Send hands the moves to the host; it does not apply them either.
    selected.mode.send();
    expect(state).toEqual(untouched);
  });

  it('The system shall include an arrow in the clickable set if and only if exactly one shortest route reaches it from the tip.', () => {
    let compared = 0;
    for (const item of OPEN_CASES) {
      const inputs = inputsOf(item);
      const counts = shortestRoutes(item.board, inputs.state, item.from, item.carry);
      const unique = uniqueRouteSet(counts);
      const clickable = clickableSet(inputs);
      expect(unique.size, item.label).toBeGreaterThan(0);
      expect(sortedIds(clickable.keys()), item.label).toEqual(sortedIds(unique));
      compared += unique.size;
    }
    expect(compared).toBeGreaterThan(60);
  });

  it('The system shall present exactly nine clickable arrows at each distance of two or more, when no ray is truncated.', () => {
    for (const heads of [2, 4, 8, 16]) {
      const item: Case = {
        label: `open field, ${String(heads)} heads`,
        board,
        state: openField(from, heads),
        from,
        carry: heads,
        steps: [],
      };
      const offer = offerOf(item);
      const byDistance = new Map<number, number>();
      for (const option of offer.clickable.values()) {
        byDistance.set(option.steps.length, (byDistance.get(option.steps.length) ?? 0) + 1);
      }
      expect(byDistance.get(1), item.label).toBe(3);
      for (let distance = 2; distance <= speed(heads); distance += 1) {
        expect(byDistance.get(distance), `${item.label} at ${String(distance)}`).toBe(9);
      }
      expect(byDistance.get(speed(heads) + 1), item.label).toBeUndefined();
    }
  });

  it('The system shall key an arrow reachable by both a ray and a turn to the shorter route.', () => {
    // On the tiling a shaped route is always a shortest route, so the entry's
    // length must equal the measured shortest distance.
    for (const item of OPEN_CASES) {
      const inputs = inputsOf(item);
      const counts = shortestRoutes(item.board, inputs.state, item.from, item.carry);
      const offer = buildRouteOffer(inputs);
      expect(offer.clickable.size, item.label).toBeGreaterThan(0);
      for (const [arrow, option] of offer.clickable) {
        expect(option.steps.length, `${item.label}: ${String(arrow)}`).toBe(
          counts.get(arrow)?.distance,
        );
      }
    }
    // And where a fixture board makes `s^2` coincide with `t^2·e`, the two-step
    // ray entry is the one kept.
    const both = fixtureArrow(SPACIOUS, '2', '3');
    const source = fixtureArrow(SPACIOUS, '0', '1');
    const offer = buildRouteOffer(inputsAt(spacious, soloOn(A, source, 4), source, 4));
    expect(offer.clickable.get(both)?.steps).toHaveLength(2);
    expect(offer.clickable.get(both)?.kind).toBe('ray');
  });

  it('The system shall end a run at an arrow already walked by the ray or by the draft.', () => {
    let nonEmpty = 0;
    for (const item of CASES) {
      const inputs = inputsOf(item);
      const walked = walkedOf(item);
      for (const slot of SLOTS) {
        const ray = rayArrows(inputs, slot);
        expect(new Set(ray).size, `${item.label} slot ${String(slot)} repeats`).toBe(ray.length);
        for (const arrow of ray) {
          expect(walked.has(arrow), `${item.label} slot ${String(slot)} re-enters`).toBe(false);
        }
        if (ray.length > 0) nonEmpty += 1;
      }
    }
    expect(nonEmpty).toBeGreaterThan(20);
    // The spacious ray would loop after four arrows though allowance is five.
    const looping: Case = {
      label: 'spacious loop',
      board: spacious,
      state: soloOn(A, spaciousFrom, 16),
      from: spaciousFrom,
      carry: 16,
      steps: [],
    };
    expect(spacious.rules.effectiveSpeed(looping.state, spaciousFrom)).toBe(5);
    expect(rayArrows(inputsOf(looping), 0)).toHaveLength(4);
  });

  it('When the draft is sent, the system shall emit its moves in draft order and no others.', () => {
    const routes: readonly (readonly ArrowId[])[] = [
      [arrowAlong(geometry, from, 0, 1)],
      [arrowAlong(geometry, from, 0, 4)],
      [alongSlots(geometry, from, [1, 1, 0])],
      [arrowAlong(geometry, from, 0, 2), arrowAlong(geometry, arrowAlong(geometry, from, 0, 2), 1, 2)],
    ];
    for (const clicks of routes) {
      // Twelve, not eight: four steps off `2^(k-1)` heads auto-applies under P35
      // and there would be no draft to send. `speed(12) = 4` walks the same four.
      const selected = selectRoute(board, openField(from, 12), from);
      let snap = selected.snap;
      for (const arrow of clicks) snap = clickArrow(selected, arrow);
      const draft = [...draftOf(snap)];
      expect(draft.length, clicks.map(String).join(' ')).toBeGreaterThan(0);
      const sent = pendingOf(selected.mode.send());
      expect(sent).toEqual(draft);
    }
  });

  it('When a drafted arrow is clicked, the system shall discard every move after it and no move before it.', () => {
    const target = arrowAlong(geometry, from, 0, 4);
    // Twelve, not eight: see the note above — four steps off eight heads applies
    // on the click, leaving nothing to pop back through.
    const reference = selectRoute(board, openField(from, 12), from);
    const full = [...draftOf(clickArrow(reference, target))];
    expect(full).toHaveLength(4);
    const exits = exitsOf(full);
    for (const [index, arrow] of exits.entries()) {
      const selected = selectRoute(board, openField(from, 12), from);
      clickArrow(selected, target);
      const popped = clickArrow(selected, arrow);
      expect(draftOf(popped), `pop to ${String(index)}`).toEqual(full.slice(0, index + 1));
      expect(routePhaseOf(popped).tip, `pop to ${String(index)}`).toBe(arrow);
    }
  });

  /**
   * **Revised by P35.** The P34 statement was *every already-drafted move*; P35
   * narrows it to *every earlier run's moves*, because rewriting the last run is
   * the feature. The full pair of statements — earlier runs byte-identical, and
   * exactly `lastRunLength` moves re-emitted — is
   * `count-after-route.invariants.test.ts` invariants 7 and 8.
   */
  it("When the carry changes, the system shall leave every earlier run's moves unchanged.", () => {
    const selected = selectRoute(board, openField(from, 8), from);
    const drafted = clickArrow(selected, arrowAlong(geometry, from, 0, 2));
    const original = [...draftOf(drafted)];
    expect(original).toHaveLength(2);
    clickArrow(selected, arrowAlong(geometry, from, 0, 3));
    for (const carry of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const snap = selected.mode.setCarry(carry);
      expect(draftOf(snap).slice(0, 2), `carry ${String(carry)}`).toEqual(original);
    }
  });

  it('If a click names an arrow that is reachable but not clickable, then the system shall refuse it with `out-of-reach` and apply nothing.', () => {
    const state = openField(from, 8);
    const untouched = openField(from, 8);
    const selected = selectRoute(board, state, from);
    const clickable = clickableOf(selected.snap);
    const ambiguous = [...reachForCarry(board, state, from, 8)].filter(
      (arrow) => arrow !== from && !clickable.has(arrow),
    );
    expect(ambiguous.length).toBeGreaterThan(10);
    for (const arrow of ambiguous.slice(0, 12)) {
      const snap = clickArrow(selected, arrow);
      expect(snap.refusal?.arrow, String(arrow)).toBe(arrow);
      expect(snap.refusal?.reason, String(arrow)).toBe('out-of-reach');
      expect(draftOf(snap), String(arrow)).toHaveLength(0);
      expect(pendingOf(snap), String(arrow)).toHaveLength(0);
      expect(state).toEqual(untouched);
    }
  });

  it('The system shall derive the tip’s head count from the state after the draft, not from the carry.', () => {
    // A merge grows the count on arrival; combat shrinks it. Neither equals the carry.
    const merge = selectRoute(board, mergeState(), from);
    const merged = clickArrow(merge, arrowAlong(geometry, from, 0, 2));
    const mergedPhase = routePhaseOf(merged);
    const mergedAfter = walkSteps(board, merge.state, from, exitsOf(mergedPhase.draft), 8);
    expect(mergedPhase.tipHeads).toBe(11);
    expect(mergedPhase.tipHeads).toBe(headsOn(mergedAfter.state, mergedPhase.tip));

    // P35: the click drafts the attack itself, at `heads - 1` of the twelve.
    const fight = selectRoute(board, enemyState(), from);
    const fought = clickArrow(fight, arrowAlong(geometry, from, 1, 1));
    const phase = routePhaseOf(fought);
    const fightMove = phase.draft[0];
    expect(fightMove?.kind).toBe('step');
    if (fightMove?.kind !== 'step') return;
    expect(fightMove.count).toBe(11);
    const after = walkSteps(board, fight.state, from, exitsOf(phase.draft), fightMove.count);
    expect(phase.tipHeads).toBe(headsOn(after.state, phase.tip));

    // And on the plain case it is the carry only because that is what arrived.
    const plain = selectRoute(board, openField(from, 8), from);
    const walked = clickArrow(plain, arrowAlong(geometry, from, 0, 3));
    const plainPhase = routePhaseOf(walked);
    const plainAfter = walkSteps(board, plain.state, from, exitsOf(plainPhase.draft), 8);
    expect(plainPhase.tipHeads).toBe(headsOn(plainAfter.state, plainPhase.tip));
  });

  it('Equal state, tip, carry and draft shall produce an equal clickable set and equal paint.', () => {
    for (const item of CASES) {
      const left = buildRouteOffer(inputsOf(item));
      const right = buildRouteOffer(inputsOf(item));
      expect(sortedIds(left.clickable.keys()), item.label).toEqual(sortedIds(right.clickable.keys()));
      expect(left.carries, item.label).toEqual(right.carries);
      expect(sortedIds(left.reachWash), item.label).toEqual(sortedIds(right.reachWash));
      for (const slot of SLOTS) {
        expect((left.rays[slot] ?? []).map(String), item.label).toEqual(
          (right.rays[slot] ?? []).map(String),
        );
      }
      for (const [arrow, option] of left.clickable) {
        expect(right.clickable.get(arrow)?.steps.map(String)).toEqual(option.steps.map(String));
        expect(right.clickable.get(arrow)?.kind).toBe(option.kind);
        expect(right.clickable.get(arrow)?.slot).toBe(option.slot);
      }
      expect(sortedIds(left.previews.keys()), item.label).toEqual(sortedIds(right.previews.keys()));
    }
    // The mode's offer is the same measurement as the helper's.
    const state = openField(from, 8);
    const selected = selectRoute(board, state, from);
    const helper = buildRouteOffer(inputsAt(board, state, from, 8));
    expect(sortedIds(clickableOf(selected.snap).keys())).toEqual(sortedIds(helper.clickable.keys()));
    const paintLeft = routePaint({ phase: selected.phase, pointer: 'fine' });
    const paintRight = routePaint({ phase: selected.phase, pointer: 'fine' });
    expect(sortedIds(paintLeft.rayArrows)).toEqual(sortedIds(paintRight.rayArrows));
    expect(sortedIds(paintLeft.turnArrows)).toEqual(sortedIds(paintRight.turnArrows));
    expect(sortedIds(paintLeft.reachWash)).toEqual(sortedIds(paintRight.reachWash));
    expect(paintLeft.draftArrows.map(String)).toEqual(paintRight.draftArrows.map(String));
    expect(paintLeft.rayArrows.size).toBeGreaterThan(0);
  });

  it('The system shall consult no clock and no randomness in `route.ts`.', () => {
    const source = routeSource();
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

  it('The system shall build the clickable set once per selection, extend, pop or carry change, and not per hover.', () => {
    const counting = countingRules(rules);
    const instrumented: Board = { geometry, rules: counting.rules };
    const state = openField(from, 12);
    const selected = selectRoute(instrumented, state, from);
    expect(counting.calls).toBeGreaterThan(0);

    const hoverSix = (phase: RoutePhase, label: string): void => {
      counting.zero();
      const hovers = [...phase.offer.clickable.keys()].slice(0, 6);
      expect(hovers.length, label).toBe(6);
      for (const hoverArrow of hovers) routePaint({ phase, pointer: 'fine', hoverArrow });
      expect(counting.calls, label).toBe(0);
    };

    hoverSix(selected.phase, 'after selection');

    counting.zero();
    const extended = clickArrow(selected, arrowAlong(geometry, from, 0, 2));
    expect(counting.calls, 'extend measures').toBeGreaterThan(0);
    hoverSix(routePhaseOf(extended), 'after extend');

    counting.zero();
    const popped = clickArrow(selected, arrowAlong(geometry, from, 0, 1));
    expect(counting.calls, 'pop measures').toBeGreaterThan(0);
    hoverSix(routePhaseOf(popped), 'after pop');

    counting.zero();
    const carried = selected.mode.setCarry(4);
    expect(counting.calls, 'carry change measures').toBeGreaterThan(0);
    hoverSix(routePhaseOf(carried), 'after carry change');
  });
});

/** Nothing in the bank may be silently empty — a vacuous property is no property. */
describe('P34 invariants — the case bank is non-vacuous', () => {
  it('every case offers at least one clickable arrow', () => {
    const empty: string[] = [];
    for (const item of CASES) {
      if (offerOf(item).clickable.size === 0) empty.push(item.label);
    }
    // Only the one-head open field and the fully refused fixture may be thin.
    expect(empty).toEqual([]);
  });
});
