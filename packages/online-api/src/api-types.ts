import type { GameState, Move, StateChangedPayload } from '@conquarrow/contracts';

export type GoogleRejectReason = 'missing' | 'expired' | 'invalid';

export type GoogleVerifyResult =
  | { readonly ok: true; readonly sub: string; readonly displayName?: string }
  | { readonly ok: false; readonly reason: GoogleRejectReason };

export interface GoogleVerifier {
  readonly verify: (
    authorizationHeader: string | undefined,
  ) => GoogleVerifyResult | Promise<GoogleVerifyResult>;
}

/** Conditional put — S3 `If-Match` / `If-None-Match`. */
export interface ObjectPutOptions {
  readonly ifMatch?: string;
  readonly ifNoneMatch?: '*';
}

/** Thrown when `If-Match` / `If-None-Match` does not hold. Handlers retry or map to 412. */
export class PreconditionFailed extends Error {
  constructor(message = 'precondition failed') {
    super(message);
    this.name = 'PreconditionFailed';
  }
}

export const isPreconditionFailed = (error: unknown): boolean => {
  if (error instanceof PreconditionFailed) return true;
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: unknown }).name === 'PreconditionFailed';
}

/** Byte store keyed like the match bucket (`conquarrow/…`). */
export interface ObjectStore {
  readonly get: (key: string) => string | undefined | Promise<string | undefined>;
  readonly put: (
    key: string,
    body: string,
    options?: ObjectPutOptions,
  ) => void | Promise<void>;
  readonly delete: (key: string) => void | Promise<void>;
  readonly listPrefix: (prefix: string) => readonly string[] | Promise<readonly string[]>;
}

/** Injected chooser — production copies Pages `chooseMove`; tests script it. */
export type HeuristicChooser = (state: GameState) => Move;

/** `PostToConnection` — 410 Gone means the socket is gone. */
export type PostToConnection = (
  connectionId: string,
  payload: StateChangedPayload,
) => 200 | 410 | Promise<200 | 410>;

export interface OnlineApiDeps {
  readonly google: GoogleVerifier;
  readonly s3: ObjectStore;
  readonly clock: () => number;
  readonly randomBytes: (size: number) => Uint8Array;
  readonly heuristic?: HeuristicChooser;
  readonly postToConnection?: PostToConnection;
}
