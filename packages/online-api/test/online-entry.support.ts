/**
 * Rig and fixtures for the online-entry suites (the Lambda entries' pure event
 * mapping, the env parsing, and the API Gateway post leaf).
 *
 * The post leaf's seam is its one SDK call, so the rig probes a
 * `PostToConnectionClient` with `createProbedMock`; the commands it records are
 * real `PostToConnectionCommand`s. One rig per test, closed in `afterEach`.
 */

import type { PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { createRig, type Rig } from '@hochgi/test-kit';
import { createProbedMock, type ProbedMock } from '@hochgi/test-kit-mock';
import type { StateChangedPayload } from '@conquarrow/contracts';
import type { PostToConnection } from '../src/api-types';
import {
  createApiGatewayPostToConnection,
  type PostToConnectionClient,
} from '../src/apigw-post-to-connection';

export const PAYLOAD: StateChangedPayload = {
  type: 'stateChanged',
  version: 7,
  groupHash: 'a'.repeat(32),
  gameNumber: '000001',
};

export interface PostLeafRig {
  readonly client: ProbedMock<PostToConnectionClient>;
  readonly post: PostToConnection;
  readonly close: () => Promise<void>;
}

export const createPostLeafRig = (): PostLeafRig => {
  const rig: Rig = createRig();
  const client = rig.attach(
    createProbedMock<PostToConnectionClient>({ harness: rig, methods: ['send'] }),
  );
  return {
    client,
    post: createApiGatewayPostToConnection(client.adapter),
    close: () => rig.close(),
  };
};

/** The commands the leaf sent, in order. */
export const sentCommands = (leaf: PostLeafRig): readonly PostToConnectionCommand[] =>
  leaf.client.probe.on('send').calls.map((call) => call.args[0]);

/** A sent command's `Data`, decoded back from UTF-8 JSON. */
export const decodedData = (command: PostToConnectionCommand | undefined): unknown => {
  const data = command?.input.Data;
  if (!(data instanceof Uint8Array)) throw new Error('expected Data to be bytes');
  return JSON.parse(new TextDecoder().decode(data)) as unknown;
};

/** An SDK-shaped failure: `name`, and `$metadata` only when given. */
export const awsError = (name: string, metadata?: unknown): Error =>
  Object.assign(new Error(name), {
    name,
    ...(metadata === undefined ? {} : { $metadata: metadata }),
  });

export const rejectionOf = async (work: PromiseLike<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (reason: unknown) {
    return reason;
  }
  throw new Error('expected the call to reject, but it resolved');
};

/** A v2 HTTP API event. */
export const httpEvent = (
  method: 'GET' | 'POST',
  rawPath: string,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  version: '2.0',
  rawPath,
  requestContext: { http: { method } },
  ...extra,
});

/** A WebSocket event for one route, with an optional `access_token`. */
export const wsEvent = (
  connectionId: string,
  routeKey: string,
  accessToken?: string,
): Record<string, unknown> => ({
  requestContext: { connectionId, routeKey },
  ...(accessToken === undefined ? {} : { queryStringParameters: { access_token: accessToken } }),
});
