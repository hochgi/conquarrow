/**
 * docs/spec/agent-context-v2 — edge cases: names, the row tempo slot (D4),
 * and the BYOK replay of the window (D3).
 *
 * @see docs/spec/agent-context-v2/agent-context-v2.edge-cases.feature
 */

import { describe, expect, it } from 'vitest';
import type { GameState, Move, StepMove } from '@conquarrow/contracts';
import { endTurn, speed } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { logEventsOf } from '@conquarrow/rules-core';
import {
  formatLegalMoves,
  offerText,
  recentFromMoves,
  recentLinesOf,
  recentWindow,
  type RecentLine,
} from '../src/index';
import { geometry, loadFixture, rules } from './agent-board-map.support';
import { seatBTurn, withActiveStack } from './agent-context-v2.support';

const rowsOf = (state: GameState): readonly string[] =>
  formatLegalMoves(rules.legalMoves(state), geometry, rules, state, state.activePlayer).split('\n');

const steps = (state: GameState): readonly StepMove[] =>
  rules.legalMoves(state).filter((m): m is StepMove => m.kind === 'step');

describe('D1 — a name cannot add lines', () => {
  it('a line break becomes a space and the name is cut to 40 characters', () => {
    const { state, b } = seatBTurn();
    const long = `Evil\nname ${'x'.repeat(60)}`;
    const text = offerText(state, b, { seats: [{ player: 'A', kind: 'human', name: long }] });
    const row = text.split('\n').find((l) => l.startsWith('A human '));
    expect(row).toBe(`A human ${`Evil name ${'x'.repeat(60)}`.slice(0, 40)}`);
  });

  it('a carriage return too, and surrounding space is trimmed', () => {
    const { state, b } = seatBTurn();
    const text = offerText(state, b, { seats: [{ player: 'A', kind: 'human', name: '  Bo\r\nb  ' }] });
    expect(text.split('\n')).toContain('A human Bo b');
  });
});

describe('D4 — honest step counts', () => {
  it('a 4-head stack that walked 2: every row reads spd=3 spent=2 left=1, and a 1-head portion then=0', () => {
    const { state } = withActiveStack(seatBTurn().state, 4, 2);
    const rows = rowsOf(state);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toContain(' spd=3 spent=2 left=1 then=0 ');
    expect(rows.some((r) => r.includes('count=1 leave=3 spd=3'))).toBe(true);
  });

  it('a fresh 3-head stack: the whole stack keeps a step (then=1), a 1-head portion keeps none', () => {
    const { state } = withActiveStack(seatBTurn().state, 3, 0);
    const rows = rowsOf(state);
    const whole = rows.find((r) => r.includes('count=3 '));
    const single = rows.find((r) => r.includes('count=1 '));
    expect(whole).toContain(` spd=${String(speed(3))} spent=0 left=${String(speed(3))} then=${String(speed(3) - 1)} `);
    expect(single).toContain(` spd=${String(speed(3))} spent=0 left=${String(speed(3))} then=0 `);
  });

  it('a merge: the joined stack keeps its spent, and a majority arrival bars it (then=0), a minority one leaves 1', () => {
    const { state, arrow } = withActiveStack(seatBTurn().state, 3, 0);
    const exit = steps(state).find((m) => m.from === arrow)?.exit;
    if (exit === undefined) throw new Error('setup: no exit');
    const groups = new Map(state.groups);
    groups.set(exit, { owner: state.activePlayer, heads: 2, spent: 0 });
    const joined = { ...state, groups };
    const rows = rowsOf(joined);
    const minority = rows.find((r) => r.includes(`from=${String(arrow)} exit=${String(exit)} count=1 `));
    const majority = rows.find((r) => r.includes(`from=${String(arrow)} exit=${String(exit)} count=3 `));
    expect(minority).toContain(' then=1 ');
    expect(majority).toContain(' then=0 ');
  });

  it('a step that loses its fight reads then=0', () => {
    const { state, arrow } = withActiveStack(seatBTurn().state, 1, 0);
    const exits = steps(state).filter((m) => m.from === arrow);
    const target = exits[0];
    if (target === undefined) throw new Error('setup: no exit');
    const rival = state.players.find((p) => p !== state.activePlayer);
    if (rival === undefined) throw new Error('setup: no rival');
    const groups = new Map(state.groups);
    groups.set(target.exit, { owner: rival, heads: 9, spent: 0 });
    const fight = { ...state, groups };
    const row = rowsOf(fight).find((r) => r.includes(`exit=${String(target.exit)} count=1 `));
    expect(row).toContain(' then=0 ');
    expect(row).toContain('combat');
  });

  it('E4 — over the smoke game and random play, every row has left ≥ 1, then ≥ 0 and spd = the group\'s allowance', () => {
    const fixture = loadFixture();
    let state = makeMatch(fixture.config);
    const positions: GameState[] = [];
    for (const [i, move] of fixture.moves.entries()) {
      if (i % 5 === 0) positions.push(state);
      state = rules.apply(state, move);
    }
    // Deterministic "random" play: step index (i * 7) mod n, splits included.
    let walk = makeMatch(fixture.config);
    for (let i = 0; i < 400 && walk.winner === undefined; i += 1) {
      const legal = rules.legalMoves(walk);
      const move = legal[(i * 7) % legal.length] ?? endTurn();
      if (i % 3 === 0) positions.push(walk);
      walk = rules.apply(walk, move);
    }
    let checked = 0;
    for (const position of positions) {
      for (const row of rowsOf(position)) {
        if (row === '') continue;
        const m = / from=(\S+) .* spd=(\d+) spent=(\d+) left=(-?\d+) then=(-?\d+) /.exec(row);
        expect(m, row).not.toBeNull();
        const [, from, spd, spent, left, then] = m as unknown as [string, string, string, string, string, string];
        const g = position.groups.get(from as never);
        expect(Number(spd)).toBe(g === undefined ? -1 : (g.speedOverride ?? speed(g.heads)));
        expect(Number(left)).toBe(Number(spd) - Number(spent));
        expect(Number(left)).toBeGreaterThanOrEqual(1);
        expect(Number(then)).toBeGreaterThanOrEqual(0);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('D3 — the BYOK window is the door\'s window', () => {
  const allLines = (opening: GameState, moves: readonly Move[]): RecentLine[] => {
    const out: RecentLine[] = [];
    let at = opening;
    for (const move of moves) {
      const after = rules.apply(at, move);
      out.push({ seat: String(at.activePlayer), move, events: logEventsOf(geometry, { before: at, after, move }) });
      at = after;
    }
    return out;
  };

  it('recentFromMoves equals recentWindow over every move\'s logged line, for each seat, at several points', () => {
    const fixture = loadFixture();
    const opening = makeMatch(fixture.config);
    for (const cut of [0, 1, 40, 137, fixture.moves.length]) {
      const moves = fixture.moves.slice(0, cut);
      const lines = allLines(opening, moves);
      for (const seat of opening.players) {
        expect(recentFromMoves(geometry, opening, moves, seat)).toEqual(recentWindow(lines, String(seat)));
      }
    }
  });

  it('recentLinesOf is every move\'s line from a start', () => {
    const fixture = loadFixture();
    const opening = makeMatch(fixture.config);
    const moves = fixture.moves.slice(0, 30);
    expect(recentLinesOf(geometry, opening, moves)).toEqual(allLines(opening, moves));
    expect(recentLinesOf(geometry, opening, [])).toEqual([]);
  });
});
