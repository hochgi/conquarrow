/**
 * docs/spec/board-selection-model/board-selection-model.core.feature — P77.
 *
 * One it() per Gherkin scenario. Pure helpers only — no RTL, no jsdom. The HUD
 * is rendered with `react-dom/server`'s `renderToStaticMarkup`; App / RouteDock
 * wiring that has no pure seam is read from source, as P50's suite does.
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId } from '@conquarrow/contracts';
import { passIfExhausted } from '../src/autoEndTurn';
import { countControl, leftoverNote } from '../src/route';
import { movableArrows, nextStack } from '../src/selection/cursor';
import { selectionLine } from '../src/selection/status';
import {
  A,
  arrowAlong,
  boardWith,
  click,
  clickSelect,
  codeOf,
  dockSource,
  draftOf,
  exitsOf,
  geometry,
  inLapOrder,
  lap,
  messageLine,
  oneStep,
  refusedAtTip,
  refusingRules,
  renderHud,
  routeOf,
  rules,
  select,
  selectedOf,
  session,
  snapshotOf,
  sourceArrow,
  spentStack,
  throughActionRow,
  tiling,
  twoStacks,
} from './board-selection-model.support';

const control = (snap: Parameters<typeof routeOf>[0]) =>
  countControl({ phase: snap.phase, inputLocked: false, matchOver: false });

describe('Rule: A click on an own stack selects it, always', () => {
  it('Clicking an own stack that the selected stack could reach selects it', () => {
    const { state, a0, b0 } = twoStacks();
    const s = session(state);
    const s2 = clickSelect(s, b0);
    expect(routeOf(s2).offer.clickable.has(a0), 'setup: a0 is a merge for S2').toBe(true);

    const snap = click(s, a0);
    expect(selectedOf(snap)).toBe(a0);
    expect(draftOf(snap)).toEqual([]);
    expect(snap.pending).toBeUndefined();
  });

  it('Clicking an own stack with a draft open discards the draft and selects it', () => {
    const { state, a0, b0 } = twoStacks();
    const before = snapshotOf(state);
    const s = session(state);
    clickSelect(s, a0);
    const drafted = click(s, arrowAlong(geometry, a0, 0, 1));
    expect(draftOf(drafted), 'setup: a one step run is drafted').toHaveLength(1);

    const snap = click(s, b0);
    expect(selectedOf(snap)).toBe(b0);
    expect(draftOf(snap)).toEqual([]);
    expect(snap.pending).toBeUndefined();
    expect(state).toEqual(before);
  });

  it('A merge is drafted from the strip, not from the tile', () => {
    const { state, a0, b0 } = twoStacks();
    const s = session(state);
    const selected = clickSelect(s, b0);
    expect(selected.highlights.merges?.has(a0), 'a0 is a merge target of S2').toBe(true);

    const merged = s.mode.mergeInto(a0);
    expect(exitsOf(merged)).toEqual([a0]);
    expect(routeOf(merged).from).toBe(b0);
    expect(selectedOf(merged)).toBe(b0);
    expect(merged.pending).toBeUndefined();

    const sent = s.mode.send();
    expect(sent.pending).toEqual([oneStep(b0, a0, 1)]);
    // The strip carries the button the mode answers.
    expect(codeOf(dockSource()).includes('Merge into')).toBe(true);
  });
});

describe('Rule: Every move is drafted and then sent', () => {
  it('Clicking an empty legal arrow drafts and never applies', () => {
    const { state, a0 } = twoStacks();
    const before = snapshotOf(state);
    const s = session(state);
    clickSelect(s, a0);
    const ray = arrowAlong(geometry, a0, 0, 1);

    const snap = click(s, ray);
    expect(draftOf(snap)).toHaveLength(1);
    expect(draftOf(snap)[0]?.kind).toBe('step');
    expect(snap.pending).toBeUndefined();
    expect(state).toEqual(before);
  });

  it('A one step one count move still requires Send', () => {
    const { state, b0 } = twoStacks();
    const outs = geometry.outArrows(geometry.target(b0));
    const only = outs.find((exit) => state.groups.get(exit) === undefined);
    if (only === undefined) throw new Error('setup: b0 has no empty grain out');
    // "The only arrow S2 can reach": the engine refuses every other exit of b0.
    const narrowed = refusingRules(rules, (move) => move.from === b0 && move.exit !== only);
    const s = session(state, tiling, narrowed);
    const selected = clickSelect(s, b0);
    expect([...routeOf(selected).offer.clickable.keys()], 'setup').toEqual([only]);

    const snap = click(s, only);
    expect(control(snap)?.counts).toEqual([1]);
    expect(snap.pending).toBeUndefined();

    const sent = s.mode.send();
    expect(sent.pending).toEqual([oneStep(b0, only, 1)]);
  });
});

describe('Rule: Next stack walks every movable stack, then none', () => {
  it('Next stack visits every movable stack, then none, then wraps', () => {
    const a0 = sourceArrow(geometry);
    const stacks = [a0, arrowAlong(geometry, a0, 1, 4), arrowAlong(geometry, a0, 2, 4)];
    const state = boardWith(stacks.map((arrow) => ({ arrow, owner: A, heads: 1 })));
    const movable = movableArrows(rules, state);
    const [m1, m2, m3] = inLapOrder(stacks);
    expect(movable, 'setup: three movable stacks').toEqual([m1, m2, m3]);

    const presses = lap((cursor) => nextStack(cursor, movable), undefined, 4);
    expect(presses).toEqual([m1, m2, m3, undefined]);
    expect(nextStack(presses[3], movable)).toBe(m1);

    // Each lap position is what the button selects (or deselects) through the mode.
    const s = session(state);
    const selections = presses.map((cursor) =>
      selectedOf(cursor === undefined ? s.mode.reset() : select(s, cursor)),
    );
    expect(selections).toEqual([m1, m2, m3, undefined]);
  });

  it('With one movable stack, the lap is that stack and none', () => {
    const m1 = mintArrowId('m1');
    expect(nextStack(m1, [m1])).toBeUndefined();
    expect(nextStack(undefined, [m1])).toBe(m1);
  });

  it('The selection line reports n of m and names the selected arrow', () => {
    const [m1, m2, m3] = ['m1', 'm2', 'm3'].map(mintArrowId);
    if (m1 === undefined || m2 === undefined || m3 === undefined) throw new Error('setup');
    expect(selectionLine({ selected: m2, heads: 2, movable: [m3, m1, m2] })).toBe(
      'Selected: 2 on m2 · 2 of 3',
    );
  });

  it('The selection line says so in words when nothing is selected', () => {
    const movable = ['m1', 'm2', 'm3'].map(mintArrowId);
    expect(selectionLine({ selected: undefined, heads: 0, movable })).toBe(
      'No stack selected · 3 can move',
    );
  });
});

describe('Rule: Lit means legal, and every refused click says why', () => {
  it('A grain neighbour that would self-convert is drawn refused, not lit', () => {
    // The scenario's r1 — a grain neighbour of a0 — is this fixture's r0.
    const { state, a0, r0 } = refusedAtTip();
    const s = session(state);

    const snap = clickSelect(s, a0);
    expect(snap.highlights.refused?.has(r0)).toBe(true);
    expect(snap.highlights.targets.has(r0)).toBe(false);
    expect(snap.highlights.merges?.has(r0) ?? false).toBe(false);
    expect(routeOf(snap).offer.reachWash.has(r0)).toBe(false);
  });

  it('Clicking a refused arrow prints a reason', () => {
    const { state, a0, r0 } = refusedAtTip();
    const s = session(state);
    clickSelect(s, a0);

    const snap = click(s, r0);
    expect(snap.refusal).toEqual({ arrow: r0, reason: 'would-convert' });
    expect(messageLine(snap, movableArrows(rules, state).length)).toBe(
      'No trail home — those heads would flip',
    );
  });

  it('Clicking out of reach names the selected stack', () => {
    const { state, a0, b0 } = twoStacks();
    const s = session(state);
    const selected = clickSelect(s, b0);
    const far = arrowAlong(geometry, a0, 0, 4);
    const offer = routeOf(selected).offer;
    expect(offer.clickable.has(far) || offer.reachWash.has(far), 'setup: S2 cannot reach it').toBe(
      false,
    );
    expect(state.groups.has(far), 'setup: an empty arrow').toBe(false);

    const snap = click(s, far);
    expect(snap.refusal).toEqual({ arrow: far, reason: 'out-of-reach' });
    expect(messageLine(snap, movableArrows(rules, state).length)).toBe(
      `Too far for the stack on ${String(b0)}`,
    );
  });
});

describe('Rule: The count strip says what the count means', () => {
  it('The leftover names the arrow it stands on', () => {
    const a0 = sourceArrow(geometry);
    const state = boardWith([{ arrow: a0, owner: A, heads: 3 }]);
    const s = session(state);
    clickSelect(s, a0);
    click(s, arrowAlong(geometry, a0, 0, 1));

    const lowered = s.mode.setCarry(2);
    const strip = control(lowered);
    expect(strip?.count).toBe(2);
    expect(strip?.start).toBe(a0);
    if (strip === undefined) return;
    expect(leftoverNote({ count: strip.count, ceiling: strip.ceiling, start: strip.start })).toBe(
      `1 head stays on ${String(a0)}`,
    );
    // The stepper's caption, and the note drawn from `leftoverNote`.
    const dock = codeOf(dockSource());
    expect(dock.includes('Heads on the last leg')).toBe(true);
    expect(dock.includes('leftoverNote(')).toBe(true);
  });
});

describe('Rule: The layout and the turn flow are stated', () => {
  it('Button positions are stable across a status line of 1 and 3 lines', () => {
    const short = renderHud({ phase: { kind: 'idle' } });
    const tall = renderHud({
      phase: { kind: 'blocked', from: sourceArrow(geometry) },
      refusalNote: 'Too far for the stack on somewhere a long way from here, on the far rim',
      byokStatus: 'LLM seat: rate limited — retrying in a moment, then falling back',
    });
    expect(throughActionRow(tall)).toBe(throughActionRow(short));
  });

  it('With a sentry parked and nothing else able to move, the turn stays open and says so', () => {
    const a0 = sourceArrow(geometry);
    const sentry = arrowAlong(geometry, a0, 1, 4);
    const state = boardWith([spentStack(a0, 2), { arrow: sentry, owner: A, heads: 1 }]);
    const movable = movableArrows(rules, state);
    expect(movable, 'setup: only the sentry can move').toEqual([sentry]);

    expect(passIfExhausted(rules, state).moves).toEqual([]);
    expect(messageLine(session(state).mode.reset(), movable.length)).toBe(
      '1 stack can still move · End turn when done',
    );
  });

  it('With nothing able to move, the turn passes and the strip says so', () => {
    const a0 = sourceArrow(geometry);
    const state = boardWith([spentStack(a0, 2), spentStack(arrowAlong(geometry, a0, 1, 4), 1)]);
    const movable = movableArrows(rules, state);
    expect(movable, 'setup: nothing can move').toEqual([]);

    expect(messageLine(session(state).mode.reset(), movable.length)).toBe(
      'Nothing can move · the turn passes by itself',
    );
    expect(passIfExhausted(rules, state).moves[0]?.kind).toBe('endTurn');
  });
});
