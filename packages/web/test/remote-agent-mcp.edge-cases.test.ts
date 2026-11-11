/**
 * Lobby and in-game roster scenarios. Ordinary Vitest — not message flows.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.edge-cases.feature
 */

import { describe, expect, it } from 'vitest';
import type { InviteSeat } from '@conquarrow/contracts';
import { DEFAULT_MATCH_CONFIG } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import {
  inGameRosterSummary,
  lobbyKindOptions,
  logFromOnlineBoard,
  pickerKindOptions,
} from '../src/online-shell-ui';
import { parseMyGames } from '../src/online-parse';
import { coerceOnlineSeatPlan, defaultSeat, type SeatPlan } from '../src/seatPlan';
import { makeHostHarness } from './online-shell.support';
import { INVITE_TOKEN, inviteHash, makePagesHarness, peekInviteScript } from './online-web.support';

const planOf = (kinds: readonly ('human' | 'heuristic' | 'agent')[]): SeatPlan => ({
  playerCount: 3,
  seats: kinds.map((kind) => defaultSeat(kind)),
});

describe('The lobby and the library tell the truth about the chair', () => {
  it('The online picker offers agent and the local picker does not', async () => {
    const online = makePagesHarness({ sessionToken: 'alice-token' });
    await online.adapter.boot();
    online.adapter.selectMode('online');

    expect(online.adapter.seatKindOptions()).toContain('agent');
    expect(online.adapter.seatKindOptionsFor(0)).not.toContain('agent');
    expect(pickerKindOptions('online', 1)).toContain('agent');
    expect(pickerKindOptions('online', 0)).not.toContain('agent');
    expect(lobbyKindOptions('online', 1).map((opt) => opt.label)).toContain('Agent');
    expect(lobbyKindOptions('online', 0).map((opt) => opt.value)).not.toContain('agent');
    expect(lobbyKindOptions('local', 1).map((opt) => opt.value)).not.toContain('agent');

    online.adapter.selectMode('local');
    expect(online.adapter.seatKindOptions()).not.toContain('agent');
    expect(pickerKindOptions('local', 1)).not.toContain('agent');
  });

  it('Local to Online keeps an agent chair and does not force a second human', () => {
    const online = coerceOnlineSeatPlan(planOf(['human', 'agent', 'heuristic']));

    expect(online.seats[1]?.kind).toBe('agent');
    expect(online.seats.filter((seat) => seat.kind === 'human')).toHaveLength(1);
  });

  it('Local to Online with no agent chair still forces two humans', () => {
    const online = coerceOnlineSeatPlan(planOf(['human', 'heuristic', 'heuristic']));

    expect(online.seats[0]?.kind).toBe('human');
    expect(online.seats[1]?.kind).toBe('human');
  });

  it('An invite body with an agent seat is kept and Start is offered', async () => {
    const seats: readonly InviteSeat[] = [
      { kind: 'heuristic' },
      { kind: 'agent', userHash: '0713b126c28eea4674b2d92d984bd506' },
      { kind: 'human', userHash: '0713b126c28eea4674b2d92d984bd506' },
    ];
    const h = makeHostHarness({
      sessionToken: 'alice-token',
      hash: inviteHash(INVITE_TOKEN),
      fetchScript: [peekInviteScript(INVITE_TOKEN, seats)],
    });

    await h.host.boot();

    expect(h.host.adapter().inviteSeats()).toEqual(seats);
    expect(h.host.startOffered()).toBe(true);
  });

  it('A library row with an agent seat is kept', () => {
    const parsed = parseMyGames({
      lobbies: [],
      games: [
        {
          groupHash: 'g',
          gameNumber: '1',
          status: 'waiting',
          seatIndex: 2,
          seats: [
            { kind: 'heuristic', label: 'AI', you: false },
            { kind: 'agent', label: 'Agent', you: true },
            { kind: 'human', label: 'Ada', you: true },
          ],
        },
      ],
    });

    expect(parsed?.games[0]?.seats[1]?.kind).toBe('agent');
  });

  it('The in-game summary does not call an agent seat Player', () => {
    const game = makeMatch({ ...DEFAULT_MATCH_CONFIG, playerCount: 3 });
    const seats: readonly InviteSeat[] = [
      { kind: 'human', userHash: 'a' },
      { kind: 'agent', userHash: 'c' },
      { kind: 'heuristic' },
    ];

    const summary = inGameRosterSummary(game, seats, [undefined, 'Ada', undefined]);
    const log = logFromOnlineBoard(game, seats);

    expect(summary).toContain('Agent (Ada)');
    expect(log.seats[1]?.kind).not.toBe('human');
  });
});
