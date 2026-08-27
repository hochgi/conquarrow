/**
 * EARS invariants for docs/spec/online-library-identity/online-library-identity.md — API.
 *
 * Table-driven / small explicit cases in Vitest — this repo has no fast-check.
 */

import { describe, expect, it } from 'vitest';
import { libraryVsLine, PLAYER_SEAT_LABELS, playerLetterLabel } from '@conquarrow/contracts';
import {
  asLibrarySeats,
  dropGameMetaStartedAt,
  gameMetaRecord,
  libraryRowOf,
  plantUserProfile,
  profileDisplayNameOf,
} from './game-library.support';
import {
  ALICE,
  BOB,
  CAROL,
  GAME_ONE,
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
  parseBody,
  postAccept,
  startAliceBob,
} from './support';

const STARTED_AT = '2026-08-27T09:10:00.000Z';

const listedRow = async (
  api: ReturnType<typeof makeHarness>['api'],
  bearer: string,
  groupHash: string,
) =>
  libraryRowOf(
    libraryGamesOf(parseBody(expectStatus(await getMyGames(api, bearer), 200))).games,
    groupHash,
  );

describe('online-library-identity API invariants', () => {
  it('When GET /my-games lists a started game, the system shall include ordered seats and the caller\'s seatIndex', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    const alice = await listedRow(api, ALICE.bearer, groupHash);
    const bob = await listedRow(api, BOB.bearer, groupHash);
    expect(alice.seats).toHaveLength(3);
    expect(bob.seats).toHaveLength(3);
    expect(alice.seatIndex).toBe(0);
    expect(bob.seatIndex).toBe(1);
    expect(asLibrarySeats(alice.seats).map((seat) => seat.kind)).toEqual([
      'human',
      'human',
      'heuristic',
    ]);
  });

  it('When a listed human has no profile, the system shall label that chair Player A through Player F from its seat index', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const seats = asLibrarySeats((await listedRow(api, ALICE.bearer, aliceBobGroupHash())).seats);
    expect(seats[0]?.label).toBe(PLAYER_SEAT_LABELS[0]);
    expect(seats[1]?.label).toBe(PLAYER_SEAT_LABELS[1]);
    for (const [index, label] of PLAYER_SEAT_LABELS.entries()) {
      expect(playerLetterLabel(index), label).toBe(label);
    }
  });

  it('When a listed chair is heuristic, the system shall label it AI', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const seats = asLibrarySeats((await listedRow(api, ALICE.bearer, aliceBobGroupHash())).seats);
    expect(seats[2]).toEqual({ kind: 'heuristic', label: 'AI', you: false });
  });

  it("When a listed human has a profile display name, the system shall use that name as the chair's label", async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    plantUserProfile(s3, bobHash(), 'Shalev');
    const seats = asLibrarySeats((await listedRow(api, ALICE.bearer, aliceBobGroupHash())).seats);
    expect(seats[1]?.label).toBe('Shalev');
  });

  it('The system shall not include Google sub, email, or userHash on library seats', async () => {
    const { api } = makeHarness();
    await startAliceBob(api);
    const res = expectStatus(await getMyGames(api, ALICE.bearer), 200);
    const row = libraryRowOf(libraryGamesOf(parseBody(res)).games, aliceBobGroupHash());
    expect(row.seats.length).toBeGreaterThan(0);
    for (const seat of row.seats) {
      expect(seat).not.toHaveProperty('userHash');
      expect(seat).not.toHaveProperty('sub');
      expect(seat).not.toHaveProperty('email');
    }
    expectNoSubLeak(res, ALICE.sub);
    expectNoSubLeak(res, BOB.sub);
    expect(res.body).not.toContain('@');
  });

  it('When Start writes game meta, the system shall write startedAt as ISO-8601 UTC from the adapter clock', async () => {
    const { api, s3 } = makeHarness({ clock: () => Date.parse(STARTED_AT) });
    await startAliceBob(api);
    expect(gameMetaRecord(s3, aliceBobGroupHash(), GAME_ONE)['startedAt']).toBe(STARTED_AT);
  });

  it('When game meta has no startedAt, GET /my-games shall omit startedAt and shall not invent a timestamp', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    dropGameMetaStartedAt(s3, aliceBobGroupHash(), GAME_ONE);
    expect(gameMetaRecord(s3, aliceBobGroupHash(), GAME_ONE)).not.toHaveProperty('startedAt');
    const row = await listedRow(api, ALICE.bearer, aliceBobGroupHash());
    expect(row.startedAt).toBeUndefined();
  });

  it("When the verifier yields a display name, create, accept, and GET /my-games shall upsert that caller's profile", async () => {
    const { api, s3 } = makeHarness({
      googleNames: {
        [ALICE.bearer]: { given_name: 'Gilad' },
        [BOB.bearer]: { given_name: 'Shalev' },
        [CAROL.bearer]: { given_name: 'Dana' },
      },
    });
    const token = await createOpenInvite(api, ALICE);
    expect(profileDisplayNameOf(s3, aliceHash())).toBe('Gilad');

    expectStatus(await postAccept(api, token, BOB.bearer), 200);
    expect(profileDisplayNameOf(s3, bobHash())).toBe('Shalev');

    expectStatus(await getMyGames(api, CAROL.bearer), 200);
    expect(profileDisplayNameOf(s3, carolHash())).toBe('Dana');
  });

  it("The vs-line shall list every chair except the caller's, in seat order", async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    plantUserProfile(s3, bobHash(), 'Shalev');
    const aliceSeats = asLibrarySeats(
      (await listedRow(api, ALICE.bearer, aliceBobGroupHash())).seats,
    );
    const bobSeats = asLibrarySeats((await listedRow(api, BOB.bearer, aliceBobGroupHash())).seats);
    expect(libraryVsLine(aliceSeats)).toBe('Shalev · AI');
    expect(libraryVsLine(bobSeats)).toBe('Player A · AI');
  });
});
