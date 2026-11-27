/**
 * docs/spec/agent-context-v2/SCENARIOS.md 4 — a BYOK seat gives its model the
 * same offer: the seat table and the recent window from its local log, and
 * this turn's steps appended between completions (P108).
 *
 * @see docs/spec/agent-context-v2/agent-context-v2.md
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Move, PlayerId } from '@conquarrow/contracts';
import { endTurn } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { clearByokPlans, recentFromMoves, type OfferAbout } from '@conquarrow/byok-offer';
import { playLlmBotTurn } from '../src/byokBot';
import { byokSeatAbout, byokTurnAbout, localOfferSeats } from '../src/byokAbout';
import { clearTargetLocks } from '../src/targets';
import { THREE_MATCH, batchJson, geometry, mockChat, postedMessage, readyConfig, rules } from './byok-batch-turn.support';

afterEach(() => {
  vi.restoreAllMocks();
  clearByokPlans();
  clearTargetLocks();
});

const p = (id: string): PlayerId => id as PlayerId;

describe('SCENARIOS.md 4 — the local seat table', () => {
  it('Player → human "Player <letter>", AI → heuristic "AI", BYOK and agent → agent "Agent"; you on the offered seat only', () => {
    const seats = [
      { player: p('A'), kind: 'human' as const },
      { player: p('B'), kind: 'byok' as const },
      { player: p('C'), kind: 'heuristic' as const },
      { player: p('D'), kind: 'agent' as const },
    ];
    expect(localOfferSeats(seats, p('B'))).toEqual([
      { player: 'A', kind: 'human', name: 'Player A' },
      { player: 'B', kind: 'agent', name: 'Agent', relation: 'you' },
      { player: 'C', kind: 'heuristic', name: 'AI' },
      { player: 'D', kind: 'agent', name: 'Agent' },
    ]);
  });
});

describe('SCENARIOS.md 4 — byokTurnAbout: the window from the local log', () => {
  it('replays the log from makeMatch(config) and keeps the window for this seat', () => {
    const opening = makeMatch(THREE_MATCH);
    const moves: Move[] = [endTurn(), endTurn()];
    const me = rules.apply(rules.apply(opening, endTurn()), endTurn()).activePlayer;
    const seats = opening.players.map((player) => ({ player, kind: 'byok' as const }));
    const about = byokTurnAbout({ config: THREE_MATCH, moves, seats }, me);
    expect(about.recent).toEqual(recentFromMoves(geometry, opening, moves, me));
    expect(about.seats).toEqual(localOfferSeats(seats, me));
  });

  it('a log that does not replay gives no history (the block is left out), not an error', () => {
    const seats = [{ player: p('A'), kind: 'byok' as const }];
    const bogus: Move = { kind: 'step', from: 'nowhere' as never, exit: 'nowhere' as never, count: 1 };
    const about = byokTurnAbout({ config: THREE_MATCH, moves: [bogus], seats }, p('A'));
    expect(about.recent).toBeUndefined();
    expect(about.seats).toEqual(localOfferSeats(seats, p('A')));
  });
});

describe('SCENARIOS.md 4 — only a BYOK seat with a match log gets an about', () => {
  const opening = makeMatch(THREE_MATCH);
  const me = opening.activePlayer;
  const log = { config: THREE_MATCH, moves: [] as Move[], seats: opening.players.map((player) => ({ player, kind: 'byok' as const })) };

  it('a BYOK seat with a log: its turn about', () => {
    expect(byokSeatAbout('byok', log, me)).toEqual(byokTurnAbout(log, me));
  });

  it.each(['heuristic', 'human', 'agent'] as const)('alt a %s seat: none', (kind) => {
    expect(byokSeatAbout(kind, log, me)).toBeUndefined();
  });

  it('alt no match log yet: none', () => {
    expect(byokSeatAbout('byok', undefined, me)).toBeUndefined();
  });
});

describe('SCENARIOS.md 4 — each completion carries the about', () => {
  const start = () => {
    const state = makeMatch(THREE_MATCH);
    const me = state.activePlayer;
    const about: OfferAbout = {
      seats: state.players.map((player) => ({ player: String(player), kind: 'agent', name: 'Agent', ...(player === me ? { relation: 'you' as const } : {}) })),
      recent: [],
    };
    return { state, me, about };
  };

  it('the first completion has the seat table and the history block', async () => {
    const { state, me, about } = start();
    const spy = mockChat([batchJson([0], true)]);
    await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy, about);
    const user = postedMessage(spy, 'user');
    expect(user).toContain(`\n${String(me)} agent Agent (you)\n`);
    expect(user.split('\n')).toContain('Since your last turn: nothing recorded yet.');
  });

  it('opt a step applied: the next completion\'s history ends with it', async () => {
    const { state, me, about } = start();
    const spy = mockChat([batchJson([0], false), batchJson([], true)]);
    await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy, about);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const second = postedMessage(spy, 'user', 1).split('\n');
    const at = second.indexOf(`Since your last turn (oldest first; ${String(me)} is you):`);
    expect(at).toBeGreaterThan(0);
    expect(second[at + 1]).toMatch(new RegExp(`^${String(me)}, 1 steps: `));
  });

  it('no about: no seat table and no history block', async () => {
    const { state, me } = start();
    const spy = mockChat([batchJson([0], true)]);
    await playLlmBotTurn(geometry, rules, state, me, readyConfig(), spy);
    const user = postedMessage(spy, 'user');
    expect(user).not.toContain('Seats in turn order');
    expect(user).not.toContain('Since your last turn');
  });
});
