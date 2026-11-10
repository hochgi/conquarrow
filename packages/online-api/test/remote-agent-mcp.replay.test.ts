/**
 * Replay fixture: an agent `endTurn: false` prefix, then `endTurn: true`.
 *
 * The agentReply lines sit beside the move lines. Replaying the log must apply
 * the moves and must not apply the agentReply records.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn, type GameState, type Move } from '@conquarrow/contracts';
import { replay } from '@conquarrow/rules-core';
import { parseLogLine, stampLogLine, windowOfLog } from '../src/game-log';
import { persistEnvelope } from '../src/game-snapshot';
import {
  atSeat,
  opening,
  requireStepAt,
  rules,
} from './remote-agent-mcp.support';

const agentReply = (version: number, moves: readonly number[], end: boolean): string =>
  JSON.stringify({ v: version, agentReply: { moves, endTurn: end, why: 'short' } });

const fold = (initial: GameState, moves: readonly Move[]): GameState => replay(rules, initial, moves);

describe('an agent prefix then endTurn replays without the agentReply line', () => {
  it('endTurn false, then endTurn true, and the agentReply lines are not moves', () => {
    const initial = atSeat(opening(3), 1);
    requireStepAt(initial, 0);
    const step = rules.legalMoves(initial)[0];
    if (step === undefined || step.kind !== 'step') throw new Error('setup: index 0 is not a step');
    const afterPrefix = rules.apply(initial, step);
    const afterEnd = rules.apply(afterPrefix, endTurn());
    const moves: readonly Move[] = [step, endTurn()];
    const log = [
      stampLogLine(1, step),
      agentReply(1, [0], false),
      stampLogLine(2, endTurn()),
      agentReply(2, [], true),
    ].join('\n');

    expect(parseLogLine(agentReply(1, [0], false))).toBeUndefined();
    expect(parseLogLine(agentReply(2, [], true))).toBeUndefined();

    const served = windowOfLog(log, 0, 2);
    expect(served.gap).toBe(false);
    expect(served.moves).toEqual(moves);
    expect(fold(initial, served.moves)).toEqual(afterEnd);
    expect(persistEnvelope(2, afterEnd)).toContain('"version":2');
    expect(log).toContain('"agentReply"');
    expect(log).not.toContain('"offer"');
  });
});
