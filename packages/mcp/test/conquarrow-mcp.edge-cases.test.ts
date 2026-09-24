/**
 * One test per scenario of docs/spec/conquarrow-mcp/conquarrow-mcp.edge-cases.feature.
 *
 * Written against the MCP tool/handler surface, plus stdio handshake for tools/list.
 *
 * @see docs/spec/conquarrow-mcp/conquarrow-mcp.md
 */

import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  InvalidRoster,
  NoLiveMatch,
  SeatKindMismatch,
  StaleOfferIndex,
  UnknownSeat,
} from '../src/errors';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createConquarrowServer } from '../src/server';
import {
  SIX_SEATS,
  TOOL_NAMES,
  catchError,
  createTools,
  hasLeadLineKey,
  isNamedError,
  openingLeaveHomeIndex,
  openThree,
  parseLegalMoveRows,
  stampLiveWinner,
  threatLineFromObservation,
  wrapsContractViolation,
} from './support';

describe('MCP edges — roster, kind, stale index, won match, handshake', () => {
  describe('Won match and missing match refuse mutation', () => {
    it('apply_steps on a won match refuses', () => {
      const tools = createTools();
      openThree(tools, ['human', 'human', 'human']);
      stampLiveWinner(tools, 'A');
      const before = tools.observe({ seat: 'A' });
      const error = catchError(() =>
        tools.apply_steps({
          seat: before.winner ?? 'A',
          steps: [{ from: 'tiling:a:5,0,0', exit: 'tiling:a:6,0,0', count: 1 }],
        }),
      );
      expect(wrapsContractViolation(error), 'the tool refuses wrapping ContractViolation').toBe(
        true,
      );
      expect(String(error)).toMatch(/the match is over/);
      const after = tools.observe({ seat: 'A' });
      expect(after.winner).toBe(before.winner);
      expect(after.activePlayer).toBe(before.activePlayer);
    });

    it('tools other than new_match with no live match refuse NoLiveMatch', () => {
      const tools = createTools();
      expect(isNamedError(catchError(() => tools.observe({ seat: 'A' })), 'NoLiveMatch')).toBe(true);
      expect(isNamedError(catchError(() => tools.legal_moves({ seat: 'A' })), 'NoLiveMatch')).toBe(
        true,
      );
      expect(isNamedError(catchError(() => tools.see_board({ seat: 'A' })), 'NoLiveMatch')).toBe(
        true,
      );
      expect(() => tools.observe({ seat: 'A' })).toThrow(NoLiveMatch);
    });
  });

  describe('One live match, last offer per seat', () => {
    it('second new_match replaces the first', () => {
      const tools = createTools();
      const first = openThree(tools, undefined, 1);
      tools.legal_moves({ seat: 'A' });
      const index = openingLeaveHomeIndex();
      const second = openThree(tools, undefined, 2);
      expect(second.matchId.length).toBeGreaterThan(0);
      expect(second.matchId).not.toBe(first.matchId);
      expect(JSON.stringify(second.observation)).not.toBe(JSON.stringify(first.observation));
      const error = catchError(() => tools.apply_steps({ seat: 'A', indices: [index] }));
      expect(isNamedError(error, 'StaleOfferIndex') || error instanceof StaleOfferIndex).toBe(true);
    });

    it('index apply is relative to the last legal_moves for that seat', () => {
      const tools = createTools();
      openThree(tools);
      tools.legal_moves({ seat: 'A' });
      const index = openingLeaveHomeIndex();
      const first = tools.apply_steps({ seat: 'A', indices: [index] });
      const error = catchError(() => tools.apply_steps({ seat: 'A', indices: [index] }));
      expect(isNamedError(error, 'StaleOfferIndex')).toBe(true);
      expect(tools.observe({ seat: 'A' }).exposedTips).toEqual(first.observation.exposedTips);
      const refreshed = tools.legal_moves({ seat: 'A' });
      const rows = parseLegalMoveRows(refreshed.text);
      const next = rows[0]?.index;
      if (next === undefined) throw new Error('setup: refreshed legal_moves printed no index');
      const accepted = catchError(() => tools.apply_steps({ seat: 'A', indices: [next] }));
      expect(accepted, 'apply_steps with a current printed index is accepted').toBeUndefined();
    });

    it('legal_moves for a non-active seat is empty and does not steal the active offer', () => {
      const tools = createTools();
      openThree(tools);
      tools.legal_moves({ seat: 'A' });
      const before = tools.observe({ seat: 'A' });
      const forB = tools.legal_moves({ seat: 'B' });
      expect(parseLegalMoveRows(forB.text)).toEqual([]);
      const index = openingLeaveHomeIndex();
      const error = catchError(() => tools.apply_steps({ seat: 'A', indices: [index] }));
      expect(error, 'the step is accepted').toBeUndefined();
      expect(tools.observe({ seat: 'A' }).exposedTips).not.toEqual(before.exposedTips);
    });
  });

  describe('Roster is 3 or 6, human or heuristic only', () => {
    it.each([
      [2, ['human', 'heuristic']],
      [4, ['human', 'human', 'human', 'human']],
      [3, ['human', 'human', 'byok']],
      [3, ['human', 'human']],
      [6, ['human']],
    ] as const)('illegal roster playerCount %s seats %j is refused and does not clamp', (count, seats) => {
      const tools = createTools();
      const error = catchError(() => tools.new_match({ playerCount: count, seats }));
      expect(error instanceof InvalidRoster || isNamedError(error, 'InvalidRoster')).toBe(true);
      expect(isNamedError(catchError(() => tools.observe({ seat: 'A' })), 'NoLiveMatch')).toBe(true);
    });

    it('playerCount 6 with six kinds is accepted', () => {
      const tools = createTools();
      const result = tools.new_match({ playerCount: 6, seats: SIX_SEATS });
      expect(result.observation.activePlayer).toBe('A');
      expect(result.observation.me).toBe('A');
      expect(Object.keys(result.observation.shareCounts).toSorted()).toEqual([
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
      ]);
    });
  });

  describe('Kind gates mutation', () => {
    it('apply_steps and end_turn on a heuristic seat refuse', () => {
      const tools = createTools();
      openThree(tools, ['heuristic', 'human', 'human']);
      const applyError = catchError(() =>
        tools.apply_steps({
          seat: 'A',
          steps: [{ from: 'tiling:a:5,0,0', exit: 'tiling:a:6,0,0', count: 1 }],
        }),
      );
      expect(applyError instanceof SeatKindMismatch || isNamedError(applyError, 'SeatKindMismatch')).toBe(
        true,
      );
      expect(tools.observe({ seat: 'A' }).activePlayer).toBe('A');
      const endError = catchError(() => tools.end_turn({ seat: 'A' }));
      expect(endError instanceof SeatKindMismatch || isNamedError(endError, 'SeatKindMismatch')).toBe(
        true,
      );
      expect(tools.observe({ seat: 'A' }).activePlayer).toBe('A');
    });

    it('play_heuristic_turn on a human seat refuses', () => {
      const tools = createTools();
      openThree(tools);
      const error = catchError(() => tools.play_heuristic_turn({ seat: 'A' }));
      expect(error instanceof SeatKindMismatch || isNamedError(error, 'SeatKindMismatch')).toBe(true);
      expect(tools.observe({ seat: 'A' }).activePlayer).toBe('A');
    });

    it('apply_steps with both indices and steps, or neither, refuses', () => {
      const tools = createTools();
      openThree(tools);
      tools.legal_moves({ seat: 'A' });
      const empty = catchError(() => tools.apply_steps({ seat: 'A', steps: [], indices: [] }));
      expect(empty, 'empty steps and empty indices refuses').toBeInstanceOf(Error);
      expect(tools.observe({ seat: 'A' }).activePlayer).toBe('A');
      const both = catchError(() =>
        tools.apply_steps({
          seat: 'A',
          steps: [{ from: 'tiling:a:5,0,0', exit: 'tiling:a:6,0,0', count: 1 }],
          indices: [0],
        }),
      );
      expect(both, 'both a step object and an index refuses').toBeInstanceOf(Error);
      expect(tools.observe({ seat: 'A' }).activePlayer).toBe('A');
    });

    it('includeMills false drops home_mill rows', () => {
      const tools = createTools();
      openThree(tools);
      const { text } = tools.legal_moves({ seat: 'A', includeMills: false });
      const rows = parseLegalMoveRows(text);
      expect(rows.some((row) => row.tags.includes('leave_home'))).toBe(true);
      expect(rows.some((row) => row.tags.includes('home_mill'))).toBe(false);
    });

    it('unknown seat id refuses UnknownSeat', () => {
      const tools = createTools();
      openThree(tools);
      const error = catchError(() => tools.observe({ seat: 'Z' }));
      expect(error instanceof UnknownSeat || isNamedError(error, 'UnknownSeat')).toBe(true);
    });
  });

  describe('Handshake lists tools, not resources', () => {
    let client: Client | undefined;
    let mcp: McpServer | undefined;

    afterEach(async () => {
      if (client !== undefined) await client.close();
      if (mcp !== undefined) await mcp.close();
      client = undefined;
      mcp = undefined;
    });

    it('tools/list includes the seven names and no resources', async () => {
      mcp = createConquarrowServer();
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await mcp.connect(serverTransport);
      client = new Client({ name: 'conquarrow-mcp-test', version: '0.0.0' });
      await client.connect(clientTransport);

      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).toSorted()).toEqual([...TOOL_NAMES].toSorted());

      const resources = await client.listResources();
      expect(resources.resources).toEqual([]);
    });

    it('observe threatLine is derived from the fields', () => {
      const tools = createTools();
      openThree(tools);
      const observation = tools.observe({ seat: 'A' });
      expect(observation.threatLine.startsWith('Lead:')).toBe(true);
      expect(observation.threatLine).toBe(threatLineFromObservation(observation));
      expect(hasLeadLineKey(observation)).toBe(false);
    });
  });
});
