/**
 * Membership for the per-game routes: signed in, the game exists, and the
 * caller is bound to one of its seats.
 *
 * Its own module so that both `game-handlers` (GET/POST the position) and
 * `game-log` (P49's read route) can use it without importing each other.
 */

import type { InviteSeat, OnlineHttpResult, OnlineRequest } from '@conquarrow/contracts';
import type { OnlineApiDeps } from './api-types';
import { authorizationOf, requireUserHash } from './auth';
import { indexOfBoundUser, parseGameMeta } from './invite-record';
import { forbidden, notFound } from './json-result';
import { gameMetaKey } from './s3-keys';
import { getObject } from './store-io';

export type MemberCheck =
  | { readonly ok: true; readonly userHash: string; readonly seats: readonly InviteSeat[] }
  | { readonly ok: false; readonly result: OnlineHttpResult };

export const requireMember = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  groupHash: string,
  gameNumber: string,
): Promise<MemberCheck> => {
  const user = await requireUserHash(deps.google, authorizationOf(request));
  if (!user.ok) return user;
  const raw = await getObject(deps.s3, gameMetaKey(groupHash, gameNumber));
  const meta = raw === undefined ? undefined : parseGameMeta(raw);
  if (meta === undefined) return { ok: false, result: notFound() };
  if (indexOfBoundUser(meta.seats, user.userHash) < 0) {
    return { ok: false, result: forbidden() };
  }
  return { ok: true, userHash: user.userHash, seats: meta.seats };
};
