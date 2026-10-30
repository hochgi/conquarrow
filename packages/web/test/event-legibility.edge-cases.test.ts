/**
 * The presentation layer under pressure.
 *
 * Requirements 3 and 4 of the brief live here: many events at once must not corrupt
 * presentation state, and an interrupted animation must still leave the correct
 * final state. Both are answered structurally rather than defensively — the queue
 * holds nothing the board needs — and these tests pin that structure so a later
 * change cannot quietly make an overlay authoritative.
 */

import { describe, expect, it } from 'vitest';
import type { GameState, Move, RulesPort } from '@conquarrow/contracts';
import { resolveEvents } from '../src/fx/events';
import {
  FX_STEP_GAP_MS,
  MAX_FX_CELLS,
  overlayLifetimeMs,
  presentEvents,
  presentRefusal,
  presentSteps,
  REFUSAL_TEXT,
  type FxOverlay,
} from '../src/fx/present';
import {
  arrowsWithKind,
  emptyQueue,
  enqueue,
  isResolving,
  MAX_FX_ITEMS,
  overlaysOfKind,
  pruneQueue,
  queueSettleMs,
} from '../src/fx/queue';
import { replaySteps } from '../src/fx/steps';
import { ringsFrom, staggerFrom } from '../src/fx/spatial';
import { FX_STAGGER_CAP_MS } from '../src/fx/timing';
import { A, B, geometry, state, tile } from './event-legibility.support';

const step = (from: string, exit: string, count: number): Move => ({
  kind: 'step',
  from: from as never,
  exit: exit as never,
  count,
});

const captureOverlays = (size: number): readonly FxOverlay[] => {
  const arrows = Array.from({ length: size }, (_v, i) => tile(i, 0, 0));
  return presentEvents(
    [
      {
        kind: 'territoryCaptured',
        player: A,
        arrows,
        fromArrow: arrows[0],
        takenFrom: [],
      },
    ],
    { geometry, seq: 1 },
  );
};

describe('spatial staggering', () => {
  it('walks outward from the seed over the affected region only', () => {
    const seed = tile(0, 0, 0);
    const next = geometry.outArrows(geometry.target(seed))[0];
    expect(next).toBeDefined();
    if (next === undefined) return;
    const far = geometry.outArrows(geometry.target(next))[0];
    expect(far).toBeDefined();
    if (far === undefined) return;

    const rings = ringsFrom(geometry, seed, [seed, next, far]);
    expect(rings.get(String(seed))).toBe(0);
    expect(rings.get(String(next))).toBe(1);
    expect(rings.get(String(far))).toBe(2);
  });

  it('caps accumulated stagger so a huge region does not animate for seconds', () => {
    const chain = [tile(0, 0, 0)];
    for (let i = 0; i < 40; i += 1) {
      const last = chain[chain.length - 1];
      if (last === undefined) break;
      const nxt = geometry.outArrows(geometry.target(last))[0];
      if (nxt === undefined) break;
      chain.push(nxt);
    }
    const delays = staggerFrom(geometry, chain[0], chain, 26, FX_STAGGER_CAP_MS);
    for (const d of delays.values()) expect(d).toBeLessThanOrEqual(FX_STAGGER_CAP_MS);
  });

  it('gives unreachable members a delay rather than dropping them', () => {
    // Two arrows with no shared point: the second is its own component.
    const seed = tile(0, 0, 0);
    const island = tile(40, 40, 0);
    const rings = ringsFrom(geometry, seed, [seed, island]);
    expect(rings.get(String(seed))).toBe(0);
    expect(rings.get(String(island))).toBeGreaterThan(0);
  });

  it('fires everything together rather than inventing an order without geometry', () => {
    const arrows = [tile(0, 0, 0), tile(1, 0, 0)];
    const delays = staggerFrom(undefined, arrows[0], arrows, 26, FX_STAGGER_CAP_MS);
    expect([...delays.values()]).toEqual([0, 0]);
  });
});

describe('presentation of a capture', () => {
  it('orders the chain cause-before-consequence', () => {
    const loop = [tile(0, 0, 0), tile(1, 0, 0)] as const;
    const overlays = presentEvents(
      [
        {
          kind: 'enclosureClosed',
          player: A,
          closingArrow: loop[1],
          boundary: [...loop],
          claimed: [...loop],
        },
        {
          kind: 'territoryCaptured',
          player: A,
          arrows: [...loop],
          fromArrow: loop[1],
          takenFrom: [],
        },
        { kind: 'unitsProduced', player: A, arrow: loop[0], amount: 1 },
      ],
      { geometry, seq: 1 },
    );

    const offsetOf = (kind: FxOverlay['kind']): number =>
      overlays.find((o) => o.kind === kind)?.offsetMs ?? -1;

    // The loop pulses, then the ground fills, then the fresh marker, then heads.
    expect(offsetOf('loopPulse')).toBeLessThan(offsetOf('captureFill'));
    expect(offsetOf('captureFill')).toBeLessThan(offsetOf('captureFresh'));
    expect(offsetOf('captureFresh')).toBeLessThanOrEqual(offsetOf('emergence'));
  });

  it('caps cells per overlay instead of drawing an unbounded region', () => {
    const overlays = captureOverlays(MAX_FX_CELLS + 50);
    for (const overlay of overlays) {
      if ('cells' in overlay) expect(overlay.cells.length).toBeLessThanOrEqual(MAX_FX_CELLS);
    }
  });

  it('keeps the animated part of the biggest chain inside its budget', () => {
    const overlays = captureOverlays(60);
    const fill = overlays.find((o) => o.kind === 'captureFill');
    expect(fill).toBeDefined();
    if (fill === undefined || !('cells' in fill)) return;
    // Offset plus the slowest cell plus the effect itself — the whole fill.
    expect(overlayLifetimeMs(fill)).toBeLessThanOrEqual(1000);
  });

  it('cascades several productions instead of flashing them together', () => {
    const overlays = presentEvents(
      [
        { kind: 'unitsProduced', player: A, arrow: tile(0, 0, 0), amount: 1 },
        { kind: 'unitsProduced', player: A, arrow: tile(1, 0, 0), amount: 1 },
        { kind: 'unitsProduced', player: A, arrow: tile(2, 0, 0), amount: 1 },
      ],
      { geometry, seq: 1 },
    );
    const offsets = overlays.filter((o) => o.kind === 'emergence').map((o) => o.offsetMs);
    expect(offsets).toHaveLength(3);
    expect(offsets[0]).toBeLessThan(offsets[1] ?? 0);
    expect(offsets[1]).toBeLessThan(offsets[2] ?? 0);
  });

  it('gives a cut both a break at the point and a burn outward from it', () => {
    const trail = [tile(0, 0, 0), tile(1, 0, 0)] as const;
    const overlays = presentEvents(
      [
        {
          kind: 'trailCut',
          victim: A,
          attacker: B,
          cutArrow: trail[0],
          arrows: [...trail],
        },
      ],
      { geometry, seq: 1 },
    );
    const snap = overlays.find((o) => o.kind === 'cutSnap');
    const burn = overlays.find((o) => o.kind === 'evaporate');
    expect(snap).toBeDefined();
    expect(burn).toBeDefined();
    // The break is the cause and lands first.
    expect(snap?.offsetMs ?? 1).toBeLessThan(burn?.offsetMs ?? 0);
  });

  it('offsets each step of a trip so the trip reads as a sequence', () => {
    const a = tile(0, 0, 0);
    const b = geometry.outArrows(geometry.target(a))[0];
    expect(b).toBeDefined();
    if (b === undefined) return;
    const c = geometry.outArrows(geometry.target(b))[0];
    expect(c).toBeDefined();
    if (c === undefined) return;

    const s0 = state({ groups: [[a, A, 1]] });
    const s1 = state({ groups: [[b, A, 1]], trails: [[A, [a]]] });
    const s2 = state({ groups: [[c, A, 1]], trails: [[A, [a, b]]] });

    const overlays = presentSteps(
      [
        { before: s0, after: s1, move: step(a, b, 1) },
        { before: s1, after: s2, move: step(b, c, 1) },
      ],
      { geometry, seq: 1 },
    );

    const advances = overlays.filter((o) => o.kind === 'advance');
    expect(advances).toHaveLength(2);
    expect((advances[1]?.offsetMs ?? 0) - (advances[0]?.offsetMs ?? 0)).toBe(FX_STEP_GAP_MS);
  });

  it('gives every overlay a distinct id, so React never reuses a node', () => {
    const overlays = presentSteps(
      [
        {
          before: state({ groups: [[tile(0, 0, 0), A, 3]] }),
          after: state({
            groups: [
              [tile(0, 0, 0), A, 1],
              [tile(1, 0, 0), A, 2],
            ],
          }),
          move: step(tile(0, 0, 0), tile(1, 0, 0), 2),
        },
      ],
      { geometry, seq: 7 },
    );
    const ids = overlays.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the presentation queue', () => {
  const overlay = (kind: 'captureFill' | 'advance', id: string): FxOverlay =>
    kind === 'advance'
      ? {
          id,
          kind: 'advance',
          offsetMs: 0,
          durationMs: 200,
          tier: 3,
          player: A,
          from: tile(0, 0, 0),
          to: tile(1, 0, 0),
          heads: 1,
        }
      : {
          id,
          kind: 'captureFill',
          offsetMs: 0,
          durationMs: 400,
          tier: 1,
          player: A,
          cells: [{ arrow: tile(0, 0, 0), delayMs: 0 }],
          takenFrom: [],
        };

  it('drops routine effects before major ones when it overflows', () => {
    let queue = emptyQueue();
    // Twice the cap in routine steps, then one capture.
    for (let i = 0; i < MAX_FX_ITEMS * 2; i += 1) {
      queue = enqueue(queue, [overlay('advance', `adv-${String(i)}`)], 1000);
    }
    queue = enqueue(queue, [overlay('captureFill', 'cap-1')], 1000);
    expect(queue.length).toBeLessThanOrEqual(MAX_FX_ITEMS);
    expect(overlaysOfKind(queue, 'captureFill').map((o) => o.id)).toEqual(['cap-1']);
  });

  it('retires effects on schedule and reports when it is next worth pruning', () => {
    const queue = enqueue(emptyQueue(), [overlay('captureFill', 'cap-1')], 1000);
    expect(queueSettleMs(queue, 1000)).toBe(400);
    expect(pruneQueue(queue, 1200)).toHaveLength(1);
    expect(pruneQueue(queue, 1500)).toHaveLength(0);
    expect(queueSettleMs(pruneQueue(queue, 1500), 1500)).toBe(0);
  });

  it('says it is resolving only while a major effect is still playing', () => {
    const queue = enqueue(emptyQueue(), [overlay('captureFill', 'cap-1')], 1000);
    expect(isResolving(queue, 1100)).toBe(true);
    expect(isResolving(queue, 1500)).toBe(false);
    const routine = enqueue(emptyQueue(), [overlay('advance', 'adv-1')], 1000);
    expect(isResolving(routine, 1050)).toBe(false);
  });

  it('keeps the identical array when nothing expired, so React can skip a render', () => {
    const queue = enqueue(emptyQueue(), [overlay('captureFill', 'cap-1')], 1000);
    expect(pruneQueue(queue, 1100)).toBe(queue);
    expect(enqueue(queue, [], 1100)).toBe(queue);
  });

  it('indexes overlays by arrow for the board to look up', () => {
    const queue = enqueue(emptyQueue(), [overlay('captureFill', 'cap-1')], 1000);
    expect(arrowsWithKind(queue, 'captureFill').has(String(tile(0, 0, 0)))).toBe(true);
    expect(arrowsWithKind(queue, 'combat').size).toBe(0);
  });

  it('survives a flood of simultaneous batches without losing the majors', () => {
    let queue = emptyQueue();
    // Ten batches landing in the same millisecond — an online burst, or a bot turn.
    for (let batch = 0; batch < 10; batch += 1) {
      queue = enqueue(
        queue,
        [
          overlay('advance', `adv-${String(batch)}`),
          overlay('captureFill', `cap-${String(batch)}`),
        ],
        5000,
      );
    }
    expect(queue.length).toBeLessThanOrEqual(MAX_FX_ITEMS);
    expect(overlaysOfKind(queue, 'captureFill')).toHaveLength(10);
    // Ids stay unique, so no two overlays can collide in the render tree.
    expect(new Set(queue.map((i) => i.overlay.id)).size).toBe(queue.length);
  });
});

describe('refusals', () => {
  it('anchors the refusal at the clicked arrow and names the constraint', () => {
    const overlay = presentRefusal(tile(0, 0, 0), 'out-of-reach', 3);
    expect(overlay.kind).toBe('refusal');
    expect(overlay.arrow).toBe(tile(0, 0, 0));
    expect(overlay.offsetMs).toBe(0);
    expect(REFUSAL_TEXT[overlay.reason]).toBe('Too far this turn');
  });

  it('has a short, non-punishing phrase for every reason', () => {
    // P77 fixes the wording per reason (board-selection-model *Refusals*): one
    // sentence each, and `not-one-run`'s is longer than this test's old 50-char
    // bound. "Short" is now "one sentence on one line".
    for (const [, text] of Object.entries(REFUSAL_TEXT)) {
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThan(80);
      expect(text).not.toMatch(/!|INVALID|\n|\. \S/);
    }
  });
});

describe('rebuilding the chain behind a batch', () => {
  const rules: RulesPort = {
    apply: (s: GameState, move: Move): GameState =>
      move.kind === 'step'
        ? state({ groups: [[move.exit, A, move.count]] })
        : { ...s, activePlayer: B },
  } as unknown as RulesPort;

  it('rebuilds one step per move so each cause is distinguishable', () => {
    const before = state({ groups: [[tile(0, 0, 0), A, 1]] });
    const after = state({ groups: [[tile(2, 0, 0), A, 1]] });
    const moves = [step(tile(0, 0, 0), tile(1, 0, 0), 1), step(tile(1, 0, 0), tile(2, 0, 0), 1)];
    const steps = replaySteps(rules, before, moves, after);
    expect(steps).toHaveLength(2);
    expect(steps[0]?.before).toBe(before);
    expect(steps[1]?.move).toBe(moves[1]);
  });

  it('falls back to one coarse step when the local rebuild disagrees', () => {
    const throwing = {
      apply: (): GameState => {
        throw new Error('online seat produced this, not us');
      },
    } as unknown as RulesPort;
    const before = state({ groups: [[tile(0, 0, 0), A, 1]] });
    const after = state({ groups: [[tile(2, 0, 0), A, 1]] });
    const moves = [step(tile(0, 0, 0), tile(1, 0, 0), 1), step(tile(1, 0, 0), tile(2, 0, 0), 1)];
    const steps = replaySteps(throwing, before, moves, after);
    // Degrades to a single coarse transition — never to a wrong board.
    expect(steps).toHaveLength(1);
    expect(steps[0]?.before).toBe(before);
    expect(steps[0]?.after).toBe(after);
    expect(steps[0]?.move).toBe(moves[1]);
  });

  it('reports nothing for an empty batch', () => {
    const before = state({});
    expect(replaySteps(rules, before, [], before)).toEqual([]);
  });
});

describe('interruption', () => {
  it('leaves nothing behind that the board needs to be correct', () => {
    // The whole safety argument, as a test: resolve a capture, throw the entire
    // presentation away mid-flight, and the state the board renders is untouched.
    const loop = [tile(0, 0, 0), tile(1, 0, 0)] as const;
    const before = state({ groups: [[loop[0], A, 1]], trails: [[A, [...loop]]] });
    const after = state({
      groups: [[loop[1], A, 1]],
      trails: [[A, []]],
      territory: [
        [loop[0], A],
        [loop[1], A],
      ],
    });
    const events = resolveEvents({ before, after, move: step(loop[0], loop[1], 1) });
    const overlays = presentEvents(events, { geometry, seq: 1 });
    expect(overlays.length).toBeGreaterThan(0);

    const queue = enqueue(emptyQueue(), overlays, 1000);
    const wiped = pruneQueue(queue, 1_000_000);
    expect(wiped).toHaveLength(0);
    // `after` is the same object it always was; no overlay mutated it.
    expect(after.territory.get(loop[0])).toBe(A);
    expect(after.territory.get(loop[1])).toBe(A);
    expect(after.groups.get(loop[1])?.heads).toBe(1);
  });
});
