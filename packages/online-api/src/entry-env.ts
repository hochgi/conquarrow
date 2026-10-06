/**
 * Lambda environment → entry configuration. Pure; `http.ts` and `ws.ts` pass
 * `process.env` in at import.
 *
 * - `GOOGLE_CLIENT_IDS` — comma-separated OAuth client IDs, trimmed, blanks dropped.
 * - `MATCH_BUCKET` — the match bucket; absent reads as `''`.
 * - `WS_MANAGEMENT_ENDPOINT` — absent or empty means no WebSocket notifier.
 */

export interface EntryEnv {
  readonly googleClientIds: readonly string[];
  readonly matchBucket: string;
  readonly wsManagementEndpoint?: string;
}

export const readEntryEnv = (env: { readonly [key: string]: string | undefined }): EntryEnv => {
  const googleClientIds = (env['GOOGLE_CLIENT_IDS'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const endpoint = env['WS_MANAGEMENT_ENDPOINT'];
  return {
    googleClientIds,
    matchBucket: env['MATCH_BUCKET'] ?? '',
    ...(endpoint === undefined || endpoint === '' ? {} : { wsManagementEndpoint: endpoint }),
  };
};
