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
    expect(result).toEqual({ ok: true, sub: 'alice-sub' });
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

  it('rejects a non-Bearer header', async () => {
    expect(await verify(fakeFetch(200, validClaims), 'Basic x')).toEqual({
      ok: false,
      reason: 'invalid',
    });
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
