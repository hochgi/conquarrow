/**
 * P75 invariants — I1–I9 in docs/spec/byok-offer-vertex-join/byok-offer-vertex-join.md,
 * one property each, over a bank rather than an example:
 *
 * - the fixture bank: both fixture boards, every arrow, each vertex it flanks,
 *   five holdings of that vertex (own 1, own 2, re-walk, opponent-held,
 *   double-fed) — every offer row of every state;
 * - every turn start of the P79 corpus (155 positions, ≈3,000 rows), on the tiling.
 *
 * Every property asserts non-vacuity first: an offer with no clause at all
 * satisfies "every clause has b = a + 1".
 */

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '@conquarrow/contracts';
import { buildSystemPrompt, buildUserPrompt, formatLegalMoves, snapshotForPrompt } from '../src/byokBot';
import { formatTargetsForPrompt } from '../src/targets';
import { reinserted } from './byok-interior-mill.support';
import {
  LEGEND_PREFIX,
  LEGEND_SENTENCE,
  advancesCount,
  applyCompletes,
  asSnapRows,
  bankRows,
  clausesOf,
  corpusCases,
  expectedClauses,
  flanksSorted,
  flanksSpawner,
  golden,
  grokPositions,
  idOf,
  isIncident,
  isInteresting,
  isReWalk,
  offerLines,
  tagsOf,
  tiling,
  withoutBordersSpawner,
  withoutP75,
} from './byok-offer-vertex-join.support';
import type { Board, Seen } from './byok-offer-vertex-join.support';

const rows: readonly Seen[] = bankRows();
const where = (s: Seen): string => s.label;

const reWalks = rows.filter((s) => isReWalk(s.state, s.me, s.move.exit));
const fresh = rows.filter((s) => !isReWalk(s.state, s.me, s.move.exit));
const flankedCount = (s: Seen): number =>
  s.board.geometry.flankVertices(s.move.exit).filter((v) => s.state.spawners.has(v)).length;

const MAX_SPAWNER_ROWS = 12;

describe('P75 byok-offer-vertex-join invariants', () => {
  it('the bank is not vacuous: re-walk and fresh rows both flank spawners, none illegal', () => {
    expect(rows.length).toBeGreaterThan(3000);
    for (const s of rows) expect(s.line, where(s)).not.toContain('tags=illegal');
    expect(reWalks.filter((s) => flankedCount(s) > 0).length).toBeGreaterThan(50);
    expect(fresh.filter((s) => flankedCount(s) === 1).length).toBeGreaterThan(50);
    expect(fresh.filter((s) => flankedCount(s) === 2).length).toBeGreaterThan(20);
  });

  it('I1 — no borders_spawner in any offer row, threat header, legend, targets line or system prompt', () => {
    for (const s of rows) expect(s.line, where(s)).not.toContain('borders_spawner');
    for (const reasoning of [true, false]) {
      expect(buildSystemPrompt('A' as PlayerId, reasoning)).not.toContain('borders_spawner');
    }
    expect(formatTargetsForPrompt([])).not.toContain('borders_spawner');
    expect(formatTargetsForPrompt([])).toContain('advances=');

    const sample = corpusCases().filter((_, i) => i % 5 === 0);
    expect(sample.length).toBeGreaterThan(25);
    for (const c of sample) {
      const user = buildUserPrompt(c.board.geometry, c.state, c.me, c.board.rules.legalMoves(c.state), true, c.board.rules);
      expect(user, c.label).not.toContain('borders_spawner');
      const legend = user.split('\n').find((line) => line.startsWith(LEGEND_PREFIX));
      expect(legend, c.label).toContain(LEGEND_SENTENCE);
    }
  });

  it('I2 — a re-walk row carries no advances= clause and no double_fed', () => {
    const flanked = reWalks.filter((s) => flankedCount(s) > 0);
    expect(flanked.length).toBeGreaterThan(50);
    for (const s of reWalks) {
      expect(advancesCount(s.line), where(s)).toBe(0);
      expect(tagsOf(s.line), where(s)).not.toContain('double_fed');
    }
  });

  it('I3 — a fresh row carries exactly one clause per flanked spawner, at most two, in compareVertices order', () => {
    let clauses = 0;
    for (const s of fresh) {
      const expected = flanksSorted(s.board.geometry, s.move.exit)
        .filter((v) => s.state.spawners.has(v))
        .map(String);
      const got = clausesOf(s.line);
      clauses += got.length;
      expect(got.length, where(s)).toBeLessThanOrEqual(2);
      expect(advancesCount(s.line), where(s)).toBe(got.length);
      expect(got.map((c) => c.vertex), where(s)).toEqual(expected);
    }
    expect(clauses).toBeGreaterThan(100);
  });

  it('I4 — every clause reads a/3→a+1/3 with 0 ≤ a ≤ 2, a = the seat\'s other borders held in after (and denies= as Decision 9)', () => {
    const withClause = fresh.filter((s) => flankedCount(s) > 0);
    expect(withClause.length).toBeGreaterThan(100);
    const as = new Set<number>();
    let denies = 0;
    for (const s of withClause) {
      const got = clausesOf(s.line);
      for (const c of got) {
        expect(c.b, where(s)).toBe(c.a + 1);
        expect(c.a, where(s)).toBeGreaterThanOrEqual(0);
        expect(c.a, where(s)).toBeLessThanOrEqual(2);
        as.add(c.a);
        if (c.denies !== undefined) denies += 1;
      }
      expect(
        got.map((c) => c.text),
        where(s),
      ).toEqual(expectedClauses(s.board.geometry, s.board.rules, s.state, s.me, s.move));
    }
    expect([...as].toSorted()).toEqual([0, 1, 2]);
    expect(denies).toBeGreaterThan(10);
  });

  it('I5 — double_fed iff the row carries two advances= clauses', () => {
    let doubles = 0;
    for (const s of rows) {
      const two = clausesOf(s.line).length === 2;
      if (two) doubles += 1;
      expect(tagsOf(s.line).includes('double_fed'), where(s)).toBe(two);
    }
    expect(doubles).toBeGreaterThan(20);
  });

  it('I6 — completes_spawner iff a clause reads 2/3→3/3 or apply takes a spawner vertex to 3 of the seat\'s shares', () => {
    let walked = 0;
    let closed = 0;
    for (const s of rows) {
      const walksThird = clausesOf(s.line).some((c) => c.a === 2);
      const completes = applyCompletes(s.board.geometry, s.board.rules, s.state, s.me, s.move);
      if (walksThird) walked += 1;
      if (completes) closed += 1;
      const tags = tagsOf(s.line);
      expect(tags.includes('completes_spawner'), where(s)).toBe(walksThird || completes);
      expect(tags.filter((t) => t === 'completes_spawner').length, where(s)).toBeLessThanOrEqual(1);
    }
    expect(walked).toBeGreaterThan(10);
    expect(closed).toBeGreaterThan(10);
  });

  it('Decision 8 — completes_spawner then double_fed sit in borders_spawner\'s old slot, right after share+N', () => {
    const gain = (tag: string): boolean => tag === 'closes' || tag === 'land_bridge' || tag.startsWith('share+');
    const tagged = rows.filter((s) => {
      const tags = tagsOf(s.line);
      return tags.includes('completes_spawner') || tags.includes('double_fed');
    });
    expect(tagged.length).toBeGreaterThan(20);
    for (const s of tagged) {
      const tags = tagsOf(s.line);
      const mine: string[] = tags.filter((t) => t === 'completes_spawner' || t === 'double_fed');
      const first = tags.indexOf(mine[0] ?? '');
      expect(tags.slice(first, first + mine.length), where(s)).toEqual(
        ['completes_spawner', 'double_fed'].filter((t) => mine.includes(t)),
      );
      expect(tags.slice(0, first).every(gain), where(s)).toBe(true);
      expect(tags.slice(first + mine.length).some(gain), where(s)).toBe(false);
    }
  });

  it('I7 — every interesting vertex an advances= clause names has a spawner row; tier 1 fills only below 12', () => {
    let named = 0;
    let crowded = 0;
    for (const c of corpusCases()) {
      const g = c.board.geometry;
      const offer = c.board.rules.legalMoves(c.state);
      const snap = asSnapRows(snapshotForPrompt(g, c.state, c.me, offer));
      const listed = new Set(snap.vertices);
      expect(snap.spawnersShown, c.label).toBe(snap.vertices.length);

      const interesting = [...c.state.spawners.keys()].filter((v) => isInteresting(g, c.state, c.me, v));
      const tier0 = interesting.filter((v) => isIncident(g, c.state, c.me, v, offer));
      const tier1 = interesting.length - tier0.length;
      if (tier0.length > MAX_SPAWNER_ROWS) crowded += 1;
      for (const v of tier0) expect(listed.has(String(v)), `${c.label} tier 0 ${String(v)}`).toBe(true);
      expect(snap.vertices.length, c.label).toBe(
        tier0.length + Math.min(tier1, Math.max(0, MAX_SPAWNER_ROWS - tier0.length)),
      );

      for (const { line } of offerLines(c.board, c.state, c.me)) {
        for (const clause of clausesOf(line)) {
          const vertex = interesting.find((v) => String(v) === clause.vertex);
          if (vertex === undefined) continue;
          named += 1;
          expect(listed.has(clause.vertex), `${c.label}: ${line}`).toBe(true);
        }
      }
    }
    expect(named).toBeGreaterThan(100);
    expect(crowded).toBeGreaterThan(0);
  });

  it('I8 — identical offer text on repeated calls and whatever the insertion order of the state maps', () => {
    // One entry per state (fixture bank whole, every third corpus position).
    const states = [...new Map(rows.map((s) => [s.label.split(': ')[0], s] as const)).values()];
    const cases = states.filter((s, i) => s.board !== tiling || i % 3 === 0);
    expect(cases.length).toBeGreaterThan(200);
    let withClause = 0;
    for (const s of cases) {
      const text = textOf(s.board, s.state, s.me);
      if (text.includes('advances=')) withClause += 1;
      expect(textOf(s.board, s.state, s.me), s.label).toBe(text);
      expect(textOf(s.board, reinserted(s.state), s.me), s.label).toBe(text);
    }
    expect(withClause).toBeGreaterThan(50);
  });

  it('I9 — a row with no flanked spawner is byte-identical to its pre-P75 text; a flanked row differs only by P75\'s clause and tags', () => {
    const before = golden();
    let plain = 0;
    let flanked = 0;
    for (const position of grokPositions()) {
      const id = idOf(position);
      const was = before[id];
      if (was === undefined) throw new Error(`setup: golden has no ${id}`);
      const now = offerLines(tiling, position.state, position.seat);
      expect(now.length, id).toBe(was.length);
      for (const [i, { move, line }] of now.entries()) {
        const prior = was[i] ?? '';
        if (flanksSpawner(tiling.geometry, position.state, move.exit)) {
          flanked += 1;
          expect(withoutP75(line), `${id}: ${line}`).toBe(withoutBordersSpawner(prior));
        } else {
          plain += 1;
          expect(withoutP75(line), `${id}: ${line}`).toBe(prior);
          expect(line, `${id}: ${line}`).not.toContain('advances=');
        }
      }
    }
    expect(plain).toBeGreaterThan(200);
    expect(flanked).toBeGreaterThan(50);
  });
});

function textOf(board: Board, state: GameState, me: PlayerId): string {
  return formatLegalMoves(board.rules.legalMoves(state), board.geometry, board.rules, state, me);
}
