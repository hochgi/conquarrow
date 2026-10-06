/**
 * Lambda entries — the fallbacks: missing, empty and wrongly-typed event fields.
 *
 * Characterisation: these encode shipped behaviour of the entry mapping, so they
 * pass on arrival.
 */

import { describe, expect, it } from 'vitest';
import { toOnlineRequest } from '../src/http';
import { handler as wsHandler } from '../src/ws';

describe('online-entry — edge cases', () => {
  describe('Rule: an unreadable HTTP event degrades to GET /', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'GET /me'],
      ['an array', [{ rawPath: '/me' }]],
      ['an empty object', {}],
    ])('An event that is %s maps to a bare GET /', (_label, event) => {
      expect(toOnlineRequest(event)).toEqual({ method: 'GET', path: '/' });
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
      expect(toOnlineRequest({ headers: { authorization: 'Bearer a' } }).headers).toEqual({
        authorization: 'Bearer a',
      });
    });

    it('If-match alone is carried without authorization', () => {
      expect(toOnlineRequest({ headers: { 'if-match': '"0"' } }).headers).toEqual({
        ifMatch: '"0"',
      });
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
      expect(toOnlineRequest({ rawQueryString: 'since=2&who=a%20b' }).query).toEqual({
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
      ).toEqual({ since: '1', extra: 'x' });
    });

    it('Non-string parameter values are dropped', () => {
      expect(
        toOnlineRequest({ queryStringParameters: { since: null, n: 3, ok: 'y' } }).query,
      ).toEqual({ ok: 'y' });
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
      ['no requestContext', { queryStringParameters: { access_token: 'alice-token' } }],
      ['an empty connectionId', { requestContext: { connectionId: '', routeKey: '$connect' } }],
      ['a non-string connectionId', { requestContext: { connectionId: 7, routeKey: '$connect' } }],
      ['an unknown route', { requestContext: { connectionId: 'c1', routeKey: '$default' } }],
      ['an unknown eventType', { requestContext: { connectionId: 'c1', eventType: 'MESSAGE' } }],
      ['no route at all', { requestContext: { connectionId: 'c1' } }],
      ['$connect without access_token', { requestContext: { connectionId: 'c1', routeKey: '$connect' } }],
      [
        '$connect with an empty access_token',
        {
          requestContext: { connectionId: 'c1', routeKey: '$connect' },
          queryStringParameters: { access_token: '' },
        },
      ],
    ])('%s is 401', async (_label, event) => {
      expect(await wsHandler(event)).toEqual({ statusCode: 401 });
    });
  });
});
