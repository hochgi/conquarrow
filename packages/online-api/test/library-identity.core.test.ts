/**
 * docs/spec/online-library-identity/online-library-identity.core.feature — API scenarios.
 *
 * @see docs/spec/online-library-identity/online-library-identity.md
 */

import { describe, expect, it } from 'vitest';
import { libraryVsLine } from '@conquarrow/contracts';
import {
  GAAA,
  GBBB,
  aliceBobHeuristicSeats,
  aliceCarolHeuristicSeats,
  asLibrarySeats,
  gameMetaRecord,
  libraryRowOf,
  plantStampedGame,
  plantUserProfile,
  threeSeatWaitingSummary,
} from './game-library.support';
import {
  ALICE,
  BOB,
  GAME_ONE,
  aliceBobGroupHash,
  aliceHash,
  bobHash,
  carolHash,
  expectStatus,
  getMyGames,
  libraryGamesOf,
  makeHarness,
  parseBody,
  startAliceBob,
} from './support';

const STARTED_AT = '2026-08-27T09:10:00.000Z';

const listedGames = async (
  api: ReturnType<typeof makeHarness>['api'],
  bearer: string,
) => libraryGamesOf(parseBody(expectStatus(await getMyGames(api, bearer), 200))).games;

describe('Opponents distinguish groups', () => {
  it('Two groups both numbered 000001 differ on the vs-line', async () => {
    const { api, s3 } = makeHarness();
    plantStampedGame(s3, {
      userHash: aliceHash(),
      groupHash: GAAA,
      gameNumber: GAME_ONE,
      seats: aliceBobHeuristicSeats(),
      summary: threeSeatWaitingSummary(),
    });
    plantStampedGame(s3, {
      userHash: aliceHash(),
      groupHash: GBBB,
      gameNumber: GAME_ONE,
      seats: aliceCarolHeuristicSeats(),
      summary: threeSeatWaitingSummary(),
    });
    plantUserProfile(s3, bobHash(), 'Shalev');
    plantUserProfile(s3, carolHash(), 'Dana');

    const games = await listedGames(api, ALICE.bearer);
    expect(games).toHaveLength(2);
    expect(games.map((row) => row.gameNumber)).toEqual([GAME_ONE, GAME_ONE]);
    const lines = games
      .map((row) => libraryVsLine(asLibrarySeats(row.seats)))
      .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    expect(lines).toEqual(['Dana · AI', 'Shalev · AI']);
  });

  it('Unnamed humans use Player letters', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);

    const row = libraryRowOf(await listedGames(api, ALICE.bearer), aliceBobGroupHash());
    const seats = asLibrarySeats(row.seats);
    expect(seats).toEqual([
      { kind: 'human', label: 'Player A', you: true },
      { kind: 'human', label: 'Player B', you: false },
      { kind: 'heuristic', label: 'AI', you: false },
    ]);
    expect(libraryVsLine(seats)).toBe('Player B · AI');
  });

  it('Profile name labels the other human', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    plantUserProfile(s3, bobHash(), 'Shalev');

    const row = libraryRowOf(await listedGames(api, ALICE.bearer), aliceBobGroupHash());
    expect(libraryVsLine(asLibrarySeats(row.seats))).toBe('Shalev · AI');
  });
});

describe('Colour and time', () => {
  it("Caller's seatIndex is their chair", async () => {
    const { api } = makeHarness();
    await startAliceBob(api);

    const row = libraryRowOf(await listedGames(api, BOB.bearer), aliceBobGroupHash());
    expect(row.seatIndex).toBe(1);
  });

  it('Start stamps startedAt onto game meta', async () => {
    const { api, s3 } = makeHarness({ clock: () => Date.parse(STARTED_AT) });
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    expect(gameMetaRecord(s3, groupHash, GAME_ONE)['startedAt']).toBe(STARTED_AT);

    const row = libraryRowOf(await listedGames(api, ALICE.bearer), groupHash);
    expect(row.startedAt).toBe(STARTED_AT);
  });
});
