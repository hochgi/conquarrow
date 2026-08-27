/**
 * docs/spec/online-game-library/online-game-library.edge-cases.feature — API scenarios.
 *
 * @see docs/spec/online-game-library/online-game-library.md
 */

import { describe, expect, it } from 'vitest';
import type { LibrarySummary } from '@conquarrow/contracts';
import {
  ALICE,
  BOB,
  CAROL,
  GAME_ONE,
  GAME_TWO,
  aliceBobGroupHash,
  aliceHash,
  bobHash,
  carolHash,
  createOpenInvite,
  expectNoSubLeak,
  expectStatus,
  getMyGames,
  libraryGamesOf,
  makeHarness,
  openingMatch,
  parseBody,
  seedOpeningState,
  startAliceBob,
} from './support';
import {
  GAAA,
  GBBB,
  aliceBobHeuristicSeats,
  cloneS3,
  expectS3Unchanged,
  libraryRowOf,
  plantStampedGame,
  stampLibrarySummary,
  withoutTerritoryOf,
  writeStateEnvelope,
} from './game-library.support';

const listedStatus = async (
  api: ReturnType<typeof makeHarness>['api'],
  bearer: string,
  groupHash: string,
  gameNumber = GAME_ONE,
): Promise<string | undefined> => {
  const lib = libraryGamesOf(parseBody(expectStatus(await getMyGames(api, bearer), 200)));
  return libraryRowOf(lib.games, groupHash, gameNumber).status;
};

describe('Elimination and unwon terminals', () => {
  it('Eliminated seat while the match continues is lost', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const opening = openingMatch(3);
    const alicePlayer = opening.players[0];
    const bobPlayer = opening.players[1];
    if (alicePlayer === undefined || bobPlayer === undefined) {
      throw new Error('setup: expected three seats');
    }
    const state = { ...withoutTerritoryOf(opening, bobPlayer), activePlayer: alicePlayer };
    writeStateEnvelope(s3, groupHash, GAME_ONE, state);
    stampLibrarySummary(s3, groupHash, GAME_ONE, state);

    expect(await listedStatus(api, BOB.bearer, groupHash)).toBe('lost');
    expect(await listedStatus(api, ALICE.bearer, groupHash)).toBe('your-turn');
  });

  it('Terminal unwon board reports lost for a lost caller', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const opening = openingMatch(3);
    const alicePlayer = opening.players[0];
    const bobPlayer = opening.players[1];
    if (alicePlayer === undefined || bobPlayer === undefined) {
      throw new Error('setup: expected three seats');
    }
    const state = withoutTerritoryOf(withoutTerritoryOf(opening, alicePlayer), bobPlayer);
    writeStateEnvelope(s3, groupHash, GAME_ONE, state);
    stampLibrarySummary(s3, groupHash, GAME_ONE, state);

    const status = await listedStatus(api, ALICE.bearer, groupHash);
    expect(status).toBe('lost');
    expect(status).not.toBe('waiting');
  });

  it('Lost beats your-turn when the vanished seat is still named active', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const opening = openingMatch(3);
    const alicePlayer = opening.players[0];
    if (alicePlayer === undefined) throw new Error('setup: expected Alice seat');
    const state = { ...withoutTerritoryOf(opening, alicePlayer), activePlayer: alicePlayer };
    writeStateEnvelope(s3, groupHash, GAME_ONE, state);
    stampLibrarySummary(s3, groupHash, GAME_ONE, state);

    const status = await listedStatus(api, ALICE.bearer, groupHash);
    expect(status).toBe('lost');
    expect(status).not.toBe('your-turn');
  });
});

describe('Legacy meta and listing cost', () => {
  it('Unstamped meta classifies from state.json', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    seedOpeningState(s3, groupHash, GAME_ONE, 3);
    const before = cloneS3(s3);

    expect(await listedStatus(api, ALICE.bearer, groupHash)).toBe('your-turn');
    expectS3Unchanged(before, s3);
  });

  it('GET /my-games does not write S3', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    stampLibrarySummary(s3, groupHash, GAME_ONE, openingMatch(3));
    const before = cloneS3(s3);

    const res = await getMyGames(api, ALICE.bearer);

    expectStatus(res, 200);
    expectS3Unchanged(before, s3);
  });
});

describe('Sort and membership', () => {
  it('Rows sort by status then group then newest game number', async () => {
    const { api, s3 } = makeHarness();
    const seats = aliceBobHeuristicSeats();
    const players = ['A', 'B', 'C'] as const;
    const plant = (
      groupHash: string,
      gameNumber: string,
      summary: LibrarySummary,
    ): void => {
      plantStampedGame(s3, {
        userHash: aliceHash(),
        groupHash,
        gameNumber,
        seats,
        summary,
      });
    };
    plant(GBBB, GAME_ONE, {
      players,
      activePlayer: 'A',
      lostPlayers: [],
    });
    plant(GBBB, GAME_TWO, {
      players,
      activePlayer: 'B',
      lostPlayers: [],
    });
    plant(GAAA, GAME_ONE, {
      players,
      activePlayer: 'A',
      lostPlayers: [],
      winner: 'A',
    });
    plant(GAAA, GAME_TWO, {
      players,
      activePlayer: 'A',
      lostPlayers: [],
      winner: 'B',
    });

    const lib = libraryGamesOf(parseBody(expectStatus(await getMyGames(api, ALICE.bearer), 200)));
    expect(lib.games.map((row) => `${row.groupHash}/${row.gameNumber}`)).toEqual([
      `${GBBB}/${GAME_ONE}`,
      `${GBBB}/${GAME_TWO}`,
      `${GAAA}/${GAME_ONE}`,
      `${GAAA}/${GAME_TWO}`,
    ]);
  });

  it('Open lobby tokens stay on lobbies not as game statuses', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const token = await createOpenInvite(api, ALICE);
    const groupHash = aliceBobGroupHash();

    const lib = libraryGamesOf(parseBody(expectStatus(await getMyGames(api, ALICE.bearer), 200)));
    expect(lib.lobbies).toContain(token);
    const started = libraryRowOf(lib.games, groupHash, GAME_ONE);
    expect(started.status).toBeDefined();
    expect(['your-turn', 'waiting', 'won', 'lost']).toContain(started.status);
    expect(lib.games.some((row) => row.gameNumber === token)).toBe(false);
  });

  it("Other user's games are omitted", async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    const res = expectStatus(await getMyGames(api, CAROL.bearer), 200);
    const lib = libraryGamesOf(parseBody(res));
    expect(lib.games.some((row) => row.groupHash === groupHash)).toBe(false);
    expectNoSubLeak(res, ALICE.sub);
    expectNoSubLeak(res, BOB.sub);
    expectNoSubLeak(res, CAROL.sub);
  });

  it('Missing bearer is 401', async () => {
    const { api } = makeHarness();
    expectStatus(await getMyGames(api), 401);
  });
});

describe('Active heuristic and missing chair', () => {
  it('Heuristic to move is waiting for every human', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const opening = openingMatch(3);
    const heuristic = opening.players[2];
    if (heuristic === undefined) throw new Error('setup: expected heuristic seat');
    const state = { ...opening, activePlayer: heuristic };
    writeStateEnvelope(s3, groupHash, GAME_ONE, state);
    stampLibrarySummary(s3, groupHash, GAME_ONE, state);

    expect(await listedStatus(api, ALICE.bearer, groupHash)).toBe('waiting');
    expect(await listedStatus(api, BOB.bearer, groupHash)).toBe('waiting');
  });

  it('Caller with no chair on the game is waiting', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = 'c'.repeat(32);
    plantStampedGame(s3, {
      userHash: aliceHash(),
      groupHash,
      gameNumber: GAME_ONE,
      seats: [
        { kind: 'human', userHash: bobHash() },
        { kind: 'human', userHash: carolHash() },
        { kind: 'heuristic' },
      ],
      summary: {
        players: ['A', 'B', 'C'],
        activePlayer: 'A',
        lostPlayers: [],
      },
    });

    expect(await listedStatus(api, ALICE.bearer, groupHash)).toBe('waiting');
  });
});
