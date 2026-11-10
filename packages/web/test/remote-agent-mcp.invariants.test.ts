/**
 * Invariant 21 — the browser does not auto-play an agent seat.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.md
 */

import { describe, expect, it } from 'vitest';
import type { InviteSeat } from '@conquarrow/contracts';
import { DEFAULT_MATCH_CONFIG } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { logFromOnlineBoard } from '../src/online-shell-ui';
import { seatRuntimeFromPlan } from '../src/resume';
import { defaultSeat, type SeatPlan } from '../src/seatPlan';

describe('remote-agent-mcp invariants', () => {
  it('invariant 21: the browser does not auto-play an agent seat and does not record it as human', () => {
    const game = makeMatch({ ...DEFAULT_MATCH_CONFIG, playerCount: 3 });
    const seats: readonly InviteSeat[] = [
      { kind: 'human' },
      { kind: 'agent', userHash: 'c' },
      { kind: 'heuristic' },
    ];
    const log = logFromOnlineBoard(game, seats);
    expect(log.seats[1]?.kind).not.toBe('human');

    const plan: SeatPlan = {
      playerCount: 3,
      seats: [defaultSeat('human'), defaultSeat('agent'), defaultSeat('heuristic')],
    };
    const runtime = seatRuntimeFromPlan(plan, game.players);
    const agentPlayer = game.players[1];
    if (agentPlayer === undefined) throw new Error('setup: missing player');
    expect(runtime.aiKeys.has(String(agentPlayer))).toBe(false);
  });
});