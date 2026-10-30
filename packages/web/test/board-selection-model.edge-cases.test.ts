/**
 * docs/spec/board-selection-model/board-selection-model.edge-cases.feature — P77.
 *
 * One it() per Gherkin scenario; each Scenario Outline is an it.each over its
 * Examples rows. Pure helpers only — no RTL, no jsdom.
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId } from '@conquarrow/contracts';
import type { ArrowId, GameState } from '@conquarrow/contracts';
import { compareArrows } from '@conquarrow/rules-core';
import { pointerUpIntent } from '../src/input/pointer';
import type { InputSnapshot } from '../src/input/modes';
import { countControl, leftoverNote } from '../src/route';
import { SELECTED_UNDER_STROKE } from '../src/selectionChrome';
import { emptyRecency, movableArrows, nextStack, turnAnchor } from '../src/selection/cursor';
import { selectionLine } from '../src/selection/status';
import { selectionPaint } from '../src/selectionChrome';
import {
  A,
  B,
  acceptsDraftTo,
  arrowAlong,
  boardSource,
  boardWith,
  click,
  clickSelect,
  codeOf,
  draftOf,
  exitOf,
  exitsOf,
  geometry,
  grainOuts,
  headsOn,
  inLapOrder,
  isOwnStack,
  messageLine,
  refusedAtTip,
  refusingRules,
  routeOf,
  rules,
  select,
  selectedOf,
  session,
  snapshotOf,
  sourceArrow,
  spentStack,
  stylesSource,
  tiling,
  type Session,
} from './board-selection-model.support';

const control = (snap: InputSnapshot) =>
  countControl({ phase: snap.phase, inputLocked: false, matchOver: false });

/** Two of player A's stacks, far enough apart not to reach each other's grain. */
const pairApart = (
  first: number,
  second: number,
): { readonly state: GameState; readonly x: ArrowId; readonly y: ArrowId } => {
  const x = sourceArrow(geometry);
  const y = arrowAlong(geometry, x, 1, 5);
  return {
    state: boardWith([
      { arrow: x, owner: A, heads: first },
      { arrow: y, owner: A, heads: second },
    ]),
    x,
    y,
  };
};

describe('Rule: The five playtest incidents cannot recur', () => {
  // Turn 2: the auto-selected sentry's only destination was the pair's tile.
  it("Clicking the pair's tile while the sentry is selected selects the pair", () => {
    const s0 = sourceArrow(geometry);
    const p0 = exitOf(geometry, s0, 0);
    const state = boardWith([
      { arrow: s0, owner: A, heads: 1 },
      { arrow: p0, owner: A, heads: 2 },
    ]);
    const before = snapshotOf(state);
    // The engine refuses every other exit of the sentry: p0 is its only arrow.
    const narrowed = refusingRules(rules, (move) => move.from === s0 && move.exit !== p0);
    const s = session(state, tiling, narrowed);
    const sentry = clickSelect(s, s0);
    expect([...routeOf(sentry).offer.clickable.keys()], 'setup: p0 is the only reach').toEqual([
      p0,
    ]);

    const snap = click(s, p0);
    expect(selectedOf(snap)).toBe(p0);
    expect(snap.pending).toBeUndefined();
    expect(state).toEqual(before);
  });

  // Turns 16 and 32: a destination meant for the front was clicked with the sentry selected.
  it("A destination out of the selected stack's reach is refused with the stack's name", () => {
    const { state, x: s0, y: f0 } = pairApart(1, 2);
    const s = session(state);
    clickSelect(s, s0);
    const target = arrowAlong(geometry, f0, 0, 2);
    expect(state.groups.has(target), 'setup: an empty arrow').toBe(false);

    const snap = click(s, target);
    expect(snap.refusal).toEqual({ arrow: target, reason: 'out-of-reach' });
    const movable = movableArrows(rules, state);
    expect(messageLine(snap, movable.length)).toBe(`Too far for the stack on ${String(s0)}`);
    expect(selectionLine({ selected: selectedOf(snap), heads: 1, movable })).toContain(String(s0));
  });

  // Turn 17: Next stack alternated between one stack and nothing, never the front.
  it('Next stack reaches the front from the sentry', () => {
    const { state, x, y } = pairApart(1, 2);
    const [s0, f0] = inLapOrder([x, y]);
    if (s0 === undefined || f0 === undefined) throw new Error('setup');
    const movable = movableArrows(rules, state);
    const s = session(state);
    clickSelect(s, s0);

    const cursor = nextStack(s0, movable);
    expect(cursor).toBe(f0);
    if (cursor === undefined) return;
    expect(selectedOf(select(s, cursor))).toBe(f0);
  });

  // Turn 18: the turn opened with the sentry auto-selected and the front's next arrow lit.
  it('The auto-selected stack is named before any click', () => {
    const { state } = pairApart(1, 2);
    const movable = movableArrows(rules, state);
    expect(movable, 'setup: two movable stacks').toHaveLength(2);
    const { cursor } = turnAnchor(emptyRecency(), A, movable);
    if (cursor === undefined) throw new Error('setup: the turn anchor selected nothing');
    const snap = select(session(state), cursor);

    const paint = selectionPaint({ phase: snap.phase, highlights: snap.highlights, pointer: 'fine' });
    expect(paint.selected).toBe(cursor);
    expect(paint.selectedEmphasis).toBe(true);
    const line = selectionLine({ selected: cursor, heads: headsOn(state, cursor), movable });
    expect(line).toContain(String(cursor));
    expect(/· [12] of 2$/.test(line), line).toBe(true);
  });

  // Turn 37: a lit arrow was a self-convert step and the click did nothing at all.
  it('No lit arrow is a step the engine refuses', () => {
    const { state, a0, r0 } = refusedAtTip(4);
    const s = session(state);

    const snap = clickSelect(s, a0);
    const phase = routeOf(snap);
    const lit = [...snap.highlights.targets, ...(snap.highlights.merges ?? [])];
    expect(lit.length, 'setup: something is lit').toBeGreaterThan(0);
    for (const arrow of lit) {
      expect(acceptsDraftTo(s, phase, arrow), String(arrow)).toBe(true);
    }
    expect(snap.highlights.refused?.has(r0)).toBe(true);
  });
});

describe('Rule: Own-stack clicks select before any other reading', () => {
  it('Clicking the selected stack with an empty draft keeps it selected', () => {
    const { state, x: a0 } = pairApart(2, 1);
    const s = session(state);
    clickSelect(s, a0);

    const snap = click(s, a0);
    expect(selectedOf(snap)).toBe(a0);
    expect(snap.phase.kind).toBe('route');
  });

  it('Clicking the selected stack with a draft clears the draft and keeps it selected', () => {
    const { state, x: a0 } = pairApart(4, 1);
    const s = session(state);
    clickSelect(s, a0);
    const drafted = click(s, arrowAlong(geometry, a0, 0, 2));
    expect(draftOf(drafted), 'setup: a two step route').toHaveLength(2);

    const snap = click(s, a0);
    expect(selectedOf(snap)).toBe(a0);
    expect(draftOf(snap)).toEqual([]);
  });

  it('Clicking an own stack that has no move left selects it as blocked', () => {
    const z0 = sourceArrow(geometry);
    const state = boardWith([spentStack(z0, 1), { arrow: arrowAlong(geometry, z0, 1, 5), owner: A, heads: 1 }]);
    const s = session(state);

    const snap = click(s, z0);
    expect(snap.phase).toEqual({ kind: 'blocked', from: z0 });
    expect(snap.refusal).toEqual({ arrow: z0, reason: 'no-exit' });
    expect(messageLine(snap, movableArrows(rules, state).length)).toBe(
      `The stack on ${String(z0)} has no move left this turn`,
    );
  });

  it('A click elsewhere while a blocked stack is selected says why', () => {
    const z0 = sourceArrow(geometry);
    const state = boardWith([spentStack(z0, 1)]);
    const s = session(state);
    expect(click(s, z0).phase.kind, 'setup: z0 is blocked').toBe('blocked');
    const empty = arrowAlong(geometry, z0, 0, 2);

    const snap = click(s, empty);
    expect(snap.refusal).toEqual({ arrow: empty, reason: 'no-exit' });
    expect(selectedOf(snap)).toBe(z0);
  });

  it('A drafted tip that holds heads only in the scratch state is popped, not selected', () => {
    const { state, x: a0 } = pairApart(4, 1);
    const s = session(state);
    clickSelect(s, a0);
    const t1 = arrowAlong(geometry, a0, 0, 1);
    const t2 = arrowAlong(geometry, a0, 0, 2);
    expect(exitsOf(click(s, t2)), 'setup: drafted to t2').toEqual([t1, t2]);

    const snap = click(s, t1);
    expect(exitsOf(snap)).toEqual([t1]);
    expect(selectedOf(snap)).toBe(a0);
  });

  it('Merge targets are not click targets', () => {
    const a0 = sourceArrow(geometry);
    const b0 = arrowAlong(geometry, a0, 0, 1);
    const state = boardWith([
      { arrow: a0, owner: A, heads: 2 },
      { arrow: b0, owner: A, heads: 1 },
    ]);
    const snap = clickSelect(session(state), a0);
    expect(routeOf(snap).offer.clickable.has(b0), 'setup: one run reaches b0').toBe(true);

    expect(snap.highlights.merges?.has(b0)).toBe(true);
    expect(snap.highlights.targets.has(b0)).toBe(false);
  });

  it('Merge into an arrow that is not a merge target is refused', () => {
    const { state, x: a0 } = pairApart(2, 1);
    const s = session(state);
    const selected = clickSelect(s, a0);
    const outside = arrowAlong(geometry, a0, 0, 1);
    expect(selected.highlights.merges?.has(outside) ?? false, 'setup').toBe(false);

    const snap = s.mode.mergeInto(outside);
    expect(draftOf(snap)).toEqual(draftOf(selected));
    expect(snap.refusal).toEqual({ arrow: outside, reason: 'out-of-reach' });
  });
});

describe('Rule: Nothing a click does applies a move', () => {
  it('A two head two step run that spends the whole allowance still waits for Send', () => {
    const a0 = sourceArrow(geometry);
    const s = session(boardWith([{ arrow: a0, owner: A, heads: 2 }]));
    clickSelect(s, a0);

    const snap = click(s, arrowAlong(geometry, a0, 0, 2));
    expect(control(snap)).toBeDefined();
    expect(snap.pending).toBeUndefined();
  });

  it('A power-of-two stack spending its whole allowance still waits for Send', () => {
    const d0 = sourceArrow(geometry);
    const s = session(boardWith([{ arrow: d0, owner: A, heads: 8 }]));
    clickSelect(s, d0);

    const snap = click(s, arrowAlong(geometry, d0, 0, 4));
    expect(control(snap)).toBeDefined();
    expect(snap.pending).toBeUndefined();
  });

  /**
   * One board holding every kind of arrow the outline names: a 1-head stack c0
   * (whose one-step run is the old auto-apply case), a 4-head stack a0 beside
   * enemy territory on a stack-grade trail, an enemy stack, a spent stack.
   */
  const outlineBoard = (): {
    readonly s: Session;
    readonly c0: ArrowId;
    readonly a0: ArrowId;
    readonly z0: ArrowId;
    readonly enemy: ArrowId;
    readonly r0: ArrowId;
  } => {
    const fixture = refusedAtTip(4);
    const c0 = arrowAlong(geometry, fixture.a0, 2, 5);
    const z0 = arrowAlong(geometry, fixture.a0, 2, 3);
    const enemy = arrowAlong(geometry, fixture.a0, 1, 4);
    const state: GameState = boardWith(
      [
        { arrow: fixture.a0, owner: A, heads: 4 },
        { arrow: c0, owner: A, heads: 1 },
        spentStack(z0, 1),
        { arrow: enemy, owner: B, heads: 2 },
      ],
      { trails: fixture.state.trails, territory: fixture.state.territory },
    );
    return { s: session(state), c0, a0: fixture.a0, z0, enemy, r0: fixture.r0 };
  };

  type Arrange = (b: ReturnType<typeof outlineBoard>) => ArrowId;
  const empty: Arrange = (b) => arrowAlong(geometry, b.c0, 0, 3);
  const rows: readonly (readonly [string, string, Arrange])[] = [
    ['idle', 'an own stack', (b) => b.c0],
    ['idle', 'an enemy stack', (b) => b.enemy],
    ['idle', 'an empty arrow', empty],
    [
      'route',
      'a target',
      (b) => {
        const phase = routeOf(clickSelect(b.s, b.c0));
        const target = [...phase.offer.clickable.keys()].find((a) => !isOwnStack(b.s.state, a));
        if (target === undefined) throw new Error('setup: c0 has no target');
        return target;
      },
    ],
    [
      'route',
      'a walked arrow',
      (b) => {
        clickSelect(b.s, b.a0);
        const t2 = arrowAlong(geometry, b.a0, 0, 2);
        click(b.s, t2);
        return arrowAlong(geometry, b.a0, 0, 1);
      },
    ],
    [
      'route',
      'an own stack',
      (b) => {
        clickSelect(b.s, b.a0);
        return b.c0;
      },
    ],
    [
      'route',
      'a refused grain neighbour',
      (b) => {
        clickSelect(b.s, b.a0);
        return b.r0;
      },
    ],
    [
      'route',
      'a multi-run mark',
      (b) => {
        const phase = routeOf(clickSelect(b.s, b.a0));
        const mark = [...phase.offer.reachWash].toSorted(compareArrows)[0];
        if (mark === undefined) throw new Error('setup: a0 has no multi-run mark');
        return mark;
      },
    ],
    [
      'blocked',
      'an empty arrow',
      (b) => {
        expect(click(b.s, b.z0).phase.kind, 'setup: z0 is blocked').toBe('blocked');
        return empty(b);
      },
    ],
  ];

  it.each(rows)('No click produces a pending move (phase %s, clicks %s)', (phase, _label, arrange) => {
    const board = outlineBoard();
    const arrow = arrange(board);
    if (phase === 'idle') board.s.mode.reset();

    const snap = click(board.s, arrow);
    expect(snap.pending).toBeUndefined();
  });
});

describe('Rule: Every refused click says why', () => {
  const twoSides = (): { readonly s: Session; readonly a0: ArrowId; readonly enemy: ArrowId } => {
    const a0 = sourceArrow(geometry);
    const enemy = arrowAlong(geometry, a0, 1, 5);
    const state = boardWith([
      { arrow: a0, owner: A, heads: 4 },
      { arrow: enemy, owner: B, heads: 2 },
    ]);
    return { s: session(state), a0, enemy };
  };

  const refusalRows: readonly (readonly [
    string,
    string,
    string,
    string,
    (b: ReturnType<typeof twoSides>) => ArrowId,
  ])[] = [
    [
      'idle',
      'an empty arrow',
      'nothing-selected',
      'Nothing selected · click one of your stacks first',
      (b) => arrowAlong(geometry, b.a0, 0, 3),
    ],
    ['idle', 'an enemy stack', 'not-yours', 'Not your stack', (b) => b.enemy],
    [
      'route',
      'a multi-run mark',
      'not-one-run',
      'Reachable, but not in one run · click a lit arrow on the way first',
      (b) => {
        const phase = routeOf(clickSelect(b.s, b.a0));
        const mark = [...phase.offer.reachWash].toSorted(compareArrows)[0];
        if (mark === undefined) throw new Error('setup: a0 has no multi-run mark');
        return mark;
      },
    ],
  ];

  it.each(refusalRows)(
    'Each refusal carries its reason and one sentence (phase %s, clicks %s)',
    (_phase, _label, reason, text, arrange) => {
      const board = twoSides();
      const arrow = arrange(board);

      const snap = click(board.s, arrow);
      expect(snap.refusal).toEqual({ arrow, reason });
      expect(messageLine(snap, movableArrows(rules, board.s.state).length)).toBe(text);
    },
  );

  it('A click on an arrow while input is locked is refused as board-busy', () => {
    const arrow = sourceArrow(geometry);
    expect(
      pointerUpIntent({ hadPointer: true, dragged: false, pinched: false, inputLocked: true, hit: arrow }),
    ).toEqual({ kind: 'refuse', arrow, reason: 'board-busy' });
  });

  it('A background click while input is locked says nothing', () => {
    expect(
      pointerUpIntent({
        hadPointer: true,
        dragged: false,
        pinched: false,
        inputLocked: true,
        hit: undefined,
      }),
    ).toEqual({ kind: 'nothing' });
  });

  it('A refusal is cleared by the next click that does something', () => {
    const board = twoSides();
    const refused = click(board.s, board.enemy);
    expect(refused.refusal, 'setup: the last click was refused').toBeDefined();
    const movable = movableArrows(rules, board.s.state);

    const snap = click(board.s, board.a0);
    expect(snap.refusal).toBeUndefined();
    expect(messageLine(snap, movable.length)).toBe(
      `${String(movable.length)} stack${movable.length === 1 ? '' : 's'} can still move · End turn when done`,
    );
  });
});

describe('Rule: Refused is measured at the tip', () => {
  it("After a run, refused names the tip's grain neighbours, not the source's", () => {
    const { state, a0, r0, t1, r1 } = refusedAtTip(2);
    const s = session(state);
    clickSelect(s, a0);

    const snap = click(s, t1);
    expect(exitsOf(snap), 'setup: S1 drafted a run to t1').toEqual([t1]);
    expect(snap.highlights.refused?.has(r1)).toBe(true);
    const r0AlsoAtTip = grainOuts(tiling, t1).some((arrow) => arrow === r0);
    expect(snap.highlights.refused?.has(r0) ?? false).toBe(r0AlsoAtTip);
  });
});

describe('Rule: The lap is exact at its boundaries', () => {
  it('With no movable stack, Next stack selects nothing', () => {
    expect(nextStack(undefined, [])).toBeUndefined();
    expect(nextStack(mintArrowId('m1'), [])).toBeUndefined();
    expect(selectionLine({ selected: undefined, heads: 0, movable: [] })).toBe(
      'No stack selected · nothing can move',
    );
  });

  it('From a selected stack that is not movable, Next stack goes to the next movable arrow after it', () => {
    const [m1, m2, m3] = ['m1', 'm2', 'm3'].map(mintArrowId);
    if (m1 === undefined || m2 === undefined || m3 === undefined) throw new Error('setup');
    expect(nextStack(m2, [m3, m1])).toBe(m3);
  });

  it('Next stack with a draft open discards the draft', () => {
    const { state, x: a0, y: b0 } = pairApart(2, 1);
    const before = snapshotOf(state);
    const s = session(state);
    clickSelect(s, a0);
    expect(draftOf(click(s, arrowAlong(geometry, a0, 0, 1))), 'setup').toHaveLength(1);
    // a0 → b0 when a0 comes first in the lap, a0 → none when it comes last.
    const after = inLapOrder([a0, b0])[0] === a0 ? b0 : undefined;

    const cursor = nextStack(a0, movableArrows(rules, state));
    expect(cursor).toBe(after);
    const snap = cursor === undefined ? s.mode.reset() : select(s, cursor);
    expect(snap.pending).toBeUndefined();
    expect(state).toEqual(before);
    expect(selectedOf(snap)).toBe(after);
    expect(draftOf(snap)).toEqual([]);
  });

  it('The lap ignores the order the movable list arrives in', () => {
    const ids = ['m4', 'm1', 'm3', 'm2'].map(mintArrowId);
    const reversed = ids.toReversed();
    const walk = (movable: readonly ArrowId[]) =>
      lap10(movable).map((cursor) => (cursor === undefined ? '-' : String(cursor)));
    expect(walk(ids)).toEqual(walk(reversed));
    expect(walk(ids)).toEqual(['m1', 'm2', 'm3', 'm4', '-', 'm1', 'm2', 'm3', 'm4', '-']);
  });

  it('A selected stack that is not movable is reported without a lap position', () => {
    const z0 = mintArrowId('z0');
    const movable = ['m1', 'm2'].map(mintArrowId);
    expect(selectionLine({ selected: z0, heads: 1, movable })).toBe(
      'Selected: 1 on z0 · no move left · 2 can move',
    );
  });
});

const lap10 = (movable: readonly ArrowId[]): readonly (ArrowId | undefined)[] => {
  const out: (ArrowId | undefined)[] = [];
  let at: ArrowId | undefined;
  for (let i = 0; i < 10; i += 1) {
    at = nextStack(at, movable);
    out.push(at);
  }
  return out;
};

describe('Rule: Pan, zoom and motion leave selection alone', () => {
  it('Selection survives a board pan; a pan does not change selection', () => {
    const { state, x: a0 } = pairApart(2, 1);
    const s = session(state);
    const selected = clickSelect(s, a0);
    expect(selectedOf(selected), 'setup').toBe(a0);

    // Released on an arrow — even on another own stack — after travelling past the slop.
    const intent = pointerUpIntent({
      hadPointer: true,
      dragged: true,
      pinched: false,
      inputLocked: false,
      hit: a0,
    });
    expect(intent).toEqual({ kind: 'nothing' });
    // `nothing` reaches no mode method, so the selection is the one before the pan.
    expect(selectedOf(selected)).toBe(a0);
  });

  it('Reduced motion: markers are static, no pulse', () => {
    // The marker: the under-stroke and the cream over-stroke, neither animated.
    const board = codeOf(boardSource());
    const marker = (stroke: string): string => {
      const at = board.indexOf(`stroke={${stroke}}`);
      expect(at, `Board.tsx paints no element stroked with ${stroke}`).toBeGreaterThanOrEqual(0);
      const open = board.lastIndexOf('<', at);
      const close = board.indexOf('/>', at);
      return board.slice(open, close);
    };
    expect(SELECTED_UNDER_STROKE.length, 'SELECTED_UNDER_STROKE is not chosen').toBeGreaterThan(0);
    for (const stroke of ['SELECTED_UNDER_STROKE', 'SELECTED_HALO_STROKE']) {
      const element = marker(stroke);
      expect(/pulse|animat/i.test(element), `${stroke}: ${element}`).toBe(false);
    }

    // Every animated selection class is switched off under reduced motion.
    const css = stylesSource();
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
      .map((m) => m[1] ?? '')
      .join('\n');
    expect(reduced.length, 'no reduced-motion block').toBeGreaterThan(0);
    const animated = [...css.matchAll(/\.([\w-]+)\s*\{[^}]*\banimation:\s*(?!none)[^;]+;/g)]
      .map((m) => m[1] ?? '')
      .filter((name) => /select|path-pulse|merge|route|multi-run/.test(name));
    expect(animated, 'setup: the selection pulse is found').toContain('selected-pulse');
    for (const name of animated) {
      expect(reduced.includes(`.${name}`), `.${name} still animates under reduced motion`).toBe(
        true,
      );
    }
  });
});

describe('Rule: The count strip and leftover wording hold for every run', () => {
  it.each([
    ['a0', 3, 3, 'No head stays behind'],
    ['a0', 3, 2, '1 head stays on a0'],
    ['t2', 8, 4, '4 heads stay on t2'],
  ] as const)(
    'The leftover names where it stands, or says none stays (start %s, ceiling %i, count %i)',
    (start, ceiling, count, text) => {
      expect(leftoverNote({ count, ceiling, start: mintArrowId(start) })).toBe(text);
    },
  );

  it('the count strip names the start of the last run, not the source, after two runs', () => {
    // Supports the outline's `t2` row: on a two-run draft the leftover stands
    // where the *last* run began — the first run's tip.
    const a0 = sourceArrow(geometry);
    const s = session(boardWith([{ arrow: a0, owner: A, heads: 8 }]));
    clickSelect(s, a0);
    const t2 = arrowAlong(geometry, a0, 0, 2);
    click(s, t2);
    const snap = click(s, arrowAlong(geometry, t2, 1, 1));
    expect(exitsOf(snap), 'setup: two runs').toHaveLength(3);
    expect(control(snap)?.start).toBe(t2);
  });
});
