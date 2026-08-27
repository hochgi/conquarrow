/**
 * docs/spec/online-library-identity/online-library-identity.edge-cases.feature — API.
 *
 * @see docs/spec/online-library-identity/online-library-identity.md
 */

import { describe, expect, it } from 'vitest';
import {
  asLibrarySeats,
  gameMetaRecord,
  libraryRowOf,
  mergeGameMeta,
  dropGameMetaStartedAt,
  plantUserProfile,
  profileDisplayNameOf,
  userProfileKey,
} from './game-library.support';
import {
  ALICE,
  BOB,
  GAME_ONE,
  aliceBobGroupHash,
  aliceHash,
  asRecord,
  bobHash,
  expectNoSubLeak,
  expectStatus,
  getGame,
  getMyGames,
  libraryGamesOf,
  makeHarness,
  parseBody,
  startAliceBob,
} from './support';

const STARTED_AT = '2026-08-27T09:10:00.000Z';
const FORTY_X = 'x'.repeat(40);
const FORTY_ONE_X = 'x'.repeat(41);

const listedGames = async (
  api: ReturnType<typeof makeHarness>['api'],
  bearer: string,
) => libraryGamesOf(parseBody(expectStatus(await getMyGames(api, bearer), 200))).games;

describe('Privacy and fallbacks', () => {
  it('Library seats omit sub, email, and userHash', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);

    const res = expectStatus(await getMyGames(api, ALICE.bearer), 200);
    const row = libraryRowOf(libraryGamesOf(parseBody(res)).games, aliceBobGroupHash());
    expect(row.seats).toHaveLength(3);
    for (const seat of row.seats) {
      expect(seat).not.toHaveProperty('userHash');
      expect(seat).not.toHaveProperty('sub');
      expect(seat).not.toHaveProperty('email');
    }
    expectNoSubLeak(res, ALICE.sub);
    expectNoSubLeak(res, BOB.sub);
    expect(res.body).not.toContain('@');
    expect(res.body).not.toContain(aliceHash());
    expect(res.body).not.toContain(bobHash());
  });

  it('Empty display name falls back to Player letter', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    plantUserProfile(s3, bobHash(), '   ');

    const row = libraryRowOf(await listedGames(api, ALICE.bearer), aliceBobGroupHash());
    expect(asLibrarySeats(row.seats)[1]).toEqual({
      kind: 'human',
      label: 'Player B',
      you: false,
    });
  });

  it('given_name wins over name', async () => {
    const { api, s3 } = makeHarness({
      googleNames: { [ALICE.bearer]: { given_name: 'Gilad', name: 'Gilad Hoch' } },
    });

    expectStatus(await getMyGames(api, ALICE.bearer), 200);

    expect(profileDisplayNameOf(s3, aliceHash())).toBe('Gilad');
    expect([...s3.keys()]).toEqual([userProfileKey(aliceHash())]);
  });

  it('Display name longer than 40 characters is truncated', async () => {
    const { api, s3 } = makeHarness({
      googleNames: { [ALICE.bearer]: { given_name: FORTY_ONE_X } },
    });

    expectStatus(await getMyGames(api, ALICE.bearer), 200);

    expect(profileDisplayNameOf(s3, aliceHash())).toBe(FORTY_X);
  });
});

describe('Missing time and parse', () => {
  it('Pre-P46 meta omits startedAt', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    dropGameMetaStartedAt(s3, groupHash, GAME_ONE);
    expect(gameMetaRecord(s3, groupHash, GAME_ONE)).not.toHaveProperty('startedAt');

    const res = expectStatus(await getMyGames(api, ALICE.bearer), 200);
    const gamesRaw = asRecord(parseBody(res))['games'];
    expect(Array.isArray(gamesRaw)).toBe(true);
    const listed = Array.isArray(gamesRaw)
      ? gamesRaw.map((row) => asRecord(row)).find((row) => row['groupHash'] === groupHash)
      : undefined;
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('startedAt');
  });

  it('Persist of state.json keeps startedAt on meta', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    mergeGameMeta(s3, groupHash, GAME_ONE, { startedAt: STARTED_AT });

    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    expect(gameMetaRecord(s3, groupHash, GAME_ONE)['startedAt']).toBe(STARTED_AT);
  });
});
