/**
 * Lambda entries — the shapes API Gateway hands `http.ts` / `ws.ts`, mapped onto
 * the in-process ports; the env the entries read; the post leaf they build.
 *
 * Characterisation: these encode shipped behaviour of the entry files (the
 * mapping moved to `http-event.ts` / `ws-event.ts`, the leaf to
 * `apigw-post-to-connection.ts`, the env parsing to `entry-env.ts`), so they
 * pass on arrival.
 *
 * Assertions are `toStrictEqual`: an optional field the event did not supply is
 * absent from the mapped request, not present as `undefined`
 * (`exactOptionalPropertyTypes`).
 */

import { PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOnlineWs } from '../src/create-online-ws';
import { readEntryEnv } from '../src/entry-env';
import { handler as httpEntry } from '../src/http';
import { createHttpHandler, toOnlineRequest } from '../src/http-event';
import { pagesHeuristic } from '../src/pages-heuristic';
import { createWsHandler, toWsAction } from '../src/ws-event';
import {
  ALICE,
  ALICE_CONN,
  aliceHash,
  connectionIdKey,
  connectionKey,
  fakeGoogle,
  mapStore,
  openingMatch,
  parseBody,
  sequentialBytes,
} from './support';
import {
  PAYLOAD,
  type PostLeafRig,
  createPostLeafRig,
  decodedData,
  httpEvent,
  sentCommands,
  wsEvent,
} from './online-entry.support';

const base64Of = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('online-entry — core', () => {
  describe('Rule: an HTTP API event becomes an OnlineRequest', () => {
    it('A v2 GET carries method, raw path and authorization', () => {
      const request = toOnlineRequest({
        version: '2.0',
        rawPath: '/me',
        requestContext: { http: { method: 'GET' } },
        headers: { authorization: 'Bearer alice-token' },
      });

      expect(request).toStrictEqual({
        method: 'GET',
        path: '/me',
        headers: { authorization: 'Bearer alice-token' },
      });
    });

    it('A v2 POST carries if-match and the body', () => {
      const request = toOnlineRequest({
        rawPath: '/games/g/000001/moves',
        requestContext: { http: { method: 'POST' } },
        headers: { authorization: 'Bearer bob-token', 'if-match': '"3"' },
        body: '{"kind":"endTurn"}',
        isBase64Encoded: false,
      });

      expect(request).toStrictEqual({
        method: 'POST',
        path: '/games/g/000001/moves',
        headers: { authorization: 'Bearer bob-token', ifMatch: '"3"' },
        body: '{"kind":"endTurn"}',
      });
    });

    it('A v1 POST reads httpMethod and path', () => {
      const request = toOnlineRequest({
        httpMethod: 'POST',
        path: '/invites',
        requestContext: {},
        body: '{}',
      });

      expect(request).toStrictEqual({ method: 'POST', path: '/invites', body: '{}' });
    });

    it('Query parameters are decoded into query', () => {
      const request = toOnlineRequest({
        rawPath: '/games/g/000001/log',
        requestContext: { http: { method: 'GET' } },
        queryStringParameters: { since: '4' },
        rawQueryString: 'since=4',
      });

      expect(request.query).toStrictEqual({ since: '4' });
    });

    it('A base64 body is decoded as UTF-8', () => {
      const text = '{"name":"Zoë ✓"}';
      const request = toOnlineRequest({
        rawPath: '/invites',
        requestContext: { http: { method: 'POST' } },
        body: base64Of(text),
        isBase64Encoded: true,
      });

      expect(request.body).toBe(text);
    });
  });

  describe('Rule: the HTTP handler routes the mapped request through the online port', () => {
    it('A v2 GET /me with a known bearer answers with the caller hash', async () => {
      const handler = createHttpHandler({
        google: fakeGoogle(),
        s3: mapStore(new Map()),
        clock: () => 0,
        randomBytes: sequentialBytes(),
      });

      const res = await handler(
        httpEvent('GET', '/me', { headers: { authorization: `Bearer ${ALICE.bearer}` } }),
      );

      expect(res.statusCode).toBe(200);
      expect(parseBody(res)).toStrictEqual({ userHash: aliceHash() });
    });

    it('The deployed HTTP entry fails closed on an unauthenticated GET /me', async () => {
      const res = await httpEntry(httpEvent('GET', '/me'));

      expect(res.statusCode).toBe(401);
    });
  });

  describe('Rule: a WebSocket event becomes a $connect or $disconnect request', () => {
    it('$connect carries the connectionId and the access_token', () => {
      expect(toWsAction(wsEvent(ALICE_CONN, '$connect', ALICE.bearer))).toStrictEqual({
        route: '$connect',
        request: { connectionId: ALICE_CONN, accessToken: ALICE.bearer },
      });
    });

    it('$disconnect carries only the connectionId', () => {
      expect(toWsAction(wsEvent(ALICE_CONN, '$disconnect', ALICE.bearer))).toStrictEqual({
        route: '$disconnect',
        request: { connectionId: ALICE_CONN },
      });
    });

    it('eventType CONNECT stands in for a missing routeKey', () => {
      expect(
        toWsAction({
          requestContext: { connectionId: ALICE_CONN, eventType: 'CONNECT' },
          queryStringParameters: { access_token: ALICE.bearer },
        }),
      ).toStrictEqual({
        route: '$connect',
        request: { connectionId: ALICE_CONN, accessToken: ALICE.bearer },
      });
    });

    it('eventType DISCONNECT stands in for a missing routeKey', () => {
      expect(
        toWsAction({ requestContext: { connectionId: ALICE_CONN, eventType: 'DISCONNECT' } }),
      ).toStrictEqual({ route: '$disconnect', request: { connectionId: ALICE_CONN } });
    });
  });

  describe('Rule: the WebSocket handler registers and forgets connections through the port', () => {
    it('$connect then $disconnect writes and then deletes the connection keys', async () => {
      const s3 = new Map<string, string>();
      const handler = createWsHandler(
        createOnlineWs({
          google: fakeGoogle(),
          s3: mapStore(s3),
          clock: () => 0,
          randomBytes: sequentialBytes(),
        }),
      );

      expect(await handler(wsEvent(ALICE_CONN, '$connect', ALICE.bearer))).toStrictEqual({
        statusCode: 200,
      });
      expect([...s3.keys()].sort()).toStrictEqual(
        [connectionIdKey(ALICE_CONN), connectionKey(aliceHash(), ALICE_CONN)].sort(),
      );

      expect(await handler(wsEvent(ALICE_CONN, '$disconnect'))).toStrictEqual({ statusCode: 200 });
      expect([...s3.keys()]).toStrictEqual([]);
    });
  });

  describe('Rule: the entries read their configuration from env', () => {
    it('A full env yields client IDs, bucket and WS endpoint', () => {
      expect(
        readEntryEnv({
          GOOGLE_CLIENT_IDS: 'web.apps.googleusercontent.com,cli.apps.googleusercontent.com',
          MATCH_BUCKET: 'match-bucket',
          WS_MANAGEMENT_ENDPOINT: 'https://ws.example/prod',
        }),
      ).toStrictEqual({
        googleClientIds: ['web.apps.googleusercontent.com', 'cli.apps.googleusercontent.com'],
        matchBucket: 'match-bucket',
        wsManagementEndpoint: 'https://ws.example/prod',
      });
    });
  });

  describe('Rule: the post leaf sends the payload to the connection', () => {
    let leaf: PostLeafRig;

    beforeEach(() => {
      leaf = createPostLeafRig();
    });

    afterEach(async () => {
      await leaf.close();
    });

    it('A delivered post is 200 and sends the JSON payload as bytes to that connection', async () => {
      leaf.client.probe.on('send').always().answer({});

      const status = await leaf.post(ALICE_CONN, PAYLOAD);

      expect(status).toBe(200);
      const sent = sentCommands(leaf);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toBeInstanceOf(PostToConnectionCommand);
      expect(sent[0]?.input.ConnectionId).toBe(ALICE_CONN);
      expect(decodedData(sent[0])).toStrictEqual(PAYLOAD);
    });
  });

  describe('Rule: the deployed heuristic seat plays a legal move', () => {
    it('On an opening two-seat match the production chooser picks one of the legal moves', () => {
      const state = openingMatch(2);

      const move = pagesHeuristic(state);

      expect(makeRules(makeTiling()).legalMoves(state)).toContainEqual(move);
    });
  });
});
