/**
 * Rig factory for the P68 online-edge-probes suites.
 *
 * One rig per test: a probed S3 whose `.adapter` is a real `S3Client` over
 * test-kit's in-memory backing, the **real store** (`createS3Store`, production
 * code, unmodified) over it, and — where a scenario needs one — a probed
 * notifier standing in for `PostToConnection`. Failure injection is a probe rule
 * or an intercept; nothing here is a hand-written fake of S3 or of the socket.
 *
 * Users, hashes and HTTP helpers come from `./support` (the P17 / P18 suites).
 *
 * @see docs/spec/online-edge-probes/online-edge-probes.md
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createRig, type Rig } from '@hochgi/test-kit';
import { createProbedMock, type ProbedMock } from '@hochgi/test-kit-mock';
import { createProbedS3Adapter, type ProbedS3Adapter } from '@hochgi/test-kit-s3';
import { expect } from 'vitest';
import type {
  OnlineHttpResult,
  OnlinePort,
  OnlineWsPort,
  PlannedSeatKind,
  StateChangedPayload,
} from '@conquarrow/contracts';
import { endTurn } from '@conquarrow/contracts';
import { createOnlineApi, createOnlineWs } from '../src/create-online-api';
import type { ObjectStore, OnlineApiDeps, PostToConnection } from '../src/create-online-api';
import { createS3Store } from '../src/s3-store';
import {
  ALICE,
  BOB,
  CAROL,
  GAME_ONE,
  type TestUser,
  alwaysEndTurn,
  createOpenInvite,
  expectStatus,
  expectWsStatus,
  fakeGoogle,
  getGame,
  groupHashOfUserHashes,
  parseBody,
  postAccept,
  postMove,
  postStart,
  sequentialBytes,
  userHashOf,
  versionOf,
  wsConnect,
} from './support';

export const BUCKET = 'match-bucket';

/**
 * `PostToConnection`'s signature narrowed to `Promise<200 | 410>` — the shape
 * `createProbedMock` can probe (it requires Promise-returning methods).
 */
export interface ConnectionNotifier {
  post(connectionId: string, payload: StateChangedPayload): Promise<200 | 410>;
}

export interface EdgeRig {
  readonly rig: Rig;
  /** Probed S3; default rule forwards every command to the backing. */
  readonly s3: ProbedS3Adapter;
  /** The real store — `createS3Store(BUCKET, s3.adapter)`. */
  readonly store: ObjectStore;
  readonly close: () => Promise<void>;
}

/** Background: a fresh rig, a probed S3 for `match-bucket`, the real store over it. */
export const createEdgeRig = (): EdgeRig => {
  const rig = createRig();
  const s3 = rig.attach(createProbedS3Adapter({ harness: rig, bucket: BUCKET }));
  return {
    rig,
    s3,
    store: createS3Store(BUCKET, s3.adapter),
    close: () => rig.close(),
  };
};

/** A probed notifier on the edge rig. Its calls park until a rule answers them. */
export const attachNotifier = (edge: EdgeRig): ProbedMock<ConnectionNotifier> =>
  edge.rig.attach(
    createProbedMock<ConnectionNotifier>({ harness: edge.rig, methods: ['post'] }),
  );

/** "The probed notifier answers 200 to every post." */
export const answer200ToEveryPost = (notifier: ProbedMock<ConnectionNotifier>): void => {
  notifier.probe.on('post').always().answer(200);
};

/** The deps' `PostToConnection` — every post goes through the probed notifier. */
export const notifierPort =
  (notifier: ProbedMock<ConnectionNotifier>): PostToConnection =>
  (connectionId, payload) =>
    notifier.adapter.post(connectionId, payload);

export interface EdgeApi {
  readonly api: OnlinePort;
  readonly ws: OnlineWsPort;
}

/**
 * "An api over the real store [and the probed notifier]". Omit
 * `postToConnection` for "with no PostToConnection".
 */
export const apiOver = (store: ObjectStore, postToConnection?: PostToConnection): EdgeApi => {
  const deps: OnlineApiDeps = {
    google: fakeGoogle(),
    s3: store,
    clock: () => 0,
    randomBytes: sequentialBytes(),
    heuristic: alwaysEndTurn,
    ...(postToConnection === undefined ? {} : { postToConnection }),
  };
  return { api: createOnlineApi(deps), ws: createOnlineWs(deps) };
};

// ── Backing helpers ────────────────────────────────────────────────────────

/**
 * Write straight into the backing through the probed `S3Client` — "another
 * writer". Recorded by the probe like any other call. Returns the ETag.
 */
export const rawPut = async (edge: EdgeRig, key: string, body: string): Promise<string> => {
  const out = await edge.s3.adapter.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }),
  );
  if (out.ETag === undefined) throw new Error(`setup: backing returned no ETag for ${key}`);
  return out.ETag;
};

/**
 * "Given the backing holds …" — seed keys, then clear the probe's call log so
 * every recorded call a Then step inspects belongs to the When. Returns the
 * backing's ETag per key.
 */
export const seedBacking = async (
  edge: EdgeRig,
  entries: Iterable<readonly [string, string]>,
): Promise<ReadonlyMap<string, string>> => {
  const etags = new Map<string, string>();
  for (const [key, body] of entries) {
    etags.set(key, await rawPut(edge, key, body));
  }
  edge.s3.probe.clearCalls();
  return etags;
};

/**
 * "The backing holds … at …" — read the backing directly (`undefined` for a
 * missing key). Records a GetObjectCommand, so call-log assertions go first.
 */
export const backingBody = async (edge: EdgeRig, key: string): Promise<string | undefined> => {
  try {
    const out = await edge.s3.adapter.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return out.Body === undefined ? undefined : await out.Body.transformToString();
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'NoSuchKey') return undefined;
    throw error;
  }
};

/**
 * An S3 error — the `S3ServiceException` shape the real SDK throws. Omit
 * `status` for the outline's "none": no `httpStatusCode` in its `$metadata`.
 */
export const s3Error = (name: string, status?: number): S3ServiceException =>
  new S3ServiceException({
    name,
    $fault: status !== undefined && status >= 500 ? 'server' : 'client',
    $metadata: status === undefined ? {} : { httpStatusCode: status },
    message: `${name} (${status === undefined ? 'no status' : String(status)})`,
  });

/** `n` keys under `prefix`, unpadded so numeric and string order disagree. */
export const keysUnder = (prefix: string, n: number): readonly string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i)}`);

/**
 * `compareStrings`' order (UTF-16 code units), kept local so expectations do
 * not import the comparator under test. S3 lists in UTF-8 byte order instead.
 */
export const utf16Order = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

/**
 * Two keys whose UTF-16 and UTF-8 orders disagree: U+FF61 is a single high-BMP
 * code unit (EF BD A1 in UTF-8); U+1F600 is a surrogate pair starting 0xD83D
 * (F0 9F 98 80). UTF-16 puts the emoji first, UTF-8 puts U+FF61 first.
 */
export const HIGH_BMP = '｡';
export const ASTRAL = '\u{1F600}';

// ── Game helpers ───────────────────────────────────────────────────────────

export interface StartedGame {
  readonly groupHash: string;
  readonly gameNumber: string;
}

const JOINERS: readonly TestUser[] = [BOB, CAROL];

/**
 * "A and B have started and opened a 3-seat game with seats …" (C bound too
 * when every seat is human) — the overview's **started and opened game**.
 *
 * Start does not write `state.json`; the first member GET does, at version 0,
 * and that GET wakes the other humans' connections. So the game is opened here
 * (A's GET), before any connection is stored — the scenarios' posts are then
 * the move's own, and the move's If-Match "0" names a version that exists.
 */
export const startOpenedGame = async (
  api: OnlinePort,
  seats: readonly PlannedSeatKind[],
): Promise<StartedGame> => {
  const token = await createOpenInvite(api, ALICE, seats);
  const humans = seats.filter((kind) => kind === 'human').length;
  const joiners = JOINERS.slice(0, humans - 1);
  for (const user of joiners) {
    expectStatus(await postAccept(api, token, user.bearer), 200);
  }
  expectStatus(await postStart(api, token, ALICE.bearer), 200);
  const groupHash = groupHashOfUserHashes(
    [ALICE, ...joiners].map((user) => userHashOf(user.sub)),
  );
  const opened = expectStatus(await getGame(api, groupHash, GAME_ONE, ALICE.bearer), 200);
  expect(versionOf(parseBody(opened))).toBe(0);
  return { groupHash, gameNumber: GAME_ONE };
};

/** "U has stored connection c" — through the real `$connect` path. */
export const storeConnection = async (
  ws: OnlineWsPort,
  user: TestUser,
  connectionId: string,
): Promise<void> => {
  expectWsStatus(await wsConnect(ws, connectionId, user.bearer), 200);
};

/** "A posts endTurn with If-Match "v"". */
export const postEndTurn = (
  api: OnlinePort,
  game: StartedGame,
  user: TestUser,
  version: number,
): Promise<OnlineHttpResult> =>
  postMove(api, game.groupHash, game.gameNumber, user.bearer, endTurn(), version);

/**
 * The reason `work` rejects with. Fails the test if it resolves. Safe to start
 * early and await later — the rejection is handled the moment it happens.
 */
export const rejectionOf = async (work: PromiseLike<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (reason: unknown) {
    return reason;
  }
  throw new Error('expected the call to reject, but it resolved');
};
