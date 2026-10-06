/**
 * HTTP API Lambda entry — the composition root. Reads env, builds the leaves,
 * and hands them to `createHttpHandler` (`http-event.ts`), which maps API
 * Gateway events onto `OnlinePort.handle`.
 *
 * Google verification stays behind `GoogleVerifier` (tokeninfo; `sub` / `aud` /
 * `exp` only). S3 is the object-store adapter. Env: `GOOGLE_CLIENT_IDS`,
 * `MATCH_BUCKET`, `WS_MANAGEMENT_ENDPOINT` (`entry-env.ts`).
 */

import { randomBytes } from 'node:crypto';
import { env } from 'node:process';
import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import type { OnlineHttpResult } from '@conquarrow/contracts';
import { createApiGatewayPostToConnection } from './apigw-post-to-connection';
import { readEntryEnv } from './entry-env';
import { createGoogleTokenInfoVerifier } from './google-tokeninfo';
import { createHttpHandler } from './http-event';
import { pagesHeuristic } from './pages-heuristic';
import { createS3Store } from './s3-store';

export { toOnlineRequest } from './http-event';

const config = readEntryEnv(env);
const clock = (): number => Date.now();

const post =
  config.wsManagementEndpoint === undefined
    ? undefined
    : createApiGatewayPostToConnection(
        new ApiGatewayManagementApiClient({ endpoint: config.wsManagementEndpoint }),
      );

export const handler: (event: unknown) => Promise<OnlineHttpResult> = createHttpHandler({
  google: createGoogleTokenInfoVerifier({
    clientIds: config.googleClientIds,
    clock,
    fetch: globalThis.fetch,
  }),
  s3: createS3Store(config.matchBucket),
  clock,
  randomBytes: (size) => randomBytes(size),
  heuristic: pagesHeuristic,
  ...(post === undefined ? {} : { postToConnection: post }),
});
