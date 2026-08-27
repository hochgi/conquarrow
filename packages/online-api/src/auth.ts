import type { OnlineHttpResult, OnlineRequest } from '@conquarrow/contracts';
import type { GoogleVerifier } from './api-types';
import { sanitiseDisplayName } from './display-name';
import { userHashFromSub } from './hashing';
import { unauthorized } from './json-result';

export const authorizationOf = (request: OnlineRequest): string | undefined =>
  request.headers?.authorization;

export type UserAuth =
  | { readonly ok: true; readonly userHash: string; readonly displayName?: string }
  | { readonly ok: false; readonly result: OnlineHttpResult };

export const requireUserHash = async (
  google: GoogleVerifier,
  authorization: string | undefined,
): Promise<UserAuth> => {
  const verified = await Promise.resolve(google.verify(authorization));
  if (!verified.ok) return { ok: false, result: unauthorized() };
  const displayName = sanitiseDisplayName(verified.displayName);
  if (displayName === undefined) return { ok: true, userHash: userHashFromSub(verified.sub) };
  return { ok: true, userHash: userHashFromSub(verified.sub), displayName };
};
