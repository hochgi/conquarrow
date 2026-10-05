/**
 * docs/spec/online-edge-probes/online-edge-probes.core.feature — one test per scenario.
 *
 * Characterisation (P68 BSSN 5): these encode shipped behaviour of
 * `src/s3-store.ts` and `src/notify.ts`, so they pass on arrival. Each was shown
 * able to fail by hand-mutating the production line it guards.
 *
 * @see docs/spec/online-edge-probes/online-edge-probes.md
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALICE,
  ALICE_CONN,
  BOB,
  BOB_CONN,
  GAME_ONE,
  TWO_HUMAN_HEURISTIC,
  aliceBobGroupHash,
  createOpenInvite,
  expectStatus,
  gameLogKey,
  gameStateKey,
  getGame,
  parseBody,
  parsePersisted,
  postAccept,
  postStart,
  versionOf,
} from './support';
import {
  BUCKET,
  type EdgeRig,
  answer200ToEveryPost,
  apiOver,
  attachNotifier,
  backingBody,
  createEdgeRig,
  keysUnder,
  notifierPort,
  postEndTurn,
  seedBacking,
  startOpenedGame,
  storeConnection,
  utf16Order,
} from './online-edge-probes.support';

const BOB_CONN_2 = 'conn-bob-2';

let edge: EdgeRig;

beforeEach(() => {
  edge = createEdgeRig();
});

afterEach(async () => {
  await edge.close();
});

describe('online-edge-probes — core', () => {
  describe('Rule: Reads and writes round-trip through a real S3Client', () => {
    it('A put is readable back as the same body', async () => {
      await edge.store.put('conquarrow/k1', '{"a":1}');
      const result = await edge.store.get('conquarrow/k1');

      expect(result).toBe('{"a":1}');
      const puts = edge.s3.probe.command(PutObjectCommand).calls;
      expect(puts).toHaveLength(1);
      expect(puts[0]?.command.input).toMatchObject({
        Bucket: BUCKET,
        Key: 'conquarrow/k1',
        ContentType: 'application/json',
      });
    });

    it('A key never written reads as undefined', async () => {
      const result = await edge.store.get('conquarrow/missing');

      expect(result).toBeUndefined();
      const gets = edge.s3.probe.command(GetObjectCommand).calls;
      expect(gets.map((call) => call.command.input.Key)).toEqual(['conquarrow/missing']);
    });

    it('A deleted key reads as undefined', async () => {
      await edge.store.put('conquarrow/k1', 'x');

      await edge.store.delete('conquarrow/k1');
      const result = await edge.store.get('conquarrow/k1');

      expect(result).toBeUndefined();
    });
  });

  describe('Rule: Conditional writes use real ETags', () => {
    it('Create-only put on an absent key creates it', async () => {
      await edge.store.put('conquarrow/k1', 'first', { ifNoneMatch: '*' });

      const puts = edge.s3.probe.command(PutObjectCommand).calls;
      expect(puts).toHaveLength(1);
      expect(puts[0]?.command.input.IfNoneMatch).toBe('*');
      expect(await backingBody(edge, 'conquarrow/k1')).toBe('first');
    });

    it('Compare-and-swap with the current body writes and sends the read ETag', async () => {
      const etags = await seedBacking(edge, [['conquarrow/k1', 'v0']]);
      const etagOfV0 = etags.get('conquarrow/k1');
      expect(etagOfV0).toBeDefined();

      await edge.store.put('conquarrow/k1', 'v1', { ifMatch: 'v0' });

      const order = edge.s3.probe.calls.map((call) => call.commandName);
      const getAt = order.indexOf('GetObjectCommand');
      const putAt = order.indexOf('PutObjectCommand');
      expect(getAt).toBeGreaterThanOrEqual(0);
      expect(putAt).toBeGreaterThan(getAt);
      const gets = edge.s3.probe.command(GetObjectCommand).calls;
      expect(gets[0]?.command.input.Key).toBe('conquarrow/k1');
      const puts = edge.s3.probe.command(PutObjectCommand).calls;
      expect(puts).toHaveLength(1);
      expect(puts[0]?.command.input.IfMatch).toBe(etagOfV0);
      expect(await backingBody(edge, 'conquarrow/k1')).toBe('v1');
    });
  });

  describe('Rule: Listing follows continuation tokens past the page cap', () => {
    it('A prefix holding more than two pages lists every key, sorted', async () => {
      const u1 = 'conquarrow/connections/u1/';
      const u2 = 'conquarrow/connections/u2/';
      const underU1 = keysUnder(u1, 2345);
      await seedBacking(edge, [...underU1, ...keysUnder(u2, 3)].map((key) => [key, '{}'] as const));

      const result = await edge.store.listPrefix(u1);

      expect(result).toEqual([...underU1].sort(utf16Order));
      const lists = [...edge.s3.probe.command(ListObjectsV2Command).calls];
      expect(lists).toHaveLength(3);
      expect(lists.map((call) => call.command.input.Prefix)).toEqual([u1, u1, u1]);
      expect(lists[0]?.command.input.ContinuationToken).toBeUndefined();
      // upstream: hochgi/test-kit — a forwarded call's response is not recorded
      // on `.calls`, so the NextContinuationToken each page returned is
      // re-derived by paging the (unchanged, deterministic) backing directly.
      const first = await edge.s3.adapter.send(
        new ListObjectsV2Command({ Bucket: BUCKET, Prefix: u1 }),
      );
      const second = await edge.s3.adapter.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: u1,
          ...(first.NextContinuationToken === undefined
            ? {}
            : { ContinuationToken: first.NextContinuationToken }),
        }),
      );
      expect(first.NextContinuationToken).toBeDefined();
      expect(second.NextContinuationToken).toBeDefined();
      expect(lists[1]?.command.input.ContinuationToken).toBe(first.NextContinuationToken);
      expect(lists[2]?.command.input.ContinuationToken).toBe(second.NextContinuationToken);
    });
  });

  describe('Rule: Notify goes through a probed PostToConnection', () => {
    it('A successful move notifies every connection of the other bound humans only', async () => {
      const notifier = attachNotifier(edge);
      answer200ToEveryPost(notifier);
      const { api, ws } = apiOver(edge.store, notifierPort(notifier));
      const game = await startOpenedGame(api, TWO_HUMAN_HEURISTIC);
      await storeConnection(ws, ALICE, ALICE_CONN);
      await storeConnection(ws, BOB, BOB_CONN);
      await storeConnection(ws, BOB, BOB_CONN_2);

      const res = await postEndTurn(api, game, ALICE, 0);

      expectStatus(res, 200);
      expect(versionOf(parseBody(res))).toBe(1);
      const posts = notifier.probe.on('post').calls;
      expect(posts.map((call) => call.args[0])).toEqual([BOB_CONN, BOB_CONN_2]);
      for (const call of posts) {
        expect(call.args[1]).toEqual({
          type: 'stateChanged',
          version: 1,
          groupHash: game.groupHash,
          gameNumber: game.gameNumber,
        });
      }
      expect(posts.filter((call) => call.args[0] === ALICE_CONN)).toEqual([]);
    });
  });

  describe('Rule: A handler flow runs end to end on the real store', () => {
    it('Invite, accept, start, open and move persist through the S3 adapter', async () => {
      const notifier = attachNotifier(edge);
      answer200ToEveryPost(notifier);
      const { api } = apiOver(edge.store, notifierPort(notifier));
      const groupHash = aliceBobGroupHash();
      const stateKey = gameStateKey(groupHash, GAME_ONE);
      const statePuts = () =>
        edge.s3.probe
          .command(PutObjectCommand)
          .calls.filter((call) => call.command.input.Key === stateKey);

      const token = await createOpenInvite(api, ALICE, TWO_HUMAN_HEURISTIC);
      expectStatus(await postAccept(api, token, BOB.bearer), 200);
      expectStatus(await postStart(api, token, ALICE.bearer), 200);
      const opened = await getGame(api, groupHash, GAME_ONE, ALICE.bearer);

      expectStatus(opened, 200);
      expect(versionOf(parseBody(opened))).toBe(0);
      expect(statePuts().map((call) => call.command.input.IfNoneMatch)).toEqual(['*']);
      const head = await edge.s3.adapter.send(
        new HeadObjectCommand({ Bucket: BUCKET, Key: stateKey }),
      );
      expect(head.ETag).toBeDefined();

      const moved = await postEndTurn(api, { groupHash, gameNumber: GAME_ONE }, ALICE, 0);

      expectStatus(moved, 200);
      expect(versionOf(parseBody(moved))).toBe(1);
      const casPuts = statePuts().filter((call) => call.command.input.IfMatch !== undefined);
      expect(casPuts.map((call) => call.command.input.IfMatch)).toEqual([head.ETag]);
      expect(parsePersisted(await backingBody(edge, stateKey)).version).toBe(1);
      const log = await backingBody(edge, gameLogKey(groupHash, GAME_ONE));
      expect(log).toBeDefined();
      expect(log?.length ?? 0).toBeGreaterThan(0);
      const bobView = expectStatus(await getGame(api, groupHash, GAME_ONE, BOB.bearer), 200);
      expect(versionOf(parseBody(bobView))).toBe(1);
    });
  });
});
