/**
 * Fixture replay and premise checks for P84
 * (docs/spec/heuristic-never-idle/heuristic-never-idle.md).
 *
 * Two committed fixtures are replayed from `makeMatch(config)`:
 * - `playtest-2026-11-02.match-log.json` — the verbatim playtest log
 *   (3 seats; A and B heuristic, C human);
 * - `mirror-s3.moves.json` — the first 173 moves of the P84 baseline mirror
 *   run's `s3-first` cell.
 *
 * Every premise a scenario states ("it is seat A's turn", "a step is legal",
 * "the logged turn is a lone endTurn") is *checked* here and throws `setup:`
 * when it fails — never a red test for the wrong reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { movesEqual } from '@conquarrow/contracts';
import type { GameState, MatchConfig, Move, PlayerId } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { parseMove } from '../src/moves';
import { isThreatenedKite, kiteLength } from '../src/botMission';
import { neverIdle, type NeverIdleComplete, type NeverIdleSearch } from '../src/botNeverIdle';
import { evaluate, planKey } from '../src/botSearch';
import { chooseMove } from '../src/opponent';
import { foldPlan, geometry, rules } from './bot-turn-search.support';
import { specMissionContext } from './mission-and-staging.support';

export {
  foldPlan,
  geometry,
  legalSteps,
  passIsBestPosition,
  passWithManyStepsPosition,
  planIsLegalSequence,
  planTerminates,
  rules,
} from './bot-turn-search.support';
export { shuffleCloseMaps } from './close-and-spawner-value.support';
export { boxedAfterOccupy } from './opponent-ply-and-denial.support';
export {
  botSearchSource,
  sourceWithoutComments,
  specHasLumpReady,
  specIsThreatenedKite,
  specKiteLength,
  specMissionContext,
  specOwnStacksAllSingle,
  threatenedKiteNoStagingPosition,
} from './mission-and-staging.support';

const here = dirname(fileURLToPath(import.meta.url));

export const botNeverIdleSource = (): string =>
  readFileSync(join(here, '../src/botNeverIdle.ts'), 'utf8');

// ---------------------------------------------------------------------------
// Fixture replay
// ---------------------------------------------------------------------------

export type SeatLabel = 'A' | 'B' | 'C';

export type Replay = {
  readonly name: string;
  readonly moves: readonly Move[];
  /** `states[n]` is the state after the first `n` moves (`states[0]` = `makeMatch`). */
  readonly states: readonly GameState[];
};

type FixtureJson = {
  readonly config: MatchConfig;
  readonly moves: readonly unknown[];
};

const cache = new Map<string, Replay>();

/** Replays `fixtures/<file>` from `makeMatch(config)`; cached by `name`. Reused by P85's support. */
export const loadReplay = (name: string, file: string, until?: number): Replay => {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const raw = JSON.parse(readFileSync(join(here, 'fixtures', file), 'utf8')) as FixtureJson;
  // `until` keeps the prefix of a log recorded under older rules: its first move the
  // current rules refuse, and everything after, is dropped. Any refusal before it throws.
  const moves = raw.moves
    .slice(0, until)
    .map((m, i) => parseMove(m, `${name} move ${String(i)}`));
  const states: GameState[] = [makeMatch(raw.config)];
  let at = states[0];
  for (const [i, move] of moves.entries()) {
    if (at === undefined) break;
    try {
      at = rules.apply(at, move);
    } catch (err) {
      throw new Error(`setup: ${name} move ${String(i)} does not replay: ${String(err)}`);
    }
    states.push(at);
  }
  const replay: Replay = { name, moves, states };
  cache.set(name, replay);
  return replay;
};

export const playtest = (): Replay =>
  loadReplay('playtest-2026-11-02', 'playtest-2026-11-02.match-log.json');

export const mirrorS3 = (): Replay => loadReplay('mirror-s3', 'mirror-s3.moves.json');

export const stateAt = (replay: Replay, n: number): GameState => {
  const state = replay.states[n];
  if (state === undefined) {
    throw new Error(`setup: ${replay.name} has no state after ${String(n)} moves`);
  }
  return state;
};

/** Seat label → player id, by seat order (A moves first). */
export const seatOf = (state: GameState, seat: SeatLabel): PlayerId => {
  const index = seat === 'A' ? 0 : seat === 'B' ? 1 : 2;
  const id = state.players[index];
  if (id === undefined) throw new Error(`setup: no seat ${seat}`);
  return id;
};

/** Round (1-based) in which the turn starting at move `n` is played. */
export const roundAt = (replay: Replay, n: number): number => {
  let rounds = 1;
  for (let i = 1; i <= n; i += 1) {
    const before = replay.states[i - 1];
    const after = replay.states[i];
    if (before === undefined || after === undefined) break;
    const first = after.players[0];
    if (before.activePlayer !== first && after.activePlayer === first) rounds += 1;
  }
  return rounds;
};

/** True when move `n` starts the active seat's turn. */
export const isTurnStart = (replay: Replay, n: number): boolean => {
  const state = replay.states[n];
  if (state === undefined || state.winner !== undefined) return false;
  if (n === 0) return true;
  const prev = replay.states[n - 1];
  return prev !== undefined && prev.activePlayer !== state.activePlayer;
};

/** The logged moves of the turn that starts at move `n` (through its `endTurn` or the match end). */
export const loggedTurn = (replay: Replay, n: number): readonly Move[] => {
  const start = stateAt(replay, n);
  const out: Move[] = [];
  for (let i = n; i < replay.moves.length; i += 1) {
    const move = replay.moves[i];
    const after = replay.states[i + 1];
    if (move === undefined || after === undefined) break;
    out.push(move);
    if (after.winner !== undefined || after.activePlayer !== start.activePlayer) return out;
  }
  throw new Error(`setup: ${replay.name} turn at move ${String(n)} is not complete in the fixture`);
};

/** Same moves in the same order. */
export const sameMoves = (a: readonly Move[], b: readonly Move[]): boolean =>
  a.length === b.length && a.every((m, i) => {
    const o = b[i];
    return o !== undefined && movesEqual(m, o);
  });

export const hasStep = (moves: readonly Move[]): boolean => moves.some((m) => m.kind === 'step');

/** Spec Terms "step is legal": `rules.legalMoves` offers at least one step. */
export const stepIsLegal = (state: GameState): boolean => hasStep(rules.legalMoves(state));

export type TurnStart = {
  readonly index: number;
  readonly round: number;
  readonly seat: SeatLabel;
  readonly state: GameState;
  readonly me: PlayerId;
};

/** Every turn start of `seats` in rounds `[from, to]`, in move order. */
export const turnStarts = (
  replay: Replay,
  seats: readonly SeatLabel[],
  from: number,
  to: number,
): readonly TurnStart[] => {
  const out: TurnStart[] = [];
  let round = 1;
  for (let n = 0; n < replay.moves.length; n += 1) {
    const state = stateAt(replay, n);
    const prev = n === 0 ? undefined : replay.states[n - 1];
    if (prev !== undefined && prev.activePlayer !== state.players[0] && state.activePlayer === state.players[0]) {
      round += 1;
    }
    if (round > to) break;
    if (round < from || !isTurnStart(replay, n)) continue;
    const seat = seats.find((s) => seatOf(state, s) === state.activePlayer);
    if (seat === undefined) continue;
    out.push({ index: n, round, seat, state, me: state.activePlayer });
  }
  return out;
};

/**
 * The position the scenario names: move `index` starts `seat`'s turn in
 * `round`, a step is legal, and the logged turn is a lone `endTurn`.
 */
export const passTurnAt = (
  replay: Replay,
  index: number,
  seat: SeatLabel,
  round: number,
): TurnStart => {
  const state = stateAt(replay, index);
  const me = seatOf(state, seat);
  const where = `${replay.name}@${String(index)}`;
  if (state.activePlayer !== me) throw new Error(`setup: ${where} is not seat ${seat}'s turn`);
  if (!isTurnStart(replay, index)) throw new Error(`setup: ${where} is not a turn start`);
  if (roundAt(replay, index) !== round) {
    throw new Error(`setup: ${where} is round ${String(roundAt(replay, index))}, not ${String(round)}`);
  }
  if (!stepIsLegal(state)) throw new Error(`setup: ${where} has no legal step`);
  const logged = loggedTurn(replay, index);
  if (logged.length !== 1 || logged[0]?.kind !== 'endTurn') {
    throw new Error(`setup: ${where} logged turn is not a lone endTurn`);
  }
  return { index, round, seat, state, me };
};

// ---------------------------------------------------------------------------
// The positions the diagnosis found
// ---------------------------------------------------------------------------

/** Spec "Fixture" table: the 13 playtest turn starts where the seat passed with a step legal. */
export const PLAYTEST_PASS_TURNS = [
  { round: 6, seat: 'A', index: 53 },
  { round: 7, seat: 'A', index: 60 },
  { round: 8, seat: 'A', index: 68 },
  { round: 9, seat: 'A', index: 77 },
  { round: 10, seat: 'A', index: 86 },
  { round: 11, seat: 'A', index: 95 },
  { round: 12, seat: 'A', index: 103 },
  { round: 13, seat: 'A', index: 111 },
  { round: 14, seat: 'A', index: 120 },
  { round: 15, seat: 'A', index: 129 },
  { round: 16, seat: 'A', index: 138 },
  { round: 26, seat: 'B', index: 264 },
  { round: 35, seat: 'A', index: 404 },
] as const satisfies readonly { round: number; seat: SeatLabel; index: number }[];

/** Spec "Fixture": seat A's dominant, no-staging-walk passes in `mirror-s3`. */
export const MIRROR_S3_PASS_TURNS = [
  { round: 28, index: 167 },
  { round: 29, index: 172 },
] as const;

/** Playtest A r6: the kite-gate cause (spec Diagnosis). */
export const KITE_GATE_MOVE = 53;
/** Playtest A r35: the `IDLE_SLACK` cause, gap 147 (spec Diagnosis). */
export const IDLE_SLACK_MOVE = 404;

// ---------------------------------------------------------------------------
// P85 decision 12: P84's "a stepping plan is untouched" read off the guard
// ---------------------------------------------------------------------------

/**
 * The guard's input at a real position: the live search's readings for one
 * complete (the logged turn), wired the way `botSearch` wires them. The
 * restated P84 tests check `neverIdle` returns a stepping `staged` plan as is.
 */
export const guardSearchAt = (
  state: GameState,
  me: PlayerId,
  staged: readonly Move[],
): NeverIdleSearch<NeverIdleComplete> => {
  const ctx = specMissionContext(state, me);
  const complete: NeverIdleComplete = { moves: staged, state: foldPlan(state, staged) };
  return {
    geometry,
    rules,
    origin: state,
    me,
    completes: [complete],
    score: (c) => evaluate(geometry, c.state, me, rules),
    isThreatenedKite: (c) => isThreatenedKite(ctx, c),
    kiteLength: (c) => kiteLength(geometry, c.state, me, ctx.originTerritory),
    planKey,
    chooseMove,
  };
};

/** Stepped logged turns of `seats` in rounds `[from, to]` where `neverIdle` does not return the plan as is. */
export const guardChangedSteppedTurns = (
  replay: Replay,
  seats: readonly SeatLabel[],
  from: number,
  to: number,
): { readonly checked: number; readonly changed: readonly string[] } => {
  const stepped = turnStarts(replay, seats, from, to).filter((t) => hasStep(loggedTurn(replay, t.index)));
  const changed: string[] = [];
  for (const t of stepped) {
    const logged = loggedTurn(replay, t.index);
    if (neverIdle(guardSearchAt(t.state, t.me, logged), logged) !== logged) {
      changed.push(`${replay.name} ${t.seat} r${String(t.round)} @${String(t.index)}`);
    }
  }
  return { checked: stepped.length, changed };
};
