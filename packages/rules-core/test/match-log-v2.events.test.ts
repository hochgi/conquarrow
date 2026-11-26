/**
 * docs/spec/match-log-v2/SCENARIOS.md 5 — one move's log events (P107 D1, D2).
 *
 * `toLogEvent` is the projection, `resolveShareEvents` the geometry-aware share
 * reading, and `logEventsOf` the two together over the web's own resolver.
 *
 * @see docs/spec/match-log-v2/match-log-v2.md
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId, GameEvent, GameState, LogEvent, PlayerId } from '@conquarrow/contracts';
import { endTurn, mintArrowId, mintPlayerId } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import {
  logEventsOf,
  makeRules,
  resolveEvents,
  resolveShareEvents,
  shareCountOf,
  toLogEvent,
} from '../src/index';
import { P47_FIRST_UNPLAYABLE, playtestLog } from './immediate.support';

const geometry = makeTiling();
const rules = makeRules(geometry);
const A = mintPlayerId('A');
const B = mintPlayerId('B');
const C = mintPlayerId('C');
const a1 = mintArrowId('a1');
const a2 = mintArrowId('a2');
const a3 = mintArrowId('a3');

describe('SCENARIOS.md 5 — toLogEvent', () => {
  it.each<[string, GameEvent]>([
    ['moved', { kind: 'moved', player: A, from: a1, to: a2, heads: 2 }],
    ['trailLaid', { kind: 'trailLaid', player: A, arrows: [a1] }],
    ['stackSplit', { kind: 'stackSplit', player: A, from: a1, to: a2, moved: 1, stayed: 1 }],
    ['sentryLeft', { kind: 'sentryLeft', player: A, arrow: a1, heads: 1 }],
    [
      'stackMerged',
      { kind: 'stackMerged', player: A, from: a1, to: a2, arriving: 1, existing: 2, total: 3 },
    ],
  ])('alt %s: dropped (the move says it)', (_kind, event) => {
    expect(toLogEvent(event)).toBeNull();
  });

  it('alt combat with a holder: every count, ids as strings', () => {
    expect(
      toLogEvent({
        kind: 'combat',
        arrow: a1,
        attacker: A,
        defender: B,
        attackerSent: 4,
        defenderBefore: 3,
        attackerLost: 3,
        defenderLost: 3,
        holder: A,
      }),
    ).toStrictEqual({
      kind: 'combat',
      arrow: 'a1',
      attacker: 'A',
      defender: 'B',
      attackerSent: 4,
      defenderBefore: 3,
      attackerLost: 3,
      defenderLost: 3,
      holder: 'A',
    });
  });

  it('alt combat with nobody left: holder left out', () => {
    expect(
      toLogEvent({
        kind: 'combat',
        arrow: a1,
        attacker: A,
        defender: B,
        attackerSent: 2,
        defenderBefore: 2,
        attackerLost: 2,
        defenderLost: 2,
        holder: undefined,
      }),
    ).toStrictEqual({
      kind: 'combat',
      arrow: 'a1',
      attacker: 'A',
      defender: 'B',
      attackerSent: 2,
      defenderBefore: 2,
      attackerLost: 2,
      defenderLost: 2,
    });
  });

  it('alt trailCut: the severed arrows become a count; the anchor kept or left out', () => {
    expect(
      toLogEvent({ kind: 'trailCut', victim: B, attacker: A, cutArrow: a2, arrows: [a1, a2, a3] }),
    ).toStrictEqual({ kind: 'trailCut', victim: 'B', attacker: 'A', cutArrow: 'a2', arrowCount: 3 });
    expect(
      toLogEvent({ kind: 'trailCut', victim: B, attacker: A, cutArrow: undefined, arrows: [a1] }),
    ).toStrictEqual({ kind: 'trailCut', victim: 'B', attacker: 'A', arrowCount: 1 });
  });

  it('alt enclosureClosed: boundary and claimed become counts', () => {
    expect(
      toLogEvent({
        kind: 'enclosureClosed',
        player: A,
        closingArrow: a3,
        boundary: [a1, a2],
        claimed: [a1, a2, a3],
      }),
    ).toStrictEqual({ kind: 'enclosureClosed', player: 'A', closingArrow: 'a3', boundaryCount: 2, claimedCount: 3 });
    expect(
      toLogEvent({ kind: 'enclosureClosed', player: A, closingArrow: undefined, boundary: [a1], claimed: [] }),
    ).toStrictEqual({ kind: 'enclosureClosed', player: 'A', boundaryCount: 1, claimedCount: 0 });
  });

  it('alt territoryCaptured: a count and who it came from', () => {
    expect(
      toLogEvent({ kind: 'territoryCaptured', player: A, arrows: [a1, a2], fromArrow: a1, takenFrom: [B, C] }),
    ).toStrictEqual({ kind: 'territoryCaptured', player: 'A', arrowCount: 2, takenFrom: ['B', 'C'] });
  });

  it('alt territoryLost: a count, the taker kept or left out', () => {
    expect(
      toLogEvent({ kind: 'territoryLost', player: B, to: A, arrows: [a1, a2, a3], atArrow: a1 }),
    ).toStrictEqual({ kind: 'territoryLost', player: 'B', to: 'A', arrowCount: 3 });
    expect(
      toLogEvent({ kind: 'territoryLost', player: B, to: undefined, arrows: [a1], atArrow: undefined }),
    ).toStrictEqual({ kind: 'territoryLost', player: 'B', arrowCount: 1 });
  });

  it('alt unitsConverted / unitsProduced: kept as they are', () => {
    expect(toLogEvent({ kind: 'unitsConverted', arrow: a1, from: B, to: A, heads: 5 })).toStrictEqual({
      kind: 'unitsConverted',
      arrow: 'a1',
      from: 'B',
      to: 'A',
      heads: 5,
    });
    expect(toLogEvent({ kind: 'unitsProduced', player: A, arrow: a2, amount: 2 })).toStrictEqual({
      kind: 'unitsProduced',
      player: 'A',
      arrow: 'a2',
      amount: 2,
    });
  });

  it('alt seatVanished / turnPassed / matchWon', () => {
    expect(toLogEvent({ kind: 'seatVanished', player: C, arrows: [a1, a2] })).toStrictEqual({
      kind: 'seatVanished',
      player: 'C',
      arrowCount: 2,
    });
    expect(toLogEvent({ kind: 'turnPassed', from: A, to: B })).toStrictEqual({ kind: 'turnPassed', from: 'A', to: 'B' });
    expect(toLogEvent({ kind: 'matchWon', player: A })).toStrictEqual({ kind: 'matchWon', player: 'A' });
  });
});

/** The opening with one spawner's border arrows handed to `owners` (in arrow order). */
const withBorderOwners = (
  base: GameState,
  owners: readonly (PlayerId | undefined)[],
): { readonly state: GameState; readonly arrows: readonly ArrowId[] } => {
  const vertex = [...base.spawners.keys()].sort()[0];
  if (vertex === undefined) throw new Error('setup: the opening has no spawner');
  const arrows = [...geometry.borderArrows(vertex)].sort();
  const territory = new Map(base.territory);
  for (const arrow of arrows) territory.delete(arrow);
  arrows.forEach((arrow, i) => {
    const owner = owners[i];
    if (owner !== undefined) territory.set(arrow, owner);
  });
  return { state: { ...base, territory }, arrows };
};

describe('SCENARIOS.md 5 — resolveShareEvents', () => {
  const opening = playtestLog().opening;

  it('no share changed: no event', () => {
    const { state } = withBorderOwners(opening, [A, undefined, B]);
    expect(resolveShareEvents(geometry, { before: state, after: state, move: endTurn() })).toEqual([]);
  });

  it('a share taken from B by C: one event each, in turn order, with counts before and after', () => {
    const before = withBorderOwners(opening, [A, B, B]).state;
    const after = withBorderOwners(opening, [A, C, B]).state;
    const events = resolveShareEvents(geometry, { before, after, move: endTurn() });
    expect(events).toStrictEqual([
      { kind: 'sharesChanged', player: 'B', from: shareCountOf(before, B, geometry), to: shareCountOf(after, B, geometry) },
      { kind: 'sharesChanged', player: 'C', from: shareCountOf(before, C, geometry), to: shareCountOf(after, C, geometry) },
    ]);
    const [lost, gained] = events;
    expect(lost?.kind === 'sharesChanged' && lost.to - lost.from).toBe(-1);
    expect(gained?.kind === 'sharesChanged' && gained.to - gained.from).toBe(1);
  });

  it('events follow the players list (turn order), not the id order', () => {
    const before = withBorderOwners(opening, [A, B, B]).state;
    const after = withBorderOwners(opening, [A, C, B]).state;
    const reversed = (state: GameState): GameState => ({ ...state, players: [...state.players].reverse() });
    expect(
      resolveShareEvents(geometry, { before: reversed(before), after: reversed(after), move: endTurn() }).map((e) =>
        'player' in e ? e.player : '',
      ),
    ).toEqual(['C', 'B']);
  });

  it('a seat that drops to zero shares still gets its event', () => {
    const before = withBorderOwners(opening, [undefined, undefined, B]);
    const bOnlyHere = { ...before.state, territory: new Map([...before.state.territory].filter(([, o]) => o !== B)) };
    const withB = withBorderOwners(bOnlyHere, [undefined, undefined, B]).state;
    const without = withBorderOwners(bOnlyHere, [undefined, undefined, undefined]).state;
    expect(shareCountOf(withB, B, geometry)).toBe(1);
    expect(resolveShareEvents(geometry, { before: withB, after: without, move: endTurn() })).toStrictEqual([
      { kind: 'sharesChanged', player: 'B', from: 1, to: 0 },
    ]);
  });
});

describe('SCENARIOS.md 5 — logEventsOf over a real game', () => {
  it('every step: the projected web events, then the share events; the record covers the issue list', () => {
    const log = playtestLog();
    let state = log.opening;
    const seen = new Set<LogEvent['kind']>();
    for (const move of log.moves.slice(0, P47_FIRST_UNPLAYABLE)) {
      const after = rules.apply(state, move);
      const step = { before: state, after, move };
      const expected = [
        ...resolveEvents(step).flatMap((event) => {
          const logged = toLogEvent(event);
          return logged === null ? [] : [logged];
        }),
        ...resolveShareEvents(geometry, step),
      ];
      const got = logEventsOf(geometry, step);
      expect(got).toStrictEqual(expected);
      for (const event of got) seen.add(event.kind);
      // Shares, independently: the events add up to shareCountOf.
      for (const player of state.players) {
        const delta = got
          .filter((e): e is Extract<LogEvent, { kind: 'sharesChanged' }> => e.kind === 'sharesChanged' && e.player === String(player))
          .reduce((sum, e) => sum + e.to - e.from, 0);
        expect(delta).toBe(shareCountOf(after, player, geometry) - shareCountOf(state, player, geometry));
      }
      state = after;
    }
    // The playable prefix holds these; the other kinds are pinned by the toLogEvent cases.
    for (const kind of ['turnPassed', 'trailCut', 'enclosureClosed', 'territoryCaptured', 'sharesChanged'] as const) {
      expect(seen.has(kind), kind).toBe(true);
    }
    // JSON round-trip: what the log writes is what it reads.
    const sample = logEventsOf(geometry, { before: log.opening, after: rules.apply(log.opening, endTurn()), move: endTurn() });
    expect(JSON.parse(JSON.stringify(sample))).toStrictEqual(sample);
  });
});
