/**
 * MCP door — second Lambda entry (P92). Leaf interfaces only.
 *
 * The handler does not join, burst, parse an offer, or mint a token.
 * Phase 3 implements behind these seams.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.md
 * @see docs/spec/remote-agent-mcp/SCENARIOS.md
 */

import type { StateChangedPayload } from '@conquarrow/contracts';
import type { GoogleVerifier, HeuristicChooser, ObjectStore, PostToConnection } from './api-types';

export const MCP_ISSUER = 'https://mcp.games.hochgi.com';

export const MCP_AUDIENCE = 'https://mcp.games.hochgi.com/conquarrow';

export const MCP_RESOURCE_METADATA =
  'https://mcp.games.hochgi.com/.well-known/oauth-protected-resource/conquarrow';

/** One HTTP invocation on the MCP door. Paths are what this handler sees. */
export interface McpHttpRequest {
  readonly method: 'GET' | 'POST' | 'DELETE';
  readonly path: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly body?: string;
  readonly query?: Readonly<Record<string, string>>;
}

export interface McpHttpResult {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Exchanges a Google authorization code for an ID token.
 * Tests inject this. The handler does not call Google.
 */
export interface GoogleCodeExchange {
  exchange(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<{ readonly idToken: string }>;
}

/** Fetches a client-id metadata document. A non-https `client_id` must not reach it. */
export interface ClientMetadataFetch {
  fetch(url: string): Promise<string>;
}

/** Access-token claims. No email, no invite token, no refresh id. */
export interface McpAccessClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
}

/**
 * Signs and checks access tokens. Sync — tests inject a scripted signer, they
 * do not probe it with test-kit.
 */
export interface McpSigner {
  sign(claims: McpAccessClaims): string;
  verify(token: string): McpAccessClaims | undefined;
}

/**
 * Injected log. Sync. Must not receive a handle, an invite token, or a bearer.
 * Not an I/O probe — tests record the lines this function is given.
 */
export interface McpLog {
  write(line: string): void;
}

/** `PostToConnection` as a Promise method, so a test can probe the ping. */
export interface ConnectionPoster {
  post(connectionId: string, payload: StateChangedPayload): Promise<200 | 410>;
}

export interface McpHttpDeps {
  readonly store: ObjectStore;
  readonly postToConnection: PostToConnection;
  readonly google: GoogleVerifier;
  readonly googleCodeExchange: GoogleCodeExchange;
  readonly metadata: ClientMetadataFetch;
  readonly clock: () => number;
  readonly signer: McpSigner;
  readonly log: McpLog;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly heuristic?: HeuristicChooser;
  /** Authorization-code client id sent to Google. Absent in tests that never continue. */
  readonly googleAuthClientId?: string;
}

/** Replace each secret substring with `[redacted]`. */
export const redactSecrets = (text: string, secrets: readonly string[]): string => {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    out = out.split(secret).join('[redacted]');
  }
  return out;
};

export { handleMcpHttp } from './mcp-door';
export { handler } from './mcp-lambda';
