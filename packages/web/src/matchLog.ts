/**
 * Adapter-side match record for playtest review.
 *
 * Same shape P10 expects: setup config + ordered moves. The core never sees this —
 * `makeMatch(config)` rebuilds the opening, `replay` folds the moves.
 */

import type { GameState, MatchConfig, Move, PlayerId } from '@conquarrow/contracts';
import type { SeatDriverSummary, SeatKind } from './seatPlan';

export const MATCH_LOG_VERSION = 1 as const;

export const LAST_MATCH_STORAGE_KEY = 'conquarrow:last-match';

/** Aggregate how chairs were driven — never includes API keys. */
export type BotMode = SeatDriverSummary;

export interface ByokRunStats {
  readonly llmHits: number;
  readonly llmFallbacks: number;
  /** Last fallback reason, if any (CORS / HTTP / parse). No secrets. */
  readonly lastError: string | undefined;
}

/** Per-seat driver metadata persisted in the match log (no secrets). */
export interface SeatDriverLog {
  readonly player: PlayerId;
  readonly kind: SeatKind;
  /** Model id when kind is byok — never the API key. */
  readonly model?: string;
}

/**
 * Lightweight playtest counters. Folded on each logged apply; never rules-core.
 * Close = some player's territory count grew. Cut = some living player's trail
 * shrank and that same player did not gain territory in the batch. A vanished
 * seat's trail drop is not a cut.
 */
export interface MatchSummary {
  readonly steps: number;
  readonly endTurns: number;
  readonly closes: number;
  readonly cuts: number;
  /** Index into `moves` when territory first grew for anyone; undefined if never. */
  readonly firstCloseAt: number | undefined;
}

export const emptyMatchSummary = (): MatchSummary => ({
  steps: 0,
  endTurns: 0,
  closes: 0,
  cuts: 0,
  firstCloseAt: undefined,
});

/** One scan of a territory map → count of arrows per owner. */
const territoryCounts = (state: GameState): Map<PlayerId, number> => {
  const counts = new Map<PlayerId, number>();
  for (const owner of state.territory.values()) {
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return counts;
};

/** Players in before ∪ after whose territory count increased. */
const territoryGainers = (before: GameState, after: GameState): ReadonlySet<PlayerId> => {
  const beforeCounts = territoryCounts(before);
  const afterCounts = territoryCounts(after);
  const gainers = new Set<PlayerId>();
  const players = new Set<PlayerId>(before.players);
  for (const player of after.players) players.add(player);
  for (const player of players) {
    if ((afterCounts.get(player) ?? 0) > (beforeCounts.get(player) ?? 0)) {
      gainers.add(player);
    }
  }
  return gainers;
};

const trailSize = (state: GameState, player: PlayerId): number =>
  state.trails.get(player)?.size ?? 0;

const groupMap = (game: GameState): GameState['groups'] | undefined =>
  (game as { readonly groups?: GameState['groups'] }).groups;

/**
 * Same formula as the event layer. A missing groups map (P32 territory/trail
 * stubs) means that player owns no group here — and is *not* treated as vanished,
 * because the stub cannot tell a living cut from a seat leaving.
 */
const hadPieces = (game: GameState, player: PlayerId): boolean => {
  const groups = groupMap(game);
  if (groups !== undefined) {
    for (const group of groups.values()) if (group.owner === player) return true;
  }
  if ((game.trails.get(player)?.size ?? 0) > 0) return true;
  for (const owner of game.territory.values()) if (owner === player) return true;
  return false;
};

const vanishedOnStep = (before: GameState, after: GameState, player: PlayerId): boolean => {
  if (groupMap(before) === undefined || groupMap(after) === undefined) return false;
  return hadPieces(before, player) && !hadPieces(after, player);
};

/** Trail shrank for a living player who did not also gain territory. */
const hasCutVictim = (
  before: GameState,
  after: GameState,
  gainers: ReadonlySet<PlayerId>,
): boolean => {
  const players = new Set<PlayerId>(before.trails.keys());
  for (const player of after.trails.keys()) players.add(player);
  for (const player of players) {
    if (trailSize(after, player) >= trailSize(before, player)) continue;
    if (gainers.has(player)) continue;
    if (vanishedOnStep(before, after, player)) continue;
    return true;
  }
  return false;
};

/** Pure fold of one applied batch into running counters. */
export const foldMatchSummary = (
  summary: MatchSummary,
  moves: readonly Move[],
  before: GameState,
  after: GameState,
  movesLoggedBefore: number,
): MatchSummary => {
  if (moves.length === 0) return summary;
  let steps = summary.steps;
  let endTurns = summary.endTurns;
  for (const m of moves) {
    switch (m.kind) {
      case 'step':
        steps += 1;
        break;
      case 'endTurn':
        endTurns += 1;
        break;
    }
  }
  const gainers = territoryGainers(before, after);
  const closed = gainers.size > 0;
  const cut = hasCutVictim(before, after, gainers);
  const closes = summary.closes + (closed ? 1 : 0);
  const cuts = summary.cuts + (cut ? 1 : 0);
  let firstCloseAt = summary.firstCloseAt;
  if (closed && firstCloseAt === undefined) {
    // Index of the first move in this batch within the full log.
    firstCloseAt = movesLoggedBefore;
  }
  return { steps, endTurns, closes, cuts, firstCloseAt };
};

/** One-line HUD / review string. */
export const formatMatchSummary = (summary: MatchSummary): string => {
  const parts = [
    `${String(summary.steps)} steps`,
    `${String(summary.endTurns)} end-turns`,
    `${String(summary.closes)} closes`,
    `${String(summary.cuts)} cuts`,
  ];
  if (summary.firstCloseAt !== undefined) {
    parts.push(`first close @ move ${String(summary.firstCloseAt)}`);
  }
  return parts.join(' · ');
};

/** HUD line when the match is over; unset while play continues. */
export const matchSummaryLine = (
  over: boolean,
  summary: MatchSummary | undefined,
): string | undefined =>
  over && summary !== undefined ? formatMatchSummary(summary) : undefined;

export interface MatchLog {
  readonly version: typeof MATCH_LOG_VERSION;
  readonly config: MatchConfig;
  /** ISO timestamp from the adapter clock — review metadata only. */
  readonly startedAt: string;
  /** True when at least one seat is non-human. */
  readonly vsBot: boolean;
  readonly botMode: BotMode;
  readonly seats: readonly SeatDriverLog[];
  readonly byokStats: ByokRunStats | undefined;
  readonly byokStatsBySeat: Readonly<Record<string, ByokRunStats>> | undefined;
  /** First human seat, if any — else seat A. */
  readonly humanSeat: PlayerId;
  /** First AI seat, if any. */
  readonly botSeat: PlayerId | undefined;
  readonly moves: readonly Move[];
  readonly winner: PlayerId | undefined;
  /** Playtest counters; always present on new logs. */
  readonly summary: MatchSummary;
}

export const createMatchLog = (args: {
  readonly config: MatchConfig;
  readonly vsBot: boolean;
  readonly botMode: BotMode;
  readonly seats: readonly SeatDriverLog[];
  readonly humanSeat: PlayerId;
  readonly botSeat: PlayerId | undefined;
  readonly startedAt?: string;
}): MatchLog => {
  const anyByok = args.seats.some((s) => s.kind === 'byok');
  return {
    version: MATCH_LOG_VERSION,
    config: args.config,
    startedAt: args.startedAt ?? new Date().toISOString(),
    vsBot: args.vsBot,
    botMode: args.botMode,
    seats: args.seats,
    byokStats: anyByok ? { llmHits: 0, llmFallbacks: 0, lastError: undefined } : undefined,
    byokStatsBySeat: anyByok ? {} : undefined,
    humanSeat: args.humanSeat,
    botSeat: args.botSeat,
    moves: [],
    winner: undefined,
    summary: emptyMatchSummary(),
  };
};

export const appendMoves = (log: MatchLog, moves: readonly Move[]): MatchLog => {
  if (moves.length === 0) return log;
  return { ...log, moves: [...log.moves, ...moves] };
};

/** Append moves and fold summary from before→after. */
export const appendMovesWithSummary = (
  log: MatchLog,
  moves: readonly Move[],
  before: GameState,
  after: GameState,
): MatchLog => {
  if (moves.length === 0) return log;
  const summary = foldMatchSummary(
    log.summary,
    moves,
    before,
    after,
    log.moves.length,
  );
  return { ...log, moves: [...log.moves, ...moves], summary };
};

export const withByokStats = (
  log: MatchLog,
  delta: ByokRunStats,
  seat?: PlayerId,
): MatchLog => {
  if (log.byokStats === undefined && log.byokStatsBySeat === undefined) return log;
  const prev = log.byokStats ?? { llmHits: 0, llmFallbacks: 0, lastError: undefined };
  const aggregate: ByokRunStats = {
    llmHits: prev.llmHits + delta.llmHits,
    llmFallbacks: prev.llmFallbacks + delta.llmFallbacks,
    lastError: delta.lastError ?? prev.lastError,
  };
  let bySeat = log.byokStatsBySeat;
  if (seat !== undefined) {
    const key = String(seat);
    const seatPrev = bySeat?.[key] ?? { llmHits: 0, llmFallbacks: 0, lastError: undefined };
    bySeat = {
      ...(bySeat ?? {}),
      [key]: {
        llmHits: seatPrev.llmHits + delta.llmHits,
        llmFallbacks: seatPrev.llmFallbacks + delta.llmFallbacks,
        lastError: delta.lastError ?? seatPrev.lastError,
      },
    };
  }
  return {
    ...log,
    byokStats: aggregate,
    ...(bySeat === undefined ? {} : { byokStatsBySeat: bySeat }),
  };
};

export const withWinner = (log: MatchLog, winner: PlayerId | undefined): MatchLog =>
  log.winner === winner ? log : { ...log, winner };

export const serializeMatchLog = (log: MatchLog): string => `${JSON.stringify(log, null, 2)}\n`;

/** Persist for post-game review. No-ops outside a browser. */
export const saveMatchLog = (log: MatchLog): void => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LAST_MATCH_STORAGE_KEY, serializeMatchLog(log));
};

export const loadLastMatchLog = (): MatchLog | undefined => {
  if (typeof localStorage === 'undefined') return undefined;
  const raw = localStorage.getItem(LAST_MATCH_STORAGE_KEY);
  if (raw === null || raw.length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as Omit<MatchLog, 'summary'> & {
      readonly summary?: MatchSummary;
    };
    if (parsed.summary === undefined) {
      return { ...parsed, summary: emptyMatchSummary() };
    }
    return { ...parsed, summary: parsed.summary };
  } catch {
    return undefined;
  }
};

export const downloadMatchLog = (log: MatchLog, filename?: string): void => {
  if (typeof document === 'undefined') return;
  const blob = new Blob([serializeMatchLog(log)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download =
    filename ??
    `conquarrow-match-${log.startedAt.replaceAll(':', '').replaceAll('.', '-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
};
