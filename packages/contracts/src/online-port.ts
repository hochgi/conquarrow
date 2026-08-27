/**
 * Online auth, invites, library, moves, and WebSocket notify (P17–P18).
 *
 * Tests and adapters speak this surface. `userHash` / `groupHash` hashing is an
 * adapter concern (`packages/online-api`); this package stays free of `crypto`
 * (eslint purity guard). Google `sub` never appears on a DTO returned to a
 * client.
 *
 * Paths are those the handlers see under the `/conquarrow` mapping — `/me`,
 * `/invites/:token/accept`, `/games/:groupHash/:gameNumber`, not the mapped prefix.
 *
 * @see docs/spec/online-auth-invites/online-auth-invites.md
 * @see docs/spec/online-moves-ws/online-moves-ws.md
 * @see docs/adr/0002-cheap-async-online.md
 * @see docs/spec/online-game-library/online-game-library.md
 */

import type { LibraryGameStatus } from './library-status';

/** 32 lowercase hex characters — adapter: `truncate16(SHA-256(sub))`. */
export type UserHash = string;

/** Opaque invite token: 32 CSPRNG bytes, hex-encoded (64 characters). */
export type InviteToken = string;

/**
 * 32 lowercase hex characters — adapter:
 * `truncate16(SHA-256(sorted human userHashes joined by newline))`.
 * Heuristic seats and 3-vs-6 are not in the preimage.
 */
export type GroupHash = string;

/** Six-digit game counter from 1 (`000001`, …). Never reused to overwrite. */
export type GameNumber = string;

/** Seat kinds a create request may name. `byok` is refused (422). */
export type PlannedSeatKind = 'human' | 'heuristic' | 'byok';

/**
 * A chair on an invite or game meta.
 * A human chair is bound iff `userHash` is a string (never a Google `sub`).
 */
export type InviteSeat =
  | { readonly kind: 'human'; readonly userHash?: UserHash }
  | { readonly kind: 'heuristic' };

export interface CreateInviteBody {
  readonly seats: readonly PlannedSeatKind[];
  readonly hostSeatIndex?: number;
}

export interface MeBody {
  readonly userHash: UserHash;
}

export interface InviteBody {
  readonly token: InviteToken;
  readonly seats: readonly InviteSeat[];
}

export interface StartBody {
  readonly groupHash: GroupHash;
  readonly gameNumber: GameNumber;
}

export interface OpenLobbyRow {
  readonly token: InviteToken;
}

export interface StartedGameRow {
  readonly groupHash: GroupHash;
  readonly gameNumber: GameNumber;
  readonly status: LibraryGameStatus;
}

export interface MyGamesBody {
  readonly lobbies: readonly OpenLobbyRow[];
  readonly games: readonly StartedGameRow[];
}

export interface GoneBody {
  readonly reason: 'revoked' | 'started';
  /** Present on `started` when the invite record can supply them (P26). */
  readonly groupHash?: GroupHash;
  readonly gameNumber?: GameNumber;
}

/** POST moves against a game whose `state.winner` is already set. */
export interface FinishedBody {
  readonly reason: 'finished';
}

/**
 * Wake-up after a persist of `state.json`. The client then GETs state.
 * Never includes Google `sub` or a `GameState`.
 */
export interface StateChangedPayload {
  readonly type: 'stateChanged';
  readonly version: number;
  readonly groupHash: GroupHash;
  readonly gameNumber: GameNumber;
}

export interface OnlineHeaders {
  readonly authorization?: string;
  /** HTTP `If-Match` — quoted decimal version, e.g. `"0"`. Required on POST moves. */
  readonly ifMatch?: string;
}

export interface OnlineRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly headers?: OnlineHeaders;
  readonly body?: string;
}

export interface OnlineHttpResult {
  readonly statusCode: number;
  readonly headers: { readonly 'content-type': string };
  readonly body: string;
}

/**
 * The online HTTP surface. One `handle` so a second adapter (in-process test
 * factory, Lambda event mapper) can satisfy the same suite.
 */
export interface OnlinePort {
  handle(request: OnlineRequest): Promise<OnlineHttpResult>;
}

/** `$connect` — `access_token` is the Google ID token query parameter. */
export interface WsConnectRequest {
  readonly connectionId: string;
  readonly accessToken?: string;
}

/**
 * `$disconnect` — production has only `connectionId`; the adapter looks up
 * `connection-ids/<connectionId>`. Tests may pass `userHash` directly.
 */
export interface WsDisconnectRequest {
  readonly connectionId: string;
  readonly userHash?: UserHash;
}

export interface OnlineWsResult {
  readonly statusCode: number;
}

/**
 * WebSocket registry. Any verified user may connect. Invalid or missing token
 * → 401 and no `connections/` key.
 */
export interface OnlineWsPort {
  connect(request: WsConnectRequest): Promise<OnlineWsResult>;
  disconnect(request: WsDisconnectRequest): Promise<OnlineWsResult>;
}
