/**
 * docs/spec/agent-board-map/agent-board-map.edge-cases.feature — the door
 * boundaries (SCENARIOS.md flows 1 and 2, every alt). Map boundaries live in
 * packages/byok-offer/test.
 *
 * @see docs/spec/agent-board-map/agent-board-map.md
 * @see docs/spec/agent-board-map/SCENARIOS.md
 */

import { describe, expect, it } from 'vitest';
import type { ArrowId, GameState, PlayerId } from '@conquarrow/contracts';
import { boardMap, boardView } from '@conquarrow/byok-offer';
import { aliceHash, carolHash, groupHashOfUserHashes } from './support';
import {
  CAROL,
  TOKEN,
  accessToken,
  agent,
  atSeat,
  geometry,
  heuristicSeat,
  human,
  inviteHandle,
  keysOf,
  openInvite,
  opening,
  postDoor,
  requireStepAt,
  seedInvite,
  seedStarted,
  toolContent,
  toolJson,
  toolTexts,
  toolsCall,
  withRig,
  type RemoteRig,
  doorOfferText,
} from './remote-agent-mcp.support';

const A = () => aliceHash();
const C = () => carolHash();
const SEATS = () => [human(A()), agent(C()), heuristicSeat()];

const seed = (rig: RemoteRig, state: GameState): void => {
  seedStarted(rig, {
    token: TOKEN,
    groupHash: groupHashOfUserHashes([A()]),
    gameNumber: '000001',
    seats: SEATS(),
    state,
    version: 1,
    members: [A(), C()],
  });
};

const observe = (rig: RemoteRig, board: unknown) =>
  postDoor(rig, toolsCall('observe', { handle: inviteHandle(), board }), accessToken(rig, CAROL.sub));

const blockCount = (result: { body: string }): number => {
  const parsed = JSON.parse(result.body) as { result?: { content?: unknown[] } };
  return parsed.result?.content?.length ?? 0;
};

const BOARD_ERROR = /"off".*"json".*"ascii".*"both"/;

/** A long trail for seat A on arrows no one holds: more than the 24-arrow sample. */
const withLongTrail = (state: GameState, length: number): GameState => {
  const a = state.players[0] as PlayerId;
  const window = geometry.window(geometry.seedPoint(), 9);
  const free: ArrowId[] = [];
  for (const arrow of [...window.arrows].sort()) {
    if (free.length >= length) break;
    if (state.territory.has(arrow) || state.groups.has(arrow)) continue;
    free.push(arrow);
  }
  if (free.length < length) throw new Error('setup: not enough free arrows');
  return { ...state, trails: new Map([...state.trails, [a, new Set(free)]]) };
};

describe('Only a board-bearing result carries a board or a map', () => {
  it('a valid board on a stop result carries no board and no map: an invite C has joined that is not started', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, TOKEN, openInvite(SEATS(), A()));
      const before = keysOf(rig);

      const result = await observe(rig, 'both');
      const text = toolJson(result);

      expect(blockCount(result)).toBe(1);
      expect(text?.['stop']).toBe(true);
      expect(text?.['reason']).toBe('not-started');
      expect(text).not.toHaveProperty('board');
      expect(text).not.toHaveProperty('offer');
      expect(keysOf(rig)).toEqual(before);
    });
  });

  it('a valid board on a stop result carries no board and no map: a started game whose active seat is A\'s human seat', async () => {
    await withRig(async (rig) => {
      seed(rig, atSeat(opening(3), 0));

      const result = await observe(rig, 'both');
      const text = toolJson(result);

      expect(blockCount(result)).toBe(1);
      expect(text?.['stop']).toBe(true);
      expect(text?.['reason']).toBe('not-your-turn');
      expect(text).not.toHaveProperty('board');
      expect(text).not.toHaveProperty('offer');
    });
  });

  it('move that ends the turn carries no board and no map', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      requireStepAt(state, 0);
      seed(rig, state);

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [0], endTurn: true, board: 'both' }),
        accessToken(rig, CAROL.sub),
      );
      const text = toolJson(result);

      expect(blockCount(result)).toBe(1);
      expect(text?.['applied']).toBe(true);
      expect(text?.['stop']).toBe(true);
      expect(text).not.toHaveProperty('board');
      expect(text).not.toHaveProperty('offer');
    });
  });

  it('board "off" is the compact result', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      seed(rig, state);
      const seat = state.players[1];
      if (seat === undefined) throw new Error('setup: missing agent player');

      const result = await observe(rig, 'off');

      expect(blockCount(result)).toBe(2);
      expect(toolJson(result)).toEqual({ stop: false, blocks: ['offer'] });
      expect(toolTexts(result)[1]).toBe(doorOfferText(rig, state, seat));
    });
  });

  it.each([
    { tool: 'observe', value: 'map' },
    { tool: 'observe', value: 'ASCII' },
    { tool: 'observe', value: true },
    { tool: 'observe', value: null },
    { tool: 'move', value: 1 },
  ])('board that is not one of the four values is a correctable error ($tool, $value)', async ({ tool, value }) => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      requireStepAt(state, 0);
      seed(rig, state);
      const before = new Map(rig.data);
      const args =
        tool === 'move'
          ? { handle: inviteHandle(), moves: [0], endTurn: false, board: value }
          : { handle: inviteHandle(), board: value };

      const result = await postDoor(rig, toolsCall(tool, args), accessToken(rig, CAROL.sub));
      const text = toolJson(result);

      expect(toolContent(result)?.isError).toBe(true);
      expect(blockCount(result)).toBe(1);
      expect(text?.['stop']).toBe(false);
      expect(String(text?.['error'])).toMatch(BOARD_ERROR);
      expect(text).not.toHaveProperty('offer');
      expect(new Map(rig.data)).toEqual(before);
    });
  });

  it('An empty reply returns the current offer as its own block', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      requireStepAt(state, 0);
      seed(rig, state);
      const seat = state.players[1];
      if (seat === undefined) throw new Error('setup: missing agent player');

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [], endTurn: false, board: 'ascii' }),
        accessToken(rig, CAROL.sub),
      );
      const texts = toolTexts(result);

      expect(texts).toHaveLength(3);
      expect(toolJson(result)).toEqual({ stop: false, blocks: ['offer', 'map'] });
      expect(texts[1]).toBe(doorOfferText(rig, state, seat));
      expect(texts[2]).toBe(boardMap(boardView(geometry, state, seat)));
    });
  });

  it('An unknown tool with a valid board is still an unknown tool', async () => {
    await withRig(async (rig) => {
      seed(rig, atSeat(opening(3), 1));
      const before = new Map(rig.data);

      const result = await postDoor(
        rig,
        toolsCall('peek', { handle: inviteHandle(), board: 'ascii' }),
        accessToken(rig, CAROL.sub),
      );

      expect(toolContent(result)?.isError).toBe(true);
      expect(blockCount(result)).toBe(1);
      expect(toolJson(result)).toEqual({ error: 'unknown tool', stop: false });
      expect(new Map(rig.data)).toEqual(before);
    });
  });
});

describe('The board is whole where the offer is capped', () => {
  it('A trail longer than the sample is listed whole', async () => {
    await withRig(async (rig) => {
      const state = withLongTrail(atSeat(opening(3), 1), 30);
      seed(rig, state);
      const a = String(state.players[0]);

      const result = await observe(rig, 'json');
      const text = toolJson(result);
      const board = text?.['board'] as { trails: Record<string, string[]> } | undefined;

      expect(board?.trails[a]?.length).toBe(30);
      expect([...(board?.trails[a] ?? [])].sort()).toEqual(
        [...(state.trails.get(state.players[0] as PlayerId) ?? [])].map(String).sort(),
      );
      expect(text).not.toHaveProperty('offer');
      const offer = toolTexts(result)[1] ?? '';
      const lines = offer.split('\n');
      const stateJson = JSON.parse(lines[lines.indexOf('STATE_JSON:') + 1] ?? 'null') as {
        trails: Record<string, { count: number; sample: string[]; truncated: boolean }>;
      };
      expect(stateJson.trails[a]?.truncated).toBe(true);
      expect(stateJson.trails[a]?.sample.length).toBe(24);
    });
  });
});
