import type { GoogleVerifier, GoogleVerifyResult } from './api-types';
import { sanitiseDisplayName } from './display-name';
import { asRecord } from './invite-record';

export interface TokenInfoDeps {
  readonly clientIds: readonly string[];
  readonly clock: () => number;
  readonly fetch: typeof fetch;
}

const bearerToken = (authorizationHeader: string | undefined): GoogleVerifyResult | string => {
  if (authorizationHeader === undefined || authorizationHeader === '') {
    return { ok: false, reason: 'missing' };
  }
  const match = /^Bearer\s+(\S+)$/.exec(authorizationHeader);
  const token = match?.[1];
  if (token === undefined) return { ok: false, reason: 'invalid' };
  return token;
};

const expSeconds = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

const verifyTokenInfo = async (
  deps: TokenInfoDeps,
  authorizationHeader: string | undefined,
): Promise<GoogleVerifyResult> => {
  const token = bearerToken(authorizationHeader);
  if (typeof token !== 'string') return token;
  if (deps.clientIds.length === 0) return { ok: false, reason: 'invalid' };
  try {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`;
    const res = await deps.fetch(url);
    if (!res.ok) return { ok: false, reason: 'invalid' };
    const rec = asRecord(await res.json());
    if (rec === undefined) return { ok: false, reason: 'invalid' };
    const sub = rec['sub'];
    const aud = rec['aud'];
    if (typeof sub !== 'string' || sub.length === 0) return { ok: false, reason: 'invalid' };
    if (typeof aud !== 'string' || !deps.clientIds.includes(aud)) {
      return { ok: false, reason: 'invalid' };
    }
    const exp = expSeconds(rec['exp']);
    if (exp === undefined) return { ok: false, reason: 'invalid' };
    if (deps.clock() / 1000 >= exp) return { ok: false, reason: 'expired' };
    const displayName = displayNameFromClaims(rec);
    if (displayName === undefined) return { ok: true, sub };
    return { ok: true, sub, displayName };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
};

const displayNameFromClaims = (rec: Record<string, unknown>): string | undefined => {
  const given = rec['given_name'];
  const name = rec['name'];
  const raw = typeof given === 'string' ? given : typeof name === 'string' ? name : undefined;
  return sanitiseDisplayName(raw);
};

/** Live Google ID-token check via tokeninfo. Uses `sub`, `aud`, `exp`, and GIS name claims. */
export const createGoogleTokenInfoVerifier = (deps: TokenInfoDeps): GoogleVerifier => ({
  verify: (authorizationHeader) => verifyTokenInfo(deps, authorizationHeader),
});
