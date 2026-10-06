/**
 * WebSocket `$connect` / `$disconnect` Lambda entry — the composition root.
 * Reads env, builds the leaves, and hands the port to `createWsHandler`
 * (`ws-event.ts`): verify the token, write or delete
 * `connections/<userHash>/<connectionId>`. Missing token fails closed.
 */

import { env } from 'node:process';
import type { OnlineWsResult } from '@conquarrow/contracts';
import { createOnlineWs } from './create-online-ws';
import { readEntryEnv } from './entry-env';
import { createGoogleTokenInfoVerifier } from './google-tokeninfo';
import { createS3Store } from './s3-store';
import { createWsHandler } from './ws-event';

const config = readEntryEnv(env);
const clock = (): number => Date.now();

export const handler: (event?: unknown) => Promise<OnlineWsResult> = createWsHandler(
  createOnlineWs({
    google: createGoogleTokenInfoVerifier({
      clientIds: config.googleClientIds,
      clock,
      fetch: globalThis.fetch,
    }),
    s3: createS3Store(config.matchBucket),
    clock,
    randomBytes: () => new Uint8Array(0),
  }),
);
