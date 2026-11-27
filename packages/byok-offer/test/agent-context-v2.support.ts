/**
 * Fixtures for docs/spec/agent-context-v2 — positions, a seat table and
 * hand-made recent lines.
 *
 * @see docs/spec/agent-context-v2/agent-context-v2.md
 */

import type { ArrowId, GameState, Group, LogEvent, Move, PlayerId } from '@conquarrow/contracts';
import { endTurn } from '@conquarrow/contracts';
import type { OfferSeat, RecentLine } from '../src/index';
import { opening, rules } from './agent-board-map.support';

export const seats3: readonly OfferSeat[] = [
  { player: 'A', kind: 'human', name: 'Gilad', relation: 'your owner' },
  { player: 'B', kind: 'agent', name: "Gilad's agent", relation: 'you' },
  { player: 'C', kind: 'heuristic', name: 'AI' },
];

export const SEAT_BLOCK = [
  'Seats in turn order:',
  'A human Gilad (your owner)',
  "B agent Gilad's agent (you)",
  'C heuristic AI',
].join('\n');

/** The 3-seat opening with seat B to move. */
export const seatBTurn = (): { readonly state: GameState; readonly b: PlayerId } => {
  let state = opening(3);
  state = rules.apply(state, endTurn());
  const b = state.activePlayer;
  return { state, b };
};

export const step = (from: string, exit: string, count = 1): Move => ({
  kind: 'step',
  from: from as ArrowId,
  exit: exit as ArrowId,
  count,
});

export const line = (seat: string, move: Move, events: readonly LogEvent[] = []): RecentLine => ({
  seat,
  move,
  events,
});

export const pass = (seat: string, to: string): RecentLine =>
  line(seat, endTurn(), [{ kind: 'turnPassed', from: seat, to }]);

/** The active seat's first stack, set to `heads` with `spent` already walked. */
export const withActiveStack = (
  state: GameState,
  heads: number,
  spent: number,
): { readonly state: GameState; readonly arrow: ArrowId } => {
  const found = [...state.groups].find(([, g]) => g.owner === state.activePlayer);
  if (found === undefined) throw new Error('setup: the active seat has no stack');
  const [arrow, g] = found;
  const groups = new Map<ArrowId, Group>(state.groups);
  groups.set(arrow, { ...g, heads, spent });
  return { state: { ...state, groups }, arrow };
};
