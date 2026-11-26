/**
 * docs/spec/game-management/game-management.server.edge-cases.feature — one test per scenario.
 *
 * @see docs/spec/game-management/game-management.md
 */

import { describe, expect, it } from 'vitest';
import {
  ALICE,
  BOB,
  CAROL,
  GAME_ONE,
  GAME_TWO,
  GROUP_ABSENT,
  aliceBobGroupHash,
  aliceHash,
  bobHash,
  expectStatus,
  getGame,
  getMyGames,
  groupHashOfUserHashes,
  makeHarness,
  openingMatch,
  postStart,
  bindAliceAndBob,
  startAliceBob,
  userGroupKey,
} from './support';
import {
  TOKEN,
  agent,
  atSeat,
  heuristicSeat,
  human,
  opening,
  seedStarted,
  withRig,
  type RemoteRig,
} from './remote-agent-mcp.support';
import { bodyOf } from './online-reliability.support';
import {
  countsOf,
  getExport,
  getMyGamesWith,
  hiddenKey,
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

const agentSeed = (rig: RemoteRig, log: string): string => {
  const groupHash = groupHashOfUserHashes([A()]);
  seedStarted(rig, {
    token: TOKEN,
    groupHash,
    gameNumber: GAME,
    seats: [human(A()), agent(B()), heuristicSeat()],
    state: atSeat(opening(3), 0),
    version: 2,
    members: [A(), B()],
    log,
  });
  return groupHash;
};

const replies = (body: Record<string, unknown>): readonly unknown[] =>
  (body['log'] as readonly Record<string, unknown>[]).filter((entry) => entry['agentReply'] !== undefined);

const wonSeats = (): readonly ReturnType<typeof human>[] => [human(A()), human(B()), heuristicSeat()];

const plantWon = (s3: Map<string, string>, gameNumber = GAME): string => {
  const groupHash = aliceBobGroupHash();
  plantLibraryGame(s3, {
    groupHash,
    gameNumber,
    seats: wonSeats(),
    players: PLAYERS,
    members: [A(), B()],
    activePlayer: P0,
    winner: P0,
    ownerUserHash: A(),
  });
  return groupHash;
};

describe('Edges of the export and game management', () => {
  it('The export refuses no sign-in, a non-member and an unknown game', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    expectStatus(await getExport(api, groupHash, GAME_ONE), 401);
    expectStatus(await getExport(api, groupHash, GAME_ONE, CAROL.bearer), 403);
    expectStatus(await getExport(api, GROUP_ABSENT, GAME_ONE, ALICE.bearer), 404);
  });

  it('A reply record written before P96 has no seat and is withheld mid-game', async () => {
    await withRig(async (rig) => {
      const groupHash = agentSeed(
        rig,
        `${JSON.stringify({ v: 1, agentReply: { moves: [], endTurn: true } })}\n`,
      );

      const body = bodyOf(await getExport(rig.api, groupHash, GAME, BOB.bearer));

      expect(replies(body)).toEqual([]);
      expect(body['withheldReplies']).toBe(1);
    });
  });

  it("The caller's own agent replies are exported mid-game", async () => {
    await withRig(async (rig) => {
      const reply = { seat: P1, moves: [], endTurn: true };
      const groupHash = agentSeed(rig, `${JSON.stringify({ v: 1, agentReply: reply })}\n`);

      const body = bodyOf(await getExport(rig.api, groupHash, GAME, BOB.bearer));

      expect(replies(body)).toEqual([{ v: 1, agentReply: reply }]);
      expect(body['withheldReplies']).toBe(0);
    });
  });

  it('A game whose meta predates the owner field reads its owner from the invite', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const { ownerUserHash: _drop, ...meta } = metaOf(s3, groupHash, GAME_ONE);
    s3.set(gameMetaKey(groupHash, GAME_ONE), JSON.stringify(meta));

    expectStatus(await postDelete(api, groupHash, GAME_ONE, ALICE.bearer), 200);
  });

  it('A game with no owner on record cannot be deleted', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const { ownerUserHash: _drop, inviteToken: _token, ...meta } = metaOf(s3, groupHash, GAME_ONE);
    s3.set(gameMetaKey(groupHash, GAME_ONE), JSON.stringify(meta));

    expectStatus(await postDelete(api, groupHash, GAME_ONE, ALICE.bearer), 403);
  });

  it('A repeated delete answers 404', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    expectStatus(await postDelete(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    expectStatus(await postDelete(api, groupHash, GAME_ONE, ALICE.bearer), 404);
  });

  it('A group pointer goes only when the group has no game left', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const second = await bindAliceAndBob(api);
    expectStatus(await postStart(api, second, ALICE.bearer), 200);
    const groupHash = aliceBobGroupHash();
    const pointers = [userGroupKey(A(), groupHash), userGroupKey(B(), groupHash)];

    expectStatus(await postDelete(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    expect(pointers.map((key) => s3.has(key))).toEqual([true, true]);

    expectStatus(await postDelete(api, groupHash, GAME_TWO, ALICE.bearer), 200);
    expect(pointers.map((key) => s3.has(key))).toEqual([false, false]);
  });

  it("Delete removes every member's hidden pointer for the game", async () => {
    const { api, s3 } = makeHarness();
    const groupHash = plantWon(s3);
    expectStatus(await postManage(api, 'hide', groupHash, GAME, BOB.bearer, { hidden: true }), 200);
    expect(s3.has(hiddenKey(B(), groupHash, GAME))).toBe(true);

    expectStatus(await postDelete(api, groupHash, GAME, ALICE.bearer), 200);

    expect(s3.has(hiddenKey(B(), groupHash, GAME))).toBe(false);
  });

  it('A rename by a non-owner is refused', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    expectStatus(await postManage(api, 'name', groupHash, GAME_ONE, BOB.bearer, { name: 'Mine' }), 403);
  });

  it('An empty name clears the name', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    s3.set(gameMetaKey(groupHash, GAME_ONE), JSON.stringify({ ...metaOf(s3, groupHash, GAME_ONE), name: 'Old' }));

    const res = await postManage(api, 'name', groupHash, GAME_ONE, ALICE.bearer, { name: '' });

    expectStatus(res, 200);
    expect(bodyOf(res)).toEqual({});
    expect(bodyOf(await getGame(api, groupHash, GAME_ONE, ALICE.bearer))).not.toHaveProperty('name');
  });

  it.each([
    [{ section: 'everything' }],
    [{ section: 'finished', offset: '-1' }],
    [{ section: 'finished', limit: '0' }],
    [{ section: 'finished', limit: '51' }],
    [{ section: 'finished', offset: 'x' }],
  ])('A malformed listing query is refused: %j', async (query) => {
    const { api } = makeHarness();

    expectStatus(await getMyGamesWith(api, ALICE.bearer, query), 422);
  });

  it('Unhide puts the game back', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = plantWon(s3);
    expectStatus(await postManage(api, 'hide', groupHash, GAME, BOB.bearer, { hidden: true }), 200);

    const res = await postManage(api, 'hide', groupHash, GAME, BOB.bearer, { hidden: false });

    expectStatus(res, 200);
    const bobs = await getMyGames(api, BOB.bearer);
    expect(rowKeys(bobs)).toEqual([`${groupHash}/${GAME}`]);
    expect(countsOf(bobs)['hidden']).toBe(0);
    expect(rowsOf(await getMyGamesWith(api, BOB.bearer, { section: 'hidden' }))).toEqual([]);
  });

  it('A hide body without a boolean is refused', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = plantWon(s3);

    expectStatus(await postManage(api, 'hide', groupHash, GAME, BOB.bearer, { hidden: 'yes' }), 422);
  });

  it('Rows of meta from before P96 sort by start time and show no turn', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    const base = { groupHash, seats: wonSeats(), players: PLAYERS, members: [A(), B()], activePlayer: P1 };
    plantLibraryGame(s3, { ...base, gameNumber: GAME_ONE, startedAt: iso(5000) });
    plantLibraryGame(s3, { ...base, gameNumber: GAME_TWO, startedAt: iso(1000) });

    const res = await getMyGames(api, ALICE.bearer);

    expect(rowKeys(res)).toEqual([`${groupHash}/${GAME_ONE}`, `${groupHash}/${GAME_TWO}`]);
    expect(rowsOf(res).map((row) => row['turns'])).toEqual([undefined, undefined]);
  });
});

describe('P96 row fields', () => {
  it('A row says who owns it, who won, and whose turn it is', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = plantWon(s3);
    plantLibraryGame(s3, {
      groupHash,
      gameNumber: GAME_TWO,
      seats: wonSeats(),
      players: PLAYERS,
      members: [A(), B()],
      activePlayer: P1,
      turns: 7,
      ownerUserHash: A(),
    });

    const alices = rowsOf(await getMyGames(api, ALICE.bearer));
    const bobs = rowsOf(await getMyGames(api, BOB.bearer));

    const playing = alices.find((row) => row['gameNumber'] === GAME_TWO);
    const won = alices.find((row) => row['gameNumber'] === GAME);
    expect(playing).toMatchObject({ owner: true, hidden: false, activeSeat: 1, turns: 7, section: 'waiting' });
    // P105: the caller's own chair reads `you`, so the client says `Won by you`.
    expect(won?.['winner']).toEqual({ seat: 0, label: 'you' });
    expect(won).not.toHaveProperty('activeSeat');
    expect(bobs.every((row) => row['owner'] === false)).toBe(true);
  });

  it('A meta written at Start carries the owner', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const meta = metaOf(s3, aliceBobGroupHash(), GAME_ONE);

    expect(meta['ownerUserHash']).toBe(A());
  });

  it('The export carries the meta times and the server clock', async () => {
    let now = 2000;
    const { api } = makeHarness({ clock: () => now });
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    now = 7000;

    const body = bodyOf(await getExport(api, groupHash, GAME_ONE, ALICE.bearer));

    expect(body).toMatchObject({
      groupHash,
      gameNumber: GAME_ONE,
      startedAt: iso(2000),
      lastActivityAt: iso(2000),
      exportedAt: iso(7000),
      version: 0,
      turns: 0,
      withheldReplies: 0,
    });
    expect(body['activePlayer']).toBe(P0);
    expect(body).not.toHaveProperty('winner');
    expect(body).not.toHaveProperty('summary');
  });
});

describe('Agent reply records carry their seat (D2)', () => {
  it("A move through the agent door logs the reply with the agent's seat", async () => {
    const { accessToken, inviteHandle, postDoor, toolsCall, logRaw } = await import('./remote-agent-mcp.support');
    await withRig(async (rig) => {
      const groupHash = groupHashOfUserHashes([A()]);
      seedStarted(rig, {
        token: TOKEN,
        groupHash,
        gameNumber: GAME,
        seats: [human(A()), agent(B()), heuristicSeat()],
        state: atSeat(opening(3), 1),
        version: 2,
        members: [A(), B()],
      });

      await postDoor(
        rig,
        toolsCall('move', { handle: inviteHandle(), moves: [], endTurn: true }),
        accessToken(rig, BOB.sub),
      );

      const lines = (logRaw(rig, groupHash, GAME) ?? '')
        .split('\n')
        .filter((line) => line.includes('agentReply'))
        .map((line) => JSON.parse(line) as { agentReply: Record<string, unknown> });
      expect(lines[0]?.agentReply['seat']).toBe(P1);
    });
  });
});
