/**
 * docs/spec/seat-vanish-fx/seat-vanish-fx.edge-cases.feature
 * One it() per Gherkin scenario. Hand-authored diffs — no rules.apply.
 */

import { describe, expect, it } from 'vitest';
import { overlayLifetimeMs } from '../src/fx/present';
import { emptyQueue, enqueue, queueSettleMs } from '../src/fx/queue';
import { AUDIBLE_KINDS, cueFor } from '../src/fx/sound';
import {
  A,
  alreadyGoneC,
  B,
  C,
  closeOwnLoopA,
  cutBVanishC,
  foldOf,
  hadPieces,
  headlessButPaidC,
  livingBTrailDrop,
  MAX_FX_CELLS,
  namedSeatVanished,
  presentOf,
  resolveOf,
  seatVanishedFor,
  seatVanishOverlay,
  passNobodyVanishes,
  tile,
  trailCutFor,
  VACATED,
  vanishBC,
  vanishCLeavingRemnants,
  vanishCTrailDrop,
} from './seat-vanish-fx.support';

describe('Leftover land and several seats', () => {
  it('Unowned leftover territory is a remnant, not a retraction to nobody', () => {
    const pair = vanishCLeavingRemnants();
    const events = resolveOf(pair);
    const overlays = presentOf(events);
    const remnant = new Set(seatVanishedFor(events, C)?.arrows ?? []);

    expect(remnant.has(VACATED[0])).toBe(true);
    expect(remnant.has(VACATED[1])).toBe(true);
    expect(
      events.some(
        (event) => event.kind === 'territoryLost' && event.player === C && event.to === undefined,
      ),
    ).toBe(false);

    const retract = overlays.filter(
      (overlay): overlay is Extract<(typeof overlays)[number], { kind: 'lossRetract' }> =>
        overlay.kind === 'lossRetract' && overlay.player === C,
    );
    for (const overlay of retract) {
      const cells = new Set(overlay.cells.map((cell) => cell.arrow));
      expect(cells.has(VACATED[0])).toBe(false);
      expect(cells.has(VACATED[1])).toBe(false);
    }
  });

  it('Two seats vanish in players order', () => {
    const events = resolveOf(vanishBC());
    expect(events.filter((event) => event.kind === 'seatVanished').map((event) => event.player)).toEqual(
      [B, C],
    );
  });

  it('An already-gone seat is not named again', () => {
    const pair = alreadyGoneC();
    expect(hadPieces(pair.before, C)).toBe(false);
    expect(hadPieces(pair.after, C)).toBe(false);
    expect(seatVanishedFor(resolveOf(pair), C)).toBeUndefined();
  });

  it('A headless-but-paid seat is not vanished', () => {
    const pair = headlessButPaidC();
    expect(hadPieces(pair.after, C)).toBe(true);
    expect([...pair.after.groups.values()].some((group) => group.owner === C)).toBe(false);
    expect(pair.after.trails.get(C)?.size ?? 0).toBe(0);
    expect(seatVanishedFor(resolveOf(pair), C)).toBeUndefined();
  });

  it("Every remnant cell is gone from after as that player's piece", () => {
    const pair = vanishCLeavingRemnants();
    const overlay = seatVanishOverlay(presentOf(resolveOf(pair)), C);
    expect(overlay).toBeDefined();
    for (const cell of overlay?.cells ?? []) {
      expect(pair.after.territory.get(cell.arrow)).not.toBe(C);
      expect(pair.after.trails.get(C)?.has(cell.arrow) ?? false).toBe(false);
      expect(pair.after.groups.get(cell.arrow)?.owner).not.toBe(C);
    }
  });
});

describe('The same move can vanish one seat and cut another', () => {
  it("A living bystander's trail still evaporates beside a vanish", () => {
    const pair = cutBVanishC();
    const events = resolveOf(pair);
    const overlays = presentOf(events);

    expect(trailCutFor(events, B)?.victim).toBe(B);
    expect(overlays.some((overlay) => overlay.kind === 'evaporate' && overlay.victim === B)).toBe(
      true,
    );
    expect(seatVanishedFor(events, C)?.player).toBe(C);
    expect(overlays.some((overlay) => overlay.kind === 'evaporate' && overlay.victim === C)).toBe(
      false,
    );
  });

  it("Closing the mover's own loop is still not a vanish", () => {
    const pair = closeOwnLoopA();
    const events = resolveOf(pair);
    expect(hadPieces(pair.after, A)).toBe(true);
    expect(seatVanishedFor(events, A)).toBeUndefined();
    expect(trailCutFor(events, A)).toBeUndefined();
  });
});

describe('Playtest cuts stay honest', () => {
  it("A vanished seat's trail drop does not increment cuts", () => {
    const pair = vanishCTrailDrop();
    expect(hadPieces(pair.after, C)).toBe(false);
    expect((pair.after.trails.get(B)?.size ?? 0) >= (pair.before.trails.get(B)?.size ?? 0)).toBe(
      true,
    );
    expect(foldOf(pair).cuts).toBe(0);
  });

  it("A living victim's trail drop still increments cuts", () => {
    const pair = livingBTrailDrop();
    expect(hadPieces(pair.after, B)).toBe(true);
    expect(foldOf(pair).cuts).toBe(1);
  });
});

describe('The celebration still waits, and now sees the vanish', () => {
  it("A vanish overlay's lifetime is in the move's settle", () => {
    const pair = vanishCTrailDrop();
    const overlays = presentOf(resolveOf(pair));
    const overlay = seatVanishOverlay(overlays, C);

    expect(overlay).toBeDefined();
    if (overlay === undefined) return;
    expect(overlay.offsetMs).toBe(360);
    expect(overlay.durationMs).toBe(520);
    expect(overlayLifetimeMs(overlay)).toBe(880);

    const settle = queueSettleMs(enqueue(emptyQueue(), overlays, 0), 0);
    expect(settle).toBeGreaterThanOrEqual(880);
  });

  it('More than 120 remnant arrows keep the first 120 in id order', () => {
    const remnant = Array.from({ length: MAX_FX_CELLS + 30 }, (_v, i) => tile(i, 8, 0));
    const ordered = [...remnant].toSorted((left, right) => {
      const a = String(left);
      const b = String(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const overlay = seatVanishOverlay(presentOf([namedSeatVanished(C, ordered)]), C);

    expect(overlay).toBeDefined();
    if (overlay === undefined) return;
    expect(overlay.cells).toHaveLength(MAX_FX_CELLS);
    expect(overlay.cells.map((cell) => cell.arrow)).toEqual(ordered.slice(0, MAX_FX_CELLS));
  });
});

describe('Sound and determinism', () => {
  it('seatVanish is audible with a falling sine, not a cut snap', () => {
    const vanish = cueFor('seatVanish');
    const snap = cueFor('cutSnap');

    expect(vanish).toEqual({ fromHz: 392, toHz: 147, ms: 260, gain: 0.05, wave: 'sine' });
    expect(vanish?.toHz).toBeLessThan(vanish?.fromHz ?? 0);
    expect(vanish?.wave).toBe('sine');
    expect(snap?.wave).not.toBe(vanish?.wave);
    expect(AUDIBLE_KINDS).toContain('seatVanish');
  });

  it('Equal diffs yield equal vanish events and overlays', () => {
    const leftPair = vanishCLeavingRemnants();
    const rightPair = vanishCLeavingRemnants();
    const leftEvents = resolveOf(leftPair);
    const rightEvents = resolveOf(rightPair);

    expect(seatVanishedFor(leftEvents, C)).toBeDefined();
    expect(JSON.stringify(pickVanished(leftEvents))).toBe(JSON.stringify(pickVanished(rightEvents)));

    const leftOverlays = presentOf(leftEvents)
      .filter((overlay) => overlay.kind === 'seatVanish')
      .map((overlay) => ({ ...overlay, id: '' }));
    const rightOverlays = presentOf(rightEvents)
      .filter((overlay) => overlay.kind === 'seatVanish')
      .map((overlay) => ({ ...overlay, id: '' }));
    expect(leftOverlays.length).toBeGreaterThan(0);
    expect(JSON.stringify(leftOverlays)).toBe(JSON.stringify(rightOverlays));
  });

  it('Remnant cells are sorted by arrow id', () => {
    const vanished = seatVanishedFor(resolveOf(vanishCLeavingRemnants()), C);
    expect(vanished).toBeDefined();
    const strings = (vanished?.arrows ?? []).map(String);
    expect(strings.length).toBeGreaterThan(1);
    expect(strings).toEqual([...strings].toSorted());
  });

  it('A pass that vanishes nobody emits no seatVanished', () => {
    const pair = passNobodyVanishes();
    expect(hadPieces(pair.before, A)).toBe(true);
    expect(hadPieces(pair.after, A)).toBe(true);
    expect(hadPieces(pair.after, B)).toBe(true);
    expect(hadPieces(pair.after, C)).toBe(true);
    expect(resolveOf(pair).some((event) => event.kind === 'seatVanished')).toBe(false);
  });

  it('resolveEvents does not read a clock or a random source', () => {
    const pair = vanishCLeavingRemnants();
    const now = Date.now;
    const rand = Math.random;
    let nowCalls = 0;
    let randCalls = 0;
    Date.now = (): number => {
      nowCalls += 1;
      return now();
    };
    Math.random = (): number => {
      randCalls += 1;
      return rand();
    };
    try {
      presentOf(resolveOf(pair));
    } finally {
      Date.now = now;
      Math.random = rand;
    }
    expect(nowCalls).toBe(0);
    expect(randCalls).toBe(0);
  });
});

const pickVanished = (events: readonly { readonly kind: string }[]): unknown =>
  events.filter((event) => event.kind === 'seatVanished');
