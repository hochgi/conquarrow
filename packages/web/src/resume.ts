/**
 * Resume a local match (P90).
 *
 * Pure decisions and a thin storage backing. Resuming is `makeMatch` plus
 * `rules.apply` over the logged moves — no new game rule. No clock, no
 * randomness. `localStorage` is reached only inside {@link resumeBacking}
 * and {@link browserResumeBacking}.
 */

import { mintPlayerId } from '@conquarrow/contracts';
import type { GameState, MatchConfig, PlayerId } from '@conquarrow/contracts';
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import {
  MATCH_LOG_VERSION,
  emptyMatchSummary,
  serializeMatchLog,
} from './matchLog';
import type { ByokRunStats, MatchLog, MatchSummary, SeatDriverLog } from './matchLog';
import { parseMove } from './moves';
import { emptyByokFields } from './seatPlan';
import type { SeatConfig, SeatKind, SeatPlan } from './seatPlan';

const rules = makeRules(makeTiling());

/** Separate from `conquarrow:last-match`. */
export const RESUME_STORAGE_KEY = 'conquarrow:resume';

/** The Back confirm. Browser refresh copy is not ours to set. */
export const LEAVE_MATCH_CONFIRM =
  'Leave this game? It is saved; Resume it from the lobby.';

/**
 * Why a board is, or is not, the local match being played.
 *
 * A local match with heuristic seats is local: the camera following a bot
 * turn is not a spectated board. `spectated` / `replayed` are for a board
 * that is not that match. Online play and the tutorial are their own flags.
 */
export interface ResumeMode {
  readonly tutorial: boolean;
  readonly online: boolean;
  readonly spectated: boolean;
  readonly replayed: boolean;
}

/** The mode `startMatch` writes under: a new local match, nothing else. */
export const LOCAL_RESUME_MODE: ResumeMode = {
  tutorial: false,
  online: false,
  spectated: false,
  replayed: false,
};

/**
 * The mode of the board on screen. Local bot-camera follow is the match
 * being saved, so it is not passed as `spectated` or `replayed` — those
 * flags would drop the autosave the packet exists to keep.
 */
export const liveResumeMode = (args: {
  readonly tutorial: boolean;
  readonly online: boolean;
}): ResumeMode => ({
  tutorial: args.tutorial,
  online: args.online,
  spectated: false,
  replayed: false,
});

export const shouldAutosaveResume = (mode: ResumeMode): boolean =>
  !mode.tutorial && !mode.online && !mode.spectated && !mode.replayed;

const playableCount = (count: number): count is 3 | 6 => count === 3 || count === 6;

/** Human and heuristic seats only, and the match is not over. */
export const isResumable = (log: MatchLog): boolean => {
  if (log.winner !== undefined) return false;
  if (!playableCount(log.config.playerCount)) return false;
  if (log.seats.length !== log.config.playerCount) return false;
  return log.seats.every((seat) => seat.kind === 'human' || seat.kind === 'heuristic');
};

export type ResumeParsed =
  | { readonly ok: true; readonly log: MatchLog }
  | { readonly ok: false; readonly error: string };

export type ResumeReplayed =
  | { readonly ok: true; readonly log: MatchLog; readonly state: GameState }
  | { readonly ok: false; readonly error: string };

const rejection = (message: string): { readonly ok: false; readonly error: string } => {
  const flat = message.replaceAll('\n', ' ').trim();
  return { ok: false, error: flat.length > 0 ? flat : 'could not resume' };
};

const oneLine = (err: unknown): string =>
  err instanceof Error ? err.message : 'could not resume';

const asRecord = (raw: unknown, where: string): Record<string, unknown> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${where} is not an object`);
  }
  return raw as Record<string, unknown>;
};

const numberField = (rec: Record<string, unknown>, key: string, where: string): number => {
  const value = rec[key];
  if (typeof value !== 'number') throw new Error(`${where} ${key} is not a number`);
  return value;
};

const stringField = (rec: Record<string, unknown>, key: string, where: string): string => {
  const value = rec[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${where} ${key} is missing`);
  return value;
};

const BOT_MODES = ['human-hotseat', 'heuristic', 'byok', 'mixed'] as const;

const isBotMode = (value: string): value is MatchLog['botMode'] =>
  (BOT_MODES as readonly string[]).includes(value);

const isSeatKind = (value: unknown): value is SeatKind =>
  value === 'human' || value === 'heuristic' || value === 'byok';

const readConfig = (raw: unknown): MatchConfig => {
  const rec = asRecord(raw, 'config');
  return {
    dominationN: numberField(rec, 'dominationN', 'config'),
    R: numberField(rec, 'R', 'config'),
    homeOffset: numberField(rec, 'homeOffset', 'config'),
    playerCount: numberField(rec, 'playerCount', 'config'),
    spawnerSeed: numberField(rec, 'spawnerSeed', 'config'),
  };
};

const readSeat = (raw: unknown, index: number): SeatDriverLog => {
  const where = `seat ${String(index)}`;
  const rec = asRecord(raw, where);
  const kind = rec['kind'];
  if (!isSeatKind(kind)) throw new Error(`${where}: unknown seat kind`);
  const model = rec['model'];
  if (model !== undefined && model !== null && typeof model !== 'string') {
    throw new Error(`${where}: model is not a string`);
  }
  return {
    player: mintPlayerId(stringField(rec, 'player', where)),
    kind,
    ...(typeof model === 'string' ? { model } : {}),
  };
};

const readSeats = (raw: unknown): readonly SeatDriverLog[] => {
  if (!Array.isArray(raw)) throw new Error('seats are not a list');
  return raw.map((seat, index) => readSeat(seat, index));
};

const readMoves = (raw: unknown): MatchLog['moves'] => {
  if (!Array.isArray(raw)) throw new Error('moves are not a list');
  return raw.map((move, index) => parseMove(move, `move ${String(index)}`));
};

const optionalCount = (rec: Record<string, unknown>, key: string): number | undefined => {
  const value = rec[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number') throw new Error(`${key} is not a number`);
  return value;
};

const withOptionalCounts = (stats: ByokRunStats, rec: Record<string, unknown>): ByokRunStats => {
  const promptTokens = optionalCount(rec, 'promptTokens');
  const completionTokens = optionalCount(rec, 'completionTokens');
  const lengthOuts = optionalCount(rec, 'lengthOuts');
  const salvageParses = optionalCount(rec, 'salvageParses');
  const maxTokens = optionalCount(rec, 'maxTokens');
  return {
    ...stats,
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(lengthOuts === undefined ? {} : { lengthOuts }),
    ...(salvageParses === undefined ? {} : { salvageParses }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
};

const readByok = (raw: unknown, where: string): ByokRunStats => {
  const rec = asRecord(raw, where);
  const lastError = rec['lastError'];
  if (lastError !== undefined && lastError !== null && typeof lastError !== 'string') {
    throw new Error(`${where} lastError is not a string`);
  }
  return withOptionalCounts(
    {
      llmHits: numberField(rec, 'llmHits', where),
      llmFallbacks: numberField(rec, 'llmFallbacks', where),
      lastError: typeof lastError === 'string' ? lastError : undefined,
    },
    rec,
  );
};

const readOptionalByok = (raw: unknown): ByokRunStats | undefined => {
  if (raw === undefined || raw === null) return undefined;
  return readByok(raw, 'byok stats');
};

const readBySeat = (raw: unknown): Readonly<Record<string, ByokRunStats>> => {
  const rec = asRecord(raw, 'byok stats by seat');
  const out: Record<string, ByokRunStats> = {};
  for (const key of Object.keys(rec)) {
    out[key] = readByok(rec[key], `byok seat ${key}`);
  }
  return out;
};

const readOptionalBySeat = (raw: unknown): Readonly<Record<string, ByokRunStats>> | undefined => {
  if (raw === undefined || raw === null) return undefined;
  return readBySeat(raw);
};

const readSummary = (raw: unknown): MatchSummary => {
  if (raw === undefined) return emptyMatchSummary();
  const rec = asRecord(raw, 'summary');
  const first = rec['firstCloseAt'];
  if (first !== undefined && typeof first !== 'number') {
    throw new Error('firstCloseAt is not a number');
  }
  return {
    steps: numberField(rec, 'steps', 'summary'),
    endTurns: numberField(rec, 'endTurns', 'summary'),
    closes: numberField(rec, 'closes', 'summary'),
    cuts: numberField(rec, 'cuts', 'summary'),
    firstCloseAt: typeof first === 'number' ? first : undefined,
  };
};

const readOptionalPlayer = (raw: unknown, where: string): PlayerId | undefined => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' || raw.length === 0) throw new Error(`${where} is not a string`);
  return mintPlayerId(raw);
};

const readMatchLog = (raw: unknown): MatchLog => {
  const rec = asRecord(raw, 'resume save');
  if (rec['version'] !== MATCH_LOG_VERSION) throw new Error('resume save version is not 1');
  const botMode = stringField(rec, 'botMode', 'resume save');
  if (!isBotMode(botMode)) throw new Error('resume save bot mode is unknown');
  const vsBot = rec['vsBot'];
  if (typeof vsBot !== 'boolean') throw new Error('resume save vsBot is not a boolean');
  return {
    version: MATCH_LOG_VERSION,
    config: readConfig(rec['config']),
    startedAt: stringField(rec, 'startedAt', 'resume save'),
    vsBot,
    botMode,
    seats: readSeats(rec['seats']),
    byokStats: readOptionalByok(rec['byokStats']),
    byokStatsBySeat: readOptionalBySeat(rec['byokStatsBySeat']),
    humanSeat: mintPlayerId(stringField(rec, 'humanSeat', 'resume save')),
    botSeat: readOptionalPlayer(rec['botSeat'], 'botSeat'),
    moves: readMoves(rec['moves']),
    winner: readOptionalPlayer(rec['winner'], 'winner'),
    summary: readSummary(rec['summary']),
  };
};

/** Strict. A bad save is an error, never a partial log. */
export const parseResumeLog = (raw: string): ResumeParsed => {
  try {
    return { ok: true, log: readMatchLog(JSON.parse(raw) as unknown) };
  } catch (err) {
    return rejection(oneLine(err));
  }
};

/**
 * `makeMatch(log.config)`, then `rules.apply` for every logged move.
 * A refused move is an error — the result has no state, so a prefix cannot
 * be started. The returned log is the one passed in.
 */
export const replayResumeLog = (log: MatchLog): ResumeReplayed => {
  try {
    let state = makeMatch(log.config);
    for (const [index, move] of log.moves.entries()) {
      try {
        state = rules.apply(state, move);
      } catch (err) {
        return rejection(`move ${String(index)}: ${oneLine(err)}`);
      }
    }
    return { ok: true, log, state };
  } catch (err) {
    return rejection(oneLine(err));
  }
};

export interface ResumeBacking {
  read(): string | undefined;
  write(value: string): void;
  remove(): void;
}

export interface ResumeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const emptyBacking = (): ResumeBacking => ({
  read: () => undefined,
  write: () => undefined,
  remove: () => undefined,
});

/** The only place a resume save touches a storage object. `undefined` is "no window". */
export const resumeBacking = (storage: ResumeStorage | undefined): ResumeBacking => {
  if (storage === undefined) return emptyBacking();
  return {
    read: () => {
      const raw = storage.getItem(RESUME_STORAGE_KEY);
      if (raw === null || raw.length === 0) return undefined;
      return raw;
    },
    write: (value) => {
      storage.setItem(RESUME_STORAGE_KEY, value);
    },
    remove: () => {
      storage.removeItem(RESUME_STORAGE_KEY);
    },
  };
};

/** Browser composition root. Callers never touch `localStorage` themselves. */
export const browserResumeBacking = (): ResumeBacking =>
  resumeBacking(typeof localStorage === 'undefined' ? undefined : localStorage);

export interface ResumeStore {
  save(log: MatchLog): void;
  /** The log, or nothing when missing, unreadable, or the backing throws. */
  load(): MatchLog | undefined;
  /** Raw text even when it does not parse. Nothing when missing or the backing throws. */
  readRaw(): string | undefined;
  remove(): void;
}

const quiet = (body: () => void): void => {
  try {
    body();
  } catch {
    // A private window throws. The match must keep playing.
  }
};

export const createResumeStore = (backing: ResumeBacking): ResumeStore => ({
  save: (log) => {
    quiet(() => {
      backing.write(serializeMatchLog(log));
    });
  },
  load: () => {
    try {
      const raw = backing.read();
      if (raw === undefined || raw.length === 0) return undefined;
      const parsed = parseResumeLog(raw);
      return parsed.ok ? parsed.log : undefined;
    } catch {
      return undefined;
    }
  },
  readRaw: () => {
    try {
      const raw = backing.read();
      if (raw === undefined || raw.length === 0) return undefined;
      return raw;
    } catch {
      return undefined;
    }
  },
  remove: () => {
    quiet(() => {
      backing.remove();
    });
  },
});

/**
 * Write the resume save after a local move, replace it when a local match
 * starts, or delete it when that match has a winner. Any other mode leaves
 * the existing save untouched.
 */
export const persistResume = (store: ResumeStore, log: MatchLog, mode: ResumeMode): void => {
  if (!shouldAutosaveResume(mode)) return;
  if (log.winner !== undefined) {
    store.remove();
    return;
  }
  store.save(log);
};

/**
 * One line: seat kinds in log order, the 1-based round, the move count.
 * Round is `floor(endTurns / playerCount) + 1` — the round the resumed
 * position is in, without replaying.
 */
export const resumeDescription = (log: MatchLog): string => {
  const seats = log.seats.map((seat) => `${String(seat.player)} ${seat.kind}`).join(' · ');
  const endTurns = log.moves.reduce((count, move) => count + (move.kind === 'endTurn' ? 1 : 0), 0);
  const players = log.config.playerCount;
  const round = players > 0 ? Math.floor(endTurns / players) + 1 : 1;
  return `${seats} · round ${String(round)} · ${String(log.moves.length)} moves`;
};

/** Seat plan rebuilt from `log.seats`. Kinds only — the log holds no API key. */
export const seatPlanFromLog = (log: MatchLog): SeatPlan => {
  const count = log.config.playerCount;
  if (!playableCount(count)) {
    throw new Error(`resume: playerCount ${String(count)} is not 3 or 6`);
  }
  if (log.seats.length !== count) {
    throw new Error('resume: seat count does not match playerCount');
  }
  return {
    playerCount: count,
    seats: log.seats.map((seat) => ({ kind: seat.kind, byok: emptyByokFields() })),
  };
};

/** Maps the rebuilt plan onto the replayed players so the bot effect can run. */
export const seatRuntimeFromPlan = (
  plan: SeatPlan,
  players: readonly PlayerId[],
): {
  readonly configs: ReadonlyMap<string, SeatConfig>;
  readonly aiKeys: ReadonlySet<string>;
} => {
  const configs = new Map<string, SeatConfig>();
  const aiKeys = new Set<string>();
  for (let i = 0; i < plan.seats.length; i += 1) {
    const seat = plan.seats[i];
    const player = players[i];
    if (seat === undefined || player === undefined) continue;
    configs.set(String(player), seat);
    if (seat.kind === 'heuristic' || seat.kind === 'byok') aiKeys.add(String(player));
  }
  return { configs, aiKeys };
};

export type ResumeOffer =
  | { readonly kind: 'empty' }
  | { readonly kind: 'error'; readonly error: string; readonly raw: string }
  | { readonly kind: 'download'; readonly log: MatchLog; readonly raw: string }
  | {
      readonly kind: 'offer';
      readonly log: MatchLog;
      readonly description: string;
      readonly raw: string;
    };

/**
 * What the lobby can show from the saved text alone. Replay is not run here:
 * a move `rules.apply` refuses is reported when Resume is asked, not by
 * painting a prefix.
 */
export const resumeOffer = (raw: string | undefined): ResumeOffer => {
  if (raw === undefined || raw.length === 0) return { kind: 'empty' };
  const parsed = parseResumeLog(raw);
  if (!parsed.ok) return { kind: 'error', error: parsed.error, raw };
  if (!isResumable(parsed.log)) return { kind: 'download', log: parsed.log, raw };
  return {
    kind: 'offer',
    log: parsed.log,
    description: resumeDescription(parsed.log),
    raw,
  };
};

export const shouldGuardLeave = (args: {
  readonly mode: ResumeMode;
  readonly winner: PlayerId | undefined;
}): boolean => shouldAutosaveResume(args.mode) && args.winner === undefined;

/** Cancel stays (the caller pushes the history entry again). OK returns to the lobby. */
export const leaveChoice = (confirmed: boolean): 'stay' | 'lobby' =>
  confirmed ? 'lobby' : 'stay';

/** Download a save that did not parse. No-ops outside a browser. */
export const downloadRawText = (filename: string, text: string): void => {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
