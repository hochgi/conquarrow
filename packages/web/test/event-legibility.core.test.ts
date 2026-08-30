/**
 * Every major gameplay event is identifiable from the state transition alone.
 *
 * This is requirement 1 of the brief, and the thing the whole presentation layer
 * rests on: if a cut cannot be told apart from a closure by diffing `before` and
 * `after`, no amount of animation will make it legible.
 *
 * It is also a regression test for a defect the old cut-effect had. It diffed
 * `trails` and nothing else, so *closing a loop* — which moves the boundary out of
 * the trail and into territory — rendered as your own trail burning away, i.e. a
 * successful capture looked exactly like being cut.
 */

import { describe, expect, it } from 'vitest';
import type { Move } from '@conquarrow/contracts';
import { resolveEvents } from '../src/fx/events';
import { A, B, C, kinds, pick, state, tile } from './event-legibility.support';

const step = (from: string, exit: string, count: number): Move => ({
  kind: 'step',
  from: from as never,
  exit: exit as never,
  count,
});

describe('resolveEvents — one move, named', () => {
  it('names a plain advance and the trail cell it leaves', () => {
    const from = tile(0, 0, 0);
    const to = tile(1, 0, 0);
    const before = state({ groups: [[from, A, 1]] });
    const after = state({ groups: [[to, A, 1]], trails: [[A, [from]]] });

    const events = resolveEvents({ before, after, move: step(from, to, 1) });

    expect(kinds(events)).toEqual(['moved', 'trailLaid']);
    const [moved] = pick(events, 'moved');
    expect(moved?.player).toBe(A);
    expect(moved?.from).toBe(from);
    expect(moved?.to).toBe(to);
    expect(moved?.heads).toBe(1);
    expect(pick(events, 'trailLaid')[0]?.arrows).toEqual([from]);
  });

  it('names a split and the sentry it leaves behind', () => {
    const from = tile(0, 0, 0);
    const to = tile(1, 0, 0);
    const before = state({ groups: [[from, A, 3]] });
    const after = state({
      groups: [
        [from, A, 1],
        [to, A, 2],
      ],
    });

    const events = resolveEvents({ before, after, move: step(from, to, 2) });

    const [split] = pick(events, 'stackSplit');
    expect(split?.moved).toBe(2);
    expect(split?.stayed).toBe(1);
    const [sentry] = pick(events, 'sentryLeft');
    expect(sentry?.arrow).toBe(from);
    expect(sentry?.heads).toBe(1);
    // Which heads moved and which stayed are separate facts, and Event 9 asks for
    // the distinction — so they are separate events, not one with two numbers.
    expect(kinds(events)).toContain('moved');
  });

  it('names a merge, and does not confuse it with combat', () => {
    const from = tile(0, 0, 0);
    const to = tile(1, 0, 0);
    const before = state({
      groups: [
        [from, A, 2],
        [to, A, 3],
      ],
    });
    const after = state({ groups: [[to, A, 5]] });

    const events = resolveEvents({ before, after, move: step(from, to, 2) });

    const [merge] = pick(events, 'stackMerged');
    expect(merge?.arriving).toBe(2);
    expect(merge?.existing).toBe(3);
    expect(merge?.total).toBe(5);
    expect(kinds(events)).not.toContain('combat');
  });

  it('names combat with the losses on each side and who is left standing', () => {
    const from = tile(0, 0, 0);
    const to = tile(1, 0, 0);
    const before = state({
      groups: [
        [from, A, 4],
        [to, B, 3],
      ],
    });
    // Attacker sent 3, one head survives; the defender is wiped.
    const after = state({
      groups: [
        [from, A, 1],
        [to, A, 1],
      ],
    });

    const events = resolveEvents({ before, after, move: step(from, to, 3) });

    const [combat] = pick(events, 'combat');
    expect(combat?.attacker).toBe(A);
    expect(combat?.defender).toBe(B);
    expect(combat?.attackerSent).toBe(3);
    expect(combat?.defenderBefore).toBe(3);
    expect(combat?.attackerLost).toBe(2);
    expect(combat?.defenderLost).toBe(3);
    expect(combat?.holder).toBe(A);
    expect(kinds(events)).not.toContain('stackMerged');
  });

  it('names a closure and its capture, and calls the boundary claimed — not cut', () => {
    const loop = [tile(0, 0, 0), tile(1, 0, 0), tile(1, 0, 1)] as const;
    const closing = tile(1, 0, 1);
    const before = state({
      groups: [[loop[1], A, 1]],
      trails: [[A, [...loop]]],
    });
    const inside = tile(0, 1, 2);
    const after = state({
      groups: [[closing, A, 1]],
      trails: [[A, []]],
      territory: [
        [loop[0], A],
        [loop[1], A],
        [loop[2], A],
        [inside, A],
      ],
    });

    const events = resolveEvents({ before, after, move: step(loop[1], closing, 1) });

    const [closed] = pick(events, 'enclosureClosed');
    expect(closed?.player).toBe(A);
    expect(closed?.closingArrow).toBe(closing);
    // The boundary is the loop's own arrows — the geometry an effect can trace.
    expect(closed?.boundary).toEqual([...loop].toSorted());
    expect(closed?.claimed).toHaveLength(4);

    const [captured] = pick(events, 'territoryCaptured');
    expect(captured?.player).toBe(A);
    expect(captured?.fromArrow).toBe(closing);
    expect(captured?.takenFrom).toEqual([]);

    // The regression: a closure is not a cut, however much the trail shrank.
    expect(kinds(events)).not.toContain('trailCut');
  });

  it('names a cut against its victim and its attacker, with the cut location', () => {
    const victimTrail = [tile(0, 0, 0), tile(1, 0, 0), tile(1, 0, 1)] as const;
    const attackerFrom = tile(2, 0, 0);
    const cutAt = tile(1, 0, 0);
    const before = state({
      activePlayer: B,
      groups: [[attackerFrom, B, 2]],
      trails: [[A, [...victimTrail]]],
    });
    const after = state({
      activePlayer: B,
      groups: [[cutAt, B, 2]],
      trails: [
        [A, [victimTrail[2]]],
        [B, [attackerFrom]],
      ],
    });

    const events = resolveEvents({ before, after, move: step(attackerFrom, cutAt, 2) });

    const [cut] = pick(events, 'trailCut');
    expect(cut?.victim).toBe(A);
    expect(cut?.attacker).toBe(B);
    expect(cut?.cutArrow).toBe(cutAt);
    expect([...(cut?.arrows ?? [])].toSorted()).toEqual([victimTrail[0], cutAt].toSorted());
    expect(kinds(events)).not.toContain('enclosureClosed');
  });

  it('names losing ground separately from losing heads, and who took it', () => {
    const ground = [tile(0, 0, 0), tile(0, 0, 1)] as const;
    const from = tile(3, 0, 0);
    const to = tile(3, 0, 1);
    const before = state({
      activePlayer: B,
      groups: [[from, B, 1]],
      territory: [
        [ground[0], A],
        [ground[1], A],
      ],
    });
    const after = state({
      activePlayer: B,
      groups: [[to, B, 1]],
      territory: [
        [ground[0], B],
        [ground[1], B],
      ],
    });

    const events = resolveEvents({ before, after, move: step(from, to, 1) });

    const [lost] = pick(events, 'territoryLost');
    expect(lost?.player).toBe(A);
    expect(lost?.to).toBe(B);
    expect(lost?.arrows).toEqual([...ground].toSorted());

    const [captured] = pick(events, 'territoryCaptured');
    expect(captured?.player).toBe(B);
    expect(captured?.takenFrom).toEqual([A]);

    // Two consequences, two events — the brief is explicit that a player must be
    // able to tell "I lost territory" from "my units were killed".
    expect(kinds(events)).not.toContain('combat');
  });

  it('names conversion where heads changed owner without moving', () => {
    const garrison = tile(0, 1, 0);
    const from = tile(4, 0, 0);
    const to = tile(4, 0, 1);
    const before = state({
      groups: [
        [from, A, 1],
        [garrison, B, 3],
      ],
      territory: [[garrison, A]],
    });
    const after = state({
      groups: [
        [to, A, 1],
        [garrison, A, 3],
      ],
      territory: [[garrison, A]],
    });

    const events = resolveEvents({ before, after, move: step(from, to, 1) });

    const [converted] = pick(events, 'unitsConverted');
    expect(converted?.arrow).toBe(garrison);
    expect(converted?.from).toBe(B);
    expect(converted?.to).toBe(A);
    expect(converted?.heads).toBe(3);
  });

  it('names production at the arrow that produced it, on the turn boundary', () => {
    const share = tile(5, 0, 0);
    const other = tile(6, 0, 0);
    const before = state({
      activePlayer: A,
      groups: [[other, A, 1]],
      territory: [[share, A]],
    });
    const after = state({
      activePlayer: B,
      groups: [
        [other, A, 1],
        [share, A, 1],
      ],
      territory: [[share, A]],
    });

    const events = resolveEvents({ before, after, move: { kind: 'endTurn' } });

    const [produced] = pick(events, 'unitsProduced');
    expect(produced?.arrow).toBe(share);
    expect(produced?.player).toBe(A);
    expect(produced?.amount).toBe(1);
    expect(kinds(events)).toContain('turnPassed');
  });

  it('counts reinforcement of an existing stack as production of the difference', () => {
    const share = tile(5, 0, 0);
    const before = state({ activePlayer: A, groups: [[share, A, 2]], territory: [[share, A]] });
    const after = state({ activePlayer: B, groups: [[share, A, 3]], territory: [[share, A]] });

    const events = resolveEvents({ before, after, move: { kind: 'endTurn' } });

    expect(pick(events, 'unitsProduced')[0]?.amount).toBe(1);
  });

  it('names the winner exactly once, when it is first set', () => {
    const from = tile(0, 0, 0);
    const to = tile(1, 0, 0);
    const before = state({ groups: [[from, A, 1]] });
    const after = state({ groups: [[to, A, 1]], winner: A });

    const first = resolveEvents({ before, after, move: step(from, to, 1) });
    expect(pick(first, 'matchWon')[0]?.player).toBe(A);

    const again = resolveEvents({ before: after, after, move: { kind: 'endTurn' } });
    expect(kinds(again)).not.toContain('matchWon');
  });

  it('attributes a cut to the mover even when the mover is the victim', () => {
    const own = [tile(0, 0, 0), tile(1, 0, 0)] as const;
    const from = tile(2, 0, 0);
    const to = tile(2, 0, 1);
    const before = state({ groups: [[from, A, 1]], trails: [[A, [...own]]] });
    const after = state({ groups: [[to, A, 1]], trails: [[A, [own[1], from]]] });

    const events = resolveEvents({ before, after, move: step(from, to, 1) });

    const [cut] = pick(events, 'trailCut');
    expect(cut?.victim).toBe(A);
    expect(cut?.attacker).toBe(A);
    expect(cut?.arrows).toEqual([own[0]]);
  });

  it('reports nothing for a move that changed nothing visible', () => {
    const from = tile(0, 0, 0);
    const before = state({ groups: [[from, A, 1]] });
    const events = resolveEvents({ before, after: before, move: { kind: 'endTurn' } });
    expect(events).toEqual([]);
  });

  it('is unaffected by which player is named third', () => {
    // C is in the roster and does nothing; no event may mention it.
    const from = tile(0, 0, 0);
    const to = tile(1, 0, 0);
    const before = state({ players: [A, B, C], groups: [[from, A, 1]] });
    const after = state({ players: [A, B, C], groups: [[to, A, 1]] });
    const events = resolveEvents({ before, after, move: step(from, to, 1) });
    expect(JSON.stringify(events)).not.toContain('"C"');
  });
});
