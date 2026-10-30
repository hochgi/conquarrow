/**
 * EARS invariants for docs/spec/board-selection-model/board-selection-model.md — P77.
 *
 * Properties over a deterministic case bank (no fast-check in this repo, no
 * Math.random): the generated tiling plus the P02 `spacious` and `minimal`
 * fixtures, each seeded with own stacks, enemy stacks, merges, a spent stack and
 * enemy territory beside a stack-grade trail. Every reachable selection and
 * one-run draft is enumerated, and every interesting arrow is clicked from it.
 *
 * Also here: the spec's normative strip copy and paint tables, and one gesture
 * replay (select → draft → count → send, then select → merge → send) that must
 * land on one exact move list and one exact board twice over.
 */

import { describe, expect, it } from 'vitest';
import { mintArrowId, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move } from '@conquarrow/contracts';
import { compareArrows } from '@conquarrow/rules-core';
import { PATH_STROKE, PREVIEW_STROKE } from '../src/colors';
import { REFUSAL_TEXT, refusalText, type RefusalReason } from '../src/fx/present';
import type { InputSnapshot } from '../src/input/modes';
import { pointerUpIntent } from '../src/input/pointer';
import * as route from '../src/route';
import {
  ROUTE_HINT_DRAFTED,
  ROUTE_HINT_EMPTY,
  ROUTE_HINT_FINISHED,
  leftoverNote,
} from '../src/route';
import {
  MULTI_RUN_STROKE,
  SELECTED_HALO_STROKE,
  SELECTED_STROKE_WIDTH,
  SELECTED_UNDER_STROKE,
  tierStyle,
  type RouteTier,
} from '../src/selectionChrome';
import { movableArrows, nextStack } from '../src/selection/cursor';
import { selectionLine, turnStatus } from '../src/selection/status';
import {
  A,
  B,
  acceptsDraftTo,
  actionRow,
  appSource,
  arrowAlong,
  boardSource,
  boardWith,
  click,
  codeOf,
  exitOf,
  exitsOf,
  geometry,
  grainOuts,
  headsOn,
  isEnemyStack,
  isOwnStack,
  minimal,
  refusedAtTip,
  renderHud,
  routeOf,
  rules,
  select,
  selectedOf,
  session,
  snapshotOf,
  sourceArrow,
  sourceOf,
  spacious,
  spentStack,
  throughActionRow,
  tiling,
  twoStacks,
  type Board,
  type Session,
} from './board-selection-model.support';

// ---------------------------------------------------------------------------
// The case bank
// ---------------------------------------------------------------------------

interface Case {
  readonly name: string;
  readonly board: Board;
  readonly state: GameState;
}

const firstOut = (board: Board): ArrowId => {
  const arrow = board.geometry.outArrows(board.geometry.seedPoint())[0];
  if (arrow === undefined) throw new Error('setup: the board offered no out-arrow');
  return arrow;
};

const cases = (): readonly Case[] => {
  const two = twoStacks();
  const tip = refusedAtTip(4);
  const sx = firstOut(spacious);
  const mx = firstOut(minimal);
  return [
    { name: 'tiling: S1 and S2, a0 a merge for S2', board: tiling, state: two.state },
    {
      name: 'tiling: stack-grade trail beside enemy ground, a merge, an enemy, a spent stack',
      board: tiling,
      state: boardWith(
        [
          { arrow: tip.a0, owner: A, heads: 4 },
          { arrow: arrowAlong(geometry, tip.a0, 0, 2), owner: A, heads: 1 },
          { arrow: exitOf(geometry, tip.a0, 2), owner: B, heads: 2 },
          spentStack(arrowAlong(geometry, tip.a0, 2, 4), 1),
        ],
        { trails: tip.state.trails, territory: tip.state.territory },
      ),
    },
    {
      name: 'spacious: a merge one step out, an enemy beyond',
      board: spacious,
      state: boardWith([
        { arrow: sx, owner: A, heads: 3 },
        { arrow: exitOf(spacious.geometry, sx, 0), owner: A, heads: 1 },
        { arrow: exitOf(spacious.geometry, exitOf(spacious.geometry, sx, 1), 1), owner: B, heads: 1 },
      ]),
    },
    {
      name: 'minimal: one stack each',
      board: minimal,
      state: boardWith([
        { arrow: mx, owner: A, heads: 2 },
        { arrow: exitOf(minimal.geometry, mx, 1), owner: B, heads: 1 },
      ]),
    },
  ];
};

/** A gesture a prefix replays: select an own stack, then click a target. */
type Gesture = { readonly kind: 'select'; readonly arrow: ArrowId } | { readonly kind: 'click'; readonly arrow: ArrowId };

const play = (c: Case, gestures: readonly Gesture[]): { readonly s: Session; readonly snap: InputSnapshot } => {
  const s = session(c.state, c.board);
  let snap = s.mode.reset();
  // A select is reached by a click, as a player does it before P77 — so the bank
  // does not go red merely because `select` is new.
  for (const g of gestures) snap = click(s, g.arrow);
  return { s, snap };
};

const ownStacks = (state: GameState): readonly ArrowId[] =>
  [...state.groups.keys()].filter((arrow) => isOwnStack(state, arrow)).toSorted(compareArrows);

/** Idle; every own stack selected; and the first two non-own targets of each drafted. */
const prefixes = (c: Case): readonly (readonly Gesture[])[] => {
  const out: Gesture[][] = [[]];
  for (const own of ownStacks(c.state)) {
    const chosen: Gesture = { kind: 'select', arrow: own };
    out.push([chosen]);
    const { snap } = play(c, [chosen]);
    if (snap.phase.kind !== 'route') continue;
    const targets = [...snap.phase.offer.clickable.keys()]
      .filter((arrow) => !isOwnStack(c.state, arrow))
      .toSorted(compareArrows)
      .slice(0, 2);
    for (const target of targets) out.push([chosen, { kind: 'click', arrow: target }]);
  }
  return out;
};

/** The arrows worth clicking from a snapshot — every kind the flowchart tells apart. */
const candidates = (c: Case, snap: InputSnapshot): readonly ArrowId[] => {
  const pool = new Set<ArrowId>([...c.state.groups.keys(), ...c.state.territory.keys()]);
  if (c.board !== tiling) {
    for (const arrow of c.board.geometry.window(c.board.geometry.seedPoint(), 3).arrows) pool.add(arrow);
  }
  const h = snap.highlights;
  for (const set of [h.targets, h.merges ?? new Set<ArrowId>(), h.refused ?? new Set<ArrowId>()]) {
    for (const arrow of set) pool.add(arrow);
  }
  if (snap.phase.kind === 'route') {
    for (const arrow of snap.phase.offer.reachWash) pool.add(arrow);
    for (const arrow of exitsOf(snap)) pool.add(arrow);
    for (const arrow of grainOuts(c.board, snap.phase.tip)) pool.add(arrow);
  }
  if (snap.phase.kind !== 'idle') {
    pool.add(arrowAlong(c.board.geometry, snap.phase.from, 0, 6));
  }
  return [...pool].toSorted(compareArrows);
};

interface Clicked {
  readonly c: Case;
  readonly before: InputSnapshot;
  readonly arrow: ArrowId;
  readonly after: InputSnapshot;
  readonly label: string;
}

/** Every (prefix, candidate) click across the bank, each on a fresh mode. */
const everyClick = (): readonly Clicked[] => {
  const out: Clicked[] = [];
  for (const c of cases()) {
    for (const gestures of prefixes(c)) {
      const { snap: before } = play(c, gestures);
      for (const arrow of candidates(c, before)) {
        const { s } = play(c, gestures);
        const after = click(s, arrow);
        const path = gestures.map((g) => String(g.arrow)).join(' > ');
        out.push({ c, before, arrow, after, label: `${c.name} | ${path || 'idle'} | click ${String(arrow)}` });
      }
    }
  }
  return out;
};

/** Every route snapshot the bank reaches. */
const everyRoute = (): readonly { readonly c: Case; readonly s: Session; readonly snap: InputSnapshot; readonly label: string }[] => {
  const out: { c: Case; s: Session; snap: InputSnapshot; label: string }[] = [];
  for (const c of cases()) {
    for (const gestures of prefixes(c)) {
      const { s, snap } = play(c, gestures);
      if (snap.phase.kind !== 'route') continue;
      out.push({ c, s, snap, label: `${c.name} | ${gestures.map((g) => String(g.arrow)).join(' > ')}` });
    }
  }
  return out;
};

const CLICKS = everyClick();
const ROUTES = everyRoute();

const walkedOf = (snap: InputSnapshot): ReadonlySet<ArrowId> =>
  snap.phase.kind === 'route' ? new Set([snap.phase.from, ...exitsOf(snap)]) : new Set();

const sameDraft = (left: InputSnapshot, right: InputSnapshot): boolean =>
  JSON.stringify(left.phase.kind === 'route' ? left.phase.draft : []) ===
  JSON.stringify(right.phase.kind === 'route' ? right.phase.draft : []);

// ---------------------------------------------------------------------------
// Colour, for the paint table
// ---------------------------------------------------------------------------

const channels = (colour: string): readonly [number, number, number] | undefined => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? hex.replace(/./g, (ch) => ch + ch) : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(colour.trim());
  if (rgb === null) return undefined;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
};

const luminance = ([r, g, b]: readonly [number, number, number]): number => {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const chroma = ([r, g, b]: readonly [number, number, number]): number =>
  (Math.max(r, g, b) - Math.min(r, g, b)) / 255;

// ---------------------------------------------------------------------------

describe('P77 invariants — the bank is non-vacuous', () => {
  it('reaches route snapshots, merges, refused exits, multi-run marks and refusals', () => {
    expect(ROUTES.length).toBeGreaterThan(6);
    expect(CLICKS.length).toBeGreaterThan(100);
    expect(ROUTES.some((r) => (r.snap.highlights.merges?.size ?? 0) > 0), 'no merge reached').toBe(true);
    expect(ROUTES.some((r) => (r.snap.highlights.refused?.size ?? 0) > 0), 'no refused exit').toBe(true);
    expect(ROUTES.some((r) => routeOf(r.snap).offer.reachWash.size > 0), 'no multi-run mark').toBe(true);
    expect(CLICKS.some((k) => isEnemyStack(k.c.state, k.arrow))).toBe(true);
    expect(CLICKS.some((k) => k.before.phase.kind === 'blocked')).toBe(true);
  });
});

describe('P77 invariants', () => {
  it('1. The system shall never return `pending` from `onArrowClick`; a move reaches the host only through `send`, `requestEndTurn`, or the turn auto-pass.', () => {
    for (const k of CLICKS) expect(k.after.pending, k.label).toBeUndefined();
    // The apply-on-click test is retired, not merely unused.
    expect('autoApplies' in route, 'route.ts still exports autoApplies').toBe(false);
    expect(codeOf(sourceOf('Hud.tsx')).includes('applies at once'), 'the HUD help still promises apply-on-click').toBe(false);
  });

  it('2. When an own stack on the live board is clicked, the system shall return a snapshot whose selected stack is that arrow and whose draft is empty, whatever the phase, draft or offer before the click.', () => {
    let seen = 0;
    for (const k of CLICKS) {
      if (!isOwnStack(k.c.state, k.arrow)) continue;
      seen += 1;
      expect(selectedOf(k.after), k.label).toBe(k.arrow);
      expect(exitsOf(k.after), k.label).toEqual([]);
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('3. The system shall change the selected stack only through a click on an own stack, `select`, `reset` / `cancel` / `send` / `requestEndTurn`, or a background click — never through a click on any other arrow.', () => {
    for (const k of CLICKS) {
      if (isOwnStack(k.c.state, k.arrow)) continue;
      expect(selectedOf(k.after), k.label).toBe(selectedOf(k.before));
    }
    // Next stack and the auto-advance select through `select`, never a click.
    const app = codeOf(appSource());
    expect(app.split('.onArrowClick(').length - 1, 'App.tsx clicks outside the pointer path').toBe(1);
    expect(/\.select\(/.test(app), 'App.tsx never calls InputMode.select').toBe(true);
  });

  it('4. If a click changes the selected stack, then it shall not also change the draft of the stack selected before it into a move (no click both selects and commits).', () => {
    let changed = 0;
    for (const k of CLICKS) {
      if (selectedOf(k.after) === selectedOf(k.before)) continue;
      changed += 1;
      expect(k.after.pending, k.label).toBeUndefined();
      expect(isOwnStack(k.c.state, k.arrow), k.label).toBe(true);
    }
    expect(changed).toBeGreaterThan(5);
  });

  it('5. Every arrow in `targets ∪ merges` shall be the last exit of a draft that `rules.apply` accepts step by step on the live board.', () => {
    for (const r of ROUTES) {
      const phase = routeOf(r.snap);
      for (const arrow of [...r.snap.highlights.targets, ...(r.snap.highlights.merges ?? [])]) {
        expect(acceptsDraftTo(r.s, phase, arrow), `${r.label} → ${String(arrow)}`).toBe(true);
      }
    }
    expect(ROUTES.some((r) => (r.snap.highlights.merges?.size ?? 0) > 0)).toBe(true);
  });

  it('6. `refused` shall be disjoint from `targets`, `merges`, the multi-run marks and the draft.', () => {
    for (const r of ROUTES) {
      const phase = routeOf(r.snap);
      const refused = r.snap.highlights.refused ?? new Set<ArrowId>();
      const tipOuts = new Set(grainOuts(r.c.board, phase.tip));
      for (const arrow of refused) {
        const at = `${r.label} refused ${String(arrow)}`;
        expect(r.snap.highlights.targets.has(arrow), at).toBe(false);
        expect(r.snap.highlights.merges?.has(arrow) ?? false, at).toBe(false);
        expect(phase.offer.reachWash.has(arrow), at).toBe(false);
        expect(walkedOf(r.snap).has(arrow), at).toBe(false);
        // Measured at the tip: only the tip's grain neighbours can be refused.
        expect(tipOuts.has(arrow), at).toBe(true);
      }
    }
    expect(ROUTES.some((r) => (r.snap.highlights.refused?.size ?? 0) > 0)).toBe(true);
    // Named by the mode, not substituted by the app (Decisions).
    expect(codeOf(appSource()).includes("'would-convert'"), 'App.tsx still patches would-convert').toBe(false);
  });

  it('7. `merges` shall hold only own stacks, and `targets` shall hold none.', () => {
    for (const r of ROUTES) {
      for (const arrow of r.snap.highlights.merges ?? []) {
        expect(isOwnStack(r.c.state, arrow), `${r.label} merge ${String(arrow)}`).toBe(true);
        expect(arrow, r.label).not.toBe(routeOf(r.snap).tip);
      }
      for (const arrow of r.snap.highlights.targets) {
        expect(isOwnStack(r.c.state, arrow), `${r.label} target ${String(arrow)}`).toBe(false);
      }
      // Every own stack the offer reaches is offered as a merge.
      for (const arrow of routeOf(r.snap).offer.clickable.keys()) {
        if (!isOwnStack(r.c.state, arrow)) continue;
        expect(r.snap.highlights.merges?.has(arrow), `${r.label} unoffered merge ${String(arrow)}`).toBe(true);
      }
    }
  });

  it('8. When an arrow click leaves phase, draft and selection unchanged, the snapshot shall carry a `refusal` for that arrow.', () => {
    // Read with the flowchart: a click on an own stack *selects* and a click on a
    // walked arrow *pops*, so neither is a refused click even where it lands on
    // the same phase (re-selecting the selected stack, popping to the tip).
    let refused = 0;
    for (const k of CLICKS) {
      if (isOwnStack(k.c.state, k.arrow) || walkedOf(k.before).has(k.arrow)) continue;
      const unchanged =
        k.after.phase.kind === k.before.phase.kind &&
        selectedOf(k.after) === selectedOf(k.before) &&
        sameDraft(k.after, k.before);
      if (!unchanged) continue;
      refused += 1;
      expect(k.after.refusal?.arrow, k.label).toBe(k.arrow);
    }
    expect(refused).toBeGreaterThan(20);
  });

  it('9. `nextStack` shall visit every movable arrow exactly once and *none* exactly once per lap, in `compareArrows` order, independent of the order the movable list is given in.', () => {
    const ids = (n: number): readonly ArrowId[] =>
      Array.from({ length: n }, (_, i) => mintArrowId(`m${String(i * 7 + 3).padStart(2, '0')}`));
    for (const size of [0, 1, 2, 3, 5, 8]) {
      const pool = ids(size);
      const baseline = pool.toSorted(compareArrows);
      const orders = [pool, pool.toReversed(), ...pool.map((_, i) => [...pool.slice(i), ...pool.slice(0, i)])];
      for (const order of orders) {
        const label = `size=${String(size)} order=${order.map(String).join(',')}`;
        // Two laps from none.
        const seen: (ArrowId | undefined)[] = [];
        let at: ArrowId | undefined;
        for (let i = 0; i < 2 * (size + 1); i += 1) {
          at = nextStack(at, order);
          seen.push(at);
        }
        expect(seen, label).toEqual([...baseline, undefined, ...baseline, undefined]);
        // From an arrow that is not movable: the first movable after it, or none.
        for (const off of ['m00', 'm50', 'zz'].map(mintArrowId)) {
          const after = baseline.find((arrow) => compareArrows(arrow, off) > 0);
          expect(nextStack(off, order), `${label} from ${String(off)}`).toBe(after);
        }
      }
    }
  });

  it('10. When `Next stack` is pressed, the system shall emit no move and leave the `GameState` identical.', () => {
    for (const c of cases()) {
      const before = snapshotOf(c.state);
      const movable = movableArrows(c.board.rules, c.state);
      const s = session(c.state, c.board);
      let cursor: ArrowId | undefined;
      for (let press = 0; press < movable.length + 2; press += 1) {
        cursor = nextStack(cursor, movable);
        const snap = cursor === undefined ? s.mode.reset() : select(s, cursor);
        expect(snap.pending, `${c.name} press ${String(press)}`).toBeUndefined();
        expect(selectedOf(snap), c.name).toBe(cursor);
      }
      expect(c.state, c.name).toEqual(before);
    }
    expect(/\bnextStack\(/.test(codeOf(appSource())), 'App.tsx does not drive the lap').toBe(true);
  });

  it('11. While a stack is selected, the selection line shall name its arrow; while none is, it shall begin `No stack selected`.', () => {
    const pool = ['m1', 'm2', 'm3', 'm4'].map(mintArrowId);
    for (let size = 0; size <= pool.length; size += 1) {
      const movable = pool.slice(0, size).toReversed();
      const none = selectionLine({ selected: undefined, heads: 0, movable });
      expect(none.startsWith('No stack selected'), none).toBe(true);
      for (const selected of [...pool, mintArrowId('z9')]) {
        for (const heads of [1, 2, 13]) {
          const line = selectionLine({ selected, heads, movable });
          expect(line.includes(String(selected)), line).toBe(true);
          expect(line.startsWith('No stack selected'), line).toBe(false);
        }
      }
    }
  });

  it('12. The HUD markup before the end of the action row shall not depend on the hint, refusal, coach, BYOK, banner or illegal text.', () => {
    const { state, b0 } = twoStacks();
    const routePhase = select(session(state), b0).phase;
    const long = 'a status line long enough to wrap two or three times on a phone held upright';
    const plain = throughActionRow(renderHud());
    for (const variant of [
      { phase: { kind: 'blocked', from: b0 } as const },
      { phase: routePhase },
      { refusalNote: long },
      { byokStatus: long },
      { illegal: long },
      { starving: true },
      { phase: routePhase, refusalNote: long, byokStatus: long, illegal: long, starving: true },
    ]) {
      expect(throughActionRow(renderHud(variant)), JSON.stringify(Object.keys(variant))).toBe(plain);
    }
    const lesson = throughActionRow(renderHud({ tutorial: true }));
    expect(throughActionRow(renderHud({ tutorial: true, coach: long }))).toBe(lesson);
  });

  it('12 (Layout). Every action slot is always mounted: Pause holds its width when not offered.', () => {
    const offered = actionRow(renderHud({ pauseOffered: true }));
    const absent = actionRow(renderHud({ pauseOffered: false }));
    const buttons = (html: string): number => html.split('<button').length - 1;
    expect(buttons(absent)).toBe(buttons(offered));
    expect(/visibility:\s*hidden/.test(absent), absent).toBe(true);
  });

  it('13. A pan or pinch shall not change the input snapshot.', () => {
    const arrow = sourceArrow(geometry);
    for (const hadPointer of [true, false]) {
      for (const dragged of [true, false]) {
        for (const pinched of [true, false]) {
          for (const inputLocked of [true, false]) {
            for (const hit of [arrow, undefined]) {
              const intent = pointerUpIntent({ hadPointer, dragged, pinched, inputLocked, hit });
              const label = JSON.stringify({ hadPointer, dragged, pinched, inputLocked, hit });
              if (dragged || pinched || !hadPointer) {
                expect(intent, label).toEqual({ kind: 'nothing' });
              } else if (inputLocked) {
                expect(intent, label).toEqual(
                  hit === undefined ? { kind: 'nothing' } : { kind: 'refuse', arrow: hit, reason: 'board-busy' },
                );
              } else {
                expect(intent, label).toEqual(hit === undefined ? { kind: 'background' } : { kind: 'arrow', arrow: hit });
              }
            }
          }
        }
      }
    }
    expect(codeOf(appSource()).includes('pointerUpIntent('), 'App.tsx does not decide pointer-up through pointerUpIntent').toBe(true);
  });

  it('14. Equal inputs shall produce equal snapshots, lap positions, strip text and paint (no clock, no randomness, no iteration-order drift).', () => {
    for (const c of cases()) {
      for (const gestures of prefixes(c)) {
        for (const arrow of candidates(c, play(c, gestures).snap).slice(0, 6)) {
          const left = play(c, gestures);
          const right = play(c, gestures);
          expect(click(left.s, arrow), `${c.name} ${String(arrow)}`).toEqual(click(right.s, arrow));
        }
      }
    }
    const movable = ['m3', 'm1', 'm2'].map(mintArrowId);
    expect(nextStack(undefined, movable)).toBe(nextStack(undefined, movable.toReversed()));
    expect(selectionLine({ selected: movable[0], heads: 2, movable })).toBe(
      selectionLine({ selected: movable[0], heads: 2, movable: movable.toReversed() }),
    );
    expect(turnStatus(2)).toBe(turnStatus(2));
    for (const tier of ['drafted', 'one-run', 'multi-run', 'merge'] as const) {
      expect(tierStyle(tier)).toEqual(tierStyle(tier));
    }
    for (const file of ['selection/status.ts', 'input/pointer.ts', 'selection/cursor.ts', 'input/modes.ts', 'selectionChrome.ts']) {
      const code = codeOf(sourceOf(file));
      for (const banned of ['Date.now', 'new Date', 'Math.random', 'performance.now', 'crypto.']) {
        expect(code.includes(banned), `${file} uses ${banned}`).toBe(false);
      }
    }
  });
});

describe('P77 replay — gestures land on one exact move list and one exact board', () => {
  const replay = (): { readonly moves: readonly Move[]; readonly state: GameState } => {
    const { state: start, a0, b0 } = twoStacks();
    const moves: Move[] = [];
    let state = start;
    // S2 merges into S1 through the strip, then S1 (now 3 heads) sends 2 on one step.
    let s = session(state);
    select(s, b0);
    s.mode.mergeInto(a0);
    const merge = s.mode.send().pending ?? [];
    for (const move of merge) state = rules.apply(state, move);
    moves.push(...merge);
    s = session(state);
    select(s, a0);
    click(s, arrowAlong(geometry, a0, 0, 1));
    s.mode.setCarry(2);
    const run = s.mode.send().pending ?? [];
    for (const move of run) state = rules.apply(state, move);
    moves.push(...run);
    return { moves, state };
  };

  it('replays to the golden list and board, twice', () => {
    const { a0, b0 } = twoStacks();
    const t1 = arrowAlong(geometry, a0, 0, 1);
    const first = replay();
    expect(first.moves).toEqual([step(b0, a0, 1), step(a0, t1, 2)]);
    expect(headsOn(first.state, a0)).toBe(1);
    expect(headsOn(first.state, t1)).toBe(2);
    expect(first.state.groups.has(b0)).toBe(false);
    expect(replay()).toEqual(first);
  });
});

describe('P77 normative strip copy', () => {
  it('REFUSAL_TEXT keeps a selection-free sentence per reason', () => {
    const table: Readonly<Record<RefusalReason, string>> = {
      'nothing-selected': 'Nothing selected · click one of your stacks first',
      'not-yours': 'Not your stack',
      'out-of-reach': 'Too far this turn',
      'no-exit': 'Nowhere to go from here',
      'would-convert': 'No trail home — those heads would flip',
      'not-one-run': 'Reachable, but not in one run · click a lit arrow on the way first',
      'board-busy': 'The board is not taking moves right now',
    };
    expect(REFUSAL_TEXT).toEqual(table);
    for (const reason of Object.keys(table) as RefusalReason[]) {
      expect(refusalText(reason), reason).toBe(table[reason]);
    }
  });

  it('refusalText names the selected stack where the table says so', () => {
    const z = mintArrowId('-4,6,2');
    expect(refusalText('out-of-reach', z)).toBe('Too far for the stack on -4,6,2');
    expect(refusalText('no-exit', z)).toBe('The stack on -4,6,2 has no move left this turn');
    for (const reason of ['nothing-selected', 'not-yours', 'would-convert', 'not-one-run', 'board-busy'] as const) {
      expect(refusalText(reason, z), reason).toBe(REFUSAL_TEXT[reason]);
    }
  });

  it('the turn status and the selection line read as the tables say', () => {
    expect(turnStatus(1)).toBe('1 stack can still move · End turn when done');
    expect(turnStatus(3)).toBe('3 stacks can still move · End turn when done');
    expect(turnStatus(0)).toBe('Nothing can move · the turn passes by itself');
    const movable = ['m1', 'm2'].map(mintArrowId);
    expect(selectionLine({ selected: undefined, heads: 0, movable })).toBe('No stack selected · 2 can move');
    expect(selectionLine({ selected: movable[1], heads: 5, movable })).toBe('Selected: 5 on m2 · 2 of 2');
  });

  it('the leftover note and the route hints read as the tables say', () => {
    const t = mintArrowId('t');
    expect(leftoverNote({ count: 2, ceiling: 2, start: t })).toBe('No head stays behind');
    expect(leftoverNote({ count: 1, ceiling: 2, start: t })).toBe('1 head stays on t');
    expect(leftoverNote({ count: 1, ceiling: 6, start: t })).toBe('5 heads stay on t');
    expect(ROUTE_HINT_EMPTY).toBe(
      'Click a lit arrow to draft a run · one turn at the end is free · dashed = needs more than one run',
    );
    expect(ROUTE_HINT_DRAFTED).toBe('Click to extend · click a walked arrow to go back · Send to move');
    expect(ROUTE_HINT_FINISHED).toBe(
      'This run can go no further · click a walked arrow to go back · Send to move',
    );
  });
});

describe('P77 normative paint', () => {
  it('the selected marker is a static two-layer outline, wide and dark beneath cream', () => {
    expect(SELECTED_STROKE_WIDTH).toBeGreaterThanOrEqual(6);
    const under = channels(SELECTED_UNDER_STROKE);
    expect(under, `SELECTED_UNDER_STROKE '${SELECTED_UNDER_STROKE}' is not a colour`).toBeDefined();
    if (under !== undefined) expect(luminance(under)).toBeLessThan(0.2);
    for (const other of [PATH_STROKE, PREVIEW_STROKE]) {
      expect(SELECTED_HALO_STROKE.toLowerCase()).not.toBe(other.toLowerCase());
    }
    const board = codeOf(boardSource());
    expect(board.includes('SELECTED_UNDER_STROKE'), 'Board.tsx does not paint the under-stroke').toBe(true);
    expect(/SELECTED_STROKE_WIDTH\s*\+\s*4/.test(board), 'the under-stroke is not 4 wider').toBe(true);
  });

  it('two shades plus a dashed neutral multi-run mark, and a dashed merge tier', () => {
    const style = (tier: RouteTier) => tierStyle(tier);
    expect(style('drafted').stroke).toBe(PATH_STROKE);
    expect(style('one-run').stroke).toBe(PREVIEW_STROKE);
    expect(style('drafted').stroke).not.toBe(style('one-run').stroke);
    expect(style('multi-run').stroke).toBe(MULTI_RUN_STROKE);
    expect(style('multi-run').dash).toBeDefined();
    const neutral = channels(MULTI_RUN_STROKE);
    expect(neutral, `MULTI_RUN_STROKE '${MULTI_RUN_STROKE}' is not a colour`).toBeDefined();
    if (neutral !== undefined) expect(chroma(neutral)).toBeLessThanOrEqual(0.2);
    expect(MULTI_RUN_STROKE).not.toBe(PREVIEW_STROKE);
    expect(MULTI_RUN_STROKE).not.toBe(PATH_STROKE);
    expect(style('merge').dash).toBeDefined();
    expect(style('merge').stroke).not.toBe(PREVIEW_STROKE);
    expect(codeOf(boardSource()).includes('tierStyle('), 'Board.tsx does not read tierStyle').toBe(true);
  });
});
