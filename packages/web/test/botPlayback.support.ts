/**
 * Stub RulesPort and opening GameState for P30 playback tests.
 * Apply records the move and returns a new object — not a real engine.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endTurn, mintArrowId, step } from '@conquarrow/contracts';
import type { ArrowId, GameState, Move, PlayerId, RulesPort } from '@conquarrow/contracts';
import { makeMatch } from '@conquarrow/geometry-tiling';
import { BOT_PLAYBACK_GAP_MS } from '../src/botPlayback';

export const botPlaybackSource = (): string =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/botPlayback.ts'), 'utf8');

export const openingState = (): GameState => makeMatch();

export const activeId = (state: GameState): string => String(state.activePlayer);

export const isAiSeatOf =
  (...ids: readonly string[]) =>
  (id: string): boolean =>
    ids.includes(id);

export const localAiOpts = (
  state: GameState,
): { online: false; isAiSeat: (id: string) => boolean } => ({
  online: false,
  isAiSeat: isAiSeatOf(activeId(state)),
});

/** Same active player; occupancy keys differ. Not a rules apply. */
export const occupancyShifted = (state: GameState): GameState => {
  const mover = [...state.groups].at(-1);
  if (mover === undefined) throw new Error('setup: opening has no groups');
  const [from, group] = mover;
  let dest: ArrowId | undefined;
  for (const [arrow, owner] of state.territory) {
    if (owner !== group.owner) continue;
    if (arrow === from) continue;
    if (state.groups.has(arrow)) continue;
    dest = arrow;
    break;
  }
  if (dest === undefined) throw new Error('setup: no empty home arrow to shift occupancy');
  const groups = new Map(state.groups);
  groups.delete(from);
  groups.set(dest, group);
  return { ...state, groups };
};

export const withWinner = (state: GameState, winner: PlayerId): GameState => ({
  ...state,
  winner,
});

export const plannedMoves = (count: number): Move[] => {
  const from = mintArrowId('p30-from');
  const exit = mintArrowId('p30-exit');
  const moves: Move[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i === count - 1 && count > 1) {
      moves.push(endTurn());
      continue;
    }
    moves.push(step(from, exit, i + 1));
  }
  return moves;
};

export const threeMoves = (): readonly Move[] => plannedMoves(3);

export type ApplyCall = { readonly state: GameState; readonly move: Move };

export type AppliedEvent = {
  readonly move: Move;
  readonly after: GameState;
  readonly index: number;
};

export type TimelineEvent =
  | { readonly kind: 'onApplied'; readonly index: number }
  | { readonly kind: 'sleep'; readonly ms: number };

export const stubRules = (): { readonly rules: RulesPort; readonly applyCalls: ApplyCall[] } => {
  const applyCalls: ApplyCall[] = [];
  const rules = {
    apply(state: GameState, move: Move): GameState {
      applyCalls.push({ state, move });
      return { ...state };
    },
  } as RulesPort;
  return { rules, applyCalls };
};

export const recorder = (
  options: { readonly cancelled?: boolean; readonly cancelOnSleep?: boolean } = {},
): {
  readonly isCancelled: () => boolean;
  readonly sleep: (ms: number) => Promise<void>;
  readonly onApplied: (move: Move, after: GameState, index: number) => void;
  readonly applied: AppliedEvent[];
  readonly sleeps: number[];
  readonly timeline: TimelineEvent[];
} => {
  let cancelled = options.cancelled === true;
  const applied: AppliedEvent[] = [];
  const sleeps: number[] = [];
  const timeline: TimelineEvent[] = [];
  return {
    isCancelled: () => cancelled,
    applied,
    sleeps,
    timeline,
    sleep: (ms: number): Promise<void> => {
      sleeps.push(ms);
      timeline.push({ kind: 'sleep', ms });
      if (options.cancelOnSleep === true) cancelled = true;
      return Promise.resolve();
    },
    onApplied: (move: Move, after: GameState, index: number) => {
      applied.push({ move, after, index });
      timeline.push({ kind: 'onApplied', index });
    },
  };
};

export const playbackOpts = (
  rec: ReturnType<typeof recorder>,
  gapMs: number = BOT_PLAYBACK_GAP_MS,
): {
  gapMs: number;
  sleep: (ms: number) => Promise<void>;
  onApplied: (move: Move, after: GameState, index: number) => void;
  cancelled: () => boolean;
} => ({
  gapMs,
  sleep: rec.sleep,
  onApplied: rec.onApplied,
  cancelled: rec.isCancelled,
});
