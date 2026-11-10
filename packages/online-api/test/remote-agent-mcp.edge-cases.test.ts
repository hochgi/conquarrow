/**
 * docs/spec/remote-agent-mcp/remote-agent-mcp.edge-cases.feature — message flows.
 *
 * One test per scenario, outline rows expanded. Each diagram path in
 * SCENARIOS.md is probed at the leaf seam. Lobby, library, and deletion live
 * in the ordinary suites.
 *
 * @see docs/spec/remote-agent-mcp/SCENARIOS.md
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { endTurn, type GameState, type Move } from '@conquarrow/contracts';
import { replay } from '@conquarrow/rules-core';
import { parseLogLine, stampLogLine, windowOfLog } from '../src/game-log';
import { gameStateKey, userProfileKey } from '../src/s3-keys';
import {
  ALICE,
  BOB,
  CAROL,
  CLOCK,
  DAVE,
  MCP_AUDIENCE,
  REFRESH_TTL_MS,
  REPLY_INSTRUCTION,
  TOKEN,
  accessToken,
  agent,
  atSeat,
  failNextPut,
  headerOf,
  heuristicSeat,
  human,
  inviteAt,
  inviteHandle,
  jsonOf,
  keysOf,
  logRaw,
  opening,
  postDoor,
  putRaw,
  requireStepAt,
  rules,
  seedInvite,
  seedStarted,
  storedActive,
  storedVersion,
  toolContent,
  toolJson,
  toolsCall,
  withRig,
  openInvite,
  type RemoteRig,
} from './remote-agent-mcp.support';
import {
  aliceHash,
  carolHash,
  daveHash,
  expectStatus,
  getGame,
  getInvite,
  getLog,
  groupHashOfUserHashes,
  logBody,
  parseBody,
  postAccept,
  postMove,
  postStart,
  userHashOf,
} from './support';

const A = () => aliceHash();
const B = () => userHashOf(BOB.sub);
const C = () => carolHash();
const D = () => daveHash();
const GAME = '000001';

const refreshKey = (userHash: string): string =>
  `conquarrow/users/${userHash}/mcp-refresh.json`;

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const s256 = (verifier: string): string =>
  createHash('sha256').update(verifier, 'utf8').digest('base64url');

const three = (): readonly ReturnType<typeof human>[] => [human(A()), agent(C()), heuristicSeat()];

const started = (
  rig: RemoteRig,
  state: GameState,
  seats: StartedSeats,
  version: number,
  members: readonly string[] = [A(), C()],
): string => {
  const groupHash = groupHashOfUserHashes([A()]);
  seedStarted(rig, {
    token: TOKEN,
    groupHash,
    gameNumber: GAME,
    seats,
    state,
    version,
    members,
  });
  return groupHash;
};

type StartedSeats = Parameters<typeof seedStarted>[1]['seats'];

const refusal = (status: number): boolean => status >= 400 && status < 500;

describe('Create still refuses a plan that is not one human plus an agent, or two humans', () => {
  it.each([
    { seats: ['agent', 'agent', 'heuristic'], host: undefined, name: 'no human' },
    { seats: ['human', 'heuristic', 'heuristic'], host: undefined, name: 'one human and no agent' },
    { seats: ['byok', 'human', 'human'], host: undefined, name: 'byok' },
    { seats: ['agent', 'human', 'heuristic'], host: 0, name: 'host is not human' },
    { seats: ['human', 'agent'], host: undefined, name: 'length other than 3 or 6' },
  ] as const)('Create refuses and stores nothing — $name', async ({ seats, host }) => {
    await withRig(async (rig) => {
      const body =
        host === undefined ? { seats: [...seats] } : { seats: [...seats], hostSeatIndex: host };
      const response = await rig.api.handle({
        method: 'POST',
        path: '/invites',
        headers: { authorization: `Bearer ${ALICE.bearer}` },
        body: JSON.stringify(body),
      });

      expect(response.statusCode).toBe(422);
      expect(keysOf(rig).some((key) => key.includes('/invites/'))).toBe(false);
      expect(keysOf(rig).some((key) => key.includes('/lobbies/'))).toBe(false);
      expect(keysOf(rig).some((key) => key.includes('/groups/'))).toBe(false);
    });
  });
});

describe('Accept and join do not take each other\'s chairs', () => {
  it('Accept by a user who already holds the agent seat binds the next human', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, TOKEN, openInvite([human(), agent(A()), heuristicSeat()], A()));

      const response = expectStatus(await postAccept(rig.api, TOKEN, ALICE.bearer), 200);
      const seats = (parseBody(response) as { seats?: { kind: string; userHash?: string }[] }).seats;

      expect(seats?.[0]).toEqual({ kind: 'human', userHash: A() });
      expect(seats?.[1]).toEqual({ kind: 'agent', userHash: A() });
    });
  });

  it('Accept is 409 when every human seat is bound, even if an agent seat is free', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, TOKEN, openInvite([human(A()), human(B()), agent()], A()));

      const response = await postAccept(rig.api, TOKEN, CAROL.bearer);

      expect(response.statusCode).toBe(409);
      expect(inviteAt(rig, TOKEN)?.seats[2]).toEqual({ kind: 'agent' });
    });
  });

  it('Accept by a user who already holds a human seat returns that seat', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, TOKEN, openInvite([human(A()), human(), agent()], A()));

      const response = expectStatus(await postAccept(rig.api, TOKEN, ALICE.bearer), 200);
      const seats = (parseBody(response) as { seats?: { kind: string; userHash?: string }[] }).seats;

      expect(seats?.[0]).toEqual({ kind: 'human', userHash: A() });
      expect(seats?.[1]).toEqual({ kind: 'human' });
      expect(seats?.[2]).toEqual({ kind: 'agent' });
    });
  });

  it.each([
    { name: 'no agent seat', error: 'no-agent-seat' },
    { name: 'roster full', error: 'full' },
    { name: 'revoked', error: 'revoked' },
    { name: 'started', error: 'started' },
    { name: 'bad handle', error: 'bad-handle' },
  ])('join refuses and does not change seats — $name', async ({ name, error }) => {
    await withRig(async (rig) => {
      const seats =
        name === 'no agent seat'
          ? [human(A()), human(), heuristicSeat()]
          : name === 'roster full'
            ? [human(A()), agent(B()), agent(D())]
            : name === 'started'
              ? [human(A()), agent(C()), heuristicSeat()]
              : [human(A()), agent(), heuristicSeat()];
      const status = name === 'revoked' ? 'revoked' : name === 'started' ? 'started' : 'open';
      seedInvite(
        rig,
        TOKEN,
        openInvite(seats, A(), status, name === 'started' ? GAME : undefined),
      );
      const before = JSON.stringify(inviteAt(rig, TOKEN)?.seats);
      const handle = name === 'bad handle' ? 'not a token' : TOKEN;
      const token = accessToken(rig, CAROL.sub);

      const result = await postDoor(rig, toolsCall('join', { handle }), token);
      const content = toolContent(result);
      const parsed = toolJson(result);

      expect(parsed?.['error']).toBe(error);
      expect(content?.isError).toBe(true);
      expect(JSON.stringify(inviteAt(rig, TOKEN)?.seats)).toBe(before);
    });
  });

  it('Two different Google users may each hold an agent seat', async () => {
    await withRig(async (rig) => {
      seedInvite(
        rig,
        TOKEN,
        openInvite(
          [human(A()), agent(), agent(), heuristicSeat(), heuristicSeat(), heuristicSeat()],
          A(),
        ),
      );

      await postDoor(rig, toolsCall('join', { handle: TOKEN }), accessToken(rig, CAROL.sub));
      await postDoor(rig, toolsCall('join', { handle: TOKEN }), accessToken(rig, DAVE.sub));
      const seats = inviteAt(rig, TOKEN)?.seats ?? [];
      const boundAgents = seats.filter((seat) => seat.kind === 'agent' && seat.userHash !== undefined);

      expect(boundAgents.map((seat) => seat.kind === 'agent' && seat.userHash)).toEqual([C(), D()]);
      expect(seats.filter((seat) => seat.kind === 'human' && seat.userHash !== undefined)).toEqual([
        human(A()),
      ]);
    });
  });
});

describe('Start is still a browser action, and it waits', () => {
  it('Start before the agent has joined is refused and the invite stays open', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, TOKEN, openInvite([human(A()), agent(), heuristicSeat()], A()));

      const response = await postStart(rig.api, TOKEN, ALICE.bearer);
      const peek = await getInvite(rig.api, TOKEN);

      expect(response.statusCode).toBe(409);
      expect(peek.statusCode).toBe(200);
      expect(keysOf(rig).some((key) => key.includes('/groups/'))).toBe(false);
    });
  });

  it('Start with an MCP access token is 401 and writes nothing', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, TOKEN, openInvite([human(A()), agent(C()), heuristicSeat()], A()));
      const before = keysOf(rig);

      const response = await postStart(rig.api, TOKEN, accessToken(rig, ALICE.sub));

      expect(response.statusCode).toBe(401);
      expect(keysOf(rig)).toEqual(before);
    });
  });
});

describe('observe and move refuse without writing', () => {
  it('observe before Start returns stop and does not write a game', async () => {
    await withRig(async (rig) => {
      seedInvite(rig, TOKEN, openInvite([human(A()), agent(C()), heuristicSeat()], A()));
      const before = keysOf(rig);

      const result = await postDoor(
        rig,
        toolsCall('observe', { handle: inviteHandle() }),
        accessToken(rig, CAROL.sub),
      );
      const text = toolJson(result);

      expect(text?.['stop']).toBe(true);
      expect(text?.['reason']).toBe('not-started');
      expect(text).not.toHaveProperty('offer');
      expect(keysOf(rig).some((key) => key.endsWith('state.json') || key.endsWith('log.jsonl'))).toBe(false);
      expect(keysOf(rig)).toEqual(before);
    });
  });

  it.each([
    { name: 'a heuristic seat to move', reason: 'not-your-turn', seat: 2 },
    { name: 'another human seat to move', reason: 'not-your-turn', seat: 0 },
    { name: 'another agent seat to move', reason: 'not-your-turn', seat: 3 },
    { name: 'game over', reason: 'game-over', seat: 1 },
  ])('observe when it is not this agent\'s turn — $name', async ({ reason, seat, name }) => {
    await withRig(async (rig) => {
      const wide = name === 'another agent seat to move';
      const base = atSeat(opening(wide ? 6 : 3), seat);
      const state: GameState =
        name === 'game over'
          ? { ...base, winner: base.players[0] }
          : base;
      const seats = wide
        ? [human(A()), agent(C()), heuristicSeat(), agent(D()), heuristicSeat(), heuristicSeat()]
        : three();
      started(rig, state, seats, 2);
      const token = accessToken(rig, CAROL.sub);

      const result = await postDoor(rig, toolsCall('observe', { handle: inviteHandle() }), token);
      const text = toolJson(result);

      expect(text?.['stop']).toBe(true);
      expect(text?.['reason']).toBe(reason);
      expect(text).not.toHaveProperty('offer');
    });
  });

  it('observe by a user who has not joined', async () => {
    await withRig(async (rig) => {
      started(rig, atSeat(opening(3), 1), [human(A()), agent(), heuristicSeat()], 1, [A()]);

      const result = await postDoor(
        rig,
        toolsCall('observe', { handle: inviteHandle() }),
        accessToken(rig, DAVE.sub),
      );
      const text = toolJson(result);

      expect(text?.['stop']).toBe(true);
      expect(text?.['reason']).toBe('not-seated');
      expect(text).not.toHaveProperty('offer');
    });
  });

  it('An index the offer does not number does not change state or version', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      const endIndex = rules.legalMoves(state).findIndex((move) => move.kind === 'endTurn');
      expect(endIndex).toBeGreaterThanOrEqual(0);
      const groupHash = started(rig, state, three(), 3);

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [endIndex], endTurn: false }),
        accessToken(rig, CAROL.sub),
      );

      expect(toolJson(result)?.['stop']).toBe(false);
      expect(toolContent(result)?.isError).toBe(true);
      expect(storedVersion(rig, groupHash, GAME)).toBe(3);
      expect(logRaw(rig, groupHash, GAME) ?? '').not.toContain('agentReply');
    });
  });

  it('A bad index does not change state or version', async () => {
    await withRig(async (rig) => {
      const groupHash = started(rig, atSeat(opening(3), 1), three(), 3);

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [99], endTurn: true }),
        accessToken(rig, CAROL.sub),
      );
      const content = toolContent(result);
      const text = toolJson(result);

      expect(content?.isError).toBe(true);
      expect(typeof text?.['error']).toBe('string');
      expect(String(text?.['error']).length).toBeGreaterThan(0);
      expect(text?.['stop']).toBe(false);
      expect(storedVersion(rig, groupHash, GAME)).toBe(3);
      expect(logRaw(rig, groupHash, GAME) ?? '').not.toContain('agentReply');
    });
  });

  it('A legal index followed by an illegal one writes nothing', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      requireStepAt(state, 0);
      const groupHash = started(rig, state, three(), 3);

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [0, 99], endTurn: false }),
        accessToken(rig, CAROL.sub),
      );

      expect(storedVersion(rig, groupHash, GAME)).toBe(3);
      expect(storedActive(rig, groupHash, GAME)).toBe(String(state.players[1]));
      expect(toolJson(result)?.['stop']).toBe(false);
    });
  });

  it('The first agent read that creates state.json wakes the acting user', async () => {
    await withRig(async (rig) => {
      const groupHash = started(rig, atSeat(opening(3), 1), three(), 3);
      rig.data.delete(gameStateKey(groupHash, GAME));
      const carolConn = 'conn-carol';
      const aliceConn = 'conn-alice';
      expect((await rig.ws.connect({ connectionId: aliceConn, accessToken: ALICE.bearer })).statusCode).toBe(200);
      expect((await rig.ws.connect({ connectionId: carolConn, accessToken: CAROL.bearer })).statusCode).toBe(200);
      rig.notifier.probe.clearCalls();

      await postDoor(rig, toolsCall('observe', { handle: inviteHandle() }), accessToken(rig, CAROL.sub));

      const woken = rig.notifier.probe.on('post').calls.map((call) => call.args[0]);
      expect(woken).toEqual(expect.arrayContaining([aliceConn, carolConn]));
      expect(rig.data.has(gameStateKey(groupHash, GAME))).toBe(true);
    });
  });

  it('A move when it is not the agent\'s turn leaves state unchanged', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 0);
      const groupHash = started(rig, state, three(), 4);

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [], endTurn: true }),
        accessToken(rig, CAROL.sub),
      );
      const text = toolJson(result);

      expect(text?.['stop']).toBe(true);
      expect(text?.['reason']).toBe('not-your-turn');
      expect(storedVersion(rig, groupHash, GAME)).toBe(4);
      expect(logRaw(rig, groupHash, GAME) ?? '').not.toContain('agentReply');
    });
  });

  it('Empty moves and endTurn false, while a step remains, writes nothing', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      requireStepAt(state, 0);
      const groupHash = started(rig, state, three(), 2);
      const seat = state.players[1];
      if (seat === undefined) throw new Error('setup: missing player');

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [], endTurn: false }),
        accessToken(rig, CAROL.sub),
      );
      const content = toolContent(result);
      const text = toolJson(result);

      expect(content?.isError).toBe(false);
      expect(text?.['stop']).toBe(false);
      expect(text?.['offer']).toBeTypeOf('string');
      expect(String(text?.['offer'])).toContain(REPLY_INSTRUCTION);
      expect(storedVersion(rig, groupHash, GAME)).toBe(2);
    });
  });

  it('No legal step remains, so the turn ends even when endTurn is false', async () => {
    await withRig(async (rig) => {
      const seats = [human(A()), heuristicSeat(), agent(C())];
      const state = withNoSteps(atSeat(opening(3), 2));
      const groupHash = started(rig, state, seats, 2);

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [], endTurn: false }),
        accessToken(rig, CAROL.sub),
      );
      const text = toolJson(result);
      const raw = rig.data.get(gameStateKey(groupHash, GAME));
      const active =
        raw === undefined
          ? undefined
          : (JSON.parse(raw) as { state?: { activePlayer?: string } }).state?.activePlayer;

      expect(text?.['applied']).toBe(true);
      expect(text?.['stop']).toBe(true);
      expect(text).not.toHaveProperty('offer');
      expect(active).toBe(String(state.players[0]));
    });
  });

  it('A lost conditional put does not retry and does not double-apply', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      requireStepAt(state, 0);
      const groupHash = started(rig, state, three(), 2);
      const before = logRaw(rig, groupHash, GAME);
      failNextPut(rig, gameStateKey(groupHash, GAME));

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [0], endTurn: true }),
        accessToken(rig, CAROL.sub),
      );
      const content = toolContent(result);
      const text = toolJson(result);

      expect(content?.isError).toBe(true);
      expect(typeof text?.['error']).toBe('string');
      expect(text?.['stop']).toBe(false);
      expect(storedVersion(rig, groupHash, GAME)).toBe(2);
      expect(logRaw(rig, groupHash, GAME)).toBe(before);
    });
  });
});

const withNoSteps = (state: GameState): GameState => {
  let at = state;
  const me = at.activePlayer;
  for (let guard = 0; guard < 64; guard += 1) {
    if (at.activePlayer !== me) throw new Error('setup: turn ended before steps ran out');
    const next = rules.legalMoves(at).find((move) => move.kind === 'step');
    if (next === undefined) return at;
    at = rules.apply(at, next);
  }
  throw new Error('setup: steps did not run out');
};

describe('The reply record is not a move', () => {
  it('The log line has the reply fields and the replay ignores it', async () => {
    await withRig(async (rig) => {
      const initial = atSeat(opening(3), 1);
      const first = rules.legalMoves(initial).find((move) => move.kind === 'step');
      if (first === undefined) throw new Error('setup: no step');
      const afterPrefix = rules.apply(initial, first);
      const afterEnd = rules.apply(afterPrefix, endTurn());
      const moves: readonly Move[] = [first, endTurn()];
      const lines = [
        stampLogLine(1, first),
        JSON.stringify({ v: 1, agentReply: { moves: [0], endTurn: false } }),
        stampLogLine(2, endTurn()),
        JSON.stringify({ v: 2, agentReply: { moves: [1, 2], endTurn: true } }),
      ].join('\n') + '\n';
      const groupHash = groupHashOfUserHashes([A()]);
      seedStarted(rig, {
        token: TOKEN,
        groupHash,
        gameNumber: GAME,
        seats: three(),
        state: afterEnd,
        version: 2,
        members: [A(), C()],
        log: lines,
      });

      const record = lines
        .split('\n')
        .map((line) => (line.length === 0 ? undefined : (JSON.parse(line) as { agentReply?: { moves?: number[]; endTurn?: boolean }; v?: number })))
        .find((line) => line?.v === 2 && line.agentReply !== undefined);
      expect(record?.agentReply?.moves).toEqual([1, 2]);
      expect(record?.agentReply?.endTurn).toBe(true);
      expect(JSON.stringify(record)).not.toContain(TOKEN);
      expect(JSON.stringify(record)).not.toContain('offer');

      const parsed = parseLogLine(JSON.stringify({ v: 2, agentReply: { moves: [1, 2], endTurn: true } }));
      expect(parsed).toBeUndefined();

      const served = expectStatus(await getLog(rig.api, groupHash, GAME, ALICE.bearer, '0'), 200);
      const body = logBody(served);
      expect(body.gap).toBe(false);
      expect(body.moves).toEqual(moves);
      expect(replay(rules, initial, body.moves)).toEqual(afterEnd);
      expect(windowOfLog(lines, 0, 2).moves).toEqual(moves);
    });
  });

  it('A token echoed into why is redacted before the line is stored', async () => {
    await withRig(async (rig) => {
      const state = atSeat(opening(3), 1);
      const groupHash = started(rig, state, three(), 1);
      const token = accessToken(rig, CAROL.sub);
      const why = `because ${TOKEN} and ${token}`;

      await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [], endTurn: true, why }),
        token,
      );
      const stored = logRaw(rig, groupHash, GAME) ?? '';
      const reply = stored
        .split('\n')
        .map((line) => {
          if (line.length === 0) return undefined;
          return JSON.parse(line) as { agentReply?: { why?: string } };
        })
        .find((line) => line?.agentReply !== undefined);

      expect(reply?.agentReply?.why ?? '').toContain('[redacted]');
      expect(reply?.agentReply?.why ?? '').not.toContain(TOKEN);
      expect(reply?.agentReply?.why ?? '').not.toContain(token);
      expect(rig.logLines.join('\n')).not.toContain(TOKEN);
      expect(rig.logLines.join('\n')).not.toContain(token);
    });
  });

  it('A browser move does not append an agentReply line', async () => {
    await withRig(async (rig) => {
      const created = expectStatus(
        await rig.api.handle({
          method: 'POST',
          path: '/invites',
          headers: { authorization: `Bearer ${ALICE.bearer}` },
          body: JSON.stringify({ seats: ['human', 'human', 'heuristic'] }),
        }),
        201,
      );
      const token = (parseBody(created) as { token: string }).token;
      expectStatus(await postAccept(rig.api, token, BOB.bearer), 200);
      const startedGame = expectStatus(await postStart(rig.api, token, ALICE.bearer), 200);
      const ids = parseBody(startedGame) as { groupHash: string; gameNumber: string };
      expectStatus(await getGame(rig.api, ids.groupHash, ids.gameNumber, ALICE.bearer), 200);

      expectStatus(
        await postMove(rig.api, ids.groupHash, ids.gameNumber, ALICE.bearer, endTurn(), 0),
        200,
      );
      const lines = (logRaw(rig, ids.groupHash, ids.gameNumber) ?? '')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { agentReply?: unknown; move?: unknown });

      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => line.move !== undefined)).toBe(true);
      expect(lines.some((line) => line.agentReply !== undefined)).toBe(false);
    });
  });
});

describe('The door rejects the wrong caller before it runs a tool', () => {
  it('An unauthenticated POST is 401 and names the protected-resource metadata', async () => {
    await withRig(async (rig) => {
      const before = keysOf(rig);

      const result = await rig.mcp({ method: 'POST', path: '/conquarrow', body: '{}' });

      expect(result.statusCode).toBe(401);
      expect(headerOf(result, 'www-authenticate')).toContain(
        'https://mcp.games.hochgi.com/.well-known/oauth-protected-resource/conquarrow',
      );
      expect(keysOf(rig)).toEqual(before);
    });
  });

  it('Protected-resource metadata points at this host and this path', async () => {
    await withRig(async (rig) => {
      const result = await rig.mcp({
        method: 'GET',
        path: '/.well-known/oauth-protected-resource/conquarrow',
      });
      const body = jsonOf(result) as { resource?: string; authorization_servers?: string[] };

      expect(result.statusCode).toBe(200);
      expect(body.resource).toBe('https://mcp.games.hochgi.com/conquarrow');
      expect(body.authorization_servers).toEqual(['https://mcp.games.hochgi.com']);
    });
  });

  it.each([
    { name: 'wrong audience', aud: 'https://evil.example/conquarrow', expOffset: 1 },
    { name: 'exp at the clock', aud: MCP_AUDIENCE, expOffset: 0 },
    { name: 'Google ID token', aud: 'google', expOffset: 1 },
  ])('A token that is not this door\'s access token is 401 — $name', async ({ name, aud, expOffset }) => {
    await withRig(async (rig) => {
      const bearer =
        name === 'Google ID token'
          ? ALICE.bearer
          : accessToken(rig, ALICE.sub, rig.clock() + expOffset, aud);

      const result = await postDoor(rig, { jsonrpc: '2.0', id: 1, method: 'initialize' }, bearer);

      expect(result.statusCode).toBe(401);
      expect(result.body).not.toContain(bearer);
    });
  });

  it('GET /conquarrow does not open a stream', async () => {
    await withRig(async (rig) => {
      const result = await rig.mcp({ method: 'GET', path: '/conquarrow' });
      const deleted = await rig.mcp({ method: 'DELETE', path: '/conquarrow' });

      expect(result.statusCode).toBe(405);
      expect(headerOf(result, 'Mcp-Session-Id')).toBeUndefined();
      expect(headerOf(result, 'content-type') ?? '').not.toContain('text/event-stream');
      expect(result.body.startsWith('data:')).toBe(false);
      expect(deleted.statusCode).toBe(405);
    });
  });

  it('An older known initialize version is echoed, and no session is minted', async () => {
    await withRig(async (rig) => {
      const result = await postDoor(
        rig,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
        },
        accessToken(rig, ALICE.sub),
      );
      const body = jsonOf(result) as { result?: { protocolVersion?: string } };

      expect(body.result?.protocolVersion).toBe('2025-03-26');
      expect(headerOf(result, 'Mcp-Session-Id')).toBeUndefined();
    });
  });

  it('An unknown initialize version is answered with 2026-07-28', async () => {
    await withRig(async (rig) => {
      const result = await postDoor(
        rig,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 't', version: '0' } },
        },
        accessToken(rig, ALICE.sub),
      );
      const body = jsonOf(result) as { result?: { protocolVersion?: string } };

      expect(body.result?.protocolVersion).toBe('2026-07-28');
      expect(headerOf(result, 'Mcp-Session-Id')).toBeUndefined();
    });
  });

  it('There is no registration endpoint', async () => {
    await withRig(async (rig) => {
      const registered = await rig.mcp({ method: 'POST', path: '/register', body: '{}' });
      const metadata = await rig.mcp({
        method: 'GET',
        path: '/.well-known/oauth-authorization-server',
      });
      const body = jsonOf(metadata) as {
        registration_endpoint?: string;
        client_id_metadata_document_supported?: boolean;
      };

      expect(registered.statusCode).toBe(404);
      expect(body.registration_endpoint).toBeUndefined();
      expect(body.client_id_metadata_document_supported).toBe(true);
    });
  });

  it('A private or link-local metadata host is refused before fetch', async () => {
    await withRig(async (rig) => {
      rig.metadata.probe.on('fetch').always().answer('should-not-be-fetched');
      for (const clientId of [
        'https://169.254.169.254/latest/meta-data',
        'https://10.0.0.1/client.json',
        'https://192.168.1.9/client.json',
        'https://172.16.0.1/client.json',
      ]) {
        const result = await rig.mcp({
          method: 'GET',
          path: '/authorize',
          query: {
            client_id: clientId,
            redirect_uri: 'http://127.0.0.1/callback',
            code_challenge: s256('verifier'),
            code_challenge_method: 'S256',
            resource: MCP_AUDIENCE,
          },
        });
        expect(refusal(result.statusCode), clientId).toBe(true);
      }
      rig.metadata.probe.on('fetch').expect.neverCalled();
    });
  });

  it('An IPv4-mapped private host is refused in the hostname form URL produces', async () => {
    await withRig(async (rig) => {
      rig.metadata.probe.on('fetch').always().answer('should-not-be-fetched');
      const mapped = [
        { clientId: 'https://[::ffff:10.0.0.1]/client.json', hostname: '[::ffff:a00:1]' },
        { clientId: 'https://[::ffff:127.0.0.1]/cb', hostname: '[::ffff:7f00:1]' },
        {
          clientId: 'https://[::ffff:169.254.169.254]/latest/meta-data',
          hostname: '[::ffff:a9fe:a9fe]',
        },
        { clientId: 'https://[::ffff:a00:1]/client.json', hostname: '[::ffff:a00:1]' },
        { clientId: 'https://[::ffff:7f00:1]/cb', hostname: '[::ffff:7f00:1]' },
        { clientId: 'https://[::ffff:a9fe:a9fe]/latest/meta-data', hostname: '[::ffff:a9fe:a9fe]' },
        { clientId: 'https://[::ffff:c0a8:109]/client.json', hostname: '[::ffff:c0a8:109]' },
        { clientId: 'https://[::ffff:ac10:1]/client.json', hostname: '[::ffff:ac10:1]' },
        { clientId: 'https://0.0.0.0/client.json', hostname: '0.0.0.0' },
        { clientId: 'https://[::ffff:0.0.0.0]/client.json', hostname: '[::ffff:0:0]' },
        { clientId: 'https://[::ffff:0:0]/client.json', hostname: '[::ffff:0:0]' },
      ];
      for (const { clientId, hostname } of mapped) {
        expect(new URL(clientId).hostname, clientId).toBe(hostname);
        const result = await rig.mcp({
          method: 'GET',
          path: '/authorize',
          query: {
            client_id: clientId,
            redirect_uri: 'http://127.0.0.1/callback',
            code_challenge: s256('verifier'),
            code_challenge_method: 'S256',
            resource: MCP_AUDIENCE,
          },
        });
        expect(refusal(result.statusCode), clientId).toBe(true);
      }
      rig.metadata.probe.on('fetch').expect.neverCalled();
    });
  });

  it('A public IPv4-mapped metadata host is still fetched', async () => {
    await withRig(async (rig) => {
      const clientId = 'https://[::ffff:8.8.8.8]/client.json';
      expect(new URL(clientId).hostname).toBe('[::ffff:808:808]');
      rig.metadata.probe.on('fetch').always().answer('not-json');

      const result = await rig.mcp({
        method: 'GET',
        path: '/authorize',
        query: {
          client_id: clientId,
          redirect_uri: 'http://127.0.0.1/callback',
          code_challenge: s256('verifier'),
          code_challenge_method: 'S256',
          resource: MCP_AUDIENCE,
        },
      });

      expect(refusal(result.statusCode)).toBe(true);
      rig.metadata.probe.on('fetch').expect.calledTimes(1);
    });
  });

  it('A non-https client_id is refused before fetch', async () => {
    await withRig(async (rig) => {
      rig.metadata.probe.on('fetch').always().answer('should-not-be-fetched');

      const result = await rig.mcp({
        method: 'GET',
        path: '/authorize',
        query: {
          client_id: 'http://evil.example/client.json',
          redirect_uri: 'http://127.0.0.1/callback',
          code_challenge: s256('verifier'),
          code_challenge_method: 'S256',
          resource: MCP_AUDIENCE,
        },
      });

      expect(refusal(result.statusCode)).toBe(true);
      rig.metadata.probe.on('fetch').expect.neverCalled();
    });
  });

  it('A redirect that is not in the metadata document is refused', async () => {
    await withRig(async (rig) => {
      const clientId = 'https://ide.example/client.json';
      rig.metadata.probe.on('fetch').always().answer(
        JSON.stringify({ client_id: clientId, redirect_uris: ['http://127.0.0.1:9/other'] }),
      );
      const before = keysOf(rig);

      const result = await rig.mcp({
        method: 'GET',
        path: '/authorize',
        query: {
          client_id: clientId,
          redirect_uri: 'http://127.0.0.1:9/callback',
          code_challenge: s256('verifier'),
          code_challenge_method: 'S256',
          resource: MCP_AUDIENCE,
        },
      });

      expect(refusal(result.statusCode)).toBe(true);
      expect(keysOf(rig)).toEqual(before);
    });
  });

  it('The consent page names the redirect host and does not send the browser to Google yet', async () => {
    await withRig(async (rig) => {
      const clientId = 'https://ide.example/client.json';
      const redirect = 'http://127.0.0.1:9/callback';
      const verifier = 'b'.repeat(43);
      rig.metadata.probe.on('fetch').always().answer(
        JSON.stringify({ client_id: clientId, redirect_uris: [redirect] }),
      );
      rig.codeExchange.probe.on('exchange').always().answer({ idToken: 'google-id-token' });
      rig.googleMock.probe.on('verify').always().answer({ ok: true, sub: ALICE.sub, displayName: 'Ada' });

      const page = await rig.mcp({
        method: 'GET',
        path: '/authorize',
        query: {
          client_id: clientId,
          redirect_uri: redirect,
          code_challenge: s256(verifier),
          code_challenge_method: 'S256',
          resource: MCP_AUDIENCE,
        },
      });

      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('127.0.0.1');
      expect(headerOf(page, 'location') ?? '').not.toContain('google.com');
      const continued = continueTarget(page.body);
      expect(continued).toBeDefined();
      const toGoogle = await rig.mcp(continued ?? { method: 'GET', path: '/authorize/continue' });
      expect(toGoogle.statusCode === 302 || toGoogle.statusCode === 303).toBe(true);
      expect(headerOf(toGoogle, 'location') ?? '').toContain('google.com');
    });
  });

  it('Google callback stores a one-time code, upserts the profile, and redeems S256', async () => {
    await withRig(async (rig) => {
      const clientId = 'https://ide.example/client.json';
      const redirect = 'http://127.0.0.1:9/callback';
      const verifier = 'b'.repeat(43);
      rig.metadata.probe.on('fetch').always().answer(
        JSON.stringify({ client_id: clientId, redirect_uris: [redirect] }),
      );
      rig.codeExchange.probe.on('exchange').always().answer({ idToken: 'google-id-token' });
      rig.googleMock.probe.on('verify').always().answer({ ok: true, sub: ALICE.sub, displayName: 'Ada\n' });

      const page = await rig.mcp({
        method: 'GET',
        path: '/authorize',
        query: {
          client_id: clientId,
          redirect_uri: redirect,
          code_challenge: s256(verifier),
          code_challenge_method: 'S256',
          resource: MCP_AUDIENCE,
        },
      });
      const continued = continueTarget(page.body);
      expect(continued).toBeDefined();
      const toGoogle = await rig.mcp(continued ?? { method: 'GET', path: '/authorize/continue' });
      const google = new URL(headerOf(toGoogle, 'location') ?? 'https://example.invalid/');
      expect(google.hostname).toBe('accounts.google.com');
      expect(google.searchParams.get('response_type')).toBe('code');
      expect(google.searchParams.get('redirect_uri')).toBe('https://mcp.games.hochgi.com/oauth/callback');
      expect(google.searchParams.get('scope')).toBe('openid profile');
      expect(google.searchParams.get('code_challenge_method')).toBe('S256');
      expect(google.searchParams.get('code_challenge')).toBeTruthy();
      expect(google.searchParams.get('client_id')).toBe('google-auth-client');
      const state = google.searchParams.get('state');
      expect(state).toBeTruthy();

      rig.storeMock.probe.clearCalls();
      const back = await rig.mcp({
        method: 'GET',
        path: '/oauth/callback',
        query: { state: state ?? '', code: 'google-code' },
      });
      const puts = rig.storeMock.probe.on('put').calls.map((call) => call.args[0]);
      const profileAt = puts.findIndex((key) => key === userProfileKey(A()));
      const codeAt = puts.findIndex((key) => key.startsWith('conquarrow/oauth/codes/'));
      expect(profileAt).toBeGreaterThanOrEqual(0);
      expect(codeAt).toBeGreaterThan(profileAt);
      expect(rig.data.get(userProfileKey(A()))).toBe(JSON.stringify({ displayName: 'Ada' }));

      const returned = new URL(headerOf(back, 'location') ?? 'http://127.0.0.1/missing');
      const ours = returned.searchParams.get('code');
      expect(returned.searchParams.get('iss')).toBe('https://mcp.games.hochgi.com');
      expect(ours).toBeTruthy();
      const stored = JSON.parse(rig.data.get(`conquarrow/oauth/codes/${ours ?? ''}`) ?? '{}') as {
        exp?: number;
        challenge?: string;
        sub?: string;
      };
      expect(stored.exp).toBe(CLOCK + 60_000);
      expect(stored.sub).toBe(ALICE.sub);
      expect(stored.challenge).toBe(s256(verifier));

      const redeemed = await rig.mcp({
        method: 'POST',
        path: '/token',
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: ours,
          code_verifier: verifier,
          resource: MCP_AUDIENCE,
        }),
      });
      const body = jsonOf(redeemed) as { access_token?: string; refresh_token?: string };
      expect(redeemed.statusCode).toBe(200);
      expect(rig.data.has(`conquarrow/oauth/codes/${ours ?? ''}`)).toBe(false);
      expect(rig.signer.signed[0]?.exp).toBe(CLOCK + 15 * 60 * 1000);
      const refresh = rig.data.get(`conquarrow/users/${A()}/mcp-refresh.json`);
      expect(refresh).toContain(sha256(body.refresh_token ?? ''));
      expect(typeof body.access_token).toBe('string');
    }, { googleAuthClientId: 'google-auth-client' });
  });

  it('A hex SHA-256 challenge is not a S256 redeem', async () => {
    await withRig(async (rig) => {
      const verifier = 'd'.repeat(43);
      const code = 'e'.repeat(64);
      putRaw(
        rig,
        `conquarrow/oauth/codes/${code}`,
        JSON.stringify({
          sub: ALICE.sub,
          challenge: sha256(verifier),
          redirect: 'http://127.0.0.1/callback',
          exp: CLOCK + 60_000,
        }),
      );

      const result = await rig.mcp({
        method: 'POST',
        path: '/token',
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          resource: MCP_AUDIENCE,
        }),
      });

      expect(result.statusCode).toBe(401);
      expect(rig.data.has(`conquarrow/oauth/codes/${code}`)).toBe(true);
    });
  });

  it('A rotated refresh token is rejected and the new one works', async () => {
    await withRig(async (rig) => {
      const previous = 'c'.repeat(64);
      putRaw(
        rig,
        refreshKey(A()),
        JSON.stringify({ hash: sha256(previous), exp: CLOCK + REFRESH_TTL_MS }),
      );

      const rotated = await rig.mcp({
        method: 'POST',
        path: '/token',
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: previous,
          resource: MCP_AUDIENCE,
        }),
      });
      const body = jsonOf(rotated) as { access_token?: string; refresh_token?: string };
      expect(rotated.statusCode).toBe(200);
      expect(typeof body.access_token).toBe('string');
      expect(typeof body.refresh_token).toBe('string');
      expect(body.refresh_token).not.toBe(previous);

      const accepted = await postDoor(
        rig,
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28' } },
        body.access_token,
      );
      expect(accepted.statusCode).not.toBe(401);

      const again = await rig.mcp({
        method: 'POST',
        path: '/token',
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: previous,
          resource: MCP_AUDIENCE,
        }),
      });
      expect(again.statusCode).toBe(401);
      const stored = rig.data.get(refreshKey(A()));
      expect(stored).toBeDefined();
      expect(Array.isArray(JSON.parse(stored ?? 'null'))).toBe(false);
      expect(JSON.parse(stored ?? '{}')).not.toEqual({ hash: sha256(previous), exp: CLOCK + REFRESH_TTL_MS });
    });
  });

  it('A mismatched refresh token is 401 and the current hash is kept', async () => {
    await withRig(async (rig) => {
      const current = 'd'.repeat(64);
      const body = JSON.stringify({ hash: sha256(current), exp: CLOCK + REFRESH_TTL_MS });
      putRaw(rig, refreshKey(A()), body);

      const result = await rig.mcp({
        method: 'POST',
        path: '/token',
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: 'e'.repeat(64),
          resource: MCP_AUDIENCE,
        }),
      });

      expect(result.statusCode).toBe(401);
      expect(rig.data.get(refreshKey(A()))).toBe(body);
    });
  });
});

describe('Ping and burst stay inside one invocation', () => {
  it('A browser move still does not ping the caller', async () => {
    await withRig(async (rig) => {
      const created = expectStatus(
        await rig.api.handle({
          method: 'POST',
          path: '/invites',
          headers: { authorization: `Bearer ${ALICE.bearer}` },
          body: JSON.stringify({ seats: ['human', 'human', 'heuristic'] }),
        }),
        201,
      );
      const token = (parseBody(created) as { token: string }).token;
      expectStatus(await postAccept(rig.api, token, BOB.bearer), 200);
      const startedGame = expectStatus(await postStart(rig.api, token, ALICE.bearer), 200);
      const ids = parseBody(startedGame) as { groupHash: string; gameNumber: string };
      expectStatus(await getGame(rig.api, ids.groupHash, ids.gameNumber, ALICE.bearer), 200);
      expect((await rig.ws.connect({ connectionId: 'conn-a', accessToken: ALICE.bearer })).statusCode).toBe(200);
      expect((await rig.ws.connect({ connectionId: 'conn-b', accessToken: BOB.bearer })).statusCode).toBe(200);
      rig.notifier.probe.clearCalls();

      expectStatus(
        await postMove(rig.api, ids.groupHash, ids.gameNumber, ALICE.bearer, endTurn(), 0),
        200,
      );
      const woken = rig.notifier.probe.on('post').calls.map((call) => call.args[0]);

      expect(woken).toContain('conn-b');
      expect(woken).not.toContain('conn-a');
    });
  });

  it('The burst stops at the next agent and writes one version', async () => {
    await withRig(async (rig) => {
      const seats = [
        human(A()),
        agent(C()),
        heuristicSeat(),
        agent(D()),
        heuristicSeat(),
        heuristicSeat(),
      ];
      const state = atSeat(opening(6), 1);
      const groupHash = started(rig, state, seats, 1, [A(), C(), D()]);
      const before = rig.chooserPlayers.length;

      const result = await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [], endTurn: true }),
        accessToken(rig, CAROL.sub),
      );

      expect(toolJson(result)?.['stop']).toBe(true);
      expect(storedVersion(rig, groupHash, GAME)).toBe(2);
      const raw = rig.data.get(gameStateKey(groupHash, GAME));
      const active =
        raw === undefined
          ? undefined
          : (JSON.parse(raw) as { state?: { activePlayer?: string } }).state?.activePlayer;
      expect(active).toBe(String(state.players[3]));
      expect(rig.chooserPlayers.slice(before).includes(String(state.players[3]))).toBe(false);
    });
  });
});

const continueTarget = (
  html: string,
): { method: 'GET' | 'POST'; path: string; query?: Readonly<Record<string, string>> } | undefined => {
  const href = /(?:href|action)="([^"]*continue[^"]*)"/i.exec(html)?.[1];
  if (href === undefined) return undefined;
  const url = new URL(href, 'https://mcp.games.hochgi.com');
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return {
    method: 'GET',
    path: url.pathname,
    ...(Object.keys(query).length === 0 ? {} : { query }),
  };
};

