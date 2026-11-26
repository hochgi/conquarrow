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
import type { MatchConfig } from './match-config';
import type { Move } from './move';

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

/**
 * Seat kinds a create request may name (P106). Online: `creator` is the
 * creator's own chair (`Player (you)`, exactly one), `human` an open chair,
 * `creator-agent` an agent chair reserved for the creator's agent
 * (`Agent (yours)`), `agent` an open agent chair, `heuristic` the AI.
 * `byok` is local only and refused online (422).
 */
export type PlannedSeatKind = 'creator' | 'human' | 'creator-agent' | 'agent' | 'heuristic' | 'byok';

/**
 * A chair on an invite or game meta.
 * A human or agent chair is bound iff `userHash` is a string (never a Google `sub`).
 * A bound human or agent chair may carry `name` (P105) — never in a non-member's peek.
 */
export type InviteSeat =
  // P105: `name` is the bound user's profile display name, sent to members only.
  | { readonly kind: 'human'; readonly userHash?: UserHash; readonly name?: string }
  // P106: `reservedFor` keeps an unbound agent chair for that user's own agent; binding drops it.
  | { readonly kind: 'agent'; readonly userHash?: UserHash; readonly name?: string; readonly reservedFor?: UserHash }
  | { readonly kind: 'heuristic' };

export interface CreateInviteBody {
  readonly seats: readonly PlannedSeatKind[];
  /** P96 D6: optional; `normalizeGameName` decides it. */
  readonly name?: string;
}

export interface MeBody {
  readonly userHash: UserHash;
}

export interface InviteBody {
  readonly token: InviteToken;
  readonly seats: readonly InviteSeat[];
  /** P96 D6: the game's name, when the creator gave one. */
  readonly name?: string;
}

export interface StartBody {
  readonly groupHash: GroupHash;
  readonly gameNumber: GameNumber;
}

export interface OpenLobbyRow {
  readonly token: InviteToken;
}

/**
 * A chair on a started library row. Never `userHash`, Google `sub`, or email.
 * `you` is true on the caller's human chair and, when they hold one, the agent chair.
 * `label` on an agent chair is `Agent (given_name)` or `Agent`.
 */
export interface LibrarySeat {
  readonly kind: 'human' | 'heuristic' | 'agent';
  readonly label: string;
  readonly you: boolean;
}

/** P96 D8: where a library row is listed. */
export type LibrarySection = 'your-turn' | 'waiting' | 'finished';

/** P96 D8: a list `GET /my-games?section=` can page — a section, or the caller's hidden games. */
export type LibraryList = LibrarySection | 'hidden';

export interface StartedGameRow {
  readonly groupHash: GroupHash;
  readonly gameNumber: GameNumber;
  readonly status: LibraryGameStatus;
  /** P96 D8: `your-turn`, `waiting`, or `finished` for `won` and `lost`. */
  readonly section: LibrarySection;
  readonly seats: readonly LibrarySeat[];
  readonly seatIndex: number;
  /** ISO-8601 UTC written at Start; omitted on pre-P46 meta. */
  readonly startedAt?: string;
  /** P96 D6. */
  readonly name?: string;
  /** P96 D7: ISO-8601 UTC of the last persisted version; omitted on pre-P96 meta. */
  readonly lastActivityAt?: string;
  /** P96 D7: `endTurn` moves so far; omitted on pre-P96 meta. */
  readonly turns?: number;
  /** P96 D8: the seat to move, while there is no winner. */
  readonly activeSeat?: number;
  /** P96 D8: the winning seat and its label, once there is one. */
  readonly winner?: { readonly seat: number; readonly label: string };
  /** P96 D4: the caller owns the game (may rename and delete it). */
  readonly owner: boolean;
  /** P96 D9: the caller has hidden the game. */
  readonly hidden: boolean;
}

/** P96 D8: rows per list; hidden games are counted only under `hidden`. */
export type LibraryCounts = Readonly<Record<LibraryList, number>>;

export interface MyGamesBody {
  readonly lobbies: readonly OpenLobbyRow[];
  /** Every your-turn and waiting row, and the first `FINISHED_PAGE` finished rows (P96 D8). */
  readonly games: readonly StartedGameRow[];
  readonly counts: LibraryCounts;
}

/** P96 D8: `GET /my-games?section=S&offset=O&limit=L`. */
export interface LibraryPageBody {
  readonly section: LibraryList;
  readonly offset: number;
  readonly limit: number;
  readonly total: number;
  readonly games: readonly StartedGameRow[];
}

/** P96 D8: the finished rows `GET /my-games` carries, and a page's default size. */
export const FINISHED_PAGE = 10;
/** P96 D8: the largest page a listing query may ask for. */
export const MAX_LIBRARY_PAGE = 50;

export interface GoneBody {
  readonly reason: 'revoked' | 'started' | 'deleted';
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

/**
 * P96 D5, D6: sent to every member after a delete or a rename. The client
 * re-reads its library (and the game, for a rename of the one on screen).
 */
export interface LibraryChangedPayload {
  readonly type: 'libraryChanged';
  readonly groupHash: GroupHash;
  readonly gameNumber: GameNumber;
  readonly change: 'deleted' | 'renamed';
}

/** Every message the server pushes on the socket. */
export type WsPayload = StateChangedPayload | LibraryChangedPayload;

/** P95 D4: one seat's standing in a finished game. */
export interface SeatStanding {
  readonly player: string;
  readonly seat: number;
  readonly kind: InviteSeat['kind'] | undefined;
  readonly territory: number;
  readonly shares: number;
  readonly heads: number;
  readonly lost: boolean;
}

/** P95 D4: how a finished game ended. */
export interface GameSummary {
  readonly winner: string;
  readonly turns: number;
  readonly standings: readonly SeatStanding[];
}

/** P96 D1: one seat of an export — never a user hash. */
export interface ExportSeat {
  readonly seat: number;
  readonly player: string;
  readonly kind: 'human' | 'agent' | 'bot';
  readonly name: string;
  /** An agent seat's owner's profile name, when known. */
  readonly owner?: string;
}

/** P96 D2: an agent's reply record as the export carries it. */
export interface ExportAgentReply {
  readonly seat?: string;
  readonly moves: readonly number[];
  readonly endTurn: boolean;
  readonly why?: string;
  readonly plan?: string;
}

/** P96 D1: one `log.jsonl` line; `v` is absent on lines written before P49. */
export type ExportLogEntry =
  | { readonly v?: number; readonly move: Move }
  | { readonly v: number; readonly agentReply: ExportAgentReply };

/** P96 D1: the server's record of one game. */
export interface GameExport {
  readonly format: 'conquarrow-online-export';
  readonly formatVersion: 1;
  readonly groupHash: GroupHash;
  readonly gameNumber: GameNumber;
  readonly name?: string;
  readonly startedAt?: string;
  readonly lastActivityAt?: string;
  readonly exportedAt: string;
  readonly config: MatchConfig;
  readonly seats: readonly ExportSeat[];
  readonly version: number;
  readonly activePlayer: string;
  readonly winner?: string;
  readonly turns: number;
  readonly summary?: GameSummary;
  readonly moves: readonly Move[];
  readonly log: readonly ExportLogEntry[];
  readonly withheldReplies: number;
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
  /**
   * Decoded query string (P49). `GET /games/:g/:n/log?since=N` is the only
   * reader today; the Lambda mapper fills this from `queryStringParameters`.
   */
  readonly query?: Readonly<Record<string, string>>;
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
