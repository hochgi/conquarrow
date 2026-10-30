/**
 * One benched match: the BYOK chair against the heuristic seat, headless, through
 * the same adapter functions the browser uses (`playLlmBotTurn`, `playBotTurn`).
 *
 * Deterministic given its chair driver: no clock, no randomness, and the
 * adapter's module state is cleared first, so a match never inherits the
 * previous match's plans or target locks (P79 hygiene).
 */

import { ZERO } from '@conquarrow/contracts';
import type { GameState, Move, PlayerId, Rational } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { clearByokPlans, type LlmBotTurn } from '../../src/byokBot';
import { emptyMatchSummary, foldMatchSummary, type MatchSummary } from '../../src/matchLog';
import { playBotTurn } from '../../src/opponent';
import { clearTargetLocks } from '../../src/targets';
import { geometry, rules } from './board';
import { matchConfigFor, seatIndexOf, type Cell } from './grid';
import { ZERO_COST, type CostTotals } from './budget';
import { formatRational, headsOf, incomeRate, landOf, maxRational, totalLand } from './metrics';
import { serializeMove, type SerializedMove } from './moves';
import type { Outcome } from './score';
import { playByokSeatTurn, type ByokSeat } from './seat';

/** Who drives the BYOK chair: a model (`matches`), or the heuristic (`mirror`). */
export type ChairDriver = { readonly kind: 'heuristic' } | ByokSeat;

export interface MatchSpec {
  readonly cell: Cell;
  /** K: the match ends after this many full rounds. */
  readonly cap: number;
  readonly chair: ChairDriver;
  /** Told every {@link PROGRESS_EVERY} full rounds. Observation only: never feeds play. */
  readonly progress?: ((line: string) => void) | undefined;
}

export const PROGRESS_EVERY = 10;

export interface ByokTotals {
  /** BYOK seat-turns played. */
  readonly turns: number;
  readonly hits: number;
  /** Seat-turns the heuristic finished because the model's reply was unusable or unreachable. */
  readonly fallbacks: number;
  /** Completions requested (one per POST that reached the adapter). */
  readonly calls: number;
  readonly retries: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly lengthOuts: number;
  readonly salvageParses: number;
}

export interface MatchRecord {
  readonly cell: Cell;
  readonly driver: 'byok' | 'heuristic';
  readonly players: readonly string[];
  /** The BYOK chair's seat (`A` when seated first, `B` when second). */
  readonly byokPlayer: string;
  readonly cap: number;
  /** Full rounds completed when the match ended. */
  readonly rounds: number;
  readonly outcome: Outcome;
  readonly winner: string | null;
  readonly byok: ByokTotals;
  /** What this match's model calls cost (zero for the heuristic chair). */
  readonly cost: CostTotals;
  /** The last fallback reason, if any. Redacted before it is written or printed. */
  readonly lastError: string | null;
  /** Reported, not gated. */
  readonly secondary: {
    /** Two seats: the match ends when one is out, so this is `rounds`. */
    readonly roundsSurvived: number;
    readonly peakIncome: string;
    readonly finalHeads: number;
    /** Moves by the chair after which its territory grew. */
    readonly closes: number;
  };
  readonly summary: Omit<MatchSummary, 'firstCloseAt'> & { readonly firstCloseAt: number | null };
  /** Replayable from `makeMatch(matchConfigFor(cell.seed))`. */
  readonly moves: readonly SerializedMove[];
}

interface Tally {
  rounds: number;
  summary: MatchSummary;
  closes: number;
  peakIncome: Rational;
  byok: { -readonly [K in keyof ByokTotals]: ByokTotals[K] };
  lastError: string | undefined;
  aborted: boolean;
  readonly moves: Move[];
}

const newTally = (): Tally => ({
  rounds: 0,
  summary: emptyMatchSummary(),
  closes: 0,
  peakIncome: ZERO,
  byok: {
    turns: 0,
    hits: 0,
    fallbacks: 0,
    calls: 0,
    retries: 0,
    promptTokens: 0,
    completionTokens: 0,
    lengthOuts: 0,
    salvageParses: 0,
  },
  lastError: undefined,
  aborted: false,
  moves: [],
});

const addByokTurn = (tally: Tally, turn: LlmBotTurn): void => {
  const b = tally.byok;
  b.turns += 1;
  b.hits += turn.llmHits;
  b.fallbacks += turn.llmFallbacks;
  b.promptTokens += turn.promptTokens ?? 0;
  b.completionTokens += turn.completionTokens ?? 0;
  b.lengthOuts += turn.lengthOuts ?? 0;
  b.salvageParses += turn.salvageParses ?? 0;
  if (turn.lastError !== undefined) tally.lastError = turn.lastError;
};

/** A function, not a property read: the meter changes under an `await`. */
const budgetSpent = (seat: ByokSeat): boolean => seat.meter.exhausted;

/**
 * One turn's moves, or none when the budget stopped the chair: then the match is
 * aborted and the turn — whatever the fallback played — is not folded in.
 */
const playTurn = async (
  spec: MatchSpec,
  tally: Tally,
  state: GameState,
  chairToMove: boolean,
): Promise<readonly Move[]> => {
  if (chairToMove && spec.chair.kind === 'byok') {
    if (budgetSpent(spec.chair)) {
      tally.aborted = true;
      return [];
    }
    const turn = await playByokSeatTurn(spec.chair, state);
    if (budgetSpent(spec.chair)) {
      tally.aborted = true;
      return [];
    }
    addByokTurn(tally, turn);
    return turn.moves;
  }
  return playBotTurn(geometry, rules, state, state.activePlayer).moves;
};

/** Re-apply a turn's moves one at a time — the fold the app's log runs per applied move. */
const foldTurn = (tally: Tally, start: GameState, moves: readonly Move[], chair: PlayerId): GameState => {
  let at = start;
  for (const move of moves) {
    if (at.winner !== undefined) break;
    const after = rules.apply(at, move);
    tally.summary = foldMatchSummary(tally.summary, [move], at, after, tally.moves.length);
    if (at.activePlayer === chair && landOf(after, chair) > landOf(at, chair)) tally.closes += 1;
    if (move.kind === 'endTurn' && after.activePlayer === after.players[0]) tally.rounds += 1;
    tally.moves.push(move);
    at = after;
  }
  return at;
};

const outcomeOf = (state: GameState, chair: PlayerId, tally: Tally): Outcome => {
  const rounds = tally.rounds;
  if (tally.aborted) return { kind: 'aborted_budget', round: rounds };
  if (state.winner === chair) return { kind: 'won', round: rounds };
  if (state.winner !== undefined) return { kind: 'eliminated', round: rounds };
  return { kind: 'capped', round: rounds, land: landOf(state, chair), totalLand: totalLand(state) };
};

const toRecord = (spec: MatchSpec, tally: Tally, state: GameState, chair: PlayerId): MatchRecord => ({
  cell: spec.cell,
  driver: spec.chair.kind,
  players: state.players.map(String),
  byokPlayer: String(chair),
  cap: spec.cap,
  rounds: tally.rounds,
  outcome: outcomeOf(state, chair, tally),
  winner: state.winner === undefined ? null : String(state.winner),
  byok:
    spec.chair.kind === 'byok'
      ? { ...tally.byok, calls: spec.chair.counters.calls, retries: spec.chair.counters.retries }
      : tally.byok,
  cost: spec.chair.kind === 'byok' ? spec.chair.tally.cost : ZERO_COST,
  lastError: tally.lastError ?? null,
  secondary: {
    roundsSurvived: tally.rounds,
    peakIncome: formatRational(tally.peakIncome),
    finalHeads: headsOf(state, chair),
    closes: tally.closes,
  },
  summary: { ...tally.summary, firstCloseAt: tally.summary.firstCloseAt ?? null },
  moves: tally.moves.map(serializeMove),
});

export const runMatch = async (spec: MatchSpec): Promise<MatchRecord> => {
  clearByokPlans();
  clearTargetLocks();
  let state = makeMatch(matchConfigFor(spec.cell.seed));
  const chair = state.players[seatIndexOf(spec.cell.byokSeat)];
  if (chair === undefined) throw new Error(`cell ${spec.cell.id}: no seat for the BYOK chair`);
  const tally = newTally();
  while (state.winner === undefined && tally.rounds < spec.cap) {
    const mover = state.activePlayer;
    const roundsBefore = tally.rounds;
    const moves = await playTurn(spec, tally, state, mover === chair);
    if (tally.aborted) break;
    if (moves.length === 0) throw new Error(`cell ${spec.cell.id}: seat ${String(mover)} made no move`);
    state = foldTurn(tally, state, moves, chair);
    tally.peakIncome = maxRational(tally.peakIncome, incomeRate(state, chair));
    if (spec.progress !== undefined && tally.rounds > roundsBefore && tally.rounds % PROGRESS_EVERY === 0) {
      spec.progress(`${spec.cell.id}: round ${String(tally.rounds)} of at most ${String(spec.cap)}`);
    }
  }
  return toRecord(spec, tally, state, chair);
};
