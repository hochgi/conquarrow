/**
 * Lambda entries — the fallbacks: missing, empty and wrongly-typed event fields,
 * sparse env, and the post leaf's error mapping.
 *
 * Characterisation: these encode shipped behaviour of the entry files (see
 * `online-entry.core.test.ts`), so they pass on arrival.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOnlineWs } from '../src/create-online-ws';
import { readEntryEnv } from '../src/entry-env';
import { toOnlineRequest } from '../src/http-event';
import { createWsHandler, toWsAction } from '../src/ws-event';
import { ALICE, ALICE_CONN, fakeGoogle, mapStore, sequentialBytes } from './support';
import {
  PAYLOAD,
  type PostLeafRig,
  awsError,
  createPostLeafRig,
  rejectionOf,
  sentCommands,
  wsEvent,
} from './online-entry.support';

describe('online-entry — edge cases', () => {
  describe('Rule: an unreadable HTTP event degrades to GET /', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'GET /me'],
      ['an array', [{ rawPath: '/me' }]],
      ['an empty object', {}],
    ])('An event that is %s maps to a bare GET /', (_label, event) => {
      expect(toOnlineRequest(event)).toStrictEqual({ method: 'GET', path: '/' });
    });
  });

  describe('Rule: the method is POST only when the event says POST', () => {
    it('A v2 method other than POST is GET', () => {
      expect(toOnlineRequest({ requestContext: { http: { method: 'PUT' } } }).method).toBe('GET');
    });

    it('A v1 method other than POST is GET', () => {
      expect(toOnlineRequest({ httpMethod: 'DELETE' }).method).toBe('GET');
    });

    it('A v1 POST without a requestContext is POST', () => {
      expect(toOnlineRequest({ httpMethod: 'POST' }).method).toBe('POST');
    });

    it('A v2 POST without httpMethod is POST', () => {
      expect(toOnlineRequest({ requestContext: { http: { method: 'POST' } } }).method).toBe(
        'POST',
      );
    });

    it('A requestContext without http falls back to httpMethod', () => {
      expect(toOnlineRequest({ requestContext: { stage: 'prod' }, httpMethod: 'POST' }).method).toBe(
        'POST',
      );
    });
  });

  describe('Rule: the path prefers a non-empty rawPath, then path, then /', () => {
    it('rawPath wins over path', () => {
      expect(toOnlineRequest({ rawPath: '/raw', path: '/v1' }).path).toBe('/raw');
    });

    it('An empty rawPath falls back to path', () => {
      expect(toOnlineRequest({ rawPath: '', path: '/v1' }).path).toBe('/v1');
    });

    it('A non-string rawPath falls back to path', () => {
      expect(toOnlineRequest({ rawPath: 7, path: '/v1' }).path).toBe('/v1');
    });

    it('An empty path falls back to /', () => {
      expect(toOnlineRequest({ path: '' }).path).toBe('/');
    });

    it('A non-string path falls back to /', () => {
      expect(toOnlineRequest({ path: ['/v1'] }).path).toBe('/');
    });
  });

  describe('Rule: only string authorization / if-match headers are carried', () => {
    it('No headers object means no headers', () => {
      expect(toOnlineRequest({ rawPath: '/me' })).not.toHaveProperty('headers');
    });

    it('Headers carrying neither field mean no headers', () => {
      expect(toOnlineRequest({ headers: { 'content-type': 'application/json' } })).not.toHaveProperty(
        'headers',
      );
    });

    it('Authorization alone is carried without ifMatch', () => {
      expect(toOnlineRequest({ headers: { authorization: 'Bearer a' } }).headers).toStrictEqual({
        authorization: 'Bearer a',
      });
    });

    it('If-match alone is carried without authorization', () => {
      expect(toOnlineRequest({ headers: { 'if-match': '"0"' } }).headers).toStrictEqual({
        ifMatch: '"0"',
      });
    });

    it('Header names match case-insensitively', () => {
      expect(
        toOnlineRequest({ headers: { Authorization: 'Bearer a', 'If-Match': '"3"' } }).headers,
      ).toStrictEqual({ authorization: 'Bearer a', ifMatch: '"3"' });
    });

    it('The lowercase spelling wins when both are present', () => {
      expect(
        toOnlineRequest({ headers: { AUTHORIZATION: 'Bearer upper', authorization: 'Bearer lower' } })
          .headers,
      ).toStrictEqual({ authorization: 'Bearer lower' });
    });

    it('Non-string header values are dropped', () => {
      expect(
        toOnlineRequest({ headers: { authorization: 42, 'if-match': ['"0"'] } }),
      ).not.toHaveProperty('headers');
    });

    it('A headers field that is not an object means no headers', () => {
      expect(toOnlineRequest({ headers: 'authorization: Bearer a' })).not.toHaveProperty('headers');
    });
  });

  describe('Rule: query merges queryStringParameters over rawQueryString', () => {
    it('No query fields means no query', () => {
      expect(toOnlineRequest({ rawPath: '/me' })).not.toHaveProperty('query');
    });

    it('An empty rawQueryString and no parameters mean no query', () => {
      expect(toOnlineRequest({ rawQueryString: '', queryStringParameters: {} })).not.toHaveProperty(
        'query',
      );
    });

    it('rawQueryString alone is decoded', () => {
      expect(toOnlineRequest({ rawQueryString: 'since=2&who=a%20b' }).query).toStrictEqual({
        since: '2',
        who: 'a b',
      });
    });

    it('queryStringParameters win over rawQueryString; raw-only keys are added', () => {
      expect(
        toOnlineRequest({
          queryStringParameters: { since: '1' },
          rawQueryString: 'since=2&extra=x',
        }).query,
      ).toStrictEqual({ since: '1', extra: 'x' });
    });

    it('Non-string parameter values are dropped', () => {
      expect(
        toOnlineRequest({ queryStringParameters: { since: null, n: 3, ok: 'y' } }).query,
      ).toStrictEqual({ ok: 'y' });
    });

    it('A non-string rawQueryString is ignored', () => {
      expect(toOnlineRequest({ rawQueryString: { since: '2' } })).not.toHaveProperty('query');
    });
  });

  describe('Rule: only a string body is carried, decoded when base64-flagged', () => {
    it('A missing body means no body', () => {
      expect(toOnlineRequest({ rawPath: '/me' })).not.toHaveProperty('body');
    });

    it('A non-string body means no body', () => {
      expect(toOnlineRequest({ body: { kind: 'endTurn' } })).not.toHaveProperty('body');
    });

    it('An empty string body is carried', () => {
      expect(toOnlineRequest({ body: '' }).body).toBe('');
    });

    it('A truthy-but-not-true isBase64Encoded leaves the body as sent', () => {
      expect(toOnlineRequest({ body: 'e30=', isBase64Encoded: 'true' }).body).toBe('e30=');
    });
  });

  describe('Rule: a WebSocket event without a connection or a known route fails closed', () => {
    it.each([
      ['no event', undefined],
      ['a non-object event', 'connect'],
      ['no requestContext', { queryStringParameters: { access_token: ALICE.bearer } }],
      ['a non-object requestContext', { requestContext: 'c1' }],
      ['no connectionId', { requestContext: { routeKey: '$connect' } }],
      ['an empty connectionId', { requestContext: { connectionId: '', routeKey: '$connect' } }],
      ['a non-string connectionId', { requestContext: { connectionId: 7, routeKey: '$connect' } }],
      ['an unknown route', { requestContext: { connectionId: 'c1', routeKey: '$default' } }],
      ['an unknown eventType', { requestContext: { connectionId: 'c1', eventType: 'MESSAGE' } }],
      ['no route at all', { requestContext: { connectionId: 'c1' } }],
    ])('%s is 401 and touches no store', async (_label, event) => {
      const s3 = new Map<string, string>();
      const handler = createWsHandler(
        createOnlineWs({
          google: fakeGoogle(),
          s3: mapStore(s3),
          clock: () => 0,
          randomBytes: sequentialBytes(),
        }),
      );

      expect(toWsAction(event)).toStrictEqual({ route: 'unauthorized' });
      expect(await handler(event)).toStrictEqual({ statusCode: 401 });
      expect(s3.size).toBe(0);
    });

    it('$connect without a usable access_token reaches the port without one, and is 401', async () => {
      const s3 = new Map<string, string>();
      const handler = createWsHandler(
        createOnlineWs({
          google: fakeGoogle(),
          s3: mapStore(s3),
          clock: () => 0,
          randomBytes: sequentialBytes(),
        }),
      );
      const noToken = wsEvent(ALICE_CONN, '$connect');

      expect(toWsAction(noToken)).toStrictEqual({
        route: '$connect',
        request: { connectionId: ALICE_CONN },
      });
      expect(await handler(noToken)).toStrictEqual({ statusCode: 401 });
      expect(s3.size).toBe(0);
    });
  });

  describe('Rule: only a non-empty string access_token is carried', () => {
    it.each([
      ['an empty access_token', { access_token: '' }],
      ['a non-string access_token', { access_token: ['t'] }],
      ['query without access_token', { other: 't' }],
      ['a non-object query', 'access_token=t'],
    ])('%s means no accessToken', (_label, queryStringParameters) => {
      expect(
        toWsAction({
          requestContext: { connectionId: ALICE_CONN, routeKey: '$connect' },
          queryStringParameters,
        }),
      ).toStrictEqual({ route: '$connect', request: { connectionId: ALICE_CONN } });
    });
  });

  describe('Rule: routeKey decides before eventType', () => {
    it('routeKey $disconnect wins over eventType CONNECT', () => {
      expect(
        toWsAction({
          requestContext: { connectionId: ALICE_CONN, routeKey: '$disconnect', eventType: 'CONNECT' },
        }),
      ).toStrictEqual({ route: '$disconnect', request: { connectionId: ALICE_CONN } });
    });

    it('An unknown routeKey falls back to eventType', () => {
      expect(
        toWsAction({
          requestContext: { connectionId: ALICE_CONN, routeKey: '$default', eventType: 'CONNECT' },
        }),
      ).toStrictEqual({ route: '$connect', request: { connectionId: ALICE_CONN } });
    });
  });

  describe('Rule: sparse env degrades to no client IDs, an empty bucket and no notifier', () => {
    it('An empty env', () => {
      expect(readEntryEnv({})).toStrictEqual({ googleClientIds: [], matchBucket: '' });
    });

    it('Client IDs are trimmed and blanks dropped', () => {
      expect(readEntryEnv({ GOOGLE_CLIENT_IDS: ' a , ,b,, ' }).googleClientIds).toStrictEqual(['a', 'b']);
    });

    it('An empty WS endpoint means no notifier', () => {
      expect(readEntryEnv({ WS_MANAGEMENT_ENDPOINT: '' })).toStrictEqual({
        googleClientIds: [],
        matchBucket: '',
      });
    });
  });

  describe('Rule: the post leaf maps a gone socket to 410 and rethrows everything else', () => {
    let leaf: PostLeafRig;

    beforeEach(() => {
      leaf = createPostLeafRig();
    });

    afterEach(async () => {
      await leaf.close();
    });

    it('GoneException by name is 410', async () => {
      leaf.client.probe.on('send').always().reject(awsError('GoneException'));

      expect(await leaf.post(ALICE_CONN, PAYLOAD)).toBe(410);
      expect(sentCommands(leaf)).toHaveLength(1);
    });

    it('Any error carrying HTTP 410 is 410', async () => {
      leaf.client.probe
        .on('send')
        .always()
        .reject(awsError('UnknownError', { httpStatusCode: 410 }));

      expect(await leaf.post(ALICE_CONN, PAYLOAD)).toBe(410);
    });

    it.each([
      ['a 403 ForbiddenException', awsError('ForbiddenException', { httpStatusCode: 403 })],
      ['an error without $metadata', awsError('TimeoutError')],
      ['an error with null $metadata', awsError('TimeoutError', null)],
      ['an error with a non-numeric status', awsError('Weird', { httpStatusCode: '410' })],
    ])('%s is rethrown unchanged', async (_label, failure) => {
      leaf.client.probe.on('send').always().reject(failure);

      expect(await rejectionOf(Promise.resolve(leaf.post(ALICE_CONN, PAYLOAD)))).toBe(failure);
    });
  });
});
