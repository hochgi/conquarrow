/**
 * docs/spec/online-moves-ws/online-moves-ws.edge-cases.feature — one test per scenario.
 *
 * Concurrent accept uses overlapping gets of the same invite JSON (no If-Match
 * on the HTTP accept). The server retries on If-Match so two writers cannot
 * bind the same chair; the loser takes the next unbound human seat or 409 if full.
 *
 * @see docs/spec/online-moves-ws/online-moves-ws.md
 */

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import type { OnlineHeaders, OnlinePort } from '@conquarrow/contracts';
import { endTurn } from '@conquarrow/contracts';
import { createOnlineApi } from '../src/create-online-api';
import type { GoogleVerifier } from '../src/create-online-api';
import {
  answer200ToEveryPost,
  apiOver,
  attachNotifier,
  backingBody,
  createEdgeRig,
  notifierPort,
  postEndTurn,
  rejectionOf,
  s3Error,
  startOpenedGame,
  storeConnection,
} from './online-edge-probes.support';
import {
  ALICE,
  ALICE_CONN,
  BOB,
  BOB_CONN,
  CAROL,
  CAROL_CONN,
  DAVE,
  EXPIRED_BEARER,
  GAME_ONE,
  GAME_TWO,
  HEURISTIC_THEN_TWO_HUMANS,
  INVALID_BEARER,
  THREE_HUMAN,
  TWO_HUMAN_HEURISTIC,
  activePlayerOf,
  aliceBobCarolGroupHash,
  aliceBobGroupHash,
  aliceHash,
  asRecord,
  bindAliceAndBob,
  bobHash,
  boundUserHash,
  carolHash,
  connectionIdKey,
  connectionKey,
  connectionKeys,
  createOpenInvite,
  daveHash,
  expectNoSubLeak,
  expectStatus,
  expectWsStatus,
  fakeGoogle,
  firstLegalStep,
  gameLogKey,
  gameMetaKey,
  gameStateKey,
  getGame,
  getInvite,
  goneReason,
  groupMetaKey,
  illegalStep,
  inviteKey,
  makeHarness,
  mapStore,
  notifiesTo,
  openingMatch,
  overlappingGetStore,
  parseBody,
  parsePersisted,
  playLogKeys,
  playersOf,
  postAccept,
  postMove,
  postStart,
  seatSummaries,
  seedFinishedState,
  seedOpeningState,
  seedStateAtVersion,
  sequentialBytes,
  stampedLine,
  startAliceBob,
  startAliceBobCarol,
  stateOfBody,
  storedVersion,
  versionOf,
  winnerOf,
  wsConnect,
  wsDisconnect,
} from './support';

describe('Authz', () => {
  it('Unauthenticated GET game is 401', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    const res = await getGame(api, groupHash, GAME_ONE);

    expectStatus(res, 401);
    expect(s3.has(gameStateKey(groupHash, GAME_ONE))).toBe(false);
  });

  it('Unauthenticated POST moves is 401', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBobCarol(api);
    const groupHash = aliceBobCarolGroupHash();
    seedOpeningState(s3, groupHash, GAME_ONE, 3);

    const res = await postMove(api, groupHash, GAME_ONE, undefined, endTurn(), 0);

    expectStatus(res, 401);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(0);
  });

  it('WebSocket connect without a token is 401', async () => {
    const { ws, s3 } = makeHarness();

    const res = await wsConnect(ws, ALICE_CONN);

    expect(res.statusCode).toBe(401);
    expect(connectionKeys(s3)).toEqual([]);
  });

  it('Non-member GET does not materialise', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    const res = await getGame(api, groupHash, GAME_ONE, CAROL.bearer);

    expectStatus(res, 403);
    expect(s3.has(gameStateKey(groupHash, GAME_ONE))).toBe(false);
  });

  it('Bound human who is not to move is 403', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBobCarol(api);
    const groupHash = aliceBobCarolGroupHash();
    seedOpeningState(s3, groupHash, GAME_ONE, 3);
    const logBefore = s3.get(gameLogKey(groupHash, GAME_ONE));

    const res = await postMove(api, groupHash, GAME_ONE, BOB.bearer, endTurn(), 0);

    expectStatus(res, 403);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(0);
    expect(s3.get(gameLogKey(groupHash, GAME_ONE))).toBe(logBefore);
  });

  it('Unknown game is 404', async () => {
    const { api } = makeHarness();
    const dead = 'deadbeefdeadbeefdeadbeefdeadbeef';

    const getRes = await getGame(api, dead, GAME_ONE, ALICE.bearer);
    expectStatus(getRes, 404);

    const postRes = await postMove(api, dead, GAME_ONE, ALICE.bearer, endTurn(), 0);
    expectStatus(postRes, 404);
  });

  it.each([{ token: undefined }, { token: '' }])(
    'WebSocket connect without a token does not call Google — $token',
    async ({ token }) => {
      const verified: (string | undefined)[] = [];
      const inner = fakeGoogle();
      const google: GoogleVerifier = {
        verify: (header) => {
          verified.push(header);
          return inner.verify(header);
        },
      };
      const { ws, s3 } = makeHarness({ google });

      const res = await wsConnect(ws, ALICE_CONN, token);

      expect(res.statusCode).toBe(401);
      expect(verified).toEqual([]);
      expect(connectionKeys(s3)).toEqual([]);
    },
  );

  it.each([{ bearer: EXPIRED_BEARER }, { bearer: INVALID_BEARER }])(
    'WebSocket connect with a rejected token is 401 and stores nothing — $bearer',
    async ({ bearer }) => {
      const { ws, s3 } = makeHarness();

      const res = await wsConnect(ws, ALICE_CONN, bearer);

      expect(res.statusCode).toBe(401);
      expect([...s3.keys()]).toEqual([]);
    },
  );

  it.each([
    { record: 'not json' },
    { record: '42' },
    { record: 'null' },
    { record: '{"userHash":7}' },
  ])('Disconnect leaves a connection record that names no user — $record', async ({ record }) => {
    const { ws, s3 } = makeHarness();
    s3.set(connectionIdKey(ALICE_CONN), record);
    const before = new Map(s3);

    const res = await wsDisconnect(ws, ALICE_CONN);

    expect(res.statusCode).toBe(200);
    expect(s3).toEqual(before);
  });
});

describe('Concurrency and legality', () => {
  it('Missing If-Match is 428', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBobCarol(api);
    const groupHash = aliceBobCarolGroupHash();
    seedOpeningState(s3, groupHash, GAME_ONE, 3);

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn());

    expectStatus(res, 428);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(0);
  });

  it('Stale If-Match is 412', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBobCarol(api);
    const groupHash = aliceBobCarolGroupHash();
    seedOpeningState(s3, groupHash, GAME_ONE, 3);
    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 200);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(1);

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0);

    expectStatus(res, 412);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(1);
  });

  it('Illegal move is 422', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBobCarol(api);
    const groupHash = aliceBobCarolGroupHash();
    seedOpeningState(s3, groupHash, GAME_ONE, 3);
    const logBefore = s3.get(gameLogKey(groupHash, GAME_ONE));

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, illegalStep(), 0);

    expectStatus(res, 422);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(0);
    expect(s3.get(gameLogKey(groupHash, GAME_ONE))).toBe(logBefore);
  });

  it('POST after winner is 409 finished', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBobCarol(api);
    const groupHash = aliceBobCarolGroupHash();
    const { version } = seedFinishedState(s3, groupHash, GAME_ONE, 3);
    const snapshot = new Map(s3);

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), version);

    expectStatus(res, 409);
    expect(asRecord(parseBody(res))['reason']).toBe('finished');
    expect([...s3.entries()]).toEqual([...snapshot.entries()]);
  });

  it('Member GET of a finished game is 200', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBobCarol(api);
    const groupHash = aliceBobCarolGroupHash();
    const { winner } = seedFinishedState(s3, groupHash, GAME_ONE, 3);

    const res = await getGame(api, groupHash, GAME_ONE, ALICE.bearer);

    expectStatus(res, 200);
    const meta = JSON.parse(s3.get(gameMetaKey(groupHash, GAME_ONE)) ?? '{}') as unknown;
    expect(winnerOf(stateOfBody(parseBody(res)))).toBe(winner);
    expect(winnerOf(stateOfBody(parseBody(res)))).toBe(winnerOf(meta));
  });

  it('POST without a prior GET still ensures then applies', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expect(playLogKeys(s3)).toEqual([]);

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0);

    expectStatus(res, 200);
    expect(asRecord(parseBody(res))['version']).toBe(1);
    expect(s3.has(gameStateKey(groupHash, GAME_ONE))).toBe(true);
    expect(s3.has(gameLogKey(groupHash, GAME_ONE))).toBe(true);
  });

  it.each([
    { ifMatch: '0' },
    { ifMatch: 'W/"0"' },
    { ifMatch: '"0"x' },
    { ifMatch: 'x"0"' },
    { ifMatch: '""' },
    { ifMatch: '"0 "' },
  ])('If-Match must be exactly a quoted decimal version — $ifMatch', async ({ ifMatch }) => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);

    const res = await postRaw(api, movesPath(groupHash), {
      headers: { authorization: `Bearer ${ALICE.bearer}`, ifMatch },
      body: JSON.stringify({ move: endTurn() }),
    });

    expectStatus(res, 412);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(0);
  });

  it('A version past 9 matches its If-Match', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    seedStateAtVersion(s3, groupHash, GAME_ONE, 3, 12);

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 12);

    expect(versionOf(parseBody(expectStatus(res, 200)))).toBe(13);
  });

  it.each(malformedMoveBodies())(
    'A move body that is not a move is 422 — $label',
    async ({ body }) => {
      const { api, s3 } = makeHarness();
      await startAliceBob(api);
      const groupHash = aliceBobGroupHash();
      expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
      const logBefore = s3.get(gameLogKey(groupHash, GAME_ONE));

      const res = await postRaw(api, movesPath(groupHash), {
        headers: { authorization: `Bearer ${ALICE.bearer}`, ifMatch: '"0"' },
        ...(body === undefined ? {} : { body }),
      });

      expectStatus(res, 422);
      expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(0);
      expect(s3.get(gameLogKey(groupHash, GAME_ONE))).toBe(logBefore);
    },
  );

  it('An unreadable state.json is 500 and is not replaced', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const unreadable = 'not a persisted position';
    s3.set(gameStateKey(groupHash, GAME_ONE), unreadable);

    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 500);
    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 500);
    expect(s3.get(gameStateKey(groupHash, GAME_ONE))).toBe(unreadable);
  });

  // P69 — docs/spec/online-hardening/online-hardening.edge-cases.feature,
  // Rule: Callers see an unreadable game, not a crash.
  it('A move against an out-of-contract stored position is a 500 and changes nothing', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    const key = gameStateKey(groupHash, GAME_ONE);
    const stored = parsePersisted(s3.get(key));
    if (stored.version !== 0) throw new Error('setup: expected the opened game at version 0');
    const state = asRecord(stored.state);
    const groups = state['groups'];
    if (!Array.isArray(groups) || groups.length === 0) throw new Error('setup: expected groups');
    const [first, ...rest] = groups as readonly unknown[];
    const corrupt = JSON.stringify({
      version: stored.version,
      state: { ...state, groups: [{ ...asRecord(first), heads: 0 }, ...rest] },
    });
    s3.set(key, corrupt);

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0);

    expectStatus(res, 500);
    expect(s3.get(key)).toBe(corrupt);
  });

  it('log.jsonl holds exactly one line per applied move', async () => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    const log = (): string | undefined => s3.get(gameLogKey(groupHash, GAME_ONE));
    const lines = (...stamped: readonly string[]): string =>
      stamped.map((line) => `${line}\n`).join('');

    expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
    expect(log()).toBe('');

    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 200);
    expect(log()).toBe(lines(stampedLine(1, endTurn())));

    expectStatus(await postMove(api, groupHash, GAME_ONE, BOB.bearer, endTurn(), 1), 200);
    expect(log()).toBe(
      lines(stampedLine(1, endTurn()), stampedLine(2, endTurn()), stampedLine(2, endTurn())),
    );
  });

  it('Without a heuristic chooser the opening heuristic seat waits', async () => {
    const { api, s3 } = harnessWithoutHeuristic();
    const token = await createOpenInvite(api, ALICE, HEURISTIC_THEN_TWO_HUMANS, 1);
    expectStatus(await postAccept(api, token, BOB.bearer), 200);
    expectStatus(await postStart(api, token, ALICE.bearer), 200);
    const groupHash = aliceBobGroupHash();

    const res = await getGame(api, groupHash, GAME_ONE, ALICE.bearer);

    const body = parseBody(expectStatus(res, 200));
    expect(versionOf(body)).toBe(0);
    const state = stateOfBody(body);
    expect(activePlayerOf(state)).toBe(playersOf(state)[0]);
    expect(s3.get(gameLogKey(groupHash, GAME_ONE))).toBe('');
  });

  it('Without a heuristic chooser a heuristic seat waits after a human move', async () => {
    const { api, s3 } = harnessWithoutHeuristic();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 200);
    const res = await postMove(api, groupHash, GAME_ONE, BOB.bearer, endTurn(), 1);

    expect(versionOf(parseBody(expectStatus(res, 200)))).toBe(2);
    const state = stateOfBody(parseBody(expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200)));
    expect(activePlayerOf(state)).toBe(playersOf(state)[2]);
    expect(s3.get(gameLogKey(groupHash, GAME_ONE))).toBe(
      `${stampedLine(1, endTurn())}\n${stampedLine(2, endTurn())}\n`,
    );
  });
});

describe('Notify hygiene', () => {
  it('Gone connection id is dropped', async () => {
    const { api, s3, ws, notifies } = makeHarness({
      goneConnectionIds: new Set([BOB_CONN]),
    });
    await startAliceBobCarol(api);
    const groupHash = aliceBobCarolGroupHash();
    s3.set(connectionKey(bobHash(), BOB_CONN), '{}');
    s3.set(connectionKey(carolHash(), CAROL_CONN), '{}');
    expectWsStatus(await wsConnect(ws, BOB_CONN, BOB.bearer), 200);
    expectWsStatus(await wsConnect(ws, CAROL_CONN, CAROL.bearer), 200);
    seedOpeningState(s3, groupHash, GAME_ONE, 3);

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0);

    expectStatus(res, 200);
    expect(s3.has(connectionKey(bobHash(), BOB_CONN))).toBe(false);
    expect(s3.has(connectionIdKey(BOB_CONN))).toBe(false);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(1);
    expect(notifiesTo(notifies, CAROL_CONN).map((row) => row.payload)).toContainEqual({
      type: 'stateChanged',
      version: 1,
      groupHash,
      gameNumber: GAME_ONE,
    });
  });

  it('Heuristic seats are not notified', async () => {
    const { api, s3, ws, notifies } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();
    expectWsStatus(await wsConnect(ws, ALICE_CONN, ALICE.bearer), 200);
    expectWsStatus(await wsConnect(ws, BOB_CONN, BOB.bearer), 200);
    seedOpeningState(s3, groupHash, GAME_ONE, 3);

    expectStatus(await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0), 200);

    const targets = notifies
      .filter((row) => row.payload.version === 1)
      .map((row) => row.connectionId);
    expect(targets).toEqual([BOB_CONN]);
  });

  it('Notify failure after persist still returns 200', async () => {
    const { api, s3, ws } = makeHarness({
      postToConnection: () => {
        throw new Error('PostToConnection unavailable');
      },
    });
    await startAliceBobCarol(api);
    const groupHash = aliceBobCarolGroupHash();
    expectWsStatus(await wsConnect(ws, BOB_CONN, BOB.bearer), 200);
    seedOpeningState(s3, groupHash, GAME_ONE, 3);

    const res = await postMove(api, groupHash, GAME_ONE, ALICE.bearer, endTurn(), 0);

    expectStatus(res, 200);
    expect(storedVersion(s3, groupHash, GAME_ONE)).toBe(1);
  });
});

describe('P17 follow-on races', () => {
  it('Concurrent accept does not share a chair', async () => {
    const data = new Map<string, string>();
    const store = overlappingGetStore(
      data,
      (key) => key.includes('/invites/') && key.endsWith('.json'),
    );
    const { api, s3 } = makeHarness({ s3: data, store });
    const token = await createOpenInvite(api, ALICE, THREE_HUMAN);
    store.arm();

    const [bobRes, carolRes] = await Promise.all([
      postAccept(api, token, BOB.bearer),
      postAccept(api, token, CAROL.bearer),
    ]);

    expect([bobRes.statusCode, carolRes.statusCode].sort()).toEqual([200, 200]);
    const bobSeats = seatSummaries(parseBody(bobRes));
    const carolSeats = seatSummaries(parseBody(carolRes));
    const bobChair = bobSeats.findIndex((seat) => boundUserHash(seat) === bobHash());
    const carolChair = carolSeats.findIndex((seat) => boundUserHash(seat) === carolHash());
    expect(bobChair).toBeGreaterThanOrEqual(0);
    expect(carolChair).toBeGreaterThanOrEqual(0);
    expect(bobChair).not.toBe(carolChair);
    const stored = seatSummaries(JSON.parse(s3.get(inviteKey(token)) ?? '{}') as unknown);
    const hashes = stored.map((seat) => boundUserHash(seat)).filter((h) => h !== undefined);
    expect(hashes).toContain(aliceHash());
    expect(hashes).toContain(bobHash());
    expect(hashes).toContain(carolHash());
    expect(new Set(hashes).size).toBe(3);
  });

  it('Last chair concurrent accept is 409 for the loser', async () => {
    const data = new Map<string, string>();
    const store = overlappingGetStore(
      data,
      (key) => key.includes('/invites/') && key.endsWith('.json'),
    );
    const { api, s3 } = makeHarness({ s3: data, store });
    const token = await createOpenInvite(api, ALICE, THREE_HUMAN);
    expectStatus(await postAccept(api, token, DAVE.bearer), 200);
    store.arm();

    const [bobRes, carolRes] = await Promise.all([
      postAccept(api, token, BOB.bearer),
      postAccept(api, token, CAROL.bearer),
    ]);

    const codes = [bobRes.statusCode, carolRes.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const stored = seatSummaries(JSON.parse(s3.get(inviteKey(token)) ?? '{}') as unknown);
    expect(stored).toHaveLength(3);
    const hashes = stored.map((seat) => boundUserHash(seat)).filter((h) => h !== undefined);
    expect(hashes).toHaveLength(3);
    expect(hashes).toContain(aliceHash());
    expect(hashes).toContain(daveHash());
    expect(hashes.includes(bobHash()) !== hashes.includes(carolHash())).toBe(true);
  });

  it('Start does not overwrite an existing game number', async () => {
    const { api, s3 } = makeHarness();
    const groupHash = aliceBobGroupHash();
    await startAliceBob(api);
    const firstMeta = s3.get(gameMetaKey(groupHash, GAME_ONE));
    expect(firstMeta).toBeDefined();

    const token = await createOpenInvite(api, ALICE, TWO_HUMAN_HEURISTIC);
    expectStatus(await postAccept(api, token, BOB.bearer), 200);
    const started = expectStatus(await postStart(api, token, ALICE.bearer), 200);

    expect(parseBody(started)).toEqual({ groupHash, gameNumber: GAME_TWO });
    expect(s3.get(gameMetaKey(groupHash, GAME_ONE))).toBe(firstMeta);
  });

  it('Retry Start finishes the same game', async () => {
    const { api, s3 } = makeHarness();
    const token = await bindAliceAndBob(api);
    const groupHash = aliceBobGroupHash();
    const inviteRaw = s3.get(inviteKey(token));
    expect(inviteRaw).toBeDefined();
    if (inviteRaw === undefined) return;
    const seats = asRecord(JSON.parse(inviteRaw) as unknown)['seats'];
    s3.set(gameMetaKey(groupHash, GAME_ONE), JSON.stringify({ seats }));

    const res = await postStart(api, token, ALICE.bearer);

    expectStatus(res, 200);
    expect(parseBody(res)).toEqual({ groupHash, gameNumber: GAME_ONE });
    expect(s3.has(gameMetaKey(groupHash, GAME_TWO))).toBe(false);
    const invite = JSON.parse(s3.get(inviteKey(token)) ?? '{}') as unknown;
    expect(asRecord(invite)['status']).toBe('started');
  });

  it("Start does not claim another invite's game number", async () => {
    const { api, s3 } = makeHarness();
    const token = await bindAliceAndBob(api);
    const groupHash = aliceBobGroupHash();
    const inviteRaw = s3.get(inviteKey(token));
    expect(inviteRaw).toBeDefined();
    if (inviteRaw === undefined) return;
    const seats = asRecord(JSON.parse(inviteRaw) as unknown)['seats'];
    s3.set(
      gameMetaKey(groupHash, GAME_ONE),
      JSON.stringify({ seats, inviteToken: 'other-token' }),
    );

    const started = expectStatus(await postStart(api, token, ALICE.bearer), 200);

    expect(parseBody(started)).toEqual({ groupHash, gameNumber: GAME_TWO });
    const kept = asRecord(JSON.parse(s3.get(gameMetaKey(groupHash, GAME_ONE)) ?? '{}') as unknown);
    expect(kept['inviteToken']).toBe('other-token');
  });

  it('Concurrent Start on the same token allocates one game', async () => {
    const data = new Map<string, string>();
    const store = overlappingGetStore(
      data,
      (key) => key.includes('/invites/') && key.endsWith('.json'),
    );
    const { api, s3 } = makeHarness({ s3: data, store });
    const token = await bindAliceAndBob(api);
    store.arm();

    const [aliceRes, bobRes] = await Promise.all([
      postStart(api, token, ALICE.bearer),
      postStart(api, token, BOB.bearer),
    ]);

    const groupHash = aliceBobGroupHash();
    const succeeded = [aliceRes, bobRes].filter((res) => res.statusCode === 200);
    const closed = [aliceRes, bobRes].filter((res) => res.statusCode === 410);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.length + closed.length).toBe(2);
    for (const res of succeeded) {
      expect(parseBody(res)).toEqual({ groupHash, gameNumber: GAME_ONE });
    }
    for (const res of closed) {
      expect(goneReason(parseBody(res))).toBe('started');
    }
    expect(s3.has(gameMetaKey(groupHash, GAME_TWO))).toBe(false);
  });

  it('After completed Start the token is still 410', async () => {
    const { api } = makeHarness();
    const token = await startAliceBob(api);

    const res = await postStart(api, token, ALICE.bearer);

    expectStatus(res, 410);
    expect(goneReason(parseBody(res))).toBe('started');
  });
});

describe('Stub retirement', () => {
  it('P16 POST /moves stub is gone', async () => {
    const { api } = makeHarness();

    const res = await api.handle({
      method: 'POST',
      path: '/moves',
      headers: { authorization: `Bearer ${ALICE.bearer}` },
    });

    expect(res.statusCode).not.toBe(501);
    expect(res.statusCode).toBe(404);
    expectNoSubLeak(res, ALICE.sub);
  });
});

describe('Group game counter', () => {
  it("Start numbers the game from the group's next game number", async () => {
    const { res, s3, groupHash } = await startWithGroupMeta('{"nextGameNumber":5}');

    expect(parseBody(expectStatus(res, 200))).toEqual({ groupHash, gameNumber: '000005' });
    expect(s3.get(groupMetaKey(groupHash))).toBe('{"nextGameNumber":6}');
  });

  it.each([
    { groupMeta: '{"nextGameNumber":0}' },
    { groupMeta: '{"nextGameNumber":-3}' },
    { groupMeta: '{"nextGameNumber":2.5}' },
    { groupMeta: '{"nextGameNumber":"7"}' },
    { groupMeta: '{}' },
    { groupMeta: '42' },
    { groupMeta: 'null' },
    { groupMeta: 'not json' },
  ])('An unusable group counter numbers from 1 — $groupMeta', async ({ groupMeta }) => {
    const { res, s3, groupHash } = await startWithGroupMeta(groupMeta);

    expect(parseBody(expectStatus(res, 200))).toEqual({ groupHash, gameNumber: GAME_ONE });
    expect(s3.get(groupMetaKey(groupHash))).toBe('{"nextGameNumber":2}');
  });

  it('Retrying Start never moves the group counter backwards', async () => {
    const { api, s3 } = makeHarness();
    const token = await bindAliceAndBob(api);
    const groupHash = aliceBobGroupHash();
    const invite = asRecord(JSON.parse(s3.get(inviteKey(token)) ?? '{}') as unknown);
    s3.set(inviteKey(token), JSON.stringify({ ...invite, gameNumber: GAME_ONE }));
    s3.set(groupMetaKey(groupHash), '{"nextGameNumber":7}');

    const res = await postStart(api, token, ALICE.bearer);

    expect(parseBody(expectStatus(res, 200))).toEqual({ groupHash, gameNumber: GAME_ONE });
    expect(s3.get(groupMetaKey(groupHash))).toBe('{"nextGameNumber":7}');
  });

  it('Start skips a game number whose meta is unreadable', async () => {
    const { api, s3 } = makeHarness();
    const token = await bindAliceAndBob(api);
    const groupHash = aliceBobGroupHash();
    const unreadable = 'not game meta';
    s3.set(gameMetaKey(groupHash, GAME_ONE), unreadable);

    const res = await postStart(api, token, ALICE.bearer);

    expect(parseBody(expectStatus(res, 200))).toEqual({ groupHash, gameNumber: GAME_TWO });
    expect(s3.get(gameMetaKey(groupHash, GAME_ONE))).toBe(unreadable);
  });
});

describe('Store failures', () => {
  it('A store failure writing game meta fails Start and allocates nothing', async () => {
    const edge = createEdgeRig();
    try {
      const { api } = apiOver(edge.store);
      const token = await bindAliceAndBob(api);
      const groupHash = aliceBobGroupHash();
      const failure = s3Error('InternalError', 500);
      edge.s3.probe
        .command(PutObjectCommand)
        .filter(
          (call) => call.command.input.Key === gameMetaKey(groupHash, GAME_ONE),
          'Key === games/000001/meta.json',
        )
        .once()
        .reject(failure);

      expect(await rejectionOf(postStart(api, token, ALICE.bearer))).toBe(failure);
      expect(await backingBody(edge, gameMetaKey(groupHash, GAME_ONE))).toBeUndefined();
      expect(await backingBody(edge, gameMetaKey(groupHash, GAME_TWO))).toBeUndefined();
      expectStatus(await getInvite(api, token), 200);

      const retried = await postStart(api, token, ALICE.bearer);
      expect(parseBody(expectStatus(retried, 200))).toEqual({ groupHash, gameNumber: GAME_ONE });
    } finally {
      await edge.close();
    }
  });

  it('Start does not claim a game number it lost and cannot read back', async () => {
    const edge = createEdgeRig();
    try {
      const { api } = apiOver(edge.store);
      const token = await bindAliceAndBob(api);
      const groupHash = aliceBobGroupHash();
      edge.s3.probe
        .command(PutObjectCommand)
        .filter(
          (call) => call.command.input.Key === gameMetaKey(groupHash, GAME_ONE),
          'Key === games/000001/meta.json',
        )
        .once()
        .reject(s3Error('PreconditionFailed', 412));

      const res = await postStart(api, token, ALICE.bearer);

      expect(parseBody(expectStatus(res, 200))).toEqual({ groupHash, gameNumber: GAME_TWO });
      expect(await backingBody(edge, gameMetaKey(groupHash, GAME_ONE))).toBeUndefined();
    } finally {
      await edge.close();
    }
  });

  it('A store failure writing the opening position surfaces', async () => {
    const edge = createEdgeRig();
    try {
      const { api } = apiOver(edge.store);
      await startAliceBob(api);
      const groupHash = aliceBobGroupHash();
      const stateKey = gameStateKey(groupHash, GAME_ONE);
      const failure = s3Error('InternalError', 500);
      edge.s3.probe
        .command(PutObjectCommand)
        .filter((call) => call.command.input.Key === stateKey, 'Key === state.json')
        .once()
        .reject(failure);

      expect(await rejectionOf(getGame(api, groupHash, GAME_ONE, ALICE.bearer))).toBe(failure);
      expect(await backingBody(edge, stateKey)).toBeUndefined();
    } finally {
      await edge.close();
    }
  });

  it('A store failure persisting a move is 500 and notifies no one', async () => {
    const edge = createEdgeRig();
    try {
      const notifier = attachNotifier(edge);
      answer200ToEveryPost(notifier);
      const { api, ws } = apiOver(edge.store, notifierPort(notifier));
      const game = await startOpenedGame(api, TWO_HUMAN_HEURISTIC);
      await storeConnection(ws, BOB, BOB_CONN);
      const stateKey = gameStateKey(game.groupHash, game.gameNumber);
      edge.s3.probe
        .command(PutObjectCommand)
        .filter(
          (call) =>
            call.command.input.Key === stateKey && call.command.input.IfMatch !== undefined,
          'state.json put carrying IfMatch',
        )
        .once()
        .reject(s3Error('InternalError', 500));

      const res = await postEndTurn(api, game, ALICE, 0);

      expectStatus(res, 500);
      expect(parsePersisted(await backingBody(edge, stateKey)).version).toBe(0);
      notifier.probe.on('post').expect.neverCalled();
    } finally {
      await edge.close();
    }
  });
});

describe('Route matching', () => {
  it.each([
    { method: 'GET', path: '/api/games/G/000001' },
    { method: 'GET', path: '/games/G/000001/extra' },
    { method: 'GET', path: '/api/games/G/000001/log' },
    { method: 'GET', path: '/games/G/000001/logs' },
    { method: 'GET', path: '/games/G/000001/moves' },
    { method: 'GET', path: '/games/G' },
    { method: 'GET', path: '/nowhere' },
    { method: 'POST', path: '/games/G/000001' },
    { method: 'POST', path: '/api/games/G/000001/moves' },
    { method: 'POST', path: '/games/G/000001/movesx' },
    { method: 'POST', path: '/games/G/000001/moves/x' },
    { method: 'POST', path: '/games/G/000001/log' },
  ] as const)('Game routes match whole paths only — $method $path', async ({ method, path }) => {
    const { api, s3 } = makeHarness();
    await startAliceBob(api);
    const groupHash = aliceBobGroupHash();

    const res = await api.handle({
      method,
      path: path.replace('G', groupHash),
      headers: { authorization: `Bearer ${ALICE.bearer}`, ifMatch: '"0"' },
      ...(method === 'POST' ? { body: JSON.stringify({ move: endTurn() }) } : {}),
    });

    expectStatus(res, 404);
    expect(s3.has(gameStateKey(groupHash, GAME_ONE))).toBe(false);
  });
});

const movesPath = (groupHash: string): string => `/games/${groupHash}/${GAME_ONE}/moves`;

const postRaw = (
  api: OnlinePort,
  path: string,
  request: { readonly headers: OnlineHeaders; readonly body?: string },
): ReturnType<OnlinePort['handle']> => api.handle({ method: 'POST', path, ...request });

/** The raw POST bodies of the "A move body that is not a move is 422" outline. */
const malformedMoveBodies = (): readonly { readonly label: string; readonly body?: string }[] => {
  const legal = firstLegalStep(openingMatch(3));
  const moveBody = (move: unknown): string => JSON.stringify({ move });
  return [
    { label: '(none)' },
    { label: 'not json', body: 'not json' },
    { label: 'null', body: 'null' },
    { label: '{}', body: '{}' },
    { label: 'move null', body: moveBody(null) },
    { label: 'move 5', body: moveBody(5) },
    { label: 'kind jump', body: moveBody({ ...legal, kind: 'jump' }) },
    { label: 'count "1"', body: moveBody({ ...legal, count: '1' }) },
    { label: 'from 5', body: moveBody({ ...legal, from: 5 }) },
    { label: 'exit 5', body: moveBody({ ...legal, exit: 5 }) },
  ];
};

/** An api whose deps carry no heuristic chooser — the optional `OnlineApiDeps.heuristic` left out. */
const harnessWithoutHeuristic = (): { api: OnlinePort; s3: Map<string, string> } => {
  const s3 = new Map<string, string>();
  const api = createOnlineApi({
    google: fakeGoogle(),
    s3: mapStore(s3),
    clock: () => 0,
    randomBytes: sequentialBytes(),
  });
  return { api, s3 };
};

const startWithGroupMeta = async (
  groupMeta: string,
): Promise<{
  readonly res: Awaited<ReturnType<OnlinePort['handle']>>;
  readonly s3: Map<string, string>;
  readonly groupHash: string;
}> => {
  const { api, s3 } = makeHarness();
  const token = await bindAliceAndBob(api);
  const groupHash = aliceBobGroupHash();
  s3.set(groupMetaKey(groupHash), groupMeta);
  const res = await postStart(api, token, ALICE.bearer);
  return { res, s3, groupHash };
};
