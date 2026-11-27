/**
 * EARS invariants from docs/spec/seat-vanish-fx/seat-vanish-fx.md.
 *
 * Table-driven over hand-authored vanish / living diffs. No fast-check, no
 * rules-core replay — this packet does not edit the engine.
 */

import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@conquarrow/contracts';
import { overlayLifetimeMs, type FxOverlay } from '../src/fx/present';
import { emptyQueue, enqueue, queueSettleMs } from '../src/fx/queue';
import {
  B,
  C,
  foldOf,
  hadPieces,
  LIVING_PAIRS,
  presentOf,
  readResolverSrc,
  readWebSrc,
  remnantArrows,
  resolveOf,
  seatVanishedFor,
  seatVanishOverlay,
  vanishCBPlayersOrder,
  vanishCEmptyRemnant,
  vanishCLeavingRemnants,
  vanishedPlayersOf,
  VANISH_PAIRS,
} from './seat-vanish-fx.support';

describe('seat-vanish-fx invariants', () => {
  it('1. When a player had at least one piece before a step and has none after, the system shall emit seatVanished for that player', () => {
    for (const [label, pair] of VANISH_PAIRS) {
      const events = resolveOf(pair);
      for (const player of vanishedPlayersOf(pair)) {
        expect(seatVanishedFor(events, player), label).toBeDefined();
      }
    }
  });

  it('2. When the system emits seatVanished for a player, it shall not emit trailCut for that player on that step', () => {
    for (const [label, pair] of VANISH_PAIRS) {
      const events = resolveOf(pair);
      for (const player of vanishedPlayersOf(pair)) {
        expect(seatVanishedFor(events, player), label).toBeDefined();
        expect(
          events.some((event) => event.kind === 'trailCut' && event.victim === player),
          label,
        ).toBe(false);
      }
    }
  });

  it('3. When the system emits seatVanished for a player, it shall not emit territoryLost for arrows that became unowned', () => {
    for (const [label, pair] of VANISH_PAIRS) {
      const events = resolveOf(pair);
      for (const player of vanishedPlayersOf(pair)) {
        expect(
          events.some(
            (event) =>
              event.kind === 'territoryLost' && event.player === player && event.to === undefined,
          ),
          label,
        ).toBe(false);
      }
    }
  });

  it("4. The system shall still emit territoryLost for a vanished player's arrows that another player holds after the step", () => {
    let seen = 0;
    for (const [label, pair] of VANISH_PAIRS) {
      const events = resolveOf(pair);
      for (const player of vanishedPlayersOf(pair)) {
        const captured: string[] = [];
        for (const [arrow, owner] of pair.before.territory) {
          if (owner !== player) continue;
          const now = pair.after.territory.get(arrow);
          if (now !== undefined && now !== player) captured.push(String(arrow));
        }
        if (captured.length === 0) continue;
        seen += 1;
        const lost = events.filter(
          (event): event is Extract<GameEvent, { kind: 'territoryLost' }> =>
            event.kind === 'territoryLost' && event.player === player && event.to !== undefined,
        );
        const named = new Set(lost.flatMap((event) => event.arrows.map(String)));
        expect([...captured].toSorted(), label).toEqual([...named].toSorted());
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("5. The system shall still emit unitsConverted where a vanished player's group changed owner in place", () => {
    let seen = 0;
    for (const [label, pair] of VANISH_PAIRS) {
      const events = resolveOf(pair);
      for (const player of vanishedPlayersOf(pair)) {
        for (const [arrow, group] of pair.before.groups) {
          if (group.owner !== player) continue;
          const now = pair.after.groups.get(arrow);
          if (now === undefined || now.owner === player) continue;
          seen += 1;
          expect(
            events.some(
              (event) =>
                event.kind === 'unitsConverted' &&
                event.arrow === arrow &&
                event.from === player &&
                event.to === now.owner,
            ),
            label,
          ).toBe(true);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('6. The system shall present a non-empty seatVanished as one seatVanish overlay whose every cell has delayMs 0', () => {
    for (const [label, pair] of VANISH_PAIRS) {
      const overlays = presentOf(resolveOf(pair));
      for (const player of vanishedPlayersOf(pair)) {
        if (remnantArrows(pair.before, pair.after, player).length === 0) continue;
        const matches = overlays.filter(
          (overlay) => overlay.kind === 'seatVanish' && overlay.player === player,
        );
        expect(matches, label).toHaveLength(1);
        const overlay = matches[0];
        expect(overlay?.kind, label).toBe('seatVanish');
        if (overlay === undefined || overlay.kind !== 'seatVanish') continue;
        expect(
          overlay.cells.every((cell) => cell.delayMs === 0),
          label,
        ).toBe(true);
      }
    }
  });

  it("7. The system shall not present a vanished player's remnant trail as evaporate or cutSnap", () => {
    for (const [label, pair] of VANISH_PAIRS) {
      const overlays = presentOf(resolveOf(pair));
      for (const player of vanishedPlayersOf(pair)) {
        expect(
          overlays.some((overlay) => overlay.kind === 'evaporate' && overlay.victim === player),
          label,
        ).toBe(false);
        expect(
          overlays.some((overlay) => overlay.kind === 'cutSnap' && overlay.victim === player),
          label,
        ).toBe(false);
      }
    }
  });

  it('8. While a player still holds a piece after the step, the system shall not emit seatVanished for them', () => {
    const rows = [...VANISH_PAIRS, ...LIVING_PAIRS];
    for (const [label, pair] of rows) {
      const events = resolveOf(pair);
      for (const player of pair.before.players) {
        if (!hadPieces(pair.after, player)) continue;
        expect(seatVanishedFor(events, player), `${label} ${String(player)}`).toBeUndefined();
      }
    }
  });

  it('9. The system shall emit seatVanished events in before.players order', () => {
    for (const [label, pair] of VANISH_PAIRS) {
      const vanished = resolveOf(pair)
        .filter((event) => event.kind === 'seatVanished')
        .map((event) => event.player);
      expect(vanished, label).toEqual(vanishedPlayersOf(pair));
    }

    const reordered = vanishCBPlayersOrder();
    expect(
      resolveOf(reordered)
        .filter((event) => event.kind === 'seatVanished')
        .map((event) => event.player),
    ).toEqual([C, B]);
  });

  it('10. Equal steps shall yield equal seatVanished events and equal overlay cell order', () => {
    for (const [label, pair] of VANISH_PAIRS) {
      const first = resolveOf(pair);
      const again = resolveOf(pair);
      expect(JSON.stringify(pickSeatVanished(first)), label).toBe(
        JSON.stringify(pickSeatVanished(again)),
      );
      expect(pickSeatVanished(first).length, label).toBeGreaterThan(0);

      const left = presentOf(first)
        .filter((overlay) => overlay.kind === 'seatVanish')
        .map((overlay) => cellsOf(overlay));
      const right = presentOf(again)
        .filter((overlay) => overlay.kind === 'seatVanish')
        .map((overlay) => cellsOf(overlay));
      expect(JSON.stringify(left), label).toBe(JSON.stringify(right));
    }
  });

  it('11. vanishSeat shall still clear heads, trail marks and leftover territory, and this packet shall not edit rules-core', () => {
    const pair = vanishCLeavingRemnants();
    expect(hadPieces(pair.before, C)).toBe(true);
    expect(hadPieces(pair.after, C)).toBe(false);
    expect(pair.after.trails.get(C)?.size ?? 0).toBe(0);
    for (const group of pair.after.groups.values()) expect(group.owner).not.toBe(C);
    for (const owner of pair.after.territory.values()) expect(owner).not.toBe(C);

    // P107: the resolver lives in rules-core now, and is still only a reading:
    // it imports nothing from the engine beside it, and the adapters take only it.
    const resolver = readResolverSrc();
    expect(resolver).not.toMatch(/from ['"]\.\//);
    expect(resolver).not.toContain('vanishSeat');
    expect(resolver).not.toContain('isLost');
    for (const src of [readWebSrc('fx/present.ts'), readWebSrc('matchLog.ts')]) {
      for (const match of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"]@conquarrow\/rules-core['"]/g)) {
        expect(match[2]?.trim()).toBe('resolveEvents');
      }
      expect(src).not.toContain('vanishSeat');
    }
  });

  it("12. When a vanished player's trail shrinks, foldMatchSummary shall not increment cuts for that shrink", () => {
    let seen = 0;
    for (const [label, pair] of VANISH_PAIRS) {
      let vanishedTrailShrink = false;
      let livingTrailShrink = false;
      for (const player of pair.before.players) {
        const beforeSize = pair.before.trails.get(player)?.size ?? 0;
        const afterSize = pair.after.trails.get(player)?.size ?? 0;
        if (afterSize >= beforeSize) continue;
        if (hadPieces(pair.before, player) && !hadPieces(pair.after, player)) {
          vanishedTrailShrink = true;
        } else {
          livingTrailShrink = true;
        }
      }
      if (!vanishedTrailShrink || livingTrailShrink) continue;
      seen += 1;
      expect(foldOf(pair).cuts, label).toBe(0);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("13. The system shall include a seatVanish overlay's lifetime in the settle time of the move that queued it", () => {
    for (const [label, pair] of VANISH_PAIRS) {
      const overlays = presentOf(resolveOf(pair));
      for (const player of vanishedPlayersOf(pair)) {
        if (remnantArrows(pair.before, pair.after, player).length === 0) continue;
        const overlay = seatVanishOverlay(overlays, player);
        expect(overlay, label).toBeDefined();
        if (overlay === undefined) continue;
        expect(overlayLifetimeMs(overlay), label).toBe(880);
        expect(queueSettleMs(enqueue(emptyQueue(), overlays, 0), 0), label).toBeGreaterThanOrEqual(
          880,
        );
      }
    }
  });

  it('14. resolveEvents and presentEvents shall reference neither a clock nor a random source', () => {
    const banned = ['Date.now', 'new Date', 'Math.random', 'performance.now'] as const;
    for (const [file, src] of [
      ['rules-core events.ts', readResolverSrc()],
      ['fx/present.ts', readWebSrc('fx/present.ts')],
    ] as const) {
      expect(src.length).toBeGreaterThan(200);
      for (const token of banned) expect(src.includes(token), `${file} ${token}`).toBe(false);
    }
  });

  it('15. When seatVanished.arrows is empty, the system shall emit the event and shall present no overlay', () => {
    const pair = vanishCEmptyRemnant();
    const events = resolveOf(pair);
    const vanished = seatVanishedFor(events, C);
    expect(vanished).toBeDefined();
    expect(vanished?.arrows).toEqual([]);
    expect(seatVanishOverlay(presentOf(events), C)).toBeUndefined();
  });

  it('16. Every seatVanish cell shall be an arrow the vanished player held as trail, vacated territory, or a disappeared group, and shall not be an arrow another player holds after the step', () => {
    for (const [label, pair] of VANISH_PAIRS) {
      const events = resolveOf(pair);
      const overlays = presentOf(events);
      for (const player of vanishedPlayersOf(pair)) {
        const expected = remnantArrows(pair.before, pair.after, player);
        const vanished = seatVanishedFor(events, player);
        expect(vanished, label).toBeDefined();
        expect([...(vanished?.arrows ?? [])].map(String), label).toEqual(expected.map(String));
        const overlay = seatVanishOverlay(overlays, player);
        if (expected.length === 0) {
          expect(overlay, label).toBeUndefined();
          continue;
        }
        expect(overlay, label).toBeDefined();
        const cells = overlay?.cells.map((cell) => cell.arrow) ?? [];
        expect(cells.map(String), label).toEqual(expected.map(String));
        for (const arrow of cells) {
          expect(pair.after.territory.has(arrow), label).toBe(false);
          expect(pair.after.groups.has(arrow), label).toBe(false);
        }
      }
    }
  });
});

const pickSeatVanished = (events: readonly GameEvent[]): readonly GameEvent[] =>
  events.filter((event) => event.kind === 'seatVanished');

const cellsOf = (overlay: Extract<FxOverlay, { kind: 'seatVanish' }>): unknown => ({
  player: overlay.player,
  cells: overlay.cells.map((cell) => ({ arrow: cell.arrow, delayMs: cell.delayMs })),
});
