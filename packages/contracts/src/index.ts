export { ContractViolation } from './errors';

export type { ArrowId, PointId, VertexId, PlayerId, Slot } from './ids';
export { SLOTS, mintArrowId, mintPointId, mintVertexId, mintPlayerId } from './ids';

export type { Rational } from './rational';
export {
  rational,
  add,
  compare,
  equals,
  wholeSteps,
  spendStep,
  fractionalPart,
  ZERO,
  ONE,
  MAX_FORCE,
} from './rational';

export type { Chord } from './chord';
export { chord, chordsInterleave, chordsCross } from './chord';

export type { Move, StepMove, EndTurnMove, Turn } from './move';
export {
  MOVE_KINDS,
  step,
  endTurn,
  isSatisfiableBy,
  movesEqual,
  turnsEqual,
  speed,
} from './move';

export type { BoardWindow, GeometryPort } from './geometry-port';

export type { GameState, Group, MergeOverride, Spawner } from './game-state';
export type { MatchConfig, SpawnerBand } from './match-config';
export {
  bandAtRadius,
  densityAtRadius,
  DEFAULT_MATCH_CONFIG,
  forceAtRadius,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SPAWNER_BANDS,
} from './match-config';
export type { AnchorGrade, Claim, CombatLosses, RulesPort, Traversal } from './rules-port';

export type {
  CreateInviteBody,
  ExportAgentReply,
  ExportLogEntry,
  ExportSeat,
  FinishedBody,
  GameExport,
  GameSummary,
  GameNumber,
  GoneBody,
  GroupHash,
  InviteBody,
  InviteSeat,
  InviteToken,
  LibraryChangedPayload,
  LibraryCounts,
  LibraryList,
  LibraryPageBody,
  LibrarySeat,
  LibrarySection,
  MeBody,
  MyGamesBody,
  OnlineHeaders,
  OnlineHttpResult,
  OnlinePort,
  OnlineRequest,
  OnlineWsPort,
  OnlineWsResult,
  OpenLobbyRow,
  PlannedSeatKind,
  SeatStanding,
  StartBody,
  StartedGameRow,
  StateChangedPayload,
  UserHash,
  WsConnectRequest,
  WsDisconnectRequest,
  WsPayload,
} from './online-port';
export { FINISHED_PAGE, MAX_LIBRARY_PAGE } from './online-port';

export type { GameNameResult } from './game-name';
export { DELETE_GAME_CONFIRM, GAME_NAME_MAX, gameTitle, normalizeGameName } from './game-name';

export type { LibraryGameStatus, LibrarySummary } from './library-status';
export { libraryStatusFor } from './library-status';

export { PLAYER_SEAT_LABELS, libraryVsLine, playerLetterLabel } from './library-row';
export { chairUserHash, labelInviteChair, seatLabel, seatLetter, usableSeatName } from './seat-label';
export type { SeatLabelInput, SeatLabelKind, SeatLabelRelation } from './seat-label';

export {
  GOOGLE_ID_TOKEN_SESSION_KEY,
  SUBMIT_OUTCOMES,
  SUBMIT_REFUSALS,
} from './online-pages-port';
export type {
  OnlineGameBoard,
  OnlinePagesDeps,
  OnlinePagesEnv,
  OnlinePagesFetch,
  OnlinePagesGis,
  OnlinePagesHttpRequest,
  OnlinePagesHttpResponse,
  OnlinePagesLocation,
  OnlinePagesOpenSocket,
  OnlinePagesPort,
  OnlinePagesSession,
  OnlinePagesSocket,
  PagesLobbyMode,
  ReplayBatch,
  SubmitOutcome,
  SubmitRefusal,
} from './online-pages-port';

export type { OnlineHostDeps, OnlineHostPort } from './online-host-port';

