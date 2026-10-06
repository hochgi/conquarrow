/**
 * Adapter tests for the production Google tokeninfo verifier.
 * Port-level P17 tests inject `fakeGoogle()`; this file stubs fetch/clock.
 */

import { describe, expect, it } from 'vitest';
import type { TokenInfoDeps } from '../src/google-tokeninfo';
import { createGoogleTokenInfoVerifier } from '../src/google-tokeninfo';

const CLIENT = 'pages.example.apps.googleusercontent.com';
const OTHER = 'other.apps.googleusercontent.com';
const NOW_MS = 1_700_000_000_000;
const NOW_S = 1_700_000_000;
const BEARER = 'Bearer id-token';

type StubResponse = {
  readonly ok: boolean;
  readonly json: () => Promise<unknown>;
};

const stubFetch = (run: () => Promise<StubResponse>): TokenInfoDeps['fetch'] =>
  run as unknown as TokenInfoDeps['fetch'];

const fakeFetch = (status: number, body: unknown): TokenInfoDeps['fetch'] =>
  stubFetch(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      json: () => Promise.resolve(body),
    }),
  );

const trackingFetch = (flag: { called: boolean }, body: unknown): TokenInfoDeps['fetch'] =>
  stubFetch(() => {
    flag.called = true;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    });
  });

const verify = (
  fetchImpl: TokenInfoDeps['fetch'],
  authorizationHeader: string | undefined,
  extras?: { readonly clientIds?: readonly string[]; readonly clock?: () => number },
) =>
  createGoogleTokenInfoVerifier({
    clientIds: extras?.clientIds ?? [CLIENT],
    clock: extras?.clock ?? ((): number => NOW_MS),
    fetch: fetchImpl,
  }).verify(authorizationHeader);

const validClaims = {
  sub: 'alice-sub',
  aud: CLIENT,
  exp: NOW_S + 60,
};

describe('createGoogleTokenInfoVerifier', () => {
  it('accepts a tokeninfo payload with matching aud and unexpired exp', async () => {
    const result = await verify(fakeFetch(200, validClaims), BEARER);
    // Strict: with no name claim the result has no displayName key at all.
    expect(result).toStrictEqual({ ok: true, sub: 'alice-sub' });
  });

  it('accepts a Bearer token separated by more than one space', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(validClaims) }),
    );
    const recording = ((url: string) => {
      urls.push(url);
      return fetchImpl(url);
    }) as unknown as TokenInfoDeps['fetch'];

    expect(await verify(recording, 'Bearer   id-token')).toEqual({ ok: true, sub: 'alice-sub' });
    expect(urls).toEqual(['https://oauth2.googleapis.com/tokeninfo?id_token=id-token']);
  });

  it('ignores a non-string name claim when given_name is absent', async () => {
    const result = await verify(fakeFetch(200, { ...validClaims, name: 42 }), BEARER);
    expect(result).toStrictEqual({ ok: true, sub: 'alice-sub' });
  });

  it('prefers given_name over name as displayName', async () => {
    const result = await verify(
      fakeFetch(200, { ...validClaims, given_name: 'Gilad', name: 'Gilad Hoch' }),
      BEARER,
    );
    expect(result).toEqual({ ok: true, sub: 'alice-sub', displayName: 'Gilad' });
  });

  it('falls back to name when given_name is absent', async () => {
    const result = await verify(fakeFetch(200, { ...validClaims, name: 'Gilad Hoch' }), BEARER);
    expect(result).toEqual({ ok: true, sub: 'alice-sub', displayName: 'Gilad Hoch' });
  });

  it('accepts exp encoded as a decimal string', async () => {
    const result = await verify(
      fakeFetch(200, { ...validClaims, exp: String(NOW_S + 60) }),
      BEARER,
    );
    expect(result).toEqual({ ok: true, sub: 'alice-sub' });
  });

  it('rejects a missing Authorization header without calling fetch', async () => {
    const flag = { called: false };
    expect(await verify(trackingFetch(flag, validClaims), undefined)).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(flag.called).toBe(false);
  });

  it('rejects an empty Authorization header as missing without calling fetch', async () => {
    const flag = { called: false };
    expect(await verify(trackingFetch(flag, validClaims), '')).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(flag.called).toBe(false);
  });

  it('rejects a non-Bearer header', async () => {
    expect(await verify(fakeFetch(200, validClaims), 'Basic x')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it.each([
    ['text before the scheme', 'xBearer id-token'],
    ['a second token after the first', 'Bearer id-token extra'],
  ])('rejects a Bearer header with %s without calling fetch', async (_label, header) => {
    const flag = { called: false };
    expect(await verify(trackingFetch(flag, validClaims), header)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(flag.called).toBe(false);
  });

  it('rejects an empty client-id allowlist without calling fetch', async () => {
    const flag = { called: false };
    expect(await verify(trackingFetch(flag, validClaims), BEARER, { clientIds: [] })).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(flag.called).toBe(false);
  });

  it('rejects a wrong audience', async () => {
    expect(await verify(fakeFetch(200, { ...validClaims, aud: OTHER }), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a non-string sub', async () => {
    expect(await verify(fakeFetch(200, { ...validClaims, sub: 42 }), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a missing or empty sub', async () => {
    expect(await verify(fakeFetch(200, { ...validClaims, sub: '' }), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await verify(fakeFetch(200, { aud: CLIENT, exp: NOW_S + 60 }), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a missing or non-numeric exp', async () => {
    expect(await verify(fakeFetch(200, { sub: 'alice-sub', aud: CLIENT }), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await verify(fakeFetch(200, { ...validClaims, exp: 'soon' }), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it.each([
    ['null', null],
    ['an infinite number (JSON 1e999)', JSON.parse('1e999') as unknown],
  ])('rejects an exp that is %s as invalid', async (_label, exp) => {
    expect(await verify(fakeFetch(200, { ...validClaims, exp }), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects at the exact expiration instant', async () => {
    expect(await verify(fakeFetch(200, { ...validClaims, exp: NOW_S }), BEARER)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a non-2xx tokeninfo response', async () => {
    expect(await verify(fakeFetch(400, { error: 'invalid_token' }), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a non-2xx response even when its body carries valid claims', async () => {
    expect(await verify(fakeFetch(500, validClaims), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a non-object JSON body', async () => {
    expect(await verify(fakeFetch(200, 'not-json-object'), BEARER)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects fetch and JSON failures', async () => {
    expect(
      await verify(stubFetch(() => Promise.reject(new Error('network'))), BEARER),
    ).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const badJson = stubFetch(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new Error('json')),
      }),
    );
    expect(await verify(badJson, BEARER)).toEqual({ ok: false, reason: 'invalid' });
  });
});
