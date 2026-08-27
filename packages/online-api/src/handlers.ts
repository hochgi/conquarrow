import type { InviteBody, OnlineHttpResult, OnlineRequest } from '@conquarrow/contracts';
import type { ObjectStore, OnlineApiDeps } from './api-types';
import { isPreconditionFailed } from './api-types';
import { authorizationOf, requireUserHash } from './auth';
import {
  bytesToHex,
  compareStrings,
  groupHashFromUserHashes,
  padGameNumber,
} from './hashing';
import {
  allHumanSeatsBound,
  asRecord,
  boundHumanHashes,
  indexOfBoundUser,
  nextUnboundHumanIndex,
  parseGameMeta,
  parseInvite,
  parseKinds,
  seatsEqual,
  seatsFromPlan,
  serializeInvite,
  validatePlan,
  type InviteRecord,
} from './invite-record';
import {
  conflict,
  forbidden,
  gone,
  jsonResult,
  notFound,
  unprocessable,
} from './json-result';
import { listLibraryGames } from './library-listing';
import {
  gameMetaKey,
  groupMetaKey,
  inviteKey,
  lobbyKey,
  lobbyPrefix,
  userGroupKey,
} from './s3-keys';
import { getObject, listObjects, putObject } from './store-io';

const POINTER = '{}';

const readInvite = async (
  s3: ObjectStore,
  token: string,
): Promise<InviteRecord | undefined> => {
  const raw = await getObject(s3, inviteKey(token));
  if (raw === undefined) return undefined;
  return parseInvite(raw);
};

const writeInvite = async (
  s3: ObjectStore,
  token: string,
  invite: InviteRecord,
  ifMatch?: string,
): Promise<void> => {
  const options = ifMatch === undefined ? undefined : { ifMatch };
  await putObject(s3, inviteKey(token), serializeInvite(invite), options);
};

const writeLobbyPointer = async (
  s3: ObjectStore,
  userHash: string,
  token: string,
): Promise<void> => {
  await putObject(s3, lobbyKey(userHash, token), POINTER);
};

const publicInvite = (token: string, seats: InviteRecord['seats']): InviteBody => ({
  token,
  seats,
});

const startedIds = (
  invite: InviteRecord,
): { readonly groupHash: string; readonly gameNumber: string } | undefined => {
  if (invite.gameNumber === undefined) return undefined;
  const hashes = boundHumanHashes(invite.seats);
  if (hashes.length === 0) return undefined;
  return {
    groupHash: groupHashFromUserHashes(hashes),
    gameNumber: invite.gameNumber,
  };
};

const closed = (invite: InviteRecord): OnlineHttpResult | undefined => {
  if (invite.status === 'open') return undefined;
  if (invite.status === 'started') return gone('started', startedIds(invite));
  return gone(invite.status);
};

const parseCreateArgs = (
  body: string | undefined,
): { readonly kinds: NonNullable<ReturnType<typeof parseKinds>>; readonly hostSeatIndex?: number } | undefined => {
  if (body === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(parsed);
  if (rec === undefined) return undefined;
  const seatsRaw = rec['seats'];
  if (!Array.isArray(seatsRaw)) return undefined;
  const kinds = parseKinds(seatsRaw);
  if (kinds === undefined) return undefined;
  if (!Object.hasOwn(rec, 'hostSeatIndex')) {
    return { kinds };
  }
  const host = rec['hostSeatIndex'];
  if (typeof host !== 'number' || !Number.isInteger(host)) return undefined;
  return { kinds, hostSeatIndex: host };
};

export const handleMe = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
): Promise<OnlineHttpResult> => {
  const user = await requireUserHash(deps.google, authorizationOf(request));
  if (!user.ok) return user.result;
  return jsonResult(200, { userHash: user.userHash });
};

export const handleCreate = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
): Promise<OnlineHttpResult> => {
  const user = await requireUserHash(deps.google, authorizationOf(request));
  if (!user.ok) return user.result;
  const args = parseCreateArgs(request.body);
  if (args === undefined) return unprocessable();
  const plan = validatePlan(args.kinds, args.hostSeatIndex);
  if (plan === undefined) return unprocessable();
  const token = bytesToHex(deps.randomBytes(32));
  const seats = seatsFromPlan(args.kinds, plan.host, user.userHash);
  await writeInvite(deps.s3, token, {
    status: 'open',
    creatorUserHash: user.userHash,
    seats,
  });
  await writeLobbyPointer(deps.s3, user.userHash, token);
  return jsonResult(201, publicInvite(token, seats));
};

export const handleGetInvite = async (
  deps: OnlineApiDeps,
  token: string,
): Promise<OnlineHttpResult> => {
  const invite = await readInvite(deps.s3, token);
  if (invite === undefined) return notFound();
  const closedResult = closed(invite);
  if (closedResult !== undefined) return closedResult;
  return jsonResult(200, publicInvite(token, invite.seats));
};

export const handleAccept = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  token: string,
): Promise<OnlineHttpResult> => {
  const user = await requireUserHash(deps.google, authorizationOf(request));
  if (!user.ok) return user.result;
  for (;;) {
    const raw = await getObject(deps.s3, inviteKey(token));
    if (raw === undefined) return notFound();
    const invite = parseInvite(raw);
    if (invite === undefined) return notFound();
    const closedResult = closed(invite);
    if (closedResult !== undefined) return closedResult;
    if (indexOfBoundUser(invite.seats, user.userHash) >= 0) {
      await writeLobbyPointer(deps.s3, user.userHash, token);
      return jsonResult(200, publicInvite(token, invite.seats));
    }
    const next = nextUnboundHumanIndex(invite.seats);
    if (next < 0) return conflict();
    const seats = invite.seats.map((seat, index) =>
      index === next ? { kind: 'human' as const, userHash: user.userHash } : seat,
    );
    try {
      await writeInvite(deps.s3, token, { ...invite, seats }, raw);
    } catch (error: unknown) {
      if (isPreconditionFailed(error)) continue;
      throw error;
    }
    await writeLobbyPointer(deps.s3, user.userHash, token);
    return jsonResult(200, publicInvite(token, seats));
  }
};

export const handleRevoke = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  token: string,
): Promise<OnlineHttpResult> => {
  const user = await requireUserHash(deps.google, authorizationOf(request));
  if (!user.ok) return user.result;
  const invite = await readInvite(deps.s3, token);
  if (invite === undefined) return notFound();
  const closedResult = closed(invite);
  if (closedResult !== undefined) return closedResult;
  if (invite.creatorUserHash !== user.userHash) return forbidden();
  await writeInvite(deps.s3, token, { ...invite, status: 'revoked' });
  return jsonResult(200, {});
};

const readNextGameNumber = async (s3: ObjectStore, groupHash: string): Promise<number> => {
  const raw = await getObject(s3, groupMetaKey(groupHash));
  if (raw === undefined) return 1;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return 1;
  }
  const rec = asRecord(parsed);
  const n = rec?.['nextGameNumber'];
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1) return n;
  return 1;
};

const writeGroupNext = async (
  s3: ObjectStore,
  groupHash: string,
  next: number,
): Promise<void> => {
  const raw = await getObject(s3, groupMetaKey(groupHash));
  if (raw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = undefined;
    }
    const current = asRecord(parsed)?.['nextGameNumber'];
    if (typeof current === 'number' && Number.isInteger(current) && current >= next) return;
  }
  await putObject(s3, groupMetaKey(groupHash), JSON.stringify({ nextGameNumber: next }));
};

const writeMembership = async (
  s3: ObjectStore,
  groupHash: string,
  hashes: readonly string[],
): Promise<void> => {
  for (const hash of hashes) {
    await putObject(s3, userGroupKey(hash, groupHash), POINTER);
  }
};

const gameMetaBody = (seats: InviteRecord['seats'], token: string): string =>
  JSON.stringify({ seats, inviteToken: token });

const metaBelongsToInvite = (
  raw: string | undefined,
  token: string,
  seats: InviteRecord['seats'],
): boolean => {
  if (raw === undefined) return false;
  const existing = parseGameMeta(raw);
  if (existing === undefined) return false;
  if (existing.inviteToken === token) return true;
  return existing.inviteToken === undefined && seatsEqual(existing.seats, seats);
};

const ensureGameMeta = async (
  s3: ObjectStore,
  groupHash: string,
  gameNumber: string,
  seats: InviteRecord['seats'],
  token: string,
): Promise<'ours' | 'taken'> => {
  const key = gameMetaKey(groupHash, gameNumber);
  try {
    await putObject(s3, key, gameMetaBody(seats, token), { ifNoneMatch: '*' });
    return 'ours';
  } catch (error: unknown) {
    if (!isPreconditionFailed(error)) throw error;
    return metaBelongsToInvite(await getObject(s3, key), token, seats) ? 'ours' : 'taken';
  }
};

const finishStart = async (
  s3: ObjectStore,
  token: string,
  invite: InviteRecord,
  groupHash: string,
  gameNumber: string,
): Promise<void> => {
  const hashes = boundHumanHashes(invite.seats);
  const next = Number.parseInt(gameNumber, 10) + 1;
  await writeGroupNext(s3, groupHash, next);
  await writeMembership(s3, groupHash, hashes);
  await writeInvite(s3, token, { ...invite, status: 'started', gameNumber });
};

const materialiseGame = async (
  s3: ObjectStore,
  token: string,
  invite: InviteRecord,
  raw: string,
): Promise<{ readonly groupHash: string; readonly gameNumber: string }> => {
  const hashes = boundHumanHashes(invite.seats);
  const groupHash = groupHashFromUserHashes(hashes);
  let current = invite;
  let currentRaw = raw;
  let n =
    current.gameNumber !== undefined
      ? Number.parseInt(current.gameNumber, 10)
      : await readNextGameNumber(s3, groupHash);
  if (!Number.isInteger(n) || n < 1) n = 1;

  for (;;) {
    let gameNumber = current.gameNumber;
    if (gameNumber === undefined) {
      gameNumber = padGameNumber(n);
      await writeInvite(s3, token, { ...current, gameNumber }, currentRaw);
      current = { ...current, gameNumber };
      currentRaw = serializeInvite(current);
    }
    const owned = await ensureGameMeta(s3, groupHash, gameNumber, current.seats, token);
    if (owned === 'taken') {
      n = Number.parseInt(gameNumber, 10) + 1;
      const next = padGameNumber(n);
      await writeInvite(s3, token, { ...current, gameNumber: next }, currentRaw);
      current = { ...current, gameNumber: next };
      currentRaw = serializeInvite(current);
      continue;
    }
    await finishStart(s3, token, current, groupHash, gameNumber);
    return { groupHash, gameNumber };
  }
};

export const handleStart = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
  token: string,
): Promise<OnlineHttpResult> => {
  const user = await requireUserHash(deps.google, authorizationOf(request));
  if (!user.ok) return user.result;
  for (;;) {
    const raw = await getObject(deps.s3, inviteKey(token));
    if (raw === undefined) return notFound();
    const invite = parseInvite(raw);
    if (invite === undefined) return notFound();
    const closedResult = closed(invite);
    if (closedResult !== undefined) return closedResult;
    if (indexOfBoundUser(invite.seats, user.userHash) < 0) return forbidden();
    if (!allHumanSeatsBound(invite.seats)) return conflict();
    try {
      const started = await materialiseGame(deps.s3, token, invite, raw);
      return jsonResult(200, started);
    } catch (error: unknown) {
      if (isPreconditionFailed(error)) continue;
      throw error;
    }
  }
};

const lastSegment = (key: string, prefix: string): string | undefined => {
  if (!key.startsWith(prefix)) return undefined;
  const rest = key.slice(prefix.length);
  if (rest.length === 0 || rest.includes('/')) return undefined;
  return rest;
};

const openLobbyTokens = async (s3: ObjectStore, userHash: string): Promise<readonly { readonly token: string }[]> => {
  const prefix = lobbyPrefix(userHash);
  const keys = [...(await listObjects(s3, prefix))].sort(compareStrings);
  const lobbies: { readonly token: string }[] = [];
  for (const key of keys) {
    const token = lastSegment(key, prefix);
    if (token === undefined) continue;
    const invite = await readInvite(s3, token);
    if (invite?.status === 'open') lobbies.push({ token });
  }
  return lobbies;
};

export const handleMyGames = async (
  deps: OnlineApiDeps,
  request: OnlineRequest,
): Promise<OnlineHttpResult> => {
  const user = await requireUserHash(deps.google, authorizationOf(request));
  if (!user.ok) return user.result;
  const lobbies = await openLobbyTokens(deps.s3, user.userHash);
  const games = await listLibraryGames(deps.s3, user.userHash);
  return jsonResult(200, { lobbies, games });
};
