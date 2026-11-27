/**
 * docs/spec/agent-board-map/agent-board-map.core.feature — the door scenarios.
 * The door is the component; S3 is the fake store (SCENARIOS.md flows 1 and 2).
 *
 * @see docs/spec/agent-board-map/agent-board-map.md
 * @see docs/spec/agent-board-map/SCENARIOS.md
 */

import { describe, expect, it } from 'vitest';
import type { GameState } from '@conquarrow/contracts';
import { MAP_LEGEND, agentContext, boardMap, boardView, offerText } from '@conquarrow/byok-offer';
import { applyMove } from '../src/game-advance';
import { aliceHash, carolHash, groupHashOfUserHashes } from './support';
import {
  CAROL,
  TOKEN,
  accessToken,
  agent,
  atSeat,
  heuristicSeat,
  human,
  inviteHandle,
  jsonOf,
  opening,
  geometry,
  postDoor,
  requireStepAt,
  rules,
  seedStarted,
  toolContent,
  toolJson,
  toolsCall,
  withRig,
  type RemoteRig,
  doorOfferText,
} from './remote-agent-mcp.support';

const A = () => aliceHash();
const C = () => carolHash();

const seedAgentTurn = (rig: RemoteRig) => {
  const state = atSeat(opening(3), 1);
  seedStarted(rig, {
    token: TOKEN,
    groupHash: groupHashOfUserHashes([A()]),
    gameNumber: '000001',
    seats: [human(A()), agent(C()), heuristicSeat()],
    state,
    version: 1,
    members: [A(), C()],
  });
  const seat = state.players[1];
  if (seat === undefined) throw new Error('setup: missing agent player');
  return { state, seat };
};

const stateJsonOf = (offer: string): Record<string, unknown> => {
  const lines = offer.split('\n');
  const at = lines.indexOf('STATE_JSON:');
  return JSON.parse(lines[at + 1] ?? 'null') as Record<string, unknown>;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Every text content block of a tool result, in order. */
const blocksOf = (result: { body: string }): { type: unknown; text: unknown }[] => {
  const rpc = asRecord(asRecord(jsonOf(result as never))['result']);
  const content = rpc['content'];
  return Array.isArray(content) ? (content as { type: unknown; text: unknown }[]) : [];
};

const observeWith = (rig: RemoteRig, board?: unknown) =>
  postDoor(
    rig,
    toolsCall('observe', board === undefined ? { handle: inviteHandle() } : { handle: inviteHandle(), board }),
    accessToken(rig, CAROL.sub),
  );

const advanceOneStep = (state: GameState) => {
  requireStepAt(state, 0);
  const step = rules.legalMoves(state)[0];
  if (step === undefined) throw new Error('setup: no step');
  const after = applyMove(state, step);
  expect(rules.legalMoves(after).some((m) => m.kind === 'step')).toBe(true);
  return after;
};

const moveWith = (rig: RemoteRig, args: Record<string, unknown>) =>
  postDoor(rig, toolsCall('move', { handle: inviteHandle(), ...args }), accessToken(rig, CAROL.sub));

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

describe('The offer is its own plain-text block', () => {
  it('observe without board returns the JSON block and the offer block', async () => {
    await withRig(async (rig) => {
      const { state, seat } = seedAgentTurn(rig);

      const result = await observeWith(rig);
      const blocks = blocksOf(result);

      expect(toolContent(result)?.isError).toBe(false);
      expect(blocks).toHaveLength(2);
      expect(blocks.every((block) => block.type === 'text')).toBe(true);
      expect(toolJson(result)).toEqual({ stop: false, blocks: ['offer'] });
      expect(blocks[1]?.text).toBe(doorOfferText(rig, state, seat));
      expect(String(blocks[1]?.text)).toContain('\n');
      expect(String(blocks[1]?.text)).not.toContain('\\n');
      expect(blocks.some((block) => String(block.text).includes('"offer":'))).toBe(false);
    });
  });

  it('move that leaves steps returns the machine fields and the new offer as text', async () => {
    await withRig(async (rig) => {
      const { state, seat } = seedAgentTurn(rig);
      const after = advanceOneStep(state);

      const result = await moveWith(rig, { moves: [0], endTurn: false });
      const blocks = blocksOf(result);

      expect(blocks).toHaveLength(2);
      expect(toolJson(result)).toEqual({ applied: true, version: 2, stop: false, blocks: ['offer'] });
      expect(blocks[1]?.text).toBe(doorOfferText(rig, after, seat));
    });
  });
});

describe('board "json" adds the board to the JSON block', () => {
  it('observe with board "json" on the agent\'s turn returns the offer and the whole board', async () => {
    await withRig(async (rig) => {
      const { state, seat } = seedAgentTurn(rig);
      expect(state.spawners.size).toBeGreaterThan(12);

      const result = await observeWith(rig, 'json');
      const text = toolJson(result);
      const board = asRecord(text?.['board']);
      const blocks = blocksOf(result);

      expect(blocks).toHaveLength(2);
      expect(toolContent(result)?.isError).toBe(false);
      expect(text).toEqual({ stop: false, blocks: ['offer'], board: plain(boardView(geometry, state, seat)) });
      expect(blocks[1]?.text).toBe(doorOfferText(rig, state, seat));
      expect(board['me']).toBe(String(seat));
      expect(board['activePlayer']).toBe(String(state.activePlayer));
      const territory = asRecord(board['territory']);
      const listed = Object.entries(territory).flatMap(([owner, arrows]) =>
        (arrows as string[]).map((arrow) => [arrow, owner] as const),
      );
      expect(new Map(listed)).toEqual(
        new Map([...state.territory].map(([arrow, owner]) => [String(arrow), String(owner)])),
      );
      expect(listed.length).toBe(state.territory.size);
      const trails = asRecord(board['trails']);
      for (const player of state.players) {
        expect([...((trails[String(player)] as string[] | undefined) ?? [])].sort()).toEqual(
          [...(state.trails.get(player) ?? [])].map(String).sort(),
        );
      }
      expect(board['groups']).toEqual(stateJsonOf(String(blocks[1]?.text))['groups']);
      const spawners = board['spawners'] as { vertex: string }[];
      expect(spawners.map((row) => row.vertex).sort()).toEqual(
        [...state.spawners.keys()].map(String).sort(),
      );
    });
  });
});

describe('board "ascii" adds the map as its own text block', () => {
  it('observe with board "ascii" returns the JSON block, the offer and then the map', async () => {
    await withRig(async (rig) => {
      const { state, seat } = seedAgentTurn(rig);

      const result = await observeWith(rig, 'ascii');
      const blocks = blocksOf(result);

      expect(toolContent(result)?.isError).toBe(false);
      expect(blocks).toHaveLength(3);
      expect(toolJson(result)).toEqual({ stop: false, blocks: ['offer', 'map'] });
      expect(blocks[1]?.text).toBe(doorOfferText(rig, state, seat));
      expect(blocks[2]?.type).toBe('text');
      expect(blocks[2]?.text).toBe(boardMap(boardView(geometry, state, seat)));
      expect(String(blocks[2]?.text).startsWith('map me=')).toBe(true);
      expect(String(blocks[2]?.text).split('\n').length).toBeGreaterThan(10);
    });
  });

  it('observe with board "both" returns the board and the map', async () => {
    await withRig(async (rig) => {
      const { state, seat } = seedAgentTurn(rig);

      const result = await observeWith(rig, 'both');
      const blocks = blocksOf(result);
      const board = boardView(geometry, state, seat);

      expect(blocks).toHaveLength(3);
      expect(toolJson(result)).toEqual({ stop: false, blocks: ['offer', 'map'], board: plain(board) });
      expect(blocks[1]?.text).toBe(doorOfferText(rig, state, seat));
      expect(blocks[2]?.text).toBe(boardMap(board));
    });
  });
});

describe('The web BYOK seat gets the same board context as an MCP agent', () => {
  it('The door and the BYOK seat draw the same map for the same position', async () => {
    await withRig(async (rig) => {
      const { state, seat } = seedAgentTurn(rig);

      const result = await observeWith(rig, 'ascii');

      expect(blocksOf(result)[2]?.text).toBe(
        agentContext(offerText(state, seat), geometry, state, seat, 'ascii').map,
      );
    });
  });
});

describe('move takes board too', () => {
  it('move with board "both" returns the new offer with the board and the map', async () => {
    await withRig(async (rig) => {
      const { state, seat } = seedAgentTurn(rig);
      const after = advanceOneStep(state);

      const result = await moveWith(rig, { moves: [0], endTurn: false, board: 'both' });
      const blocks = blocksOf(result);
      const board = boardView(geometry, after, seat);

      expect(toolContent(result)?.isError).toBe(false);
      expect(blocks).toHaveLength(3);
      expect(toolJson(result)).toEqual({
        applied: true,
        version: 2,
        stop: false,
        blocks: ['offer', 'map'],
        board: plain(board),
      });
      expect(blocks[1]?.text).toBe(doorOfferText(rig, after, seat));
      expect(blocks[2]?.text).toBe(boardMap(board));
    });
  });
});

type Schema = {
  name: string;
  description: string;
  inputSchema: {
    properties: Record<string, { type?: string; enum?: unknown[]; default?: unknown; description?: string }>;
    required?: string[];
  };
};

describe('tools/list teaches board and the blocks', () => {
  it('tools/list documents board on observe and move', async () => {
    await withRig(async (rig) => {
      const result = await postDoor(
        rig,
        { jsonrpc: '2.0', id: 7, method: 'tools/list' },
        accessToken(rig, CAROL.sub),
      );
      const tools = asRecord(asRecord(jsonOf(result))['result'])['tools'] as Schema[];

      for (const name of ['observe', 'move']) {
        const tool = tools.find((entry) => entry.name === name);
        const board = tool?.inputSchema.properties['board'];
        expect(board?.type).toBe('string');
        expect(board?.enum).toEqual(['off', 'json', 'ascii', 'both']);
        expect(board?.default).toBe('off');
        expect(tool?.inputSchema.required ?? []).not.toContain('board');
        expect(tool?.inputSchema.properties).not.toHaveProperty('full');
        const text = board?.description ?? '';
        for (const value of ['"off"', '"json"', '"ascii"', '"both"']) expect(text).toContain(value);
        expect(text).toMatch(/KB/);
        expect(text).toMatch(/own text block/);
        expect(text).toMatch(/start of (your|a) turn/);
        for (const glyph of ['unclaimed', 'territory', 'trail', 'stack', 'under', 'spent', 'speed']) {
          expect(text).toContain(glyph);
        }
        expect(tool?.description).toContain('board');
        for (const line of MAP_LEGEND) expect(text).toContain(line);
        expect(tool?.description).toMatch(/offer .*plain text/);
        expect(text).toMatch(/1\/d/);
        expect(text).toMatch(/n\/d/);
        for (const fixed of ['3 = 1/3', '1/9', '1/12', '12 = ']) expect(text).not.toContain(fixed);
      }
      const observe = tools.find((tool) => tool.name === 'observe');
      expect(observe?.inputSchema.required).toEqual(['handle']);
      const move = tools.find((tool) => tool.name === 'move');
      expect(move?.inputSchema.required).toEqual(['handle', 'moves', 'endTurn']);
      expect(move?.description).toMatch(/after the move/);
    });
  });
});
