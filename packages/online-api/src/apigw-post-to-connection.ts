/**
 * `PostToConnection` leaf over the API Gateway Management API: one
 * `PostToConnectionCommand` per notify, the JSON payload as UTF-8 bytes.
 *
 * A gone socket — `GoneException`, or any error carrying HTTP 410 — is the
 * domain value `410`; every other failure is rethrown unchanged. The client is
 * built at the composition root (`http.ts`) from `WS_MANAGEMENT_ENDPOINT`.
 */

import { PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import type { PostToConnection } from './api-types';

/** The one call this leaf makes — `ApiGatewayManagementApiClient` satisfies it. */
export interface PostToConnectionClient {
  send(command: PostToConnectionCommand): Promise<unknown>;
}

const statusOfAwsError = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const rec = error as Record<string, unknown>;
  if (rec['name'] === 'GoneException') return 410;
  const meta = rec['$metadata'];
  if (typeof meta !== 'object' || meta === null) return undefined;
  const code = (meta as Record<string, unknown>)['httpStatusCode'];
  return typeof code === 'number' ? code : undefined;
};

export const createApiGatewayPostToConnection =
  (client: PostToConnectionClient): PostToConnection =>
  async (connectionId, payload) => {
    try {
      await client.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: new TextEncoder().encode(JSON.stringify(payload)),
        }),
      );
      return 200;
    } catch (error: unknown) {
      if (statusOfAwsError(error) === 410) return 410;
      throw error;
    }
  };
