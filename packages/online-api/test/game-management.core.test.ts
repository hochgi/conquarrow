/**
 * docs/spec/game-management/game-management.server.core.feature — one test per scenario.
 *
 * @see docs/spec/game-management/game-management.md
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_CONFIG, endTurn, type GameState, type Move } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { replay } from '@conquarrow/rules-core';
import {
  ALICE,
  ALICE_CONN,
  BOB,
  BOB_CONN,
  GAME_ONE,
  TWO_HUMAN_HEURISTIC,
  aliceBobGroupHash,
  aliceHash,
  bobHash,
  expectStatus,
  firstLegalStep,
  gameLogKey,
  getGame,
  getMyGames,
  groupHashOfUserHashes,
  makeHarness,
  notifiesTo,
  openingMatch,
  parseBody,
  persistEnvelope,
  postAccept,
  postInvites,
  postMove,
  postStart,
  startAliceBob,
  stateOfBody,
  wsConnect,
} from './support';
import {
  TOKEN,
  accessToken,
  agent,
  atSeat,
  heuristicSeat,
  human,
  inviteHandle,
  opening,
  postDoor,
  putRaw,
  rules,
  seedProfile,
  seedStarted,
  toolJson,
  toolsCall,
  withRig,
  type RemoteRig,
} from './remote-agent-mcp.support';
import { bodyOf } from './online-reliability.support';
import {
  DELETE_CONFIRM,
  countsOf,
  createNamedInvite,
  gameNumbers,
  gamePrefix,
  getExport,
  getMyGamesWith,
  iso,
  keysUnder,
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

const libraryChanges = (
  notifies: readonly { readonly connectionId: string; readonly payload: unknown }[],
  connectionId: string,
): readonly unknown[] =>
  notifiesTo(notifies as Parameters<typeof notifiesTo>[0], connectionId)
    .map((row) => row.payload as unknown as Record<string, unknown>)
    .filter((payload) => payload['type'] === 'libraryChanged');

/** Alice and Bob (humans) and a heuristic; three versions played. */
const playedThree = async (): Promise<ReturnType<typeof makeHarness> & { groupHash: string }> => {
  const harness = makeHarness();
  await startAliceBob(harness.api);
  const groupHash = aliceBobGroupHash();
  const opened = await getGame(harness.api, groupHash, GAME_ONE, ALICE.bearer);
  expectStatus(opened, 200);
  const step = firstLegalStep(openingMatch(3));
  expectStatus(await postMove(harness.api, groupHash, GAME_ONE, ALICE.bearer, step, 0), 200);
  expectStatus(await postMove(harness.api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 1), 200);
  expectStatus(await postMove(harness.api, groupHash, GAME_ONE, BOB.bearer, endTurn(), 2), 200);
  return { ...harness, groupHash };
};

const logMoves = (raw: string | undefined): readonly unknown[] =>
  (raw ?? '')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { move?: unknown })
    .filter((line) => line.move !== undefined)
    .map((line) => line.move);

const agentSeed = (rig: RemoteRig, state: GameState, log?: string): string => {
  const groupHash = groupHashOfUserHashes([A()]);
  seedStarted(rig, {
    token: TOKEN,
    groupHash,
    gameNumber: GAME,
    seats: [human(A()), agent(B()), heuristicSeat()],
    state,
    version: 2,
    members: [A(), B()],
    ...(log === undefined ? {} : { log }),
  });
  return groupHash;
};

const replyLog = (seatOfReply: string): string =>
  [
    JSON.stringify({ v: 1, move: endTurn() }),
    JSON.stringify({
      v: 2,
      agentReply: { seat: seatOfReply, moves: [], endTurn: true, plan: 'take the centre' },
    }),
    JSON.stringify({ v: 2, move: endTurn() }),
    '',
  ].join('\n');

const replyEntries = (body: Record<string, unknown>): readonly Record<string, unknown>[] => {
  const log = body['log'];
  if (!Array.isArray(log)) throw new Error('expected export.log');
  return log
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => entry['agentReply'] !== undefined);
};

describe('A member exports the server\'s whole log (D1)', () => {
  it('The export holds every move and replays to the served state', async () => {
    const { api, s3, groupHash } = await playedThree();

    const res = await getExport(api, groupHash, GAME_ONE, ALICE.bearer);

    expectStatus(res, 200);
    const body = bodyOf(res);
    expect(body['format']).toBe('conquarrow-online-export');
    expect(body['moves']).toEqual(logMoves(s3.get(gameLogKey(groupHash, GAME_ONE))));
    const config = body['config'] as typeof DEFAULT_MATCH_CONFIG;
    expect(config).toEqual({ ...DEFAULT_MATCH_CONFIG, playerCount: 3 });
    const replayed = replay(rules, makeMatch(config), body['moves'] as readonly Move[]);
    const served = await getGame(api, groupHash, GAME_ONE, ALICE.bearer);
    expect((JSON.parse(persistEnvelope(0, replayed)) as { state: unknown }).state).toEqual(
      stateOfBody(parseBody(served)),
    );
    for (const local of ['vsBot', 'botMode', 'humanSeat', 'botSeat']) {
      expect(body).not.toHaveProperty(local);
    }
  });

  it('The export names every seat by kind, name and owner', async () => {
    await withRig(async (rig) => {
      const groupHash = agentSeed(rig, atSeat(opening(3), 0));
      seedProfile(rig, A(), 'Alice');
      seedProfile(rig, B(), 'Bob');

      const res = await getExport(rig.api, groupHash, GAME, ALICE.bearer);

      expectStatus(res, 200);
      const seats = bodyOf(res)['seats'] as readonly Record<string, unknown>[];
      expect(seats[0]).toMatchObject({ seat: 0, kind: 'human', name: 'Alice' });
      expect(seats[1]).toMatchObject({ seat: 1, kind: 'agent', name: 'Agent', owner: 'Bob' });
      expect(seats[2]).toMatchObject({ seat: 2, kind: 'heuristic', name: 'AI' });
      expect(res.body).not.toContain(A());
      expect(res.body).not.toContain(B());
    });
  });
});

describe('Rival agent replies wait for the end of the game (D2)', () => {
  it("Mid-game, another seat's reply records are withheld", async () => {
    await withRig(async (rig) => {
      const groupHash = agentSeed(rig, atSeat(opening(3), 0), replyLog(P1));

      const res = await getExport(rig.api, groupHash, GAME, ALICE.bearer);

      expectStatus(res, 200);
      expect(replyEntries(bodyOf(res))).toEqual([]);
      expect(bodyOf(res)['withheldReplies']).toBe(1);
    });
  });

  it('After the game is won, every reply record is exported', async () => {
    await withRig(async (rig) => {
      const base = atSeat(opening(3), 1);
      const groupHash = agentSeed(rig, { ...base, winner: base.players[0] }, replyLog(P1));

      const res = await getExport(rig.api, groupHash, GAME, ALICE.bearer);

      expectStatus(res, 200);
      const replies = replyEntries(bodyOf(res));
      expect(replies).toHaveLength(1);
      // P107 D6: the seat is the entry's, lifted from a pre-P107 record.
      expect(replies[0]).toMatchObject({ seat: P1, agentReply: { plan: 'take the centre' } });
      expect(bodyOf(res)['withheldReplies']).toBe(0);
    });
  });
});

describe('The agent door exports the same record (D3)', () => {
  it('The MCP export equals the browser export of the same user', async () => {
    await withRig(async (rig) => {
      const groupHash = agentSeed(rig, atSeat(opening(3), 0), replyLog(P1));

      const mcp = toolJson(
        await postDoor(rig, toolsCall('export', { handle: inviteHandle() }), accessToken(rig, BOB.sub)),
      );
      const browser = bodyOf(await getExport(rig.api, groupHash, GAME, BOB.bearer));

      expect(mcp).toBeDefined();
      const { exportedAt: _m, ...mcpRest } = mcp ?? {};
      const { exportedAt: _b, ...browserRest } = browser;
      expect(mcpRest).toEqual(browserRest);
      expect(mcpRest['withheldReplies']).toBe(0);
    });
  });

  it("observe carries the game's name", async () => {
    await withRig(async (rig) => {
      const groupHash = agentSeed(rig, atSeat(opening(3), 1));
      const meta = metaOf(rig.data, groupHash, GAME);
      putRaw(rig, gameMetaKey(groupHash, GAME), JSON.stringify({ ...meta, name: 'Friday rematch' }));

      const result = await postDoor(
        rig,
        toolsCall('observe', { handle: inviteHandle() }),
        accessToken(rig, BOB.sub),
      );

      expect(toolJson(result)?.['name']).toBe('Friday rematch');
    });
  });
});

describe('The owner may delete a game, and only with the exact confirm (D4, D5)', () => {
  it('The owner deletes a game', async () => {
    const { api, ws, s3, notifies } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    await wsConnect(ws, ALICE_CONN, ALICE.bearer);
    await wsConnect(ws, BOB_CONN, BOB.bearer);

    const res = await postDelete(api, groupHash, GAME_ONE, ALICE.bearer, DELETE_CONFIRM);

    expectStatus(res, 200);
    expect(bodyOf(res)).toEqual({ deleted: true });
    expect(keysUnder(s3, gamePrefix(groupHash, GAME_ONE))).toEqual([]);
    for (const conn of [ALICE_CONN, BOB_CONN]) {
      expect(libraryChanges(notifies, conn)).toEqual([
        { type: 'libraryChanged', groupHash, gameNumber: GAME_ONE, change: 'deleted' },
      ]);
    }
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 404);
  });

  it('A member who is not the owner cannot delete', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const before = [...s3.entries()];

    const res = await postDelete(api, groupHash, GAME_ONE, BOB.bearer);

    expectStatus(res, 403);
    expect([...s3.entries()]).toEqual(before);
  });

  it('A delete without the exact confirm is refused', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const before = [...s3.entries()];

    const res = await postDelete(api, groupHash, GAME_ONE, ALICE.bearer, 'yes');

    expectStatus(res, 422);
    expect([...s3.entries()]).toEqual(before);
  });

  it("A deleted game's invite and agent door say it was deleted", async () => {
    await withRig(async (rig) => {
      const groupHash = agentSeed(rig, atSeat(opening(3), 1));
      expectStatus(await postDelete(rig.api, groupHash, GAME, ALICE.bearer), 200);

      const invite = await rig.api.handle({ method: 'GET', path: `/invites/${TOKEN}` });
      const observed = await postDoor(
        rig,
        toolsCall('observe', { handle: inviteHandle() }),
        accessToken(rig, BOB.sub),
      );

      expectStatus(invite, 410);
      expect(bodyOf(invite)['reason']).toBe('deleted');
      expect(toolJson(observed)).toMatchObject({ stop: true, reason: 'deleted' });
    });
  });
});

describe('Games have names (D6)', () => {
  it('A name given at creation reaches the game', async () => {
    const { api } = makeHarness();
    const token = await createNamedInvite(api, ALICE, TWO_HUMAN_HEURISTIC, '  Friday   rematch ');
    expectStatus(await postAccept(api, token, BOB.bearer), 200);
    expectStatus(await postStart(api, token, ALICE.bearer), 200);
    const groupHash = aliceBobGroupHash();

    const game = await getGame(api, groupHash, GAME_ONE, ALICE.bearer);
    const library = await getMyGames(api, ALICE.bearer);

    expect(bodyOf(game)['name']).toBe('Friday rematch');
    expect(rowsOf(library)[0]?.['name']).toBe('Friday rematch');
  });

  it('The owner renames a game and the members are told', async () => {
    const { api, ws, notifies } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    await wsConnect(ws, BOB_CONN, BOB.bearer);

    const res = await postManage(api, 'name', groupHash, GAME_ONE, ALICE.bearer, { name: 'Final' });

    expectStatus(res, 200);
    expect(bodyOf(res)).toEqual({ name: 'Final' });
    expect(libraryChanges(notifies, BOB_CONN)).toEqual([
      { type: 'libraryChanged', groupHash, gameNumber: GAME_ONE, change: 'renamed' },
    ]);
    expect(rowsOf(await getMyGames(api, BOB.bearer))[0]?.['name']).toBe('Final');
  });

  it('An invalid name is refused', async () => {
    const { api, s3 } = makeHarness();

    const res = await postInvites(api, ALICE.bearer, { seats: TWO_HUMAN_HEURISTIC, name: 'x'.repeat(49) });

    expectStatus(res, 422);
    expect([...s3.keys()].filter((key) => key.includes('/invites/'))).toEqual([]);
  });
});

describe('The library lists games by section and activity (D7, D8)', () => {
  it('A persisted version stamps last activity and turns', async () => {
    let now = 1000;
    const { api, s3 } = makeHarness({ clock: () => now });
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    now = 5000;

    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 200);

    const meta = metaOf(s3, groupHash, GAME_ONE);
    expect(meta['lastActivityAt']).toBe(iso(5000));
    expect(meta['turns']).toBe(1);
  });

  it('Rows are listed by section, then by last activity', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    const seats = [human(A()), human(B()), heuristicSeat()];
    const base = { groupHash, seats, players: PLAYERS, members: [A(), B()] };
    const [g1, g2, g3, g4] = gameNumbers(4);
    plantLibraryGame(s3, { ...base, gameNumber: g1 ?? '', activePlayer: P1, winner: P1, lastActivityAt: iso(9000) });
    plantLibraryGame(s3, { ...base, gameNumber: g2 ?? '', activePlayer: P0, lastActivityAt: iso(1000) });
    plantLibraryGame(s3, { ...base, gameNumber: g3 ?? '', activePlayer: P1, lastActivityAt: iso(2000) });
    plantLibraryGame(s3, { ...base, gameNumber: g4 ?? '', activePlayer: P1, lastActivityAt: iso(3000) });

    const res = await getMyGames(api, ALICE.bearer);

    expectStatus(res, 200);
    expect(rowKeys(res)).toEqual([g2, g4, g3, g1].map((n) => `${groupHash}/${String(n)}`));
    expect(rowsOf(res).map((row) => row['section'])).toEqual([
      'your-turn',
      'waiting',
      'waiting',
      'finished',
    ]);
    expect(countsOf(res)).toEqual({ 'your-turn': 1, waiting: 2, finished: 1, hidden: 0 });
  });

  it('Finished rows are paged', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    const seats = [human(A()), human(B()), heuristicSeat()];
    const numbers = gameNumbers(12);
    numbers.forEach((gameNumber, i) => {
      plantLibraryGame(s3, {
        groupHash,
        gameNumber,
        seats,
        players: PLAYERS,
        members: [A(), B()],
        activePlayer: P0,
        winner: P0,
        lastActivityAt: iso((i + 1) * 1000),
      });
    });
    const newestFirst = [...numbers].reverse().map((n) => `${groupHash}/${n}`);

    const first = await getMyGames(api, ALICE.bearer);
    expect(rowKeys(first)).toEqual(newestFirst.slice(0, 10));
    expect(countsOf(first)['finished']).toBe(12);

    const rest = await getMyGamesWith(api, ALICE.bearer, { section: 'finished', offset: '10' });
    expectStatus(rest, 200);
    expect(rowKeys(rest)).toEqual(newestFirst.slice(10));
    expect(bodyOf(rest)['total']).toBe(12);
  });
});

describe('A member may hide a finished game from their own list (D9)', () => {
  const wonGame = (s3: Map<string, string>): string => {
    const groupHash = aliceBobGroupHash();
    plantLibraryGame(s3, {
      groupHash,
      gameNumber: GAME,
      seats: [human(A()), human(B()), heuristicSeat()],
      players: PLAYERS,
      members: [A(), B()],
      activePlayer: P0,
      winner: P0,
    });
    return groupHash;
  };

  it("Hiding takes a game out of only the caller's list", async () => {
    const { api, s3 } = makeHarness();
    const groupHash = wonGame(s3);

    const res = await postManage(api, 'hide', groupHash, GAME, BOB.bearer, { hidden: true });

    expectStatus(res, 200);
    expect(bodyOf(res)).toEqual({ hidden: true });
    const bobs = await getMyGames(api, BOB.bearer);
    expect(rowKeys(bobs)).toEqual([]);
    expect(countsOf(bobs)['hidden']).toBe(1);
    expect(rowKeys(await getMyGames(api, ALICE.bearer))).toEqual([`${groupHash}/${GAME}`]);
  });

  it('A game still in play cannot be hidden', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    const res = await postManage(api, 'hide', groupHash, GAME_ONE, BOB.bearer, { hidden: true });

    expectStatus(res, 409);
    expect(bodyOf(res)['reason']).toBe('not-finished');
  });
});
