/**
 * P96 mutation pins — edges Stryker found unobserved in the game-management
 * suite. Each test names the rule it pins (spec D-number).
 *
 * @see docs/spec/game-management/game-management.md
 */

import { describe, expect, it } from 'vitest';
import { endTurn } from '@conquarrow/contracts';
import type { ObjectStore } from '../src/api-types';
import { PreconditionFailed } from '../src/api-types';
import {
  ALICE,
  BOB,
  GAME_ONE,
  GAME_TWO,
  aliceBobGroupHash,
  aliceHash,
  bobHash,
  expectStatus,
  gameStateKey,
  getGame,
  getMyGames,
  groupHashOfUserHashes,
  inviteKey,
  lobbyKey,
  makeHarness,
  mapStore,
  openingMatch,
  persistEnvelope,
  startAliceBob,
  userGroupKey,
} from './support';
import {
  TOKEN,
  accessToken,
  agent,
  atSeat,
  heuristicSeat,
  human,
  inviteHandle,
  jsonOf,
  openInvite,
  opening,
  postDoor,
  putRaw,
  seedInvite,
  seedStarted,
  toolContent,
  toolJson,
  toolsCall,
  withRig,
  type RemoteRig,
} from './remote-agent-mcp.support';
import { bodyOf } from './online-reliability.support';
import {
  DELETE_CONFIRM,
  getExport,
  getMyGamesWith,
  iso,
  metaOf,
  plantLibraryGame,
  postDelete,
  postManage,
  rowKeys,
  rowsOf,
} from './game-management.support';
import { gameMetaKey } from '../src/s3-keys';

const A = (): string => aliceHash();
const B = (): string => bobHash();
const GAME = '000001';
const PLAYERS = openingMatch(3).players.map(String);
const P0 = PLAYERS[0] ?? 'A';
const P1 = PLAYERS[1] ?? 'B';

const seedAgentGame = (
  rig: RemoteRig,
  overrides: { readonly log?: string; readonly winner?: boolean; readonly seats?: Parameters<typeof seedStarted>[1]['seats'] } = {},
): string => {
  const groupHash = groupHashOfUserHashes([A()]);
  const base = atSeat(opening(3), 1);
  const state = overrides.winner === true ? { ...base, winner: base.players[0] } : base;
  seedStarted(rig, {
    token: TOKEN,
    groupHash,
    gameNumber: GAME,
    seats: overrides.seats ?? [human(A()), agent(B()), heuristicSeat()],
    state,
    version: 2,
    members: [A(), B()],
    ...(overrides.log === undefined ? {} : { log: overrides.log }),
  });
  return groupHash;
};

const lines = (...records: readonly unknown[]): string =>
  `${records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record))).join('\n')}\n`;

const logOf = (body: Record<string, unknown>): readonly Record<string, unknown>[] =>
  body['log'] as readonly Record<string, unknown>[];

describe('Export seats and records (D1, D2)', () => {
  it('Unnamed humans are lettered; an unbound or nameless agent names no owner', async () => {
    await withRig(async (rig) => {
      const groupHash = seedAgentGame(rig, { seats: [human(A()), agent(B()), agent()] });

      const seats = bodyOf(await getExport(rig.api, groupHash, GAME, ALICE.bearer))['seats'];

      expect(seats).toEqual([
        { seat: 0, player: P0, kind: 'human', name: 'Player A' },
        { seat: 1, player: P1, kind: 'agent', name: 'Agent' },
        { seat: 2, player: PLAYERS[2], kind: 'agent', name: 'Agent' },
      ]);
    });
  });

  it('A malformed record is neither exported nor counted as withheld', async () => {
    await withRig(async (rig) => {
      const groupHash = seedAgentGame(rig, {
        winner: true,
        log: lines(
          'not json',
          '',
          { v: 1, agentReply: { moves: 'x', endTurn: true } },
          { v: 1, agentReply: { moves: [1, 'a'], endTurn: true } },
          { v: 1, agentReply: { moves: [], endTurn: 'yes' } },
          { agentReply: { moves: [], endTurn: true } },
          { v: 1, agentReply: 7 },
          { v: 2, agentReply: { seat: 9, moves: [2], endTurn: false, why: 42, plan: 'p', extra: 'x' } },
          { v: 2, agentReply: { seat: P1, moves: [], endTurn: true, why: 'w' } },
        ),
      });

      const body = bodyOf(await getExport(rig.api, groupHash, GAME, ALICE.bearer));

      expect(logOf(body)).toEqual([
        { v: 2, agentReply: { moves: [2], endTurn: false, plan: 'p' } },
        { v: 2, seat: P1, agentReply: { moves: [], endTurn: true, why: 'w' } },
      ]);
      expect(body['withheldReplies']).toBe(0);
      expect(body['moves']).toEqual([]);
    });
  });

  it('Moves logged before P49 carry no v; stamped ones keep theirs', async () => {
    await withRig(async (rig) => {
      const groupHash = seedAgentGame(rig, { log: lines(endTurn(), { v: 1, move: endTurn() }) });

      const body = bodyOf(await getExport(rig.api, groupHash, GAME, ALICE.bearer));

      expect(logOf(body)).toEqual([{ move: endTurn() }, { v: 1, move: endTurn() }]);
      expect(body['turns']).toBe(2);
    });
  });

  it("A human caller's own seat's record is theirs to read mid-game", async () => {
    await withRig(async (rig) => {
      const reply = { seat: P0, moves: [], endTurn: true };
      const groupHash = seedAgentGame(rig, { log: lines({ v: 1, agentReply: reply }) });

      const body = bodyOf(await getExport(rig.api, groupHash, GAME, ALICE.bearer));

      expect(logOf(body)).toEqual([{ v: 1, seat: P0, agentReply: { moves: [], endTurn: true } }]);
    });
  });

  it('A won game exports its winner and summary; the name rides along', async () => {
    await withRig(async (rig) => {
      const groupHash = seedAgentGame(rig, { winner: true });
      putRaw(rig, gameMetaKey(groupHash, GAME), JSON.stringify({ ...metaOf(rig.data, groupHash, GAME), name: 'Final' }));

      const body = bodyOf(await getExport(rig.api, groupHash, GAME, ALICE.bearer));

      expect(body['name']).toBe('Final');
      expect(body['winner']).toBe(P0);
      expect(body['summary']).toMatchObject({ winner: P0 });
    });
  });

  it('A mid-game export carries no winner key at all', async () => {
    await withRig(async (rig) => {
      const groupHash = seedAgentGame(rig);

      const res = await getExport(rig.api, groupHash, GAME, ALICE.bearer);

      expect(res.body).not.toContain('"winner"');
      expect(Object.keys(bodyOf(res))).not.toContain('name');
      expect(Object.keys(bodyOf(res))).not.toContain('summary');
    });
  });

  it('An unreadable position answers 500, on the route and as a stop at the door', async () => {
    await withRig(async (rig) => {
      const groupHash = seedAgentGame(rig);
      putRaw(rig, gameStateKey(groupHash, GAME), '{');

      expectStatus(await getExport(rig.api, groupHash, GAME, ALICE.bearer), 500);
      const door = await postDoor(rig, toolsCall('export', { handle: inviteHandle() }), accessToken(rig, BOB.sub));
      expect(toolJson(door)).toEqual({ stop: true, reason: 'not-started' });
    });
  });
});

describe('The export tool at the door (D3)', () => {
  it('tools/list offers export with a required handle', async () => {
    await withRig(async (rig) => {
      const result = await postDoor(rig, { jsonrpc: '2.0', id: 3, method: 'tools/list' }, accessToken(rig, BOB.sub));
      const rpc = jsonOf(result) as { result: { tools: { name: string; inputSchema: { required: string[] } }[] } };
      const tool = rpc.result.tools.find((entry) => entry.name === 'export');
      expect(tool?.inputSchema.required).toEqual(['handle']);
    });
  });

  it('A result is not an error', async () => {
    await withRig(async (rig) => {
      seedAgentGame(rig);
      const door = await postDoor(rig, toolsCall('export', { handle: inviteHandle() }), accessToken(rig, BOB.sub));
      expect(toolContent(door)?.isError).toBe(false);
      expect(toolJson(door)?.['format']).toBe('conquarrow-online-export');
    });
  });

  it('An agent at seat 0 exports; open, number-less and unseated invites stop', async () => {
    await withRig(async (rig) => {
      seedAgentGame(rig, { seats: [agent(B()), human(A()), heuristicSeat()] });
      const call = (): ReturnType<typeof postDoor> =>
        postDoor(rig, toolsCall('export', { handle: inviteHandle() }), accessToken(rig, BOB.sub));
      expect(toolJson(await call())?.['format']).toBe('conquarrow-online-export');

      seedInvite(rig, TOKEN, openInvite([agent(B()), human(A()), heuristicSeat()], A()));
      expect(toolJson(await call())).toEqual({ stop: true, reason: 'not-started' });

      seedInvite(rig, TOKEN, openInvite([agent(B()), human(A()), heuristicSeat()], A(), 'started'));
      expect(toolJson(await call())).toEqual({ stop: true, reason: 'not-started' });

      seedInvite(rig, TOKEN, openInvite([agent(), human(A()), heuristicSeat()], A(), 'started', GAME));
      expect(toolJson(await call())).toEqual({ stop: true, reason: 'not-seated' });
    });
  });

  it('A started invite whose meta is gone says deleted; join on a deleted invite is refused', async () => {
    await withRig(async (rig) => {
      const groupHash = seedAgentGame(rig);
      rig.data.delete(gameMetaKey(groupHash, GAME));
      const exported = await postDoor(rig, toolsCall('export', { handle: inviteHandle() }), accessToken(rig, BOB.sub));
      expect(toolJson(exported)).toEqual({ stop: true, reason: 'deleted' });

      seedInvite(rig, TOKEN, openInvite([human(A()), agent(), heuristicSeat()], A(), 'deleted', GAME));
      const joined = await postDoor(rig, toolsCall('join', { handle: inviteHandle() }), accessToken(rig, BOB.sub));
      expect(toolJson(joined)).toEqual({ error: 'deleted' });
      expect(toolContent(joined)?.isError).toBe(true);
    });
  });
});

describe('GET game names the game and its owner (D4, D6)', () => {
  it('The owner reads owner: true, a member owner: false, and the name', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    s3.set(gameMetaKey(groupHash, GAME_ONE), JSON.stringify({ ...metaOf(s3, groupHash, GAME_ONE), name: 'N' }));

    const alice = bodyOf(await getGame(api, groupHash, GAME_ONE, ALICE.bearer));
    const bob = bodyOf(await getGame(api, groupHash, GAME_ONE, BOB.bearer));

    expect([alice['owner'], alice['name']]).toEqual([true, 'N']);
    expect([bob['owner'], bob['name']]).toEqual([false, 'N']);
  });

  it.each([[''], [5]])('A stored name of %j is no name', async (name) => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    s3.set(gameMetaKey(groupHash, GAME_ONE), JSON.stringify({ ...metaOf(s3, groupHash, GAME_ONE), name }));

    expect(bodyOf(await getGame(api, groupHash, GAME_ONE, ALICE.bearer))).not.toHaveProperty('name');
  });
});

describe('Delete cleans up exactly (D5)', () => {
  it("Every bound user's lobby pointer for the invite goes", async () => {
    const { api, s3 } = makeHarness();
    const token = await startAliceBob(api);
    const pointers = [lobbyKey(A(), token), lobbyKey(B(), token)];
    expect(pointers.map((key) => s3.has(key))).toEqual([true, true]);

    expectStatus(await postDelete(api, aliceBobGroupHash(), GAME_ONE, ALICE.bearer), 200);

    expect(pointers.map((key) => s3.has(key))).toEqual([false, false]);
    expect(JSON.parse(s3.get(inviteKey(token)) ?? '{}')).toMatchObject({ status: 'deleted' });
  });

  it('An owner on the meta whose invite is gone still deletes', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    plantLibraryGame(s3, {
      groupHash,
      gameNumber: GAME,
      seats: [human(A()), human(B()), heuristicSeat()],
      players: PLAYERS,
      members: [A(), B()],
      activePlayer: P0,
      ownerUserHash: A(),
    });
    s3.set(gameMetaKey(groupHash, GAME), JSON.stringify({ ...metaOf(s3, groupHash, GAME), inviteToken: 'ab'.repeat(32) }));

    expectStatus(await postDelete(api, groupHash, GAME, ALICE.bearer), 200);
  });

  it('A group left with only a stray object counts as empty', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    s3.set(`conquarrow/groups/${groupHash}/games/000009/log.jsonl`, '');

    expectStatus(await postDelete(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    expect(s3.has(userGroupKey(A(), groupHash))).toBe(false);
  });

  it('A missing or unreadable body is refused, not a crash', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const raw = (action: 'delete' | 'name' | 'hide', body?: string) =>
      api.handle({
        method: 'POST',
        path: `/games/${groupHash}/${GAME_ONE}/${action}`,
        headers: { authorization: `Bearer ${ALICE.bearer}` },
        ...(body === undefined ? {} : { body }),
      });

    for (const action of ['delete', 'name', 'hide'] as const) {
      expectStatus(await raw(action), 422);
      expectStatus(await raw(action, '{'), 422);
    }
    expectStatus(await postManage(api, 'name', groupHash, GAME_ONE, ALICE.bearer, { name: '<b>' }), 422);
  });
});

describe('Rename retries a lost write (D6)', () => {
  const racingStore = (data: Map<string, string>, losses: number): ObjectStore => {
    const inner = mapStore(data);
    let left = losses;
    return {
      ...inner,
      put: (key, body, options) => {
        if (key.endsWith('/meta.json') && options?.ifMatch !== undefined && left > 0) {
          left -= 1;
          throw new PreconditionFailed();
        }
        return inner.put(key, body, options);
      },
    };
  };

  it('One lost write is retried', async () => {
    const s3 = new Map<string, string>();
    const { api } = makeHarness({ s3, store: racingStore(s3, 1) });
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    expectStatus(await postManage(api, 'name', groupHash, GAME_ONE, ALICE.bearer, { name: 'R' }), 200);
    expect(metaOf(s3, groupHash, GAME_ONE)['name']).toBe('R');
  });

  it('Three lost writes answer 409', async () => {
    const s3 = new Map<string, string>();
    const { api } = makeHarness({ s3, store: racingStore(s3, 3) });
    await startAliceBob(api);

    expectStatus(await postManage(api, 'name', aliceBobGroupHash(), GAME_ONE, ALICE.bearer, { name: 'R' }), 409);
  });
});

describe('Hide reads the position when the meta has no winner (D9)', () => {
  const unstamped = (s3: Map<string, string>, winner: boolean): string => {
    const groupHash = aliceBobGroupHash();
    s3.set(gameMetaKey(groupHash, GAME), JSON.stringify({ seats: [human(A()), human(B()), heuristicSeat()] }));
    s3.set(userGroupKey(B(), groupHash), '{}');
    const game = openingMatch(3);
    if (winner) s3.set(gameStateKey(groupHash, GAME), persistEnvelope(3, { ...game, winner: game.players[0] }));
    return groupHash;
  };

  it('A won position allows it', async () => {
    const { api, s3 } = makeHarness();
    expectStatus(await postManage(api, 'hide', unstamped(s3, true), GAME, BOB.bearer, { hidden: true }), 200);
  });

  it('No position refuses it', async () => {
    const { api, s3 } = makeHarness();
    expectStatus(await postManage(api, 'hide', unstamped(s3, false), GAME, BOB.bearer, { hidden: true }), 409);
  });
});

describe('Listing fields and order (D7, D8)', () => {
  const seats = (): ReturnType<typeof human>[] => [human(A()), human(B()), heuristicSeat()];

  it('A row with no activity sorts after rows with some, either way round', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    const base = { groupHash, seats: seats(), players: PLAYERS, members: [A(), B()], activePlayer: P1 };
    plantLibraryGame(s3, { ...base, gameNumber: '000001', lastActivityAt: iso(2000) });
    plantLibraryGame(s3, { ...base, gameNumber: '000002' });
    plantLibraryGame(s3, { ...base, gameNumber: '000003', startedAt: iso(1000) });

    const res = await getMyGames(api, ALICE.bearer);

    expect(rowKeys(res)).toEqual(['000001', '000003', '000002'].map((n) => `${groupHash}/${n}`));
  });

  it('activeSeat 0 is listed; an unseated active player or winner is not', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    const base = { groupHash, seats: seats(), players: PLAYERS, members: [A(), B()] };
    plantLibraryGame(s3, { ...base, gameNumber: '000001', activePlayer: P0 });
    plantLibraryGame(s3, { ...base, gameNumber: '000002', activePlayer: 'Z' });
    plantLibraryGame(s3, { ...base, gameNumber: '000003', activePlayer: P0, winner: 'Z' });

    const rows = rowsOf(await getMyGames(api, ALICE.bearer));
    const row = (n: string): Record<string, unknown> | undefined => rows.find((r) => r['gameNumber'] === n);

    expect(row('000001')?.['activeSeat']).toBe(0);
    expect(row('000002')).not.toHaveProperty('activeSeat');
    expect(row('000003')).not.toHaveProperty('winner');
  });

  it.each([
    [-1, undefined],
    [1.5, undefined],
    ['3', undefined],
    [0, 0],
  ])('A stored turns of %j lists as %j', async (turns, listed) => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    plantLibraryGame(s3, { groupHash, gameNumber: GAME, seats: seats(), players: PLAYERS, members: [A(), B()], activePlayer: P1 });
    s3.set(gameMetaKey(groupHash, GAME), JSON.stringify({ ...metaOf(s3, groupHash, GAME), turns }));

    expect(rowsOf(await getMyGames(api, ALICE.bearer))[0]?.['turns']).toBe(listed);
  });

  it('A meta with no summary and no position lists as waiting', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    s3.set(gameMetaKey(groupHash, GAME), JSON.stringify({ seats: seats() }));
    s3.set(userGroupKey(A(), groupHash), '{}');

    expect(rowsOf(await getMyGames(api, ALICE.bearer))[0]).toMatchObject({ status: 'waiting', section: 'waiting' });
  });

  it.each([
    [{ section: 'finished' }, 200],
    [{ section: 'finished', limit: '1' }, 200],
    [{ section: 'finished', limit: '50' }, 200],
    [{ section: 'finished', offset: '0' }, 200],
    [{ offset: '0' }, 422],
    [{ limit: '5' }, 422],
    [{ section: 'finished', offset: '1x' }, 422],
    [{ section: 'finished', offset: 'x1' }, 422],
  ])('Listing query %j answers %i', async (query, status) => {
    const { api } = makeHarness();

    const res = await getMyGamesWith(api, ALICE.bearer, query);

    expectStatus(res, status);
    if (status === 200) expect(bodyOf(res)).toMatchObject({ section: 'finished', total: 0 });
  });
});

describe('Routes (D5, D6, D9)', () => {
  it.each([`/x/games/g/${GAME}/delete`, `/games/g/${GAME}/delete/x`])('%s is not a route', async (path) => {
    const { api } = makeHarness();
    const res = await api.handle({ method: 'POST', path, headers: { authorization: `Bearer ${ALICE.bearer}` }, body: '{}' });
    expectStatus(res, 404);
  });

  it('A management call is logged by its action', async () => {
    const log: string[] = [];
    const { api } = makeHarness({ log: (line) => log.push(line) });

    await postDelete(api, aliceBobGroupHash(), GAME_TWO, ALICE.bearer, DELETE_CONFIRM);

    expect(log.some((line) => line.includes('"POST delete"'))).toBe(true);
  });
});
