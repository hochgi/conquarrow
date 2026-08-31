import { describe, expect, it } from 'vitest';
import { endTurn, mintArrowId, step } from '@conquarrow/contracts';
import type { Move, StepMove } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { chooseTurnGreedy } from '../src/botSearch';
import {
  chooseMove,
  closeUrgency,
  distanceToTerritory,
  evaluate,
  isClosingMove,
  playBotTurn,
  pruneCandidates,
} from '../src/opponent';

describe('opponent', () => {
  it('prunes to tempo-relevant portions', () => {
    const from = mintArrowId('a');
    const exit = mintArrowId('b');
    const moves: Move[] = [
      step(from, exit, 1),
      step(from, exit, 2),
      step(from, exit, 3),
      step(from, exit, 4),
      endTurn(),
    ];
    const pruned = pruneCandidates(moves);
    expect(
      pruned.filter((m): m is Extract<Move, { kind: 'step' }> => m.kind === 'step').map((m) => m.count),
    ).toEqual([1, 2, 3, 4]);
  });

  it('raises close urgency with trail length', () => {
    expect(closeUrgency(0)).toBe(0);
    expect(closeUrgency(5)).toBeGreaterThan(closeUrgency(3));
    expect(closeUrgency(20)).toBe(100);
  });

  it('never passes while a legal step exists', () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const opening = makeMatch();
    const B = opening.players[1];
    expect(B).toBeDefined();
    if (B === undefined) return;
    const afterA = rules.apply(opening, endTurn());
    // Several chooses within the turn — none may be endTurn while steps remain.
    let at = afterA;
    for (let i = 0; i < 6; i += 1) {
      if (at.activePlayer !== B || at.winner !== undefined) break;
      const hasStep = rules.legalMoves(at).some((m) => m.kind === 'step');
      const move = chooseMove(geometry, rules, at, B);
      if (hasStep) expect(move.kind).toBe('step');
      at = rules.apply(at, move);
    }
  });

  it('is deterministic on the opening for seat B', () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const state = makeMatch();
    const B = state.players[1];
    expect(B).toBeDefined();
    if (B === undefined) return;
    const handed = { ...state, activePlayer: B };
    expect(chooseMove(geometry, rules, handed, B)).toEqual(
      chooseMove(geometry, rules, handed, B),
    );
  });

  it('prefers a tempo-friendly opening portion from the 3-stack', () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const opening = makeMatch();
    const B = opening.players[1];
    expect(B).toBeDefined();
    if (B === undefined) return;
    const afterA = rules.apply(opening, endTurn());
    const move = chooseMove(geometry, rules, afterA, B);
    expect(move.kind).toBe('step');
    if (move.kind !== 'step') return;
    expect([1, 2]).toContain(move.count);
  });

  it('reports distance 0 on home territory', () => {
    const geometry = makeTiling();
    const state = makeMatch();
    const B = state.players[1];
    expect(B).toBeDefined();
    if (B === undefined) return;
    const home = [...state.groups].find(([, g]) => g.owner === B)?.[0];
    expect(home).toBeDefined();
    if (home === undefined) return;
    expect(distanceToTerritory(geometry, state, B, home)).toBe(0);
  });

  it('plays a full bot turn and hands the seat back', () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    const opening = makeMatch();
    const A = opening.players[0];
    const B = opening.players[1];
    expect(A).toBeDefined();
    expect(B).toBeDefined();
    if (A === undefined || B === undefined) return;
    const afterA = rules.apply(opening, endTurn());
    const { state, moves } = playBotTurn(geometry, rules, afterA, B);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((m) => m.kind === 'step')).toBe(true);
    expect(state.activePlayer).toBe(A);
    expect(evaluate(geometry, state, B, rules)).toBeTypeOf('number');
  });

  it('picks a closing step whenever one is legal (heuristic policy)', () => {
    const geometry = makeTiling();
    const rules = makeRules(geometry);
    let state = makeMatch({
      dominationN: 5,
      R: 7,
      homeOffset: 5,
      playerCount: 3,
      spawnerSeed: 1,
    });
    let sawClosingChoice = false;
    for (let i = 0; i < 60; i += 1) {
      if (state.winner !== undefined) break;
      const me = state.activePlayer;
      const steps = rules
        .legalMoves(state)
        .filter((m): m is StepMove => m.kind === 'step');
      const closing: StepMove[] = [];
      for (const move of steps) {
        let after;
        try {
          after = rules.apply(state, move);
        } catch {
          continue;
        }
        if (isClosingMove(state, after, me, move)) closing.push(move);
      }
      const pick = chooseMove(geometry, rules, state, me);
      if (closing.length > 0) {
        sawClosingChoice = true;
        expect(pick.kind).toBe('step');
        if (pick.kind !== 'step') return;
        const afterPick = rules.apply(state, pick);
        expect(isClosingMove(state, afterPick, me, pick)).toBe(true);
      }
      const plan = chooseTurnGreedy(geometry, rules, state, me);
      if (plan.length === 0) break;
      for (const move of plan) state = rules.apply(state, move);
    }
    expect(sawClosingChoice).toBe(true);
  });
});
