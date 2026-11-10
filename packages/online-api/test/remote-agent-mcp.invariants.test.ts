/**
 * EARS invariants from docs/spec/remote-agent-mcp/remote-agent-mcp.md that can
 * be properties. The catalogue is fixed — no randomness.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.md
 */

import { describe, expect, it } from 'vitest';
import { offerText } from '@conquarrow/byok-offer';
import { libraryStatusFor, type InviteSeat, type PlannedSeatKind } from '@conquarrow/contracts';
import { buildUserPrompt, clearByokPlans } from '../../web/src/byokBot';
import { clearTargetLocks } from '../../web/src/targets';
import { parseLogLine, windowOfLog } from '../src/game-log';
import { redactSecrets } from '../src/mcp-http';
import { userGroupKey } from '../src/s3-keys';
import {
  ALICE,
  accessToken,
  agent,
  atSeat,
  geometry,
  headerOf,
  heuristicSeat,
  human,
  inviteHandle,
  opening,
  postDoor,
  rules,
  seedInvite,
  openInvite,
  toolsCall,
  withRig,
} from './remote-agent-mcp.support';
import { aliceHash, groupHashOfUserHashes, postStart, userHashOf, BOB } from './support';

const REFUSED: readonly {
  readonly name: string;
  readonly seats: readonly PlannedSeatKind[];
  readonly host?: number;
}[] = [
  { name: 'no human', seats: ['agent', 'agent', 'heuristic'] },
  { name: 'one human, no agent', seats: ['human', 'heuristic', 'heuristic'] },
  { name: 'byok', seats: ['byok', 'human', 'human'] },
  { name: 'host is agent', seats: ['agent', 'human', 'heuristic'], host: 0 },
  { name: 'length 2', seats: ['human', 'agent'] },
  { name: 'length 4', seats: ['human', 'agent', 'human', 'heuristic'] },
  { name: 'length 6 with no human', seats: ['agent', 'agent', 'heuristic', 'heuristic', 'heuristic', 'heuristic'] },
];

const ACCEPTED: readonly {
  readonly name: string;
  readonly seats: readonly PlannedSeatKind[];
  readonly host?: number;
}[] = [
  { name: 'one human and one agent', seats: ['human', 'agent', 'heuristic'] },
  { name: 'one human and two agents', seats: ['human', 'agent', 'agent'] },
  { name: 'six seats, one human, one agent', seats: ['human', 'agent', 'heuristic', 'heuristic', 'heuristic', 'heuristic'] },
  { name: 'two humans', seats: ['human', 'human', 'heuristic'] },
  { name: 'host is the second human', seats: ['agent', 'human', 'heuristic'], host: 1 },
];

const createBody = (plan: { readonly seats: readonly PlannedSeatKind[]; readonly host?: number }): string =>
  JSON.stringify(plan.host === undefined ? { seats: plan.seats } : { seats: plan.seats, hostSeatIndex: plan.host });

describe('remote-agent-mcp invariants', () => {
  it('invariant 1: refused plans are 422 and write no invite', async () => {
    await withRig(async (rig) => {
      for (const plan of REFUSED) {
        const before = [...rig.data.keys()];
        const response = await rig.api.handle({
          method: 'POST',
          path: '/invites',
          headers: { authorization: `Bearer ${ALICE.bearer}` },
          body: createBody(plan),
        });
        expect(response.statusCode, plan.name).toBe(422);
        expect([...rig.data.keys()], plan.name).toEqual(before);
      }
    });
  });

  it('invariant 2: a legal plan stores the invite and binds the creator only to the human chair', async () => {
    await withRig(async (rig) => {
      for (const plan of ACCEPTED) {
        const response = await rig.api.handle({
          method: 'POST',
          path: '/invites',
          headers: { authorization: `Bearer ${ALICE.bearer}` },
          body: createBody(plan),
        });
        expect(response.statusCode, plan.name).toBe(201);
        const body = JSON.parse(response.body) as { seats?: { kind?: string; userHash?: string }[] };
        const boundToCreator = body.seats?.filter((seat) => seat.userHash === aliceHash()) ?? [];
        expect(boundToCreator, plan.name).toEqual([{ kind: 'human', userHash: aliceHash() }]);
      }
    });
  });

  it('invariant 14: an agentReply line is not a move and is not a gap', () => {
    const samples = [
      '{"v":1,"agentReply":{"moves":[0],"endTurn":false}}',
      '{"v":2,"agentReply":{"moves":[1,2],"endTurn":true,"why":"short"}}',
      '{"agentReply":{"moves":[],"endTurn":true}}',
    ];
    for (const line of samples) {
      expect(parseLogLine(line), line).toBeUndefined();
    }
    const raw = [
      '{"v":1,"move":{"kind":"endTurn"}}',
      '{"v":1,"agentReply":{"moves":[0],"endTurn":false}}',
    ].join('\n');
    const window = windowOfLog(raw, 0, 1);
    expect(window.gap).toBe(false);
    expect(window.moves).toHaveLength(1);
    expect(window.moves[0]).toEqual({ kind: 'endTurn' });
  });

  it('invariant 19: one offer text per state and seat, equal to the cleared web prompt', () => {
    const state = atSeat(opening(3), 1);
    const seat = state.players[1];
    if (seat === undefined) throw new Error('setup: missing seat');
    clearByokPlans();
    clearTargetLocks();
    const first = offerText(state, seat);
    expect(offerText(state, seat)).toBe(first);
    expect(first).toBe(buildUserPrompt(geometry, state, seat, rules.legalMoves(state), false, rules));
    expect(first).toContain('Reply with only JSON:');
  });

  it('invariant 15: a playtest field does not keep an invite token or a bearer', () => {
    const token = '11'.repeat(32);
    const bearer = 'mcp-access-secret';
    for (const sample of [`why ${token}`, `plan ${bearer}`, `${token} then ${bearer}`]) {
      const redacted = redactSecrets(sample, [token, bearer]);
      expect(redacted).not.toContain(token);
      expect(redacted).not.toContain(bearer);
      expect(redacted).toContain('[redacted]');
    }
  });

  it('invariant 20: an agent chair is never your-turn', () => {
    const summary = { players: ['A', 'B', 'C'], activePlayer: 'B', lostPlayers: [] as readonly string[] };
    const both: readonly InviteSeat[] = [human(aliceHash()), agent(aliceHash()), heuristicSeat()];
    const onlyAgent: readonly InviteSeat[] = [human(userHashOf(BOB.sub)), agent(aliceHash()), heuristicSeat()];
    expect(libraryStatusFor(aliceHash(), both, summary)).not.toBe('your-turn');
    expect(libraryStatusFor(aliceHash(), onlyAgent, summary)).toBe('waiting');
  });

  it('invariant 6: start writes a humans-only groupHash and a pointer for every bound agent', async () => {
    await withRig(async (rig) => {
      const extras = [userHashOf('agent-c'), userHashOf('agent-d')];
      for (const [index, extra] of extras.entries()) {
        const token = String(index + 1).repeat(64).slice(0, 64);
        seedInvite(rig, token, openInvite([human(aliceHash()), agent(extra), heuristicSeat()], aliceHash()));
        const response = await postStart(rig.api, token, ALICE.bearer);
        expect(response.statusCode, extra).toBe(200);
        const groupHash = groupHashOfUserHashes([aliceHash()]);
        const body = JSON.parse(response.body) as { groupHash?: string };
        expect(body.groupHash, extra).toBe(groupHash);
        expect(groupHashOfUserHashes([aliceHash(), extra])).not.toBe(groupHash);
        expect(rig.data.has(userGroupKey(extra, groupHash)), extra).toBe(true);
      }
    });
  });

  it('invariant 17: the door does not mint a session id', async () => {
    await withRig(async (rig) => {
      const token = accessToken(rig, ALICE.sub);
      const session = 'sess-must-not-echo';
      const results = [
        await rig.mcp({ method: 'GET', path: '/conquarrow', headers: { 'Mcp-Session-Id': session } }),
        await postDoor(
          rig,
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28' } },
          token,
          { 'Mcp-Session-Id': session },
        ),
        await postDoor(rig, toolsCall('observe', { handle: inviteHandle() }), token, { 'Mcp-Session-Id': session }),
      ];
      for (const result of results) {
        expect(headerOf(result, 'Mcp-Session-Id')).toBeUndefined();
        expect(result.body).not.toContain(session);
      }
      expect(results[1]?.statusCode).toBe(200);
    });
  });
});
