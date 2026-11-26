/**
 * EARS invariants for docs/spec/online-auth-invites/online-auth-invites.md.
 *
 * Table-driven / small explicit generators in Vitest — this repo has no
 * fast-check (same style as packages/rules-core/test/*.invariants.test.ts).
 */

import { describe, expect, it } from 'vitest';
import type { PlannedSeatKind } from '@conquarrow/contracts';
import {
  ALICE,
  BOB,
  CAROL,
  EXPIRED_BEARER,
  GAME_ONE,
  GAME_TWO,
  GINA,
  INVALID_BEARER,
  SIX_HUMAN,
  TWO_HUMAN_HEURISTIC,
  aliceBobGroupHash,
  aliceHash,
  bindAliceAndBob,
  bindSixHumans,
  bobHash,
  boundUserHash,
  createOpenInvite,
  expectNoSubLeak,
  expectStatus,
  gameMetaKey,
  getInvite,
  getMe,
  getMyGames,
  goneReason,
  groupAndGameKeys,
  groupMetaKey,
  inviteKey,
  lobbyKey,
  makeHarness,
  myGamesOf,
  parseBody,
  playLogKeys,
  postAccept,
  postInvites,
  postJson,
  postRevoke,
  postStart,
  seatSummaries,
  startAliceBob,
  tokenOf,
} from './support';

describe('online-auth-invites invariants', () => {
  it('When a request has no valid Google ID token, the system shall respond 401 on /me, /my-games, POST /invites, accept, revoke, and start', async () => {
    const { api } = makeHarness();
    const token = 'deadbeef';
    const seats = { seats: TWO_HUMAN_HEURISTIC };
    const bearers: readonly (string | undefined)[] = [undefined, EXPIRED_BEARER, INVALID_BEARER];
    for (const bearer of bearers) {
      const label = bearer ?? 'missing';
      const calls = [
        { name: 'GET /me', res: await getMe(api, bearer) },
        { name: 'GET /my-games', res: await getMyGames(api, bearer) },
        { name: 'POST /invites', res: await postJson(api, '/invites', bearer, seats) },
        { name: 'POST accept', res: await postAccept(api, token, bearer) },
        { name: 'POST revoke', res: await postJson(api, `/invites/${token}/revoke`, bearer) },
        { name: 'POST start', res: await postJson(api, `/invites/${token}/start`, bearer) },
      ];
      for (const call of calls) {
        expect(call.res.statusCode, `${call.name} (${label})`).toBe(401);
      }
    }
  });

  it('When create lists fewer than two human seats, or a length other than 3 or 6, or a byok seat, the system shall respond 422 and shall not write S3', async () => {
    const plans: readonly { name: string; seats: readonly PlannedSeatKind[] }[] = [
      { name: 'all heuristic 3', seats: ['heuristic', 'heuristic', 'heuristic'] },
      { name: 'one human 3', seats: ['creator', 'heuristic', 'heuristic'] },
      { name: 'byok', seats: ['creator', 'human', 'byok'] },
      { name: 'length 2', seats: ['creator', 'human'] },
      { name: 'length 4', seats: ['creator', 'human', 'human', 'human'] },
      { name: 'length 5', seats: ['creator', 'human', 'human', 'human', 'human'] },
      { name: 'length 0', seats: [] },
      { name: 'six with byok', seats: ['creator', 'human', 'human', 'human', 'human', 'byok'] },
      { name: 'six with one human', seats: ['creator', 'heuristic', 'heuristic', 'heuristic', 'heuristic', 'heuristic'] },
    ];
    for (const plan of plans) {
      const { api, s3 } = makeHarness();
      const before = new Map(s3);
      const res = await postInvites(api, ALICE.bearer, { seats: plan.seats });
      expect(res.statusCode, plan.name).toBe(422);
      expect([...s3.keys()], plan.name).toEqual([...before.keys()]);
    }
  });

  it('When create succeeds, the system shall bind the creator to the creator chair (P106; was hostSeatIndex) and shall write only invite and lobby-pointer objects', async () => {
    const cases: readonly {
      name: string;
      seats: readonly PlannedSeatKind[];
      boundIndex: number;
    }[] = [
      { name: 'creator at 0', seats: TWO_HUMAN_HEURISTIC, boundIndex: 0 },
      { name: 'creator at 1', seats: ['heuristic', 'creator', 'human'], boundIndex: 1 },
      { name: 'creator last (P106)', seats: ['human', 'heuristic', 'creator'], boundIndex: 2 },
      { name: 'six seats, creator at 4 (P106)', seats: ['human', 'heuristic', 'heuristic', 'heuristic', 'creator', 'heuristic'], boundIndex: 4 },
    ];
    for (const c of cases) {
      const { api, s3 } = makeHarness();
      const res = await postInvites(api, ALICE.bearer, { seats: c.seats });
      expectStatus(res, 201);
      const parsed = parseBody(res);
      const token = tokenOf(parsed);
      const seats = seatSummaries(parsed);
      expect({ name: c.name, seat: seats[c.boundIndex] }).toEqual({
        name: c.name,
        seat: { kind: 'human', userHash: aliceHash() },
      });
      const boundCount = seats.filter((s) => boundUserHash(s) === aliceHash()).length;
      expect(boundCount).toBe(1);
      expect([...s3.keys()].sort()).toEqual([inviteKey(token), lobbyKey(aliceHash(), token)].sort());
    }
  });

  it('While an invite is open, the system shall serve GET /invites/:token without a Google token and shall not include Google sub in the body', async () => {
    const { api } = makeHarness();
    const token = await createOpenInvite(api, ALICE);
    const res = await getInvite(api, token);
    expectStatus(res, 200);
    expectNoSubLeak(res, ALICE.sub);
    expect(seatSummaries(parseBody(res))[0]).toEqual({ kind: 'human', userHash: aliceHash() });
  });

  it('When a user accepts an invite they already occupy, the system shall return that same seat, shall not occupy a second chair, and shall write that user\'s lobby pointer if it is missing', async () => {
    const { api, s3 } = makeHarness();
    const token = await createOpenInvite(api, ALICE);
    expectStatus(await postAccept(api, token, BOB.bearer), 200);
    s3.delete(lobbyKey(bobHash(), token));
    const again = expectStatus(await postAccept(api, token, BOB.bearer), 200);
    const seats = seatSummaries(parseBody(again));
    expect(seats.filter((s) => boundUserHash(s) === bobHash())).toHaveLength(1);
    expect(seats.filter((s) => boundUserHash(s) === aliceHash())).toHaveLength(1);
    expect(seats).toHaveLength(3);
    expect(s3.has(lobbyKey(bobHash(), token))).toBe(true);
    const lib = myGamesOf(parseBody(expectStatus(await getMyGames(api, BOB.bearer), 200)));
    expect(lib.lobbies).toContain(token);
  });

  it('When every human seat is already bound, the system shall reject a further accept with 409 and shall not add a spectator row', async () => {
    const { api } = makeHarness();
    const token = await bindSixHumans(api);
    const res = await postAccept(api, token, GINA.bearer);
    expectStatus(res, 409);
    const peek = parseBody(expectStatus(await getInvite(api, token), 200));
    expect(seatSummaries(peek)).toHaveLength(6);
    expect(JSON.stringify(peek)).not.toContain(GINA.sub);
    if (typeof peek === 'object' && peek !== null) {
      expect(peek).not.toHaveProperty('spectators');
    }
  });

  it('When the creator revokes, or when Start has succeeded, the system shall respond 410 with reason revoked or started on GET/accept/start of that token', async () => {
    const revoked = makeHarness();
    const revokedToken = await createOpenInvite(revoked.api, ALICE);
    expectStatus(await postRevoke(revoked.api, revokedToken, ALICE.bearer), 200);
    for (const call of [
      () => getInvite(revoked.api, revokedToken),
      () => postAccept(revoked.api, revokedToken, BOB.bearer),
      () => postStart(revoked.api, revokedToken, ALICE.bearer),
    ]) {
      const res = await call();
      expectStatus(res, 410);
      expect(goneReason(parseBody(res))).toBe('revoked');
    }

    const started = makeHarness();
    const startedToken = await startAliceBob(started.api);
    for (const call of [
      () => getInvite(started.api, startedToken),
      () => postAccept(started.api, startedToken, CAROL.bearer),
      () => postStart(started.api, startedToken, ALICE.bearer),
    ]) {
      const res = await call();
      expectStatus(res, 410);
      expect(goneReason(parseBody(res))).toBe('started');
    }
  });

  it('If the caller is not the creator, then the system shall reject revoke with 403', async () => {
    const { api } = makeHarness();
    const token = await bindAliceAndBob(api);
    expectStatus(await postRevoke(api, token, BOB.bearer), 403);
    expectStatus(await getInvite(api, token), 200);
  });

  it('If the caller is not a bound human on that invite, then the system shall reject Start with 403', async () => {
    const { api, s3 } = makeHarness();
    const token = await bindAliceAndBob(api);
    expectStatus(await postStart(api, token, CAROL.bearer), 403);
    expect(groupAndGameKeys(s3)).toEqual([]);
  });

  it('When human seats are not all bound, the system shall reject Start with 409 and shall not write group or game objects', async () => {
    const { api, s3 } = makeHarness();
    const token = await createOpenInvite(api, ALICE, SIX_HUMAN);
    expectStatus(await postStart(api, token, ALICE.bearer), 409);
    expect(groupAndGameKeys(s3)).toEqual([]);
  });

  it('When Start succeeds, the system shall compute groupHash from sorted human userHash values joined by newline, allocate the next 6-digit game number, and shall not overwrite an existing games/NNNNNN object', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    const token1 = await bindAliceAndBob(api);
    const start1 = expectStatus(await postStart(api, token1, ALICE.bearer), 200);
    expect(parseBody(start1)).toEqual({ groupHash, gameNumber: GAME_ONE });
    const firstMeta = s3.get(gameMetaKey(groupHash, GAME_ONE));
    expect(firstMeta).toBeDefined();

    const token2 = await createOpenInvite(api, BOB, TWO_HUMAN_HEURISTIC);
    expectStatus(await postAccept(api, token2, ALICE.bearer), 200);
    const start2 = expectStatus(await postStart(api, token2, BOB.bearer), 200);
    expect(parseBody(start2)).toEqual({ groupHash, gameNumber: GAME_TWO });
    expect(s3.get(gameMetaKey(groupHash, GAME_ONE))).toBe(firstMeta);
    expect(s3.has(gameMetaKey(groupHash, GAME_TWO))).toBe(true);
    expect(s3.has(groupMetaKey(groupHash))).toBe(true);
  });

  it('When Start succeeds, the system shall not write state.json or log.jsonl', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    expect(playLogKeys(s3)).toEqual([]);
  });

  it("The system shall not include another user's lobbies or games in GET /my-games", async () => {
    const { api } = makeHarness();
    const token = await createOpenInvite(api, ALICE);
    const res = expectStatus(await getMyGames(api, BOB.bearer), 200);
    const lib = myGamesOf(parseBody(res));
    expect(lib.lobbies).not.toContain(token);
    expect(lib.games).toEqual([]);
    expect(res.body).not.toContain(aliceHash());
  });

  it("The system shall list that user's open lobbies and started games on GET /my-games", async () => {
    const { api } = makeHarness();
    const openToken = await createOpenInvite(api, ALICE);
    const startedToken = await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    const aliceLib = myGamesOf(parseBody(expectStatus(await getMyGames(api, ALICE.bearer), 200)));
    expect(aliceLib.lobbies).toContain(openToken);
    expect(aliceLib.lobbies).not.toContain(startedToken);
    expect(aliceLib.games).toContainEqual({ groupHash, gameNumber: GAME_ONE });

    const bobLib = myGamesOf(parseBody(expectStatus(await getMyGames(api, BOB.bearer), 200)));
    expect(bobLib.lobbies).not.toContain(openToken);
    expect(bobLib.games).toContainEqual({ groupHash, gameNumber: GAME_ONE });
  });
});
