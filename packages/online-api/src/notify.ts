import type { InviteSeat, StateChangedPayload } from '@conquarrow/contracts';
import type { ObjectStore, PostToConnection } from './api-types';
import { compareStrings } from './hashing';
import { connectionIdKey, connectionKey, connectionsPrefix } from './s3-keys';
import { deleteObject, listObjects } from './store-io';

const connectionIdOf = (key: string, prefix: string): string | undefined => {
  if (!key.startsWith(prefix)) return undefined;
  const rest = key.slice(prefix.length);
  if (rest.length === 0 || rest.includes('/')) return undefined;
  return rest;
};

const humanHashes = (
  seats: readonly InviteSeat[],
  exceptUserHash: string | undefined,
): readonly string[] => {
  const hashes: string[] = [];
  for (const seat of seats) {
    if (seat.kind !== 'human') continue;
    const hash = seat.userHash;
    if (hash === undefined || hash === exceptUserHash) continue;
    hashes.push(hash);
  }
  return hashes.sort(compareStrings);
};

export const notifyHumans = async (
  s3: ObjectStore,
  postToConnection: PostToConnection | undefined,
  seats: readonly InviteSeat[],
  payload: StateChangedPayload,
  exceptUserHash?: string,
  alsoUserHash?: string,
): Promise<void> => {
  if (postToConnection === undefined) return;
  const hashes = [...humanHashes(seats, exceptUserHash)];
  if (alsoUserHash !== undefined && !hashes.includes(alsoUserHash)) hashes.push(alsoUserHash);
  hashes.sort(compareStrings);
  for (const userHash of hashes) {
    const prefix = connectionsPrefix(userHash);
    const ids = (await listObjects(s3, prefix))
      .map((key) => connectionIdOf(key, prefix))
      .filter((id): id is string => id !== undefined)
      .sort(compareStrings);
    for (const connectionId of ids) {
      try {
        const status = await Promise.resolve(postToConnection(connectionId, payload));
        if (status === 410) {
          await deleteObject(s3, connectionKey(userHash, connectionId));
          await deleteObject(s3, connectionIdKey(connectionId));
        }
      } catch {
        continue;
      }
    }
  }
};

/** Browser door: skip the caller so a POST does not echo. */
export const notifyOthers = async (
  s3: ObjectStore,
  postToConnection: PostToConnection | undefined,
  seats: readonly InviteSeat[],
  callerUserHash: string,
  payload: StateChangedPayload,
): Promise<void> => notifyHumans(s3, postToConnection, seats, payload, callerUserHash);
