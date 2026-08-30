import { describe, expect, it } from 'vitest';
import type { ArrowId, GameState, Group } from '@conquarrow/contracts';
import { endTurn } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { hasLegalStep, onlinePassMove, passIfExhausted } from '../src/autoEndTurn';

describe('passIfExhausted', () => {
  it('leaves an opening position alone', () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const state = makeMatch();
    expect(hasLegalStep(rules, state)).toBe(true);
    const result = passIfExhausted(rules, state);
    expect(result.state).toBe(state);
    expect(result.moves).toEqual([]);
  });

  it('ends the turn when no step remains and records endTurn', () => {
    // Allowance spent — the offer holds `endTurn` and nothing else. (P22:
    // branch-toll soft-lock is gone.)
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const opening = makeMatch();
    const A = opening.players[0];
    const B = opening.players[1];
    expect(A).toBeDefined();
    expect(B).toBeDefined();
    if (A === undefined || B === undefined) return;
    const from = [...opening.groups.entries()].find(([, g]) => g.owner === A)?.[0];
    expect(from).toBeDefined();
    if (from === undefined) return;
    const state: GameState = {
      ...opening,
      activePlayer: A,
      groups: new Map<ArrowId, Group>([
        [from, { owner: A, heads: 1, spent: 1 }],
        ...[...opening.groups.entries()].filter(([, g]) => g.owner !== A),
      ]),
    };
    expect(hasLegalStep(rules, state)).toBe(false);
    const { state: next, moves } = passIfExhausted(rules, state);
    expect(next.activePlayer).toBe(B);
    expect(hasLegalStep(rules, next)).toBe(true);
    expect(moves).toEqual([{ kind: 'endTurn' }]);
  });
});

describe('onlinePassMove', () => {
  it('is endTurn when no legal step and does not apply', () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const opening = makeMatch();
    expect(hasLegalStep(rules, opening)).toBe(true);
    expect(onlinePassMove(rules, opening)).toBeUndefined();

    const A = opening.players[0];
    expect(A).toBeDefined();
    if (A === undefined) return;
    const from = [...opening.groups.entries()].find(([, g]) => g.owner === A)?.[0];
    expect(from).toBeDefined();
    if (from === undefined) return;
    const state: GameState = {
      ...opening,
      activePlayer: A,
      groups: new Map<ArrowId, Group>([
        [from, { owner: A, heads: 1, spent: 1 }],
        ...[...opening.groups.entries()].filter(([, g]) => g.owner !== A),
      ]),
    };
    expect(hasLegalStep(rules, state)).toBe(false);
    const activeBefore = state.activePlayer;
    expect(onlinePassMove(rules, state)).toEqual(endTurn());
    expect(state.activePlayer).toBe(activeBefore);
  });
});
