/**
 * Per-user display-name overlay (P46).
 *
 * `conquarrow/users/<userHash>/profile.json` holds `{ displayName }` when GIS
 * yielded a non-empty sanitised name. Listing reads these for other humans.
 */

import type { ObjectStore } from './api-types';
import { sanitiseDisplayName } from './display-name';
import { asRecord } from './invite-record';
import { userProfileKey } from './s3-keys';
import { getObject, putObject } from './store-io';

export { sanitiseDisplayName } from './display-name';

export const upsertProfileDisplayName = async (
  s3: ObjectStore,
  userHash: string,
  displayName: string | undefined,
): Promise<void> => {
  const clean = sanitiseDisplayName(displayName);
  if (clean === undefined) return;
  await putObject(s3, userProfileKey(userHash), JSON.stringify({ displayName: clean }));
};

export const readProfileDisplayName = async (
  s3: ObjectStore,
  userHash: string,
): Promise<string | undefined> => {
  const raw = await getObject(s3, userProfileKey(userHash));
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const rec = asRecord(parsed);
  const displayName = rec?.['displayName'];
  return typeof displayName === 'string' ? sanitiseDisplayName(displayName) : undefined;
};
