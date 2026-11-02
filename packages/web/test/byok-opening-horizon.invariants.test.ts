/**
 * P83 invariants — I1–I8 in docs/spec/byok-opening-horizon/byok-opening-horizon.md,
 * one property each over a bank, plus the Decisions that fix exact text
 * (2, 4, 6, 8, 9, 11). I9 is the bench's: packages/web/bench/test/
 * byok-turns.invariants.test.ts.
 *
 * Bank:
 * - the ladder (tiling, one-arrow territory): distances 1..16 and the cap,
 *   stacks of 1, 3, 3-spent-1 and 4-with-override-1 heads;
 * - `leave_home` stacks on the tiling (radius-2 window, and one-arrow
 *   territory) and on both fixture boards;
 * - both fixture boards with no A territory (every distance capped);
 * - the ring on all three boards, and the closing tip;
 * - every turn start of the P79 corpus (155 positions).
 *
 * Every property asserts non-vacuity first.
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '@conquarrow/contracts';
import { speed } from '@conquarrow/contracts';
import { chooseMove } from '../src/opponent';
import { buildSystemPrompt, clearByokPlans, formatLegalMoves } from '../src/byokBot';
import { corpusPosition, positionId } from '../bench/src/corpus';
import { readTeachingFile } from './byok-teaching-prompt.support';
import { LEGEND_PREFIX, LEGEND_SENTENCE } from './byok-offer-vertex-join.support';
import {
  A,
  CAPPED,
  GROK_LOGS,
  LEGEND_CLAUSE,
  MEASUREMENT_POSITIONS,
  TIPS_PREFIX,
  TIP_ENTRY,
  closingTip,
  corpusCases,
  crosses,
  dOracle,
  golden,
  goldenConstructions,
  homeInOracle,
  idFreeOffer,
  ifHomeOracle,
  ladderCases,
  leaveHomeCases,
  legalMovesText,
  minimal,
  noTerritoryState,
  offerLines,
  parseRow,
  promptOf,
  reinserted,
  ringState,
  snapshotOf,
  spacious,
  tiling,
  tipEntries,
  tipHomeInOracle,
  tipsLine,
  withoutP83,
} from './byok-opening-horizon.support';
import type { Case, HomeIn, Row } from './byok-opening-horizon.support';

const constructed: readonly Case[] = [
  ...ladderCases().map((c) => ({ label: c.label, board: tiling, state: c.state, me: A })),
  ...leaveHomeCases(),
  { label: 'spacious no territory', board: spacious, state: noTerritoryState(spacious), me: A },
  { label: 'minimal no territory', board: minimal, state: noTerritoryState(minimal), me: A },
  ...[tiling, spacious, minimal].map((board) => ({
    label: `ring ${board.name}`,
    board,
    state: ringState(board).state,
    me: A,
  })),
  { label: 'closing tip', board: tiling, state: closingTip().state, me: A },
];

const corpus = corpusCases();
const bank: readonly Case[] = [...constructed, ...corpus];

interface Seen {
  readonly c: Case;
  readonly row: Row;
  readonly facts: HomeIn;
}

const seen: readonly Seen[] = bank.flatMap((c) =>
  offerLines(c.board, c.state, c.me).map(({ move, line }) => ({
    c,
    row: parseRow(line),
    facts: homeInOracle(c.board.geometry, c.state, c.me, move),
  })),
);

const where = (s: Seen): string => `${s.c.label}: ${s.row.line}`;

/** One prompt per case: building it runs the greedy baseline, so it is rendered once. */
const prompts = new Map<Case, string>();
const promptFor = (c: Case): string => {
  const hit = prompts.get(c);
  if (hit !== undefined) return hit;
  const prompt = promptOf(c.board, c.state, c.me);
  prompts.set(c, prompt);
  return prompt;
};

const hasTip = (c: Case): boolean =>
  [...c.state.groups].some(([arrow, g]) => g.owner === c.me && (c.state.trails.get(c.me)?.has(arrow) ?? false));

/** Cases with an exposed tip, and a few without (the tips line then reads `none`). */
const tipBank: readonly Case[] = [...bank.filter(hasTip), ...bank.filter((c) => !hasTip(c)).filter((_, i) => i % 10 === 0)];
const offHome = seen.filter((s) => !s.facts.exitOwn);
const landing = seen.filter((s) => s.facts.exitOwn);

describe('P83 byok-opening-horizon invariants', () => {
  it('the bank is not vacuous: landing rows, off-home rows, capped rows and crossing steps all occur, none illegal', () => {
    expect(landing.length).toBeGreaterThan(100);
    expect(offHome.length).toBeGreaterThan(1000);
    expect(offHome.filter((s) => s.facts.dExit === 'none').length).toBeGreaterThan(20);
    expect(offHome.filter((s) => s.facts.dFrom === 0).length, 'leave_home rows').toBeGreaterThan(50);
    expect(offHome.filter((s) => crosses(s.facts.before, s.facts.after)).length).toBeGreaterThan(20);
    for (const s of seen) expect(s.row.tags, where(s)).not.toContain('illegal');
  });

  it('I1 — homeIn= is on a step row if and only if its exit is not own territory, and at most once', () => {
    for (const s of offHome) expect(s.row.homeInTokens, where(s)).toBe(1);
    for (const s of landing) expect(s.row.homeInTokens, where(s)).toBe(0);
  });

  it('I2 — every printed homeIn is none or a non-negative integer, none exactly when d(exit) is capped, and equals turnsHome(d(exit), L1, speed(count))', () => {
    for (const s of offHome) {
      const printed = s.row.homeIn ?? '';
      expect(printed, where(s)).toMatch(/^(?:none|0|[1-9]\d*)$/);
      expect(printed === 'none', where(s)).toBe(s.facts.dExit === 'none');
      expect(printed, where(s)).toBe(String(s.facts.after));
    }
  });

  it('Decision 2 — homeIn= sits right after the distance slot and before trailLen=', () => {
    for (const s of offHome) {
      expect(s.row.line, where(s)).toMatch(/ (?:tipDist|edgeDist)=\S+ homeIn=\S+ trailLen=/);
    }
  });

  it('I3 — no tipDist= slot holds 17, on any row or tips entry; the capped side prints none', () => {
    let cappedSlots = 0;
    for (const s of seen) {
      const pair = s.row.tipDist;
      if (pair === undefined) continue;
      for (const side of pair) {
        expect(side, where(s)).not.toBe(String(CAPPED));
        expect(side, where(s)).toMatch(/^(?:none|\d+)$/);
        if (side === 'none') cappedSlots += 1;
        else expect(Number(side), where(s)).toBeLessThanOrEqual(16);
      }
      expect(pair[0] === 'none', where(s)).toBe(s.facts.dFrom === 'none');
      expect(pair[1] === 'none', where(s)).toBe(s.facts.dExit === 'none');
    }
    expect(cappedSlots).toBeGreaterThan(20);
    for (const c of tipBank) {
      for (const entry of tipEntries(promptFor(c))) {
        expect(entry, c.label).not.toMatch(/\btipDist=17\b/);
        expect(entry, c.label).not.toMatch(/\bhomeIn=17\b/);
      }
    }
  });

  it('I4 — leaves_horizon is on a row exactly when its exit is not own territory and homeIn crosses 2', () => {
    let tagged = 0;
    for (const s of seen) {
      const want = !s.facts.exitOwn && crosses(s.facts.before, s.facts.after);
      if (want) tagged += 1;
      expect(s.row.tags.includes('leaves_horizon'), where(s)).toBe(want);
      expect(s.row.tags.filter((t) => t === 'leaves_horizon').length, where(s)).toBeLessThanOrEqual(1);
    }
    expect(tagged).toBeGreaterThan(20);
  });

  it('Decision 4 — leaves_horizon follows homeward/outward and precedes on_target, cut, near_trail and combat', () => {
    const earlier = (t: string): boolean =>
      ['closes', 'land_bridge', 'completes_spawner', 'double_fed', 'leave_home', 'homeward', 'outward'].includes(t) ||
      t.startsWith('share+');
    const tagged = seen.filter((s) => s.row.tags.includes('leaves_horizon'));
    expect(tagged.length).toBeGreaterThan(20);
    for (const s of tagged) {
      const i = s.row.tags.indexOf('leaves_horizon');
      expect(s.row.tags.slice(0, i).every(earlier), where(s)).toBe(true);
      expect(s.row.tags.slice(i + 1).some(earlier), where(s)).toBe(false);
    }
  });

  it('I5 — for the same from and exit, a larger count never prints a larger homeIn', () => {
    const rank = (t: string | undefined): number => (t === 'none' ? Infinity : Number(t));
    const byStep = new Map<string, Seen[]>();
    for (const s of offHome) {
      const key = `${s.c.label}|${s.row.from}|${s.row.exit}`;
      byStep.set(key, [...(byStep.get(key) ?? []), s]);
    }
    let pairs = 0;
    for (const group of byStep.values()) {
      const sorted = group.toSorted((x, y) => x.row.count - y.row.count);
      for (let i = 1; i < sorted.length; i += 1) {
        const lo = sorted[i - 1];
        const hi = sorted[i];
        if (lo === undefined || hi === undefined) continue;
        pairs += 1;
        expect(hi.row.homeIn, where(hi)).toBeDefined();
        expect(rank(hi.row.homeIn), where(hi)).toBeLessThanOrEqual(rank(lo.row.homeIn));
      }
    }
    expect(pairs).toBeGreaterThan(500);
  });

  it('I6 — every row, minus homeIn=, leaves_horizon and none-for-17, equals its pre-P83 text (corpus and constructions)', () => {
    const { offerRows, constructedRows } = golden();
    let rows = 0;
    let withHomeIn = 0;
    for (const log of GROK_LOGS) {
      for (const c of corpus.filter((x) => x.label.startsWith(`${log}#`))) {
        const now = offerLines(c.board, c.state, c.me).map(({ line }) => line);
        rows += now.length;
        withHomeIn += now.filter((line) => line.includes('homeIn=')).length;
        expect(now.map(withoutP83), c.label).toEqual(offerRows[c.label]);
      }
    }
    expect(Object.keys(offerRows).length).toBe(
      corpus.filter((c) => GROK_LOGS.some((log) => c.label.startsWith(`${log}#`))).length,
    );
    for (const c of goldenConstructions()) {
      const now = legalMovesText(c.board, c.state, c.me).split('\n');
      rows += now.length;
      withHomeIn += now.filter((line) => line.includes('homeIn=')).length;
      expect(now.map(withoutP83), c.label).toEqual(constructedRows[c.label]);
    }
    expect(rows).toBeGreaterThan(400);
    expect(withHomeIn, 'no P83 token on the compared rows').toBeGreaterThan(100);
  });

  it('I7 — identical offer text on repeated calls and whatever the insertion order of the state maps', () => {
    const sample = bank.filter((_, i) => i % 7 === 0);
    expect(sample.length).toBeGreaterThan(50);
    let withHomeIn = 0;
    for (const c of sample) {
      const once = legalMovesText(c.board, c.state, c.me);
      if (once.includes('homeIn=')) withHomeIn += 1;
      expect(legalMovesText(c.board, c.state, c.me), c.label).toBe(once);
      expect(legalMovesText(c.board, reinserted(c.state), c.me), c.label).toBe(once);
    }
    expect(withHomeIn).toBeGreaterThan(20);
    const tipSample = tipBank.filter((_, i) => i % 7 === 0);
    expect(tipSample.length).toBeGreaterThan(20);
    for (const c of tipSample) {
      expect(tipsLine(promptOf(c.board, reinserted(c.state), c.me)), c.label).toBe(tipsLine(promptFor(c)));
    }
  });

  it('I7 — identical offer text under both geometry ports on positions whose distances match', () => {
    const shapes = [
      (board: typeof tiling): GameState => ringState(board).state,
      (board: typeof tiling): GameState => noTerritoryState(board),
    ];
    for (const [i, shape] of shapes.entries()) {
      const reference = idFreeOffer(tiling, shape(tiling));
      expect(reference.some((line) => line.includes('homeIn=')), `shape ${String(i)}`).toBe(true);
      for (const board of [spacious, minimal]) {
        expect(idFreeOffer(board, shape(board)), `${board.name} shape ${String(i)}`).toEqual(reference);
      }
    }
  });

  it('I8 — building the offer changes neither the state it reads nor the heuristic seat\'s choice', () => {
    const sample = bank.filter((_, i) => i % 9 === 0);
    expect(sample.length).toBeGreaterThan(30);
    for (const c of sample) {
      const before = snapshotOf(c.state);
      formatLegalMoves(c.board.rules.legalMoves(c.state), c.board.geometry, c.board.rules, c.state, c.me);
      promptFor(c);
      expect(snapshotOf(c.state), c.label).toBe(before);
    }
    for (const c of corpus.filter((_, i) => i % 31 === 0)) {
      clearByokPlans();
      const choice = chooseMove(c.board.geometry, c.board.rules, c.state, c.me);
      promptOf(c.board, c.state, c.me);
      expect(chooseMove(c.board.geometry, c.board.rules, c.state, c.me), c.label).toEqual(choice);
    }
  });

  it('Decision 6 — every tips entry is <arrow> tipDist=<d> homeIn=<t> ifHome=+<L> share+<S> heads=<n>, by the oracles; ifHome absent at the cap', () => {
    let entries = 0;
    let withShares = 0;
    let zeroShares = 0;
    let capped = 0;
    for (const c of tipBank) {
      const prompt = promptFor(c);
      const tips = [...c.state.groups]
        .filter(([arrow, g]) => g.owner === c.me && (c.state.trails.get(c.me)?.has(arrow) ?? false))
        .map(([arrow]) => arrow)
        .toSorted((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
      const printed = tipEntries(prompt);
      expect(printed.length, c.label).toBe(tips.length);
      if (tips.length > 0) expect(tipsLine(prompt).startsWith(`${TIPS_PREFIX} `), c.label).toBe(true);
      for (const [i, tip] of tips.entries()) {
        entries += 1;
        const entry = printed[i] ?? '';
        const m = TIP_ENTRY.exec(entry);
        expect(m, `${c.label}: ${entry}`).not.toBeNull();
        if (m === null) continue;
        const group = c.state.groups.get(tip);
        const d = dOracle(c.board.geometry, c.state, c.me, tip);
        expect(m[1], c.label).toBe(String(tip));
        expect(m[2], c.label).toBe(String(d));
        expect(m[3], c.label).toBe(String(tipHomeInOracle(c.board.geometry, c.state, c.me, tip)));
        expect(m[6], c.label).toBe(String(group?.heads));
        const claim = d === 'none' ? undefined : ifHomeOracle(c.board, c.state, c.me, tip);
        if (claim === undefined) {
          capped += 1;
          expect(m[4], `${c.label}: ${entry}`).toBeUndefined();
        } else {
          expect([m[4], m[5]], `${c.label}: ${entry}`).toEqual([String(claim.land), String(claim.shares)]);
          if (claim.shares > 0) withShares += 1;
          else zeroShares += 1;
        }
      }
    }
    expect(entries).toBeGreaterThan(100);
    expect(withShares).toBeGreaterThan(0);
    expect(zeroShares).toBeGreaterThan(0);
    expect(capped).toBeGreaterThan(0);
  });

  it('Decision 6 — tips homeIn uses the whole stack, its override and spent', () => {
    // A 4-head stack (speed 3) with override 1 and spent 0, and a 3-head stack spent 1.
    for (const c of ladderCases().filter((x) => x.label.includes('speedOverride') || x.label.includes('"spent":1'))) {
      const tip = [...c.state.groups.keys()][0];
      if (tip === undefined) throw new Error('setup: ladder case without a stack');
      const group = c.state.groups.get(tip);
      if (group === undefined) throw new Error('setup: ladder case without a stack');
      const spd = group.speedOverride ?? speed(group.heads);
      expect(spd - group.spent, 'setup').toBeLessThan(speed(group.heads));
      const entry = TIP_ENTRY.exec(tipEntries(promptOf(tiling, c.state))[0] ?? '');
      expect(entry?.[3], c.label).toBe(String(tipHomeInOracle(tiling.geometry, c.state, A, tip)));
    }
  });

  it('Decision 8 — the LEGAL_MOVES legend gains the homeIn / leaves_horizon clause, P75\'s sentence intact', () => {
    for (const c of [constructed[0], corpus[0]]) {
      if (c === undefined) throw new Error('setup: empty bank');
      const legend = promptOf(c.board, c.state, c.me)
        .split('\n')
        .find((line) => line.startsWith(LEGEND_PREFIX));
      expect(legend, c.label).toBeDefined();
      expect(legend, c.label).toContain(LEGEND_CLAUSE);
      expect(legend, c.label).toContain(LEGEND_SENTENCE);
      expect(legend, c.label).toMatch(/endTurn is a flag, not a numbered row:$/);
    }
  });

  it('Decision 9 — the teaching tag list names leaves_horizon, and no other prose does', () => {
    const teaching = readTeachingFile();
    const list = /Tags on the offer name outcomes \(([^)]*)\)/.exec(teaching)?.[1];
    expect(list, 'the tag-enumeration sentence is gone').toBeDefined();
    expect((list ?? '').split(', ')).toContain('leaves_horizon');
    expect(teaching.match(/leaves_horizon/g) ?? []).toHaveLength(1);
    expect(teaching).not.toContain('homeIn');
    expect(teaching).not.toContain('ifHome');
    expect(buildSystemPrompt(A, true)).toContain('leaves_horizon');
  });

  it('Decision 11 — offer growth on every P75 measurement position is at most 10%', () => {
    const { promptChars } = golden();
    for (const [log, moveIndex] of MEASUREMENT_POSITIONS) {
      const id = positionId(log, moveIndex);
      const base = promptChars[id];
      if (base === undefined) throw new Error(`setup: golden has no prompt length for ${id}`);
      clearByokPlans();
      const { state, seat } = corpusPosition(log, moveIndex);
      const prompt = promptOf(tiling, state, seat);
      expect(prompt, `${id}: the measured prompt is not P83's`).toContain(LEGEND_CLAUSE);
      expect(prompt.length, id).toBeLessThanOrEqual(Math.floor(base * 1.1));
    }
  });
});
