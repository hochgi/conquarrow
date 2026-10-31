/**
 * P80 invariants — I1–I8 in docs/spec/byok-interior-mill/byok-interior-mill.md,
 * one property each, over a bank rather than an example:
 *
 * - both fixture boards with territory = every arrow but one, for every one,
 *   and a stack on every territory arrow (distances 0–3);
 * - both fixture boards wholly A's (no edge in reach: every distance capped);
 * - the tiling with a radius-3 window as territory (distances up to 5);
 * - a stack on a trail arrow off territory;
 * - every turn start of the two archived grok logs (P79 corpus).
 *
 * Every property asserts non-vacuity first: an offer with no `edgeDist` row at
 * all satisfies "every edgeDist row has b ≥ a − 1".
 */

import { describe, expect, it } from 'vitest';
import { distanceToTerritory, homewardPath } from '../src/botEvaluate';
import { millOmit } from '../src/byokBot';
import type { OfferTagRow } from '../src/byokBot';
import { positionId } from '../bench/src/corpus';
import {
  CAPPED,
  edgeDistOracle,
  golden,
  grokCases,
  grokPositions,
  homewardLines,
  homewardStarts,
  isOwn,
  legalMovesText,
  minimal,
  minusOneCases,
  offTerritoryCase,
  offTerritoryLines,
  reinserted,
  rowsOf,
  spacious,
  starState,
  tagRowsOf,
  tiling,
  tilingWindowCases,
  wholeBoardCases,
  withoutIds,
} from './byok-interior-mill.support';
import type { Case, Row } from './byok-interior-mill.support';
import { withoutBordersSpawner, withoutP75 } from './byok-offer-vertex-join.support';

const bank: readonly Case[] = [
  ...minusOneCases(spacious),
  ...minusOneCases(minimal),
  ...wholeBoardCases(spacious),
  ...wholeBoardCases(minimal),
  ...tilingWindowCases(),
  offTerritoryCase(),
  ...grokCases(),
];

interface Seen {
  readonly c: Case;
  readonly row: Row;
  readonly fromOwn: boolean;
  readonly exitOwn: boolean;
}

const seen: readonly Seen[] = bank.flatMap((c) =>
  rowsOf(c.board, c.state, c.me).map((row) => ({
    c,
    row,
    fromOwn: isOwn(c.state, c.me, row.from),
    exitOwn: isOwn(c.state, c.me, row.exit),
  })),
);

const where = (s: Seen): string => `${s.c.label}: ${s.row.line}`;

const interior = seen.filter((s) => s.fromOwn && s.exitOwn);
const leaving = seen.filter((s) => s.fromOwn && !s.exitOwn);
const offHome = seen.filter((s) => !s.fromOwn);

describe('P80 byok-interior-mill invariants', () => {
  it('the bank is not vacuous: interior, leaving and off-territory rows all occur, none illegal', () => {
    expect(interior.length).toBeGreaterThan(1000);
    expect(leaving.length).toBeGreaterThan(100);
    expect(offHome.length).toBeGreaterThan(100);
    for (const s of seen) expect(s.row.tags, where(s)).not.toContain('illegal');
  });

  it('I1 — edgeDist and not tipDist on every row from own territory; tipDist and not edgeDist on every other row', () => {
    for (const s of seen) {
      if (s.fromOwn) {
        expect(s.row.edgeDist, where(s)).toBeDefined();
        expect(s.row.line, where(s)).not.toContain('tipDist=');
      } else {
        expect(s.row.tipDist, where(s)).toBeDefined();
        expect(s.row.line, where(s)).not.toContain('edgeDist=');
      }
    }
  });

  it('I1 — the printed edgeDist is the grain distance to the nearest non-territory arrow, capped at 17', () => {
    for (const s of seen.filter((x) => x.fromOwn)) {
      const a = edgeDistOracle(s.c.board.geometry, s.c.state, s.c.me, s.row.from);
      const b = edgeDistOracle(s.c.board.geometry, s.c.state, s.c.me, s.row.exit);
      expect(s.row.edgeDist, where(s)).toEqual([a, b]);
    }
    expect(seen.some((s) => s.row.edgeDist?.[0] === CAPPED)).toBe(true);
  });

  it('I2 — every interior step carries exactly one of home_mill and to_edge; no other step carries either', () => {
    for (const s of interior) {
      const both = ['home_mill', 'to_edge'].filter((tag) => s.row.tags.includes(tag));
      expect(both, where(s)).toHaveLength(1);
    }
    for (const s of [...leaving, ...offHome]) {
      expect(s.row.tags, where(s)).not.toContain('home_mill');
      expect(s.row.tags, where(s)).not.toContain('to_edge');
    }
  });

  it('I3 — an interior step with b < a is to_edge, otherwise home_mill (17→17 included)', () => {
    let toEdge = 0;
    let mill = 0;
    for (const s of interior) {
      const a = edgeDistOracle(s.c.board.geometry, s.c.state, s.c.me, s.row.from);
      const b = edgeDistOracle(s.c.board.geometry, s.c.state, s.c.me, s.row.exit);
      if (b < a) {
        toEdge += 1;
        expect(s.row.tags, where(s)).toContain('to_edge');
      } else {
        mill += 1;
        expect(s.row.tags, where(s)).toContain('home_mill');
      }
    }
    expect(toEdge).toBeGreaterThan(0);
    expect(mill).toBeGreaterThan(0);
  });

  it('I3 — to_edge takes the slot home_mill held: after the gain tags, before homeward/outward/onto_home', () => {
    const gain = (tag: string): boolean =>
      ['closes', 'land_bridge', 'completes_spawner', 'double_fed', 'leave_home'].includes(tag) ||
      tag.startsWith('share+');
    const withToEdge = interior.filter((s) => s.row.tags.includes('to_edge'));
    expect(withToEdge.length).toBeGreaterThan(0);
    for (const s of withToEdge) {
      const i = s.row.tags.indexOf('to_edge');
      expect(s.row.tags.slice(0, i).every(gain), where(s)).toBe(true);
      expect(s.row.tags.slice(i + 1).some(gain), where(s)).toBe(false);
      expect(s.row.tags.indexOf('onto_home'), where(s)).toBeGreaterThan(i);
    }
  });

  it('I4 — on every edgeDist row, b ≥ a − 1 unless a is capped', () => {
    const printed = seen.filter((s) => s.row.edgeDist !== undefined);
    expect(printed.length).toBeGreaterThan(1000);
    for (const s of printed) {
      const [a, b] = s.row.edgeDist ?? [0, 0];
      if (a !== CAPPED) expect(b, where(s)).toBeGreaterThanOrEqual(a - 1);
    }
  });

  it('I5 — any to_edge row makes millOmit false, on every offer in the bank', () => {
    let offersWithToEdge = 0;
    for (const c of bank) {
      const rows = rowsOf(c.board, c.state, c.me);
      if (!rows.some((row) => row.tags.includes('to_edge'))) continue;
      offersWithToEdge += 1;
      expect(millOmit(tagRowsOf(rows)), c.label).toBe(false);
    }
    expect(offersWithToEdge).toBeGreaterThan(0);
  });

  it('I5 — millOmit over every mix of mill and to_edge rows: false whenever a to_edge row is present', () => {
    const mill: readonly string[] = ['home_mill', 'onto_home'];
    const toEdge: readonly string[] = ['to_edge', 'onto_home'];
    for (let n = 1; n <= 4; n += 1) {
      for (let mask = 0; mask < 1 << n; mask += 1) {
        const rows: OfferTagRow[] = Array.from({ length: n }, (_, index) => ({
          index,
          count: 1,
          tags: (mask >> index) & 1 ? toEdge : mill,
        }));
        expect(millOmit(rows), `n=${String(n)} mask=${String(mask)}`).toBe(mask === 0);
      }
    }
  });

  it('I6 — every off-territory row of the archived grok logs equals its pre-P80 text', () => {
    const { offTerritoryRows } = golden();
    const positions = grokPositions();
    expect(Object.keys(offTerritoryRows)).toHaveLength(positions.length);
    let rows = 0;
    for (const position of positions) {
      const id = positionId(position.log, position.moveIndex);
      // P75 retired borders_spawner for advances= clauses and two tags (Decision 5);
      // the frozen golden keeps the pre-P75 text, so both sides drop exactly that.
      const now = offTerritoryLines(position).map(withoutP75);
      rows += now.length;
      expect(now, id).toEqual((offTerritoryRows[id] ?? []).map(withoutBordersSpawner));
    }
    expect(rows).toBeGreaterThan(100);
  });

  it('I7 — identical offer text on geometry-tiling and geometry-fixtures, and on repeated calls', () => {
    for (const shape of ['inside', 'lone'] as const) {
      const reference = legalMovesText(tiling, starState(tiling, shape));
      expect(reference, shape).toContain(shape === 'inside' ? 'edgeDist=2→1' : 'edgeDist=1→0');
      for (const board of [tiling, spacious, minimal]) {
        const state = starState(board, shape);
        const once = legalMovesText(board, state);
        expect(legalMovesText(board, state), `${board.name} ${shape}`).toBe(once);
        expect(withoutIds(once), `${board.name} ${shape}`).toBe(withoutIds(reference));
      }
    }
  });

  it('I7 — the offer text does not depend on the insertion order of the state maps', () => {
    const sample = bank.filter((_, i) => i % 7 === 0);
    expect(sample.length).toBeGreaterThan(100);
    for (const c of sample) {
      expect(legalMovesText(c.board, reinserted(c.state), c.me), c.label).toBe(
        legalMovesText(c.board, c.state, c.me),
      );
    }
  });

  it('I8 — homewardPath returns what it returned before the generalisation, on every archived grok turn', () => {
    const { homeward } = golden();
    const positions = grokPositions();
    expect(Object.keys(homeward)).toHaveLength(positions.length);
    for (const position of positions) {
      const id = positionId(position.log, position.moveIndex);
      expect(homewardLines(position), id).toEqual(homeward[id]);
    }
  });

  it('I8 — distanceToTerritory is homewardPath’s distance at every cap', () => {
    let checked = 0;
    for (const position of grokPositions()) {
      for (const start of homewardStarts(position)) {
        for (const cap of [3, 16]) {
          checked += 1;
          expect(distanceToTerritory(tiling.geometry, position.state, position.seat, start, cap)).toBe(
            homewardPath(tiling.geometry, position.state, position.seat, start, cap).distance,
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
