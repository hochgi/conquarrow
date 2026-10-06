/**
 * Lambda entries — the shapes API Gateway hands `http.ts` / `ws.ts`, mapped onto
 * the in-process ports.
 *
 * Characterisation: these encode shipped behaviour of the entry mapping, so they
 * pass on arrival.
 */

import { describe, expect, it } from 'vitest';
import { toOnlineRequest } from '../src/http';

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

      expect(request).toEqual({
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

      expect(request).toEqual({
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

      expect(request).toEqual({ method: 'POST', path: '/invites', body: '{}' });
    });

    it('Query parameters are decoded into query', () => {
      const request = toOnlineRequest({
        rawPath: '/games/g/000001/log',
        requestContext: { http: { method: 'GET' } },
        queryStringParameters: { since: '4' },
        rawQueryString: 'since=4',
      });

      expect(request.query).toEqual({ since: '4' });
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
});
