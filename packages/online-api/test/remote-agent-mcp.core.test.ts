/**
 * docs/spec/remote-agent-mcp/remote-agent-mcp.core.feature — one test per scenario.
 *
 * Message-flow scenarios probe the leaves in SCENARIOS.md. The handler is the
 * component. A 501 or an unbound seat is the missing behaviour, not a bad fixture.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.md
 * @see docs/spec/remote-agent-mcp/SCENARIOS.md
 */

import { describe, expect, it } from 'vitest';
import { offerText } from '@conquarrow/byok-offer';
import { buildUserPrompt, clearByokPlans } from '../../web/src/byokBot';
import { clearTargetLocks } from '../../web/src/targets';
import {
  aliceHash,
  carolHash,
  expectStatus,
  getInvite,
  groupHashOfUserHashes,
  parseBody,
  postAccept,
  postStart,
  userHashOf,
} from './support';
import { inviteKey, lobbyKey, userGroupKey } from '../src/s3-keys';
import {
  ALICE,
  BOB,
  CAROL,
  REPLY_INSTRUCTION,
  TOKEN,
  accessToken,
  agent,
  atSeat,
  geometry,
  headerOf,
  heuristicSeat,
  human,
  inviteAt,
  inviteHandle,
  keysOf,
  opening,
  postDoor,
  requireStepAt,
  rules,
  seedInvite,
  seedStarted,
  storedVersion,
  toolJson,
  toolsCall,
  withRig,
  openInvite,
  logRaw,
  storedActive,
} from './remote-agent-mcp.support';

const A = () => aliceHash();
const B = () => userHashOf(BOB.sub);
const C = () => carolHash();

describe('One human and one agent can open a lobby', () => {
  it('Create stores a lobby with one human and one agent', async () => {
    await withRig(async (rig) => {
      const before = keysOf(rig);
      const response = await rig.api.handle({
        method: 'POST',
        path: '/invites',
        headers: { authorization: `Bearer ${ALICE.bearer}` },
        body: JSON.stringify({ seats: ['human', 'agent', 'heuristic'] }),
      });

      expect(response.statusCode).toBe(201);
      const body = parseBody(response);
      const seats = (body as { seats?: readonly { kind?: string; userHash?: string }[] }).seats;
      expect(Array.isArray(seats)).toBe(true);
      expect(seats?.[0]).toEqual({ kind: 'human', userHash: A() });
      expect(seats?.[1]).toEqual({ kind: 'agent' });
      expect(seats?.[2]).toEqual({ kind: 'heuristic' });
      const token = (body as { token?: unknown }).token;
      expect(typeof token).toBe('string');
      expect(rig.data.has(inviteKey(String(token)))).toBe(true);
      expect(rig.data.has(lobbyKey(A(), String(token)))).toBe(true);
      expect(keysOf(rig).some((key) => key.includes('/groups/'))).toBe(false);
      expect(before.filter((key) => key.includes('/groups/'))).toEqual([]);
    });
  });

  it('Browser accept binds the next human and does not take the agent chair', async () => {
    await withRig(async (rig) => {
      seedInvite(
        rig,
        TOKEN,
        openInvite([human(A()), human(), agent()], A()),
      );

      const response = expectStatus(await postAccept(rig.api, TOKEN, BOB.bearer), 200);
      const seats = (parseBody(response) as { seats?: { kind?: string; userHash?: string }[] }).seats;

      expect(seats?.[1]).toEqual({ kind: 'human', userHash: B() });
      expect(seats?.find((seat) => seat.kind === 'agent')).toEqual({ kind: 'agent' });
      const stored = inviteAt(rig, TOKEN);
      expect(stored?.seats[2]).toEqual({ kind: 'agent' });
    });
  });

  it('MCP join binds the next agent, and the same user may hold both chairs', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, TOKEN, openInvite([human(A()), agent(), heuristicSeat()], A()));
      const token = accessToken(rig, ALICE.sub);

      const result = await postDoor(
        rig,
        toolsCall('join', { handle: inviteHandle() }),
        token,
      );

      expect(toolJson(result)).toEqual({ seatIndex: 1, kind: 'agent', status: 'joined' });
      const stored = inviteAt(rig, TOKEN);
      expect(stored?.seats[0]).toEqual({ kind: 'human', userHash: A() });
      expect(stored?.seats[1]).toEqual({ kind: 'agent', userHash: A() });
      expect(rig.data.has(lobbyKey(A(), TOKEN))).toBe(true);
    });
  });

  it('A second join returns the seat already held', async () => {
    await withRig(async (rig) => {
      seedInvite(
        rig,
        TOKEN,
        openInvite([human(A()), agent(A()), agent(), heuristicSeat(), heuristicSeat(), heuristicSeat()], A()),
      );
      const token = accessToken(rig, ALICE.sub);

      const result = await postDoor(rig, toolsCall('join', { handle: inviteHandle() }), token);

      expect(toolJson(result)).toEqual({ seatIndex: 1, kind: 'agent', status: 'joined' });
      expect(inviteAt(rig, TOKEN)?.seats[2]).toEqual({ kind: 'agent' });
    });
  });
});

describe('Start waits for every bindable seat', () => {
  it('Start allocates a game whose groupHash is the humans only', async () => {
    await withRig(async (rig) => {
      seedInvite(
        rig,
        TOKEN,
        openInvite([human(A()), agent(C()), heuristicSeat()], A()),
      );

      const response = expectStatus(await postStart(rig.api, TOKEN, ALICE.bearer), 200);
      const body = parseBody(response) as { groupHash?: string; gameNumber?: string };
      const expected = groupHashOfUserHashes([A()]);

      expect(body.groupHash).toBe(expected);
      expect(expected).toBe(groupHashOfUserHashes([A()]));
      expect(groupHashOfUserHashes([A(), C()])).not.toBe(expected);
      expect(rig.data.has(userGroupKey(A(), expected))).toBe(true);
      expect(rig.data.has(userGroupKey(C(), expected))).toBe(true);
      const gone = expectStatus(await getInvite(rig.api, TOKEN), 410);
      const goneBody = parseBody(gone) as { reason?: string; groupHash?: string; gameNumber?: string };
      expect(goneBody.reason).toBe('started');
      expect(goneBody.groupHash).toBe(expected);
      expect(goneBody.gameNumber).toBe(body.gameNumber);
    });
  });
});

describe('The agent plays through the shared offer', () => {
  it('observe on the agent\'s turn returns the shared offer text', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      const groupHash = groupHashOfUserHashes([A()]);
      seedStarted(rig, {
        token: TOKEN,
        groupHash,
        gameNumber: '000001',
        seats: [human(A()), agent(C()), heuristicSeat()],
        state,
        version: 1,
        members: [A(), C()],
      });
      clearByokPlans();
      clearTargetLocks();
      const seat = state.players[1];
      if (seat === undefined) throw new Error('setup: missing agent player');
      const webPrompt = buildUserPrompt(geometry, state, seat, rules.legalMoves(state), false, rules);
      const token = accessToken(rig, CAROL.sub);

      const result = await postDoor(rig, toolsCall('observe', { handle: inviteHandle() }), token);
      const text = toolJson(result);

      expect(text?.['stop']).toBe(false);
      expect(text?.['offer']).toBe(offerText(state, seat));
      expect(text?.['offer']).toContain('[0]');
      expect(text?.['offer']).toContain(REPLY_INSTRUCTION);
      expect(webPrompt).toBe(text?.['offer']);
    });
  });

  it('A legal prefix with endTurn false stays on the agent\'s turn', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      requireStepAt(state, 0);
      const groupHash = groupHashOfUserHashes([A()]);
      seedStarted(rig, {
        token: TOKEN,
        groupHash,
        gameNumber: '000001',
        seats: [human(A()), agent(C()), heuristicSeat()],
        state,
        version: 2,
        members: [A(), C()],
      });
      const aConn = 'conn-a';
      const cConn = 'conn-c';
      expect((await rig.ws.connect({ connectionId: aConn, accessToken: ALICE.bearer })).statusCode).toBe(200);
      expect((await rig.ws.connect({ connectionId: cConn, accessToken: CAROL.bearer })).statusCode).toBe(200);
      rig.notifier.probe.clearCalls();
      const token = accessToken(rig, CAROL.sub);

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [0], endTurn: false }),
        token,
      );
      const text = toolJson(result);

      expect(text?.['applied']).toBe(true);
      expect(text?.['stop']).toBe(false);
      expect(typeof text?.['offer']).toBe('string');
      expect(text?.['offer']).toContain(REPLY_INSTRUCTION);
      expect(storedVersion(rig, groupHash, '000001')).toBe(3);
      expect(storedActive(rig, groupHash, '000001')).toBe(String(state.players[1]));
      const woken = rig.notifier.probe.on('post').calls.map((call) => call.args[0]);
      expect(woken).toEqual(expect.arrayContaining([aConn, cConn]));
      const reply = logRaw(rig, groupHash, '000001') ?? '';
      expect(reply).toContain('"agentReply"');
      expect(reply).toContain('"endTurn":false');
      expect(reply).not.toContain(TOKEN);
      expect(reply).not.toContain(token);
    });
  });

  it('endTurn true ends the turn, bursts heuristics, and stops', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      const groupHash = groupHashOfUserHashes([A()]);
      seedStarted(rig, {
        token: TOKEN,
        groupHash,
        gameNumber: '000001',
        seats: [human(A()), agent(C()), heuristicSeat()],
        state,
        version: 4,
        members: [A()],
      });
      const aConn = 'conn-a';
      expect((await rig.ws.connect({ connectionId: aConn, accessToken: ALICE.bearer })).statusCode).toBe(200);
      rig.notifier.probe.clearCalls();
      const beforeChooser = rig.chooserPlayers.length;
      const token = accessToken(rig, CAROL.sub);

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [], endTurn: true }),
        token,
      );
      const text = toolJson(result);

      expect(text?.['applied']).toBe(true);
      expect(text?.['stop']).toBe(true);
      expect(text).not.toHaveProperty('offer');
      expect(storedVersion(rig, groupHash, '000001')).toBe(5);
      const raw = rig.data.get(
        `conquarrow/groups/${groupHash}/games/000001/state.json`,
      );
      expect(raw).toBeDefined();
      const active = raw === undefined ? undefined : (JSON.parse(raw) as { state?: { activePlayer?: string } }).state?.activePlayer;
      expect(active).toBe(String(state.players[0]));
      const log = logRaw(rig, groupHash, '000001') ?? '';
      expect(log).toContain('"kind":"endTurn"');
      const chooserAfter = rig.chooserPlayers.slice(beforeChooser);
      expect(chooserAfter.every((player) => player !== String(state.players[1]))).toBe(true);
      expect(rig.notifier.probe.on('post').calls).toHaveLength(1);
      expect(rig.notifier.probe.on('post').calls[0]?.args[0]).toBe(aConn);
    });
  });
});

describe('The handshake is sessionless', () => {
  it('initialize is answered and no session id is minted', async () => {
    await withRig(async (rig) => {
      const token = accessToken(rig, ALICE.sub);
      const session = 'session-should-not-echo';

      const result = await postDoor(
        rig,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2026-07-28',
            capabilities: {},
            clientInfo: { name: 'test', version: '0' },
          },
        },
        token,
        { 'Mcp-Session-Id': session },
      );

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body) as { result?: { protocolVersion?: string } };
      expect(body.result?.protocolVersion).toBe('2026-07-28');
      expect(headerOf(result, 'Mcp-Session-Id')).toBeUndefined();
      expect(result.body).not.toContain(session);
    });
  });
});
