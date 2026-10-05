/**
 * docs/spec/online-edge-probes/online-edge-probes.edge-cases.feature — one test per
 * scenario (the outline is one `it.each` with six rows).
 *
 * Failure injection is a probe rule (`once().reject`, `once().forward`) or an
 * intercept followed by a racing write and `forward()` — never a new fake.
 *
 * @see docs/spec/online-edge-probes/online-edge-probes.md
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreconditionFailed } from '../src/create-online-api';
import {
  ALICE,
  BOB,
  ALICE_CONN,
  BOB_CONN,
  CAROL,
  CAROL_CONN,
  THREE_HUMAN,
  TWO_HUMAN_HEURISTIC,
  aliceHash,
  bobHash,
  carolHash,
  connectionIdKey,
  connectionKey,
  expectStatus,
  gameStateKey,
  parseBody,
  versionOf,
} from './support';
import {
  type EdgeRig,
  answer200ToEveryPost,
  apiOver,
  attachNotifier,
  backingBody,
  createEdgeRig,
  keysUnder,
  notifierPort,
  postEndTurn,
  rawPut,
  s3Error,
  seedBacking,
  rejectionOf,
  startOpenedGame,
  storeConnection,
  utf16Order,
} from './online-edge-probes.support';

const K1 = 'conquarrow/k1';

let edge: EdgeRig;

beforeEach(() => {
  edge = createEdgeRig();
});

afterEach(async () => {
  await edge.close();
});

describe('online-edge-probes — edge cases', () => {
  describe('Rule: Not-found mapping on reads', () => {
    it('A bare 404 that is not named NoSuchKey still reads as undefined', async () => {
      edge.s3.probe.command(GetObjectCommand).once().reject(s3Error('NotFound', 404));

      const result = await edge.store.get(K1);

      expect(result).toBeUndefined();
    });

    it('A read failure that is not a 404 propagates', async () => {
      await seedBacking(edge, [[K1, 'x']]);
      const failure = s3Error('InternalError', 500);
      edge.s3.probe.command(GetObjectCommand).once().reject(failure);

      const reason = await rejectionOf(Promise.resolve(edge.store.get(K1)));

      expect(reason).toBe(failure);
    });
  });

  describe('Rule: Preconditions map to PreconditionFailed', () => {
    it('Compare-and-swap on an absent key fails without a write', async () => {
      const reason = await rejectionOf(
        Promise.resolve(edge.store.put(K1, 'v1', { ifMatch: 'v0' })),
      );

      expect(reason).toBeInstanceOf(PreconditionFailed);
      edge.s3.probe.command(PutObjectCommand).expect.neverCalled();
      expect(await backingBody(edge, K1)).toBeUndefined();
    });

    it('Compare-and-swap with a stale body fails without a write', async () => {
      await seedBacking(edge, [[K1, 'v0']]);

      const reason = await rejectionOf(
        Promise.resolve(edge.store.put(K1, 'v2', { ifMatch: 'stale' })),
      );

      expect(reason).toBeInstanceOf(PreconditionFailed);
      edge.s3.probe.command(PutObjectCommand).expect.neverCalled();
      expect(await backingBody(edge, K1)).toBe('v0');
    });

    it('A write racing between the read and the conditional put loses with PreconditionFailed', async () => {
      await seedBacking(edge, [[K1, 'v0']]);
      const held = edge.s3.probe
        .command(PutObjectCommand)
        .filter((call) => call.command.input.Key === K1, `Key === '${K1}'`)
        .expect.intercept();

      const outcome = rejectionOf(Promise.resolve(edge.store.put(K1, 'mine', { ifMatch: 'v0' })));
      const pending = await held;
      await rawPut(edge, K1, 'theirs');
      pending.forward();

      expect(await outcome).toBeInstanceOf(PreconditionFailed);
      expect(await backingBody(edge, K1)).toBe('theirs');
    });

    it('Create-only put on an existing key fails and leaves it unchanged', async () => {
      await seedBacking(edge, [[K1, 'first']]);

      const reason = await rejectionOf(
        Promise.resolve(edge.store.put(K1, 'second', { ifNoneMatch: '*' })),
      );

      expect(reason).toBeInstanceOf(PreconditionFailed);
      expect(await backingBody(edge, K1)).toBe('first');
    });

    it.each([
      { name: 'PreconditionFailed', status: 412, shown: '412' },
      { name: 'ConditionalRequestConflict', status: 409, shown: '409' },
      { name: 'OtherConflict', status: 409, shown: '409' },
      { name: 'OtherPrecondition', status: 412, shown: '412' },
      { name: 'PreconditionFailed', status: undefined, shown: 'none' },
      { name: 'ConditionalRequestConflict', status: undefined, shown: 'none' },
    ])(
      'A rejected PutObject maps to PreconditionFailed by name or by status — $name $shown',
      async ({ name, status }) => {
        edge.s3.probe.command(PutObjectCommand).once().reject(s3Error(name, status));

        const reason = await rejectionOf(Promise.resolve(edge.store.put(K1, 'x')));

        expect(reason).toBeInstanceOf(
          PreconditionFailed,
        );
      },
    );

    it('A PutObject failure that is neither 412 nor 409 propagates unmapped', async () => {
      const failure = s3Error('SlowDown', 503);
      edge.s3.probe.command(PutObjectCommand).once().reject(failure);

      const reason = await rejectionOf(Promise.resolve(edge.store.put(K1, 'x')));

      expect(reason).toBe(failure);
      expect(reason).not.toBeInstanceOf(
        PreconditionFailed,
      );
    });
  });

  describe('Rule: Listing boundaries', () => {
    it('Exactly one full page is one call', async () => {
      const keys = keysUnder('conquarrow/p/', 1000);
      await seedBacking(edge, keys.map((key) => [key, '{}'] as const));

      const result = await edge.store.listPrefix('conquarrow/p/');

      expect(result).toEqual([...keys].sort(utf16Order));
      edge.s3.probe.command(ListObjectsV2Command).expect.calledTimes(1);
    });

    it('A page failure mid-listing propagates instead of returning a partial list', async () => {
      await seedBacking(
        edge,
        keysUnder('conquarrow/p/', 1500).map((key) => [key, '{}'] as const),
      );
      const failure = s3Error('InternalError', 500);
      edge.s3.probe.command(ListObjectsV2Command).once().forward();
      edge.s3.probe.command(ListObjectsV2Command).once().reject(failure);

      const reason = await rejectionOf(Promise.resolve(edge.store.listPrefix('conquarrow/p/')));

      expect(reason).toBe(failure);
      edge.s3.probe.command(ListObjectsV2Command).expect.calledTimes(2);
    });
  });

  describe('Rule: Notify hygiene through the probed notifier', () => {
    it('A gone connection is forgotten and a live one is kept', async () => {
      const notifier = attachNotifier(edge);
      const { api, ws } = apiOver(edge.store, notifierPort(notifier));
      const game = await startOpenedGame(api, THREE_HUMAN);
      await storeConnection(ws, BOB, BOB_CONN);
      await storeConnection(ws, CAROL, CAROL_CONN);
      notifier.probe.on('post').always().answer(200);
      notifier.probe
        .on('post')
        .filter((call) => call.args[0] === BOB_CONN, `connectionId === '${BOB_CONN}'`)
        .always()
        .answer(410);

      const res = await postEndTurn(api, game, ALICE, 0);

      expectStatus(res, 200);
      expect(versionOf(parseBody(res))).toBe(1);
      const posted = notifier.probe.on('post').calls.map((call) => call.args[0]);
      expect(posted).toContain(CAROL_CONN);
      expect(await backingBody(edge, connectionKey(bobHash(), BOB_CONN))).toBeUndefined();
      expect(await backingBody(edge, connectionIdKey(BOB_CONN))).toBeUndefined();
      expect(await backingBody(edge, connectionKey(carolHash(), CAROL_CONN))).toBeDefined();
      expect(await backingBody(edge, connectionIdKey(CAROL_CONN))).toBeDefined();
    });

    it('A rejected post does not stop later notifies and keeps that connection', async () => {
      const notifier = attachNotifier(edge);
      const { api, ws } = apiOver(edge.store, notifierPort(notifier));
      const game = await startOpenedGame(api, THREE_HUMAN);
      await storeConnection(ws, BOB, BOB_CONN);
      await storeConnection(ws, CAROL, CAROL_CONN);
      notifier.probe.on('post').once().reject(new Error('socket reset'));
      notifier.probe.on('post').always().answer(200);

      const res = await postEndTurn(api, game, ALICE, 0);

      expectStatus(res, 200);
      expect(versionOf(parseBody(res))).toBe(1);
      const posted = notifier.probe.on('post').calls.map((call) => call.args[0]);
      expect([...posted].sort(utf16Order)).toEqual([BOB_CONN, CAROL_CONN]);
      expect(await backingBody(edge, connectionKey(bobHash(), BOB_CONN))).toBeDefined();
      expect(await backingBody(edge, connectionIdKey(BOB_CONN))).toBeDefined();
      expect(await backingBody(edge, connectionKey(carolHash(), CAROL_CONN))).toBeDefined();
      expect(await backingBody(edge, connectionIdKey(CAROL_CONN))).toBeDefined();
    });

    it('Heuristic seats and the mover are never posted', async () => {
      const notifier = attachNotifier(edge);
      answer200ToEveryPost(notifier);
      const { api, ws } = apiOver(edge.store, notifierPort(notifier));
      const game = await startOpenedGame(api, TWO_HUMAN_HEURISTIC);
      await storeConnection(ws, ALICE, ALICE_CONN);
      await storeConnection(ws, BOB, BOB_CONN);

      await postEndTurn(api, game, ALICE, 0);

      expect(notifier.probe.on('post').calls.map((call) => call.args[0])).toEqual([BOB_CONN]);
      const aliceListings = edge.s3.probe
        .command(ListObjectsV2Command)
        .calls.filter(
          (call) => call.command.input.Prefix === `conquarrow/connections/${aliceHash()}/`,
        );
      expect(aliceListings).toEqual([]);
    });

    it('With no notifier configured no connection prefix is listed', async () => {
      const { api, ws } = apiOver(edge.store);
      const game = await startOpenedGame(api, TWO_HUMAN_HEURISTIC);
      await storeConnection(ws, BOB, BOB_CONN);

      const res = await postEndTurn(api, game, ALICE, 0);

      expectStatus(res, 200);
      expect(versionOf(parseBody(res))).toBe(1);
      const connectionListings = edge.s3.probe
        .command(ListObjectsV2Command)
        .calls.filter(
          (call) => call.command.input.Prefix?.startsWith('conquarrow/connections/') === true,
        );
      expect(connectionListings).toEqual([]);
    });
  });

  describe('Rule: Handler races on the real store', () => {
    it("A racing state write between the move's read and its conditional put is a 412, not a 500", async () => {
      const notifier = attachNotifier(edge);
      answer200ToEveryPost(notifier);
      const { api, ws } = apiOver(edge.store, notifierPort(notifier));
      const game = await startOpenedGame(api, TWO_HUMAN_HEURISTIC);
      await storeConnection(ws, BOB, BOB_CONN);
      const stateKey = gameStateKey(game.groupHash, game.gameNumber);
      const otherWritersBody = JSON.stringify({ version: 1, state: 'another writer' });
      const held = edge.s3.probe
        .command(PutObjectCommand)
        .filter(
          (call) =>
            call.command.input.Key === stateKey && call.command.input.IfMatch !== undefined,
          'state.json put carrying IfMatch',
        )
        .expect.intercept();

      const response = postEndTurn(api, game, ALICE, 0);
      const pending = await held;
      await rawPut(edge, stateKey, otherWritersBody);
      pending.forward();
      const res = await response;

      expectStatus(res, 412);
      expect(await backingBody(edge, stateKey)).toBe(otherWritersBody);
      notifier.probe.on('post').expect.neverCalled();
    });
  });
});
